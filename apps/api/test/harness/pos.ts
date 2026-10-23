import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { lineMoney, lineVat, posSaleNumber, posShiftNumber, saleTotals } from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { catalogApi, idempotency, type ProductJson, unitOf } from './catalog';
import { setSetting } from './finance';
import { bearer, login, seedUser } from './identity';
import { inventoryApi, type WarehouseJson } from './inventory';
import { pricingApi } from './pricing';

/** The supermarket POS (ADR-0063, ADR-0064) through HTTP: the admin's routes and the edge's. */

export interface EdgeNodeJson {
  id: number;
  code: string;
  name: string;
  warehouseId: number;
  tokenPrefix: string | null;
  backlog: number;
  lastSeenAt: string | null;
  lastPushAt: string | null;
  status: string;
}

export interface TillJson {
  id: number;
  edgeNodeId: number;
  code: string;
  name: string;
  printerHost: string | null;
  printerPort: number;
  status: string;
  lastSaleAt: string | null;
}

export interface ShiftJson {
  id: number;
  number: string;
  status: string;
  tillId: number;
  tillCode: string;
  cashierUserId: number;
  cashierName: string | null;
  openingFloat: string;
  countedCash: string | null;
  floatKept: string | null;
  expectedCash: string | null;
  variance: string | null;
  salesCount: number;
  returnsCount: number;
  cashSales: string;
  cashRefunds: string;
  cardSales: string;
  cardRefunds: string;
  salesTotal: string;
  returnsTotal: string;
  salesVat: string;
  returnsVat: string;
  journalEntryId: number | null;
  journalNumber: string | null;
  handoverPaymentId: number | null;
  handoverNumber: string | null;
}

export interface SaleJson {
  id: number;
  number: string;
  kind: string;
  tillCode: string;
  shiftId: number;
  cashierUserId: number;
  total: string;
  vatTotal: string;
  cashAmount: string;
  cardAmount: string;
  ebarimtStatus: string;
  refundsSaleId: number | null;
  lineCount: number;
  shortfallCount: number;
  lines?: {
    id: number;
    lineNo: number;
    productId: number;
    qty: string;
    qtyBase: string;
    unitPrice: string;
    total: string;
    vatAmount: string;
    returnedBase: string;
    damaged: boolean;
  }[];
  tenders?: { kind: string; amount: string; tendered: string | null }[];
  shortfalls?: { productId: number; qtyBase: string; adjustmentNumber: string }[];
  returns?: { id: number; number: string; total: string }[];
}

export interface OutcomeJson {
  clientId: string;
  kind: string;
  status: 'APPLIED' | 'DUPLICATE' | 'REJECTED';
  id: number | null;
  number: string | null;
  code: string | null;
  params: Record<string, unknown> | null;
}

