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
