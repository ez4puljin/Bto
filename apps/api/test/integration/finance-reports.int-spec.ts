import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { financeApi } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';

interface TrialBalanceJson {
  data: { code: string; opening: string; debit: string; credit: string; closing: string }[];
  opening: string;
  debit: string;
  credit: string;
  closing: string;
}
interface YearJson {
  year: number;
  ended: boolean;
  documents: { number: string; date: string }[];
  income: string;
  expense: string;
  profit: string;
}

/**
 * F6 on Bto's side (ADR-0105): the trial balance and the VAT report over HTTP and in Excel, and the
 * year close into retained earnings with its revert and its refusals.
 */
describe('finance reports and the year close', () => {
  let app: NestExpressApplication;
  let accountant: string;
  let office: string;
  const today = businessDate();
  const lastYear = Number.parseInt(today.slice(0, 4), 10) - 1;
  const http = () => request(app.getHttpServer());
  const get = (token: string, path: string, query: Record<string, string> = {}) =>
    http().get(`/api/v1${path}`).query(query).set(bearer(token));
  const yearPost = (token: string, path: string) =>
    http().post(`/api/v1/finance/year-close/${path}`).set(bearer(token)).set(idempotency());

  beforeAll(async () => {
    app = await createHttpApp();
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    accountant = await token('ACCOUNTANT');
    office = await token('OFFICE');
    const finance = financeApi(app, accountant);
    const id = async (code: string) => (await finance.account(code)).id;
    // Last year: income 1000, expense 300 against an equity account (no money account needed).
    await finance
      .journal({
        entryDate: `${lastYear}-12-15`,
        description: 'Өнгөрсөн оны гүйлгээ',
        lines: [
          { accountId: await id('730101'), debit: '300' },
          { accountId: await id('390101'), debit: '700' },
          { accountId: await id('511020'), credit: '1000' },
        ],
      })
      .expect(201);
    // This month: output VAT 100, input VAT 40 typed by hand.
    await finance
      .journal({
        entryDate: today,
        description: 'НӨАТ гараар',
        lines: [
          { accountId: await id('130301'), debit: '40' },
          { accountId: await id('730101'), debit: '60' },
          { accountId: await id('311004'), credit: '100' },
        ],
      })
      .expect(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('shows a balanced trial balance and the month’s VAT, and downloads both', async () => {
    const from = `${today.slice(0, 7)}-01`;
    const tb = (
      await get(accountant, '/finance/reports/trial-balance', { from, to: today }).expect(200)
    ).body as TrialBalanceJson;
    expect(tb.debit).toBe(tb.credit);
    expect(tb.closing).toBe('0.00');
    expect(tb.data.find((row) => row.code === '511020')).toMatchObject({
      opening: '-1000.00',
      closing: '-1000.00',
    });
    const vat = (
      await get(office, '/finance/reports/vat', { period: today.slice(0, 7) }).expect(200)
    ).body as { output: string; input: string; payable: string; groups: { side: string }[] };
    expect(vat).toMatchObject({ output: '100.00', input: '40.00', payable: '60.00' });
    expect(vat.groups.map((group) => group.side)).toEqual(['OUTPUT', 'INPUT']);
    const xlsx = await get(accountant, '/finance/reports/trial-balance.xlsx', { from, to: today })
      .buffer(true)
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    await get(accountant, '/finance/reports/vat.xlsx', { period: today.slice(0, 7) }).expect(200);
    await get(accountant, '/finance/reports/vat', { period: '2026-13' }).expect(422);
  });

  it('closes last year into retained earnings, refuses twice, reverts and closes again', async () => {
    const before = (await get(accountant, `/finance/year-close/${lastYear}`).expect(200))
      .body as YearJson;
    expect(before).toMatchObject({
      ended: true,
      documents: [],
      income: '1000.00',
      expense: '300.00',
      profit: '700.00',
    });
    await yearPost(office, String(lastYear)).expect(403);
    const closed = (await yearPost(accountant, String(lastYear)).expect(200)).body as YearJson;
    expect(closed).toMatchObject({ income: '0.00', expense: '0.00', profit: '0.00' });
    expect(closed.documents).toHaveLength(1);
    expect(closed.documents[0]?.date).toBe(`${lastYear}-12-31`);
    const tb = (
      await get(accountant, '/finance/reports/trial-balance', {
        from: `${lastYear}-01-01`,
        to: `${lastYear}-12-31`,
      }).expect(200)
    ).body as TrialBalanceJson;
    expect(tb.data.find((row) => row.code === '340101')?.closing).toBe('-700.00');
    expect(tb.data.find((row) => row.code === '511020')?.closing).toBe('0.00');
    expect((await yearPost(accountant, String(lastYear)).expect(422)).body).toMatchObject({
      code: 'FIN_CLASS_RULE',
      params: { rule: 'YEAR_CLOSED' },
    });
    const reverted = (await yearPost(accountant, `${lastYear}/revert`).expect(200))
      .body as YearJson;
    expect(reverted).toMatchObject({ documents: [], profit: '700.00' });
    const again = (await yearPost(accountant, String(lastYear)).expect(200)).body as YearJson;
    expect(again.documents).toHaveLength(1);
    expect(again.documents[0]?.number).not.toBe(closed.documents[0]?.number);
  });

  it('builds СТ-1 and СТ-2 from the journal, a closed year keeping its result (ADR-0184)', async () => {
    interface RowJson {
      code: string;
      opening: string | null;
      amount: string | null;
      accounts: { accountId: number; code: string; amount: string; linked: boolean }[];
      result: { opening: string; amount: string } | null;
    }
    interface StatementJson {
      rows: RowJson[];
      difference: { opening: string; amount: string } | null;
    }
    const statement = async (kind: string, from: string, to: string) =>
      (await get(accountant, `/finance/reports/statements/${kind}`, { from, to }).expect(200))
        .body as StatementJson;
    const row = (report: StatementJson, code: string) => {
      const found = report.rows.find((entry) => entry.code === code);
      if (!found) throw new Error(`no row ${code}`);
      return found;
    };
    const yearStart = `${lastYear}-01-01`;
    const yearEnd = `${lastYear}-12-31`;
    // Last year is closed, yet its income statement still reads 1000 − 300.
    const income = await statement('income', yearStart, yearEnd);
    expect(row(income, 'I8').amount).toBe('1000.00');
    expect(row(income, 'I12').amount).toBe('300.00');
    expect(row(income, 'I22').amount).toBe('700.00');
    expect(income.difference).toBeNull();
    // Its balance sheet holds the result in retained earnings, nothing left unclosed.
    const closed = await statement('balance', yearStart, yearEnd);
    expect(row(closed, 'E_2').amount).toBe('-700.00');
    expect(row(closed, 'E_3')).toMatchObject({
      amount: '700.00',
      result: { opening: '0.00', amount: '0.00' },
    });
    expect(closed.difference).toEqual({ opening: '0.00', amount: '0.00' });
    // This year: input VAT 40 an asset, output VAT 100 a liability, the open loss of 60 in equity.
    const now = await statement('balance', `${today.slice(0, 4)}-01-01`, today);
    expect(row(now, 'A_T').amount).toBe('40.00');
    expect(row(now, 'L1_2').amount).toBe('100.00');
    expect(row(now, 'E_3')).toMatchObject({
      opening: '700.00',
      amount: '640.00',
      result: { opening: '0.00', amount: '-60.00' },
    });
    expect(row(now, 'LE_T').amount).toBe('40.00');
    expect(now.difference).toEqual({ opening: '0.00', amount: '0.00' });

    // The accountant moves the expense account to the income-tax row and back.
    const expense = row(income, 'I12').accounts[0];
    if (!expense) throw new Error('no expense account');
    const link = (token: string, rowCode: string | null) =>
      http()
        .put(`/api/v1/finance/statement-links/${expense.accountId}`)
        .set(bearer(token))
        .send({ rowCode });
    await link(office, 'I19').expect(403);
    await link(accountant, 'I1').expect(422);
    await link(accountant, 'A1_1').expect(422);
    await link(accountant, 'I19').expect(204);
    const moved = await statement('income', yearStart, yearEnd);
    expect(row(moved, 'I12').amount).toBe('0.00');
    expect(row(moved, 'I18').amount).toBe('1000.00');
    expect(row(moved, 'I19')).toMatchObject({
      amount: '300.00',
      accounts: [expect.objectContaining({ code: expense.code, linked: true })],
    });
    expect(row(moved, 'I22').amount).toBe('700.00');
    await link(accountant, null).expect(204);
    expect(row(await statement('income', yearStart, yearEnd), 'I12').amount).toBe('300.00');

    const xlsx = await get(accountant, '/finance/reports/statements/balance/xlsx', {
      from: yearStart,
      to: yearEnd,
    })
      .buffer(true)
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    await get(accountant, '/finance/reports/statements/cash', {
      from: yearStart,
      to: yearEnd,
    }).expect(422);
    await get(accountant, '/finance/reports/statements/income', {
      from: yearEnd,
      to: yearStart,
    }).expect(422);
  });

  it('refuses a year that has not ended and a closed December', async () => {
    expect((await yearPost(accountant, today.slice(0, 4)).expect(409)).body).toMatchObject({
      code: 'FIN_PERIOD_NOT_ENDED',
    });
    await yearPost(accountant, `${lastYear}/revert`).expect(200);
    await http()
      .post(`/api/v1/finance/periods/${lastYear}-12/close`)
      .set(bearer(accountant))
      .set(idempotency())
      .expect(200);
    expect((await yearPost(accountant, String(lastYear)).expect(409)).body).toMatchObject({
      code: 'FIN_PERIOD_CLOSED',
    });
  });
});
