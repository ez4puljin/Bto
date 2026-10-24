import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, type InvoiceJson, moveInvoiceDue, salesFlow } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { posStore, saleDoc, saleEvent } from '../harness/pos';

interface Compared {
  current: string | null;
  previous: string | null;
  lastYear: string | null;
}
interface DashboardJson {
  month: string;
  running: boolean;
  margins: boolean;
  sales: Compared;
  wholesale: string;
  pos: string;
  returns: string;
  grossProfit: Compared | null;
  margin: Compared | null;
  receivables: Compared;
  overdue: string;
  stockValue: Compared | null;
  turnoverDays: number | null;
  trend: { month: string; sales: string; grossProfit: string | null }[];
  categories: { categoryId: number | null; sales: string; margin: string | null }[];
  alerts: {
    overdue: { customerId: number | null }[];
    fallingCategories: { categoryId: number | null }[];
    topRep: { userId: number; sales: string } | null;
  };
}
interface ProfitRowJson {
  kind: string;
  id: number | null;
  name: string | null;
  qty: string | null;
  sales: string;
  returns: string;
  cost: string;
  profit: string;
  margin: string | null;
  flagged: boolean;
}

const d = (value: string | null | undefined) => new Decimal(value ?? '0');
/** Ex-VAT, ex-city-tax amount of a document. */
const net = (doc: { total: string; vatTotal: string; cityTaxTotal?: string }) =>
  d(doc.total).minus(d(doc.vatTotal)).minus(d(doc.cityTaxTotal));

/**
 * Management reports (ADR-0108): the daily totals and their refresh, the dashboard against the
 * same days a month and a year earlier, profitability with the documents behind it, receivables
 * aging by due date, stock turnover and slow movers, the supplier report, and the rights. The
 * database is shared with other files, so the dashboard is checked by the change our documents
 * make. Fictitious data only.
 */
