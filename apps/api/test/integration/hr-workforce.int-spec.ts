import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, login, SAME_ORIGIN, seedUser } from '../harness/identity';

interface StaffJson {
  userId: number;
  fullName: string;
  firstName: string;
  divisionId: number | null;
  divisionName: string | null;
  scheduleId: number | null;
  status: string;
  leftOn: string | null;
  passwordSet: boolean;
  lastLoginAt: string | null;
}
interface RequestJson {
  id: number;
  status: string;
  group: string;
  fromDate: string;
  toDate: string;
}
interface ReportJson {
  rows: {
    date: string;
    userId: number;
    status: string;
    requestName: string | null;
    planStart: string | null;
  }[];
  totals: { absentDays: number; leaveDays: number };
}

/**
 * HR beyond the punch (ADR-0144): divisions, an employee registered with a first password who signs
 * in by phone, a schedule per weekday and who follows it, time requests sent by the employee and
 * decided by HR (a missed punch written on approval), the report with the leave counted, leaving
 * disabling the account, and the rights. Synthetic data.
 */
describe('hr workforce', () => {
  let app: NestExpressApplication;
  let hr: string;
  let office: string;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const today = businessDate();
  const PHONE = '88001122';
  const PASSWORD = 'Tsagaan-2026';
  let divisionId: number;
  let employee: StaffJson;
  let employeeToken: string;
  let scheduleId: number;

  beforeAll(async () => {
    app = await createHttpApp();
    hr = (await login(app, await seedUser(app, { roles: ['HR'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps divisions and registers an employee who signs in by phone with the first password', async () => {
    const division = await http()
      .post('/api/v1/hr/divisions')
      .set(bearer(hr))
      .send({ name: ' Агуулах ', sort: 1 })
      .expect(201);
    divisionId = (division.body as { id: number }).id;
    await http()
      .post('/api/v1/hr/divisions')
      .set(bearer(hr))
      .send({ name: 'агуулах', sort: 2 })
      .expect(409);
    const created = await http()
      .post('/api/v1/hr/staff')
      .set(bearer(hr))
      .set(idempotency())
      .send({
        firstName: 'Бат',
        lastName: 'Дорж',
        phone: PHONE,
        position: 'Нярав',
        divisionId,
        employmentType: 'PERMANENT',
        gender: 'MALE',
        employedOn: null,
        scheduleId: null,
        password: PASSWORD,
      })
      .expect(201);
    employee = created.body as StaffJson;
    expect(employee).toMatchObject({
      fullName: 'Дорж Бат',
      firstName: 'Бат',
      divisionName: 'Агуулах',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(created.body)).not.toContain(PASSWORD);
    employeeToken = (
      await login(app, { username: `p${PHONE}`, phone: `+976${PHONE}`, password: PASSWORD })
    ).accessToken;
    // The office reads nothing of HR's, the employee neither; a weak password is refused.
    await http().get('/api/v1/hr/staff').set(bearer(office)).expect(403);
    await http().get('/api/v1/hr/staff').set(bearer(employeeToken)).expect(403);
    await http()
      .post('/api/v1/hr/staff')
      .set(bearer(hr))
      .set(idempotency())
      .send({
        firstName: 'Сул',
        lastName: 'Нууц',
        phone: '88001133',
        position: null,
        divisionId: null,
        employmentType: 'PERMANENT',
        gender: null,
        employedOn: null,
        scheduleId: null,
        password: '123',
      })
      .expect(422);
  });

  it('gives a schedule per weekday and follows it in the report', async () => {
    const saved = await http()
      .post('/api/v1/hr/schedules')
      .set(bearer(hr))
      .send({
        name: 'А/нярав',
        kind: 'FIXED',
        color: '#f59e0b',
        days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          start: weekday === 6 ? '10:00' : '09:00',
          end: weekday === 6 ? '16:00' : '18:00',
          breakStart: null,
          breakEnd: null,
          minutes: 0,
        })),
        userIds: [employee.userId],
      })
      .expect(201);
    scheduleId = (saved.body as { id: number }).id;
    expect(saved.body).toMatchObject({ userIds: [employee.userId] });
    // A day ending before it starts is refused.
    await http()
      .post('/api/v1/hr/schedules')
      .set(bearer(hr))
      .send({
        name: 'Буруу',
        kind: 'FIXED',
        color: '#f59e0b',
        days: [
          {
            weekday: 1,
            start: '18:00',
            end: '09:00',
            breakStart: null,
            breakEnd: null,
            minutes: 0,
          },
        ],
        userIds: [],
      })
      .expect(422);
    const staff = (await http().get('/api/v1/hr/staff').set(bearer(hr)).expect(200))
      .body as StaffJson[];
    expect(staff.find((row) => row.userId === employee.userId)?.scheduleId).toBe(scheduleId);
  });

  it('takes a request from the employee and lets HR decide it', async () => {
    const types = (
      await http().get('/api/v1/hr/request-types').set(bearer(employeeToken)).expect(200)
    ).body as { id: number; name: string; group: string; wholeDays: boolean }[];
    expect(types.map((type) => type.name)).toContain('Ээлжийн амралт');
    const leave = types.find((type) => type.name === 'Ээлжийн амралт');
    const punchType = types.find((type) => type.group === 'PUNCH_CHOSEN');
    if (!leave || !punchType) throw new Error('seeded types missing');
    const yesterday = addDays(today, -1);
    const sent = await http()
      .post('/api/v1/hr/requests')
      .set(bearer(employeeToken))
      .set(idempotency())
      .send({ typeId: leave.id, fromDate: yesterday, toDate: yesterday, note: 'Гэрийн ажил' })
      .expect(201);
    const request1 = sent.body as RequestJson;
    expect(request1).toMatchObject({ status: 'PENDING', fromDate: yesterday, toDate: yesterday });
    // The employee cannot decide; HR approves.
    await http()
      .post(`/api/v1/hr/requests/${request1.id}/decision`)
      .set(bearer(employeeToken))
      .send({ approve: true, note: null })
      .expect(403);
    await http()
      .post(`/api/v1/hr/requests/${request1.id}/decision`)
      .set(bearer(hr))
      .send({ approve: true, note: 'Зөвшөөрөв' })
      .expect(200);
    await http()
      .post(`/api/v1/hr/requests/${request1.id}/decision`)
      .set(bearer(hr))
      .send({ approve: false, note: null })
      .expect(409);
    // A missed punch, approved, becomes the punch.
    const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const missed = await http()
      .post('/api/v1/hr/requests')
      .set(bearer(employeeToken))
      .set(idempotency())
      .send({
        typeId: punchType.id,
        fromDate: today,
        startsAt: at,
        punchKind: 'IN',
        note: 'Утас унтарсан',
      })
      .expect(201);
    const missedId = (missed.body as RequestJson).id;
    await http()
      .post(`/api/v1/hr/requests/${missedId}/decision`)
      .set(bearer(hr))
      .send({ approve: true, note: null })
      .expect(200);
    const events = (
      await http()
        .get('/api/v1/hr/attendance/events')
        .query({ userId: employee.userId, date: businessDate(new Date(at)) })
        .set(bearer(hr))
        .expect(200)
    ).body as { data: { kind: string; source: string }[] } | { kind: string; source: string }[];
    const list = Array.isArray(events) ? events : events.data;
    expect(list).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'IN', source: 'REQUEST' })]),
    );
    // A pending one the employee takes back.
    const third = await http()
      .post('/api/v1/hr/requests')
      .set(bearer(employeeToken))
      .set(idempotency())
      .send({ typeId: leave.id, fromDate: addDays(today, 5), toDate: addDays(today, 6) })
      .expect(201);
    await http()
      .post(`/api/v1/hr/requests/${(third.body as RequestJson).id}/cancel`)
      .set(bearer(employeeToken))
      .expect(200);
    const mine = (
      await http().get('/api/v1/hr/requests/mine').set(bearer(employeeToken)).expect(200)
    ).body as RequestJson[];
    expect(mine.map((row) => row.status).sort()).toEqual(['APPROVED', 'APPROVED', 'CANCELLED']);

    // The report: yesterday on leave (not absent), the schedule's hours shown.
    const report = (
      await http()
        .get('/api/v1/hr/reports/days')
        .query({ from: yesterday, to: yesterday, userId: employee.userId })
        .set(bearer(hr))
        .expect(200)
    ).body as ReportJson;
    const row = report.rows.find((entry) => entry.userId === employee.userId);
    expect(row).toMatchObject({ status: 'LEAVE', requestName: 'Ээлжийн амралт' });
    expect(
      row?.planStart === '09:00' || row?.planStart === '10:00' || row?.planStart === null,
    ).toBe(true);
    expect(report.totals.absentDays).toBe(0);

    // Both lists download as Excel; the office has no right to them.
    for (const path of [
      `/api/v1/hr/reports/days.xlsx?from=${yesterday}&to=${yesterday}`,
      '/api/v1/hr/staff.xlsx',
    ]) {
      const sheet = await http().get(path).set(bearer(hr)).expect(200);
      expect(sheet.headers['content-type']).toContain('spreadsheetml');
      await http().get(path).set(bearer(office)).expect(403);
    }
  });

  it('keeps one record per phone and resets a password directly (ADR-0145)', async () => {
    const card = {
      firstName: 'Дахин',
      lastName: 'Бүртгэл',
      position: null,
      divisionId: null,
      employmentType: 'PERMANENT',
      gender: null,
      employedOn: null,
      scheduleId: null,
    };
    // The phone is in the list already; a new employee needs a first password.
    await http()
      .post('/api/v1/hr/staff')
      .set(bearer(hr))
      .set(idempotency())
      .send({ ...card, phone: PHONE, password: PASSWORD })
      .expect(422);
    await http()
      .post('/api/v1/hr/staff')
      .set(bearer(hr))
      .set(idempotency())
      .send({ ...card, phone: '88001144' })
      .expect(422);

    // HR resets the password of an account without roles: the old one stops, sessions end.
    const signedIn = await login(app, { username: `p${PHONE}`, phone: PHONE, password: PASSWORD });
    const NEW_PASSWORD = 'Shine-nuuts-2026';
    const reset = await http()
      .put(`/api/v1/hr/staff/${employee.userId}/password`)
      .set(bearer(hr))
      .send({ password: NEW_PASSWORD })
      .expect(200);
    expect(JSON.stringify(reset.body)).not.toContain(NEW_PASSWORD);
    await http().post('/api/v1/auth/login').send({ login: PHONE, password: PASSWORD }).expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .set(SAME_ORIGIN)
      .set('Cookie', signedIn.cookie)
      .expect(401);
    await login(app, { username: `p${PHONE}`, phone: PHONE, password: NEW_PASSWORD });
    await http()
      .put(`/api/v1/hr/staff/${employee.userId}/password`)
      .set(bearer(hr))
      .send({ password: '123' })
      .expect(422);
    // A password is not changed through the card.
    await http()
      .put(`/api/v1/hr/staff/${employee.userId}`)
      .set(bearer(hr))
      .send({ ...card, phone: PHONE, password: 'Oor-nuuts-2026' })
      .expect(422);
    await http()
      .put(`/api/v1/hr/staff/${employee.userId}/password`)
      .set(bearer(office))
      .send({ password: NEW_PASSWORD })
      .expect(403);

    // HR cannot become someone with more rights: an account with roles waits for an admin.
    const holder = await seedUser(app, { roles: ['ACCOUNTANT'] });
    await http()
      .put(`/api/v1/hr/staff/${holder.id}/password`)
      .set(bearer(hr))
      .send({ password: NEW_PASSWORD })
      .expect(403);
    await http()
      .put(`/api/v1/hr/staff/${holder.id}/password`)
      .set(bearer(admin))
      .send({ password: NEW_PASSWORD })
      .expect(200);
    await login(app, { ...holder, password: NEW_PASSWORD });

    // Nor take an admin's sign-in away; the card itself stays HR's.
    const otherAdmin = await seedUser(app, { roles: ['ADMIN'] });
    await http()
      .put(`/api/v1/hr/staff/${otherAdmin.id}/left`)
      .set(bearer(hr))
      .send({ leftOn: today, reason: null })
      .expect(403);
    await http()
      .put(`/api/v1/hr/staff/${otherAdmin.id}`)
      .set(bearer(hr))
      .send({ ...card, phone: '88001155' })
      .expect(403);

    // Everybody is in the one list; a closed account is one who left, HR brings them back.
    const closed = await seedUser(app, { roles: ['OFFICE'] });
    await http()
      .patch(`/api/v1/users/${closed.id}`)
      .set(bearer(admin))
      .send({ status: 'DISABLED' })
      .expect(200);
    const listed = (await http().get('/api/v1/hr/staff').set(bearer(hr)).expect(200))
      .body as StaffJson[];
    const row = listed.find((entry) => entry.userId === closed.id);
    expect(row).toMatchObject({ status: 'DISABLED', leftOn: null, passwordSet: true });
    expect(JSON.stringify(listed)).not.toContain('passwordHash');
    // The ones still working come first.
    const firstClosed = listed.findIndex((entry) => entry.status === 'DISABLED');
    expect(listed.slice(firstClosed).every((entry) => entry.status === 'DISABLED')).toBe(true);
    await http()
      .put(`/api/v1/hr/staff/${closed.id}/left`)
      .set(bearer(hr))
      .send({ leftOn: null, reason: null })
      .expect(200);
    await login(app, closed);

    await http()
      .put(`/api/v1/hr/staff/${employee.userId}/password`)
      .set(bearer(hr))
      .send({ password: PASSWORD })
      .expect(200);
  });

  it('disables the account of one who left and enables it on return', async () => {
    const left = await http()
      .put(`/api/v1/hr/staff/${employee.userId}/left`)
      .set(bearer(hr))
      .send({ leftOn: today, reason: 'Өөрийн хүсэлтээр' })
      .expect(200);
    expect(left.body).toMatchObject({ leftOn: today, status: 'DISABLED' });
    await http().post('/api/v1/auth/login').send({ login: PHONE, password: PASSWORD }).expect(403);
    const back = await http()
      .put(`/api/v1/hr/staff/${employee.userId}/left`)
      .set(bearer(hr))
      .send({ leftOn: null, reason: null })
      .expect(200);
    expect(back.body).toMatchObject({ leftOn: null, status: 'ACTIVE' });
  });
});
