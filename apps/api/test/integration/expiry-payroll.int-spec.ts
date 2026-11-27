import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addMonths, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate';
import { systemActor } from '../../src/modules/identity';
import {
  PayrollSourceDeductionsService,
  type PayrollSourceDeductionInput,
} from '../../src/modules/payroll';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser, type SeededUser } from '../harness/identity';

interface SourceJson {
  id: number;
  userId: number;
  amount: string;
  assignedMonth: string | null;
  state: string;
  sourceReference: string;
  sourceKey: string;
  settlements: { id: number; runId: number; amount: string; releasedAt: string | null }[];
}
interface LineJson {
  id: number;
  userId: number;
  gross: string;
  employeeSi: string;
  pit: string;
  net: string;
  deductions: string;
  otherAdditions: string;
  sourceDeductions: { id: number; name: string; amount: string; sourceReference: string }[];
}
interface RunJson {
  id: number;
  month: string;
  status: string;
  lines: LineJson[];
}

describe('expiry payroll source deductions', () => {
  let app: NestExpressApplication;
  let db: Db;
  let sources: PayrollSourceDeductionsService;
  let admin: string;
  let scorer: string;
  let employee: SeededUser;
  let other: SeededUser;
  let employeeToken: string;
  let otherToken: string;
  let current: RunJson;
  let previous: RunJson;
  let originalId: number;
  let closedCreditId: number;
  const month = businessDate().slice(0, 7);
  const previousMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const futureMonth = addMonths(`${month}-01`, 1).slice(0, 7);
  const actor = systemActor('expiry payroll integration');
  const api = (path: string) => `/api/v1/payroll${path}`;
  const http = () => request(app.getHttpServer());
  const postSource = (input: PayrollSourceDeductionInput) =>
    inTransaction(db, (tx) => sources.recordInTx(tx, actor, input));
  const list = async (sourceKey?: string): Promise<SourceJson[]> =>
    (
      await http()
        .get(api('/source-deductions'))
        .query(sourceKey ? { sourceKey } : {})
        .set(bearer(admin))
        .expect(200)
    ).body as SourceJson[];
  const createRun = async (target: string): Promise<RunJson> =>
    (
      await http()
        .post(api('/runs'))
        .set(bearer(admin))
        .set(idempotency())
        .send({ month: target })
        .expect(201)
    ).body as RunJson;
  const getRun = async (): Promise<RunJson> =>
    (
      await http()
        .get(api(`/runs/${current.id}`))
        .set(bearer(admin))
        .expect(200)
    ).body as RunJson;
  const line = (run: RunJson, userId = employee.id): LineJson => {
    const found = run.lines.find((entry) => entry.userId === userId);
    if (!found) throw new Error(`missing payroll line ${userId}`);
    return found;
  };
  const terms = (userId: number, active: boolean) =>
    http()
      .put(api(`/terms/${userId}`))
      .set(bearer(admin))
      .send({ baseSalary: '1000000', paysSocialInsurance: true, items: [], active })
      .expect(200);
  const recompute = async (): Promise<RunJson> =>
    (
      await http()
        .post(api(`/runs/${current.id}/recompute`))
        .set(bearer(admin))
        .send({ refreshTerms: true })
        .expect(200)
    ).body as RunJson;

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
    sources = app.get(PayrollSourceDeductionsService);
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    scorer = await customRoleUser(app, admin, ['hr.payroll.score']);
    employee = await seedUser(app);
    other = await seedUser(app);
    employeeToken = (await login(app, employee)).accessToken;
    otherToken = (await login(app, other)).accessToken;
    await terms(employee.id, true);
    await terms(other.id, true);
  });
  afterAll(async () => {
    await app.close();
  });

  it('persists a future chosen month, serializes exact replay and rejects changed/invalid allocations', async () => {
    const input: PayrollSourceDeductionInput = {
      sourceKind: 'EXPIRY_SALE',
      sourceKey: 'expiry:sale:future',
      sourceReference: 'EXP-001',
      requestedMonth: futureMonth,
      allocations: [
        { userId: other.id, amount: '50' },
        { userId: employee.id, amount: '100.00' },
      ],
    };
    const [first, replay] = await Promise.all([postSource(input), postSource(input)]);
    expect(first.map((row) => row.id).sort()).toEqual(replay.map((row) => row.id).sort());
    expect(first).toHaveLength(2);
    expect(first.every((row) => row.state === 'WAITING_RUN')).toBe(true);
    originalId = first.find((row) => row.userId === employee.id)!.id;
    await expect(
      postSource({ ...input, allocations: [{ userId: employee.id, amount: '101' }] }),
    ).rejects.toMatchObject({ code: 'DOC_STATE_INVALID' });
    for (const amount of ['NaN', 'Infinity', '1.001', '-1'])
      await expect(
        postSource({
          ...input,
          sourceKey: `bad:${amount}`,
          allocations: [{ userId: employee.id, amount }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      postSource({
        ...input,
        sourceKey: 'bad:duplicate',
        allocations: [
          { userId: employee.id, amount: '1' },
          { userId: employee.id, amount: '1' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      inTransaction(db, async (tx) => {
        await sources.recordInTx(tx, actor, { ...input, sourceKey: 'expiry:rollback' });
        throw new Error('rollback customer sale');
      }),
    ).rejects.toThrow('rollback customer sale');
    expect(await list('expiry:rollback')).toEqual([]);
    await http()
      .post(api('/runs'))
      .set(bearer(admin))
      .set(idempotency())
      .send({ month: futureMonth })
      .expect(422);
  });

  it('reverses pending allocations in their chosen month and leaves a closed-month credit for an explicit new month', async () => {
    const pendingReturn: PayrollSourceDeductionInput = {
      sourceKind: 'EXPIRY_RETURN',
      sourceKey: 'expiry:return:pending',
      sourceReference: 'EXP-001',
      requestedMonth: futureMonth,
      reversesSourceKey: 'expiry:sale:future',
      allocations: [{ userId: employee.id, amount: '-25' }],
    };
    const returned = await postSource(pendingReturn);
    await postSource(pendingReturn);
    expect(returned[0]).toMatchObject({ assignedMonth: futureMonth, amount: '-25.00' });
    await expect(
      postSource({
        ...pendingReturn,
        sourceKey: 'expiry:return:too-much',
        allocations: [{ userId: employee.id, amount: '-76' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const assigned = (
      await http()
        .put(api(`/source-deductions/${originalId}/month`))
        .set(bearer(admin))
        .send({ month })
        .expect(200)
    ).body as SourceJson[];
    expect(assigned).toHaveLength(2);
    expect(
      assigned.every((row) => row.assignedMonth === month && row.state === 'WAITING_RUN'),
    ).toBe(true);
    expect((await list('expiry:sale:future')).find((row) => row.userId === other.id)).toMatchObject(
      { assignedMonth: futureMonth },
    );
    await postSource({
      sourceKind: 'EXPIRY_SALE',
      sourceKey: 'expiry:sale:closed',
      sourceReference: 'EXP-002',
      requestedMonth: previousMonth,
      allocations: [{ userId: employee.id, amount: '100' }],
    });
    previous = await createRun(previousMonth);
    // The operator may choose a past month while its run is still DRAFT.
    const otherSource = (await list('expiry:sale:future')).find((row) => row.userId === other.id)!;
    const baselinePast = line(previous, other.id);
    const movedPast = (
      await http()
        .put(api(`/source-deductions/${otherSource.id}/month`))
        .set(bearer(admin))
        .send({ month: previousMonth })
        .expect(200)
    ).body as SourceJson[];
    expect(movedPast).toMatchObject([{ assignedMonth: previousMonth, state: 'READY' }]);
    const pastDraft = (
      await http()
        .get(api(`/runs/${previous.id}`))
        .set(bearer(admin))
        .expect(200)
    ).body as RunJson;
    expect(line(pastDraft, other.id)).toMatchObject({
      gross: baselinePast.gross,
      employeeSi: baselinePast.employeeSi,
      pit: baselinePast.pit,
      deductions: '50.00',
    });
    expect(new Decimal(baselinePast.net).minus(line(pastDraft, other.id).net).toFixed(2)).toBe(
      '50.00',
    );
    await http()
      .put(api(`/source-deductions/${otherSource.id}/month`))
      .set(bearer(admin))
      .send({ month: futureMonth })
      .expect(200);
    await http()
      .post(api(`/runs/${previous.id}/approve`))
      .set(bearer(admin))
      .expect(200);
    const closedReturn: PayrollSourceDeductionInput = {
      sourceKind: 'EXPIRY_RETURN',
      sourceKey: 'expiry:return:closed',
      sourceReference: 'EXP-002',
      requestedMonth: previousMonth,
      reversesSourceKey: 'expiry:sale:closed',
      allocations: [{ userId: employee.id, amount: '-40' }],
    };
    const closed = await postSource(closedReturn);
    closedCreditId = closed[0]!.id;
    expect(closed[0]).toMatchObject({ state: 'NEEDS_MONTH', assignedMonth: null });
    await postSource(closedReturn);
    await http()
      .put(api(`/source-deductions/${closedCreditId}/month`))
      .set(bearer(admin))
      .send({ month: previousMonth })
      .expect(409);
    await http()
      .put(api(`/source-deductions/${closedCreditId}/month`))
      .set(bearer(admin))
      .send({ month })
      .expect(200);
    current = await createRun(month);
    const own = line(current);
    const baseline = line(current, other.id);
    expect(own).toMatchObject({
      gross: baseline.gross,
      employeeSi: baseline.employeeSi,
      pit: baseline.pit,
      deductions: '100.00',
      otherAdditions: '65.00',
    });
    expect(new Decimal(baseline.net).minus(own.net).toFixed(2)).toBe('35.00');
    expect(own.sourceDeductions).toHaveLength(3);
    await http()
      .get(api(`/me/payslips/${month}`))
      .set(bearer(employeeToken))
      .expect(404);
  });

  it('recomputes idempotently and retains obligations when refresh removes an ineligible line', async () => {
    const before = line(await getRun());
    current = await recompute();
    current = await recompute();
    expect(line(current)).toMatchObject({
      deductions: before.deductions,
      otherAdditions: before.otherAdditions,
      net: before.net,
    });
    await terms(employee.id, false);
    current = await recompute();
    expect(current.lines.some((entry) => entry.userId === employee.id)).toBe(false);
    expect((await list('expiry:sale:future')).find((row) => row.id === originalId)).toMatchObject({
      state: 'MISSING_LINE',
      amount: '100.00',
    });
    await terms(employee.id, true);
    current = await recompute();
    expect(line(current)).toMatchObject({
      deductions: '100.00',
      otherAdditions: '65.00',
      net: before.net,
    });
  });

  it('freezes exact approvals, protects source privacy and queues later returns without editing approved payroll', async () => {
    current = (
      await http()
        .post(api(`/runs/${current.id}/approve`))
        .set(bearer(admin))
        .expect(200)
    ).body as RunJson;
    const frozen = line(current);
    expect((await list('expiry:sale:future')).find((row) => row.id === originalId)).toMatchObject({
      state: 'SETTLED',
      settlements: [{ runId: current.id, amount: '100.00', releasedAt: null }],
    });
    const mine = (
      await http()
        .get(api(`/me/payslips/${month}`))
        .set(bearer(employeeToken))
        .expect(200)
    ).body as LineJson;
    expect(mine.sourceDeductions).toHaveLength(3);
    expect(mine.sourceDeductions[0]).toMatchObject({
      name: 'Хугацааны хямдралын алданги',
      sourceReference: 'EXP-001',
    });
    for (const entry of mine.sourceDeductions)
      expect(Object.keys(entry).sort()).toEqual([
        'amount',
        'id',
        'name',
        'sourceKind',
        'sourceReference',
      ]);
    const theirs = (
      await http()
        .get(api(`/me/payslips/${month}`))
        .set(bearer(otherToken))
        .expect(200)
    ).body as LineJson;
    expect(theirs.sourceDeductions).toEqual([]);
    for (const token of [employeeToken, otherToken, scorer]) {
      await http().get(api('/source-deductions')).set(bearer(token)).expect(403);
      await http()
        .put(api(`/source-deductions/${originalId}/month`))
        .set(bearer(token))
        .send({ month: futureMonth })
        .expect(403);
    }
    await http()
      .post(api('/source-deductions'))
      .set(bearer(admin))
      .send({ amount: '1' })
      .expect(404);
    await http()
      .delete(api(`/runs/${current.id}/lines/${frozen.id}/adjustments/${originalId}`))
      .set(bearer(admin))
      .expect(409);
    const late = await postSource({
      sourceKind: 'EXPIRY_RETURN',
      sourceKey: 'expiry:return:after-approve',
      sourceReference: 'EXP-001',
      requestedMonth: month,
      reversesSourceKey: 'expiry:sale:future',
      allocations: [{ userId: employee.id, amount: '-10' }],
    });
    expect(late[0]).toMatchObject({ state: 'NEEDS_MONTH', assignedMonth: null });
    await http()
      .put(api(`/source-deductions/${late[0]!.id}/month`))
      .set(bearer(admin))
      .send({ month })
      .expect(409);
    await http()
      .put(api(`/source-deductions/${late[0]!.id}/month`))
      .set(bearer(admin))
      .send({ month: futureMonth })
      .expect(200);
    expect(line(await getRun())).toEqual(frozen);
    const closedSale = await postSource({
      sourceKind: 'EXPIRY_SALE',
      sourceKey: 'expiry:sale:arrived-closed',
      sourceReference: 'EXP-003',
      requestedMonth: month,
      allocations: [{ userId: employee.id, amount: '7' }],
    });
    expect(closedSale[0]).toMatchObject({ state: 'MONTH_CLOSED', assignedMonth: month });
    const sqlClient = await connectAs('admin');
    try {
      const audit = await sqlClient.query<{ after: unknown }>(
        "SELECT after FROM audit_log WHERE entity IN ('payroll_source_deduction', 'payroll_source_settlement')",
      );
      for (const row of audit.rows)
        expect(JSON.stringify(row.after)).not.toMatch(/amount|cost|revenue|net|gross|deductions/i);
    } finally {
      await sqlClient.end();
    }
  });

  it('keeps released settlement history on authorized reopen and never duplicates debt on reapproval', async () => {
    await http()
      .post(api(`/runs/${current.id}/reopen`))
      .set(bearer(admin))
      .send({ reason: 'Correct draft after approval' })
      .expect(200);
    const history = (await list('expiry:sale:future')).find((row) => row.id === originalId)!;
    expect(history.state).toBe('READY');
    expect(history.settlements).toHaveLength(1);
    expect(history.settlements[0]!.releasedAt).not.toBeNull();
    current = await recompute();
    expect(line(current)).toMatchObject({ deductions: '107.00', otherAdditions: '65.00' });
    // The post-approval refund remains in the month explicitly chosen for it.
    expect((await list('expiry:return:after-approve'))[0]).toMatchObject({
      assignedMonth: futureMonth,
      state: 'WAITING_RUN',
    });
    current = (
      await http()
        .post(api(`/runs/${current.id}/approve`))
        .set(bearer(admin))
        .expect(200)
    ).body as RunJson;
    const settled = (await list('expiry:sale:future')).find((row) => row.id === originalId)!;
    expect(settled.settlements).toHaveLength(2);
    expect(settled.settlements.filter((row) => row.releasedAt === null)).toHaveLength(1);
    expect(line(current)).toMatchObject({ deductions: '107.00', otherAdditions: '65.00' });
    const client = await connectAs('app');
    try {
      expect(
        await sqlStateOf(
          client.query('DELETE FROM payroll_source_deductions WHERE id = $1', [originalId]),
        ),
      ).toBe('42501');
      expect(
        await sqlStateOf(
          client.query('DELETE FROM payroll_source_settlements WHERE deduction_id = $1', [
            originalId,
          ]),
        ),
      ).toBe('42501');
      expect(
        await sqlStateOf(
          client.query('UPDATE payroll_source_deductions SET amount = 1 WHERE id = $1', [
            originalId,
          ]),
        ),
      ).toBe('23514');
      expect(
        await sqlStateOf(
          client.query('UPDATE payroll_source_deductions SET assigned_month = $1 WHERE id = $2', [
            futureMonth,
            originalId,
          ]),
        ),
      ).toBe('23514');
      expect(
        await sqlStateOf(
          client.query(
            'UPDATE payroll_source_settlements SET released_at = now() WHERE deduction_id = $1 AND released_at IS NULL',
            [originalId],
          ),
        ),
      ).toBe('23514');
      expect(
        await sqlStateOf(
          client.query('UPDATE payroll_source_settlements SET amount = 1 WHERE deduction_id = $1', [
            originalId,
          ]),
        ),
      ).toBe('23514');
    } finally {
      await client.end();
    }
  });
});

describe('expiry migration preserves pre-existing invalid values', () => {
  it('adds the exact guards without validating legacy rows and rejects invalid future writes', async () => {
    const client = await connectAs('migrator');
    try {
      const names = ['product_barcodes_expiry_namespace', 'expiry_items_finite_quantities'];
      const installed = await client.query<{ conname: string; convalidated: boolean }>(
        `SELECT conname, convalidated FROM pg_constraint
         WHERE conname = ANY($1::text[])
           AND conrelid IN ('public.product_barcodes'::regclass, 'public.expiry_items'::regclass)
         ORDER BY conname`,
        [names],
      );
      expect(installed.rows).toEqual(
        [...names].sort().map((conname) => ({ conname, convalidated: false })),
      );

      // Session-local tables shadow only these names; execute the actual migration statements.
      // No public constraint is removed and no applied migration is edited or rerun.
      await client.query('CREATE TEMP TABLE product_barcodes (code text NOT NULL)');
      await client.query(
        'CREATE TEMP TABLE expiry_items (qty_floor numeric(14,3), qty_warehouse numeric(14,3))',
      );
      await client.query('SET search_path TO pg_temp, public');
      await client.query("INSERT INTO product_barcodes VALUES ('BTOEXP-legacy')");
      await client.query("INSERT INTO expiry_items VALUES ('NaN', 0), (0, 'NaN')");
      const migration = readFileSync(join(MIGRATIONS_FOLDER, '0129_expiry_commerce.sql'), 'utf8');
      for (const name of names) {
        const statement = migration.match(
          new RegExp(`ALTER TABLE [a-z_]+ ADD CONSTRAINT ${name}\\s+CHECK [^;]+;`),
        )?.[0];
        expect(statement).toBeDefined();
        await client.query(statement!);
      }
      expect((await client.query('SELECT code FROM pg_temp.product_barcodes')).rows).toEqual([
        { code: 'BTOEXP-legacy' },
      ]);
      expect(
        (
          await client.query(
            'SELECT qty_floor::text, qty_warehouse::text FROM pg_temp.expiry_items',
          )
        ).rows,
      ).toEqual([
        { qty_floor: 'NaN', qty_warehouse: '0.000' },
        { qty_floor: '0.000', qty_warehouse: 'NaN' },
      ]);
      for (const statement of [
        "INSERT INTO product_barcodes VALUES ('btoexp-new')",
        'UPDATE product_barcodes SET code = code',
        "INSERT INTO expiry_items VALUES ('NaN', 0)",
        "INSERT INTO expiry_items VALUES (0, 'NaN')",
        'UPDATE expiry_items SET qty_floor = qty_floor',
      ]) {
        expect(await sqlStateOf(client.query(statement))).toBe('23514');
      }
      await client.query("INSERT INTO product_barcodes VALUES ('ordinary-new')");
      await client.query('INSERT INTO expiry_items VALUES (1, 2)');
      expect(
        (await client.query('SELECT count(*)::int AS n FROM product_barcodes')).rows[0].n,
      ).toBe(2);
      expect((await client.query('SELECT count(*)::int AS n FROM expiry_items')).rows[0].n).toBe(3);
    } finally {
      await client.end();
    }
  });
});
