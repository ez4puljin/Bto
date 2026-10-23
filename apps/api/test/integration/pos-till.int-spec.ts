import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  EdgeCartLine,
  EdgeLoginResponse,
  EdgePairResponse,
  EdgeParkedBasket,
  EdgeProductHit,
  EdgeQuickGroup,
  EdgeReceipt,
  EdgeReturnSale,
  EdgeSession,
  EdgeShiftSummary,
  EdgeSupervisor,
} from '@tugeel/shared/pos';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { expectReconciled } from '../harness/inventory';
import { posActors, posStore } from '../harness/pos';

/**
 * The till's tools against a real centre (ADR-0104): the admin's quick buttons in the snapshot,
 * voids approved by a supervisor's PIN and replayed to the centre's log, parked baskets kept per
 * till, a return found by its receipt number and refunded in cash, its stock posted back and the
 * shift's figures with the refund. The centre listens on a real port; the edge's timers are off.
 * Synthetic data only.
 */
describe('pos till tools', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let store: Awaited<ReturnType<typeof posStore>>;
  let cola: ProductJson;
  let water: ProductJson;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let sold: EdgeReceipt;

  const colaUnit = () => unitOf(cola, 'PCS').id;
  const waterUnit = () => unitOf(water, 'PCS').id;
  const supervisor = () => ({ supervisorUserId: store.supervisorId, pin: '654321' });
  const voidOf = (lines: EdgeCartLine[], approval: object | null, reason = 'LINE_REMOVED') =>
    kiosk.post('/voids', { clientId: randomUUID(), reason, lines, approval });

  beforeAll(async () => {
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    const actors = await posActors(central);
    store = await posStore(central, actors.admin, 'PT');
    cola = await store.product('9311', 'Кола товч', '1000', '10');
    water = await store.product('9312', 'Ус товч', '500', '10');
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

  it('saves the quick buttons as one ordered set and refuses a unit twice in a group', async () => {
    const twice = await store.pos.setQuickButtons({
      groups: [
        {
          name: 'Ундаа',
          buttons: [
            { productUnitId: colaUnit(), label: null },
            { productUnitId: colaUnit(), label: 'Кола' },
          ],
        },
      ],
    });
    expect(twice.status).toBe(422);
    const saved = await store.pos
      .setQuickButtons({
        groups: [
          { name: 'Ундаа', buttons: [{ productUnitId: colaUnit(), label: 'Кола' }] },
          { name: 'Ус', buttons: [{ productUnitId: waterUnit(), label: null }] },
        ],
      })
      .expect(200);
    expect(saved.body).toEqual([
      expect.objectContaining({
        name: 'Ундаа',
        buttons: [
          expect.objectContaining({ productUnitId: colaUnit(), label: 'Кола', sellable: true }),
        ],
      }),
      expect.objectContaining({ name: 'Ус' }),
    ]);
    expect(await store.pos.quickButtons()).toEqual(saved.body);
  });

  it('pairs a till and shows the quick buttons and barcodes at today’s prices', async () => {
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
    const session = (await kiosk.get('/session').expect(200)).body as EdgeSession;
    expect(session.approvalRequired).toBe(true);
    (await kiosk.post('/shifts/open', { openingFloat: '20000' }).expect(200))
      .body as EdgeShiftSummary;

    const groups = (await kiosk.get('/quick-buttons').expect(200)).body as EdgeQuickGroup[];
    expect(groups.map((group) => group.name)).toEqual(['Ундаа', 'Ус']);
    expect(groups[0]?.buttons[0]).toMatchObject({
      label: 'Кола',
      unitId: colaUnit(),
      product: { productId: cola.id, units: [expect.objectContaining({ price: '1300.00' })] },
    });
    const bySku = (await kiosk.get('/products/search?q=9311').expect(200)).body as EdgeProductHit[];
    expect(bySku[0]?.productId).toBe(cola.id);
    expect(bySku[0]?.units[0]?.barcodes).toEqual(expect.any(Array));
    const supervisors = (await kiosk.get('/supervisors').expect(200)).body as EdgeSupervisor[];
    expect(supervisors.map((entry) => entry.userId)).toEqual([store.supervisorId]);
  });

  it('logs a void only with a supervisor’s PIN and replays it to the centre', async () => {
    const lines = [{ productUnitId: colaUnit(), qty: '2' }];
    const none = await voidOf(lines, null).expect(403);
    expect(none.body).toMatchObject({ code: 'POS_SUPERVISOR_REQUIRED' });
    // A cashier is no supervisor, even with the right PIN.
    await voidOf(lines, { supervisorUserId: store.cashierId, pin: '123456' }).expect(403);
    const wrong = await voidOf(lines, { supervisorUserId: store.supervisorId, pin: '000000' });
    expect(wrong.status).toBe(401);
    const ok = await voidOf(lines, supervisor()).expect(200);
    expect(ok.body).toMatchObject({ approvedByName: expect.any(String) });

    expect(await sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    const log = await store.pos.voids({ tillId: store.till.id });
    expect(log).toMatchObject({ total: 1, sum: '2600.00' });
    expect(log.data[0]).toMatchObject({
      reason: 'LINE_REMOVED',
      tillCode: 'К1',
      cashierUserId: store.cashierId,
      approvedBy: store.supervisorId,
      total: '2600.00',
      lineCount: 1,
    });
    const detail = await store.pos.void(log.data[0]?.id as number);
    expect(detail.lines).toEqual([
      expect.objectContaining({ productSku: '9311', qty: '2', unitPrice: '1300.00' }),
    ]);
  });

  it('parks baskets on their till, resumes one and cancels the other as a void', async () => {
    const first = (
      await kiosk
        .post('/parked', {
          clientId: randomUUID(),
          lines: [{ productUnitId: colaUnit(), qty: '1' }],
        })
        .expect(200)
    ).body as EdgeParkedBasket;
    expect(first).toMatchObject({ itemCount: 1, total: '1300.00', preview: 'Кола товч' });
    const second = (
      await kiosk
        .post('/parked', {
          clientId: randomUUID(),
          lines: [{ productUnitId: waterUnit(), qty: '3' }],
        })
        .expect(200)
    ).body as EdgeParkedBasket;
    expect(((await kiosk.get('/parked').expect(200)).body as EdgeParkedBasket[]).length).toBe(2);

    const lines = (await kiosk.post(`/parked/${first.clientId}/resume`, {}).expect(200))
      .body as EdgeCartLine[];
    expect(lines).toEqual([{ productUnitId: colaUnit(), qty: '1' }]);
    await kiosk.post(`/parked/${first.clientId}/resume`, {}).expect(404);

    await kiosk.post(`/parked/${second.clientId}/discard`, { approval: null }).expect(403);
    await kiosk.post(`/parked/${second.clientId}/discard`, { approval: supervisor() }).expect(204);
    expect((await kiosk.get('/parked').expect(200)).body).toEqual([]);
    await sync.pushOnce();
    const cancelled = await store.pos.voids({ reason: 'CART_CANCELLED' });
    expect(cancelled.data[0]).toMatchObject({ total: '1950.00', approvedBy: store.supervisorId });
  });

  it('returns part of a sale by its receipt number, refunded in cash', async () => {
    sold = (
      await kiosk
        .post('/sales', {
          clientId: randomUUID(),
          lines: [{ productUnitId: colaUnit(), qty: '3' }],
          tenders: [{ kind: 'CASH', amount: '3900', tendered: '5000' }],
        })
        .expect(200)
    ).body as EdgeReceipt;
    // Typed on a Latin keyboard: «K1-…» still finds till К1's receipt.
    const latin = sold.number.replace('К', 'K');
    const found = (await kiosk.get(`/returns/sale?number=${encodeURIComponent(latin)}`).expect(200))
      .body as EdgeReturnSale;
    expect(found).toMatchObject({
      clientId: sold.clientId,
      withinWindow: true,
      lines: [expect.objectContaining({ lineNo: 1, qty: '3', returnable: '3' })],
    });
    const body = (qty: string, approval: object | null) => ({
      clientId: randomUUID(),
      refundsSaleClientId: sold.clientId,
      lines: [{ refundsLineNo: 1, qty, damaged: false }],
      approval,
    });
    await kiosk.post('/returns', body('1', null)).expect(403);
    const refund = (await kiosk.post('/returns', body('2', supervisor())).expect(200))
      .body as EdgeReceipt;
    expect(refund).toMatchObject({
      kind: 'RETURN',
      refundsNumber: sold.number,
      total: '2600.00',
      tenders: [{ kind: 'CASH', amount: '2600.00', tendered: null }],
    });
    const over = await kiosk.post('/returns', body('2', supervisor())).expect(422);
    expect(over.body).toMatchObject({ code: 'POS_RETURN_EXCEEDS', params: { remaining: '1' } });
    const again = (await kiosk.get(`/returns/sale?number=${encodeURIComponent(sold.number)}`))
      .body as EdgeReturnSale;
    expect(again.lines[0]?.returnable).toBe('1');

    const session = (await kiosk.get('/session').expect(200)).body as EdgeSession;
    expect(session.shift).toMatchObject({
      salesCount: 1,
      cashSales: '3900.00',
      returnsCount: 1,
      cashRefunds: '2600.00',
      expectedCash: '21300.00',
    });

    expect(await sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    const sales = await store.pos.sales({ tillId: store.till.id, kind: 'RETURN' });
    expect(sales.data[0]).toMatchObject({
      number: refund.number,
      total: '2600.00',
      cashAmount: '2600.00',
      refundsSaleId: expect.any(Number),
    });
  });

  it('closes the shift with the refund out of the drawer, as the centre counts it', async () => {
    const closed = (
      await kiosk
        .post('/shifts/close', { countedCash: '21300', floatKept: '20000', note: null })
        .expect(200)
    ).body as EdgeShiftSummary;
    expect(closed).toMatchObject({ status: 'CLOSED', variance: '0.00' });
    expect(await sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
    const shifts = await store.pos.shifts({ tillId: store.till.id });
    expect(shifts.data[0]).toMatchObject({
      status: 'CLOSED',
      cashRefunds: '2600.00',
      expectedCash: '21300.00',
      variance: '0.00',
    });
  });
});
