import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import {
  FinChartService,
  type FinDb,
  type FinEntryLineIn,
  FinJournalPosting,
  FinJournalReader,
} from '../../src/finance-core';
import { connectAs, sqlStateOf } from '../harness/apps';
import { createFinanceCoreOnly, StaticCaller, TEST_COMPANY } from '../harness/static-caller';

/**
 * F1's ledger on its own (ADR-0089): the chart, the rules, the periods and the journal's posting
 * façade, booted with no Bto module through the test StaticCaller.
 */
describe('Finance Core without Bto (F1 ledger)', () => {
  let db: FinDb;
  let chart: FinChartService;
  let posting: FinJournalPosting;
  let reader: FinJournalReader;
  let close: () => Promise<void>;
  let admin: Client;
  let numbers = 0;
  const source = () => StaticCaller.source();
  const d = (value: string) => new Decimal(value);
  const nextNumber = () => `T-${String((numbers += 1)).padStart(4, '0')}`;
  const accountId = async (code: string): Promise<number> => {
    const found = (await chart.accounts(source(), { company: TEST_COMPANY })).find(
      (account) => account.code === code,
    );
    if (!found) throw new Error(`account ${code} is missing`);
    return found.id;
  };
  const post = (lines: FinEntryLineIn[], entryDate = '2026-10-15', ctx = source()) =>
    db.transaction((tx) =>
      posting.postEntryInTx(tx, ctx, {
        company: TEST_COMPANY,
        number: nextNumber(),
        entryDate,
        description: 'Туршилт',
        sourceDoc: { type: 'INVOICE', id: String(numbers) },
        lines,
      }),
    );
  const codeOf = async (call: Promise<unknown>): Promise<string | undefined> => {
    try {
      await call;
      return undefined;
    } catch (error: unknown) {
      // A FinError carries its code; a database refusal arrives wrapped, with its SQLSTATE below.
      const own = error as { code?: string; cause?: { code?: string } };
      return own.code ?? own.cause?.code;
    }
  };
  const sale = async (amount: string): Promise<FinEntryLineIn[]> => [
    { key: 'AR', debit: d(amount), credit: d('0') },
    { accountId: await accountId('5101'), debit: d('0'), credit: d(amount) },
  ];

  beforeAll(async () => {
    const core = await createFinanceCoreOnly();
    db = core.db;
    close = core.close;
    chart = core.module.get(FinChartService);
    posting = core.module.get(FinJournalPosting);
    reader = core.module.get(FinJournalReader);
    admin = await connectAs('admin');
    await StaticCaller.ensureWithChart(db);
  });
  afterAll(async () => {
    await admin.end();
    await close();
  });

  it('seeds an empty chart once, with a rule per template key from the beginning', async () => {
    await StaticCaller.ensureWithChart(db);
    const accounts = await chart.accounts(source(), { company: TEST_COMPANY });
    expect(accounts.map((account) => [account.code, account.normalSide, account.control])).toEqual([
      ['1001', 'DEBIT', 'MONEY'],
      ['1201', 'DEBIT', 'RECEIVABLE'],
      ['3110', 'CREDIT', 'NONE'],
      ['5101', 'CREDIT', 'NONE'],
    ]);
    const rules = await chart.rules(source(), { company: TEST_COMPANY, on: '2026-10-15' });
    expect(rules.get('AR')?.accountId).toBe(await accountId('1201'));
    expect(rules.get('AR')?.effectiveFrom).toBe('2000-01-01');
  });

  it('posts by key, keeps the rule on the line and opens the month on demand', async () => {
    const entry = await post(await sale('1000'));
    const detail = await reader.entry(source(), { company: TEST_COMPANY, id: entry.id });
    expect(detail).toMatchObject({
      number: entry.number,
      system: 'TEST_PMS',
      sourceDocType: 'INVOICE',
      amount: d('1000'),
      lineCount: 2,
    });
    expect(detail?.lines.map((line) => [line.accountCode, line.postingKey])).toEqual([
      ['1201', 'AR'],
      ['5101', null],
    ]);
    const { rows } = await admin.query<{ code: string; status: string; rules: string }>(
      `SELECT p.code, p.status,
              (SELECT count(*) FROM fin.journal_lines l
                WHERE l.entry_id = $1 AND l.posting_rule_id IS NOT NULL)::text AS rules
         FROM fin.journal_entries e JOIN fin.fiscal_periods p ON p.id = e.period_id
        WHERE e.id = $1`,
      [entry.id],
    );
    expect(rows[0]).toEqual({ code: '2026-10', status: 'OPEN', rules: '1' });
  });

  it('refuses an unbalanced entry, a third decimal, an unknown key and an inactive account', async () => {
    const lines = await sale('100');
    expect(
      await codeOf(
        post([lines[0] as FinEntryLineIn, { ...(lines[1] as FinEntryLineIn), credit: d('90') }]),
      ),
    ).toBe('FIN_UNBALANCED');
    expect(
      await codeOf(
        post([
          { ...(lines[0] as FinEntryLineIn), debit: d('0.001') },
          { ...(lines[1] as FinEntryLineIn), credit: d('0.001') },
        ]),
      ),
    ).toBe('FIN_AMOUNT_PRECISION');
    expect(
      await codeOf(
        post([{ ...(lines[0] as FinEntryLineIn), key: 'NO_SUCH_KEY' }, lines[1] as FinEntryLineIn]),
      ),
    ).toBe('FIN_MAPPING_MISSING');
    const closed = await db.transaction((tx) =>
      chart.createAccountInTx(
        tx,
        StaticCaller.user({ [TEST_COMPANY]: ['finance.config.manage'] }),
        {
          company: TEST_COMPANY,
          code: '7301',
          name: 'Хаасан зардал',
          kind: 'EXPENSE',
        },
      ),
    );
    await db.transaction((tx) =>
      chart.updateAccountInTx(
        tx,
        StaticCaller.user({ [TEST_COMPANY]: ['finance.config.manage'] }),
        {
          company: TEST_COMPANY,
          id: closed.id,
          patch: { status: 'INACTIVE' },
        },
      ),
    );
    expect(
      await codeOf(
        post([
          { accountId: closed.id, debit: d('100'), credit: d('0') },
          { accountId: await accountId('1001'), debit: d('0'), credit: d('100') },
        ]),
      ),
    ).toBe('FIN_ACCOUNT_INACTIVE');
  });

  it('follows a rule from its date, and an unmapping refuses the key from then on', async () => {
    const config = StaticCaller.user({ [TEST_COMPANY]: ['finance.config.manage'] });
    const cash = await accountId('1001');
    await db.transaction((tx) =>
      chart.setRuleInTx(tx, config, {
        company: TEST_COMPANY,
        key: 'AR',
        accountId: cash,
        effectiveFrom: '2026-11-01',
      }),
    );
    const before = await post(await sale('10'), '2026-10-31');
    const after = await post(await sale('10'), '2026-11-02');
    const code = async (id: number) =>
      (await reader.entry(source(), { company: TEST_COMPANY, id }))?.lines[0]?.accountCode;
    expect(await code(before.id)).toBe('1201');
    expect(await code(after.id)).toBe('1001');
    await db.transaction((tx) =>
      chart.setRuleInTx(tx, config, {
        company: TEST_COMPANY,
        key: 'AR',
        accountId: null,
        effectiveFrom: '2026-11-03',
      }),
    );
    expect(await codeOf(post(await sale('10'), '2026-11-04'))).toBe('FIN_MAPPING_MISSING');
    expect(await sqlStateOf(admin.query(`UPDATE fin.posting_rules SET account_id = NULL`))).toBe(
      '23001',
    );
  });

  it('refuses a closed month and an earlier month without a row, and opens a later one', async () => {
    await post(await sale('5'), '2026-08-10');
    await admin.query(`UPDATE fin.fiscal_periods SET status = 'CLOSED' WHERE code = '2026-08'`);
    expect(await codeOf(post(await sale('5'), '2026-08-20'))).toBe('FIN_PERIOD_CLOSED');
    expect(await codeOf(post(await sale('5'), '2026-07-20'))).toBe('FIN_PERIOD_CLOSED');
    await post(await sale('5'), '2026-09-20');
    const { rows } = await admin.query<{ code: string; status: string }>(
      `SELECT code, status FROM fin.fiscal_periods WHERE code IN ('2026-07', '2026-09') ORDER BY code`,
    );
    expect(rows).toEqual([{ code: '2026-09', status: 'OPEN' }]);
  });

  it('reverses an entry once, mirroring its lines and keeping its source document', async () => {
    const original = await post(await sale('300'));
    const reversal = await db.transaction((tx) =>
      posting.reverseEntryInTx(tx, source(), {
        company: TEST_COMPANY,
        entryId: original.id,
        number: nextNumber(),
        entryDate: '2026-10-16',
        description: 'Буцаалт',
      }),
    );
    const detail = await reader.entry(source(), { company: TEST_COMPANY, id: reversal.id });
    expect(detail).toMatchObject({ reversesId: original.id, sourceDocType: 'INVOICE' });
    expect(
      detail?.lines.map((line) => [
        line.accountCode,
        line.debit.toFixed(2),
        line.credit.toFixed(2),
      ]),
    ).toEqual([
      ['1201', '0.00', '300.00'],
      ['5101', '300.00', '0.00'],
    ]);
    expect(
      (await reader.reversals(source(), { company: TEST_COMPANY, ids: [original.id] })).get(
        original.id,
      ),
    ).toEqual({ id: reversal.id, number: reversal.number });
    expect(
      await codeOf(
        db.transaction((tx) =>
          posting.reverseEntryInTx(tx, source(), {
            company: TEST_COMPANY,
            entryId: original.id,
            number: nextNumber(),
            entryDate: '2026-10-16',
            description: 'Дахин',
          }),
        ),
      ),
    ).toBe('23505');
  });

  it('lets a user post only with finance.journal.manage there, as the core’s own source FIN', async () => {
    expect(
      await codeOf(
        post(
          await sale('7'),
          '2026-10-15',
          StaticCaller.user({ [TEST_COMPANY]: ['finance.read'] }),
        ),
      ),
    ).toBe('FIN_COMPANY_FORBIDDEN');
    const entry = await post(
      await sale('7'),
      '2026-10-15',
      StaticCaller.user({ [TEST_COMPANY]: ['finance.journal.manage'] }),
    );
    expect((await reader.entry(source(), { company: TEST_COMPANY, id: entry.id }))?.system).toBe(
      'FIN',
    );
  });

  it('runs a balance per account and lists entries newest first by origin', async () => {
    const totals = await reader.accountTotals(source(), {
      company: TEST_COMPANY,
      asOf: '2026-10-31',
    });
    const ar = totals.get(await accountId('1201'));
    expect(ar?.debit.gt(0)).toBe(true);
    const listed = await reader.entries(source(), {
      company: TEST_COMPANY,
      origin: { system: 'FIN' },
      limit: 10,
    });
    expect(listed.map((row) => row.system)).toEqual(['FIN']);
    const ledger = await reader.accountLedger(source(), {
      company: TEST_COMPANY,
      accountId: await accountId('5101'),
      from: '2026-10-01',
      limit: 50,
    });
    const dates = ledger.rows.map((row) => row.entryDate);
    expect(dates.length).toBeGreaterThan(0);
    expect(dates).toEqual([...dates].sort().reverse());
  });
});
