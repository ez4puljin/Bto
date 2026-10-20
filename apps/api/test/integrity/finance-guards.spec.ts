import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { financeApi, salesFlow } from '../harness/finance';
import { login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/**
 * The database guards of finance (ADR-0060, migration 0026; the journal and the chart in the Finance
 * Core since F1's ledger, ADR-0089, migration 0033; the receivables as its open items since F2,
 * ADR-0090, migration 0034): the receivables' items, documents and allocations and the journal are
 * append-only for app and for migrator alike, documents and accounts are never deleted, and an
 * entry that does not balance never commits, whoever writes it.
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
        asApp.query(
          `UPDATE fin.open_items SET amount = amount WHERE document_id IN (SELECT d.id FROM fin.documents d WHERE d.source_doc_type = 'SALES_INVOICE' AND d.source_doc_id = $1::text)`,
          [invoiceId],
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        asApp.query(
          `DELETE FROM fin.open_items WHERE document_id IN (SELECT d.id FROM fin.documents d WHERE d.source_doc_type = 'SALES_INVOICE' AND d.source_doc_id = $1::text)`,
          [invoiceId],
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(asApp.query('DELETE FROM fin.journal_lines WHERE entry_id = $1', [entryId])),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        asApp.query('UPDATE fin.journal_entries SET description = $2 WHERE id = $1', [
          entryId,
          'x',
        ]),
      ),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('DELETE FROM invoices WHERE id = $1', [invoiceId]))).toBe(
      '42501',
    );
    expect(
      await sqlStateOf(asApp.query('DELETE FROM invoice_lines WHERE invoice_id = $1', [invoiceId])),
    ).toBe('42501');
    expect(
      await sqlStateOf(asApp.query('DELETE FROM fin.accounts WHERE code = $1', ['120101'])),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('TRUNCATE fin.allocations'))).toBe('42501');
    expect(await sqlStateOf(asApp.query('DELETE FROM fin.documents'))).toBe('42501');
    expect(await sqlStateOf(asApp.query('UPDATE fin.allocations SET amount = amount'))).toBe(
      '42501',
    );
  });

  it('stops even the owner from rewriting the ledger or the journal', async () => {
    expect(
      await sqlStateOf(
        migrator.query('UPDATE fin.journal_lines SET debit = debit + 1 WHERE entry_id = $1', [
          entryId,
        ]),
      ),
    ).toBe('23001');
    expect(
      await sqlStateOf(migrator.query('DELETE FROM fin.journal_entries WHERE id = $1', [entryId])),
    ).toBe('23001');
    expect(
      await sqlStateOf(
        migrator.query(
          `UPDATE fin.open_items SET amount = amount + 1 WHERE document_id IN (SELECT d.id FROM fin.documents d WHERE d.source_doc_type = 'SALES_INVOICE' AND d.source_doc_id = $1::text)`,
          [invoiceId],
        ),
      ),
    ).toBe('23001');
    expect(await sqlStateOf(migrator.query('TRUNCATE fin.allocations'))).toBe('23001');
    expect(
      await sqlStateOf(
        migrator.query(
          'UPDATE fin.documents SET description = description WHERE source_doc_id = $1',
          [String(invoiceId)],
        ),
      ),
    ).toBe('23001');
  });

  it('never commits an entry that does not balance or has one line, as app or as migrator', async () => {
    const attempt = async (as: Client, lines: [number, number][]): Promise<string | undefined> => {
      await as.query('BEGIN');
      try {
        // The entry's month exists (the invoice of beforeAll opened it), dated today.
        const { rows } = await as.query<{ id: string; company_id: string }>(
          `INSERT INTO fin.journal_entries (company_id, number, entry_date, period_id, source_system_id,
                                            description, actor_kind, actor_ref, actor_label)
           SELECT c.id, $1, $2, p.id, s.id, 'guard test', 'SYSTEM', 'test', 'test'
             FROM fin.companies c
             JOIN fin.fiscal_periods p ON p.company_id = c.id AND p.code = $3
             JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'FIN'
            WHERE c.code = 'BO'
           RETURNING id, company_id`,
          [
            `G-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            businessDate(),
            businessDate().slice(0, 7),
          ],
        );
        const entry = rows[0];
        if (!entry) throw new Error('no guard entry');
        for (const [index, [debit, credit]] of lines.entries()) {
          await as.query(
            `INSERT INTO fin.journal_lines (company_id, entry_id, line_no, account_id, debit, credit)
             SELECT $1, $2, $3, a.id, $4, $5 FROM fin.accounts a
              WHERE a.company_id = $1 AND a.code = '100101'`,
            [entry.company_id, entry.id, index + 1, debit, credit],
          );
        }
        return await sqlStateOf(as.query('COMMIT'));
      } catch (error) {
        await as.query('ROLLBACK');
        throw error;
      }
    };
    for (const as of [asApp, migrator]) {
      expect(
        await attempt(as, [
          [100, 0],
          [0, 90],
        ]),
      ).toBe('23514');
      expect(await attempt(as, [[100, 0]])).toBe('23514');
    }
    expect(
      await attempt(migrator, [
        [100, 0],
        [0, 100],
      ]),
    ).toBeUndefined();
  });
});
