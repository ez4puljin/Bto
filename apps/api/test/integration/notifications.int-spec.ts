import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson } from '../harness/catalog';
import { financeApi, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type AppNoticeJson, noticeBody, notificationsApi } from '../harness/notifications';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { repApi, repOrderBody } from '../harness/sales-rep';

/**
 * App notices v1 (ADR-0062): the admin's notices with a picture and products, what a rep sees and
 * reads, the read count without admins, the withdrawal, and the notification of a rep's sold
 * order. Synthetic data.
 */
describe('app notices', () => {
  let app: NestExpressApplication;
  let migrator: Client;
  let admin: string;
  let office: string;
  let rep: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let cola: ProductJson;
  let juice: ProductJson;
  let waiting: ProductJson;
  let shop: CustomerJson;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const count = async (query: string, params: unknown[] = []) =>
    (await migrator.query<{ count: string }>(query, params)).rows[0]?.count;

  beforeAll(async () => {
    app = await createHttpApp();
    migrator = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    rep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    flow = await salesFlow(app, admin, 'NT');
    cola = await flow.product('8601', 'Кола 1л', '2500', '50');
    juice = await flow.product('8602', 'Жүүс 1л', '3200', '50');
    const catalog = catalogApi(app, admin);
    waiting = await catalog.product({
      sku: '8603',
      name: 'Үнэгүй бараа',
      categoryId: await catalog.category('Мэдэгдлийн бараа'),
      baseUomId: await catalog.uomId('PCS'),
    });
    shop = await partnersApi(app, admin).customer({ name: 'Мэдэгдлийн дэлгүүр' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await migrator.end();
    await app.close();
  });

  it('lets only notifications.send write or list notices; every signed-in user has an inbox', async () => {
    await http().get('/api/v1/app-notices').set(bearer(office)).expect(403);
    await notificationsApi(app, rep).create(noticeBody()).expect(403);
    await http().get('/api/v1/me/notifications/summary').expect(401);
    // The office holds no sales.orders.rep: no notices, only its own notifications.
    expect(await notificationsApi(app, office).summary()).toEqual({ unread: 0, notices: [] });
  });

  it('sends a notice with a picture and products in the chosen order', async () => {
    const api = notificationsApi(app, admin);
    const imageFileId = await api.upload();
    const key = idempotency();
    const body = noticeBody({
      kind: 'PRICE_DROP',
      title: '  Үнэ хямдарлаа  ',
      imageFileId,
      productIds: [juice.id, cola.id],
      validTo: addDays(today, 7),
    });
    const created = (await api.create(body, key).expect(201)).body as AppNoticeJson;
    expect(created).toMatchObject({
      kind: 'PRICE_DROP',
      title: 'Үнэ хямдарлаа',
      state: 'RUNNING',
      validFrom: today,
      validTo: addDays(today, 7),
      popup: true,
      reads: 0,
      withdrawnAt: null,
    });
    expect(created.products.map((product) => product.id)).toEqual([juice.id, cola.id]);
    expect(created.imageUrl).toMatch(/^\/api\/v1\/files\/public\//);
    await http()
      .get(created.imageUrl ?? '')
      .expect(200);
    // A repeated send replays the answer; the picture cannot go on a second notice.
    const again = await api.create(body, key).expect(201);
    expect((again.body as AppNoticeJson).id).toBe(created.id);
    const second = await api.create(noticeBody({ imageFileId })).expect(409);
    expect(second.body).toMatchObject({ code: 'FILE_NOT_UPLOADED' });
  });

  it('refuses what a notice cannot be, and writes nothing then', async () => {
    const api = notificationsApi(app, admin);
    const before = await count('SELECT count(*) FROM app_notices');
    const refused = async (fields: Record<string, unknown>, status: number) =>
      (await api.create(noticeBody(fields)).expect(status)).body as {
        code: string;
        errors?: { path: string; constraint: string }[];
      };
    expect((await refused({ validFrom: addDays(today, -1) }, 422)).errors?.[0]).toMatchObject({
      path: 'validFrom',
      constraint: 'notPast',
    });
    expect((await refused({ validTo: today }, 422)).errors?.[0]).toMatchObject({
      path: 'validTo',
      constraint: 'afterStart',
    });
    expect((await refused({ title: 'я'.repeat(81) }, 422)).errors?.[0]).toMatchObject({
      path: 'title',
      constraint: 'maxLength',
    });
    expect((await refused({ title: '   ' }, 422)).errors?.[0]).toMatchObject({
      path: 'title',
      constraint: 'isNotEmpty',
    });
    // 80 characters with an emoji count as 80, as the database counts them.
    await api.create(noticeBody({ title: `🎉${'я'.repeat(79)}` })).expect(201);
    await refused({ productIds: Array.from({ length: 21 }, (_, index) => index + 1) }, 422);
    await refused({ productIds: [cola.id, cola.id] }, 422);
    await refused({ kind: 'SALE' }, 422);
    expect((await refused({ productIds: [waiting.id] }, 409)).code).toBe('PRODUCT_NOT_SELLABLE');
    expect((await refused({ productIds: [999_999_999] }, 404)).code).toBe('NOT_FOUND');
    await api.http().post('/api/v1/app-notices').set(bearer(admin)).send(noticeBody()).expect(400);
    expect(await count('SELECT count(*) FROM app_notices')).toBe(String(Number(before) + 1));
  });

  it('shows a rep the running notices only, and reads one when it is closed', async () => {
    const api = notificationsApi(app, admin);
    const running = await api.notice(noticeBody({ title: 'Идэвхтэй', productIds: [cola.id] }));
    const scheduled = await api.notice(
      noticeBody({ title: 'Маргааш', validFrom: addDays(today, 1) }),
    );
    const withdrawn = await api.notice(noticeBody({ title: 'Буцаасан' }));
    await api.withdraw(withdrawn.id).expect(200);
    const ended = await api.notice(noticeBody({ title: 'Дууссан' }));
    await migrator.query(
      'UPDATE app_notices SET valid_from = $2::date - 3, valid_to = $2::date WHERE id = $1',
      [ended.id, today],
    );

    const inbox = notificationsApi(app, rep);
    const before = await inbox.summary();
    const ids = before.notices.map((notice) => notice.id);
    expect(ids).toContain(running.id);
    expect(ids).not.toContain(scheduled.id);
    expect(ids).not.toContain(withdrawn.id);
    expect(ids).not.toContain(ended.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(before.notices.find((notice) => notice.id === running.id)).toMatchObject({
      read: false,
      popup: true,
      productIds: [cola.id],
    });

    // Closing marks it read; a notice that is not running is ignored.
    expect(await inbox.read({ noticeIds: [running.id, scheduled.id] })).toBe(before.unread - 1);
    expect(await inbox.read({ noticeIds: [running.id] })).toBe(before.unread - 1);
    const after = await inbox.summary();
    expect(after.notices.find((notice) => notice.id === running.id)?.read).toBe(true);
    expect(
      await count('SELECT count(*) FROM app_notice_reads WHERE notice_id = $1', [scheduled.id]),
    ).toBe('0');
  });

  it('counts the reps that read a notice, never admins', async () => {
    const api = notificationsApi(app, admin);
    const notice = await api.notice(noticeBody({ title: 'Тоолох' }));
    const recipients = notice.recipients;
    const second = await seedUser(app, { roles: ['SALES_REP'] });
    await seedUser(app, { roles: ['SALES_REP'], status: 'DISABLED' });
    await seedUser(app, { roles: ['ADMIN'] });
    expect((await api.find(notice.id)).recipients).toBe(recipients + 1);

    await notificationsApi(app, admin).read({ noticeIds: [notice.id] });
    expect((await api.find(notice.id)).reads).toBe(0);
    await notificationsApi(app, rep).read({ noticeIds: [notice.id] });
    const secondToken = (await login(app, second)).accessToken;
    await notificationsApi(app, secondToken).read({ noticeIds: [notice.id] });
    expect((await api.find(notice.id)).reads).toBe(2);
  });

  it('tells a rep their order was sold, once; an office order tells nobody', async () => {
    const order = await repApi(app, rep).order(
      repOrderBody(flow.stage('Захиалга').id, shop.id, [
        { productUnitId: flow.pcs(cola), qty: '2' },
      ]),
    );
    const inbox = notificationsApi(app, rep);
    const before = await inbox.summary();
    const sold = await flow.sell(order.id);
    expect(sold.status).toBe('INVOICED');
    const invoice = await financeApi(app, admin).invoiceOfOrder(order.id);

    const mine = await inbox.mine();
    expect(mine.filter((row) => row.orderId === order.id)).toEqual([
      expect.objectContaining({
        kind: 'ORDER_SOLD',
        orderNumber: order.number,
        customerName: shop.name,
        orderTotal: sold.total,
        invoiceNumber: invoice?.number,
        read: false,
      }),
    ]);
    const row = mine.find((entry) => entry.orderId === order.id);
    expect((await inbox.summary()).unread).toBe(before.unread + 1);
    expect(await inbox.read({ notificationIds: [row?.id ?? 0] })).toBe(before.unread);
    expect((await inbox.mine()).find((entry) => entry.id === row?.id)?.read).toBe(true);
    // Another user cannot mark it.
    expect(await notificationsApi(app, office).read({ notificationIds: [row?.id ?? 0] })).toBe(0);

    const officeOrder = await flow.draft(shop.id, [{ productUnitId: flow.pcs(juice), qty: '1' }]);
    await flow.sell(officeOrder.id);
    expect(
      await count('SELECT count(*) FROM user_notifications WHERE order_id = $1', [officeOrder.id]),
    ).toBe('0');
  });

  it('withdraws a notice once and keeps it listed', async () => {
    const api = notificationsApi(app, admin);
    const notice = await api.notice(noticeBody({ title: 'Буцаах' }));
    const first = (await api.withdraw(notice.id).expect(200)).body as AppNoticeJson;
    expect(first).toMatchObject({ state: 'WITHDRAWN', withdrawnByName: 'Тест хэрэглэгч' });
    const again = (await api.withdraw(notice.id).expect(200)).body as AppNoticeJson;
    expect(again.withdrawnAt).toBe(first.withdrawnAt);
    expect((await notificationsApi(app, rep).summary()).notices.map((n) => n.id)).not.toContain(
      notice.id,
    );
    await api.withdraw(999_999_999).expect(404);
    await notificationsApi(app, office).withdraw(notice.id).expect(403);
  });
});
