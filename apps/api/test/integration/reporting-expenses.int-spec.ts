import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { idempotency, unitOf } from '../harness/catalog';
import { financeApi, salesFlow } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { expectReconciled, postIssue } from '../harness/inventory';

interface Figures {
  sales: string;
  cost: string;
  profit: string;
  margin: string | null;
}
interface ResultJson {
  otherIncome: string;
  expenses: string;
  operatingProfit: string;
  tax: string;
  netProfit: string;
}
interface ExpenseRowJson {
  kind: 'GROUP' | 'ACCOUNT' | 'NONE';
  id: number | null;
  code: string | null;
  name: string | null;
  amount: string;
  previous: string;
  lastYear: string;
  share: string | null;
  children: ExpenseRowJson[];
}
type Periods<T> = { current: T; previous: T; lastYear: T };
interface BoardJson {
  kind: string;
  period: string;
  running: boolean;
  current: { from: string; to: string };
  totals: Periods<Figures>;
  discounts: Periods<string> | null;
  results: Periods<ResultJson> | null;
  expenses: {
    rows: ExpenseRowJson[];
    total: Periods<string>;
    common: Periods<string> | null;
    lines: number;
  } | null;
  trend: (Figures & { period: string; netProfit: string | null })[];
}
interface EntriesJson {
  from: string;
  to: string;
  rows: {
    entryId: number;
    date: string;
    number: string;
    description: string | null;
    accountCode: string;
    partyName: string | null;
    branchId: number | null;
    amount: string;
  }[];
  more: boolean;
  total: string;
}

const d = (value: string | null | undefined) => new Decimal(value ?? '0');

/**
 * «Ашгийн самбар»'s operating expenses, other income, tax, operating and net profit from the books
 * (ADR-0238): the expenses by the chart's groups down to the account, «Бүлэггүй данс», the other
 * income and the tax, a cost line and a 520202 line left out, a reversal that nets out, a year close
 * that does not zero its year, a month, a quarter and a year with both comparisons, the branch with
 * «Нийтлэг», hidden under a source filter, the entries behind a row and the right. The past figures
 * stand three and two years back, where no other file of the shared database posts. Fictitious data.
 */
