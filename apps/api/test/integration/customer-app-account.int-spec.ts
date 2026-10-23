import type { NestExpressApplication } from '@nestjs/platform-express';
import { settlementPeriodOf } from '@tugeel/shared/finance';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { CustomerNotifier } from '../../src/modules/notifications';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson } from '../harness/catalog';
import { type AppStore, appStore, storeOrderBody } from '../harness/customer-app';
import { financeApi, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { noticeBody } from '../harness/notifications';

interface NotificationJson {
  kind: string;
  invoiceId: number | null;
  paymentId: number | null;
  payload: Record<string, unknown>;
}

/** «Тооцоо», the bank accounts, the reminders, the notices and «Холбоо барих» (ADR-0079). */
describe('customer app account (ADR-0079)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let tea: ProductJson;
  let store: AppStore;
  let other: AppStore;
  let invoiceId: number;
  let soonInvoiceId: number;
  let otherInvoiceId: number;
  const today = businessDate();
  /** The stores are «Мөрөн» (DAY_20, the harness's group): their invoices fall due on the 20th. */
  const period = settlementPeriodOf('DAY_20', today);
  const daysLeft = Math.round((Date.parse(period.dueDate) - Date.parse(today)) / 86_400_000);
  const http = () => request(app.getHttpServer());

  /** An app order of `target`, confirmed, picked and sold by the office: its invoice id. */
  const sold = async (target: AppStore, qty: string): Promise<number> => {
    const order = (
      await target.api
        .send(storeOrderBody(today, [{ productUnitId: flow.pcs(tea), qty }]))
        .expect(201)
    ).body as { id: number };
    await flow.sell(order.id);
    const invoice = await financeApi(app, admin).invoiceOfOrder(order.id);
    if (!invoice) throw new Error('no invoice');
    return invoice.id;
  };
  const notifications = async (target: AppStore) =>
    ((await target.api.get('/notifications').expect(200)).body as { data: NotificationJson[] })
      .data;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    flow = await salesFlow(app, admin, 'CAA');
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({
        channel: 'CUSTOMER_APP',
        pipelineId: flow.pipeline.id,
        stageId: flow.stage('Захиалга').id,
      })
      .expect(200);
    tea = await flow.product('9301', 'Цай', '2500', '100');
    store = await appStore(app, office);
    other = await appStore(app, office);
    invoiceId = await sold(store, '4');
    soonInvoiceId = await sold(store, '1');
    otherInvoiceId = await sold(other, '1');
    // The other store's invoice far from the reminders' days, whatever today's date.
    await sql.query('UPDATE invoices SET due_date = $2::date WHERE id = $1', [
      otherInvoiceId,
      addDays(today, 30),
    ]);
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('shows the balance, the open invoices and one invoice of the store’s own', async () => {
    const account = (await store.api.get('/account').expect(200)).body as Record<string, unknown>;
    expect(account).toMatchObject({
      balance: '12500.00',
      overdueAmount: '0.00',
      oldestOverdueDate: null,
      creditLimit: null,
      creditAvailable: null,
      creditHold: false,
      settlement: {
        group: 'DAY_20',
        periodFrom: period.from,
        periodTo: period.to,
        dueDate: period.dueDate,
        daysLeft,
        amountDue: '12500.00',
        overdueAmount: '0.00',
      },
      openInvoices: 2,
      payments: 0,
    });
    const me = (await store.api.get('/me').expect(200)).body as Record<string, unknown>;
    expect(me).toMatchObject({ settlementGroup: 'DAY_20' });
    expect(me).not.toHaveProperty('paymentTermDays');
    const open = (await store.api.get('/invoices').expect(200)).body as {
      id: number;
      total: string;
      daysLeft: number;
      daysOverdue: number;
    }[];
    expect(open).toEqual([
      expect.objectContaining({ id: invoiceId, total: '10000.00', daysLeft, daysOverdue: 0 }),
      expect.objectContaining({ id: soonInvoiceId, total: '2500.00', daysLeft }),
    ]);
    const invoice = (await store.api.get(`/invoices/${invoiceId}`).expect(200)).body as Record<
      string,
      unknown
    >;
    expect(invoice).toMatchObject({ id: invoiceId, openAmount: '10000.00', paidAmount: '0.00' });
    expect(invoice).not.toHaveProperty('journalEntryId');
    expect(invoice).not.toHaveProperty('customerName');
    await store.api.get(`/invoices/${otherInvoiceId}`).expect(404);
  });

  it('shows the limit, what remains and the hold without its reason', async () => {
    await http()
      .put(`/api/v1/customers/${store.customerId}/credit`)
      .set(bearer(accountant))
      .send({
        creditLimit: '20000',
        settlementGroup: 'DAY_20',
        creditHold: true,
        creditHoldReason: 'Дотоод нууц тайлбар',
      })
      .expect(200);
    const account = await store.api.get('/account').expect(200);
    expect(account.body).toMatchObject({
      creditLimit: '20000.00',
      creditAvailable: '7500.00',
      creditHold: true,
    });
    const check = await store.api.get('/credit-check?amount=10000').expect(200);
    expect(check.body).toMatchObject({ warnings: ['HOLD', 'LIMIT'], excess: '2500.00' });
    for (const body of [account.text, check.text]) {
      expect(body).not.toContain('Дотоод нууц тайлбар');
    }
    await store.api.get('/credit-check?amount=abc').expect(422);
    await http()
      .put(`/api/v1/customers/${store.customerId}/credit`)
      .set(bearer(accountant))
      .send({
        creditLimit: null,
        settlementGroup: 'DAY_20',
        creditHold: false,
        creditHoldReason: null,
      })
      .expect(200);
  });

  it('counts an overdue invoice with its days and warns at the checkout', async () => {
    await sql.query(
      'UPDATE invoices SET invoice_date = $2::date, due_date = $3::date WHERE id = $1',
      [invoiceId, addDays(today, -40), addDays(today, -2)],
    );
    const account = (await store.api.get('/account').expect(200)).body as Record<string, unknown>;
    expect(account).toMatchObject({
      overdueAmount: '10000.00',
      oldestOverdueDate: addDays(today, -2),
      // Everything due by the settlement day, the overdue part within it (ADR-0101 #6).
      settlement: expect.objectContaining({ amountDue: '12500.00', overdueAmount: '10000.00' }),
    });
    const open = (await store.api.get('/invoices').expect(200)).body as { daysOverdue: number }[];
    expect(open[0]?.daysOverdue).toBe(2);
    const check = await store.api.get('/credit-check?amount=1000').expect(200);
    expect(check.body).toMatchObject({ warnings: ['OVERDUE'] });
  });

  it('reminds of invoices due soon and overdue once each, at its own store only', async () => {
    const soon = soonInvoiceId;
    // Sold today, due on the settlement day; brought to two days from now.
    await sql.query('UPDATE invoices SET due_date = $2::date WHERE id = $1', [
      soon,
      addDays(today, 2),
    ]);
    const notifier = app.get(CustomerNotifier);
    const first = await notifier.remindInvoices(today);
    expect(first).toEqual({ dueSoon: 1, overdue: 1 });
    expect(await notifier.remindInvoices(today)).toEqual({ dueSoon: 0, overdue: 0 });
    const own = await notifications(store);
    expect(own.find((row) => row.kind === 'INVOICE_DUE_SOON')).toMatchObject({
      invoiceId: soon,
      payload: { dueDate: addDays(today, 2), openAmount: '2500.00' },
    });
    expect(own.find((row) => row.kind === 'INVOICE_OVERDUE')?.invoiceId).toBe(invoiceId);
    expect((await notifications(other)).some((row) => row.kind.startsWith('INVOICE_'))).toBe(false);
  });

  it('lists the store’s payments with the invoices they settled, and tells the store', async () => {
    const finance = financeApi(app, accountant);
    const cash = await financeApi(app, admin).cashBox('CAA-CASH');
    const payment = (
      await finance
        .payment({
          kind: 'CUSTOMER_PAYMENT',
          moneyAccountId: cash.id,
          customerId: store.customerId,
          amount: '6000',
          paidOn: today,
        })
        .expect(201)
    ).body as { id: number; number: string };
    const page = (await store.api.get('/payments').expect(200)).body as {
      data: Record<string, unknown>[];
      total: number;
    };
    expect(page.total).toBe(1);
    expect(page.data[0]).toEqual({
      id: payment.id,
      number: payment.number,
      kind: 'CUSTOMER_PAYMENT',
      method: 'CASH',
      amount: '6000.00',
      paidOn: today,
      invoices: [{ invoiceId, number: expect.any(String), amount: '6000.00' }],
    });
    const notice = (await notifications(store)).find((row) => row.kind === 'PAYMENT_RECORDED');
    expect(notice).toMatchObject({
      paymentId: payment.id,
      payload: { paymentNumber: payment.number, amount: '6000.00', method: 'CASH' },
    });
    expect((await other.api.get('/payments').expect(200)).body).toMatchObject({ total: 0 });
    const invoice = await store.api.get(`/invoices/${invoiceId}`).expect(200);
    expect(invoice.body).toMatchObject({ paidAmount: '6000.00', openAmount: '4000.00' });
  });

  it('gives the store its own statement: opening, debits, credits, running and closing balances', async () => {
    const [cash] = (
      await sql.query<{ id: string }>("SELECT id FROM fin.money_accounts WHERE code = 'CAA-CASH'")
    ).rows;
    if (!cash) throw new Error('no cash box');
    // A payment dated yesterday: before a statement of today, inside one from yesterday.
    await financeApi(app, accountant)
      .payment({
        kind: 'CUSTOMER_PAYMENT',
        moneyAccountId: Number.parseInt(cash.id, 10),
        customerId: store.customerId,
        amount: '1000',
        paidOn: addDays(today, -1),
      })
      .expect(201);
    const statement = (from: string, to: string, target: AppStore = store) =>
      target.api.get(`/statement?from=${from}&to=${to}`);

    const todays = (await statement(today, today).expect(200)).body as {
      opening: string;
      entries: Record<string, unknown>[];
      totalDebit: string;
      totalCredit: string;
      closing: string;
    };
    expect(todays.opening).toBe('-1000.00');
    expect(
      todays.entries.map((entry) => [entry.kind, entry.debit, entry.credit, entry.balance]),
    ).toEqual([
      ['INVOICE', '10000.00', '0.00', '9000.00'],
      ['INVOICE', '2500.00', '0.00', '11500.00'],
      ['PAYMENT', '0.00', '6000.00', '5500.00'],
    ]);
    expect(todays.entries[0]).toMatchObject({ date: today, invoiceId, number: expect.any(String) });
    expect(todays.entries[2]).toMatchObject({ invoiceId: null });
    // Who took each purchase's order (the owner 2026-10-20): here the app.
    expect(todays.entries[0]).toMatchObject({
      orderChannel: 'CUSTOMER_APP',
      orderNumber: expect.any(String),
      orderTakerName: null,
    });
    expect(todays.entries[2]).toMatchObject({ orderId: null, orderChannel: null });
    const invoice = (await store.api.get(`/invoices/${invoiceId}`).expect(200)).body as Record<
      string,
      unknown
    >;
    expect(invoice).toMatchObject({ orderChannel: 'CUSTOMER_APP', orderTakerName: null });
    expect(todays).toMatchObject({
      totalDebit: '12500.00',
      totalCredit: '6000.00',
      closing: '5500.00',
    });

    const twoDays = (await statement(addDays(today, -1), today).expect(200)).body as typeof todays;
    expect(twoDays.opening).toBe('0.00');
    expect(twoDays.entries.map((entry) => entry.kind)).toEqual([
      'PAYMENT',
      'INVOICE',
      'INVOICE',
      'PAYMENT',
    ]);
    expect(twoDays).toMatchObject({ totalCredit: '7000.00', closing: '5500.00' });

    const quiet = (await statement(addDays(today, -30), addDays(today, -2)).expect(200)).body;
    expect(quiet).toMatchObject({ opening: '0.00', entries: [], closing: '0.00' });
    const others = (await statement(today, today, other).expect(200)).body as typeof todays;
    expect(others).toMatchObject({ opening: '0.00', totalDebit: '2500.00', closing: '2500.00' });

    await statement(today, addDays(today, 1)).expect(422);
    await statement(today, addDays(today, -1)).expect(422);
    await statement(addDays(today, -366), today).expect(422);
    await statement(addDays(today, -365), today).expect(200);
    await store.api.get('/statement').expect(422);
  });

  it('lists only the active bank accounts finance shows to customers', async () => {
    const finance = financeApi(app, admin);
    const bankGl = await finance.account('110101');
    const cashGl = await finance.account('100101');
    const shown = (
      await finance
        .createMoneyAccount({
          code: 'KHAN-1',
          name: 'Хаан банк',
          kind: 'BANK',
          bankName: 'Хаан банк',
          bankAccountNo: '5012345678',
          glAccountId: bankGl.id,
          showToCustomers: true,
        })
        .expect(201)
    ).body as { id: number; showToCustomers: boolean };
    expect(shown.showToCustomers).toBe(true);
    await finance
      .createMoneyAccount({
        code: 'GOLOMT-1',
        name: 'Голомт',
        kind: 'BANK',
        glAccountId: bankGl.id,
      })
      .expect(201);
    await finance
      .createMoneyAccount({
        code: 'CASH-X',
        name: 'Касс',
        kind: 'CASH',
        glAccountId: cashGl.id,
        showToCustomers: true,
      })
      .expect(422);
    expect((await store.api.get('/bank-accounts').expect(200)).body).toEqual([
      { id: shown.id, name: 'Хаан банк', bankName: 'Хаан банк', bankAccountNo: '5012345678' },
    ]);
    await finance.patchMoneyAccount(shown.id, { status: 'INACTIVE' }).expect(200);
    expect((await store.api.get('/bank-accounts').expect(200)).body).toEqual([]);
  });

  it('shows the admin’s notices for customers to stores only, and counts their reads', async () => {
    const send = (audience: string) =>
      http()
        .post('/api/v1/app-notices')
        .set(bearer(admin))
        .set(idempotency())
        .send({ ...noticeBody({ title: `Зарлал ${audience}` }), audience })
        .expect(201);
    const forStores = (await send('CUSTOMERS')).body as { id: number; recipients: number };
    const forReps = (await send('SALES_REPS')).body as { id: number; audience: string };
    expect(forReps.audience).toBe('SALES_REPS');
    expect(forStores.recipients).toBe(2);
    const summary = (await store.api.get('/notifications/summary').expect(200)).body as {
      unread: number;
      notices: { id: number; read: boolean }[];
    };
    expect(summary.notices.map((notice) => notice.id)).toEqual([forStores.id]);
    await store.api
      .post('/notifications/read', { noticeIds: [forStores.id, forReps.id] })
      .expect(200);
    const list = (await http().get('/api/v1/app-notices').set(bearer(admin)).expect(200)).body as {
      data: { id: number; reads: number }[];
    };
    expect(list.data.find((notice) => notice.id === forStores.id)?.reads).toBe(1);
    expect(list.data.find((notice) => notice.id === forReps.id)?.reads).toBe(0);
    const rep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    const repSummary = (
      await http().get('/api/v1/me/notifications/summary').set(bearer(rep)).expect(200)
    ).body as { notices: { id: number }[] };
    expect(repSummary.notices.map((notice) => notice.id)).toEqual([forReps.id]);
  });

  it('keeps the company’s contact list for «Холбоо барих»', async () => {
    const save = (token: string, contacts: object[]) =>
      http().put('/api/v1/customer/contacts').set(bearer(token)).send({ contacts });
    const saved = (
      await save(admin, [
        { role: 'Захиалга, оффис', name: 'Сараа', phone: '99112233', shown: true },
        { role: 'Нягтлан бодогч', name: 'Болд', phone: '+97688112233', shown: false },
        { role: 'Агуулах, хүргэлт', name: 'Дорж', phone: '95112233', shown: true },
      ]).expect(200)
    ).body as { name: string; phone: string }[];
    expect(saved.map((contact) => contact.phone)).toEqual([
      '+97699112233',
      '+97688112233',
      '+97695112233',
    ]);
    expect(
      ((await store.api.get('/contacts').expect(200)).body as { name: string }[]).map(
        (contact) => contact.name,
      ),
    ).toEqual(['Сараа', 'Дорж']);
    await save(admin, [{ role: 'Оффис', name: 'Сараа', phone: '123', shown: true }]).expect(422);
    await save(accountant, []).expect(403);
    await http().get('/api/v1/customer/contacts').set(bearer(accountant)).expect(200);
    await save(admin, []).expect(200);
    expect((await store.api.get('/contacts').expect(200)).body).toEqual([]);
  });
});
