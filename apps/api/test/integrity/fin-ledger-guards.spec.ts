import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { financeApi, type JournalEntryJson } from '../harness/finance';
import { login, seedUser } from '../harness/identity';

/**
 * F1's ledger guards in the database (ADR-0089, migration 0033): an entry is reversed once even
 * when two reversals race (UNIQUE (company_id, reverses_id) under the code's check), and the posting
 * rules are append-only for app and for migrator alike.
 */
describe('fin ledger guards', () => {
  let app: NestExpressApplication;
  let asApp: Client;
  let migrator: Client;
  let accountant: string;

  beforeAll(async () => {
    app = await createHttpApp();
    asApp = await connectAs('app');
    migrator = await connectAs('migrator');
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
  });
  afterAll(async () => {
    await asApp.end();
    await migrator.end();
    await app.close();
  });

  it('lets exactly one of two simultaneous reversals of an entry commit', async () => {
    const finance = financeApi(app, accountant);
    // An expense, not the cash account: a cash line names its cash box since F2 (ADR-0090).
    const cash = await finance.account('730101');
    const income = await finance.account('511020');
    const entry = (
      await finance
        .journal({
          entryDate: businessDate(),
          description: 'Уралдаан',
          lines: [
            { accountId: cash.id, debit: '700' },
            { accountId: income.id, credit: '700' },
          ],
        })
        .expect(201)
    ).body as JournalEntryJson;
    const results = await Promise.all([
      finance.reverse(entry.id, 'Нэг'),
      finance.reverse(entry.id, 'Хоёр'),
    ]);
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
    const refused = results.find((res) => res.status !== 200);
    expect([409, 422]).toContain(refused?.status);
    const { rows } = await migrator.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM fin.journal_entries WHERE reverses_id = $1',
      [entry.id],
    );
    expect(rows[0]?.n).toBe('1');
    // The key itself, written by hand: a second reversal of the same entry never commits.
    expect(
      await sqlStateOf(
        migrator.query(
          `INSERT INTO fin.journal_entries (company_id, number, entry_date, period_id, source_system_id,
                                            reverses_id, description, actor_kind, actor_ref, actor_label)
           SELECT company_id, 'G-REV', entry_date, period_id, source_system_id, id, 'x', 'SYSTEM', 't', 't'
             FROM fin.journal_entries WHERE id = $1`,
          [entry.id],
        ),
      ),
    ).toBe('23505');
  });

  it('keeps the posting rules append-only for app and for migrator', async () => {
    expect(
      await sqlStateOf(asApp.query(`UPDATE fin.posting_rules SET effective_from = effective_from`)),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query(`DELETE FROM fin.posting_rules`))).toBe('42501');
    expect(
      await sqlStateOf(
        migrator.query(`UPDATE fin.posting_rules SET effective_from = effective_from`),
      ),
    ).toBe('23001');
    expect(await sqlStateOf(migrator.query(`DELETE FROM fin.posting_rules`))).toBe('23001');
  });
});
