import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeDaySummary,
  EdgeLoginResponse,
  EdgePairResponse,
  EdgePrintableReceipt,
  EdgeSaleListItem,
  EdgeSession,
  EdgeShiftSummary,
  SnapshotPaymentType,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { ArLedgerService } from '../../src/modules/finance';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { FakePosapi } from '../harness/fake-posapi';
import { financeApi } from '../harness/finance';
import { bearer } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { posActors, posStore } from '../harness/pos';

interface PaymentTypeJson {
  id: number;
  name: string;
  kind: string;
  status: string;
  sort: number;
}

/**
 * The till's payment types, rows, history and day summary (ADR-0111) against a fake PosAPI and a
 * listening centre: the admin's types in the snapshot; a sale paid in cash and by bank transfer
 * (PosAPI's BANK_TRANSFER, the tenders' type names at the centre, the shift's entry on the
 * transfer clearing account); credit with a transfer; the till's history of a day; the day summary
 * by payment type, its banknote count kept on the edge and replayed to the centre once.
 */
describe('pos payment types and the till day', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let posapi: FakePosapi;
  let store: Awaited<ReturnType<typeof posStore>>;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let cola: ProductJson;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let shop: CustomerJson;
  let types: SnapshotPaymentType[];
  const today = businessDate();

  const lines = (qty: string) => [{ productUnitId: unitOf(cola, 'PCS').id, qty }];
  const typeOf = (kind: string) => {
    const found = types.find((type) => type.kind === kind);
    if (!found) throw new Error(`no ${kind} type`);
    return found;
  };
  const centre = () => request(central.getHttpServer());

  beforeAll(async () => {
    posapi = new FakePosapi();
    await posapi.start();
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    actors = await posActors(central);
    store = await posStore(central, actors.admin, 'PY');
    await store.pos
      .setSettings({ ebarimtDistrictCode: '1234', ebarimtClassificationCode: '1234567' })
      .expect(200);
    cola = await store.product('9341', 'Кола төлбөр', '1000', '100');
    shop = await partnersApi(central, actors.admin).customer({ name: 'Төлбөрийн дэлгүүр PY' });
    await centre()
      .put(`/api/v1/customers/${shop.id}/credit`)
      .set(bearer(actors.admin))
      .send({ creditLimit: '100000', settlementGroup: 'DAY_20', creditHold: false })
      .expect(200);
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
      ebarimt: { posapiUrl: posapi.url, lookupUrl: posapi.url, timeoutMs: 1_500 },
    });
    kiosk = kioskApi(edge);
    sync = edge.get(SyncRunner);
  });
  afterAll(async () => {
    await edge?.close();
    await posapi?.stop();
    if (central) {
      await expectReconciled(central);
      expect((await central.get(ArLedgerService).reconcile('MANUAL')).status).toBe('OK');
      await central.close();
    }
  });

  it('keeps the admin’s payment types in order and refuses a second cash type', async () => {
    const seeded = (await centre().get('/api/v1/pos/payment-types').set(bearer(actors.admin)))
      .body as PaymentTypeJson[];
    expect(seeded.map((type) => type.kind)).toEqual(['CASH', 'CARD', 'TRANSFER', 'CREDIT']);
    const rows = seeded.map((type) => ({
      id: type.id,
      name: type.name,
      kind: type.kind,
      status: type.status,
    }));
    await centre()
      .put('/api/v1/pos/payment-types')
      .set(bearer(actors.admin))
      .send({ types: [...rows, { id: null, name: 'Бас бэлэн', kind: 'CASH', status: 'ACTIVE' }] })
      .expect(422);
    const saved = (
      await centre()
        .put('/api/v1/pos/payment-types')
        .set(bearer(actors.admin))
        .send({
          types: [...rows, { id: null, name: 'Golomt terminal', kind: 'CARD', status: 'ACTIVE' }],
        })
        .expect(200)
    ).body as PaymentTypeJson[];
    expect(saved.at(-1)).toMatchObject({ name: 'Golomt terminal', kind: 'CARD', sort: 4 });

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
    const session = (await kiosk.get('/session').expect(200)).body as EdgeSession;
    types = session.paymentTypes ?? [];
    expect(types.map((type) => type.name)).toEqual([
      'Бэлэн',
      'Khaanbank terminal',
      'Шилжүүлэг',
      'Зээл',
      'Golomt terminal',
    ]);
  });

  it('takes cash and a bank transfer: PosAPI gets BANK_TRANSFER, the centre the type names', async () => {
    const sold = (
      await kiosk
        .post('/sales', {
          clientId: randomUUID(),
          lines: lines('3'),
          receiptType: 'B2C',
          tenders: [
            { kind: 'CASH', paymentTypeId: typeOf('CASH').id, amount: '1900', tendered: '2000' },
            { kind: 'TRANSFER', paymentTypeId: typeOf('TRANSFER').id, amount: '2000' },
          ],
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    expect(sold.receipt.tenders.map((tender) => tender.name)).toEqual(['Бэлэн', 'Шилжүүлэг']);
    expect(sold.receipt.change).toBe('100.00');
    expect(posapi.receiptPosts().at(-1)?.payments).toEqual([
      { code: 'CASH', status: 'PAID', paidAmount: 1900 },
      { code: 'BANK_TRANSFER', status: 'PAID', paidAmount: 2000 },
    ]);
    await sync.pushOnce();
    const list = await store.pos.sales({ tillId: store.till.id });
    const row = list.data.find((sale) => sale.number === sold.receipt.number);
    const detail = (await store.pos.sale(row?.id ?? 0)) as unknown as {
      tenders: { kind: string; paymentTypeId: number | null; paymentTypeName: string | null }[];
    };
    expect(detail.tenders).toEqual([
      expect.objectContaining({ kind: 'CASH', paymentTypeName: 'Бэлэн' }),
      expect.objectContaining({
        kind: 'TRANSFER',
        paymentTypeId: typeOf('TRANSFER').id,
        paymentTypeName: 'Шилжүүлэг',
      }),
    ]);
  });

  it('refuses a payment type the till does not offer', async () => {
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('1'),
        tenders: [{ kind: 'CASH', paymentTypeId: 999_999, amount: '1300' }],
      })
      .expect(422);
  });

  it('puts part on credit and part by transfer: the invoice is open for the credit only', async () => {
    const sold = (
      await kiosk
        .post('/sales', {
          clientId: randomUUID(),
          lines: lines('2'),
          customerId: shop.id,
          tenders: [
            { kind: 'TRANSFER', paymentTypeId: typeOf('TRANSFER').id, amount: '1000' },
            { kind: 'CREDIT', paymentTypeId: typeOf('CREDIT').id, amount: '1600' },
          ],
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    await sync.pushOnce();
    const list = await store.pos.sales({ tillId: store.till.id });
    const row = list.data.find((sale) => sale.number === sold.receipt.number) as unknown as {
      invoiceId: number;
    };
    const invoice = await financeApi(central, actors.admin).invoice(row.invoiceId);
    expect(invoice).toMatchObject({ total: '2600.00', openAmount: '1600.00' });
  });

  it('lists the till’s sales of the day and sums the day by payment type', async () => {
    const history = (await kiosk.get(`/sales?day=${today}`).expect(200)).body as EdgeSaleListItem[];
    expect(history).toHaveLength(2);
    expect(history[1]?.payments).toEqual(['Бэлэн', 'Шилжүүлэг']);
    expect((await kiosk.get('/sales?day=2001-01-01').expect(200)).body).toEqual([]);
    await kiosk.get('/sales?day=27-10').expect(422);

    const summary = (await kiosk.get(`/day-summary?day=${today}`).expect(200))
      .body as EdgeDaySummary;
    expect(summary).toMatchObject({
      tillCode: 'К1',
      salesCount: 2,
      returnsCount: 0,
      expectedCash: '11900.00',
      counted: null,
    });
    expect(summary.startedAt).not.toBeNull();
    expect(summary.payments.map((payment) => [payment.name, payment.net])).toEqual([
      ['Бэлэн', '1900.00'],
      ['Шилжүүлэг', '3000.00'],
      ['Зээл', '1600.00'],
    ]);
  });

  it('keeps the banknote count on the edge and replays it to the centre once', async () => {
    const clientId = randomUUID();
    const body = {
      clientId,
      day: today,
      counts: [
        { note: 10_000, count: 1 },
        { note: 1_000, count: 1 },
        { note: 500, count: 1 },
        { note: 100, count: 4 },
        { note: 50, count: 0 },
      ],
    };
    await kiosk.post('/day-summary', { ...body, counts: [{ note: 300, count: 1 }] }).expect(422);
    const counted = (await kiosk.post('/day-summary', body).expect(200)).body as EdgeDaySummary;
    expect(counted.counted).toMatchObject({
      clientId,
      total: '11900.00',
      counts: [
        { note: 10_000, count: 1 },
        { note: 1_000, count: 1 },
        { note: 500, count: 1 },
        { note: 100, count: 4 },
      ],
    });
    await kiosk.post('/day-summary', body).expect(200);
    await sync.pushOnce();
    const kept = (
      await centre()
        .get(`/api/v1/pos/day-counts?tillId=${store.till.id}&from=${today}&to=${today}`)
        .set(bearer(actors.admin))
        .expect(200)
    ).body as { total: string; counts: unknown[] }[];
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ total: '11900.00' });
  });

  it('closes the shift with the transfers on their clearing account', async () => {
    const session = (await kiosk.get('/session').expect(200)).body as EdgeSession;
    expect(session.shift).toMatchObject({ expectedCash: '11900.00', transferSales: '3000.00' });
    expect(session.shift?.payments?.map((payment) => payment.name)).toEqual([
      'Бэлэн',
      'Шилжүүлэг',
      'Зээл',
    ]);
    const closed = (
      await kiosk
        .post('/shifts/close', { countedCash: '11900', floatKept: '10000', note: null })
        .expect(200)
    ).body as EdgeShiftSummary;
    await sync.pushOnce();
    const shifts = await store.pos.shifts({ tillId: store.till.id });
    const shift = shifts.data.find((row) => row.number === closed.number) as unknown as {
      id: number;
      transferSales: string;
      journalEntryId: number;
    };
    expect(shift.transferSales).toBe('3000.00');
    const entry = (await financeApi(central, actors.admin).journalGet(
      shift.journalEntryId,
    )) as unknown as {
      lines: { accountCode?: string; debit: string; credit: string }[];
    };
    // Only the first sale is the shift's: 1 900 cash and 2 000 by transfer (the other is invoiced).
    const debit = entry.lines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0));
    expect(debit.toFixed(2)).toBe('3900.00');
    const detail = (await store.pos.shift(shift.id)) as unknown as {
      payments: { name: string | null; sales: string }[];
    };
    expect(detail.payments.map((payment) => [payment.name, payment.sales])).toEqual([
      ['Бэлэн', '1900.00'],
      ['Шилжүүлэг', '3000.00'],
      ['Зээл', '1600.00'],
    ]);
  });
});
