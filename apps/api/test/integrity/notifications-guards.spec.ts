import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { salesFlow } from '../harness/finance';
import { login, seedUser } from '../harness/identity';
import { noticeBody, notificationsApi } from '../harness/notifications';
import { partnersApi } from '../harness/partners';
import { repApi, repOrderBody } from '../harness/sales-rep';

/**
 * The database guards of notifications (ADR-0062, migration 0028): app may withdraw a notice and
 * mark a notification read, nothing else; a notice, its products, its reads and the notifications
 * are never deleted; parallel reads of one notice leave one row.
 */
describe('notifications guards', () => {
  let app: NestExpressApplication;
  let asApp: Client;
  let admin: string;
  let rep: string;
  let repId: number;
  let noticeId: number;
  let notificationId: number;

  beforeAll(async () => {
    app = await createHttpApp();
    asApp = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const seeded = await seedUser(app, { roles: ['SALES_REP'] });
    repId = seeded.id;
    rep = (await login(app, seeded)).accessToken;
    noticeId = (await notificationsApi(app, admin).notice(noticeBody({ title: 'Хамгаалалт' }))).id;
    await notificationsApi(app, rep).read({ noticeIds: [noticeId] });
    // A rep's order sold, so the listener writes the rep's notification.
    const flow = await salesFlow(app, admin, 'NG');
    const product = await flow.product('8701', 'Хамгаалалтын бараа', '1000', '10');
    const shop = await partnersApi(app, admin).customer({ name: 'Хамгаалалтын харилцагч' });
    const order = await repApi(app, rep).order(
      repOrderBody(flow.stage('Захиалга').id, shop.id, [
        { productUnitId: flow.pcs(product), qty: '1' },
      ]),
    );
    await flow.sell(order.id);
    const mine = await notificationsApi(app, rep).mine();
    notificationId = mine.find((row) => row.orderId === order.id)?.id ?? 0;
  });
  afterAll(async () => {
    await asApp.end();
    await app.close();
  });

  it('lets app neither edit nor delete a notice, its products or its reads', async () => {
    expect(
      await sqlStateOf(asApp.query("UPDATE app_notices SET title = 'x' WHERE id = $1", [noticeId])),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('DELETE FROM app_notices WHERE id = $1', [noticeId]))).toBe(
      '42501',
    );
    expect(
      await sqlStateOf(
        asApp.query('DELETE FROM app_notice_products WHERE notice_id = $1', [noticeId]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        asApp.query('UPDATE app_notice_reads SET read_at = now() WHERE notice_id = $1', [noticeId]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        asApp.query('DELETE FROM app_notice_reads WHERE notice_id = $1', [noticeId]),
      ),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('TRUNCATE app_notices CASCADE'))).toBe('42501');
  });

  it('lets app only mark a notification read, and only withdraw a notice', async () => {
    expect(notificationId).toBeGreaterThan(0);
    expect(
      await sqlStateOf(
        asApp.query("UPDATE user_notifications SET payload = '{}' WHERE id = $1", [notificationId]),
      ),
    ).toBe('42501');
    expect(
      await sqlStateOf(
        asApp.query('DELETE FROM user_notifications WHERE id = $1', [notificationId]),
      ),
    ).toBe('42501');
    await asApp.query('UPDATE user_notifications SET read_at = now() WHERE id = $1', [
      notificationId,
    ]);
    await asApp.query(
      'UPDATE app_notices SET withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1',
      [noticeId, repId],
    );
  });

  it('keeps one read per user and notice under parallel reads', async () => {
    const fresh = (await notificationsApi(app, admin).notice(noticeBody({ title: 'Зэрэг' }))).id;
    const inbox = notificationsApi(app, rep);
    await Promise.all(Array.from({ length: 6 }, () => inbox.read({ noticeIds: [fresh] })));
    const rows = await asApp.query<{ count: string }>(
      'SELECT count(*) FROM app_notice_reads WHERE notice_id = $1 AND user_id = $2',
      [fresh, repId],
    );
    expect(rows.rows[0]?.count).toBe('1');
  });
});
