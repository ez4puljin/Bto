import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { financeApi, type PaymentJson, type ProblemJson, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { type CustomerJson, partnersApi } from '../harness/partners';

/**
 * Races finance must win (ADR-0060 #2, #5): two confirmations of one customer never both pass a
 * limit together, and two payments never settle the same invoice twice. The customer lock
 * serialises both.
 */
describe('finance races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let product: ProductJson;
  let shop: CustomerJson;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    flow = await salesFlow(app, admin, 'FR');
    product = await flow.product('8701', 'Элсэн чихэр', '1000', '1000');
    shop = await partnersApi(app, admin).customer({ name: 'Уралдааны дэлгүүр' });
    await http()
      .put(`/api/v1/customers/${shop.id}/credit`)
      .set(bearer(accountant))
      .send({
        creditLimit: '10000',
        paymentTermDays: null,
        creditHold: false,
        creditHoldReason: null,
      })
      .expect(200);
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('lets exactly one of two simultaneous confirmations pass a 10,000 limit', async () => {
    const drafts = await Promise.all([
      flow.draft(shop.id, [{ productUnitId: flow.pcs(product), qty: '6' }]),
      flow.draft(shop.id, [{ productUnitId: flow.pcs(product), qty: '6' }]),
    ]);
    const results = await Promise.all(drafts.map((draft) => flow.confirm(draft.id)));
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const refused = results.find((res) => res.status === 409)?.body as ProblemJson;
    expect(refused).toMatchObject({
      code: 'CREDIT_BLOCKED',
      params: expect.objectContaining({ reason: 'LIMIT', exposure: '12000', limit: '10000' }),
    });
    const confirmed = await sql.query<{ count: string }>(
      `SELECT count(*) FROM sales_orders WHERE customer_id = $1 AND status = 'CONFIRMED'`,
      [shop.id],
    );
    expect(confirmed.rows[0]?.count).toBe('1');
  });

  it('never settles an invoice twice when two payments arrive together', async () => {
    const finance = financeApi(app, accountant);
    const other = await partnersApi(app, admin).customer({ name: 'Давхар төлбөрийн дэлгүүр' });
    const draft = await flow.draft(other.id, [{ productUnitId: flow.pcs(product), qty: '10' }]);
    await flow.sell(draft.id);
    const invoice = await finance.invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('no invoice');
    const cash = await financeApi(app, admin).cashBox('FR-CASH');
    const body = {
      kind: 'CUSTOMER_PAYMENT',
      moneyAccountId: cash.id,
      customerId: other.id,
      amount: '10000',
      paidOn: businessDate(),
    };
    const results = await Promise.all([finance.payment(body), finance.payment(body)]);
    expect(results.map((res) => res.status)).toEqual([201, 201]);
    const allocated = results.map((res) => (res.body as PaymentJson).allocatedAmount).sort();
    expect(allocated).toEqual(['0.00', '10000.00']);
    expect(await finance.invoice(invoice.id)).toMatchObject({
      settlement: 'PAID',
      openAmount: '0.00',
    });
    const sum = await sql.query<{ sum: string }>(
      `SELECT coalesce(sum(a.amount), 0)::text AS sum
         FROM fin.allocations a
         JOIN fin.open_items i ON i.id = a.debit_item_id
         JOIN fin.documents d ON d.id = i.document_id
        WHERE d.source_doc_type = 'SALES_INVOICE' AND d.source_doc_id = $1::text
          AND a.reverses_allocation_id IS NULL AND a.mirror = false
          AND NOT EXISTS (SELECT 1 FROM fin.allocations u WHERE u.reverses_allocation_id = a.id)`,
      [invoice.id],
    );
    expect(sum.rows[0]?.sum).toBe('10000.00');
    expect(await finance.balance(other.id)).toMatchObject({
      balance: '-10000.00',
      openInvoices: 0,
    });
  });
});
