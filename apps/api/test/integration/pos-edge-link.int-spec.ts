import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { EdgeLinkState, EdgeLoginResponse, EdgePairResponse } from '@tugeel/shared/pos';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { posActors, posStore } from '../harness/pos';

/**
 * ADR-0136: a new edge with no token in its environment, linked from the kiosk with the node's
 * code and an admin's one-time code. The centre's answer — the token and the PIN key — is kept in
 * the edge's database, survives a restart, and lets a cashier's PIN through. A token the centre
 * replaced lets the kiosk link again, to the same node. Synthetic data only.
 */
describe('pos edge link', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let databaseUrl: string;
  let centralUrl: string;
  let store: Awaited<ReturnType<typeof posStore>>;

  const linkCode = async () =>
    (
      (
        await store.pos
          .http()
          .post(`/api/v1/pos/edge-nodes/${store.node.id}/link-code`)
          .set(store.pos.auth)
          .expect(200)
      ).body as { code: string }
    ).code;

  beforeAll(async () => {
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    centralUrl = `http://127.0.0.1:${(central.getHttpServer().address() as AddressInfo).port}`;
    const actors = await posActors(central);
    store = await posStore(central, actors.admin, 'PL');
    databaseUrl = await edgeDatabase();
    edge = await createEdgeApp({ databaseUrl, centralUrl });
  });
  afterAll(async () => {
    await edge?.close();
    await central?.close();
  });

  it('starts unlinked, links with the code and lets a cashier in with the PIN', async () => {
    const kiosk = kioskApi(edge);
    expect((await kiosk.get('/link').expect(200)).body).toMatchObject({
      linked: false,
      source: null,
    });
    // Nothing reaches the centre before the link.
    expect(await edge.get(SyncRunner).pullOnce()).toBe('failed');
    // A wrong code, and an address nobody answers at, are refused.
    const bad = await kiosk
      .post('/link', { centralUrl, nodeCode: 'PL1', linkCode: 'AAAA-AAAA' })
      .expect(422);
    expect(bad.body).toMatchObject({ code: 'EDGE_LINK_INVALID' });
    await kiosk
      .post('/link', { centralUrl: 'http://127.0.0.1:9', nodeCode: 'PL1', linkCode: 'AAAA-AAAA' })
      .expect(502);
    const state = (
      await kiosk
        .post('/link', {
          centralUrl: `${centralUrl}/`,
          nodeCode: 'pl1',
          linkCode: await linkCode(),
        })
        .expect(200)
    ).body as EdgeLinkState;
    expect(state).toMatchObject({
      linked: true,
      source: 'code',
      centralUrl,
      nodeCode: 'PL1',
      rejected: false,
    });
    // Linked once: the kiosk cannot link it elsewhere.
    await kiosk.post('/link', { centralUrl, nodeCode: 'PL1', linkCode: 'AAAA-AAAA' }).expect(409);

    expect(await edge.get(SyncRunner).pullOnce()).not.toBe('failed');
    const issued = (await store.pos.pairingCode(store.till.id).expect(200)).body as {
      code: string;
    };
    const paired = (
      await kiosk.post('/pair', { tillCode: 'К1', pairingCode: issued.code }).expect(200)
    ).body as EdgePairResponse;
    kiosk.setDevice(paired.deviceToken);
    // The PIN key came with the link: the centre's hash checks out on the edge.
    const login = (
      await kiosk.post('/auth/pin', { userId: store.cashierId, pin: '123456' }).expect(200)
    ).body as EdgeLoginResponse;
    expect(login.cashier.userId).toBe(store.cashierId);
  });

  it('keeps the link across a restart and links again after the centre replaced the token', async () => {
    await edge.close();
    edge = await createEdgeApp({ databaseUrl, centralUrl });
    const kiosk = kioskApi(edge);
    expect((await kiosk.get('/link').expect(200)).body).toMatchObject({
      linked: true,
      source: 'code',
      nodeCode: 'PL1',
    });
    const sync = edge.get(SyncRunner);
    expect(await sync.heartbeatOnce()).toBe(true);
    // The admin issues a new token by hand: the edge's is refused, the kiosk may link again.
    await store.pos.issueToken(store.node.id);
    expect(await sync.heartbeatOnce()).toBe(false);
    expect((await kiosk.get('/link').expect(200)).body).toMatchObject({ rejected: true });
    // Only to the same node.
    await kiosk.post('/link', { centralUrl, nodeCode: 'XX1', linkCode: 'AAAA-AAAA' }).expect(409);
    await kiosk
      .post('/link', { centralUrl, nodeCode: 'PL1', linkCode: await linkCode() })
      .expect(200);
    expect(await sync.heartbeatOnce()).toBe(true);
    expect((await kiosk.get('/link').expect(200)).body).toMatchObject({ rejected: false });
  });
});
