import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeLoginResponse,
  EdgePairResponse,
  EdgePrintableReceipt,
  EdgeQuoteResponse,
  EdgeReturnSale,
  EdgeShiftSummary,
  EdgeVoucher,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { ArLedgerService } from '../../src/modules/finance';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { FakePosapi } from '../harness/fake-posapi';
import { financeApi } from '../harness/finance';
import { bearer } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { posActors, posStore, saleDoc, saleEvent } from '../harness/pos';

interface BatchJson {
  id: number;
  number: string;
  kind: string;
  status: string;
  redeemed: number;
  codes: { id: number; code: string; status: string; saleNumber: string | null }[];
  uses: {
    id: number;
    code: string;
    amount: string;
    face: string;
    issue: string | null;
    invoiceId: number | null;
    invoiceNumber: string | null;
    reviewedAt: string | null;
  }[];
}

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * The till's coupons and partner vouchers (ADR-0110) against a fake PosAPI and a listening centre:
 * the admin's batches and their feed to the edge; coupons stacked after the discount programs;
 * a partner voucher paying part (or all) of a sale with a VAT receipt to the buyer and the partner
 * billed the full face value; one supervisor PIN per sale; a code taken once (offline too, by the
 * edge's own uses); no credit beside a partner voucher; a return never paying back the vouchers'
 * part; a code the centre finds used twice kept and listed for «Шалгасан»; the shift's close with
 * the vouchers' clearing netting to zero. Synthetic data only; never a real PosAPI.
 */
describe('pos coupons and partner vouchers', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let posapi: FakePosapi;
  let store: Awaited<ReturnType<typeof posStore>>;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let finance: ReturnType<typeof financeApi>;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let cola: ProductJson;
  let partner: CustomerJson;
  let tenPercent: BatchJson;
  let fiveHundred: BatchJson;
  let partnerBatch: BatchJson;
  let later: BatchJson;
  let mixed: EdgePrintableReceipt;
  let whole: EdgePrintableReceipt;

  const today = businessDate();
  const lines = (qty: string) => [{ productUnitId: unitOf(cola, 'PCS').id, qty }];
  const supervisor = { supervisorUserId: 0, pin: '654321' };
  const api = () => request(central.getHttpServer());
  const createBatch = async (body: Record<string, unknown>): Promise<BatchJson> =>
    (
      await api()
        .post('/api/v1/pos/voucher-batches')
        .set(bearer(actors.admin))
        .set(idempotency())
        .send({ validFrom: today, validTo: addDays(today, 30), note: null, ...body })
        .expect(201)
    ).body as BatchJson;
  const batch = async (id: number): Promise<BatchJson> =>
    (await api().get(`/api/v1/pos/voucher-batches/${id}`).set(bearer(actors.admin)).expect(200))
      .body as BatchJson;
  const codeOf = (of: BatchJson, index: number) => {
    const code = of.codes[index]?.code;
    if (!code) throw new Error(`batch ${of.number} has no code ${index}`);
    return code;
  };
  const sell = (body: Record<string, unknown>) =>
    kiosk.post('/sales', { clientId: randomUUID(), ...body });

  beforeAll(async () => {
    posapi = new FakePosapi();
    await posapi.start();
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    actors = await posActors(central);
    finance = financeApi(central, actors.admin);
    store = await posStore(central, actors.admin, 'PV');
    supervisor.supervisorUserId = store.supervisorId;
    await store.pos
      .setSettings({ ebarimtDistrictCode: '1234', ebarimtClassificationCode: '1234567' })
      .expect(200);
    cola = await store.product('9441', 'Кола ваучер', '1000', '100');
    partner = await partnersApi(central, actors.admin).customer({ name: 'Хамтрагч банк PV' });
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
      ebarimt: { posapiUrl: posapi.url, lookupUrl: posapi.url, timeoutMs: 1_500 },
    });
    kiosk = kioskApi(edge);
    sync = edge.get(SyncRunner);
    const code = (await store.pos.pairingCode(store.till.id).expect(200)).body as { code: string };
    expect(await sync.pullOnce()).toBe('changed');
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

  it('creates batches with their codes and feeds them to the edge', async () => {
    tenPercent = await createBatch({
      kind: 'COUPON',
      name: 'Арван хувь',
      effect: 'PERCENT',
      value: '10',
      qty: 3,
    });
    expect(tenPercent).toMatchObject({ kind: 'COUPON', status: 'ACTIVE', redeemed: 0 });
    expect(tenPercent.number).toMatch(/^В-\d{4}$/);
    expect(tenPercent.codes).toHaveLength(3);
    expect(new Set(tenPercent.codes.map((one) => one.code)).size).toBe(3);
    expect(codeOf(tenPercent, 0)).toMatch(/^991\d{13}$/);
    fiveHundred = await createBatch({
      kind: 'COUPON',
      name: 'Таван зуу',
      effect: 'AMOUNT',
      value: '500',
      qty: 2,
    });
    partnerBatch = await createBatch({
      kind: 'PARTNER',
      name: 'Банкны ажилчдад',
      effect: 'AMOUNT',
      value: '5000',
      customerId: partner.id,
      qty: 5,
    });
    expect(codeOf(partnerBatch, 0)).toMatch(/^992\d{13}$/);
    later = await createBatch({
      kind: 'COUPON',
      name: 'Маргаашийн',
      effect: 'PERCENT',
      value: '5',
      qty: 1,
      validFrom: addDays(today, 1),
    });
    // A partner voucher needs its partner, a coupon none; a percentage is at most 100.
    await api()
      .post('/api/v1/pos/voucher-batches')
      .set(bearer(actors.admin))
      .set(idempotency())
      .send({
        kind: 'PARTNER',
        name: 'x',
        effect: 'AMOUNT',
        value: '1000',
        qty: 1,
        validFrom: today,
        validTo: today,
      })
      .expect(422);
    await api()
      .post('/api/v1/pos/voucher-batches')
      .set(bearer(actors.admin))
      .set(idempotency())
      .send({
        kind: 'COUPON',
        name: 'x',
        effect: 'PERCENT',
        value: '120',
        qty: 1,
        validFrom: today,
        validTo: today,
      })
      .expect(422);

    expect(await sync.pullVouchersOnce()).toBe('changed');
    expect(await sync.pullVouchersOnce()).toBe('unchanged');
    const found = (await kiosk.get(`/vouchers/${codeOf(partnerBatch, 0)}`).expect(200))
      .body as EdgeVoucher;
    expect(found).toMatchObject({ kind: 'PARTNER', value: '5000.00', partnerName: partner.name });
    const notYet = await kiosk.get(`/vouchers/${codeOf(later, 0)}`).expect(422);
    expect(notYet.body).toMatchObject({
      code: 'POS_VOUCHER_INVALID',
      params: { reason: 'NOT_YET' },
    });
    const unknown = await kiosk.get('/vouchers/9910000000000000').expect(422);
    expect(unknown.body).toMatchObject({ params: { reason: 'UNKNOWN' } });
  });

  it('stacks coupons after the programs, each on what the last one left', async () => {
    const quote = (
      await kiosk
        .post('/quote', {
          lines: lines('10'),
          codes: [codeOf(tenPercent, 2), codeOf(fiveHundred, 0)],
        })
        .expect(200)
    ).body as EdgeQuoteResponse;
    // 10 × 1 300 = 13 000; 10 % = 1 300; then 500.
    expect(quote).toMatchObject({
      subtotal: '13000.00',
      discountTotal: '1800.00',
      total: '11200.00',
      voucherTotal: '0.00',
      due: '11200.00',
    });
    expect(quote.vouchers?.map((one) => one.amount)).toEqual(['1300.00', '500.00']);
  });

  it('sells with a coupon, a partner voucher and cash, once with a supervisor', async () => {
    const body = {
      lines: lines('10'),
      codes: [codeOf(tenPercent, 0), codeOf(partnerBatch, 0)],
      tenders: [{ kind: 'CASH', amount: '6700', tendered: '7000' }],
    };
    const quote = (await kiosk.post('/quote', { lines: body.lines, codes: body.codes }).expect(200))
      .body as EdgeQuoteResponse;
    expect(quote).toMatchObject({ total: '11700.00', voucherTotal: '5000.00', due: '6700.00' });
    const refused = await sell(body).expect(403);
    expect(refused.body).toMatchObject({ code: 'POS_SUPERVISOR_REQUIRED' });
    mixed = (await sell({ ...body, voucherApproval: supervisor }).expect(200))
      .body as EdgePrintableReceipt;
    expect(mixed.receipt).toMatchObject({ total: '11700.00', change: '300.00' });
    expect(mixed.receipt.tenders).toEqual([
      { kind: 'CASH', name: 'Бэлэн', amount: '6700.00', tendered: '7000.00' },
      { kind: 'VOUCHER', name: null, amount: '5000.00', tendered: null },
    ]);
    expect(mixed.receipt.vouchers?.map((one) => [one.kind, one.amount])).toEqual([
      ['COUPON', '1300.00'],
      ['PARTNER', '5000.00'],
    ]);
    // A VAT receipt to the buyer for the whole sale, the voucher's part sent as cash (TODO-VERIFY).
    const posted = posapi.receiptPosts().at(-1) as {
      totalAmount: number;
      payments: { code: string; paidAmount: number }[];
    };
    expect(posted.totalAmount).toBe(11700);
    expect(posted.payments).toEqual([{ code: 'CASH', status: 'PAID', paidAmount: 11700 }]);
  });

  it('never takes a code twice, before the centre has heard of it too', async () => {
    const coupon = await kiosk
      .post('/quote', { lines: lines('1'), codes: [codeOf(tenPercent, 0)] })
      .expect(422);
    expect(coupon.body).toMatchObject({ params: { reason: 'USED' } });
    const voucher = await sell({
      lines: lines('1'),
      codes: [codeOf(partnerBatch, 0)],
      tenders: [],
      voucherApproval: supervisor,
    }).expect(422);
    expect(voucher.body).toMatchObject({ params: { reason: 'USED' } });
    const twice = await kiosk
      .post('/quote', { lines: lines('1'), codes: [codeOf(tenPercent, 1), codeOf(tenPercent, 1)] })
      .expect(422);
    expect(twice.body).toMatchObject({ params: { reason: 'USED' } });
  });

  it('refuses credit beside a partner voucher', async () => {
    const res = await sell({
      lines: lines('5'),
      codes: [codeOf(partnerBatch, 1)],
      tenders: [{ kind: 'CREDIT', amount: '1500' }],
      customerId: partner.id,
      voucherApproval: supervisor,
    }).expect(422);
    expect(res.body).toMatchObject({ code: 'POS_VOUCHER_WITH_CREDIT' });
  });

  it('pays a whole sale by two vouchers: the second pays the rest, nothing is tendered', async () => {
    whole = (
      await sell({
        lines: lines('7'),
        codes: [codeOf(partnerBatch, 1), codeOf(partnerBatch, 2)],
        tenders: [],
        voucherApproval: supervisor,
      }).expect(200)
    ).body as EdgePrintableReceipt;
    expect(whole.receipt.total).toBe('9100.00');
    expect(whole.receipt.tenders).toEqual([
      { kind: 'VOUCHER', name: null, amount: '5000.00', tendered: null },
      { kind: 'VOUCHER', name: null, amount: '4100.00', tendered: null },
    ]);
    // Coupons first, whatever the order scanned: 1 300 − 500 − 10 %, the voucher pays the rest.
    const third = await kiosk
      .post('/quote', {
        lines: lines('1'),
        codes: [codeOf(partnerBatch, 3), codeOf(fiveHundred, 1), codeOf(tenPercent, 1)],
      })
      .expect(200);
    expect((third.body as EdgeQuoteResponse).due).toBe('0.00');
    // A second voucher with nothing left to pay is refused.
    const nothing = await kiosk
      .post('/quote', {
        lines: lines('1'),
        codes: [codeOf(partnerBatch, 3), codeOf(partnerBatch, 4)],
      })
      .expect(422);
    expect(nothing.body).toMatchObject({ params: { reason: 'NOTHING_DUE' } });
  });

  it('bills the partner the full face value of its vouchers at the centre', async () => {
    await sync.pushOnce();
    const after = await batch(partnerBatch.id);
    expect(after.redeemed).toBe(3);
    expect(after.uses).toHaveLength(3);
    expect(after.uses.every((use) => use.issue === null && use.invoiceId !== null)).toBe(true);
    const invoices = [...new Set(after.uses.map((use) => use.invoiceId ?? 0))];
    expect(invoices).toHaveLength(2);
    const bills = await Promise.all(invoices.map((id) => finance.invoice(id)));
    expect(bills.map((bill) => bill.total).sort()).toEqual(['10000.00', '5000.00']);
    expect(bills.every((bill) => bill.customerId === partner.id && bill.vatTotal === '0.00')).toBe(
      true,
    );
    expect((await finance.balance(partner.id)).balance).toBe('15000.00');
    // The second sale left 900 of its last voucher unspent: the partner pays it all the same.
    expect((await finance.account('511040')).credit).toBe('900.00');
    const coupons = await batch(tenPercent.id);
    expect(coupons.codes[0]).toMatchObject({
      status: 'REDEEMED',
      saleNumber: mixed.receipt.number,
    });
  });

  it('never pays back the vouchers’ part of a return', async () => {
    const found = (
      await kiosk.get(`/returns/sale?number=${encodeURIComponent(mixed.receipt.number)}`)
    ).body as EdgeReturnSale;
    expect(found.refundable).toBe('6700.00');
    const all = await kiosk
      .post('/returns', {
        clientId: randomUUID(),
        refundsSaleClientId: mixed.receipt.clientId,
        lines: [{ refundsLineNo: 1, qty: '10', damaged: false }],
        approval: supervisor,
      })
      .expect(409);
    expect(all.body).toMatchObject({
      code: 'POS_RETURN_VOUCHER_PART',
      params: { refundable: '6700.00' },
    });
    // Half the goods: 5 × 1 300 less half the coupon's 1 300, paid back in cash.
    const half = (
      await kiosk
        .post('/returns', {
          clientId: randomUUID(),
          refundsSaleClientId: mixed.receipt.clientId,
          lines: [{ refundsLineNo: 1, qty: '5', damaged: false }],
          approval: supervisor,
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    expect(half.receipt.tenders).toEqual([{ kind: 'CASH', amount: '5850.00', tendered: null }]);
    const wholeBack = await kiosk
      .post('/returns', {
        clientId: randomUUID(),
        refundsSaleClientId: whole.receipt.clientId,
        lines: [{ refundsLineNo: 1, qty: '1', damaged: false }],
        approval: supervisor,
      })
      .expect(409);
    expect(wholeBack.body).toMatchObject({ params: { refundable: '0.00' } });
    await sync.pushOnce();
  });

  it('closes the shift: the vouchers’ part on the clearing, which the bills empty', async () => {
    const closed = (
      await kiosk
        .post('/shifts/close', { countedCash: '10850', floatKept: '10000', note: null })
        .expect(200)
    ).body as EdgeShiftSummary;
    // Float 10 000 + cash 6 700 − 5 850 paid back.
    expect(closed).toMatchObject({ status: 'CLOSED', variance: '0.00', voucherSales: '14100.00' });
    await sync.pushOnce();
    const shifts = await store.pos.shifts({ tillId: store.till.id });
    const shift = shifts.data.find((row) => row.number === closed.number);
    expect(shift).toMatchObject({ status: 'CLOSED', variance: '0.00' });
    expect((shift as unknown as { voucherSales: string }).voucherSales).toBe('14100.00');
    const clearing = await finance.account('120303');
    expect(new Decimal(clearing.debit).toFixed(2)).toBe('14100.00');
    expect(new Decimal(clearing.balance).toFixed(2)).toBe('0.00');
  });

  it('keeps a sale whose code the centre finds used, and lists it for «Шалгасан»', async () => {
    const opened = await store.openShift('0', 2);
    const doc = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId: opened.clientId,
        cashierUserId: store.cashierId,
        number: `${store.till.code}-${today.replace(/-/g, '').slice(2)}-0901`,
      },
      (product) => store.retailPrice(product),
    );
    const used = (await batch(tenPercent.id)).codes[0];
    const [outcome] = await store.replay([
      saleEvent({
        ...doc,
        vouchers: [
          { voucherId: used?.id, code: used?.code, kind: 'COUPON', face: '10.00', amount: '0.00' },
        ],
      }),
    ]);
    expect(outcome).toMatchObject({ status: 'APPLIED' });
    const toCheck = (await store.pos.attention()) as unknown as { vouchersToCheck: number };
    expect(toCheck.vouchersToCheck).toBe(1);
    const uses = (await batch(tenPercent.id)).uses;
    const flagged = uses.find((use) => use.issue === 'USED');
    expect(flagged).toBeDefined();
    await api()
      .post(`/api/v1/pos/sale-vouchers/${flagged?.id ?? 0}/review`)
      .set(bearer(actors.admin))
      .send({ note: 'Туршилт' })
      .expect(200);
    expect(
      ((await store.pos.attention()) as unknown as { vouchersToCheck: number }).vouchersToCheck,
    ).toBe(0);
    await store.replay([
      {
        kind: 'SHIFT_CLOSED',
        clientId: opened.clientId,
        shiftClosed: {
          clientId: opened.clientId,
          closedAt: new Date().toISOString(),
          countedCash: doc.total,
          floatKept: '0',
          note: null,
        },
      },
    ]);
  });

  it('stops a batch: its unused codes leave the till', async () => {
    await api()
      .post(`/api/v1/pos/voucher-batches/${fiveHundred.id}/stop`)
      .set(bearer(actors.admin))
      .expect(200);
    expect(await sync.pullVouchersOnce()).toBe('changed');
    const gone = await kiosk.get(`/vouchers/${codeOf(fiveHundred, 1)}`).expect(422);
    expect(gone.body).toMatchObject({ params: { reason: 'UNKNOWN' } });
  });
});
