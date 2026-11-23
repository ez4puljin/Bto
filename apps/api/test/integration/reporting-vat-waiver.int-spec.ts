import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson } from '../harness/catalog';
import { financeApi, salesFlow, setSetting } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface Figures {
  sales: string;
  cost: string;
  profit: string;
}
interface ResultJson {
  otherIncome: string;
  vatWaiverDiscounts: string;
  expenses: string;
  operatingProfit: string;
  tax: string;
  netProfit: string;
}
interface ExpenseRowJson {
  code: string | null;
  amount: string;
  children: ExpenseRowJson[];
}
interface VatWaivedJson {
  count: number;
  total: string;
  vat: string;
  discount: string;
  wholesaleTotal: string;
  wholesaleWaived: string;
  share: string | null;
}
type Periods<T> = { current: T; previous: T; lastYear: T };
const PERIODS = ['current', 'previous', 'lastYear'] as const;
interface BoardJson {
  kind: string;
  totals: Periods<Figures>;
  discounts: Periods<string> | null;
  results: Periods<ResultJson> | null;
  expenses: { rows: ExpenseRowJson[]; total: Periods<string>; lines: number } | null;
  vatWaived: VatWaivedJson | null;
  trend: (Figures & { period: string; netProfit: string | null })[];
}
interface LedgerRow {
  account_code: string;
  account_kind: string;
  amount: string;
  is_reversal: boolean;
  entry_date: string;
}

const d = (value: string | null | undefined) => new Decimal(value ?? '0');
const diff = (after: string | null | undefined, before: string | null | undefined) =>
  d(after).minus(d(before)).toFixed(2);

/**
 * «Ашгийн самбар» counts the discounts of «НӨАТ хасуулах» (ADR-0241, over ADR-0240 and ADR-0238):
 * by their documents, once, as a step of their own that lowers the operating and net profit,
 * whatever the customer's counter account — the default 520201 (the sales row the board never
 * reads), a class-7 expense account (left out of the expense tree), or a plain liability account
 * the books' view does not carry (the waiver's own row stands in). A reversal nets out on its own
 * date; the information card «НӨАТ аваагүй борлуулалт»; the three period kinds; the source and
 * branch filters; the right. The waivers are dated today, so every figure is read as the change
 * the waivers made against the board read just before them (one database per Jest worker, the
 * files of a worker one after another). Fictitious data.
 */
