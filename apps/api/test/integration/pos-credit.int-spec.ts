import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  EdgeCustomer,
  EdgeLoginResponse,
  EdgePairResponse,
  EdgePrintableReceipt,
  EdgeReturnSale,
  EdgeSession,
  EdgeShiftSummary,
} from '@tugeel/shared/pos';
import { Decimal } from '@tugeel/shared/money';
import request from 'supertest';
import { ArLedgerService } from '../../src/modules/finance';
import { CentralClient, CentralError } from '../../src/edge/services/central.client';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { FAKE_BUYER, FakePosapi } from '../harness/fake-posapi';
import { financeApi } from '../harness/finance';
import { bearer } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { posActors, posStore } from '../harness/pos';

interface CreditSaleJson {
  id: number;
  number: string;
  kind: string;
  total: string;
  creditAmount: string;
  creditCustomerId: number | null;
  creditDocNumber: string | null;
  invoiceId: number | null;
  creditNoteId: number | null;
  creditExcess: string | null;
  creditReviewedAt: string | null;
  ebarimtStatus: string;
  tenders?: { kind: string; amount: string }[];
}

/**
 * The till's payment step (ADR-0109) against a fake PosAPI and a listening centre: a sale wholly
 * or partly on a registered customer's credit — no e-Barimt, an invoice at the centre for the
 * customer's receivable, the supermarket's revenue; the credit check online (no tolerance) and
 * offline (the feed it pulled last: a hold refused, a passed limit warned, then sold and flagged
 * at the centre); a return of a credit sale off the debt first, the rest in cash; the receipt
 * type chosen by the cashier; and the shift's close leaving the invoiced sales to their invoices.
 * Synthetic data only; never a real PosAPI.
 */