describe('management reports', () => {
  let app: NestExpressApplication;
  let migrator: Client;
  let appSql: Client;
  let admin: string;
  let accountant: string;
  let viewer: string;
  let office: string;
  let repUserId: number;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let milk: ProductJson;
  let tea: ProductJson;
  let dusty: ProductJson;
  let shop: { id: number; name: string };
  let invoice: InvoiceJson;
  let creditNet: Decimal;
  let creditTotal: Decimal;
  let posNet: Decimal;
  let before: DashboardJson;
  const today = businessDate();
  const month = today.slice(0, 7);
  const from = `${month}-01`;
  const http = () => request(app.getHttpServer());
  const get = (token: string, path: string, query: Record<string, unknown> = {}) =>
    http().get(`/api/v1/reports${path}`).query(query).set(bearer(token));
  const refresh = async () => {
    await appSql.query('SELECT reporting.refresh_sales()');
  };
  const dashboard = async (token = accountant) =>
    (await get(token, '/dashboard', { month }).expect(200)).body as DashboardJson;

  beforeAll(async () => {
    app = await createHttpApp();
    migrator = await connectAs('migrator');
    appSql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    accountant = await token('ACCOUNTANT');
    office = await token('OFFICE');
    viewer = await customRoleUser(app, admin, ['reports.view']);
    // The store sets the company's VAT settings for today (posStore).
    const store = await posStore(app, admin, 'RQ');
    flow = await salesFlow(app, admin, 'RP');
    milk = await flow.product('9301', 'Сүү РП', '1000', '100');
    tea = await flow.product('9302', 'Цай РП', '2000', '50');
    dusty = await flow.product('9303', 'Тоостой бараа РП', '1500', '7');
    shop = await partnersApi(app, admin).customer({ name: 'Тайлангийн дэлгүүр РП' });
    const rep = await seedUser(app, { roles: ['ADMIN'] });
    repUserId = rep.id;
    await refresh();
    before = await dashboard();

    // A sale by the order's author `rep`, a credit note of two pieces, a till sale.
    const draft = await flow.draft(shop.id, [
      { productUnitId: flow.pcs(milk), qty: '10' },
      { productUnitId: flow.pcs(tea), qty: '5' },
    ]);
    // The order's author: re-own the draft as the rep (the harness creates it as the admin).
    await migrator.query('UPDATE sales_orders SET created_by = $2 WHERE id = $1', [
      draft.id,
      rep.id,
    ]);
    await flow.sell(draft.id);
    const finance = financeApi(app, accountant);
    const found = await finance.invoiceOfOrder(draft.id);
    if (!found) throw new Error('no invoice');
    invoice = found;
    const milkLine = invoice.lines?.find((line) => line.productId === milk.id);
    if (!milkLine) throw new Error('no milk line');
    const note = (
      await finance
        .creditNote({
          invoiceId: invoice.id,
          reason: 'Тайлангийн буцаалт',
          warehouseId: flow.wh.id,
          lines: [{ invoiceLineId: milkLine.id, qty: '2' }],
        })
        .expect(201)
    ).body as { total: string; vatTotal: string; cityTaxTotal: string };
    creditNet = net(note);
    creditTotal = d(note.total);

    const cola = await store.product('9311', 'Кола РП', '1000', '10');
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

  it('keeps the reports to their rights and hides costs without reports.margins.view', async () => {
    await get(office, '/dashboard').expect(403);
    await get(viewer, '/profit', { by: 'customer', from, to: today }).expect(403);
    await get(viewer, '/suppliers', { from, to: today }).expect(403);
    const seen = await dashboard(viewer);
    expect(seen).toMatchObject({
      margins: false,
      grossProfit: null,
      margin: null,
      stockValue: null,
    });
    expect(seen.trend.every((point) => point.grossProfit === null)).toBe(true);
    expect(seen.categories.every((row) => row.margin === null)).toBe(true);
    expect(seen.alerts.fallingCategories).toEqual([]);
    const documents = (
      await get(viewer, '/sales-documents', { from, to: today, customerId: shop.id }).expect(200)
    ).body as { rows: { cost: string | null }[] };
    expect(documents.rows.every((row) => row.cost === null)).toBe(true);
    const stock = (await get(viewer, '/stock', { q: '9301' }).expect(200)).body as {
      rows: { value: string | null }[];
      totals: { value: string | null };
    };
    expect(stock.rows[0]?.value).toBeNull();
    expect(stock.totals.value).toBeNull();
  });

  it('counts sales ex-VAT net of returns, with the cost the ledger booked out', async () => {
    const report = (
      await get(accountant, '/profit', {
        by: 'customer',
        from,
        to: today,
        customerId: shop.id,
      }).expect(200)
    ).body as {
      rows: ProfitRowJson[];
      totals: { sales: string; cost: string; profit: string };
      threshold: string;
    };
    const sales = net(invoice).minus(creditNet);
    // 10 milk + 5 tea at 700 out, 2 milk back at 700.
    const cost = new Decimal(13 * 700);
    expect(report.rows).toEqual([
      expect.objectContaining({
        kind: 'CUSTOMER',
        id: shop.id,
        name: shop.name,
        sales: sales.toFixed(2),
        returns: creditNet.toFixed(2),
        cost: cost.toFixed(2),
        profit: sales.minus(cost).toFixed(2),
      }),
    ]);
    expect(report.threshold).toBe('8.0');
    const byProduct = (
      await get(accountant, '/profit', {
        by: 'product',
        from,
        to: today,
        customerId: shop.id,
      }).expect(200)
    ).body as { rows: ProfitRowJson[] };
    expect(byProduct.rows.map((row) => [row.id, row.qty])).toEqual(
      expect.arrayContaining([
        [milk.id, '8'],
        [tea.id, '5'],
      ]),
    );
    const byRep = (
      await get(accountant, '/profit', { by: 'rep', from, to: today, customerId: shop.id }).expect(
        200,
      )
    ).body as { rows: ProfitRowJson[] };
    expect(byRep.rows).toEqual([
      expect.objectContaining({ kind: 'USER', id: repUserId, sales: sales.toFixed(2) }),
    ]);

    // The documents behind the figure: the invoice and its credit note.
    const documents = (
      await get(accountant, '/sales-documents', { from, to: today, customerId: shop.id }).expect(
        200,
      )
    ).body as { rows: { kind: string; id: number; sales: string; cost: string | null }[] };
    expect(documents.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'INVOICE',
          id: invoice.id,
          sales: net(invoice).toFixed(2),
          cost: '10500.00',
        }),
        expect.objectContaining({
          kind: 'CREDIT_NOTE',
          sales: creditNet.negated().toFixed(2),
          cost: '-1400.00',
        }),
      ]),
    );
    expect(documents.rows).toHaveLength(2);
  });

  it('flags a margin only under the threshold', async () => {
    const report = (
      await get(accountant, '/profit', {
        by: 'product',
        from,
        to: today,
        customerId: shop.id,
      }).expect(200)
    ).body as { rows: ProfitRowJson[] };
    for (const row of report.rows) {
      const margin = d(row.profit).div(d(row.sales)).times(100);
      expect(row.margin).toBe(margin.toFixed(1));
      expect(row.flagged).toBe(margin.lt(8));
    }
  });

  it('moves the dashboard by our documents, against the same days a month and a year earlier', async () => {
    const after = await dashboard();
    const wholesale = net(invoice).minus(creditNet);
    expect(after).toMatchObject({ month, running: true, margins: true });
    expect(d(after.sales.current).minus(d(before.sales.current)).toFixed(2)).toBe(
      wholesale.plus(posNet).toFixed(2),
    );
    expect(d(after.wholesale).minus(d(before.wholesale)).toFixed(2)).toBe(wholesale.toFixed(2));
    expect(d(after.pos).minus(d(before.pos)).toFixed(2)).toBe(posNet.toFixed(2));
    expect(d(after.returns).minus(d(before.returns)).toFixed(2)).toBe(creditNet.toFixed(2));
    // Cost: 13 pieces net at 700 wholesale, 2 at the till's 700.
    const profitDelta = wholesale.plus(posNet).minus(15 * 700);
    expect(d(after.grossProfit?.current).minus(d(before.grossProfit?.current)).toFixed(2)).toBe(
      profitDelta.toFixed(2),
    );
    // Nothing of ours a month or a year ago.
    expect(after.sales.previous).toBe(before.sales.previous);
    expect(after.sales.lastYear).toBe(before.sales.lastYear);
    // The invoice's open amount is in the receivables.
    expect(d(after.receivables.current).minus(d(before.receivables.current)).toFixed(2)).toBe(
      d(invoice.total).minus(creditTotal).toFixed(2),
    );
    expect(after.trend).toHaveLength(12);
    expect(after.trend[11]?.month).toBe(month);
    expect(d(after.trend[11]?.sales).toFixed(2)).toBe(d(after.sales.current).toFixed(2));
    expect(after.categories.length).toBeGreaterThan(0);
    expect(after.alerts.topRep).not.toBeNull();
    // The month before ours compares whole months.
    const past = (
      await get(accountant, '/dashboard', { month: addDays(from, -1).slice(0, 7) }).expect(200)
    ).body as DashboardJson;
    expect(past.running).toBe(false);
    await get(accountant, '/dashboard', { month: '2999-01' }).expect(422);
    const xlsx = await get(accountant, '/dashboard.xlsx', { month }).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('ages the receivables from their due dates', async () => {
    await moveInvoiceDue(migrator, invoice.id, {
      invoiceDate: addDays(today, -50),
      dueDate: addDays(today, -45),
    });
    const report = (await get(viewer, '/aging', { q: 'Тайлангийн дэлгүүр' }).expect(200)).body as {
      rows: {
        partyId: number;
        customerId: number | null;
        buckets: Record<string, string>;
        overdue: string;
      }[];
    };
    const row = report.rows.find((entry) => entry.customerId === shop.id);
    if (!row) throw new Error('no aging row');
    // The credit note settled part of the invoice.
    expect(row.buckets.D31_60).toBe(d(invoice.total).minus(creditTotal).toFixed(2));
    expect(row.buckets.NOT_DUE).toBe('0.00');
    expect(row.overdue).toBe(row.buckets.D31_60);
    const items = (await get(viewer, `/aging/${row.partyId}/items`).expect(200)).body as {
      data: {
        invoiceId: number | null;
        daysOverdue: number | null;
        bucket: string | null;
        side: string;
      }[];
    };
    expect(items.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          side: 'DEBIT',
          invoiceId: invoice.id,
          daysOverdue: 45,
          bucket: 'D31_60',
        }),
      ]),
    );
    const overdueOnly = (
      await get(viewer, '/aging', { q: 'Тайлангийн дэлгүүр', overdueOnly: 'true' }).expect(200)
    ).body as { rows: unknown[] };
    expect(overdueOnly.rows.length).toBeGreaterThan(0);
    const xlsx = await get(viewer, '/aging.xlsx').expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    // The dashboard sees the store overdue.
    const after = await dashboard();
    expect(after.alerts.overdue.length).toBeGreaterThan(0);
    expect(d(after.overdue).gt(0)).toBe(true);
  });

  it('reports stock cover and slow movers', async () => {
    const report = (await get(accountant, '/stock', { q: 'РП', slowDays: 90 }).expect(200))
      .body as {
      rows: {
        productId: number;
        onHand: string;
        soldQty: string;
        slow: boolean;
        value: string | null;
      }[];
      totals: { slowProducts: number };
    };
    const milkRow = report.rows.find((row) => row.productId === milk.id);
    const dustyRow = report.rows.find((row) => row.productId === dusty.id);
    // 100 in, 10 out, 2 back into RETURNS.
    expect(milkRow).toMatchObject({
      onHand: '92',
      soldQty: '8',
      slow: false,
      value: (92 * 700).toFixed(2),
    });
    expect(dustyRow).toMatchObject({ onHand: '7', soldQty: '0', slow: true });
    const slow = (await get(accountant, '/stock', { q: 'РП', filter: 'SLOW' }).expect(200))
      .body as {
      rows: { productId: number }[];
    };
    expect(slow.rows.map((row) => row.productId)).toContain(dusty.id);
    expect(slow.rows.map((row) => row.productId)).not.toContain(milk.id);
    await get(accountant, '/stock', { slowDays: 45 }).expect(422);
    const page = (await get(accountant, '/stock', { q: 'РП', limit: 1 }).expect(200)).body as {
      nextOffset: number | null;
    };
    expect(page.nextOffset).toBe(1);
    expect(
      (await get(accountant, '/stock.xlsx', { q: 'РП' }).expect(200)).headers['content-type'],
    ).toContain('spreadsheetml');
  });

  it('sums the suppliers’ purchases, other bills, payments and balance', async () => {
    const supplierId = (
      await partnersApi(app, admin).supplier({ name: 'Тайлангийн нийлүүлэгч РП', vatPayer: true })
    ).id;
    const catalog = catalogApi(app, admin);
    const water = await catalog.product({
      sku: '9321',
      name: 'Ус РП',
      categoryId: await catalog.category('Ус РП'),
      baseUomId: await catalog.uomId('PCS'),
    });
    await inventoryApi(app, admin).setHome(water.id, flow.wh.id);
    const draft = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId,
          supplierDocDate: today,
          lines: [
            { productUnitId: unitOf(water, 'PCS').id, enteredQty: '10', docUnitPrice: '1100' },
          ],
        })
        .expect(201)
    ).body as { id: number };
    await http()
      .post(`/api/v1/receipts/${draft.id}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    const finance = financeApi(app, accountant);
    const payable = await finance.account('310101');
    const cash = await finance.account('100101');
    const box = await financeApi(app, admin).cashBox('RP-CASH');
    await finance
      .journal({
        entryDate: today,
        description: 'Нийлүүлэгчид төлөв РП',
        lines: [
          { accountId: payable.id, debit: '4000', supplierId },
          { accountId: cash.id, credit: '4000', moneyAccountId: box.id },
        ],
      })
      .expect(201);
    const report = (
      await get(accountant, '/suppliers', { from, to: today, q: 'Тайлангийн нийлүүлэгч' }).expect(
        200,
      )
    ).body as {
      rows: {
        supplierId: number | null;
        partyId: number;
        purchases: string;
        purchasesExVat: string;
        payments: string;
        balance: string;
      }[];
    };
    const row = report.rows.find((entry) => entry.supplierId === supplierId);
    expect(row).toMatchObject({
      purchases: '11000.00',
      purchasesExVat: '10000.00',
      payments: '4000.00',
      balance: '7000.00',
    });
    const entries = (
      await get(accountant, `/suppliers/${row?.partyId ?? 0}/entries`, { from, to: today }).expect(
        200,
      )
    ).body as { data: { kind: string; receiptId: number | null; amount: string }[] };
    expect(entries.data).toEqual([
      expect.objectContaining({ kind: 'PURCHASE', receiptId: draft.id, amount: '11000.00' }),
      expect.objectContaining({ kind: 'PAYMENT', receiptId: null, amount: '-4000.00' }),
    ]);
    expect(
      (await get(accountant, '/suppliers.xlsx', { from, to: today }).expect(200)).headers[
        'content-type'
      ],
    ).toContain('spreadsheetml');
  });

  it('rebuilds the totals on «Шинэчлэх» at most once a minute', async () => {
    await refresh();
    const state = (await get(viewer, '/refresh-state').expect(200)).body as { refreshedAt: string };
    const again = (await http().post('/api/v1/reports/refresh').set(bearer(viewer)).expect(200))
      .body as {
      refreshedAt: string;
    };
    // Younger than a minute: kept.
    expect(again.refreshedAt).toBe(state.refreshedAt);
    await migrator.query(
      "UPDATE reporting.refresh_state SET refreshed_at = now() - interval '5 minutes' WHERE id = 1",
    );
    const fresh = (await http().post('/api/v1/reports/refresh').set(bearer(viewer)).expect(200))
      .body as {
      refreshedAt: string;
    };
    expect(Date.parse(fresh.refreshedAt)).toBeGreaterThan(Date.parse(state.refreshedAt) - 1);
    expect(fresh.refreshedAt).not.toBe(state.refreshedAt);
    // app may run the refresh but never write the totals or their state itself.
    await expect(
      appSql.query('REFRESH MATERIALIZED VIEW reporting.mv_sales_daily'),
    ).rejects.toThrow();
    await expect(
      appSql.query('UPDATE reporting.refresh_state SET duration_ms = 0'),
    ).rejects.toThrow();
  });
});