export function posApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  const get = async <T>(path: string, query: Record<string, unknown> = {}): Promise<T> =>
    (await http().get(`/api/v1${path}`).query(query).set(auth).expect(200)).body as T;
  return {
    http,
    auth,
    settings: () => get<Record<string, unknown>>('/pos/settings'),
    setSettings: (body: Record<string, unknown>) =>
      http().put('/api/v1/pos/settings').set(auth).send(body),
    nodes: () => get<EdgeNodeJson[]>('/pos/edge-nodes'),
    createNode: (body: Record<string, unknown>) =>
      http().post('/api/v1/pos/edge-nodes').set(auth).send(body),
    updateNode: (id: number, body: Record<string, unknown>) =>
      http().put(`/api/v1/pos/edge-nodes/${id}`).set(auth).send(body),
    issueToken: async (id: number): Promise<{ token: string; prefix: string }> =>
      (await http().post(`/api/v1/pos/edge-nodes/${id}/token`).set(auth).expect(200)).body as {
        token: string;
        prefix: string;
      },
    tills: (query: Record<string, unknown> = {}) => get<TillJson[]>('/pos/tills', query),
    createTill: (body: Record<string, unknown>) =>
      http().post('/api/v1/pos/tills').set(auth).send(body),
    updateTill: (id: number, body: Record<string, unknown>) =>
      http().put(`/api/v1/pos/tills/${id}`).set(auth).send(body),
    pairingCode: (id: number) => http().post(`/api/v1/pos/tills/${id}/pairing-code`).set(auth),
    cashiers: () => get<Record<string, unknown>[]>('/pos/cashiers'),
    setPin: (userId: number, pin: string) =>
      http().put(`/api/v1/pos/cashiers/${userId}/pin`).set(auth).send({ pin }),
    setCashierStatus: (userId: number, status: string) =>
      http().put(`/api/v1/pos/cashiers/${userId}/status`).set(auth).send({ status }),
    unlock: (userId: number) => http().post(`/api/v1/pos/cashiers/${userId}/unlock`).set(auth),
    shifts: (query: Record<string, unknown> = {}) =>
      get<{ data: ShiftJson[]; nextCursor: string | null }>('/pos/shifts', query),
    shift: (id: number) => get<ShiftJson>(`/pos/shifts/${id}`),
    handover: (id: number, body: Record<string, unknown> = {}) =>
      http().post(`/api/v1/pos/shifts/${id}/handover`).set(auth).set(idempotency()).send(body),
    sales: (query: Record<string, unknown> = {}) =>
      get<{ data: SaleJson[]; nextCursor: string | null; total: number | null }>(
        '/pos/sales',
        query,
      ),
    sale: (id: number) => get<SaleJson>(`/pos/sales/${id}`),
    shortfalls: (query: Record<string, unknown> = {}) =>
      get<{ data: Record<string, unknown>[]; nextCursor: string | null }>('/pos/shortfalls', query),
    resolveShortfall: (id: number, note: string | null) =>
      http().post(`/api/v1/pos/shortfalls/${id}/resolve`).set(auth).send({ note }),
    rejections: (query: Record<string, unknown> = {}) =>
      get<{ data: Record<string, unknown>[]; nextCursor: string | null }>(
        '/pos/sync-rejections',
        query,
      ),
    replay: (id: number) =>
      http().post(`/api/v1/pos/sync-rejections/${id}/replay`).set(auth).set(idempotency()),
    quickButtons: () => get<Record<string, unknown>[]>('/pos/quick-buttons'),
    setQuickButtons: (body: Record<string, unknown>) =>
      http().put('/api/v1/pos/quick-buttons').set(auth).send(body),
    voids: (query: Record<string, unknown> = {}) =>
      get<{
        data: Record<string, unknown>[];
        nextCursor: string | null;
        total: number | null;
        sum: string | null;
      }>('/pos/voids', query),
    void: (id: number) => get<Record<string, unknown>>(`/pos/voids/${id}`),
    attention: () =>
      get<{
        openShifts: number;
        shiftsToHandOver: number;
        openShortfalls: number;
        rejections: number;
      }>('/pos/attention'),
    /** The edge's replay, with the node's token instead of a staff token. */
    sync: (edgeToken: string, events: Record<string, unknown>[]) =>
      http()
        .post('/api/v1/pos/sync/events')
        .set('Authorization', `Bearer ${edgeToken}`)
        .send({ events }),
    heartbeat: (edgeToken: string, body: Record<string, unknown>) =>
      http()
        .post('/api/v1/pos/sync/heartbeat')
        .set('Authorization', `Bearer ${edgeToken}`)
        .send(body),
    devOpenShift: (body: Record<string, unknown>) =>
      http().post('/api/v1/pos/dev/shifts/open').set(auth).set(idempotency()).send(body),
    devSale: (body: Record<string, unknown>) =>
      http().post('/api/v1/pos/dev/sales').set(auth).set(idempotency()).send(body),
    devCloseShift: (id: number, body: Record<string, unknown>) =>
      http().post(`/api/v1/pos/dev/shifts/${id}/close`).set(auth).set(idempotency()).send(body),
  };
}

export interface SaleLineSpec {
  product: ProductJson;
  qty: string;
  /** The till's unit price; default: the product's RETAIL price in the store. */
  unitPrice?: string;
  vatRatePct?: string;
  discountAmount?: string;
  refundsLineNo?: number | null;
  damaged?: boolean;
}

export interface SaleDocOptions {
  clientId?: string;
  kind?: 'SALE' | 'RETURN';
  tillCode: string;
  shiftClientId: string;
  cashierUserId: number;
  approvedByUserId?: number | null;
  number: string;
  soldAt?: Date;
  tenders?: { kind: 'CASH' | 'CARD'; amount: string; tendered?: string | null }[];
  refundsSaleClientId?: string | null;
  receiptType?: 'B2C' | 'B2B';
  customerTin?: string | null;
  note?: string | null;
}

