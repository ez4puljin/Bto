import type { NestExpressApplication } from '@nestjs/platform-express';
import { addMonths, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import {
  bearer,
  DEFAULT_PASSWORD,
  login,
  seedUser,
  type SeededUser,
  uniquePhone,
} from '../harness/identity';

interface TermsJson {
  userId: number;
  positionId: number | null;
  positionSalaryEffectiveMonth: string | null;
  position: string | null;
  hasTerms: boolean;
  active: boolean;
  baseSalary: string;
  nextBaseSalary: string | null;
  nextEffectiveMonth: string | null;
  paysSocialInsurance: boolean;
  items: { key: string; name: string; source: string; amount: string; sort: number }[];
}

interface LineJson {
  id: number;
  userId: number;
  position: string | null;
  monthlySalary: string;
  items: { id: number; key: string; scorePercent: string | null; earned: string }[];
}

interface RunJson {
  id: number;
  month: string;
  status: string;
  lines: LineJson[];
}

/** Position rates apply by the run's month; approved money and manual scores remain snapshots. */
describe('payroll position salaries', () => {
  let app: NestExpressApplication;
  let administrator: SeededUser;
  let admin: string;
  let positionId: number;
  let fresh: { userId: number; phone: string };
  let legacy: SeededUser;
  let currentRun: RunJson;
  let previousRun: RunJson;
  let freshToken: string;
  let sheet: TermsJson;
  const today = new Date();
  const month = businessDate(today).slice(0, 7);
  const previousMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const nextMonth = addMonths(`${month}-01`, 1).slice(0, 7);
  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1/payroll${path}`;
  const card = {
    firstName: 'Payroll',
    lastName: 'Position',
    divisionId: null,
    employmentType: 'PERMANENT',
    gender: null,
    employedOn: '2026-01-01',
    scheduleId: null,
  };
  const lineOf = (run: RunJson, userId: number): LineJson => {
    const line = run.lines.find((entry) => entry.userId === userId);
    if (!line) throw new Error(`no line for ${userId}`);
    return line;
  };
  const createRun = async (month: string): Promise<RunJson> =>
    (
      await http()
        .post(api('/runs'))
        .set(bearer(admin))
        .set(idempotency())
        .send({ month })
        .expect(201)
    ).body as RunJson;
  const recompute = async (run: RunJson, refreshTerms: boolean): Promise<RunJson> =>
    (
      await http()
        .post(api(`/runs/${run.id}/recompute`))
        .set(bearer(admin))
        .send({ refreshTerms })
        .expect(200)
    ).body as RunJson;

  beforeAll(async () => {
    app = await createHttpApp();
    // Only Date is fake: PostgreSQL, HTTP, token signing and async timers keep running normally.
    jest.useFakeTimers({
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    jest.setSystemTime(today);
    administrator = await seedUser(app, { roles: ['ADMIN'] });
    admin = (await login(app, administrator)).accessToken;
    const position = await http()
      .post('/api/v1/hr/positions')
      .set(bearer(admin))
      .send({ name: 'Position salary test', baseSalary: '1000000', roleIds: [] })
      .expect(201);
    positionId = (position.body as { id: number }).id;
    legacy = await seedUser(app);
    await http()
      .put(api(`/terms/${legacy.id}`))
      .set(bearer(admin))
      .send({ baseSalary: '750000', paysSocialInsurance: false, active: true, items: [] })
      .expect(200);
    // Model a pre-migration row: the additive nullable marker stays NULL until a normal save.
    const legacyDatabase = await connectAs('app');
    try {
      await legacyDatabase.query(
        'UPDATE payroll_terms SET position_legacy_salary = NULL WHERE user_id = $1',
        [legacy.id],
      );
    } finally {
      await legacyDatabase.end();
    }
    await http()
      .put(`/api/v1/hr/staff/${legacy.id}`)
      .set(bearer(admin))
      .send({ ...card, phone: legacy.phone, positionId })
      .expect(200);
    const phone = uniquePhone();
    const registered = await http()
      .post('/api/v1/hr/staff')
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...card, phone, positionId, password: DEFAULT_PASSWORD })
      .expect(201);
    fresh = { userId: (registered.body as { userId: number }).userId, phone };
    freshToken = (await login(app, { username: '', phone, password: DEFAULT_PASSWORD }))
      .accessToken;
  });

  afterAll(async () => {
    jest.useRealTimers();
    await app.close();
  });

  it('pays a newly assigned employee automatically without a personal terms row', async () => {
    const database = await connectAs('app');
    try {
      const { rows } = await database.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM payroll_terms WHERE user_id = $1',
        [fresh.userId],
      );
      expect(rows[0]?.count).toBe('0');
    } finally {
      await database.end();
    }
    const response = await http()
      .get(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .expect(200);
    sheet = response.body as TermsJson;
    expect(sheet).toMatchObject({
      positionId,
      position: 'Position salary test',
      hasTerms: true,
      active: true,
      baseSalary: '1000000.00',
      paysSocialInsurance: true,
      items: [],
      nextBaseSalary: null,
      nextEffectiveMonth: null,
    });
    const mine = await http().get(api('/me/terms')).set(bearer(freshToken)).expect(200);
    expect(mine.body).toMatchObject({ positionId, hasTerms: true, baseSalary: '1000000.00' });

    // No historical rate is guessed. Only the pre-existing personal salary covers an earlier month.
    previousRun = await createRun(previousMonth);
    expect(previousRun.lines.some((line) => line.userId === fresh.userId)).toBe(false);
    expect(lineOf(previousRun, legacy.id).monthlySalary).toBe('750000.00');
    currentRun = await createRun(month);
    expect(lineOf(currentRun, fresh.userId).monthlySalary).toBe('1000000.00');
    expect(lineOf(currentRun, legacy.id).monthlySalary).toBe('750000.00');
    const pending = await http()
      .get(api(`/terms/${legacy.id}`))
      .set(bearer(admin))
      .expect(200);
    expect(pending.body).toMatchObject({
      positionId,
      positionSalaryEffectiveMonth: nextMonth,
      baseSalary: '750000.00',
      nextBaseSalary: '1000000.00',
      nextEffectiveMonth: nextMonth,
    });
  });

  it('refuses individual salary overrides and keeps the legacy historical fallback', async () => {
    const body = { paysSocialInsurance: true, active: true, items: [] };
    await http()
      .put(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .send({ ...body, baseSalary: '1200000' })
      .expect(422);
    await http()
      .put(api(`/terms/${legacy.id}`))
      .set(bearer(admin))
      .send({ ...body, baseSalary: '750000.00' })
      .expect(200);
    expect(lineOf(await recompute(previousRun, true), legacy.id).monthlySalary).toBe('750000.00');
    const saved = await http()
      .put(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .send({
        ...body,
        items: [{ name: 'Work evaluation', source: 'MANUAL', amount: '200000' }],
      })
      .expect(200);
    sheet = saved.body as TermsJson;
    expect(sheet.baseSalary).toBe('1000000.00');
    expect(
      (await recompute(previousRun, true)).lines.some((line) => line.userId === fresh.userId),
    ).toBe(false);
    expect(lineOf(await recompute(currentRun, false), fresh.userId).items).toHaveLength(0);
    currentRun = await recompute(currentRun, true);
    const item = lineOf(currentRun, fresh.userId).items[0];
    if (!item) throw new Error('manual item missing');
    await http()
      .put(api(`/scoring/runs/${currentRun.id}/scores`))
      .set(bearer(admin))
      .send({ scores: [{ itemId: item.id, scorePercent: '75' }] })
      .expect(200);
  });

  it('uses next-month rates only for that month and keeps scores across a draft refresh', async () => {
    await http()
      .put(`/api/v1/hr/positions/${positionId}`)
      .set(bearer(admin))
      .send({ name: 'Position salary test', baseSalary: '1200000', roleIds: [] })
      .expect(200);
    const terms = await http()
      .get(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .expect(200);
    expect(terms.body).toMatchObject({
      baseSalary: '1000000.00',
      nextBaseSalary: '1200000.00',
      nextEffectiveMonth: nextMonth,
    });
    currentRun = await recompute(currentRun, true);
    const line = lineOf(currentRun, fresh.userId);
    expect(line.monthlySalary).toBe('1000000.00');
    expect(line.items[0]).toMatchObject({
      key: sheet.items[0]?.key,
      scorePercent: '75',
      earned: '150000.00',
    });
    expect(lineOf(await recompute(previousRun, true), legacy.id).monthlySalary).toBe('750000.00');
    // Moving an existing employee to a higher-paid position cannot bypass next-month salary timing.
    const secondPosition = await http()
      .post('/api/v1/hr/positions')
      .set(bearer(admin))
      .send({ name: 'Higher paid position', baseSalary: '2000000', roleIds: [] })
      .expect(201);
    const secondPositionId = (secondPosition.body as { id: number }).id;
    await http()
      .put(`/api/v1/hr/staff/${fresh.userId}`)
      .set(bearer(admin))
      .send({ ...card, phone: fresh.phone, positionId: secondPositionId })
      .expect(200);
    const reassigned = await http()
      .get(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .expect(200);
    expect(reassigned.body).toMatchObject({
      positionId: secondPositionId,
      position: 'Higher paid position',
      positionSalaryEffectiveMonth: nextMonth,
      baseSalary: '1000000.00',
      nextBaseSalary: '2000000.00',
      nextEffectiveMonth: nextMonth,
    });
    currentRun = await recompute(currentRun, true);
    expect(lineOf(currentRun, fresh.userId)).toMatchObject({
      monthlySalary: '1000000.00',
      position: 'Position salary test',
    });
    await http()
      .post(api(`/runs/${currentRun.id}/approve`))
      .set(bearer(admin))
      .expect(200);

    // Editing the scheduled increase again must not rewrite the already approved month.
    await http()
      .put(`/api/v1/hr/positions/${positionId}`)
      .set(bearer(admin))
      .send({ name: 'Updated position name', baseSalary: '1300000', roleIds: [] })
      .expect(200);
    const approved = await http()
      .get(api(`/runs/${currentRun.id}`))
      .set(bearer(admin))
      .expect(200);
    expect(lineOf(approved.body as RunJson, fresh.userId)).toMatchObject({
      monthlySalary: '1000000.00',
      position: 'Position salary test',
    });
    await http()
      .post(api(`/runs/${currentRun.id}/recompute`))
      .set(bearer(admin))
      .send({ refreshTerms: true })
      .expect(409);
    const payslip = await http()
      .get(api(`/me/payslips/${month}`))
      .set(bearer(freshToken))
      .expect(200);
    expect(payslip.body).toMatchObject({
      monthlySalary: '1000000.00',
      position: 'Position salary test',
    });

    jest.setSystemTime(new Date(`${nextMonth}-15T04:00:00Z`));
    admin = (await login(app, administrator)).accessToken;
    const nextRun = await createRun(nextMonth);
    expect(lineOf(nextRun, fresh.userId)).toMatchObject({
      monthlySalary: '2000000.00',
      position: 'Higher paid position',
    });
    expect(lineOf(nextRun, legacy.id).monthlySalary).toBe('1300000.00');
    await http()
      .put(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .send({ paysSocialInsurance: false, active: false, items: sheet.items })
      .expect(200);
    expect(
      (await recompute(nextRun, false)).lines.some((line) => line.userId === fresh.userId),
    ).toBe(true);
    expect(
      (await recompute(nextRun, true)).lines.some((line) => line.userId === fresh.userId),
    ).toBe(false);
  });
});