describe('pos credit sales and the payment step', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let posapi: FakePosapi;
  let store: Awaited<ReturnType<typeof posStore>>;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let finance: ReturnType<typeof financeApi>;
  let cola: ProductJson;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let shop: CustomerJson;
  let held: CustomerJson;
  let small: CustomerJson;
  let creditOnly: EdgePrintableReceipt;
  let mixed: EdgePrintableReceipt;

  const colaUnit = () => unitOf(cola, 'PCS').id;
  const lines = (qty: string) => [{ productUnitId: colaUnit(), qty }];
  const setCredit = (customer: CustomerJson, creditLimit: string | null, creditHold = false) =>
    request(central.getHttpServer())
      .put(`/api/v1/customers/${customer.id}/credit`)
      .set(bearer(actors.admin))
      .send({
        creditLimit,
        settlementGroup: 'DAY_20',
        creditHold,
        creditHoldReason: creditHold ? 'туршилт' : null,
      })
      .expect(200);
  const centreSale = async (number: string): Promise<CreditSaleJson> => {
    await sync.pushOnce();
    const list = await store.pos.sales({ tillId: store.till.id });
    const row = list.data.find((sale) => sale.number === number);
    if (!row) throw new Error(`sale ${number} not at the centre`);
    return (await store.pos.sale(row.id)) as unknown as CreditSaleJson;
  };
  const offline = () =>
    jest
      .spyOn(edge.get(CentralClient), 'creditCheck')
      .mockRejectedValue(new CentralError('centre unreachable: test', null, null));

  beforeAll(async () => {
    posapi = new FakePosapi();
    await posapi.start();
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    actors = await posActors(central);
    finance = financeApi(central, actors.admin);
    store = await posStore(central, actors.admin, 'PZ');
    await store.pos
      .setSettings({ ebarimtDistrictCode: '1234', ebarimtClassificationCode: '1234567' })
      .expect(200);
    cola = await store.product('9331', 'Кола зээл', '1000', '100');
    const partners = partnersApi(central, actors.admin);
    shop = await partners.customer({ name: 'Зээлийн дэлгүүр PZ', phone: '99110001' });
    held = await partners.customer({ name: 'Хаалттай дэлгүүр PZ' });
    small = await partners.customer({ name: 'Бага лимит PZ' });
    await setCredit(shop, '50000');
    await setCredit(held, null, true);
    await setCredit(small, '10000');
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
      ebarimt: { posapiUrl: posapi.url, lookupUrl: posapi.url, timeoutMs: 1_500 },
    });
    kiosk = kioskApi(edge);
    sync = edge.get(SyncRunner);
    expect(await sync.pullOnce()).toBe('changed');
    const code = (await store.pos.pairingCode(store.till.id).expect(200)).body as { code: string };
    const paired = (
      await kiosk.post('/pair', { tillCode: 'К1', pairingCode: code.code }).expect(200)
    ).body as EdgePairResponse;
    kiosk.setDevice(paired.deviceToken);
    const login = (
      await kiosk.post('/auth/pin', { userId: store.cashierId, pin: '123456' }).expect(200)
    ).body as EdgeLoginResponse;
    kiosk.setSession(login.token);
    await kiosk.post('/shifts/open', { openingFloat: '10000' }).expect(200);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await edge?.close();
    await posapi?.stop();
    if (central) {
      await expectReconciled(central);
      const run = await central.get(ArLedgerService).reconcile('MANUAL');
      expect(run.status).toBe('OK');
      await central.close();
    }
  });

  it('finds the customers of the feed with what is left of their limits', async () => {
    const found = (await kiosk.get(`/customers?q=${encodeURIComponent(shop.code)}`).expect(200))
      .body as EdgeCustomer[];
    expect(found[0]).toMatchObject({
      id: shop.id,
      name: 'Зээлийн дэлгүүр PZ',
      creditLimit: '50000.00',
      available: '50000.00',
      creditHold: false,
    });
    const byPhone = (await kiosk.get('/customers?q=99110001').expect(200)).body as EdgeCustomer[];
    expect(byPhone.map((customer) => customer.id)).toContain(shop.id);
    expect(await sync.pullCustomersOnce()).toBe('unchanged');
  });

  it('sells wholly on credit without an e-Barimt; the centre invoices the customer', async () => {
    const before = posapi.receiptPosts().length;
    creditOnly = (
      await kiosk
        .post('/sales', {
          clientId: randomUUID(),
          lines: lines('2'),
          tenders: [{ kind: 'CREDIT', amount: '2600' }],
          customerId: shop.id,
          receiptType: 'B2B',
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    expect(creditOnly.receipt.credit).toMatchObject({ customerId: shop.id, amount: '2600.00' });
    expect(creditOnly.receipt.ebarimt).toMatchObject({ ddtd: null, status: 'NONE' });
    expect(creditOnly.print).toBeNull();
    expect(posapi.receiptPosts()).toHaveLength(before);
    const sale = await centreSale(creditOnly.receipt.number);
    expect(sale).toMatchObject({
      creditAmount: '2600.00',
      creditCustomerId: shop.id,
      creditExcess: null,
      ebarimtStatus: 'NONE',
    });
    expect(sale.creditDocNumber).not.toBeNull();
    const invoice = await finance.invoice(sale.invoiceId ?? 0);
    expect(invoice).toMatchObject({
      customerId: shop.id,
      orderId: null,
      orderNumber: sale.number,
      paymentMethod: 'CREDIT',
      total: '2600.00',
      openAmount: '2600.00',
      cityTaxTotal: '0.00',
    });
    expect((await finance.balance(shop.id)).balance).toBe('2600.00');
  });

  it('takes part in cash and the rest on credit: the invoice is open for the credit part', async () => {
    mixed = (
      await kiosk
        .post('/sales', {
          clientId: randomUUID(),
          lines: lines('3'),
          tenders: [
            { kind: 'CASH', amount: '1000', tendered: '1000' },
            { kind: 'CREDIT', amount: '2900' },
          ],
          customerId: shop.id,
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    const sale = await centreSale(mixed.receipt.number);
    expect(sale.creditAmount).toBe('2900.00');
    const invoice = await finance.invoice(sale.invoiceId ?? 0);
    expect(invoice).toMatchObject({ total: '3900.00', openAmount: '2900.00' });
    expect((await finance.balance(shop.id)).balance).toBe('5500.00');
    const [again] = (await kiosk.get(`/customers?q=${encodeURIComponent(shop.code)}`).expect(200))
      .body as EdgeCustomer[];
    expect(again?.available).toBe('44500.00');
  });

  it('refuses credit without a customer, past a limit online and on a hold', async () => {
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('1'),
        tenders: [{ kind: 'CREDIT', amount: '1300' }],
      })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('POS_CUSTOMER_REQUIRED'));
    const over = await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('10'),
        tenders: [{ kind: 'CREDIT', amount: '13000' }],
        customerId: small.id,
      })
      .expect(409);
    expect(over.body).toMatchObject({
      code: 'CREDIT_BLOCKED',
      params: { reason: 'LIMIT', excess: '3000.00' },
    });
    const hold = await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('1'),
        tenders: [{ kind: 'CREDIT', amount: '1300' }],
        customerId: held.id,
      })
      .expect(409);
    expect(hold.body).toMatchObject({ code: 'CREDIT_BLOCKED', params: { reason: 'HOLD' } });
  });

  it('issues the receipt the cashier chose: a company needs its buyer', async () => {
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('1'),
        tenders: [{ kind: 'CASH', amount: '1300' }],
        receiptType: 'B2B',
      })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('POS_BUYER_REQUIRED'));
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('1'),
        tenders: [{ kind: 'CARD', amount: '1300' }],
        receiptType: 'B2C',
        buyer: { tin: FAKE_BUYER.tin },
      })
      .expect(200);
    expect(posapi.receiptPosts().at(-1)).toMatchObject({ type: 'B2C_RECEIPT', customerTin: null });
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('1'),
        tenders: [{ kind: 'CASH', amount: '1300' }],
        receiptType: 'B2B',
        buyer: { tin: FAKE_BUYER.tin },
      })
      .expect(200);
    expect(posapi.receiptPosts().at(-1)).toMatchObject({
      type: 'B2B_RECEIPT',
      customerTin: FAKE_BUYER.tin,
    });
  });

  it('offline: warns past the limit, sells when the cashier goes on, the centre flags it', async () => {
    offline();
    const body = {
      lines: lines('9'),
      tenders: [{ kind: 'CREDIT', amount: '11700' }],
      customerId: small.id,
    };
    const warned = await kiosk.post('/sales', { clientId: randomUUID(), ...body }).expect(409);
    expect(warned.body).toMatchObject({
      code: 'POS_CREDIT_OFFLINE_OVER_LIMIT',
      params: { available: '10000.00', excess: '1700.00' },
    });
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('1'),
        tenders: [{ kind: 'CREDIT', amount: '1300' }],
        customerId: held.id,
      })
      .expect(409)
      .expect((res) => expect(res.body.params.reason).toBe('HOLD'));
    const sold = (
      await kiosk
        .post('/sales', { clientId: randomUUID(), ...body, acceptOverLimit: true })
        .expect(200)
    ).body as EdgePrintableReceipt;
    jest.restoreAllMocks();
    const sale = await centreSale(sold.receipt.number);
    expect(sale).toMatchObject({ creditAmount: '11700.00', creditExcess: '1700.00' });
    expect((await store.pos.attention()) as unknown as { creditToCheck: number }).toMatchObject({
      creditToCheck: 1,
    });
    const listed = await store.pos.sales({ creditToCheck: true });
    expect(listed.data.map((row) => row.id)).toEqual([sale.id]);
    const reviewed = await request(central.getHttpServer())
      .post(`/api/v1/pos/sales/${sale.id}/credit-review`)
      .set(bearer(actors.admin))
      .send({ note: 'Эзэнтэй ярьсан' })
      .expect(200);
    expect(reviewed.body.creditReviewedAt).not.toBeNull();
    expect((await store.pos.attention()) as unknown as { creditToCheck: number }).toMatchObject({
      creditToCheck: 0,
    });
  });

  it('takes a credit sale back off the debt first, the rest in cash', async () => {
    const found = (
      await kiosk.get(`/returns/sale?number=${encodeURIComponent(creditOnly.receipt.number)}`)
    ).body as EdgeReturnSale;
    expect(found.credit).toMatchObject({ left: '2600.00' });
    const first = (
      await kiosk
        .post('/returns', {
          clientId: randomUUID(),
          refundsSaleClientId: creditOnly.receipt.clientId,
          lines: [{ refundsLineNo: 1, qty: '1', damaged: false }],
          approval: { supervisorUserId: store.supervisorId, pin: '654321' },
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    expect(first.receipt.tenders).toEqual([{ kind: 'CREDIT', amount: '1300.00', tendered: null }]);
    const back = await centreSale(first.receipt.number);
    expect(back).toMatchObject({ kind: 'RETURN', creditAmount: '1300.00' });
    expect(back.creditNoteId).not.toBeNull();
    expect((await finance.balance(shop.id)).balance).toBe('4200.00');

    const all = (
      await kiosk
        .post('/returns', {
          clientId: randomUUID(),
          refundsSaleClientId: mixed.receipt.clientId,
          lines: [{ refundsLineNo: 1, qty: '3', damaged: false }],
          approval: { supervisorUserId: store.supervisorId, pin: '654321' },
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    expect(all.receipt.tenders).toEqual([
      { kind: 'CREDIT', amount: '2900.00', tendered: null },
      { kind: 'CASH', amount: '1000.00', tendered: null },
    ]);
    const mixedBack = await centreSale(all.receipt.number);
    expect(mixedBack.creditAmount).toBe('2900.00');
    expect((await finance.balance(shop.id)).balance).toBe('1300.00');
  });

  it('closes the shift: the drawer is counted as ever, the credit shown apart', async () => {
    const session = (await kiosk.get('/session').expect(200)).body as EdgeSession;
    // Float 10 000 + cash 1 000 (mixed) + 1 300 (company receipt) − 1 000 paid back.
    expect(session.shift).toMatchObject({
      expectedCash: '11300.00',
      creditSales: '17200.00',
      creditRefunds: '4200.00',
    });
    const closed = (
      await kiosk
        .post('/shifts/close', { countedCash: '11300', floatKept: '10000', note: null })
        .expect(200)
    ).body as EdgeShiftSummary;
    expect(closed).toMatchObject({ status: 'CLOSED', variance: '0.00' });
    await sync.pushOnce();
    const shifts = await store.pos.shifts({ tillId: store.till.id });
    const shift = shifts.data.find((row) => row.number === closed.number);
    expect(shift).toMatchObject({
      status: 'CLOSED',
      expectedCash: '11300.00',
      variance: '0.00',
      creditSales: '17200.00',
      creditRefunds: '4200.00',
    });
    expect(shift?.journalEntryId).not.toBeNull();
    // The entry books only the sales without an invoice: the company receipt's 1 300 in cash and
    // the citizen's 1 300 by card; the invoices booked the rest.
    const entry = (await finance.journalGet(shift?.journalEntryId ?? 0)) as unknown as {
      lines: { debit: string; credit: string }[];
    };
    const debit = entry.lines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0));
    expect(debit.toFixed(2)).toBe('2600.00');
  });
});