/** A sale document as a till would send it: the money derived with the shared rules. */
export function saleDoc(
  lines: SaleLineSpec[],
  options: SaleDocOptions,
  retailPriceOf: (product: ProductJson) => string,
): Record<string, unknown> {
  const docLines = lines.map((spec, index) => {
    const unitPrice = spec.unitPrice ?? retailPriceOf(spec.product);
    const vatRatePct = spec.vatRatePct ?? '10';
    const money = lineMoney(spec.qty, unitPrice, spec.discountAmount ?? '0');
    return {
      lineNo: index + 1,
      productId: spec.product.id,
      productUnitId: unitOf(spec.product, 'PCS').id,
      qty: spec.qty,
      factorSnapshot: '1',
      basis: 'RETAIL',
      listPrice: unitPrice,
      unitPrice,
      discountAmount: spec.discountAmount ?? '0',
      subtotal: money.subtotal.toFixed(2),
      total: money.total.toFixed(2),
      vatRatePct,
      vatAmount: lineVat(money.total, vatRatePct).toFixed(2),
      refundsLineNo: spec.refundsLineNo ?? null,
      damaged: spec.damaged ?? false,
    };
  });
  const totals = saleTotals(docLines);
  return {
    clientId: options.clientId ?? randomUUID(),
    kind: options.kind ?? 'SALE',
    tillCode: options.tillCode,
    shiftClientId: options.shiftClientId,
    cashierUserId: options.cashierUserId,
    approvedByUserId: options.approvedByUserId ?? null,
    number: options.number,
    soldAt: (options.soldAt ?? new Date()).toISOString(),
    receiptType: options.receiptType ?? 'B2C',
    customerTin: options.customerTin ?? null,
    refundsSaleClientId: options.refundsSaleClientId ?? null,
    lines: docLines,
    tenders: options.tenders ?? [{ kind: 'CASH', amount: totals.total.toFixed(2), tendered: null }],
    subtotal: totals.subtotal.toFixed(2),
    discountTotal: totals.discountTotal.toFixed(2),
    total: totals.total.toFixed(2),
    vatTotal: totals.vatTotal.toFixed(2),
    note: options.note ?? null,
  };
}

export const saleEvent = (doc: Record<string, unknown>) => ({
  kind: doc.kind,
  clientId: doc.clientId,
  sale: doc,
});

export function shiftOpenEvent(input: {
  clientId?: string;
  tillCode: string;
  cashierUserId: number;
  number: string;
  openingFloat: string;
  openedAt?: Date;
}) {
  const clientId = input.clientId ?? randomUUID();
  return {
    kind: 'SHIFT_OPENED',
    clientId,
    shiftOpened: {
      clientId,
      tillCode: input.tillCode,
      cashierUserId: input.cashierUserId,
      number: input.number,
      openedAt: (input.openedAt ?? new Date()).toISOString(),
      openingFloat: input.openingFloat,
    },
  };
}

export function shiftCloseEvent(input: {
  shiftClientId: string;
  countedCash: string;
  floatKept: string;
  note?: string | null;
  closedAt?: Date;
}) {
  return {
    kind: 'SHIFT_CLOSED',
    clientId: input.shiftClientId,
    shiftClosed: {
      clientId: input.shiftClientId,
      closedAt: (input.closedAt ?? new Date()).toISOString(),
      countedCash: input.countedCash,
      floatKept: input.floatKept,
      note: input.note ?? null,
    },
  };
}

/**
 * A store with its edge node, a till, a cashier and a supervisor, a RETAIL profile (30 % on the
 * warehouse price) and a product factory that puts stock on SALESFLOOR. The company is a VAT
 * payer at 10 % without city tax, as in Mörön. `prefix` keeps codes unique per test file.
 */
