import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { catalogApi, idempotency, type ProductJson, unitOf } from './catalog';
import { bearer } from './identity';
import { inventoryApi, type WarehouseJson } from './inventory';
import { pricingApi } from './pricing';
import { orderBody, type OrderJson, salesApi } from './sales';

/** Finance (ADR-0060) through HTTP, as the accountant works, plus a sales flow that invoices. */

export interface InvoiceLineJson {
  id: number;
  lineNo: number;
  productId: number;
  uomName: string;
  qty: string;
  qtyBase: string;
  unitPrice: string;
  subtotal: string;
  discountAmount: string;
  total: string;
  vatRatePct: string;
  vatAmount: string;
  cityTaxAmount: string;
  returnedBase: string;
}

export interface InvoiceJson {
  id: number;
  number: string;
  status: string;
  settlement: string;
  customerId: number;
  orderId: number | null;
  orderNumber: string | null;
  branchId: number | null;
  invoiceDate: string;
  dueDate: string;
  overdue: boolean;
  paymentMethod: string;
  subtotal: string;
  discountTotal: string;
  total: string;
  vatTotal: string;
  cityTaxTotal: string;
  openAmount: string;
  lineCount: number;
  journalEntryId?: number | null;
  journalNumber?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  lines?: InvoiceLineJson[];
  allocations?: {
    sourceType: string;
    sourceId: number;
    sourceNumber: string;
    amount: string;
    voidedAt: string | null;
  }[];
  creditNotes?: { id: number; number: string; total: string }[];
}

export interface PaymentJson {
  id: number;
  number: string;
  status: string;
  kind: string;
  direction: string;
  moneyAccountId: number;
  customerId: number | null;
  glAccountId: number | null;
  amount: string;
  allocatedAmount: string;
  paidOn: string;
  collectedByName: string | null;
  journalEntryId?: number | null;
  journalNumber?: string | null;
  voidReason?: string | null;
  allocations?: {
    invoiceId: number;
    invoiceNumber: string;
    amount: string;
    voidedAt: string | null;
  }[];
}

export interface JournalLineJson {
  lineNo: number;
  accountId: number;
  accountCode: string;
  debit: string;
  credit: string;
  customerId: number | null;
  moneyAccountId: number | null;
}

export interface JournalEntryJson {
  id: number;
  number: string;
  entryDate: string;
  description: string;
  source: string;
  sourceType: string | null;
  sourceId: number | null;
  sourceNumber: string | null;
  reversesId: number | null;
  reversesNumber: string | null;
  reversedById: number | null;
  amount: string;
  lineCount: number;
  lines?: JournalLineJson[];
}

export interface GlAccountJson {
  id: number;
  code: string;
  name: string;
  kind: string;
  role: string | null;
  status: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface CustomerBalanceJson {
  customerId: number;
  code: string;
  name: string;
  creditLimit: string | null;
  creditHold: boolean;
  balance: string;
  openInvoices: number;
  overdueAmount: string;
  oldestDueDate: string | null;
  aging: Record<string, string>;
}

export interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
  errors?: { path: string; constraint: string }[];
}