describe('profit board: expenses from the books', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let viewer: string;
  let branchId: number;
  const ids: Record<string, number> = {};
  const groups: Record<string, number> = {};
  const today = businessDate();
  const year = Number.parseInt(today.slice(0, 4), 10);
  const y2 = String(year - 2);
  const y3 = String(year - 3);
  const http = () => request(app.getHttpServer());
  const get = (token: string, path: string, query: Record<string, unknown> = {}) =>
    http().get(`/api/v1/reports${path}`).query(query).set(bearer(token));
  const board = async (query: Record<string, unknown>) =>
    (await get(accountant, '/profit-board', query).expect(200)).body as BoardJson;
  const entries = async (query: Record<string, unknown>) =>
    (await get(accountant, '/profit-board/expense-entries', query).expect(200)).body as EntriesJson;
  const flat = (rows: readonly ExpenseRowJson[]): ExpenseRowJson[] =>
    rows.flatMap((row) => [row, ...flat(row.children)]);

  beforeAll(async () => {
    app = await createHttpApp();
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    admin = (await login(app, adminUser)).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    viewer = await customRoleUser(app, admin, ['reports.view']);
    const finance = financeApi(app, accountant);

    // The chart: «Зардал ЗС» holds only expense groups, so its two sub-groups are the top rows.
    await http()
      .post('/api/v1/gl-accounts/chart')
      .set(bearer(admin))
      .send({
        groups: [
          { code: 'ZS7', name: 'Зардал ЗС', parentCode: null, sort: 0 },
          { code: 'ZS70', name: 'Удирдлагын зардал ЗС', parentCode: 'ZS7', sort: 0 },
          { code: 'ZS7010', name: 'Урсгал зардал ЗС', parentCode: 'ZS70', sort: 0 },
          { code: 'ZS7020', name: 'Материалын зардал ЗС', parentCode: 'ZS70', sort: 1 },
          { code: 'ZS71', name: 'Борлуулалтын зардал ЗС', parentCode: 'ZS7', sort: 1 },
        ],
        accounts: [
          ['701098', 'Түрээсийн зардал ЗС', 'ZS7010'],
          ['702098', 'Цахилгааны зардал ЗС', 'ZS7020'],
          ['710198', 'Тээврийн зардал ЗС', 'ZS71'],
        ].map(([code, name, groupCode]) => ({
          code,
          name,
          kind: 'EXPENSE',
          normalSide: 'DEBIT',
          control: 'NONE',
          groupCode,
          key: null,
        })),
        inactiveCodes: [],
      })
      .expect(200);
    const chartGroups = (await http().get('/api/v1/gl-accounts/groups').set(bearer(admin)))
      .body as { id: number; code: string }[];
    for (const group of chartGroups) groups[group.code] = group.id;
    if (!(await finance.accounts()).some((account) => account.code === '910101')) {
      await finance
        .createAccount({ code: '910101', name: 'Орлогын татварын зардал', kind: 'EXPENSE' })
        .expect(201);
    }
    for (const code of [
      '701098',
      '702098',
      '710198',
      '730101',
      '910101',
      '511020',
      '610101',
      '520202',
      '390101',
    ]) {
      ids[code] = (await finance.account(code)).id;
    }
    const post = async (
      entryDate: string,
      description: string,
      lines: { code: string; debit?: string; credit?: string }[],
    ) =>
      (
        await finance
          .journal({
            entryDate,
            description,
            lines: lines.map(({ code, ...amounts }) => ({ accountId: ids[code], ...amounts })),
          })
          .expect(201)
      ).body as { id: number };
    const expense = (date: string, description: string, code: string, amount: string) =>
      post(date, description, [
        { code, debit: amount },
        { code: '390101', credit: amount },
      ]);

    // June two years back: electricity, rent, an ungrouped expense, other income, tax, and a cost
    // line and a purchase-discount line the board never reads from the books.
    await expense(`${y2}-06-10`, 'Цахилгааны төлбөр ЗС', '702098', '300000');
    await expense(`${y2}-06-12`, 'Түрээс ЗС', '701098', '1000000');
    await expense(`${y2}-06-14`, 'Бусад зардал ЗС', '730101', '20000');
    await post(`${y2}-06-15`, 'Бусад орлого ЗС', [
      { code: '390101', debit: '200000' },
      { code: '511020', credit: '200000' },
    ]);
    await expense(`${y2}-06-20`, 'Орлогын татвар ЗС', '910101', '50000');
    await post(`${y2}-06-22`, 'Өртөг, хөнгөлөлт ЗС', [
      { code: '610101', debit: '70000' },
      { code: '520202', credit: '40000' },
      { code: '390101', credit: '30000' },
    ]);
    // The month before and the same month a year earlier.
    await expense(`${y2}-05-10`, 'Цахилгааны төлбөр ЗС', '702098', '250000');
    await expense(`${y3}-06-10`, 'Түрээс ЗС', '701098', '900000');
    // The year two years back is closed into retained earnings (ADR-0105).
    await http()
      .post(`/api/v1/finance/year-close/${y2}`)
      .set(bearer(accountant))
      .set(idempotency())
      .expect(200);

    // Today: a transport expense reversed the same day, and a branch-less expense that stays.
    const transport = await expense(today, 'Тээвэр ЗС', '710198', '80000');
    await finance.reverse(transport.id, 'Алдаатай ЗС').expect(200);
    await expense(today, 'Нийтлэг зардал ЗС', '730101', '25000');
    // A goods issue for internal use in our warehouse: an expense tagged with its branch.
    const flow = await salesFlow(app, admin, 'ZS');
    branchId = flow.wh.branchId;
    const soap = await flow.product('9481', 'Саван ЗС', '1000', '20');
    const types = (await http().get('/api/v1/issues/expense-types').set(bearer(admin)).expect(200))
      .body as { id: number; code: string | null }[];
    const draft = (
      await http()
        .post('/api/v1/issues')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: flow.wh.id,
          expenseTypeId: types.find((type) => type.code === 'INTERNAL_USE')?.id,
          recipient: { kind: 'OTHER', name: 'Оффис ЗС' },
          lines: [{ productUnitId: unitOf(soap, 'PCS').id, enteredQty: '2' }],
        })
        .expect(201)
    ).body as { id: number };
    await postIssue(app, admin, draft.id);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('opens only with reports.margins.view', async () => {
    await get(viewer, '/profit-board', { kind: 'month' }).expect(403);
    await get(viewer, '/profit-board/expense-entries', {
      kind: 'month',
      rowKind: 'NONE',
    }).expect(403);
    await get(accountant, '/profit-board/expense-entries', {
      kind: 'month',
      rowKind: 'ACCOUNT',
      id: ids['511020'],
    }).expect(422);
    await get(accountant, '/profit-board/expense-entries', {
      kind: 'month',
      rowKind: 'GROUP',
    }).expect(422);
    await get(accountant, '/profit-board/expense-entries', {
      kind: 'month',
      rowKind: 'WAREHOUSE',
    }).expect(422);
  });

  it('reads a month: expenses by group, other income, tax, operating and net profit', async () => {
    const report = await board({ kind: 'month', period: `${y2}-06` });
    expect(report.running).toBe(false);
    expect(report.results?.current).toEqual({
      otherIncome: '200000.00',
      expenses: '1320000.00',
      operatingProfit: '-1120000.00',
      tax: '50000.00',
      netProfit: '-1170000.00',
    });
    expect(report.results?.previous).toMatchObject({ expenses: '250000.00', tax: '0.00' });
    expect(report.results?.lastYear).toMatchObject({ expenses: '900000.00', otherIncome: '0.00' });
    // Operating profit = gross profit + supplier discounts + other income − expenses; net − tax.
    for (const key of ['current', 'previous', 'lastYear'] as const) {
      const result = report.results?.[key];
      expect(result?.operatingProfit).toBe(
        d(report.totals[key].profit)
          .plus(d(report.discounts?.[key]))
          .plus(d(result?.otherIncome))
          .minus(d(result?.expenses))
          .toFixed(2),
      );
      expect(result?.netProfit).toBe(d(result?.operatingProfit).minus(d(result?.tax)).toFixed(2));
    }

    const expenses = report.expenses;
    expect(expenses?.total).toEqual({
      current: '1320000.00',
      previous: '250000.00',
      lastYear: '900000.00',
    });
    expect(expenses?.common).toBeNull();
    expect(expenses?.lines).toBe(3);
    // The class's heading is opened: its group holding rent and electricity, then no group.
    expect(expenses?.rows.map((row) => [row.kind, row.id, row.amount, row.share])).toEqual([
      ['GROUP', groups.ZS70, '1300000.00', '98.5'],
      ['NONE', null, '20000.00', '1.5'],
    ]);
    const management = expenses?.rows[0];
    expect(
      management?.children.map((row) => [row.id, row.amount, row.previous, row.lastYear]),
    ).toEqual([
      [groups.ZS7010, '1000000.00', '0.00', '900000.00'],
      [groups.ZS7020, '300000.00', '250000.00', '0.00'],
    ]);
    expect(management?.children[1]?.children).toEqual([
      expect.objectContaining({
        kind: 'ACCOUNT',
        id: ids['702098'],
        code: '702098',
        name: 'Цахилгааны зардал ЗС',
        amount: '300000.00',
        share: '22.7',
      }),
    ]);
    // Neither the cost line, nor 520202, nor the other income or the tax is an expense row.
    const codes = flat(expenses?.rows ?? []).map((row) => row.code);
    for (const code of ['610101', '520202', '511020', '910101']) expect(codes).not.toContain(code);
    expect(expenses?.rows[1]?.children.map((row) => row.code)).toEqual(['730101']);

    // The trend carries the net profit of each month.
    expect(report.trend.at(-1)?.netProfit).toBe('-1170000.00');
    expect(report.trend.at(-2)?.netProfit).toBe('-250000.00');
  });

  it('reads a quarter and a closed year with both comparisons', async () => {
    const quarter = await board({ kind: 'quarter', period: `${y2}-Q2` });
    expect(quarter.results?.current).toMatchObject({
      otherIncome: '200000.00',
      expenses: '1570000.00',
      tax: '50000.00',
      netProfit: '-1420000.00',
    });
    expect(quarter.results?.previous.expenses).toBe('0.00');
    expect(quarter.results?.lastYear.expenses).toBe('900000.00');
    // The year close of December does not zero the year.
    const closed = await board({ kind: 'year', period: y2 });
    expect(closed.results?.current).toMatchObject({
      otherIncome: '200000.00',
      expenses: '1570000.00',
      tax: '50000.00',
    });
    expect(closed.results?.previous.expenses).toBe('900000.00');
    expect(closed.results?.lastYear.expenses).toBe('900000.00');
    const q4 = await board({ kind: 'quarter', period: `${y2}-Q4` });
    expect(q4.results?.current).toMatchObject({ expenses: '0.00', otherIncome: '0.00' });
    expect(q4.expenses?.lines).toBe(0);
  });

  it('lists the entries behind a row, newest first', async () => {
    const period = { kind: 'month', period: `${y2}-06` };
    const account = await entries({ ...period, rowKind: 'ACCOUNT', id: ids['702098'] });
    expect(account).toMatchObject({ from: `${y2}-06-01`, to: `${y2}-06-30`, more: false });
    expect(account.rows).toEqual([
      expect.objectContaining({
        date: `${y2}-06-10`,
        description: 'Цахилгааны төлбөр ЗС',
        accountCode: '702098',
        amount: '300000.00',
      }),
    ]);
    expect(account.rows[0]?.number).toBeTruthy();
    const group = await entries({ ...period, rowKind: 'GROUP', id: groups.ZS70 });
    expect(group.rows.map((row) => [row.date, row.accountCode])).toEqual([
      [`${y2}-06-12`, '701098'],
      [`${y2}-06-10`, '702098'],
    ]);
    expect(group.total).toBe('1300000.00');
    const ungrouped = await entries({ ...period, rowKind: 'NONE' });
    expect(ungrouped.rows.map((row) => row.accountCode)).toEqual(['730101']);
  });

  it('nets a reversal out on its own date', async () => {
    const report = await board({ kind: 'month' });
    expect(flat(report.expenses?.rows ?? []).map((row) => row.code)).not.toContain('710198');
    const transport = await entries({ kind: 'month', rowKind: 'ACCOUNT', id: ids['710198'] });
    expect(transport.rows.map((row) => row.amount).sort()).toEqual(['-80000.00', '80000.00']);
    expect(transport.total).toBe('0.00');
  });

  it('keeps a branch’s expenses apart from the branch-less «Нийтлэг» ones', async () => {
    const all = await board({ kind: 'month' });
    expect(all.expenses?.common).toBeNull();
    const ours = await board({ kind: 'month', branchId });
    const rows = flat(ours.expenses?.rows ?? []).filter((row) => row.kind === 'ACCOUNT');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.code?.startsWith('7302')).toBe(true);
    expect(d(ours.expenses?.total.current).gt(0)).toBe(true);
    expect(ours.results?.current.expenses).toBe(ours.expenses?.total.current);
    expect(d(ours.expenses?.common?.current).gte(25000)).toBe(true);
    // The issue's lines carry our branch; the common ones none.
    const issueCode = rows[0]?.code ?? '';
    const issued = await entries({
      kind: 'month',
      branchId,
      rowKind: 'ACCOUNT',
      id: (await financeApi(app, accountant).account(issueCode)).id,
    });
    expect(issued.rows.length).toBeGreaterThan(0);
    for (const row of issued.rows) expect(row.branchId).toBe(branchId);
    const common = await entries({ kind: 'month', branchId, rowKind: 'COMMON' });
    expect(common.rows.every((row) => row.branchId === null)).toBe(true);
    expect(common.rows.map((row) => row.description)).toContain('Нийтлэг зардал ЗС');
    expect(common.total).toBe(ours.expenses?.common?.current);
  });

  it('hides the books under a source filter', async () => {
    const wholesale = await board({ kind: 'month', period: `${y2}-06`, source: 'WHOLESALE' });
    expect(wholesale.results).toBeNull();
    expect(wholesale.expenses).toBeNull();
    expect(wholesale.trend.every((point) => point.netProfit === null)).toBe(true); // The entries behind a row agree: none under a source filter.
    for (const source of ['WHOLESALE', 'POS']) {
      expect(
        await entries({
          kind: 'month',
          period: `${y2}-06`,
          source,
          rowKind: 'ACCOUNT',
          id: ids['702098'],
        }),
      ).toEqual({ from: `${y2}-06-01`, to: `${y2}-06-30`, rows: [], more: false, total: '0.00' });
    }
    expect(
      (
        await entries({
          kind: 'month',
          period: `${y2}-06`,
          source: 'ALL',
          rowKind: 'ACCOUNT',
          id: ids['702098'],
        })
      ).rows,
    ).toHaveLength(1);
  });
});
