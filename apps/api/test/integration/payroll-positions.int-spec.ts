import type { NestExpressApplication } from '@nestjs/platform-express';
import { addMonths, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { Pool } from 'pg';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { DB, DB_POOL } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { PayrollTermsService } from '../../src/modules/payroll/services/payroll-terms.service';
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

  it('schedules individual salary overrides and keeps the legacy historical fallback', async () => {
    const body = { paysSocialInsurance: true, active: true, items: [] };
    await http()
      .put(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .send({ ...body, baseSalary: '1200000' })
      .expect(200);
    await http()
      .put(api(`/terms/${fresh.userId}`))
      .set(bearer(admin))
      .send({ ...body, usePositionSalary: true })
      .expect(200);
    await http()
      .put(api(`/terms/${legacy.id}`))
      .set(bearer(admin))
      .send(body)
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

describe('employee-only salary overrides', () => {
  let app: NestExpressApplication;
  let admin: string;
  let ordinary: string;
  let positionId: number;
  let employee: number;
  let peer: number;
  let employeePhone: string;
  let terms: PayrollTermsService;
  let database: Db;
  const month = businessDate().slice(0, 7);
  const nextMonth = addMonths(`${month}-01`, 1).slice(0, 7);
  const priorMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const http = () => request(app.getHttpServer());
  const body = { paysSocialInsurance: true, active: true, items: [] };
  const save = (userId: number, salary: Record<string, unknown> = {}) =>
    http()
      .put(`/api/v1/payroll/terms/${userId}`)
      .set(bearer(admin))
      .send({ ...body, ...salary });
  const read = (userId: number) => http().get(`/api/v1/payroll/terms/${userId}`).set(bearer(admin));

  beforeAll(async () => {
    app = await createHttpApp();
    terms = app.get(PayrollTermsService);
    database = app.get(DB);
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    ordinary = (await login(app, await seedUser(app))).accessToken;
    const position = await http()
      .post('/api/v1/hr/positions')
      .set(bearer(admin))
      .send({ name: 'Individual salary defaults', baseSalary: '1000000', roleIds: [] })
      .expect(201);
    positionId = (position.body as { id: number }).id;
    const makeEmployee = async () => {
      const phone = uniquePhone();
      const response = await http()
        .post('/api/v1/hr/staff')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          firstName: 'Individual',
          lastName: 'Salary',
          phone,
          password: DEFAULT_PASSWORD,
          positionId,
          divisionId: null,
          employmentType: 'PERMANENT',
          gender: null,
          employedOn: '2026-01-01',
          scheduleId: null,
        })
        .expect(201);
      return { id: (response.body as { userId: number }).userId, phone };
    };
    const first = await makeEmployee();
    employee = first.id;
    employeePhone = first.phone;
    peer = (await makeEmployee()).id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('inherits by default and a KPI-only save does not freeze the default', async () => {
    expect((await read(employee).expect(200)).body).toMatchObject({
      baseSalary: '1000000.00',
      salarySource: 'POSITION',
      positionBaseSalary: '1000000.00',
      nextBaseSalary: null,
      nextSalarySource: null,
    });
    await save(peer).expect(200);
    expect((await read(peer).expect(200)).body).toMatchObject({
      salarySource: 'POSITION',
      nextBaseSalary: null,
    });
  });

  it('schedules only that employee, accepts zero, and keeps only one editable next-month event', async () => {
    const runList = await http().get('/api/v1/payroll/runs').set(bearer(admin)).expect(200);
    const approved = (runList.body as { id: number; month: string; status: string }[]).find(
      (row) => row.month === month && row.status === 'APPROVED',
    );
    const original = approved
      ? ((await http().get(`/api/v1/payroll/runs/${approved.id}`).set(bearer(admin)).expect(200))
          .body as unknown)
      : null;
    const zero = await save(employee, { baseSalary: '0' }).expect(200);
    expect(zero.body).toMatchObject({
      baseSalary: '1000000.00',
      salarySource: 'POSITION',
      nextBaseSalary: '0.00',
      nextSalarySource: 'PERSONAL',
      nextEffectiveMonth: nextMonth,
    });
    expect((await terms.activeByUser(database, nextMonth)).get(employee)?.baseSalary).toBe('0.00');
    await save(employee, { baseSalary: '1500000' }).expect(200);
    await save(employee).expect(200);
    const sql = await connectAs('app');
    try {
      const audit = await sql.query<{ before: unknown; after: unknown }>(
        'SELECT before,after FROM audit_log WHERE entity=$1 AND entity_id=$2',
        ['payroll_salary_override', String(employee)],
      );
      expect(audit.rows).toHaveLength(2);
      for (const row of audit.rows) {
        expect(row.after).toMatchObject({ effectiveMonth: nextMonth, salarySource: 'PERSONAL' });
        expect(JSON.stringify(row)).not.toContain('baseSalary');
        expect(JSON.stringify(row)).not.toContain('1500000');
      }
    } finally {
      await sql.end();
    }
    expect((await read(employee).expect(200)).body).toMatchObject({
      baseSalary: '1000000.00',
      nextBaseSalary: '1500000.00',
      nextSalarySource: 'PERSONAL',
    });
    expect((await read(peer).expect(200)).body).toMatchObject({
      baseSalary: '1000000.00',
      nextBaseSalary: null,
    });
    const position = await http()
      .get(`/api/v1/hr/positions/${positionId}`)
      .set(bearer(admin))
      .expect(200);
    expect(position.body).toMatchObject({ baseSalary: '1000000.00', nextBaseSalary: null });
    expect((await terms.activeByUser(database, month)).get(employee)?.baseSalary).toBe(
      '1000000.00',
    );
    expect((await terms.activeByUser(database, priorMonth)).has(employee)).toBe(false);
    if (approved)
      expect(
        (await http().get(`/api/v1/payroll/runs/${approved.id}`).set(bearer(admin)).expect(200))
          .body,
      ).toEqual(original);
  });

  it('keeps a personal amount across a global raise and restores inheritance explicitly', async () => {
    await http()
      .put(`/api/v1/hr/positions/${positionId}`)
      .set(bearer(admin))
      .send({ name: 'Individual salary defaults', baseSalary: '1800000', roleIds: [] })
      .expect(200);
    expect((await read(employee).expect(200)).body).toMatchObject({
      nextBaseSalary: '1500000.00',
      nextSalarySource: 'PERSONAL',
      positionNextBaseSalary: '1800000.00',
      positionNextEffectiveMonth: nextMonth,
    });
    expect((await read(peer).expect(200)).body).toMatchObject({
      nextBaseSalary: '1800000.00',
      nextSalarySource: 'POSITION',
    });
    expect((await terms.activeByUser(database, nextMonth)).get(employee)?.baseSalary).toBe(
      '1500000.00',
    );
    expect((await terms.activeByUser(database, nextMonth)).get(peer)?.baseSalary).toBe(
      '1800000.00',
    );
    const reset = await save(employee, { usePositionSalary: true }).expect(200);
    expect(reset.body).toMatchObject({
      baseSalary: '1000000.00',
      nextBaseSalary: '1800000.00',
      nextSalarySource: 'POSITION',
    });
    expect((await terms.activeByUser(database, nextMonth)).get(employee)?.baseSalary).toBe(
      '1800000.00',
    );
    // Re-enable a personal amount after reset; it remains a single next-month revision.
    await save(employee, { baseSalary: '1600000' }).expect(200);
    const token = (
      await login(app, { username: '', phone: employeePhone, password: DEFAULT_PASSWORD })
    ).accessToken;
    expect(
      (await http().get('/api/v1/payroll/me/terms').set(bearer(token)).expect(200)).body,
    ).toMatchObject({
      baseSalary: '1000000.00',
      nextBaseSalary: '1600000.00',
      nextSalarySource: 'PERSONAL',
    });
  });

  it('allows a payroll manager to revise and reset their own override, with audited changes', async () => {
    const managerRole = (
      await http()
        .post('/api/v1/roles')
        .set(bearer(admin))
        .send({ name: 'Own salary manager', permissions: ['hr.payroll.manage', 'hr.payroll.view'] })
        .expect(201)
    ).body as { id: number };
    const managerPosition = (
      await http()
        .post('/api/v1/hr/positions')
        .set(bearer(admin))
        .send({ name: 'Own salary position', baseSalary: '1000000', roleIds: [managerRole.id] })
        .expect(201)
    ).body as { id: number };
    const phone = uniquePhone();
    const manager = (
      await http()
        .post('/api/v1/hr/staff')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          firstName: 'Own',
          lastName: 'Salary',
          phone,
          password: DEFAULT_PASSWORD,
          positionId: managerPosition.id,
          divisionId: null,
          employmentType: 'PERMANENT',
          gender: null,
          employedOn: null,
          scheduleId: null,
        })
        .expect(201)
    ).body as { userId: number };
    const token = (await login(app, { username: `p${phone}`, phone, password: DEFAULT_PASSWORD }))
      .accessToken;
    for (const amount of ['1800000', '1900000']) {
      expect(
        (
          await http()
            .put(`/api/v1/payroll/terms/${manager.userId}`)
            .set(bearer(token))
            .send({ ...body, baseSalary: amount })
            .expect(200)
        ).body,
      ).toMatchObject({ nextSalarySource: 'PERSONAL', nextBaseSalary: `${amount}.00` });
    }
    expect(
      (
        await http()
          .put(`/api/v1/payroll/terms/${manager.userId}`)
          .set(bearer(token))
          .send({ ...body, usePositionSalary: true })
          .expect(200)
      ).body,
    ).toMatchObject({
      salarySource: 'POSITION',
      baseSalary: '1000000.00',
      nextSalarySource: null,
      nextBaseSalary: null,
    });
    expect((await terms.activeByUser(database, nextMonth)).get(manager.userId)?.baseSalary).toBe(
      '1000000.00',
    );
    const sql = await connectAs('app');
    try {
      const audit = await sql.query<{ after: unknown }>(
        'SELECT after FROM audit_log WHERE entity=$1 AND entity_id=$2',
        ['payroll_salary_override', String(manager.userId)],
      );
      expect(audit.rows).toHaveLength(3);
      expect(JSON.stringify(audit.rows)).not.toContain('1900000');
      expect(JSON.stringify(audit.rows)).not.toContain('baseSalary');
    } finally {
      await sql.end();
    }
  });

  it('serializes concurrent saves with one pooled connection and no nested pool checkout', async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 1500,
    });
    const constrained = await createHttpApp({
      override: (builder) => builder.overrideProvider(DB_POOL).useValue(pool),
    });
    try {
      const responses = await Promise.all(
        [employee, peer, employee].map((userId) =>
          request(constrained.getHttpServer())
            .put(`/api/v1/payroll/terms/${userId}`)
            .set(bearer(admin))
            .send({ ...body, baseSalary: '1700000' })
            .expect(200),
        ),
      );
      expect(responses).toHaveLength(3);
      for (const response of responses)
        expect(response.body).toMatchObject({
          nextSalarySource: 'PERSONAL',
          nextBaseSalary: '1700000.00',
        });
      expect((await terms.activeByUser(database, nextMonth)).get(employee)?.baseSalary).toBe(
        '1700000.00',
      );
      expect((await terms.activeByUser(database, nextMonth)).get(peer)?.baseSalary).toBe(
        '1700000.00',
      );
    } finally {
      await constrained.close();
    }
  });

  it('rejects conflicting/invalid requests and non-managers', async () => {
    await save(employee, { baseSalary: '1600000', usePositionSalary: true }).expect(422);
    await save(employee, { baseSalary: '-1' }).expect(422);
    await save(employee, { baseSalary: 'NaN' }).expect(422);
    await http()
      .put(`/api/v1/payroll/terms/${employee}`)
      .set(bearer(ordinary))
      .send({ ...body, baseSalary: '2000000' })
      .expect(403);
  });
});
