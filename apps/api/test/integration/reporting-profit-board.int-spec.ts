import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addMonths, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, type InvoiceJson, salesFlow } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { costReceiptAsTyped, expectReconciled, postReceipt } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { posStore, saleDoc, saleEvent } from '../harness/pos';

interface Figures {
  sales: string;
  cost: string;
  profit: string;
  margin: string | null;
}
interface Range {
  from: string;
  to: string;
}
interface BoardRowJson extends Figures {
  kind: string;
  id: number | null;
  name: string | null;
  share: string | null;
  flagged: boolean;
  discount: string | null;
  profitWithDiscount: string | null;
  children: BoardRowJson[];
  own: boolean;
}
interface BoardJson {
  kind: string;
  period: string;
  running: boolean;
  current: Range;
  previous: Range;
  lastYear: Range;
  source: string;
  branchId: number | null;
  totals: { current: Figures; previous: Figures; lastYear: Figures };
  discounts: { current: string; previous: string; lastYear: string } | null;
  bonus: { lines: number; qty: string; value: string; unvalued: number } | null;
  trend: (Figures & { period: string; from: string; to: string })[];
  breakdowns: Record<
    'supplier' | 'category' | 'location' | 'rep' | 'branch',
    { rows: BoardRowJson[]; others: unknown }
  >;
  branches: { id: number; name: string }[];
}
interface ProductsJson {
  rows: (Figures & { productId: number; qty: string; unit: string | null; flagged: boolean })[];
  others: unknown;
}

const d = (value: string | null | undefined) => new Decimal(value ?? '0');
/** Ex-VAT, ex-city-tax amount of a document. */
const net = (doc: { total: string; vatTotal: string; cityTaxTotal?: string }) =>
  d(doc.total).minus(d(doc.vatTotal)).minus(d(doc.cityTaxTotal));

/**
 * «Ашгийн самбар» (ADR-0237): the totals of a month, a quarter and a year are `reports/profit`'s;
 * the period before and a year earlier; the breakdowns by main supplier («Нийлүүлэгчгүй бараа»),
 * category, warehouse, author and branch; the suppliers' discounts only in «Хөнгөлөлттэй ашиг»; free
 * goods shown, not added; the branch and source filters; the products behind a row; the right.
 * The database is shared with other files, so our documents stand in a branch of their own.
 * Fictitious data only.
 */
