import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { bearer, login, type SeededUser, seedUser } from '../harness/identity';

/**
 * Attendance (ADR-0131): a punch from the staff app counts only inside one of the person's work
 * sites and only in turn; HR keeps the sites, the schedule and the employees' terms, reads the
 * dashboard and corrects with a note; a punch is never rewritten. Synthetic data.
 */
describe('attendance', () => {
  let app: NestExpressApplication;
  let migrator: Client;
  let admin: string;
  let hr: string;
  let keeper: SeededUser;
  let keeperToken: string;
  let rep: SeededUser;
  let repToken: string;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  // Mörön: the main site and a second one a few kilometres away.
  const MAIN = { lat: '49.634500', lng: '100.162300' };
  const FAR = { lat: '49.660000', lng: '100.200000' };
  /** About 1.1 km north of the main site. */
  const OUTSIDE = { lat: '49.644500', lng: '100.162300' };
  let mainSiteId: number;
  let farSiteId: number;

  const punch = (token: string, kind: 'IN' | 'OUT', where: { lat: string; lng: string }, accuracyM?: number) =>
    http()
      .post('/api/v1/hr/attendance/punch')
      .set(bearer(token))
      .send({ kind, ...where, ...(accuracyM === undefined ? {} : { accuracyM }) });

  beforeAll(async () => {
    app = await createHttpApp();
    migrator = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    hr = (await login(app, await seedUser(app, { roles: ['HR'] }))).accessToken;
    keeper = await seedUser(app, { roles: ['WAREHOUSE'] });
    keeperToken = (await login(app, keeper)).accessToken;
    rep = await seedUser(app, { roles: ['SALES_REP'] });
    repToken = (await login(app, rep)).accessToken;
  });
  afterAll(async () => {
    await migrator.end();
    await app.close();
  });

  it('refuses a punch while no work site exists, and the sites to those without the rights', async () => {
    const refused = await punch(keeperToken, 'IN', MAIN).expect(409);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_NO_SITE' });
    await http().get('/api/v1/hr/work-sites').set(bearer(keeperToken)).expect(403);
    await http()
      .post('/api/v1/hr/work-sites')
      .set(bearer(keeperToken))
      .send({ name: 'Оргил бөөний төв', ...MAIN, radiusM: 150, branchId: null })
      .expect(403);
  });

  it('lets HR keep the sites: a name once, a radius in range, a point in Mongolia', async () => {
    const created = await http()
      .post('/api/v1/hr/work-sites')
      .set(bearer(hr))
      .send({ name: '  Оргил бөөний төв ', ...MAIN, radiusM: 150, branchId: null })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Оргил бөөний төв', radiusM: 150, lat: '49.6345', archivedAt: null });
    mainSiteId = (created.body as { id: number }).id;
    const far = await http()
      .post('/api/v1/hr/work-sites')
      .set(bearer(hr))
      .send({ name: 'Хойд агуулах', ...FAR, radiusM: 100, branchId: null })
      .expect(201);
    farSiteId = (far.body as { id: number }).id;
    await http()
      .post('/api/v1/hr/work-sites')
      .set(bearer(hr))
      .send({ name: 'оргил бөөний төв', ...MAIN, radiusM: 150, branchId: null })
      .expect(422);
    await http()
      .post('/api/v1/hr/work-sites')
      .set(bearer(hr))
      .send({ name: 'Хол', lat: '10.000000', lng: '10.000000', radiusM: 150, branchId: null })
      .expect(422);
    await http()
      .post('/api/v1/hr/work-sites')
      .set(bearer(hr))
      .send({ name: 'Жижиг', ...MAIN, radiusM: 10, branchId: null })
      .expect(422);
    const sites = (await http().get('/api/v1/hr/work-sites').set(bearer(admin)).expect(200))
      .body as { id: number }[];
    expect(sites.map((site) => site.id).sort()).toEqual([mainSiteId, farSiteId].sort());
  });

  it('accepts a punch inside a site, in turn, and refuses the rest with a reason', async () => {
    const outside = await punch(keeperToken, 'IN', OUTSIDE).expect(409);
    expect(outside.body).toMatchObject({
      code: 'ATTENDANCE_OUT_OF_RANGE',
      params: { site: 'Оргил бөөний төв', radiusM: 150 },
    });
    expect((outside.body as { params: { distanceM: number } }).params.distanceM).toBeGreaterThan(1000);
    const loose = await punch(keeperToken, 'IN', MAIN, 450).expect(422);
    expect(loose.body).toMatchObject({ code: 'ATTENDANCE_LOCATION_IMPRECISE' });
    const notIn = await punch(keeperToken, 'OUT', MAIN).expect(409);
    expect(notIn.body).toMatchObject({ code: 'ATTENDANCE_NOT_IN' });

    const inside = await punch(keeperToken, 'IN', { lat: '49.634900', lng: '100.162300' }, 12).expect(201);
    expect(inside.body).toMatchObject({
      kind: 'IN',
      source: 'APP',
      siteId: mainSiteId,
      siteName: 'Оргил бөөний төв',
      businessDate: today,
      accuracyM: 12,
      deletedAt: null,
    });
    expect((inside.body as { distanceM: number }).distanceM).toBeLessThan(60);
    const again = await punch(keeperToken, 'IN', MAIN).expect(409);
    expect(again.body).toMatchObject({ code: 'ATTENDANCE_ALREADY_IN' });
    expect((again.body as { params: { at: string } }).params.at).toMatch(/^\d{2}:\d{2}$/);

    const me = (await http().get('/api/v1/hr/attendance/me').set(bearer(keeperToken)).expect(200))
      .body as { state: string; today: string; day: { firstIn: string | null; openIn: boolean }; sites: { id: number }[]; tracked: boolean };
    expect(me.state).toBe('IN');
    expect(me.today).toBe(today);
    expect(me.day.openIn).toBe(true);
    expect(me.day.firstIn).not.toBeNull();
    expect(me.sites.map((site) => site.id).sort()).toEqual([mainSiteId, farSiteId].sort());
    expect(me.tracked).toBe(true);

    await punch(keeperToken, 'OUT', MAIN).expect(201);
    const after = (await http().get('/api/v1/hr/attendance/me').set(bearer(keeperToken)).expect(200))
      .body as { state: string; todayEvents: unknown[]; month: { presentDays: number } };
    expect(after.state).toBe('OUT');
    expect(after.todayEvents).toHaveLength(2);
    expect(after.month.presentDays).toBe(1);
  });

  it('narrows a person to their assigned sites and lets HR untrack someone', async () => {
    await http()
      .put(`/api/v1/hr/employees/${rep.id}`)
      .set(bearer(keeperToken))
      .send({ tracked: true, workStart: null, workEnd: null, graceMinutes: null, workdays: null, siteIds: [farSiteId] })
      .expect(403);
    const terms = await http()
      .put(`/api/v1/hr/employees/${rep.id}`)
      .set(bearer(hr))
      .send({ tracked: true, workStart: '10:00', workEnd: '19:00', graceMinutes: null, workdays: null, siteIds: [farSiteId] })
      .expect(200);
    expect(terms.body).toMatchObject({
      userId: rep.id,
      siteIds: [farSiteId],
      schedule: { workStart: '10:00', workEnd: '19:00', graceMinutes: 10 },
    });
    const refused = await punch(repToken, 'IN', MAIN).expect(409);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_OUT_OF_RANGE', params: { site: 'Хойд агуулах' } });
    await punch(repToken, 'IN', FAR).expect(201);
    const me = (await http().get('/api/v1/hr/attendance/me').set(bearer(repToken)).expect(200))
      .body as { sites: { id: number }[]; schedule: { workStart: string } };
    expect(me.sites.map((site) => site.id)).toEqual([farSiteId]);
    expect(me.schedule.workStart).toBe('10:00');
    // The end must follow the start; the grace has a ceiling.
    await http()
      .put(`/api/v1/hr/employees/${rep.id}`)
      .set(bearer(hr))
      .send({ tracked: true, workStart: '10:00', workEnd: '09:00', graceMinutes: null, workdays: null, siteIds: [] })
      .expect(422);
    await http()
      .put(`/api/v1/hr/employees/${rep.id}`)
      .set(bearer(hr))
      .send({ tracked: true, workStart: null, workEnd: null, graceMinutes: 500, workdays: null, siteIds: [] })
      .expect(422);
  });

  it('keeps the company schedule for HR alone', async () => {
    await http().get('/api/v1/hr/schedule').set(bearer(keeperToken)).expect(403);
    const before = (await http().get('/api/v1/hr/schedule').set(bearer(hr)).expect(200)).body as {
      workStart: string;
      updatedAt: string | null;
    };
    expect(before).toMatchObject({ workStart: '09:00', updatedAt: null });
    await http()
      .put('/api/v1/hr/schedule')
      .set(bearer(hr))
      .send({ workStart: '09:00', workEnd: '08:00', graceMinutes: 10, workdays: '1111110' })
      .expect(422);
    await http()
      .put('/api/v1/hr/schedule')
      .set(bearer(hr))
      .send({ workStart: '08:30', workEnd: '17:30', graceMinutes: 15, workdays: '0000000' })
      .expect(422);
    const saved = await http()
      .put('/api/v1/hr/schedule')
      .set(bearer(hr))
      .send({ workStart: '08:30', workEnd: '17:30', graceMinutes: 15, workdays: '1111100' })
      .expect(200);
    expect(saved.body).toMatchObject({ workStart: '08:30', graceMinutes: 15, workdays: '1111100' });
    expect((saved.body as { updatedAt: string | null }).updatedAt).not.toBeNull();
    // The keeper follows the company; the rep keeps their own hours.
    const employees = (await http().get('/api/v1/hr/employees').set(bearer(hr)).expect(200)).body as {
      userId: number;
      schedule: { workStart: string; graceMinutes: number };
    }[];
    expect(employees.find((row) => row.userId === keeper.id)?.schedule).toMatchObject({
      workStart: '08:30',
      graceMinutes: 15,
    });
    expect(employees.find((row) => row.userId === rep.id)?.schedule).toMatchObject({
      workStart: '10:00',
      graceMinutes: 15,
    });
  });

  it('shows the dashboard and the day log to hr.attendance.view', async () => {
    await http().get('/api/v1/hr/attendance/dashboard').set(bearer(keeperToken)).expect(403);
    const dashboard = (
      await http().get('/api/v1/hr/attendance/dashboard').set(bearer(hr)).expect(200)
    ).body as {
      date: string;
      counts: { present: number; inNow: number; expected: number };
      rows: { userId: number; status: string; state: string | null; firstIn: string | null; siteName: string | null; fullName: string }[];
      trend: { date: string }[];
      month: { userId: number; presentDays: number; avgArrivalMinutes: number | null }[];
    };
    expect(dashboard.date).toBe(today);
    expect(dashboard.trend).toHaveLength(14);
    expect(dashboard.trend.at(-1)?.date).toBe(today);
    const keeperRow = dashboard.rows.find((row) => row.userId === keeper.id);
    expect(keeperRow).toMatchObject({
      state: 'OUT',
      siteName: 'Оргил бөөний төв',
      fullName: 'Тест хэрэглэгч',
    });
    expect(['PRESENT', 'LATE']).toContain(keeperRow?.status);
    const repRow = dashboard.rows.find((row) => row.userId === rep.id);
    expect(repRow?.state).toBe('IN');
    expect(dashboard.counts.present).toBeGreaterThanOrEqual(2);
    expect(dashboard.counts.inNow).toBeGreaterThanOrEqual(1);
    expect(dashboard.month.find((row) => row.userId === keeper.id)).toMatchObject({ presentDays: 1 });
    expect(dashboard.month.find((row) => row.userId === keeper.id)?.avgArrivalMinutes).not.toBeNull();

    const days = (
      await http()
        .get('/api/v1/hr/attendance/days')
        .query({ from: today, to: today, userId: keeper.id })
        .set(bearer(hr))
        .expect(200)
    ).body as { data: { userId: number; date: string; workedMinutes: number }[] };
    expect(days.data).toHaveLength(1);
    expect(days.data[0]).toMatchObject({ userId: keeper.id, date: today });
    await http()
      .get('/api/v1/hr/attendance/days')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set(bearer(hr))
      .expect(422);
    const mine = (
      await http()
        .get('/api/v1/hr/attendance/me/days')
        .query({ month: today.slice(0, 7) })
        .set(bearer(keeperToken))
        .expect(200)
    ).body as { data: { date: string }[] };
    expect(mine.data[0]?.date).toBe(today);
  });

  it('lets HR type a missed punch in turn and strike a wrong one out; nothing is rewritten', async () => {
    const events = (
      await http()
        .get('/api/v1/hr/attendance/events')
        .query({ userId: keeper.id, date: today })
        .set(bearer(hr))
        .expect(200)
    ).body as { data: { id: number; kind: string; at: string }[] };
    expect(events.data.map((event) => event.kind)).toEqual(['IN', 'OUT']);
    const firstIn = events.data[0];
    if (!firstIn) throw new Error('no first IN');
    // An OUT before the first IN breaks the turns.
    const broken = await http()
      .post('/api/v1/hr/attendance/events')
      .set(bearer(hr))
      .send({
        userId: keeper.id,
        kind: 'OUT',
        at: new Date(Date.parse(firstIn.at) - 60_000).toISOString(),
        note: 'Буруу',
      })
      .expect(409);
    expect(broken.body).toMatchObject({ code: 'ATTENDANCE_EVENT_ORDER' });
    await http()
      .post('/api/v1/hr/attendance/events')
      .set(bearer(hr))
      .send({ userId: keeper.id, kind: 'IN', at: new Date().toISOString(), note: '   ' })
      .expect(422);
    await http()
      .post('/api/v1/hr/attendance/events')
      .set(bearer(keeperToken))
      .send({ userId: keeper.id, kind: 'IN', at: new Date().toISOString(), note: 'Өөрөө' })
      .expect(403);
    const added = await http()
      .post('/api/v1/hr/attendance/events')
      .set(bearer(hr))
      .send({ userId: keeper.id, kind: 'IN', at: new Date().toISOString(), note: 'Утас унтарсан' })
      .expect(201);
    expect(added.body).toMatchObject({ kind: 'IN', source: 'OFFICE', note: 'Утас унтарсан', siteId: null });
    const addedId = (added.body as { id: number }).id;

    const struck = await http()
      .delete(`/api/v1/hr/attendance/events/${addedId}`)
      .set(bearer(hr))
      .send({ reason: 'Андуурсан' })
      .expect(200);
    expect(struck.body).toMatchObject({ id: addedId, deleteReason: 'Андуурсан' });
    expect((struck.body as { deletedAt: string | null }).deletedAt).not.toBeNull();
    const all = (
      await http()
        .get('/api/v1/hr/attendance/events')
        .query({ userId: keeper.id, date: today })
        .set(bearer(hr))
        .expect(200)
    ).body as { data: { id: number; deletedAt: string | null }[] };
    expect(all.data).toHaveLength(3);
    expect(all.data.find((event) => event.id === addedId)?.deletedAt).not.toBeNull();
    // The struck-out IN no longer counts: the keeper is OUT again.
    const me = (await http().get('/api/v1/hr/attendance/me').set(bearer(keeperToken)).expect(200))
      .body as { state: string };
    expect(me.state).toBe('OUT');

    const audits = await migrator.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'hr_attendance_event' ORDER BY id`,
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['PUNCH', 'CREATE', 'DELETE']),
    );
    // The app role may strike a punch out, never change or remove it.
    const asApp = await connectAs('app');
    try {
      expect(
        await sqlStateOf(asApp.query(`UPDATE hr_attendance_events SET kind = 'OUT' WHERE id = $1`, [firstIn.id])),
      ).toBe('42501');
      expect(await sqlStateOf(asApp.query(`DELETE FROM hr_attendance_events WHERE id = $1`, [firstIn.id]))).toBe(
        '42501',
      );
      expect(await sqlStateOf(asApp.query(`DELETE FROM hr_work_sites WHERE id = $1`, [farSiteId]))).toBe('42501');
    } finally {
      await asApp.end();
    }
  });

  it('archives a site instead of deleting it; its punches keep their site', async () => {
    const archived = await http()
      .put(`/api/v1/hr/work-sites/${farSiteId}/archived`)
      .set(bearer(hr))
      .send({ archived: true })
      .expect(200);
    expect((archived.body as { archivedAt: string | null }).archivedAt).not.toBeNull();
    const live = (await http().get('/api/v1/hr/work-sites').set(bearer(hr)).expect(200)).body as { id: number }[];
    expect(live.map((site) => site.id)).toEqual([mainSiteId]);
    const withArchived = (
      await http().get('/api/v1/hr/work-sites').query({ includeArchived: 'true' }).set(bearer(hr)).expect(200)
    ).body as { id: number }[];
    expect(withArchived).toHaveLength(2);
    // The rep's only site is archived: no site to punch at until HR assigns another.
    const refused = await punch(repToken, 'OUT', FAR).expect(409);
    expect(refused.body).toMatchObject({ code: 'ATTENDANCE_NO_SITE' });
    const events = (
      await http()
        .get('/api/v1/hr/attendance/events')
        .query({ userId: rep.id, date: today })
        .set(bearer(hr))
        .expect(200)
    ).body as { data: { siteName: string | null }[] };
    expect(events.data[0]?.siteName).toBe('Хойд агуулах');
  });
});
