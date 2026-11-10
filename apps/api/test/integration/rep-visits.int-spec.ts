import type { NestExpressApplication } from '@nestjs/platform-express';
import { isoWeekdayOf } from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson } from '../harness/catalog';
import { financeApi, type InvoiceJson, type PaymentJson, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { type CustomerJson, partnersApi } from '../harness/partners';

interface StopJson {
  customerId: number;
  name: string;
  planned: boolean;
  visit: { result: string; note: string | null } | null;
}
interface TodayJson {
  date: string;
  weekday: number;
  stops: StopJson[];
}
interface PlanDayJson {
  weekday: number;
  customers: { customerId: number }[];
}
interface CollectionJson {
  id: number;
  userName: string;
  customerId: number;
  amount: string;
  method: string;
  status: string;
  paymentId: number | null;
  paymentNumber: string | null;
  decisionNote: string | null;
}

/**
 * A rep's round, visits and collected money (ADR-0183): the office or the rep sets a weekday's
 * stores, the day's list joins them with the visits, the office reads the log; money a rep
 * reports changes no balance until the accountant records it as a voucher naming the rep, and a
 * decided report is never decided again. Synthetic data.
 */
describe('rep visits and collections', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let rep: string;
  let repId: number;
  let otherRep: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let water: ProductJson;
  let shop: CustomerJson;
  let kiosk: CustomerJson;
  let cash: { id: number };
  let invoice: InvoiceJson;
  const today = businessDate();
  const weekday = isoWeekdayOf(today);
  const http = () => request(app.getHttpServer());
  const get = async <T>(path: string, token: string, query: Record<string, unknown> = {}) =>
    (await http().get(`/api/v1${path}`).query(query).set(bearer(token)).expect(200)).body as T;

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    const seeded = await seedUser(app, { roles: ['SALES_REP'] });
    repId = seeded.id;
    rep = (await login(app, seeded)).accessToken;
    otherRep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    flow = await salesFlow(app, admin, 'RV');
    water = await flow.product('8301', 'Айлчлалын ус', '1000', '500');
    const partners = partnersApi(app, admin);
    shop = await partners.customer({ name: 'Айлчлалын дэлгүүр' });
    kiosk = await partners.customer({ name: 'Айлчлалын мухлаг' });
    cash = await financeApi(app, admin).cashBox('RV-CASH');
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(water), qty: '5' }]);
    await flow.sell(draft.id);
    const found = await financeApi(app, accountant).invoiceOfOrder(draft.id);
    if (!found) throw new Error('no invoice');
    invoice = found;
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps a weekday of a round, set by the office or by the rep', async () => {
    const setDay = (token: string, path: string, customerIds: number[]) =>
      http().put(`/api/v1${path}`).set(bearer(token)).send({ customerIds });
    // The rep may not set another rep's round, the office may.
    await setDay(rep, `/rep-visits/plans/${repId}/${weekday}`, [shop.id]).expect(403);
    await setDay(admin, `/rep-visits/plans/${repId}/8`, [shop.id]).expect(422);
    await setDay(admin, `/rep-visits/plans/${repId}/${weekday}`, [shop.id, 999_999]).expect(422);
    const plan = (
      await setDay(admin, `/rep-visits/plans/${repId}/${weekday}`, [shop.id]).expect(200)
    ).body as PlanDayJson[];
    expect(plan).toHaveLength(7);
    expect(plan.find((day) => day.weekday === weekday)?.customers).toEqual([
      expect.objectContaining({ customerId: shop.id }),
    ]);
    // The rep reorders their own day; the other rep's week stays empty.
    await setDay(rep, `/sales-rep/plan/${weekday}`, [kiosk.id, shop.id]).expect(200);
    const own = await get<PlanDayJson[]>('/sales-rep/plan', rep);
    expect(own.find((day) => day.weekday === weekday)?.customers.map((c) => c.customerId)).toEqual([
      kiosk.id,
      shop.id,
    ]);
    const other = await get<PlanDayJson[]>('/sales-rep/plan', otherRep);
    expect(other.every((day) => day.customers.length === 0)).toBe(true);
    expect((await get<{ id: number }[]>('/rep-visits/reps', admin)).map((row) => row.id)).toEqual(
      expect.arrayContaining([repId]),
    );
  });

  it("joins the day's plan with the visits and logs them for the office", async () => {
    const before = await get<TodayJson>('/sales-rep/visits/today', rep);
    expect(before).toMatchObject({ date: today, weekday });
    expect(before.stops.map((stop) => [stop.customerId, stop.planned, stop.visit])).toEqual([
      [kiosk.id, true, null],
      [shop.id, true, null],
    ]);
    const visit = (body: Record<string, unknown>, token = rep) =>
      http().post('/api/v1/sales-rep/visits').set(bearer(token)).set(idempotency()).send(body);
    await visit({ customerId: shop.id, result: 'SLEPT' }).expect(422);
    await visit({ customerId: 999_999, result: 'CLOSED' }).expect(404);
    await visit({ customerId: shop.id, result: 'NO_ORDER', note: '  Эзэн байхгүй  ' }).expect(200);
    const after = (await visit({ customerId: shop.id, result: 'ORDERED' }).expect(200))
      .body as TodayJson;
    // The day's last visit of a store shows; both stay in the log.
    expect(after.stops.find((stop) => stop.customerId === shop.id)?.visit).toMatchObject({
      result: 'ORDERED',
    });
    expect(after.stops.find((stop) => stop.customerId === kiosk.id)?.visit).toBeNull();
    const log = await get<{ data: { result: string; note: string | null; userId: number }[] }>(
      '/rep-visits',
      admin,
      { userId: repId, from: today, to: today },
    );
    expect(log.data.map((row) => [row.result, row.note])).toEqual([
      ['ORDERED', null],
      ['NO_ORDER', 'Эзэн байхгүй'],
    ]);
    const summary = await get<{ userId: number; result: string; visits: number; stores: number }[]>(
      '/rep-visits/summary',
      admin,
      { userId: repId },
    );
    expect(summary).toEqual([
      expect.objectContaining({ result: 'NO_ORDER', visits: 1, stores: 1 }),
      expect.objectContaining({ result: 'ORDERED', visits: 1, stores: 1 }),
    ]);
    // The log is the office's.
    await http().get('/api/v1/rep-visits').set(bearer(rep)).expect(403);
  });

  it('changes no balance until the accountant records a reported collection', async () => {
    const finance = financeApi(app, accountant);
    const report = (body: Record<string, unknown>, token = rep) =>
      http().post('/api/v1/sales-rep/collections').set(bearer(token)).set(idempotency()).send(body);
    await report({ customerId: shop.id, amount: '0', method: 'CASH' }).expect(422);
    await report({ customerId: shop.id, amount: '3000', method: 'CARD' }).expect(422);
    await report({ customerId: shop.id, amount: '3000', method: 'CASH' }, accountant).expect(403);
    const first = (
      await report({ customerId: shop.id, amount: '3000', method: 'CASH', note: 'Бэлнээр' }).expect(
        201,
      )
    ).body as CollectionJson;
    const second = (
      await report({ customerId: shop.id, amount: '700', method: 'TRANSFER' }).expect(201)
    ).body as CollectionJson;
    expect(first).toMatchObject({ status: 'PENDING', amount: '3000.00', paymentId: null });
    // A report is not money: the invoice stays open.
    expect(await finance.invoice(invoice.id)).toMatchObject({ openAmount: '5000.00' });
    const page = await get<{ data: CollectionJson[]; pendingCount: number; pendingAmount: string }>(
      '/rep-collections',
      accountant,
      { status: 'PENDING' },
    );
    expect(page).toMatchObject({ pendingCount: 2, pendingAmount: '3700.00' });
    expect(page.data.map((row) => row.id)).toEqual([second.id, first.id]);

    const record = (id: number, token = accountant) =>
      http()
        .post(`/api/v1/rep-collections/${id}/record`)
        .set(bearer(token))
        .set(idempotency())
        .send({ moneyAccountId: cash.id, paidOn: today });
    await record(first.id, rep).expect(403);
    const recorded = (await record(first.id).expect(200)).body as CollectionJson;
    expect(recorded).toMatchObject({ status: 'RECORDED' });
    expect(recorded.paymentNumber).toMatch(/^Т-/);
    // The voucher names the rep and settles the oldest invoice.
    const payment = await finance.paymentGet(recorded.paymentId ?? 0);
    expect(payment).toMatchObject({
      kind: 'CUSTOMER_PAYMENT',
      amount: '3000.00',
      customerId: shop.id,
      collectedBy: repId,
    } satisfies Partial<PaymentJson> & Record<string, unknown>);
    expect(await finance.invoice(invoice.id)).toMatchObject({ openAmount: '2000.00' });
    // Decided once.
    await record(first.id).expect(409);
    const reject = (id: number, reason: string) =>
      http().post(`/api/v1/rep-collections/${id}/reject`).set(bearer(accountant)).send({ reason });
    await reject(first.id, 'Давхар').expect(409);
    await reject(second.id, '   ').expect(422);
    expect((await reject(second.id, 'Шилжүүлэг ирээгүй').expect(200)).body).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Шилжүүлэг ирээгүй',
      paymentId: null,
    });
    await record(second.id).expect(409);
    expect(await finance.invoice(invoice.id)).toMatchObject({ openAmount: '2000.00' });
    // The rep sees their own reports with what became of them.
    const mine = await get<CollectionJson[]>('/sales-rep/collections', rep);
    expect(mine.map((row) => [row.id, row.status])).toEqual([
      [second.id, 'REJECTED'],
      [first.id, 'RECORDED'],
    ]);
    expect(await get<CollectionJson[]>('/sales-rep/collections', otherRep)).toEqual([]);
  });
});