export function financeApi(app: NestExpressApplication, token: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(token);
  const get = async <T>(path: string, query: Record<string, unknown> = {}): Promise<T> =>
    (await http().get(`/api/v1${path}`).query(query).set(auth).expect(200)).body as T;
  return {
    http,
    auth,
    invoices: (query: Record<string, unknown> = {}) =>
      get<{ data: InvoiceJson[]; nextCursor: string | null; total: number | null }>(
        '/invoices',
        query,
      ),
    invoice: (id: number) => get<InvoiceJson>(`/invoices/${id}`),
    /** The invoice of an order, or null when the sale issued none. */
    async invoiceOfOrder(orderId: number): Promise<InvoiceJson | null> {
      const page = await this.invoices({ orderId });
      return page.data[0] ? this.invoice(page.data[0].id) : null;
    },
    voidInvoice: (id: number, reason: string) =>
      http().post(`/api/v1/invoices/${id}/void`).set(auth).set(idempotency()).send({ reason }),
    payment: (body: Record<string, unknown>) =>
      http().post('/api/v1/payments').set(auth).set(idempotency()).send(body),
    payments: (query: Record<string, unknown> = {}) =>
      get<{ data: PaymentJson[]; nextCursor: string | null; total: number | null }>(
        '/payments',
        query,
      ),
    paymentGet: (id: number) => get<PaymentJson>(`/payments/${id}`),
    voidPayment: (id: number, reason: string) =>
      http().post(`/api/v1/payments/${id}/void`).set(auth).set(idempotency()).send({ reason }),
    creditNote: (body: Record<string, unknown>) =>
      http().post('/api/v1/credit-notes').set(auth).set(idempotency()).send(body),
    creditNotes: (query: Record<string, unknown> = {}) =>
      get<{ data: Record<string, unknown>[]; nextCursor: string | null }>('/credit-notes', query),
    journal: (body: Record<string, unknown>) =>
      http().post('/api/v1/journal-entries').set(auth).set(idempotency()).send(body),
    journalList: (query: Record<string, unknown> = {}) =>
      get<{ data: JournalEntryJson[]; nextCursor: string | null }>('/journal-entries', query),
    journalGet: (id: number) => get<JournalEntryJson>(`/journal-entries/${id}`),
    reverse: (id: number, description: string) =>
      http()
        .post(`/api/v1/journal-entries/${id}/reverse`)
        .set(auth)
        .set(idempotency())
        .send({ description }),
    accounts: () => get<GlAccountJson[]>('/gl-accounts'),
    async account(code: string): Promise<GlAccountJson> {
      const found = (await this.accounts()).find((account) => account.code === code);
      if (!found) throw new Error(`no account ${code}`);
      return found;
    },
    createAccount: (body: Record<string, unknown>) =>
      http().post('/api/v1/gl-accounts').set(auth).send(body),
    patchAccount: (id: number, body: Record<string, unknown>) =>
      http().put(`/api/v1/gl-accounts/${id}`).set(auth).send(body),
    setRole: (id: number, role: string | null) =>
      http().put(`/api/v1/gl-accounts/${id}/role`).set(auth).send({ role }),
    accountLedger: (id: number, query: Record<string, unknown> = {}) =>
      get<{ data: Record<string, unknown>[]; nextCursor: string | null; opening: string }>(
        `/gl-accounts/${id}/ledger`,
        query,
      ),
    moneyAccounts: () => get<Record<string, unknown>[]>('/money-accounts'),
    createMoneyAccount: (body: Record<string, unknown>) =>
      http().post('/api/v1/money-accounts').set(auth).send(body),
    patchMoneyAccount: (id: number, body: Record<string, unknown>) =>
      http().put(`/api/v1/money-accounts/${id}`).set(auth).send(body),
    book: (id: number, query: Record<string, unknown> = {}) =>
      get<{
        data: (PaymentJson & { balanceAfter: string })[];
        nextCursor: string | null;
        opening: string;
      }>(`/money-accounts/${id}/book`, query),
    balances: (query: Record<string, unknown> = {}) =>
      get<{ data: CustomerBalanceJson[]; nextCursor: string | null }>('/customer-balances', query),
    balance: (customerId: number) => get<CustomerBalanceJson>(`/customer-balances/${customerId}`),
    ledger: (customerId: number, query: Record<string, unknown> = {}) =>
      get<{
        data: {
          kind: string;
          docType: string;
          docNumber: string;
          debit: string;
          credit: string;
          balanceAfter: string;
        }[];
        nextCursor: string | null;
        opening: string;
      }>(`/customer-balances/${customerId}/ledger`, query),
    attention: () =>
      get<{
        overdueAmount: string;
        overdueCustomers: number;
        openAmount: string;
        openInvoices: number;
      }>('/finance/attention'),
    numbering: () => get<Record<string, unknown>>('/finance-settings/numbering'),
    setNumbering: (body: Record<string, unknown>) =>
      http().put('/api/v1/finance-settings/numbering').set(auth).send(body),
    /** A cash box on the seeded cash account, for the vouchers of a test. */
    async cashBox(code: string): Promise<{ id: number; code: string; balance: string }> {
      const cash = await this.account('100101');
      const res = await this.createMoneyAccount({
        code,
        name: `Касс ${code}`,
        kind: 'CASH',
        glAccountId: cash.id,
      });
      if (res.status !== 201) {
        throw new Error(`money account ${res.status}: ${JSON.stringify(res.body)}`);
      }
      return res.body as { id: number; code: string; balance: string };
    },
  };
}

export interface StageJson {
  id: number;
  name: string;
  action: string;
  archivedAt: string | null;
}

export interface PipelineJson {
  id: number;
  boardId: number;
  name: string;
  stages: StageJson[];
}

const STAGE_ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: STAGE_ROLES,
});

/**
 * A pipeline with the stage actions, a stocked and priced product factory and the office's way of
 * selling: create, confirm, pick, sell (ADR-0056). `prefix` keeps codes unique per test file.
 */
