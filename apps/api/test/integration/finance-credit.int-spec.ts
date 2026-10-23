import type { NestExpressApplication } from '@nestjs/platform-express';
import { settlementDueDate } from '@tugeel/shared/finance';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { financeApi, moveInvoiceDue, type ProblemJson, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { type CustomerJson, partnersApi } from '../harness/partners';

/**
 * Credit control (ADR-0060 #2, SPEC §6.2): no tolerance, for every payment method. A limit is
 * checked against the ledger balance, the other open orders and the order at hand (its own total
 * never counted twice); no limit means no limit; a hold refuses everything until it is lifted. An
 * overdue invoice only reminds (ADR-0101): it never refuses. Invoices fall due on the customer's
 * settlement day. Synthetic data only.
 */
describe('finance credit control', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let juice: ProductJson;
  let limited: CustomerJson;
  let unlimited: CustomerJson;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const credit = (customerId: number, body: Record<string, unknown>) =>
    http()
      .put(`/api/v1/customers/${customerId}/credit`)
      .set(bearer(accountant))
      .send({
        creditLimit: null,
        settlementGroup: 'DAY_20',
        creditHold: false,
        creditHoldReason: null,
        ...body,
      })
      .expect(200);
  const refusal = async (orderId: number): Promise<ProblemJson> =>
    (await flow.confirm(orderId).expect(409)).body as ProblemJson;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    flow = await salesFlow(app, admin, 'FC');
    juice = await flow.product('8301', 'Жүүс', '1000', '10000');
    limited = await partnersApi(app, admin).customer({ name: 'Лимиттэй дэлгүүр' });
    unlimited = await partnersApi(app, admin).customer({ name: 'Лимитгүй дэлгүүр' });
    await credit(limited.id, { creditLimit: '10000' });
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('refuses the order that passes the limit, cash orders too, and never counts an order twice', async () => {
    const line = (qty: string) => [{ productUnitId: flow.pcs(juice), qty }];
    const eight = await flow.draft(limited.id, line('8'), { paymentMethod: 'CREDIT' });
    await flow.confirm(eight.id).expect(200);
    // 8,000 open + 3,000 = 11,000 > 10,000: refused with the amounts, in cash as well.
    const three = await flow.draft(limited.id, line('3'), { paymentMethod: 'CASH' });
    expect(await refusal(three.id)).toMatchObject({
      code: 'CREDIT_BLOCKED',
      params: {
        reason: 'LIMIT',
        exposure: '11000',
        limit: '10000',
        excess: '1000',
        overdueAmount: '0',
        oldestDueDate: null,
      },
    });
    // Re-pricing the first order to 9,000 counts only itself: 9,000 ≤ 10,000.
    await flow.orders
      .update(eight.id, {
        customerId: limited.id,
        fulfilment: eight.fulfilment,
        deliveryDate: eight.deliveryDate,
        paymentMethod: 'CREDIT',
        pipelineId: flow.pipeline.id,
        stageId: flow.stage('Хяналт').id,
        lines: line('9'),
      })
      .expect(200);
    // Exactly the limit passes: 9,000 + 1,000.
    const one = await flow.draft(limited.id, line('1'));
    await flow.confirm(one.id).expect(200);
    // No limit means no limit.
    const big = await flow.draft(unlimited.id, line('5000'));
    await flow.confirm(big.id).expect(200);
    // Lifting the limit frees the refused order.
    await credit(limited.id, { creditLimit: '50000' });
    await flow.confirm(three.id).expect(200);
  });

  it("dates an invoice's due date by the customer's settlement group, cash sales too", async () => {
    const finance = financeApi(app, accountant);
    for (const [name, group, paymentMethod] of [
      ['Мөрөнгийн дэлгүүр', 'DAY_20', 'CREDIT'],
      ['Орон нутгийн дэлгүүр', 'MONTH_END', 'CASH'],
    ] as const) {
      const customer = await partnersApi(app, admin).customer({ name, settlementGroup: group });
      const sold = await flow.draft(customer.id, [{ productUnitId: flow.pcs(juice), qty: '1' }], {
        paymentMethod,
      });
      await flow.sell(sold.id);
      const invoice = await finance.invoiceOfOrder(sold.id);
      expect(invoice).toMatchObject({
        invoiceDate: today,
        dueDate: settlementDueDate(group, today),
      });
    }
  });

  it('only reminds of an overdue invoice: the order is confirmed and carries the debt', async () => {
    const finance = financeApi(app, accountant);
    const customer = await partnersApi(app, admin).customer({ name: 'Хугацаа хэтэрсэн' });
    const sold = await flow.draft(customer.id, [{ productUnitId: flow.pcs(juice), qty: '5' }]);
    await flow.sell(sold.id);
    const invoice = await finance.invoiceOfOrder(sold.id);
    if (!invoice) throw new Error('no invoice');
    // The clock moves past the due date.
    await moveInvoiceDue(sql, invoice.id, {
      invoiceDate: addDays(today, -1),
      dueDate: addDays(today, -1),
    });
    expect(await finance.invoice(invoice.id)).toMatchObject({ overdue: true });
    const next = await flow.draft(customer.id, [{ productUnitId: flow.pcs(juice), qty: '1' }], {
      paymentMethod: 'CASH',
    });
    const confirmed = (await flow.confirm(next.id).expect(200)).body as {
      order: { customerOverdue: unknown };
    };
    const reminder = { amount: '5000', oldestDueDate: addDays(today, -1) };
    expect(confirmed.order.customerOverdue).toEqual(reminder);
    // The customer list shows it too.
    const listed = await http()
      .get('/api/v1/customers')
      .query({ q: 'Хугацаа хэтэрсэн' })
      .set(bearer(admin))
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ id: customer.id, overdue: reminder }),
    ]);
    // A limit still refuses, and the refusal names the overdue amount.
    await credit(customer.id, { creditLimit: '6000' });
    const over = await flow.draft(customer.id, [{ productUnitId: flow.pcs(juice), qty: '1' }]);
    expect(await refusal(over.id)).toMatchObject({
      code: 'CREDIT_BLOCKED',
      params: expect.objectContaining({ reason: 'LIMIT', overdueAmount: '5000' }),
    });
    // Paid, the reminder goes.
    const cash = await financeApi(app, admin).cashBox('FC-CASH');
    await finance
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: cash.id,
        customerId: customer.id,
        amount: '5000',
        paidOn: today,
      })
      .expect(201);
    const after = (await flow.confirm(over.id).expect(200)).body as {
      order: { customerOverdue: unknown };
    };
    expect(after.order.customerOverdue).toBeNull();
  });

  it('refuses a customer on hold whatever the amounts', async () => {
    const customer = await partnersApi(app, admin).customer({ name: 'Түр хаасан' });
    await credit(customer.id, { creditHold: true, creditHoldReason: 'Маргаантай' });
    const draft = await flow.draft(customer.id, [{ productUnitId: flow.pcs(juice), qty: '1' }]);
    expect(await refusal(draft.id)).toMatchObject({
      code: 'CREDIT_BLOCKED',
      params: expect.objectContaining({ reason: 'HOLD', limit: null }),
    });
    await credit(customer.id, { creditHold: false });
    await flow.confirm(draft.id).expect(200);
  });
});