describe('profit board: VAT waiver discounts', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let waiverUser: string;
  let viewer: string;
  let branchId: number;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let tea: ProductJson;
  const today = businessDate();
  const waiverIds: Record<string, number> = {};
  const invoices: Record<string, { id: number; total: string; vatTotal: string }> = {};
  const before: Record<string, BoardJson> = {};
  const after: Record<string, BoardJson> = {};
  const queries: Record<string, Record<string, unknown>> = {
    month: { kind: 'month' },
    quarter: { kind: 'quarter' },
    year: { kind: 'year' },
  };
  const http = () => request(app.getHttpServer());
  const get = (token: string, query: Record<string, unknown>) =>
    http().get('/api/v1/reports/profit-board').query(query).set(bearer(token));
  const board = async (query: Record<string, unknown>) =>
    (await get(accountant, query).expect(200)).body as BoardJson;
  const flat = (rows: readonly ExpenseRowJson[]): ExpenseRowJson[] =>
    rows.flatMap((row) => [row, ...flat(row.children)]);
  const ledgerOf = async (waiverId: number) =>
    (
      await sql.query<LedgerRow>(
        `SELECT account_code, account_kind, amount::text, is_reversal, entry_date::text
           FROM reporting.ledger_lines
          WHERE source_doc_type = 'VAT_WAIVER' AND source_doc_id = $1::text
          ORDER BY line_id`,
        [waiverId],
      )
    ).rows;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    waiverUser = await customRoleUser(app, admin, ['finance.read', 'finance.vat_waiver.manage']);
    viewer = await customRoleUser(app, admin, ['reports.view']);
    const admins = financeApi(app, admin);
    // A VAT payer at 10 %, so the waived sales carry VAT.
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    flow = await salesFlow(app, admin, 'NB');
    branchId = flow.wh.branchId;
    tea = await flow.product('8711', 'Цай НБ', '1000', '200');

    // Three customers: the default 520201, a class-7 expense account, a plain liability account.
    const partners = partnersApi(app, admin);
    const plain = await partners.customer({ name: 'Энгийн дэлгүүр НБ' });
    const expensed = await partners.customer({ name: 'Зардлын данстай дэлгүүр НБ' });
    const liable = await partners.customer({ name: 'Өглөгийн данстай дэлгүүр НБ' });
    const expense = (
      await admins
        .createAccount({ code: '730198', name: 'Хөнгөлөлтийн зардал НБ', kind: 'EXPENSE' })
        .expect(201)
    ).body as { id: number };
    const liability = (
      await admins
        .createAccount({ code: '390198', name: 'Хөнгөлөлтийн өглөг НБ', kind: 'LIABILITY' })
        .expect(201)
    ).body as { id: number };
    const counter = (customerId: number, accountId: number) =>
      http()
        .put(`/api/v1/customer-balances/${customerId}/counter-account`)
        .set(bearer(admin))
        .send({ accountId })
        .expect(200);
    await counter(expensed.id, expense.id);
    await counter(liable.id, liability.id);

    const sell = async (key: string, customerId: number, qty: string) => {
      const draft = await flow.draft(customerId, [{ productUnitId: flow.pcs(tea), qty }]);
      await flow.sell(draft.id);
      const invoice = await financeApi(app, accountant).invoiceOfOrder(draft.id);
      if (!invoice) throw new Error('no invoice');
      invoices[key] = invoice;
    };
    await sell('plain', plain.id, '10');
    await sell('expensed', expensed.id, '5');
    await sell('liable', liable.id, '3');
    await sell('undone', plain.id, '4');
    await sell('liableUndone', liable.id, '2');

    // The board with every sale made and no waiver yet.
    for (const [name, query] of Object.entries(queries)) before[name] = await board(query);
    before.branch = await board({ kind: 'month', branchId });

    // Other documents on the same accounts, today, beside the waivers: a manual expense on the
    // class-7 account that also carries a waiver, other income, and a manual 520201 line.
    const books = financeApi(app, accountant);
    const accountId = async (code: string) => (await books.account(code)).id;
    const [otherIncome, salesDiscount, equity] = await Promise.all(
      ['511020', '520201', '390101'].map(accountId),
    );
    const manual = (description: string, debit: number, credit: number, amount: string) =>
      books
        .journal({
          entryDate: today,
          description,
          lines: [
            { accountId: debit, debit: amount },
            { accountId: credit, credit: amount },
          ],
        })
        .expect(201);
    await manual('Гараар зардал НБ', expense.id, equity ?? 0, '7000');
    await manual('Бусад орлого НБ', equity ?? 0, otherIncome ?? 0, '3000');
    await manual('Гараар хөнгөлөлт НБ', salesDiscount ?? 0, equity ?? 0, '500');

    const waive = async (key: string) => {
      const body = (
        await http()
          .post(`/api/v1/invoices/${invoices[key]?.id}/vat-waiver`)
          .set(bearer(waiverUser))
          .set(idempotency())
          .send({})
          .expect(200)
      ).body as { vatWaiver: { id: number } | null };
      waiverIds[key] = body.vatWaiver?.id ?? 0;
    };
    const undo = (key: string) =>
      http()
        .post(`/api/v1/invoices/${invoices[key]?.id}/vat-waiver/reverse`)
        .set(bearer(waiverUser))
        .set(idempotency())
        .send({})
        .expect(200);
    for (const key of ['plain', 'expensed', 'liable', 'undone', 'liableUndone']) await waive(key);
    await undo('undone');
    await undo('liableUndone');

    for (const [name, query] of Object.entries(queries)) after[name] = await board(query);
    after.branch = await board({ kind: 'month', branchId });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('opens only with reports.margins.view', async () => {
    await get(viewer, { kind: 'month' }).expect(403);
  });

  it('finds the waivers in the books by their document, a reversal on its own date', async () => {
    // The default account 520201 is an INCOME account: the discount is its negative amount.
    expect(await ledgerOf(waiverIds.plain ?? 0)).toEqual([
      {
        account_code: '520201',
        account_kind: 'INCOME',
        amount: '-200.00',
        is_reversal: false,
        entry_date: today,
      },
    ]);
    // The class-7 account: the discount is its expense amount.
    expect(await ledgerOf(waiverIds.expensed ?? 0)).toEqual([
      expect.objectContaining({ account_code: '730198', amount: '100.00', is_reversal: false }),
    ]);
    // The liability account is neither income nor expense: the view carries no line of it.
    expect(await ledgerOf(waiverIds.liable ?? 0)).toEqual([]);
    // The reversal carries the waiver's source and nets it out on its own date.
    expect(
      (await ledgerOf(waiverIds.undone ?? 0)).map((row) => [row.amount, row.is_reversal]),
    ).toEqual([
      ['-80.00', false],
      ['80.00', true],
    ]);
  });

  it('counts every waiver once, as a step lowering the operating and net profit', () => {
    // 200 (520201) + 100 (class 7) + 60 (liability); the two reversed ones net out.
    for (const name of ['month', 'quarter', 'year']) {
      const was = before[name];
      const now = after[name];
      expect(
        diff(now?.results?.current.vatWaiverDiscounts, was?.results?.current.vatWaiverDiscounts),
      ).toBe('360.00');
      // The sales lines' figures do not move; the other documents on the same accounts count
      // where they did before (7,000 expense, 3,000 other income; the manual 520201 line nowhere),
      // the waivers' lines nowhere but in their step.
      expect(now?.totals).toEqual(was?.totals);
      expect(now?.discounts).toEqual(was?.discounts);
      expect(diff(now?.results?.current.expenses, was?.results?.current.expenses)).toBe('7000.00');
      expect(diff(now?.results?.current.otherIncome, was?.results?.current.otherIncome)).toBe(
        '3000.00',
      );
      expect(now?.results?.current.tax).toBe(was?.results?.current.tax);
      // 3,000 − 360 − 7,000.
      expect(
        diff(now?.results?.current.operatingProfit, was?.results?.current.operatingProfit),
      ).toBe('-4360.00');
      expect(diff(now?.results?.current.netProfit, was?.results?.current.netProfit)).toBe(
        '-4360.00',
      );
      expect(diff(now?.trend.at(-1)?.netProfit, was?.trend.at(-1)?.netProfit)).toBe('-4360.00');
      // The comparisons hold no waiver of today.
      for (const key of ['previous', 'lastYear'] as const) {
        expect(now?.results?.[key]).toEqual(was?.results?.[key]);
      }
      // Operating = gross + supplier discounts + other income − waivers − expenses; net = − tax.
      for (const key of PERIODS) {
        const result = now?.results?.[key];
        expect(result?.operatingProfit).toBe(
          d(now?.totals[key].profit)
            .plus(d(now?.discounts?.[key]))
            .plus(d(result?.otherIncome))
            .minus(d(result?.vatWaiverDiscounts))
            .minus(d(result?.expenses))
            .toFixed(2),
        );
        expect(result?.netProfit).toBe(d(result?.operatingProfit).minus(d(result?.tax)).toFixed(2));
      }
    }
  });

  it('keeps the class-7 waiver out of the expense tree, whose total stays «Урсгал зардал»', async () => {
    const now = after.month;
    const rows = flat(now?.expenses?.rows ?? []);
    // The class-7 account stands in the tree with its manual expense only, never the waiver's 100.
    expect(rows.filter((row) => row.code === '730198').map((row) => row.amount)).toEqual([
      '7000.00',
    ]);
    expect(rows.map((row) => row.code)).not.toContain('520201');
    expect(diff(now?.expenses?.total.current, before.month?.expenses?.total.current)).toBe(
      '7000.00',
    );
    expect((now?.expenses?.lines ?? 0) - (before.month?.expenses?.lines ?? 0)).toBe(1);
    expect(now?.expenses?.total.current).toBe(now?.results?.current.expenses);
    // Nor do the expense entries behind the account list the waiver: only the manual line.
    const listed = (
      await http()
        .get('/api/v1/reports/profit-board/expense-entries')
        .query({ kind: 'month', rowKind: 'NONE' })
        .set(bearer(accountant))
        .expect(200)
    ).body as { rows: { accountCode: string; amount: string; description: string | null }[] };
    expect(
      listed.rows
        .filter((row) => row.accountCode === '730198')
        .map((row) => [row.amount, row.description]),
    ).toEqual([['7000.00', 'Гараар зардал НБ']]);
  });

  it('shows the sales that took no VAT receipt on the information card', () => {
    const was = before.month?.vatWaived;
    const now = after.month?.vatWaived;
    const live = ['plain', 'expensed', 'liable'].map((key) => invoices[key]);
    const sum = (pick: (row: { total: string; vatTotal: string }) => string) =>
      live.reduce((total, row) => total.plus(row ? pick(row) : 0), new Decimal(0));
    expect((now?.count ?? 0) - (was?.count ?? 0)).toBe(3);
    expect(diff(now?.total, was?.total)).toBe(sum((row) => row.total).toFixed(2));
    expect(diff(now?.vat, was?.vat)).toBe(sum((row) => row.vatTotal).toFixed(2));
    expect(diff(now?.discount, was?.discount)).toBe('360.00');
    expect(sum((row) => row.vatTotal).gt(0)).toBe(true);
    // The share is one population: the period's invoices by invoice date, the waived-now ones
    // (the two reversed ones not) in all of them — never above 100 %.
    expect(now?.wholesaleTotal).toBe(was?.wholesaleTotal);
    expect(diff(now?.wholesaleWaived, was?.wholesaleWaived)).toBe(
      sum((row) => row.total).toFixed(2),
    );
    expect(d(now?.wholesaleWaived).lte(d(now?.wholesaleTotal))).toBe(true);
    expect(now?.share).toBe(
      d(now?.wholesaleWaived).div(d(now?.wholesaleTotal)).times(100).toDecimalPlaces(1).toFixed(1),
    );
    expect(d(now?.share).lte(100)).toBe(true);
  });

  it('counts a branch’s waivers under its branch', () => {
    expect(
      diff(
        after.branch?.results?.current.vatWaiverDiscounts,
        before.branch?.results?.current.vatWaiverDiscounts,
      ),
    ).toBe('360.00');
    expect((after.branch?.vatWaived?.count ?? 0) - (before.branch?.vatWaived?.count ?? 0)).toBe(3);
  });

  it('hides the waiver step under a source filter, the card under the supermarket', async () => {
    const wholesale = await board({ kind: 'month', source: 'WHOLESALE' });
    expect(wholesale.results).toBeNull();
    expect(wholesale.vatWaived).toEqual(after.month?.vatWaived);
    const pos = await board({ kind: 'month', source: 'POS' });
    expect(pos.results).toBeNull();
    expect(pos.vatWaived).toBeNull();
  });
});
