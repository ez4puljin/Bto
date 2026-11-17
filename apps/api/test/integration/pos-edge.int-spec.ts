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
import { Decimal } from '@tugeel/shared/money';
import { posSaleNumber } from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { EDGE_DB, type EdgeDb, inEdgeTransaction } from '../../src/edge/db/edge-db';
import { edgeOutbox, edgeSales } from '../../src/edge/db/schema';
import { OutboxService } from '../../src/edge/services/outbox.service';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { expectReconciled } from '../harness/inventory';
import { posActors, posStore } from '../harness/pos';
import { pricingApi } from '../harness/pricing';

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
  let admin: string;
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
    admin = actors.admin;
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

  it('tells the till from how many pieces the bulk price applies, changing no price (owner 2026-11-17)', async () => {
    // The store's profile: the supermarket +30 %, from 24 pieces +20 %; the cola's warehouse price is 1,000.
    const offer = { fromQtyBase: '24', bulkPrice: '1200.00' };
    const hits = (await kiosk.get('/products/search?q=кола касс').expect(200))
      .body as EdgeProductHit[];
    const hit = hits[0]?.units[0];
    expect(hit).toMatchObject({ price: '1300.00', bulkOffer: offer });
    expect(hit?.bulkOffer?.baseUom).toBe(hit?.uomName);
    const quoted = async (productUnitId: number, qty: string) =>
      (await kiosk.post('/quote', { lines: [{ productUnitId, qty }] }).expect(200))
        .body as EdgeQuoteResponse;

    const below = await quoted(colaUnit(), '23');
    expect(below.lines[0]).toMatchObject({
      unitPrice: '1300.00',
      total: '29900.00',
      discount: '0.00',
      bulk: null,
      bulkOffer: { ...offer, baseUom: hit?.uomName },
    });
    expect(below).toMatchObject({ subtotal: '29900.00', total: '29900.00' });

    const at = await quoted(colaUnit(), '24');
    expect(at.lines[0]).toMatchObject({
      unitPrice: '1200.00',
      total: '28800.00',
      discount: '0.00',
      bulk: { retailPrice: '1300.00', bulkPrice: '1200.00' },
      bulkOffer: { ...offer, baseUom: hit?.uomName },
    });
    expect(at).toMatchObject({ subtotal: '28800.00', total: '28800.00' });

    // A profile without a bulk tier offers nothing.
    const catalog = catalogApi(central, admin);
    const pricing = pricingApi(central, admin);
    const plain = await catalog.product({
      sku: '9303',
      name: 'Ус касс',
      categoryId: await catalog.category('Бөөнийгүй PE'),
      baseUomId: await catalog.uomId('PCS'),
    });
    const profile = await pricing.profile('Бөөнийгүй PE', {
      retailBulkMinQty: null,
      retailBulkMarkupPct: null,
    });
    await pricing.terms(plain.id, '1000', profile, null);
    await catalog
      .http()
      .post('/api/v1/pricing/sale-ready')
      .set('Authorization', `Bearer ${admin}`)
      .set(idempotency())
      .send({ productIds: [plain.id] })
      .expect(200);
    expect(await sync.pullOnce()).toBe('changed');
    const plainHits = (await kiosk.get('/products/search?q=ус касс').expect(200))
      .body as EdgeProductHit[];
    expect(plainHits[0]).toMatchObject({ productId: plain.id });
    expect(plainHits[0]?.units[0]).toMatchObject({ price: '1300.00', bulkOffer: null });
    const plainQuote = await quoted(unitOf(plain, 'PCS').id, '30');
    expect(plainQuote.lines[0]).toMatchObject({
      unitPrice: '1300.00',
      total: '39000.00',
      bulk: null,
      bulkOffer: null,
    });
  });

  it('sells with change and by card; the centre posts them, filling the empty shelf', async () => {
    // The till shows the number the sale will take while it is rung up.
    const expected = (await kiosk.get('/sales/next-number').expect(200)).body as { number: string };
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
    expect(cash.number).toBe(expected.number);
    receipts.push(cash);
    // Taken: the next one follows.
    expect(
      ((await kiosk.get('/sales/next-number').expect(200)).body as { number: string }).number,
    ).not.toBe(expected.number);
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

  it('prices a plan offline, on the tills it names (ADR-0159)', async () => {
    const plan = (name: string, tillIds: number[], fields: object = {}) =>
      store.pos
        .http()
        .post('/api/v1/discount-programs')
        .set('Authorization', `Bearer ${admin}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          name,
          list: 'RETAIL',
          scope: 'PRODUCT',
          measure: 'QTY',
          effect: 'BONUS',
          targetKind: 'PRODUCT',
          targetIds: [bread.id],
          validFrom: businessDate(),
          steps: [{ threshold: '1', value: '1' }],
          tillIds,
          ...fields,
        })
        .expect(201);
    const quoted = async (product: number, qty: string) =>
      (await kiosk.post('/quote', { lines: [{ productUnitId: product, qty }] }).expect(200))
        .body as EdgeQuoteResponse;
    const before = await quoted(breadUnit(), '2');
    const one = new Decimal(before.total).div(2);

    await plan('Өөр кассын', [store.till.id + 999]);
    expect(await sync.pullOnce()).toBe('changed');
    expect((await quoted(breadUnit(), '2')).total).toBe(before.total);

    await plan('Энэ кассын 1+1', [store.till.id]);
    expect(await sync.pullOnce()).toBe('changed');
    const after = await quoted(breadUnit(), '2');
    // Two written, one paid; the line still says two.
    expect(new Decimal(after.total).eq(one)).toBe(true);
    expect(after.lines[0]?.qty).toBe('2');
    expect(new Decimal(after.lines[0]?.discount ?? '0').eq(one)).toBe(true);

    // A rounded percentage on another product, from the set the centre expanded.
    await plan('Тоймтой', [], {
      effect: 'PERCENT',
      targetIds: [cola.id],
      steps: [{ threshold: '0', value: '7' }],
      adjustKind: 'ENDS_9',
      adjustFactor: 100,
    });
    expect(await sync.pullOnce()).toBe('changed');
    const rounded = await quoted(colaUnit(), '1');
    expect(rounded.lines[0]?.unitPrice).toMatch(/^\d*99(\.0+)?$/);
  });

  it('lists and signs in only the cashiers who work this till (owner 2026-11-17)', async () => {
    const other = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          code: 'К2',
          name: 'Касс 2',
          warehouseId: store.store.id,
        })
        .expect(201)
    ).body as { id: number };
    const tillsOf = (tillIds: number[]) =>
      store.pos
        .http()
        .put(`/api/v1/pos/cashiers/${store.supervisorId}/tills`)
        .set(store.pos.auth)
        .send({ tillIds })
        .expect(200);
    await tillsOf([other.id]);
    expect(await sync.pullOnce()).toBe('changed');
    const device = (await kiosk.get('/device').expect(200)).body as EdgeDeviceInfo;
    expect(device.cashiers.map((cashier) => cashier.userId)).toContain(store.cashierId);
    expect(device.cashiers.map((cashier) => cashier.userId)).not.toContain(store.supervisorId);
    const refused = await kiosk
      .post('/auth/pin', { userId: store.supervisorId, pin: '654321' })
      .expect(422);
    expect(refused.body).toMatchObject({ code: 'POS_CASHIER_NOT_ON_TILL' });

    await tillsOf([store.till.id, other.id]);
    expect(await sync.pullOnce()).toBe('changed');
    const back = (await kiosk.get('/device').expect(200)).body as EdgeDeviceInfo;
    expect(back.cashiers.map((cashier) => cashier.userId)).toContain(store.supervisorId);
  });

  it('shows a cashier’s card photo on the sign-in screen, kept by the edge (owner 2026-11-17)', async () => {
    const before = (await kiosk.get('/device').expect(200)).body as EdgeDeviceInfo;
    expect(before.cashiers.find((row) => row.userId === store.cashierId)?.photo).toBe(false);
    await kiosk.get(`/cashiers/${store.cashierId}/photo`).expect(404);

    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
    const issued = (
      await store.pos
        .http()
        .post('/api/v1/files/presign')
        .set(store.pos.auth)
        .send({ kind: 'hr.employee_photo', contentType: 'image/jpeg', sizeBytes: bytes.length })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await store.pos
      .http()
      .put(issued.uploadUrl)
      .set('Content-Type', 'image/jpeg')
      .send(bytes)
      .expect(204);
    await store.pos
      .http()
      .put(`/api/v1/hr/staff/${store.cashierId}/photo`)
      .set(store.pos.auth)
      .send({ fileId: issued.fileId })
      .expect(200);
    expect(await sync.pullOnce()).toBe('changed');

    const after = (await kiosk.get('/device').expect(200)).body as EdgeDeviceInfo;
    expect(after.cashiers.find((row) => row.userId === store.cashierId)?.photo).toBe(true);
    const served = await kiosk.get(`/cashiers/${store.cashierId}/photo`).expect(200);
    expect(served.headers['content-type']).toMatch(/^image\//);
    expect((served.body as Buffer).length).toBeGreaterThan(0);
  });

  it('prints the bulk offer on a sale’s receipt lines, changing no amount (owner 2026-11-17)', async () => {
    // The store's profile: the supermarket +30 %, from 24 pieces +20 %; the warehouse price 1,000.
    const juice = await store.product('9304', 'Шүүс касс', '1000', '40');
    expect(await sync.pullOnce()).toBe('changed');
    const juiceUnit = unitOf(juice, 'PCS').id;
    await kiosk.post('/shifts/open', { openingFloat: '0' }).expect(200);
    const hit = (
      (await kiosk.get('/products/search?q=шүүс касс').expect(200)).body as EdgeProductHit[]
    )[0]?.units[0];
    const offer = { fromQtyBase: '24', baseUom: hit?.uomName, bulkPrice: '1200.00' };

    for (const [qty, unitPrice, total, atBulk] of [
      ['24', '1200.00', '28800.00', true],
      ['5', '1300.00', '6500.00', false],
    ] as const) {
      const lines = [{ productUnitId: juiceUnit, qty }];
      const quote = (await kiosk.post('/quote', { lines }).expect(200)).body as EdgeQuoteResponse;
      const receipt = (
        await sell(lines, [{ kind: 'CASH', amount: total, tendered: total }]).expect(200)
      ).body.receipt as EdgeReceipt;
      expect(receipt.lines).toEqual([
        {
          name: 'Шүүс касс',
          uomName: hit?.uomName,
          qty,
          unitPrice,
          total,
          bulkOffer: { ...offer, atBulk },
        },
      ]);
      // The amounts are the quote's; the stored receipt is the one printed.
      expect(receipt).toMatchObject({
        subtotal: quote.subtotal,
        discountTotal: quote.discountTotal,
        total: quote.total,
        vatTotal: quote.vatTotal,
      });
      const db = edge.get<EdgeDb>(EDGE_DB);
      const [stored] = await db
        .select({ receipt: edgeSales.receipt, doc: edgeSales.doc })
        .from(edgeSales)
        .where(eq(edgeSales.clientId, receipt.clientId));
      expect(stored?.receipt).toEqual(receipt);
      // The document for the centre carries no offer.
      expect(stored?.doc).toMatchObject({ total, vatTotal: quote.vatTotal });
      expect(stored?.doc.lines).toHaveLength(1);
      expect(stored?.doc.lines[0]).toMatchObject({
        qty: `${qty}.000`,
        basis: atBulk ? 'RETAIL_BULK' : 'RETAIL',
        unitPrice,
        total,
      });
      expect(stored?.doc.lines[0]).not.toHaveProperty('bulkOffer');
    }
    expect(await sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
  });
});