describe('profit board', () => {
  let app: NestExpressApplication;
  let migrator: Client;
  let appSql: Client;
  let admin: string;
  let adminId: number;
  let accountant: string;
  let viewer: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let milk: ProductJson;
  let tea: ProductJson;
  let topCategory: number;
  let teaCategory: number;
  let supplierId: number;
  let shopId: number;
  let storeBranch: number;
  let now: InvoiceJson;
  let monthAgo: InvoiceJson;
  let yearAgo: InvoiceJson;
  let posNet: Decimal;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const get = (token: string, path: string, query: Record<string, unknown> = {}) =>
    http().get(`/api/v1/reports${path}`).query(query).set(bearer(token));
  const board = async (query: Record<string, unknown>) =>
    (await get(accountant, '/profit-board', query).expect(200)).body as BoardJson;
  const profitTotals = async (range: Range, extra: Record<string, unknown> = {}) =>
    (
      (await get(accountant, '/profit', { by: 'customer', ...range, ...extra }).expect(200))
        .body as { totals: Figures & { returns: string } }
    ).totals;
  const products = async (query: Record<string, unknown>) =>
    (await get(accountant, '/profit-board/products', query).expect(200)).body as ProductsJson;
  /** Rebuilds the daily totals, waiting while another file's rebuild holds the lock. */
  const refresh = async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const { rows } = await appSql.query<{ at: Date | null }>(
        'SELECT reporting.refresh_sales() AS at',
      );
      if (rows[0]?.at) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('the daily totals were not rebuilt');
  };
  const sell = async (lines: { product: ProductJson; qty: string }[]): Promise<InvoiceJson> => {
    const draft = await flow.draft(
      shopId,
      lines.map((line) => ({ productUnitId: flow.pcs(line.product), qty: line.qty })),
    );
    await flow.sell(draft.id);
    const invoice = await financeApi(app, accountant).invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('no invoice');
    return invoice;
  };
  const figuresOf = (totals: Figures) => ({
    sales: totals.sales,
    cost: totals.cost,
    profit: totals.profit,
    margin: totals.margin,
  });

  beforeAll(async () => {
    app = await createHttpApp();
    migrator = await connectAs('migrator');
    appSql = await connectAs('app');
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    adminId = adminUser.id;
    admin = (await login(app, adminUser)).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    viewer = await customRoleUser(app, admin, ['reports.view']);
    // The store sets the company's VAT settings for today.
    const store = await posStore(app, admin, 'PBQ');
    storeBranch = store.store.branchId;
    flow = await salesFlow(app, admin, 'PBW');
    milk = await flow.product('9471', 'Сүү ПБ', '1500', '100');
    tea = await flow.product('9472', 'Цай ПБ', '2500', '50');
    shopId = (await partnersApi(app, admin).customer({ name: 'Самбарын дэлгүүр ПБ' })).id;
    // Tea in a child of the flow's category: the category row rolls it up.
    topCategory = Number((milk as { categoryId?: number }).categoryId);
    teaCategory = await catalogApi(app, admin).category('Цай ангилал ПБ', topCategory);
    await migrator.query('UPDATE products SET category_id = $2 WHERE id = $1', [
      tea.id,
      teaCategory,
    ]);

    // Milk's main supplier delivers 10 at 11,000 with VAT, 10 % off the note, and 2 free.
    supplierId = (
      await partnersApi(app, admin).supplier({ name: 'Самбарын нийлүүлэгч ПБ', vatPayer: true })
    ).id;
    await http()
      .post('/api/v1/product-suppliers')
      .set(bearer(admin))
      .send({ productId: milk.id, supplierId })
      .expect(201);
    const receipt = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId,
          supplierDocDate: today,
          lines: [
            { productUnitId: unitOf(milk, 'PCS').id, enteredQty: '10', docAmount: '11000' },
            { productUnitId: unitOf(milk, 'PCS').id, enteredQty: '2', freeGoods: true },
          ],
        })
        .expect(201)
    ).body as { id: number };
    await http()
      .put(`/api/v1/receipts/${receipt.id}/discounts`)
      .set(bearer(admin))
      .send({ discounts: [{ kind: 'NOTE', pct: '10' }] })
      .expect(200);
    await postReceipt(app, admin, receipt.id);
    await costReceiptAsTyped(app, admin, receipt.id);

    // Sales: today, a month ago and a year ago (the invoices' dates moved back).
    now = await sell([
      { product: milk, qty: '10' },
      { product: tea, qty: '5' },
    ]);
    monthAgo = await sell([{ product: milk, qty: '3' }]);
    yearAgo = await sell([{ product: tea, qty: '4' }]);
    await migrator.query('UPDATE invoices SET invoice_date = $2::date WHERE id = $1', [
      monthAgo.id,
      addMonths(today, -1),
    ]);
    await migrator.query('UPDATE invoices SET invoice_date = $2::date WHERE id = $1', [
      yearAgo.id,
      addMonths(today, -12),
    ]);

    // A till sale in the store's branch.
    const cola = await store.product('9473', 'Кола ПБ', '1000', '10');
    const shiftClientId = (await store.openShift('50000')).clientId;
    const doc = saleDoc(
      [{ product: cola, qty: '2' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
        tenders: [{ kind: 'CASH', amount: '2600.00', tendered: '5000' }],
      },
      store.retailPrice,
    );
    const [outcome] = await store.replay([saleEvent(doc)]);
    expect(outcome).toMatchObject({ status: 'APPLIED' });
    const sale = await store.pos.sale(outcome?.id ?? 0);
    posNet = d(sale.total).minus(d(sale.vatTotal));
    await refresh();
  });
  afterAll(async () => {
    await expectReconciled(app);
    await migrator.end();
    await appSql.end();
    await app.close();
  });

  it('opens only with reports.margins.view and refuses a period that is not one', async () => {
    await get(viewer, '/profit-board', { kind: 'month' }).expect(403);
    await get(viewer, '/profit-board/products', {
      kind: 'month',
      dimension: 'rep',
      rowKind: 'POS',
    }).expect(403);
    await get(accountant, '/profit-board', { kind: 'month', period: '2026-Q1' }).expect(422);
    await get(accountant, '/profit-board', { kind: 'quarter', period: '2999-Q1' }).expect(422);
    await get(accountant, '/profit-board', { kind: 'week' }).expect(422);
    await get(accountant, '/profit-board/products', {
      kind: 'month',
      dimension: 'supplier',
      rowKind: 'USER',
      id: 1,
    }).expect(422);
  });

  it('totals a month, a quarter and a year as reports/profit does, with both comparisons', async () => {
    for (const kind of ['month', 'quarter', 'year']) {
      const report = await board({ kind });
      expect(report).toMatchObject({ kind, running: true, source: 'ALL', branchId: null });
      expect(report.current.to).toBe(today);
      for (const which of ['current', 'previous', 'lastYear'] as const) {
        expect(report.totals[which]).toEqual(figuresOf(await profitTotals(report[which])));
      }
      expect(report.trend).toHaveLength(kind === 'month' ? 12 : kind === 'quarter' ? 8 : 5);
      const last = report.trend.at(-1);
      expect(last?.period).toBe(report.period);
      expect(last?.sales).toBe(report.totals.current.sales);
      // An ended period compares whole periods.
      const before = report.trend.at(-2)?.period;
      const ended = await board({ kind, period: before });
      expect(ended.running).toBe(false);
      expect(ended.totals.current).toEqual(figuresOf(await profitTotals(ended.current)));
    }
  });

  it('compares our branch with the period before and a year earlier', async () => {
    const report = await board({ kind: 'month', branchId: flow.wh.branchId });
    expect(report.branches.map((branch) => branch.id)).toContain(flow.wh.branchId);
    expect(report.totals.current.sales).toBe(net(now).toFixed(2));
    expect(report.totals.previous.sales).toBe(net(monthAgo).toFixed(2));
    expect(report.totals.lastYear.sales).toBe(net(yearAgo).toFixed(2));
    for (const which of ['current', 'previous', 'lastYear'] as const) {
      expect(report.totals[which]).toEqual(
        figuresOf(await profitTotals(report[which], { customerId: shopId })),
      );
    }
    const trend = report.trend.at(-2);
    expect(trend?.period).toBe(addMonths(today, -1).slice(0, 7));
    expect(d(trend?.sales).gte(net(monthAgo))).toBe(true);
  });

  it('breaks the profit down by main supplier with its discounts kept out of the gross profit', async () => {
    const report = await board({ kind: 'month', branchId: flow.wh.branchId });
    const milkTotals = await profitTotals(report.current, { productId: milk.id });
    const teaTotals = await profitTotals(report.current, { productId: tea.id });
    const rows = report.breakdowns.supplier.rows;
    // 1,100 off the note with VAT is 1,000 of income: only «Хөнгөлөлттэй ашиг» carries it.
    expect(rows.find((row) => row.kind === 'SUPPLIER' && row.id === supplierId)).toMatchObject({
      sales: milkTotals.sales,
      cost: milkTotals.cost,
      profit: milkTotals.profit,
      discount: '1000.00',
      profitWithDiscount: d(milkTotals.profit).plus(1000).toFixed(2),
    });
    expect(rows.find((row) => row.kind === 'NONE')).toMatchObject({
      sales: teaTotals.sales,
      profit: teaTotals.profit,
      discount: '0.00',
    });
    expect(report.discounts).toEqual({ current: '1000.00', previous: '0.00', lastYear: '0.00' });
    // The gross profit is the sales less the cost, nothing added.
    expect(report.totals.current.profit).toBe(
      d(report.totals.current.sales).minus(d(report.totals.current.cost)).toFixed(2),
    );
    const shares = rows.reduce((sum, row) => sum.plus(d(row.share)), new Decimal(0));
    expect(shares.minus(100).abs().lte('0.2')).toBe(true);
    // Two free milks at the priced line's 1,000 each: shown, never in the profit.
    expect(report.bonus).toEqual({ lines: 1, qty: '2', value: '2000.00', unvalued: 0 });
  });

  it('breaks it down by category with children, warehouse, author and branch', async () => {
    const report = await board({ kind: 'month', branchId: flow.wh.branchId });
    const { current } = report.totals;
    const category = report.breakdowns.category.rows;
    expect(category).toHaveLength(1);
    expect(category[0]).toMatchObject({ kind: 'CATEGORY', id: topCategory, sales: current.sales });
    expect(
      category[0]?.children
        .map((child) => [child.id, child.own])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual(
      [
        [topCategory, true],
        [teaCategory, false],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    expect(report.breakdowns.location.rows).toEqual([
      expect.objectContaining({ kind: 'WAREHOUSE', id: flow.wh.id, sales: current.sales }),
    ]);
    expect(report.breakdowns.rep.rows).toEqual([
      expect.objectContaining({ kind: 'USER', id: adminId, sales: current.sales }),
    ]);
    expect(report.breakdowns.branch.rows).toEqual([
      expect.objectContaining({ kind: 'BRANCH', id: flow.wh.branchId, share: '100.0' }),
    ]);
  });

  it('filters by the source: the supermarket alone in its branch, no discounts', async () => {
    const pos = await board({ kind: 'month', branchId: storeBranch, source: 'POS' });
    expect(pos.totals.current.sales).toBe(posNet.toFixed(2));
    expect(pos.discounts).toBeNull();
    expect(pos.bonus).toBeNull();
    expect(pos.breakdowns.rep.rows).toEqual([
      expect.objectContaining({ kind: 'POS', id: null, sales: posNet.toFixed(2) }),
    ]);
    const wholesale = await board({ kind: 'month', branchId: storeBranch, source: 'WHOLESALE' });
    expect(wholesale.totals.current.sales).toBe('0.00');
    const ours = await board({ kind: 'month', branchId: flow.wh.branchId, source: 'POS' });
    expect(ours.totals.current.sales).toBe('0.00');
    const all = await board({ kind: 'month', source: 'POS' });
    expect(all.totals.current).toEqual(
      figuresOf(await profitTotals(all.current, { source: 'POS' })),
    );
  });

  it('lists the products behind a row, the most profit first', async () => {
    const base = { kind: 'month', branchId: flow.wh.branchId };
    const byRep = await products({ ...base, dimension: 'rep', rowKind: 'USER', id: adminId });
    expect(byRep.rows.map((row) => [row.productId, row.qty]).sort()).toEqual(
      [
        [milk.id, '10'],
        [tea.id, '5'],
      ].sort(),
    );
    const profits = byRep.rows.map((row) => d(row.profit));
    expect(profits[0]?.gte(profits[1] ?? 0)).toBe(true);
    expect(byRep.rows[0]?.unit).not.toBeNull();
    const none = await products({ ...base, dimension: 'supplier', rowKind: 'NONE' });
    expect(none.rows.map((row) => row.productId)).toEqual([tea.id]);
    const own = await products({
      ...base,
      dimension: 'category',
      rowKind: 'CATEGORY',
      id: topCategory,
      own: true,
    });
    expect(own.rows.map((row) => row.productId)).toEqual([milk.id]);
    const whole = await products({
      ...base,
      dimension: 'category',
      rowKind: 'CATEGORY',
      id: topCategory,
    });
    expect(whole.rows).toHaveLength(2);
    const supplier = await products({
      ...base,
      dimension: 'supplier',
      rowKind: 'SUPPLIER',
      id: supplierId,
    });
    expect(supplier.rows).toEqual([expect.objectContaining({ productId: milk.id, qty: '10' })]);
    const pos = await products({
      kind: 'month',
      branchId: storeBranch,
      dimension: 'rep',
      rowKind: 'POS',
    });
    expect(pos.rows).toHaveLength(1);
  });
});
