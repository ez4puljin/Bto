import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  EdgeDeviceInfo,
  EdgeHealth,
  EdgeLoginResponse,
  EdgePairResponse,
  EdgeProductHit,
  EdgeQuoteResponse,
  EdgeReceipt,
  EdgeSession,
  EdgeShiftSummary,
  PosSnapshot,
  SaleDocWire,
} from '@tugeel/shared/pos';
import { posSaleNumber } from '@tugeel/shared/pos';
import { eq } from 'drizzle-orm';
import { EDGE_DB, type EdgeDb, inEdgeTransaction } from '../../src/edge/db/edge-db';
import { edgeOutbox, edgeSales } from '../../src/edge/db/schema';
import { OutboxService } from '../../src/edge/services/outbox.service';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { expectReconciled } from '../harness/inventory';
import { posActors, posStore } from '../harness/pos';

/**
 * The store edge against a real centre (ADR-0063, ADR-0067): the snapshot, pairing a browser with
 * a one-time code, the cashier's PIN, a shift, sales priced offline, the outbox replayed in order
 * (also after the centre was away), a repeated sale, a document the centre refuses parked, the
 * shift closed at the centre. The centre listens on a real port; the edge's timers are off and the
 * test drives pull and push. Synthetic data only.
 */
describe('pos edge', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let port: number;
  let store: Awaited<ReturnType<typeof posStore>>;
  let cola: ProductJson;
  let bread: ProductJson;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let shift: EdgeShiftSummary;
  const receipts: EdgeReceipt[] = [];

  const colaUnit = () => unitOf(cola, 'PCS').id;
  const breadUnit = () => unitOf(bread, 'PCS').id;
  const sell = (lines: { productUnitId: number; qty: string }[], tenders: object[]) =>
    kiosk.post('/sales', { clientId: randomUUID(), lines, tenders });
  const centreSaleOf = async (number: string) => {
    const list = await store.pos.sales({ tillId: store.till.id });
    return list.data.find((sale) => sale.number === number);
  };

  beforeAll(async () => {
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    port = (central.getHttpServer().address() as AddressInfo).port;
    const actors = await posActors(central);
    store = await posStore(central, actors.admin, 'PE');
    cola = await store.product('9301', 'Кола касс', '1000', '10');
    bread = await store.product('9302', 'Талх касс', '2000', '0');
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
    });
    kiosk = kioskApi(edge);
    sync = edge.get(SyncRunner);
  });
  afterAll(async () => {
    await edge?.close();
    await expectReconciled(central);
    await central?.close();
  });

  it('serves the node its snapshot and only the version when nothing changed', async () => {
    const first = await store.pos
      .http()
      .get('/api/v1/pos/sync/snapshot')
      .set('Authorization', `Bearer ${store.edgeToken}`)
      .expect(200);
    const body = first.body as { changed: true; snapshot: PosSnapshot };
    expect(body.changed).toBe(true);
    const snapshot = body.snapshot;
    expect(snapshot.node.code).toBe('PE1');
    expect(snapshot.company).toMatchObject({ vatPayer: true, vatRatePct: '10.00' });
    expect(snapshot.tills).toEqual([
      expect.objectContaining({ code: 'К1', status: 'ACTIVE', pairingCodeHash: null }),
    ]);
    expect(snapshot.cashiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: store.cashierId, status: 'ACTIVE', supervisor: false }),
        expect.objectContaining({ userId: store.supervisorId, supervisor: true }),
      ]),
    );
    const product = snapshot.products.find((entry) => entry.id === cola.id);
    expect(product).toMatchObject({
      sku: '9301',
      vatRatePct: '10.00',
      terms: { warehousePrice: '1000.00' },
    });
    expect(JSON.stringify(snapshot)).not.toContain('123456');
    const again = await store.pos
      .http()
      .get('/api/v1/pos/sync/snapshot')
      .query({ since: snapshot.version })
      .set('Authorization', `Bearer ${store.edgeToken}`)
      .expect(200);
    expect(again.body).toEqual({ changed: false, version: snapshot.version });
    await store.pos.http().get('/api/v1/pos/sync/snapshot').expect(401);
  });

  it('pulls the snapshot and reports it in its health', async () => {
    const before = (await kiosk.get('/health').expect(200)).body as EdgeHealth;
    expect(before.node).toBeNull();
    expect(await sync.pullOnce()).toBe('changed');
    expect(await sync.pullOnce()).toBe('unchanged');
    const health = (await kiosk.get('/health').expect(200)).body as EdgeHealth;
    expect(health).toMatchObject({
      status: 'ok',
      node: { code: 'PE1' },
      central: { reachable: true },
      outbox: { pending: 0, rejected: 0 },
    });
    expect(health.snapshot.products).toBeGreaterThanOrEqual(2);
  });

  it('binds a browser to a till with a one-time code, pulling the new code itself', async () => {
    await kiosk.get('/device').expect(401);
    const issued = (await store.pos.pairingCode(store.till.id).expect(200)).body as {
      code: string;
    };
    await kiosk.post('/pair', { tillCode: 'К1', pairingCode: 'wrong1' }).expect(422);
    // The code is newer than the edge's snapshot: the edge pulls once more and finds it. The till's
    // code is typed in Latin letters here ('k1'); it still finds till К1.
    const paired = (
      await kiosk.post('/pair', { tillCode: 'k1', pairingCode: issued.code }).expect(200)
    ).body as EdgePairResponse;
    expect(paired.till).toEqual({ code: 'К1', name: 'Касс 1' });
    kiosk.setDevice(paired.deviceToken);
    const device = (await kiosk.get('/device').expect(200)).body as EdgeDeviceInfo;
    expect(device.till.code).toBe('К1');
    expect(device.cashiers.map((cashier) => cashier.userId)).toEqual(
      expect.arrayContaining([store.cashierId, store.supervisorId]),
    );
  });

  it('signs a cashier in with the PIN and refuses a wrong one', async () => {
    await kiosk.get('/session').expect(401);
    const wrong = await kiosk
      .post('/auth/pin', { userId: store.cashierId, pin: '111111' })
      .expect(401);
    expect(wrong.body).toMatchObject({ code: 'POS_PIN_INVALID', params: { attemptsLeft: 4 } });
    const login = (
      await kiosk.post('/auth/pin', { userId: store.cashierId, pin: '123456' }).expect(200)
    ).body as EdgeLoginResponse;
    expect(login.cashier).toMatchObject({ userId: store.cashierId, supervisor: false });
    kiosk.setSession(login.token);
    const session = (await kiosk.get('/session').expect(200)).body as EdgeSession;
    expect(session).toMatchObject({ till: { code: 'К1' }, shift: null });
  });

  it('opens a shift, finds products and prices a cart offline', async () => {
    shift = (await kiosk.post('/shifts/open', { openingFloat: '50000' }).expect(200))
      .body as EdgeShiftSummary;
    expect(shift).toMatchObject({ status: 'OPEN', openingFloat: '50000.00', salesCount: 0 });
    await kiosk.post('/shifts/open', { openingFloat: '1' }).expect(409);
    const hits = (await kiosk.get('/products/search?q=кола касс').expect(200))
      .body as EdgeProductHit[];
    expect(hits[0]).toMatchObject({
      productId: cola.id,
      units: [expect.objectContaining({ unitId: colaUnit(), price: '1300.00' })],
    });
    await kiosk.get('/products/barcode/4006381333931').expect(404);
    const quote = (
      await kiosk
        .post('/quote', {
          lines: [
            { productUnitId: colaUnit(), qty: '2' },
            { productUnitId: breadUnit(), qty: '1' },
          ],
        })
        .expect(200)
    ).body as EdgeQuoteResponse;
    expect(quote).toMatchObject({ total: '5200.00', vatTotal: '472.72' });
  });

  it('sells with change and by card; the centre posts them, filling the empty shelf', async () => {
    const cash = (
      await sell(
        [
          { productUnitId: colaUnit(), qty: '2' },
          { productUnitId: breadUnit(), qty: '1' },
        ],
        [{ kind: 'CASH', amount: '5200', tendered: '10000' }],
      ).expect(200)
    ).body.receipt as EdgeReceipt;
    expect(cash).toMatchObject({
      total: '5200.00',
      change: '4800.00',
      ebarimt: { mode: 'TEST' },
      tillCode: 'К1',
    });
    receipts.push(cash);
    await sell(
      [{ productUnitId: colaUnit(), qty: '1' }],
      [{ kind: 'CASH', amount: '1000', tendered: '1000' }],
    ).expect(422);
    const card = (
      await sell(
        [{ productUnitId: colaUnit(), qty: '1' }],
        [{ kind: 'CARD', amount: '1300' }],
      ).expect(200)
    ).body.receipt as EdgeReceipt;
    receipts.push(card);
    expect(await sync.pushOnce()).toEqual({ state: 'sent', applied: 4, rejected: 0 });
    const posted = await centreSaleOf(cash.number);
    expect(posted).toMatchObject({
      total: '5200.00',
      vatTotal: '472.72',
      cashAmount: '5200.00',
      shortfallCount: 1,
    });
    expect(await centreSaleOf(card.number)).toMatchObject({ cardAmount: '1300.00' });
    expect(await sync.pushOnce()).toEqual({ state: 'idle' });
  });

  it('keeps selling while the centre is away and replays in order when it is back', async () => {
    const server = central.getHttpServer();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    const offline = (
      await sell(
        [{ productUnitId: colaUnit(), qty: '3' }],
        [{ kind: 'CASH', amount: '3900', tendered: '5000' }],
      ).expect(200)
    ).body.receipt as EdgeReceipt;
    receipts.push(offline);
    const failed = await sync.pushOnce();
    expect(failed.state).toBe('failed');
    expect(await sync.pullOnce()).toBe('failed');
    const health = (await kiosk.get('/health').expect(200)).body as EdgeHealth;
    expect(health).toMatchObject({ central: { reachable: false }, outbox: { pending: 1 } });
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
    expect(await sync.pushOnce()).toEqual({ state: 'sent', applied: 1, rejected: 0 });
    expect(await centreSaleOf(offline.number)).toMatchObject({ total: '3900.00' });
  });

  it('answers a repeated sale with the receipt it already made', async () => {
    const clientId = randomUUID();
    const body = {
      clientId,
      lines: [{ productUnitId: colaUnit(), qty: '1' }],
      tenders: [{ kind: 'CASH', amount: '1300' }],
    };
    const first = (await kiosk.post('/sales', body).expect(200)).body.receipt as EdgeReceipt;
    const again = (await kiosk.post('/sales', body).expect(200)).body.receipt as EdgeReceipt;
    expect(again).toEqual(first);
    receipts.push(first);
    const db = edge.get<EdgeDb>(EDGE_DB);
    expect(
      await db.select().from(edgeOutbox).where(eq(edgeOutbox.clientId, clientId)),
    ).toHaveLength(1);
    expect(await sync.pushOnce()).toEqual({ state: 'sent', applied: 1, rejected: 0 });
  });

  it('parks a document the centre refuses and goes on with the next', async () => {
    const db = edge.get<EdgeDb>(EDGE_DB);
    const [stored] = await db
      .select({ doc: edgeSales.doc })
      .from(edgeSales)
      .where(eq(edgeSales.clientId, receipts[1]?.clientId ?? ''));
    if (!stored) throw new Error('no stored sale');
    const broken: SaleDocWire = {
      ...stored.doc,
      clientId: randomUUID(),
      number: posSaleNumber(store.till.code, store.today, 900),
      total: '9999.00',
    };
    await inEdgeTransaction(db, (tx) =>
      edge
        .get(OutboxService)
        .enqueue(tx, { kind: 'SALE', clientId: broken.clientId, sale: broken }),
    );
    expect(await sync.pushOnce()).toEqual({ state: 'sent', applied: 0, rejected: 1 });
    expect(await edge.get(OutboxService).counts()).toEqual({ pending: 0, rejected: 1 });
    const rejections = await store.pos.rejections();
    expect(rejections.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ clientId: broken.clientId })]),
    );
  });

  it('closes the shift with the cash counted; the centre closes it with the same figures', async () => {
    const session = (await kiosk.get('/session').expect(200)).body as EdgeSession;
    expect(session.shift).toMatchObject({
      salesCount: 4,
      cashSales: '10400.00',
      cardSales: '1300.00',
      expectedCash: '60400.00',
    });
    await kiosk.post('/shifts/close', { countedCash: '60300', floatKept: '70000' }).expect(422);
    const closed = (
      await kiosk
        .post('/shifts/close', { countedCash: '60300', floatKept: '50000', note: 'туршилт' })
        .expect(200)
    ).body as EdgeShiftSummary;
    expect(closed).toMatchObject({ status: 'CLOSED', variance: '-100.00' });
    expect(await sync.pushOnce()).toEqual({ state: 'sent', applied: 1, rejected: 0 });
    const shifts = await store.pos.shifts({ tillId: store.till.id });
    const centreShift = shifts.data.find((row) => row.number === shift.number);
    expect(centreShift).toMatchObject({
      status: 'CLOSED',
      salesCount: 4,
      expectedCash: '60400.00',
      countedCash: '60300.00',
      variance: '-100.00',
    });
    const recent = (await kiosk.get('/sales/recent').expect(200)).body as EdgeReceipt[];
    expect(recent).toEqual([]);
  });
});