export async function salesFlow(app: NestExpressApplication, admin: string, prefix: string) {
  const http = () => request(app.getHttpServer());
  const auth = bearer(admin);
  const inventory = inventoryApi(app, admin);
  const catalog = catalogApi(app, admin);
  const pricing = pricingApi(app, admin);
  const wh: WarehouseJson = await inventory.warehouse(`${prefix}1`);
  const shelf = await inventory.bin(wh.id, 'A-01-01');
  const category = await catalog.category(`Санхүү ${prefix}`);
  const baseUomId = await catalog.uomId('PCS');
  const profile = await pricing.profile(`Санхүү ${prefix}`);
  const boardId = (
    (
      await http()
        .post('/api/v1/sales-boards')
        .set(auth)
        .send({ name: `Санхүү ${prefix}` })
        .expect(201)
    ).body as { id: number }
  ).id;
  const pipeline = (
    await http()
      .post('/api/v1/sales-pipelines')
      .set(auth)
      .send({
        boardId,
        name: `Санхүү ${prefix}`,
        visibility: 'PUBLIC',
        ownOrdersOnly: false,
        roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
        stages: [
          stageBody('Захиалга', 'NONE'),
          stageBody('Хяналт', 'CONFIRM'),
          stageBody('Бэлдэх', 'PICK'),
          stageBody('Борлуулалт', 'SALE'),
          stageBody('Цуцалсан', 'CANCEL'),
        ],
      })
      .expect(201)
  ).body as PipelineJson;
  const stage = (name: string): StageJson => {
    const found = pipeline.stages.find((entry) => entry.name === name && entry.archivedAt === null);
    if (!found) throw new Error(`no stage ${name}`);
    return found;
  };
  const orders = salesApi(app, admin);
  const move = (orderId: number, stageId: number) =>
    http()
      .post(`/api/v1/sales-orders/${orderId}/move`)
      .set(auth)
      .set(idempotency())
      .send({ stageId });

  return {
    wh,
    shelf,
    pipeline,
    stage,
    orders,
    move,
    /** A sale-ready product with a price per piece and stock on the shelf at a cost of 700. */
    async product(sku: string, name: string, price: string, stock: string): Promise<ProductJson> {
      const product = await catalog.product({ sku, name, categoryId: category, baseUomId });
      await inventory.setHome(product.id, wh.id);
      await pricing.terms(product.id, price, profile, null);
      await http()
        .post('/api/v1/pricing/sale-ready')
        .set(auth)
        .set(idempotency())
        .send({ productIds: [product.id] })
        .expect(200);
      const created = await http()
        .post('/api/v1/adjustments')
        .set(auth)
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          reason: 'SURPLUS',
          lines: [
            {
              productUnitId: unitOf(product, 'PCS').id,
              enteredQty: stock,
              binId: shelf.id,
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
      return product;
    },
    pcs: (product: ProductJson) => unitOf(product, 'PCS').id,
    /** A draft in the first stage, with the given lines. */
    draft(
      customerId: number,
      lines: { productUnitId: number; qty: string }[],
      fields: Record<string, unknown> = {},
    ): Promise<OrderJson> {
      return orders.draft(
        orderBody(customerId, lines, {
          pipelineId: pipeline.id,
          stageId: stage('Захиалга').id,
          ...fields,
        }),
      );
    },
    /** Confirms a draft (the credit check runs here); the raw response, for refusals. */
    confirm(orderId: number) {
      return move(orderId, stage('Хяналт').id);
    },
    /**
     * Confirms, picks (the approved quantities unless `picked` says otherwise, by line index) and
     * sells the draft; the order as the sale left it.
     */
    async sell(orderId: number, picked: Record<number, string> = {}): Promise<OrderJson> {
      await move(orderId, stage('Хяналт').id).expect(200);
      await move(orderId, stage('Бэлдэх').id).expect(200);
      const confirmed = await orders.get(orderId);
      const info = (
        await http().get(`/api/v1/sales-orders/${orderId}/pick-info`).set(auth).expect(200)
      ).body as { lineId: number; proposedBinId: number | null }[];
      await http()
        .post(`/api/v1/sales-orders/${orderId}/pick`)
        .set(auth)
        .set(idempotency())
        .send({
          lines: confirmed.lines.map((line, index) => ({
            lineId: line.id,
            qty: picked[index] ?? line.qtyApproved,
            binId: info.find((entry) => entry.lineId === line.id)?.proposedBinId ?? shelf.id,
          })),
        })
        .expect(200);
      const sold = (await move(orderId, stage('Борлуулалт').id).expect(200)).body as {
        order: OrderJson;
      };
      return sold.order;
    },
  };
}

/** Sets a company setting from today, as the admin. */
export async function setSetting(
  app: NestExpressApplication,
  admin: string,
  key: string,
  value: unknown,
  effectiveFrom: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/v1/settings')
    .set(bearer(admin))
    .send({ key, value, effectiveFrom })
    .expect(201);
}

/**
 * Moves an invoice's due date (the calendar of a test): the invoice and its open item in the
 * Finance Core (F2, ADR-0090), whose due date only the migrator may correct. `sql` is a migrator
 * connection.
 */
export async function moveInvoiceDue(
  sql: { query: (text: string, values: unknown[]) => Promise<unknown> },
  invoiceId: number,
  dates: { invoiceDate?: string; dueDate: string },
): Promise<void> {
  await sql.query(
    'UPDATE invoices SET invoice_date = coalesce($2::date, invoice_date), due_date = $3::date WHERE id = $1',
    [invoiceId, dates.invoiceDate ?? null, dates.dueDate],
  );
  await sql.query(
    `UPDATE fin.open_items i SET due_date = $2::date
       FROM fin.documents d
      WHERE d.company_id = i.company_id AND d.id = i.document_id AND d.reverses_document_id IS NULL
        AND d.source_doc_type = 'SALES_INVOICE' AND d.source_doc_id = $1::text AND i.side = 'DEBIT'`,
    [invoiceId, dates.dueDate],
  );
}
