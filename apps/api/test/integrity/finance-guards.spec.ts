import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { financeApi, salesFlow } from '../harness/finance';
import { login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/**
 * The database guards of finance (ADR-0060, migration 0026): the receivables ledger and the journal
 * are append-only for app and for migrator alike, documents are never deleted, and an entry that
 * does not balance never commits.
 */
describe('finance guards', () => {
  let app: NestExpressApplication;
  let asApp: Client;
  let migrator: Client;
  let invoiceId: number;
  let entryId: number;

  beforeAll(async () => {
    app = await createHttpApp();
    asApp = await connectAs('app');
    migrator = await connectAs('migrator');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const flow = await salesFlow(app, admin, 'FG');
    const product = await flow.product('8501', 'Талх', '1000', '20');
    const shop = await partnersApi(app, admin).customer({ name: 'Хамгаалалтын дэлгүүр' });
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(product), qty: '2' }]);
    await flow.sell(draft.id);
    const invoice = await financeApi(app, admin).invoiceOfOrder(draft.id);
    if (!invoice?.journalEntryId) throw new Error('no invoice');
    invoiceId = invoice.id;
    entryId = invoice.journalEntryId;
  });
  afterAll(async () => {
    await asApp.end();
    await migrator.end();
    await app.close();
  });

  it('lets app neither change nor delete the ledger, the journal or a document', async () => {
    expect(
      await sqlStateOf(
        asApp.query('UPDATE ar_entries SET debit = debit WHERE doc_id = $1', [invoiceId]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(asApp.query('DELETE FROM ar_entries WHERE doc_id = $1', [invoiceId])),
    ).toBe('42501');
    expect(
      await sqlStateOf(asApp.query('DELETE FROM journal_lines WHERE entry_id = $1', [entryId])),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        asApp.query('UPDATE journal_entries SET description = $2 WHERE id = $1', [entryId, 'x']),
      ),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('DELETE FROM invoices WHERE id = $1', [invoiceId]))).toBe(
      '42501',
    );
    expect(
      await sqlStateOf(asApp.query('DELETE FROM invoice_lines WHERE invoice_id = $1', [invoiceId])),
    ).toBe('42501');
    expect(
      await sqlStateOf(asApp.query('DELETE FROM gl_accounts WHERE code = $1', ['120101'])),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('TRUNCATE allocations'))).toBe('42501');
  });

  it('stops even the owner from rewriting the ledger or the journal', async () => {
    expect(
      await sqlStateOf(
        migrator.query('UPDATE journal_lines SET debit = debit + 1 WHERE entry_id = $1', [entryId]),
      ),
    ).toBe('23001');
    expect(
      await sqlStateOf(migrator.query('DELETE FROM journal_entries WHERE id = $1', [entryId])),
    ).toBe('23001');
    expect(
      await sqlStateOf(
        migrator.query('UPDATE ar_entries SET credit = 1 WHERE doc_id = $1', [invoiceId]),
      ),
    ).toBe('23001');
    expect(await sqlStateOf(migrator.query('TRUNCATE ar_entries'))).toBe('23001');
  });

  it('never commits an entry that does not balance or has one line', async () => {
    const attempt = async (lines: [number, number][]): Promise<string | undefined> => {
      await migrator.query('BEGIN');
      try {
        const { rows } = await migrator.query<{ id: number }>(
          `INSERT INTO journal_entries (number, entry_date, description, source)
           VALUES ($1, $2, 'guard test', 'MANUAL') RETURNING id`,
          [`G-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, businessDate()],
        );
        const account = await migrator.query<{ id: number }>(
          `SELECT id FROM gl_accounts WHERE code = '100101'`,
        );
        for (const [index, [debit, credit]] of lines.entries()) {
          await migrator.query(
            `INSERT INTO journal_lines (entry_id, line_no, account_id, debit, credit) VALUES ($1, $2, $3, $4, $5)`,
            [rows[0]?.id, index + 1, account.rows[0]?.id, debit, credit],
          );
        }
        return await sqlStateOf(migrator.query('COMMIT'));
      } catch (error) {
        await migrator.query('ROLLBACK');
        throw error;
      }
    };
    expect(
      await attempt([
        [100, 0],
        [0, 90],
      ]),
    ).toBe('23514');
    expect(await attempt([[100, 0]])).toBe('23514');
    expect(
      await attempt([
        [100, 0],
        [0, 100],
      ]),
    ).toBeUndefined();
  });
});