export async function posStore(app: NestExpressApplication, admin: string, prefix: string) {
  const inventory = inventoryApi(app, admin);
  const catalog = catalogApi(app, admin);
  const pricing = pricingApi(app, admin);
  const pos = posApi(app, admin);
  const http = () => request(app.getHttpServer());
  const auth = bearer(admin);
  const today = businessDate();
  await setSetting(app, admin, 'company.vat_payer', true, today);
  await setSetting(app, admin, 'company.city_tax_payer', false, today);
  await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
  const store: WarehouseJson = await inventory.warehouse(`${prefix}S`, 'STORE');
  const salesfloor = await inventory.systemBin(store.id, 'SALESFLOOR');
  const category = await catalog.category(`Супермаркет ${prefix}`);
  const baseUomId = await catalog.uomId('PCS');
  const profile = await pricing.profile(`Супермаркет ${prefix}`);
  const node = (
    await pos
      .createNode({ code: `${prefix}1`, name: `Дэлгүүр ${prefix}`, warehouseId: store.id })
      .expect(201)
  ).body as EdgeNodeJson;
  const edgeToken = (await pos.issueToken(node.id)).token;
  const till = (
    await pos
      .createTill({ edgeNodeId: node.id, code: `К1`, name: 'Касс 1', printerHost: null })
      .expect(201)
  ).body as TillJson;
  const cashierUser = await seedUser(app, { roles: ['POS_CASHIER'] });
  await pos.setPin(cashierUser.id, '123456').expect(200);
  const supervisorUser = await seedUser(app, { roles: ['POS_SUPERVISOR'] });
  await pos.setPin(supervisorUser.id, '654321').expect(200);
  await pos.setSettings({ storeWarehouseId: store.id }).expect(200);
  const prices = new Map<number, string>();
  let sequence = 0;

  return {
    pos,
    edgeToken,
    store,
    salesfloor,
    node,
    till,
    cashierId: cashierUser.id,
    supervisorId: supervisorUser.id,
    today,
    /** The RETAIL price of a product made here (warehouse price + 30 %, whole MNT). */
    retailPrice(product: ProductJson): string {
      const price = prices.get(product.id);
      if (!price) throw new Error(`no retail price for product ${product.id}`);
      return price;
    },
    /** A sale-ready product priced at `warehousePrice` with `stock` pieces on SALESFLOOR. */
    async product(
      sku: string,
      name: string,
      warehousePrice: string,
      stock: string,
    ): Promise<ProductJson> {
      const product = await catalog.product({ sku, name, categoryId: category, baseUomId });
      await pricing.terms(product.id, warehousePrice, profile, null);
      await http()
        .post('/api/v1/pricing/sale-ready')
        .set(auth)
        .set(idempotency())
        .send({ productIds: [product.id] })
        .expect(200);
      prices.set(
        product.id,
        new Decimal(warehousePrice).times(130).div(100).toDecimalPlaces(0).toFixed(),
      );
      if (new Decimal(stock).gt(0)) await this.restock(product, stock);
      return product;
    },
    /** Puts `qty` pieces of a product onto SALESFLOOR (a SURPLUS adjustment at a cost of 700). */
    async restock(product: ProductJson, qty: string): Promise<void> {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(auth)
        .set(idempotency())
        .send({
          warehouseId: store.id,
          reason: 'SURPLUS',
          lines: [
            {
              productUnitId: unitOf(product, 'PCS').id,
              enteredQty: qty,
              binId: salesfloor.id,
              unitCost: '700',
            },
          ],
        })
        .expect(201);
      const id = (created.body as { id: number }).id;
      await http().post(`/api/v1/adjustments/${id}/submit`).set(auth).expect(200);
      await http()
        .post(`/api/v1/adjustments/${id}/post`)
        .set(auth)
        .set(idempotency())
        .send({})
        .expect(200);
    },
    /** The next sale number of the till today, as the edge would allocate it. */
    nextNumber(): string {
      sequence += 1;
      return posSaleNumber(till.code, today, sequence);
    },
    shiftNumber(seq: number): string {
      return posShiftNumber(till.code, today, seq);
    },
    /** Opens a shift through the sync route; the shift's clientId and the centre's row. */
    async openShift(
      openingFloat = '50000',
      seq = 1,
    ): Promise<{ clientId: string; shift: ShiftJson }> {
      const event = shiftOpenEvent({
        tillCode: till.code,
        cashierUserId: cashierUser.id,
        number: this.shiftNumber(seq),
        openingFloat,
      });
      const res = await pos.sync(edgeToken, [event]).expect(200);
      const outcome = (res.body as { results: OutcomeJson[] }).results[0];
      if (!outcome || outcome.status !== 'APPLIED' || outcome.id === null) {
        throw new Error(`shift not opened: ${JSON.stringify(res.body)}`);
      }
      return { clientId: event.clientId, shift: await pos.shift(outcome.id) };
    },
    /** Replays documents and returns the outcomes (the response must be 200). */
    async replay(events: Record<string, unknown>[]): Promise<OutcomeJson[]> {
      const res = await pos.sync(edgeToken, events);
      if (res.status !== 200) throw new Error(`sync ${res.status}: ${JSON.stringify(res.body)}`);
      return (res.body as { results: OutcomeJson[] }).results;
    },
  };
}

/** The staff tokens a POS test needs. */
export async function posActors(app: NestExpressApplication) {
  const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
  const accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
  const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
  const warehouse = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
  return { admin, accountant, office, warehouse };
}
