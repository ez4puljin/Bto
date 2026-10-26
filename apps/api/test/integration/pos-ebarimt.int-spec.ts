import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  EdgeEbarimtQueue,
  EdgeHealth,
  EdgeLoginResponse,
  EdgePairResponse,
  EdgePrintableReceipt,
  EdgeReturnSale,
  EdgeTaxpayer,
} from '@tugeel/shared/pos';
import { sql } from 'drizzle-orm';
import { EbarimtService } from '../../src/edge/ebarimt/ebarimt.service';
import { EDGE_DB, type EdgeDb } from '../../src/edge/db/edge-db';
import { edgeReceipts } from '../../src/edge/db/schema';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { createHttpApp } from '../harness/apps';
import { type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { FAKE_BUYER, FAKE_MERCHANT, FakePosapi } from '../harness/fake-posapi';
import { expectReconciled } from '../harness/inventory';
import { posActors, posStore } from '../harness/pos';

/**
 * The store PosAPI on the edge (ADR-0065) against a fake PosAPI and a listening centre: a sale's
 * receipt issued at once and its facts replayed; PosAPI away — the sale stands and the receipt is
 * issued once when it is back; an unanswered call never sent again until a supervisor decides;
 * a partial return's replacement (`inactiveId`) and a full return's cancellation (`DELETE`); a
 * company's receipt from the lookup, refused offline; the PosAPI facts in the heartbeat; and the
 * lottery and QR data nowhere in either database. Synthetic data only; never a real PosAPI.
 */
describe('pos e-Barimt on the edge', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let posapi: FakePosapi;
  let store: Awaited<ReturnType<typeof posStore>>;
  let cola: ProductJson;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let ebarimt: EbarimtService;
  let edgeDb: EdgeDb;

  const colaUnit = () => unitOf(cola, 'PCS').id;
  const supervisor = () => ({ supervisorUserId: store.supervisorId, pin: '654321' });
  const sell = async (qty: string, extra: object = {}) =>
    (
      await kiosk
        .post('/sales', {
          clientId: randomUUID(),
          lines: [{ productUnitId: colaUnit(), qty }],
          tenders: [{ kind: 'CASH', amount: String(1300 * Number.parseInt(qty, 10)) }],
          ...extra,
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
  const centreSale = async (number: string) => {
    await sync.pushOnce();
    const list = await store.pos.sales({ tillId: store.till.id });
    const row = list.data.find((sale) => sale.number === number);
    return row ? store.pos.sale(row.id) : undefined;
  };
  /** Lets the loop take a receipt it would otherwise wait for (its back-off). */
  const dueNow = () => edgeDb.update(edgeReceipts).set({ nextAttemptAt: null });

  beforeAll(async () => {
    posapi = new FakePosapi();
    await posapi.start();
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    const actors = await posActors(central);
    store = await posStore(central, actors.admin, 'PB');
    await store.pos
      .setSettings({
        receiptTitle: 'Туршилтын дэлгүүр',
        receiptFooter: 'Баярлалаа!',
        ebarimtDistrictCode: '1234',
        ebarimtClassificationCode: '1234567',
      })
      .expect(200);
    cola = await store.product('9321', 'Кола баримт', '1000', '10');
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
      ebarimt: { posapiUrl: posapi.url, lookupUrl: posapi.url, timeoutMs: 1_500 },
    });
    kiosk = kioskApi(edge);
    sync = edge.get(SyncRunner);
    ebarimt = edge.get(EbarimtService);
    edgeDb = edge.get<EdgeDb>(EDGE_DB);
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
  afterAll(async () => {
    await edge?.close();
    await posapi?.stop();
    await expectReconciled(central);
    await central?.close();
  });

  it('issues a sale’s receipt at once, prints it with the lottery and replays its facts', async () => {
    const sale = await sell('2');
    const sent = posapi.receiptPosts();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'B2C_RECEIPT',
      districtCode: '1234',
      merchantTin: FAKE_MERCHANT.tin,
      customerTin: null,
      inactiveId: null,
      totalAmount: 2600,
      payments: [{ code: 'CASH', status: 'PAID', paidAmount: 2600 }],
      receipts: [
        {
          taxType: 'VAT_ABLE',
          totalAmount: 2600,
          items: [
            expect.objectContaining({
              name: 'Кола баримт',
              classificationCode: '1234567',
              qty: 2,
              unitPrice: 1300,
              totalAmount: 2600,
            }),
          ],
        },
      ],
    });
    expect(sale.receipt).toMatchObject({
      title: 'Туршилтын дэлгүүр',
      footer: 'Баярлалаа!',
      ebarimt: {
        mode: 'REAL',
        status: 'CONFIRMED',
        ddtd: '1'.padStart(33, '0'),
        posapiDate: '2026-10-26 10:00:01',
        merchantTin: FAKE_MERCHANT.tin,
        receiptType: 'B2C',
      },
    });
    expect(sale.print).toEqual({ lottery: 'TEST-LOT-1', qrData: 'TEST-QR-1' });
    expect(sale.copy).toBe(false);

    const centre = await centreSale(sale.receipt.number);
    expect(centre).toMatchObject({
      ebarimtStatus: 'CONFIRMED',
      ddtd: '1'.padStart(33, '0'),
      posapiDate: '2026-10-26 10:00:01',
    });

    // The till's last receipt reprints with its lottery; after the next sale it is a copy.
    const again = (await kiosk.get(`/receipts/${sale.receipt.clientId}/print`).expect(200))
      .body as EdgePrintableReceipt;
    expect(again).toMatchObject({ print: { lottery: 'TEST-LOT-1' }, copy: false });
    await sell('1');
    const copy = (await kiosk.get(`/receipts/${sale.receipt.clientId}/print`).expect(200))
      .body as EdgePrintableReceipt;
    expect(copy).toMatchObject({ print: null, copy: true });
  });

  it('sells while PosAPI is away and issues the receipt once when it is back', async () => {
    await posapi.stop();
    const before = posapi.receiptPosts().length;
    const sale = await sell('1');
    expect(sale.receipt.ebarimt).toMatchObject({ status: 'PENDING', ddtd: null });
    expect(sale.print).toBeNull();
    await dueNow();
    await ebarimt.runDue();
    expect(posapi.receiptPosts()).toHaveLength(before);

    await posapi.start();
    await dueNow();
    expect(await ebarimt.runDue()).toBeGreaterThan(0);
    expect(posapi.receiptPosts()).toHaveLength(before + 1);
    const queue = (await kiosk.get('/ebarimt/queue').expect(200)).body as EdgeEbarimtQueue;
    expect(queue.items).toEqual([
      expect.objectContaining({ group: 'READY', saleClientId: sale.receipt.clientId }),
    ]);
    const health = (await kiosk.get('/health').expect(200)).body as EdgeHealth;
    expect(health.ebarimt).toEqual({ provider: 'posapi', ready: 1, attention: 0 });
    // A late receipt prints once with its lottery, then as a copy.
    const first = (await kiosk.get(`/receipts/${sale.receipt.clientId}/print`).expect(200))
      .body as EdgePrintableReceipt;
    expect(first.print?.lottery).toMatch(/^TEST-LOT-/);
    expect(first.receipt.ebarimt.status).toBe('CONFIRMED');
    const second = (await kiosk.get(`/receipts/${sale.receipt.clientId}/print`).expect(200))
      .body as EdgePrintableReceipt;
    expect(second).toMatchObject({ print: null, copy: true });
    expect(await centreSale(sale.receipt.number)).toMatchObject({ ebarimtStatus: 'CONFIRMED' });
  });

  it('never sends an unanswered receipt again until a supervisor says it was not issued', async () => {
    posapi.mode = 'hang';
    const before = posapi.receiptPosts().length;
    const sale = await sell('1');
    expect(sale.receipt.ebarimt.status).toBe('INDETERMINATE');
    posapi.mode = 'ok';
    await dueNow();
    await ebarimt.runDue();
    expect(posapi.receiptPosts()).toHaveLength(before + 1);
    expect(await centreSale(sale.receipt.number)).toMatchObject({ ebarimtStatus: 'INDETERMINATE' });
    const attention = await store.pos.attention();
    expect(attention).toMatchObject({ receiptsToCheck: 1 });

    const queue = (await kiosk.get('/ebarimt/queue').expect(200)).body as EdgeEbarimtQueue;
    const check = queue.items.find((item) => item.group === 'CHECK');
    expect(check).toMatchObject({ saleClientId: sale.receipt.clientId, op: 'ISSUE' });
    await kiosk
      .post(`/ebarimt/${check?.id}/resolve`, { outcome: 'NOT_ISSUED', approval: null })
      .expect(403);
    await kiosk
      .post(`/ebarimt/${check?.id}/resolve`, { outcome: 'NOT_ISSUED', approval: supervisor() })
      .expect(204);
    await kiosk
      .post(`/ebarimt/${check?.id}/resolve`, { outcome: 'NOT_ISSUED', approval: supervisor() })
      .expect(409);
    await ebarimt.runDue();
    expect(posapi.receiptPosts()).toHaveLength(before + 2);
    expect(await centreSale(sale.receipt.number)).toMatchObject({ ebarimtStatus: 'CONFIRMED' });
  });

  it('keeps a refused receipt in the list with PosAPI’s message', async () => {
    posapi.mode = 'error';
    const sale = await sell('1');
    expect(sale.receipt.ebarimt).toMatchObject({
      status: 'ERROR',
      message: 'TEST: the receipt was refused',
    });
    posapi.mode = 'ok';
    const queue = (await kiosk.get('/ebarimt/queue').expect(200)).body as EdgeEbarimtQueue;
    expect(queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: 'ERROR', saleClientId: sale.receipt.clientId }),
      ]),
    );
    await dueNow();
    await ebarimt.runDue();
    const printed = (await kiosk.get(`/receipts/${sale.receipt.clientId}/print`).expect(200))
      .body as EdgePrintableReceipt;
    expect(printed.receipt.ebarimt.status).toBe('CONFIRMED');
  });

  it('replaces the receipt on a partial return and cancels it on the full one', async () => {
    const sale = await sell('3');
    const ddtd = sale.receipt.ebarimt.ddtd;
    const found = (
      await kiosk.get(`/returns/sale?number=${encodeURIComponent(sale.receipt.number)}`).expect(200)
    ).body as EdgeReturnSale;
    const back = (qty: string) => ({
      clientId: randomUUID(),
      refundsSaleClientId: found.clientId,
      lines: [{ refundsLineNo: 1, qty, damaged: false }],
      approval: supervisor(),
    });
    const partial = (await kiosk.post('/returns', back('1')).expect(200))
      .body as EdgePrintableReceipt;
    const replacement = posapi.receiptPosts().at(-1);
    expect(replacement).toMatchObject({
      inactiveId: ddtd,
      totalAmount: 2600,
      receipts: [{ items: [expect.objectContaining({ qty: 2, totalAmount: 2600 })] }],
    });
    expect(partial.receipt.ebarimt).toMatchObject({ status: 'CONFIRMED', inactiveId: ddtd });
    expect(partial.print?.lottery).toMatch(/^TEST-LOT-/);
    const newDdtd = partial.receipt.ebarimt.ddtd;

    const full = (await kiosk.post('/returns', back('2')).expect(200)).body as EdgePrintableReceipt;
    expect(posapi.deletes().at(-1)).toEqual({
      id: newDdtd,
      date: partial.receipt.ebarimt.posapiDate,
    });
    expect(full.receipt.ebarimt).toMatchObject({ status: 'CANCELLED', inactiveId: newDdtd });
    expect(await centreSale(sale.receipt.number)).toMatchObject({ ebarimtStatus: 'CANCELLED' });
    expect(await centreSale(partial.receipt.number)).toMatchObject({
      ebarimtStatus: 'CANCELLED',
      ddtd: newDdtd,
      inactiveId: ddtd,
    });
    expect(await centreSale(full.receipt.number)).toMatchObject({ ebarimtStatus: 'NONE' });
  });

  it('makes a company receipt from the lookup and refuses one offline', async () => {
    const company = (await kiosk.get(`/ebarimt/taxpayer?no=${FAKE_BUYER.regNo}`).expect(200))
      .body as EdgeTaxpayer;
    expect(company).toEqual({ tin: FAKE_BUYER.tin, name: FAKE_BUYER.name, vatPayer: true });
    await kiosk.get('/ebarimt/taxpayer?no=7654321').expect(404);
    const sale = await sell('1', { buyer: { tin: FAKE_BUYER.tin } });
    expect(posapi.receiptPosts().at(-1)).toMatchObject({
      type: 'B2B_RECEIPT',
      customerTin: FAKE_BUYER.tin,
      consumerNo: null,
    });
    expect(sale.receipt.ebarimt).toMatchObject({
      receiptType: 'B2B',
      customerTin: FAKE_BUYER.tin,
      customerName: FAKE_BUYER.name,
    });
    expect(await centreSale(sale.receipt.number)).toMatchObject({
      receiptType: 'B2B',
      customerTin: FAKE_BUYER.tin,
      ebarimtStatus: 'CONFIRMED',
    });

    posapi.lookupOffline = true;
    // The cache answers a company already found; an unknown one cannot be found offline.
    const offline = await kiosk.get('/ebarimt/taxpayer?no=1111111').expect(503);
    expect(offline.body).toMatchObject({ code: 'EBARIMT_LOOKUP_UNAVAILABLE' });
    posapi.lookupOffline = false;
  });

  it('sends the receipts to the tax office on a supervisor’s word and reports PosAPI', async () => {
    await kiosk.post('/ebarimt/send-data', { approval: null }).expect(403);
    await kiosk.post('/ebarimt/send-data', { approval: supervisor() }).expect(200);
    expect(posapi.calls.filter((call) => call.path === '/rest/sendData')).toHaveLength(1);
    expect(await sync.heartbeatOnce()).toBe(true);
    const [node] = await store.pos.nodes();
    expect(node).toMatchObject({
      posapiVersion: '3.2.50',
      posapiLastSent: '2026-10-26 09:00:00',
      posapiLeftLotteries: 9000,
      posapiError: null,
    });
  });

  it('keeps the lottery and the QR data in neither database', async () => {
    await sync.pushOnce();
    const edgeTables = await edgeDb.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    for (const { table_name } of edgeTables.rows) {
      const found = await edgeDb.execute<{ n: string }>(
        sql`SELECT count(*) AS n FROM ${sql.identifier(table_name)} t
            WHERE to_jsonb(t)::text ~ 'TEST-(LOT|QR)-'`,
      );
      expect({ table: table_name, rows: found.rows[0]?.n }).toEqual({
        table: table_name,
        rows: '0',
      });
    }
    const db = central.get<Db>(DB);
    for (const table of ['pos_sales', 'pos_sync_rejections', 'audit_log']) {
      const found = await db.execute<{ n: string }>(
        sql`SELECT count(*) AS n FROM ${sql.identifier(table)} t
            WHERE to_jsonb(t)::text ~ 'TEST-(LOT|QR)-'`,
      );
      expect({ table, rows: found.rows[0]?.n }).toEqual({ table, rows: '0' });
    }
  });
});
