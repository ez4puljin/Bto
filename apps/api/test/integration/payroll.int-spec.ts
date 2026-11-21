import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser, type SeededUser } from '../harness/identity';

interface ItemJson {
  id: number;
  key: string;
  name: string;
  source: 'ATTENDANCE' | 'MANUAL';
  amount: string;
  scorePercent: string | null;
  basePercent: string | null;
  penaltyPercent: string | null;
  earned: string;
  note: string | null;
}
interface LineJson {
  id: number;
  runId: number;
  userId: number;
  baseSalary: string;
  monthlySalary: string;
  salaryDays: number | null;
  salaryMonthDays: number | null;
  paysSocialInsurance: boolean;
  workdays: number | null;
  attendedDays: number | null;
  lateDays: number | null;
  items: ItemJson[];
  adjustments: { id: number; kind: string; amount: string }[];
  advances: { id: number; amount: string }[];
  gross: string;
  employeeSi: string;
  employerSi?: string;
  totalCost?: string;
  pit: string;
  advance: string;
  deductions: string;
  net: string;
}
interface RunJson {
  id: number;
  month: string;
  status: 'DRAFT' | 'APPROVED';
  lineCount: number;
  unscoredCount: number;
  reopenReason: string | null;
  totals: { net: string; employerSi: string };
  lines: LineJson[];
}
interface TermsJson {
  userId: number;
  hasTerms: boolean;
  baseSalary: string;
  templateId: number | null;
  items: { key: string; name: string; source: string; amount: string; sort: number }[];
}

/**
 * Payroll with KPI (ADR-0235): the rates, a template copied onto a sheet, a run built from the
 * time report (the owner's example: 20 of 22 days with 2 late days is 86.9 % of 200,000), manual
 * scores by a manager who sees no amount, an advance deducted, an uninsured employee, recompute,
 * approval freezing the lines in the database too, reopening with a reason, and an employee
 * reading only their own approved payslip; a newcomer's fixed salary split by the workdays of the
 * employed span and their attendance read from the day they joined, frozen at approval.
 * Synthetic data; September and October 2026 have 22 Mon–Fri days each.
 */
