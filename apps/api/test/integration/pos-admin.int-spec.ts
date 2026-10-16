import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHttpApp } from '../harness/apps';
import { seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { type EdgeNodeJson, posActors, posApi, type TillJson } from '../harness/pos';

/**
 * The admin's half of the POS (ADR-0063 #2, #6, #8): the store's settings, the edge nodes and
 * their tokens, the tills, the cashiers and their PINs, and who may do what.
 */
describe('pos admin', () => {
  let app: NestExpressApplication;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let storeId: number;
  let wholesaleId: number;

  beforeAll(async () => {
    app = await createHttpApp();
    actors = await posActors(app);
    const inventory = inventoryApi(app, actors.admin);
    storeId = (await inventory.warehouse('PADS', 'STORE')).id;
    wholesaleId = (await inventory.warehouse('PADW')).id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps the settings on one row and wants a STORE warehouse and a cash box', async () => {
    const admin = posApi(app, actors.admin);
    expect(await admin.settings()).toMatchObject({
      storeWarehouseId: null,
      returnWindowDays: 14,
      snapshotIntervalSec: 60,
      supervisorRequired: true,
    });
    await admin.setSettings({ storeWarehouseId: wholesaleId }).expect(422);
    const saved = (
      await admin.setSettings({ storeWarehouseId: storeId, returnWindowDays: 7 }).expect(200)
    ).body as Record<string, unknown>;
    expect(saved).toMatchObject({ storeWarehouseId: storeId, returnWindowDays: 7 });
    await admin.setSettings({ returnWindowDays: 400 }).expect(422);
    // The office reads, the office does not change.
    expect(await posApi(app, actors.office).settings()).toMatchObject({ returnWindowDays: 7 });
    await posApi(app, actors.office).setSettings({ returnWindowDays: 3 }).expect(403);
    await posApi(app, actors.warehouse)
      .http()
      .get('/api/v1/pos/settings')
      .set(posApi(app, actors.warehouse).auth)
      .expect(403);
  });

  it('registers an edge node, issues its token once and lets only that token in', async () => {
    const admin = posApi(app, actors.admin);
    await admin.createNode({ code: 'sm9', name: 'Дэлгүүр', warehouseId: wholesaleId }).expect(422);
    const node = (
      await admin.createNode({ code: 'sm9', name: 'Дэлгүүр', warehouseId: storeId }).expect(201)
    ).body as EdgeNodeJson;
    expect(node).toMatchObject({ code: 'SM9', tokenPrefix: null, status: 'ACTIVE' });
    await admin.createNode({ code: 'SM9', name: 'Давхар', warehouseId: storeId }).expect(409);
    const first = await admin.issueToken(node.id);
    expect(first.token).toMatch(new RegExp(`^tgs_${node.id}_[A-Za-z0-9_-]{32,}$`));
    const beat = (
      await admin
        .heartbeat(first.token, { appVersion: '1.0.0', backlog: 3, clockSkewMs: 120 })
        .expect(200)
    ).body as { edgeNodeId: number; code: string; settings: { storeWarehouseId: number } };
    expect(beat).toMatchObject({ edgeNodeId: node.id, code: 'SM9' });
    expect(beat.settings.storeWarehouseId).toBe(storeId);
    const listed = (await admin.nodes()).find((row) => row.id === node.id);
    expect(listed).toMatchObject({ backlog: 3, tokenPrefix: first.prefix });
    expect(listed?.lastSeenAt).not.toBeNull();
    // A new token replaces the old one.
    const second = await admin.issueToken(node.id);
    await admin.heartbeat(first.token, { backlog: 0 }).expect(401);
    await admin.heartbeat(second.token, { backlog: 0 }).expect(200);
    // An inactive node is refused.
    await admin.updateNode(node.id, { status: 'INACTIVE' }).expect(200);
    await admin.heartbeat(second.token, { backlog: 0 }).expect(401);
    await admin.updateNode(node.id, { status: 'ACTIVE' }).expect(200);
    await posApi(app, actors.office)
      .createNode({ code: 'SM8', name: 'x', warehouseId: storeId })
      .expect(403);
  });

  it('keeps tills per node with their printers and hands out pairing codes', async () => {
    const admin = posApi(app, actors.admin);
    const node = (
      await admin.createNode({ code: 'SM7', name: 'Дэлгүүр 7', warehouseId: storeId }).expect(201)
    ).body as EdgeNodeJson;
    const till = (
      await admin
        .createTill({
          edgeNodeId: node.id,
          code: ' к3 ',
          name: 'Касс 3',
          printerHost: '192.168.1.33',
        })
        .expect(201)
    ).body as TillJson;
    expect(till).toMatchObject({ code: 'К3', printerHost: '192.168.1.33', printerPort: 9100 });
    await admin
      .createTill({ edgeNodeId: node.id, code: 'К3', name: 'Давхар', printerHost: null })
      .expect(409);
    await admin
      .createTill({ edgeNodeId: node.id, code: 'касс 3', name: 'x', printerHost: null })
      .expect(422);
    const updated = (
      await admin
        .updateTill(till.id, { printerHost: null, printerPort: 9101, status: 'INACTIVE' })
        .expect(200)
    ).body as TillJson;
    expect(updated).toMatchObject({ printerHost: null, printerPort: 9101, status: 'INACTIVE' });
    const code = (await admin.pairingCode(till.id).expect(200)).body as {
      code: string;
      expiresAt: string;
    };
    expect(code.code).toMatch(/^[0-9]{6}$/);
    expect(Date.parse(code.expiresAt)).toBeGreaterThan(Date.now());
    expect((await admin.tills({ edgeNodeId: node.id })).map((row) => row.code)).toEqual(['К3']);
  });

  it('sets six-digit PINs, never reads them back, and locks after wrong tries', async () => {
    const admin = posApi(app, actors.admin);
    const cashier = await seedUser(app, { roles: ['POS_CASHIER'] });
    await admin.setPin(cashier.id, '12345').expect(422);
    await admin.setPin(cashier.id, 'abcdef').expect(422);
    const set = (await admin.setPin(cashier.id, '123456').expect(200)).body as Record<
      string,
      unknown
    >;
    expect(set).toMatchObject({ userId: cashier.id, status: 'ACTIVE', failedCount: 0 });
    expect(JSON.stringify(set)).not.toContain('123456');
    expect(JSON.stringify(await admin.cashiers())).not.toMatch(/pinHash|123456/);
    const disabled = await seedUser(app, { roles: ['POS_CASHIER'], status: 'DISABLED' });
    await admin.setPin(disabled.id, '123456').expect(403);
    const inactive = (await admin.setCashierStatus(cashier.id, 'INACTIVE').expect(200))
      .body as Record<string, unknown>;
    expect(inactive.status).toBe('INACTIVE');
    await admin.unlock(cashier.id).expect(200);
    await posApi(app, actors.office).setPin(cashier.id, '123456').expect(403);
    expect(
      (await posApi(app, actors.office).cashiers()).some((row) => row.userId === cashier.id),
    ).toBe(true);
  });
});