describe('payroll', () => {
  let app: NestExpressApplication;
  let admin: string;
  let hr: string;
  let office: string;
  let manager: string;
  let insured: SeededUser;
  let uninsured: SeededUser;
  let insuredToken: string;
  let uninsuredToken: string;
  let templateId: number;
  let run: RunJson;
  let advanceId: number;
  const http = () => request(app.getHttpServer());
  const MONTH = '2026-10';
  const api = (path: string) => `/api/v1/payroll${path}`;
  const lineOf = (body: RunJson, user: SeededUser): LineJson => {
    const line = body.lines.find((entry) => entry.userId === user.id);
    if (!line) throw new Error(`no line for user ${user.id}`);
    return line;
  };
  const itemOf = (line: LineJson, source: string): ItemJson => {
    const item = line.items.find((entry) => entry.source === source);
    if (!item) throw new Error(`no ${source} item`);
    return item;
  };
  const getRun = async (): Promise<RunJson> =>
    (
      await http()
        .get(api(`/runs/${run.id}`))
        .set(bearer(hr))
        .expect(200)
    ).body as RunJson;
  const punchIn = (userId: number, day: number, time: string, month = MONTH) =>
    http()
      .post('/api/v1/hr/attendance/events')
      .set(bearer(hr))
      .send({
        userId,
        kind: 'IN',
        at: new Date(`${month}-${String(day).padStart(2, '0')}T${time}:00+08:00`).toISOString(),
        note: 'Тест',
      })
      .expect(201);

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    hr = (await login(app, await seedUser(app, { roles: ['HR'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    manager = await customRoleUser(app, admin, ['hr.payroll.score']);
    insured = await seedUser(app);
    uninsured = await seedUser(app);
    insuredToken = (await login(app, insured)).accessToken;
    uninsuredToken = (await login(app, uninsured)).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps the rates in settings, with the rights', async () => {
    const settings = (await http().get(api('/settings')).set(bearer(hr)).expect(200)).body as {
      latePenaltyPercent: string;
      employeeSiPercent: string;
      pitCredits: unknown[];
    };
    expect(settings).toMatchObject({ latePenaltyPercent: '2', employeeSiPercent: '11.5' });
    expect(settings.pitCredits).toHaveLength(7);
    for (const token of [office, insuredToken, manager]) {
      await http().get(api('/settings')).set(bearer(token)).expect(403);
      await http().get(api('/runs')).set(bearer(token)).expect(403);
      await http().get(api('/terms')).set(bearer(token)).expect(403);
      await http().get(api('/advances')).set(bearer(token)).expect(403);
      await http().put(api('/settings')).set(bearer(token)).send(settings).expect(403);
    }
    await http()
      .put(api('/settings'))
      .set(bearer(hr))
      .send({ ...settings, employeeSiPercent: '101' })
      .expect(422);
    const saved = await http().put(api('/settings')).set(bearer(hr)).send(settings).expect(200);
    expect(saved.body).toMatchObject({ latePenaltyPercent: '2', minimumWage: '792000' });
  });

  it('keeps KPI templates and copies one onto an employee’s sheet', async () => {
    const items = [
      { name: 'Ирц', source: 'ATTENDANCE', amount: '200000' },
      { name: ' Үйлчилгээний чанар ', source: 'MANUAL', amount: '300000' },
    ];
    const created = await http()
      .post(api('/templates'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ name: 'Кассчин', items })
      .expect(201);
    templateId = (created.body as { id: number }).id;
    expect(created.body).toMatchObject({ name: 'Кассчин', total: '500000.00' });
    expect((created.body as { items: { name: string }[] }).items[1]?.name).toBe(
      'Үйлчилгээний чанар',
    );
    await http()
      .post(api('/templates'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ name: 'кассчин', items })
      .expect(409);
    // One attendance score a month: a second attendance item is refused.
    await http()
      .post(api('/templates'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ name: 'Буруу', items: [items[0], items[0]] })
      .expect(422);
    await http()
      .post(api('/templates'))
      .set(bearer(manager))
      .set(idempotency())
      .send({ name: 'Жолооч', items })
      .expect(403);

    const applied = await http()
      .post(api(`/templates/${templateId}/apply`))
      .set(bearer(hr))
      .send({ userIds: [insured.id] })
      .expect(200);
    const [sheet] = applied.body as TermsJson[];
    expect(sheet).toMatchObject({
      userId: insured.id,
      hasTerms: true,
      baseSalary: '0.00',
      templateId,
    });
    expect(sheet?.items.map((item) => item.amount)).toEqual(['200000.00', '300000.00']);

    // The sheet is the person's own from here: the salary, and the keys sent back.
    const terms = await http()
      .put(api(`/terms/${insured.id}`))
      .set(bearer(hr))
      .send({
        baseSalary: '1000000',
        paysSocialInsurance: true,
        templateId,
        items: sheet?.items,
        active: true,
      })
      .expect(200);
    expect(terms.body).toMatchObject({ baseSalary: '1000000.00', kpiTotal: '500000.00' });
    expect((terms.body as TermsJson).items.map((item) => item.key)).toEqual(
      sheet?.items.map((item) => item.key),
    );
    await http()
      .put(api(`/terms/${uninsured.id}`))
      .set(bearer(hr))
      .send({
        baseSalary: '800000',
        paysSocialInsurance: false,
        items: [{ name: 'Борлуулалтын төлөвлөгөө', source: 'MANUAL', amount: '150000' }],
        active: true,
      })
      .expect(200);
    await http()
      .put(api(`/terms/${uninsured.id}`))
      .set(bearer(office))
      .send({ baseSalary: '1', paysSocialInsurance: false, items: [], active: true })
      .expect(403);
    await http()
      .put(api(`/terms/${uninsured.id}`))
      .set(bearer(hr))
      .send({ baseSalary: '-5', paysSocialInsurance: false, items: [], active: true })
      .expect(422);

    // Everybody reads their own sheet, and only their own.
    const mine = await http().get(api('/me/terms')).set(bearer(insuredToken)).expect(200);
    expect(mine.body).toMatchObject({ hasTerms: true, baseSalary: '1000000.00' });
    const none = await http().get(api('/me/terms')).set(bearer(office)).expect(200);
    expect(none.body).toMatchObject({ hasTerms: false, items: [] });
    await http()
      .get(api(`/terms/${uninsured.id}`))
      .set(bearer(insuredToken))
      .expect(403);
  });

  it('builds the month from attendance and deducts the advance', async () => {
    // Monday to Friday, 09:00 with ten minutes of grace: October 2026 plans 22 days.
    await http()
      .put(`/api/v1/hr/employees/${insured.id}`)
      .set(bearer(hr))
      .send({
        tracked: true,
        workStart: '09:00',
        workEnd: '18:00',
        graceMinutes: 10,
        workdays: '1111100',
        siteIds: [],
      })
      .expect(200);
    const weekdays = Array.from({ length: 31 }, (_, index) => index + 1).filter(
      (day) => new Date(Date.UTC(2026, 9, day)).getUTCDay() % 6 !== 0,
    );
    expect(weekdays).toHaveLength(22);
    // Absent on the last two workdays, late on the first two.
    for (const [index, day] of weekdays.slice(0, 20).entries()) {
      await punchIn(insured.id, day, index < 2 ? '09:30' : '08:55');
    }
    const advance = await http()
      .post(api('/advances'))
      .set(bearer(hr))
      .set(idempotency())
      .send({
        userId: insured.id,
        month: MONTH,
        amount: '300000',
        paidOn: '2026-10-15',
        note: 'Урьдчилгаа',
      })
      .expect(201);
    advanceId = (advance.body as { id: number }).id;
    await http()
      .post(api('/advances'))
      .set(bearer(manager))
      .set(idempotency())
      .send({ userId: insured.id, month: MONTH, amount: '1', paidOn: '2026-10-15' })
      .expect(403);

    await http()
      .post(api('/runs'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ month: '2999-01' })
      .expect(422);
    await http()
      .post(api('/runs'))
      .set(bearer(manager))
      .set(idempotency())
      .send({ month: MONTH })
      .expect(403);
    const created = await http()
      .post(api('/runs'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ month: MONTH })
      .expect(201);
    run = created.body as RunJson;
    expect(run).toMatchObject({ month: MONTH, status: 'DRAFT', lineCount: 2, unscoredCount: 2 });
    await http()
      .post(api('/runs'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ month: MONTH })
      .expect(409);

    const line = lineOf(run, insured);
    expect(line).toMatchObject({
      workdays: 22,
      attendedDays: 20,
      lateDays: 2,
      advance: '300000.00',
      // Employed the whole month: the salary whole.
      baseSalary: '1000000.00',
      monthlySalary: '1000000.00',
      salaryDays: 22,
      salaryMonthDays: 22,
    });
    // The owner's example: 20 ÷ 22 = 90.9 %, − 2 × 2 % = 86.9 %, of 200,000 = 173,800.
    expect(itemOf(line, 'ATTENDANCE')).toMatchObject({
      basePercent: '90.9',
      penaltyPercent: '4',
      scorePercent: '86.9',
      earned: '173800.00',
    });
    expect(itemOf(line, 'MANUAL')).toMatchObject({ scorePercent: null, earned: '0.00' });
    expect(line.gross).toBe('1173800.00');
    // Unscored items: no approval yet.
    await http()
      .post(api(`/runs/${run.id}/approve`))
      .set(bearer(hr))
      .expect(409);
  });

  it('lets a manager score the work items without seeing any pay', async () => {
    const runs = await http().get(api('/scoring/runs')).set(bearer(manager)).expect(200);
    expect(runs.body).toEqual([
      { runId: run.id, month: MONTH, status: 'DRAFT', manualCount: 2, unscoredCount: 2 },
    ]);
    const sheet = await http()
      .get(api(`/scoring/runs/${run.id}`))
      .set(bearer(manager))
      .expect(200);
    const text = JSON.stringify(sheet.body);
    for (const secret of ['amount', 'earned', 'gross', 'net', 'baseSalary', '300000', '1000000']) {
      expect(text).not.toContain(secret);
    }
    await http()
      .get(api(`/runs/${run.id}`))
      .set(bearer(manager))
      .expect(403);
    await http()
      .get(api(`/scoring/runs/${run.id}`))
      .set(bearer(insuredToken))
      .expect(403);
    await http().get(api('/scoring/runs')).set(bearer(office)).expect(403);

    const work = itemOf(lineOf(run, insured), 'MANUAL');
    const plan = itemOf(lineOf(run, uninsured), 'MANUAL');
    const attendance = itemOf(lineOf(run, insured), 'ATTENDANCE');
    await http()
      .put(api(`/scoring/runs/${run.id}/scores`))
      .set(bearer(insuredToken))
      .send({ scores: [{ itemId: work.id, scorePercent: '100' }] })
      .expect(403);
    // The attendance item is the system's; a percent above 100 is no percent.
    await http()
      .put(api(`/scoring/runs/${run.id}/scores`))
      .set(bearer(manager))
      .send({ scores: [{ itemId: attendance.id, scorePercent: '100' }] })
      .expect(422);
    await http()
      .put(api(`/scoring/runs/${run.id}/scores`))
      .set(bearer(manager))
      .send({ scores: [{ itemId: work.id, scorePercent: '120' }] })
      .expect(422);
    const scored = await http()
      .put(api(`/scoring/runs/${run.id}/scores`))
      .set(bearer(manager))
      .send({
        scores: [
          { itemId: work.id, scorePercent: '50', note: 'Гомдол 2 удаа' },
          { itemId: plan.id, scorePercent: '100' },
        ],
      })
      .expect(200);
    expect(JSON.stringify(scored.body)).toContain('Гомдол 2 удаа');

    run = await getRun();
    expect(run.unscoredCount).toBe(0);
    const line = lineOf(run, insured);
    // 300,000 scored 50 % = 150,000; gross 1,000,000 + 173,800 + 150,000.
    expect(itemOf(line, 'MANUAL')).toMatchObject({ scorePercent: '50', earned: '150000.00' });
    expect(line).toMatchObject({
      gross: '1323800.00',
      employeeSi: '152237.00',
      employerSi: '165475.00',
      pit: '101156.30',
      advance: '300000.00',
      net: '770406.70',
      totalCost: '1489275.00',
    });
    // No social insurance: no tax either, the whole gross is paid.
    expect(lineOf(run, uninsured)).toMatchObject({
      gross: '950000.00',
      employeeSi: '0.00',
      employerSi: '0.00',
      pit: '0.00',
      net: '950000.00',
    });
  });

  it('takes free lines and recomputes a draft', async () => {
    const other = lineOf(run, uninsured);
    const deducted = await http()
      .post(api(`/runs/${run.id}/lines/${other.id}/adjustments`))
      .set(bearer(hr))
      .set(idempotency())
      .send({ kind: 'DEDUCTION', name: 'Торгууль', amount: '10000' })
      .expect(201);
    expect(deducted.body).toMatchObject({ deductions: '10000.00', net: '940000.00' });
    const bonus = await http()
      .post(api(`/runs/${run.id}/lines/${other.id}/adjustments`))
      .set(bearer(hr))
      .set(idempotency())
      .send({ kind: 'ADDITION', name: 'Шагнал', amount: '50000', taxable: true })
      .expect(201);
    expect(bonus.body).toMatchObject({ gross: '1000000.00', net: '990000.00' });
    const bonusId = (bonus.body as LineJson).adjustments.find((row) => row.kind === 'ADDITION')?.id;
    const removed = await http()
      .delete(api(`/runs/${run.id}/lines/${other.id}/adjustments/${bonusId}`))
      .set(bearer(hr))
      .expect(200);
    expect(removed.body).toMatchObject({ gross: '950000.00', net: '940000.00' });
    await http()
      .post(api(`/runs/${run.id}/lines/${other.id}/adjustments`))
      .set(bearer(manager))
      .set(idempotency())
      .send({ kind: 'ADDITION', name: 'Шагнал', amount: '1' })
      .expect(403);

    // HR corrects a missed punch on the 29th; the run follows only when recomputed.
    await punchIn(insured.id, 29, '08:50');
    expect(lineOf(await getRun(), insured).attendedDays).toBe(20);
    // New terms reach the draft only on request, and the score stays with its item.
    await http()
      .put(api(`/terms/${uninsured.id}`))
      .set(bearer(hr))
      .send({
        baseSalary: '900000',
        paysSocialInsurance: false,
        items: lineOf(run, uninsured).items.map((item) => ({
          key: item.key,
          name: item.name,
          source: item.source,
          amount: '200000',
        })),
        active: true,
      })
      .expect(200);
    await http()
      .post(api(`/runs/${run.id}/recompute`))
      .set(bearer(manager))
      .send({})
      .expect(403);
    const again = await http()
      .post(api(`/runs/${run.id}/recompute`))
      .set(bearer(hr))
      .send({})
      .expect(200);
    const line = lineOf(again.body as RunJson, insured);
    // 21 ÷ 22 = 95.5 %, − 4 % = 91.5 %.
    expect(line).toMatchObject({ attendedDays: 21, lateDays: 2 });
    expect(itemOf(line, 'ATTENDANCE')).toMatchObject({ scorePercent: '91.5', earned: '183000.00' });
    expect(itemOf(line, 'MANUAL')).toMatchObject({ scorePercent: '50', earned: '150000.00' });
    expect(lineOf(again.body as RunJson, uninsured).baseSalary).toBe('800000.00');
    const refreshed = await http()
      .post(api(`/runs/${run.id}/recompute`))
      .set(bearer(hr))
      .send({ refreshTerms: true })
      .expect(200);
    const fresh = lineOf(refreshed.body as RunJson, uninsured);
    expect(fresh).toMatchObject({
      baseSalary: '900000.00',
      gross: '1100000.00',
      net: '1090000.00',
    });
    expect(itemOf(fresh, 'MANUAL')).toMatchObject({ scorePercent: '100', earned: '200000.00' });
    run = refreshed.body as RunJson;
  });

  it('shows nobody a payslip before approval, and freezes the run at approval', async () => {
    expect(
      (await http().get(api('/me/payslips')).set(bearer(insuredToken)).expect(200)).body,
    ).toEqual([]);
    await http()
      .get(api(`/me/payslips/${MONTH}`))
      .set(bearer(insuredToken))
      .expect(404);
    await http()
      .post(api(`/runs/${run.id}/approve`))
      .set(bearer(manager))
      .expect(403);
    const approved = await http()
      .post(api(`/runs/${run.id}/approve`))
      .set(bearer(hr))
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', lineCount: 2 });
    const frozen = lineOf(approved.body as RunJson, insured);

    // Nothing moves an approved run: not a score, a recompute, a free line or an advance.
    const work = itemOf(frozen, 'MANUAL');
    await http()
      .put(api(`/scoring/runs/${run.id}/scores`))
      .set(bearer(hr))
      .send({ scores: [{ itemId: work.id, scorePercent: '100' }] })
      .expect(409);
    await http()
      .post(api(`/runs/${run.id}/recompute`))
      .set(bearer(hr))
      .send({})
      .expect(409);
    await http()
      .post(api(`/runs/${run.id}/approve`))
      .set(bearer(hr))
      .expect(409);
    await http()
      .post(api(`/runs/${run.id}/lines/${frozen.id}/adjustments`))
      .set(bearer(hr))
      .set(idempotency())
      .send({ kind: 'DEDUCTION', name: 'Торгууль', amount: '1' })
      .expect(409);
    await http()
      .post(api('/advances'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ userId: insured.id, month: MONTH, amount: '5000', paidOn: '2026-10-20' })
      .expect(409);
    await http()
      .post(api(`/advances/${advanceId}/void`))
      .set(bearer(hr))
      .send({ reason: 'Буруу' })
      .expect(409);
    // Changing the terms changes no payslip.
    await http()
      .put(api(`/terms/${insured.id}`))
      .set(bearer(hr))
      .send({ baseSalary: '5000000', paysSocialInsurance: true, items: [], active: true })
      .expect(200);
    expect(lineOf(await getRun(), insured)).toMatchObject({
      baseSalary: '1000000.00',
      net: frozen.net,
    });

    // The database says the same to the app role.
    const asApp = await connectAs('app');
    try {
      expect(
        await sqlStateOf(
          asApp.query('UPDATE payroll_lines SET net = 0 WHERE id = $1', [frozen.id]),
        ),
      ).toBe('23514');
      expect(
        await sqlStateOf(
          asApp.query('UPDATE payroll_line_items SET earned = 1 WHERE id = $1', [work.id]),
        ),
      ).toBe('23514');
      expect(
        await sqlStateOf(
          asApp.query('DELETE FROM payroll_line_items WHERE line_id = $1', [frozen.id]),
        ),
      ).toBe('23514');
      expect(
        await sqlStateOf(
          asApp.query(
            `INSERT INTO payroll_line_adjustments (line_id, kind, name, amount, created_by)
             VALUES ($1, 'DEDUCTION', 'x', 1, $2)`,
            [frozen.id, insured.id],
          ),
        ),
      ).toBe('23514');
      for (const table of [
        'payroll_runs',
        'payroll_advances',
        'payroll_terms',
        'payroll_settings',
      ]) {
        expect(await sqlStateOf(asApp.query(`DELETE FROM ${table}`))).toBe('42501');
      }
    } finally {
      await asApp.end();
    }
  });

  it('lets an employee read their own approved payslip and nobody else’s', async () => {
    const list = (await http().get(api('/me/payslips')).set(bearer(insuredToken)).expect(200))
      .body as LineJson[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: insured.id, baseSalary: '1000000.00' });
    const slip = (
      await http()
        .get(api(`/me/payslips/${MONTH}`))
        .set(bearer(insuredToken))
        .expect(200)
    ).body as LineJson & { month: string };
    expect(slip).toMatchObject({ month: MONTH, workdays: 22, attendedDays: 21, lateDays: 2 });
    expect(slip.items.map((item) => item.earned)).toEqual(['183000.00', '150000.00']);
    expect(slip.advances).toEqual([
      expect.objectContaining({ amount: '300000.00', paidOn: '2026-10-15' }),
    ]);
    // The employer's cost is HR's side only.
    expect(slip.employerSi).toBeUndefined();
    expect(slip.totalCost).toBeUndefined();

    const theirs = (
      await http()
        .get(api(`/me/payslips/${MONTH}`))
        .set(bearer(uninsuredToken))
        .expect(200)
    ).body as LineJson;
    expect(theirs).toMatchObject({ userId: uninsured.id, net: '1090000.00' });
    // Another person's payslip is reached by no route an employee may call.
    const other = lineOf(run, uninsured);
    await http()
      .get(api(`/runs/${run.id}/lines/${other.id}`))
      .set(bearer(insuredToken))
      .expect(403);
    await http()
      .get(api(`/runs/${run.id}`))
      .set(bearer(insuredToken))
      .expect(403);
    await http()
      .get(api(`/runs/${run.id}/export.xlsx`))
      .set(bearer(insuredToken))
      .expect(403);
    await http().get(api('/advances')).set(bearer(insuredToken)).expect(403);
    // Someone on no run has no payslip; a month that is no month is refused.
    await http()
      .get(api(`/me/payslips/${MONTH}`))
      .set(bearer(office))
      .expect(404);
    await http().get(api('/me/payslips/2026-13')).set(bearer(insuredToken)).expect(422);

    const sheet = await http()
      .get(api(`/runs/${run.id}/export.xlsx`))
      .set(bearer(hr))
      .expect(200);
    expect(sheet.headers['content-type']).toContain('spreadsheetml');
    await http()
      .get(api(`/runs/${run.id}/export.xlsx`))
      .set(bearer(office))
      .expect(403);
  });

  it('reopens with a reason, audited, and the payslip leaves the employee’s list', async () => {
    await http()
      .post(api(`/runs/${run.id}/reopen`))
      .set(bearer(manager))
      .send({ reason: 'Засвар' })
      .expect(403);
    await http()
      .post(api(`/runs/${run.id}/reopen`))
      .set(bearer(hr))
      .send({ reason: ' ' })
      .expect(422);
    const reopened = await http()
      .post(api(`/runs/${run.id}/reopen`))
      .set(bearer(hr))
      .send({ reason: 'Урьдчилгаа буруу бүртгэсэн' })
      .expect(200);
    expect(reopened.body).toMatchObject({
      status: 'DRAFT',
      reopenReason: 'Урьдчилгаа буруу бүртгэсэн',
    });
    await http()
      .post(api(`/runs/${run.id}/reopen`))
      .set(bearer(hr))
      .send({ reason: 'Дахин' })
      .expect(409);
    await http()
      .get(api(`/me/payslips/${MONTH}`))
      .set(bearer(insuredToken))
      .expect(404);

    // The wrong advance is voided and typed again; the draft follows at once.
    await http()
      .post(api(`/advances/${advanceId}/void`))
      .set(bearer(hr))
      .send({ reason: 'Буруу дүн' })
      .expect(200);
    expect(lineOf(await getRun(), insured).advance).toBe('0.00');
    await http()
      .post(api('/advances'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ userId: insured.id, month: MONTH, amount: '250000', paidOn: '2026-10-15' })
      .expect(201);
    const line = lineOf(await getRun(), insured);
    expect(line.advance).toBe('250000.00');
    expect(line.advances).toHaveLength(1);
    const live = await http()
      .get(api('/advances'))
      .query({ month: MONTH })
      .set(bearer(hr))
      .expect(200);
    expect(live.body).toHaveLength(1);
    const all = await http()
      .get(api('/advances'))
      .query({ month: MONTH, includeVoided: true })
      .set(bearer(hr))
      .expect(200);
    expect(all.body).toHaveLength(2);

    const again = await http()
      .post(api(`/runs/${run.id}/approve`))
      .set(bearer(hr))
      .expect(200);
    expect(again.body).toMatchObject({ status: 'APPROVED' });

    const asApp = await connectAs('app');
    try {
      const audit = await asApp.query<{ action: string; count: string }>(
        `SELECT action, count(*)::text AS count FROM audit_log
          WHERE entity = 'payroll_run' AND entity_id = $1 GROUP BY action`,
        [String(run.id)],
      );
      const counts = Object.fromEntries(audit.rows.map((row) => [row.action, row.count]));
      expect(counts).toMatchObject({ CREATE: '1', RECOMPUTE: '2', APPROVE: '2', REOPEN: '1' });
      const scores = await asApp.query(
        `SELECT 1 FROM audit_log WHERE entity = 'payroll_line_item' AND action = 'SCORE'`,
      );
      expect(scores.rowCount).toBeGreaterThanOrEqual(2);
    } finally {
      await asApp.end();
    }
  });

  it('splits a newcomer’s fixed salary by the workdays and reads their attendance from the day they joined', async () => {
    const SEPTEMBER = '2026-09';
    const joiner = await seedUser(app);
    const card = {
      firstName: 'Шинэ',
      lastName: 'Ажилтан',
      phone: (joiner.phone ?? '').replace('+976', ''),
      position: 'Кассчин',
      divisionId: null,
      employmentType: 'PERMANENT',
      gender: null,
      scheduleId: null,
    };
    const joinedOn = (employedOn: string) =>
      http()
        .put(`/api/v1/hr/staff/${joiner.id}`)
        .set(bearer(hr))
        .send({ ...card, employedOn })
        .expect(200);
    // Joined on Wednesday 16 September: 11 of the month's 22 Monday-to-Friday workdays.
    await joinedOn('2026-09-16');
    await http()
      .put(`/api/v1/hr/employees/${joiner.id}`)
      .set(bearer(hr))
      .send({
        tracked: true,
        workStart: '09:00',
        workEnd: '18:00',
        graceMinutes: 10,
        workdays: '1111100',
        siteIds: [],
      })
      .expect(200);
    await http()
      .put(api(`/terms/${joiner.id}`))
      .set(bearer(hr))
      .send({
        baseSalary: '1000000',
        paysSocialInsurance: false,
        items: [{ name: 'Ирц', source: 'ATTENDANCE', amount: '200000' }],
        active: true,
      })
      .expect(200);
    const weekdays = Array.from({ length: 30 }, (_, index) => index + 1).filter(
      (day) => new Date(Date.UTC(2026, 8, day)).getUTCDay() % 6 !== 0,
    );
    expect(weekdays).toHaveLength(22);
    // On time on every workday from the 16th on; nothing before it.
    for (const day of weekdays.filter((one) => one >= 16)) {
      await punchIn(joiner.id, day, '08:55', SEPTEMBER);
    }

    const created = await http()
      .post(api('/runs'))
      .set(bearer(hr))
      .set(idempotency())
      .send({ month: SEPTEMBER })
      .expect(201);
    let september = created.body as RunJson;
    const line = lineOf(september, joiner);
    // The owner's rule: 1,000,000 × 11 ÷ 22 = 500,000; the attendance item stays whole (200,000)
    // and scores 11 of 11 workdays, not 11 of 22.
    expect(line).toMatchObject({
      baseSalary: '500000.00',
      monthlySalary: '1000000.00',
      salaryDays: 11,
      salaryMonthDays: 22,
      workdays: 11,
      attendedDays: 11,
      lateDays: 0,
      gross: '700000.00',
      net: '700000.00',
    });
    expect(itemOf(line, 'ATTENDANCE')).toMatchObject({
      amount: '200000.00',
      basePercent: '100',
      scorePercent: '100',
      earned: '200000.00',
    });
    // Someone employed the whole month is paid whole.
    const whole = lineOf(september, insured);
    expect(whole.salaryDays).toBe(whole.salaryMonthDays);
    expect(whole.baseSalary).toBe(whole.monthlySalary);
    // The run's total is the salaries paid.
    const paid = september.lines.reduce((total, one) => total + Number(one.baseSalary), 0);
    expect(
      Number((september as RunJson & { totals: { baseSalary: string } }).totals.baseSalary),
    ).toBe(paid);

    // HR corrects the card; a recompute of the draft reads the span again: 8 of 22 workdays.
    await joinedOn('2026-09-21');
    const moved = await http()
      .post(api(`/runs/${september.id}/recompute`))
      .set(bearer(hr))
      .send({})
      .expect(200);
    expect(lineOf(moved.body as RunJson, joiner)).toMatchObject({
      baseSalary: '363636.36',
      salaryDays: 8,
      salaryMonthDays: 22,
      workdays: 8,
      attendedDays: 8,
    });
    await joinedOn('2026-09-16');
    september = (
      await http()
        .post(api(`/runs/${september.id}/recompute`))
        .set(bearer(hr))
        .send({})
        .expect(200)
    ).body as RunJson;
    expect(lineOf(september, joiner)).toMatchObject({ baseSalary: '500000.00', salaryDays: 11 });

    // Approved, the line is frozen: a later change of the card moves nothing.
    const manual = september.lines.flatMap((one) =>
      one.items.filter((item) => item.source === 'MANUAL').map((item) => item.id),
    );
    if (manual.length > 0) {
      await http()
        .put(api(`/scoring/runs/${september.id}/scores`))
        .set(bearer(hr))
        .send({ scores: manual.map((itemId) => ({ itemId, scorePercent: '100' })) })
        .expect(200);
    }
    await http()
      .post(api(`/runs/${september.id}/approve`))
      .set(bearer(hr))
      .expect(200);
    await joinedOn('2026-09-01');
    await http()
      .post(api(`/runs/${september.id}/recompute`))
      .set(bearer(hr))
      .send({})
      .expect(409);
    const approved = (
      await http()
        .get(api(`/runs/${september.id}`))
        .set(bearer(hr))
        .expect(200)
    ).body as RunJson;
    expect(lineOf(approved, joiner)).toMatchObject({
      baseSalary: '500000.00',
      monthlySalary: '1000000.00',
      salaryDays: 11,
      salaryMonthDays: 22,
      net: '700000.00',
    });
    // The employee reads the same split on their payslip.
    const joinerToken = (await login(app, joiner)).accessToken;
    const slip = (
      await http()
        .get(api(`/me/payslips/${SEPTEMBER}`))
        .set(bearer(joinerToken))
        .expect(200)
    ).body as LineJson;
    expect(slip).toMatchObject({
      baseSalary: '500000.00',
      monthlySalary: '1000000.00',
      salaryDays: 11,
      salaryMonthDays: 22,
    });
    const asApp = await connectAs('app');
    try {
      expect(
        await sqlStateOf(
          asApp.query('UPDATE payroll_lines SET salary_days = 10 WHERE id = $1', [
            lineOf(approved, joiner).id,
          ]),
        ),
      ).toBe('23514');
    } finally {
      await asApp.end();
    }
    await http()
      .get(api(`/runs/${september.id}/export.xlsx`))
      .set(bearer(hr))
      .expect(200);
  });
});
