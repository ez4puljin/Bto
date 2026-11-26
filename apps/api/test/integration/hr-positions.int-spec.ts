import type { NestExpressApplication } from '@nestjs/platform-express';
import { addMonths, businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { PositionsService } from '../../src/modules/hr';
import { branches, userCompanyRoles, userRoles, users } from '../../src/modules/identity/schema';
import { createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface PositionJson {
  id: number;
  name: string;
  roleIds: number[];
  baseSalary: string | null;
  nextBaseSalary: string | null;
  nextEffectiveMonth: string | null;
  salaryHistory: { effectiveMonth: string; baseSalary: string }[];
  canAssign: boolean;
  grantsAdmin: boolean;
}

describe('HR positions: shared access, dated salary and additive legacy rollout', () => {
  let app: NestExpressApplication;
  let db: Db;
  let admin: string;
  let hr: string;
  let noPay: string;
  let officeRole: number;
  let adminRole: number;
  let position: PositionJson;
  let staffId: number;
  const month = businessDate().slice(0, 7);
  const nextMonth = addMonths(`${month}-01`, 1).slice(0, 7);
  const http = () => request(app.getHttpServer());
  const card = (phone: string, positionId?: number | null) => ({
    firstName: 'Position',
    lastName: 'Test',
    phone,
    positionId,
    position: null,
    divisionId: null,
    employmentType: 'PERMANENT',
    gender: null,
    employedOn: null,
    scheduleId: null,
  });

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    hr = (await login(app, await seedUser(app, { roles: ['HR'] }))).accessToken;
    const roles = (await http().get('/api/v1/roles').set(bearer(admin)).expect(200)).body as {
      data: { id: number; code: string }[];
    };
    officeRole = roles.data.find((row) => row.code === 'OFFICE')!.id;
    adminRole = roles.data.find((row) => row.code === 'ADMIN')!.id;
    const privateRole = await http()
      .post('/api/v1/roles')
      .set(bearer(admin))
      .send({
        name: 'Position HR without payroll',
        permissions: ['hr.attendance.view', 'hr.attendance.manage'],
      })
      .expect(201);
    const person = await seedUser(app);
    await http()
      .patch(`/api/v1/users/${person.id}`)
      .set(bearer(admin))
      .send({ roleIds: [(privateRole.body as { id: number }).id] })
      .expect(200);
    noPay = (await login(app, person)).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('only ADMIN configures positions, and new staff must select one', async () => {
    await http()
      .post('/api/v1/hr/positions')
      .set(bearer(hr))
      .send({ name: 'Forbidden', baseSalary: '1', roleIds: [] })
      .expect(403);
    await http()
      .post('/api/v1/hr/staff')
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...card('88110101'), password: 'Position-2026' })
      .expect(422);
    position = (
      await http()
        .post('/api/v1/hr/positions')
        .set(bearer(admin))
        .send({ name: 'Shared staff', baseSalary: '1000000', roleIds: [officeRole] })
        .expect(201)
    ).body as PositionJson;
    expect(position).toMatchObject({
      baseSalary: '1000000.00',
      nextBaseSalary: null,
      salaryHistory: [{ effectiveMonth: month, baseSalary: '1000000.00' }],
    });
    const created = await http()
      .post('/api/v1/hr/staff')
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...card('88110102', position.id), password: 'Position-2026' })
      .expect(201);
    staffId = (created.body as { userId: number }).userId;
    expect(created.body).toMatchObject({
      positionId: position.id,
      position: position.name,
      roles: ['OFFICE'],
      positionBaseSalary: '1000000.00',
      positionSalaryEffectiveMonth: month,
    });
    await login(app, { username: 'p88110102', phone: '88110102', password: 'Position-2026' });
  });

  it('edits next month by upsert and syncs exact role IDs without changing credentials or scopes', async () => {
    const [branch] = await db
      .insert(branches)
      .values({ code: 'POSITION', name: 'Position scope' })
      .returning({ id: branches.id });
    if (!branch) throw new Error('test branch was not inserted');
    await http()
      .patch(`/api/v1/users/${staffId}`)
      .set(bearer(admin))
      .send({ scopes: { branchIds: [branch.id], warehouseIds: [] } })
      .expect(200);
    const [before] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, staffId));
    await http()
      .patch(`/api/v1/users/${staffId}`)
      .set(bearer(admin))
      .send({ roleIds: [] })
      .expect(422);
    const other = (
      await http()
        .post('/api/v1/roles')
        .set(bearer(admin))
        .send({ name: 'Position custom', permissions: ['catalog.products.manage'] })
        .expect(201)
    ).body as { id: number };
    for (const baseSalary of ['1200000', '1300000']) {
      position = (
        await http()
          .put(`/api/v1/hr/positions/${position.id}`)
          .set(bearer(admin))
          .send({ name: 'Renamed shared staff', baseSalary, roleIds: [other.id] })
          .expect(200)
      ).body as PositionJson;
    }
    expect(position).toMatchObject({
      baseSalary: '1000000.00',
      nextBaseSalary: '1300000.00',
      nextEffectiveMonth: nextMonth,
    });
    expect(position.salaryHistory).toHaveLength(2);
    const held = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, staffId));
    const mirror = await db
      .select({ roleId: userCompanyRoles.roleId })
      .from(userCompanyRoles)
      .where(eq(userCompanyRoles.userId, staffId));
    expect(held.map((row) => row.roleId)).toEqual([other.id]);
    expect(mirror.map((row) => row.roleId)).toEqual([other.id]);
    const [after] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, staffId));
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(
      (await http().get(`/api/v1/users/${staffId}`).set(bearer(admin)).expect(200)).body,
    ).toMatchObject({ scopes: { branchIds: [branch.id], warehouseIds: [] } });
    const rates = app.get(PositionsService);
    expect((await rates.baseSalariesForUsers(db, [staffId], month)).get(staffId)?.baseSalary).toBe(
      '1000000.00',
    );
    expect(
      (await rates.baseSalariesForUsers(db, [staffId], nextMonth)).get(staffId)?.baseSalary,
    ).toBe('1300000.00');
    await http()
      .put(`/api/v1/hr/staff/${staffId}`)
      .set(bearer(admin))
      .send(card('88110102', null))
      .expect(422);
    await http()
      .put(`/api/v1/hr/staff/${staffId}/password`)
      .set(bearer(hr))
      .send({ password: 'Unexpected-2026' })
      .expect(403);
    const directory = (await http().get('/api/v1/hr/directory').set(bearer(hr)).expect(200))
      .body as { userId: number; position: string }[];
    expect(directory.find((row) => row.userId === staffId)?.position).toBe('Renamed shared staff');
  });

  it('keeps legacy staff unassigned until ADMIN maps them, and preserves the current month on reassignment', async () => {
    const legacy = await seedUser(app, { roles: ['OFFICE'] });
    await http()
      .put(`/api/v1/hr/staff/${legacy.id}`)
      .set(bearer(hr))
      .send(card(legacy.phone!, position.id))
      .expect(403);
    const mapped = await http()
      .put(`/api/v1/hr/staff/${legacy.id}`)
      .set(bearer(admin))
      .send(card(legacy.phone!, position.id))
      .expect(200);
    expect(mapped.body).toMatchObject({
      positionBaseSalary: null,
      positionNextBaseSalary: '1300000.00',
      positionNextEffectiveMonth: nextMonth,
      positionSalaryEffectiveMonth: nextMonth,
    });
    expect(
      (await app.get(PositionsService).baseSalariesForUsers(db, [legacy.id], month)).has(legacy.id),
    ).toBe(false);
    const higher = (
      await http()
        .post('/api/v1/hr/positions')
        .set(bearer(admin))
        .send({ name: 'Higher staff', baseSalary: '2000000', roleIds: [officeRole] })
        .expect(201)
    ).body as PositionJson;
    await http()
      .put(`/api/v1/hr/staff/${staffId}`)
      .set(bearer(admin))
      .send(card('88110102', higher.id))
      .expect(200);
    const rates = app.get(PositionsService);
    expect((await rates.baseSalariesForUsers(db, [staffId], month)).get(staffId)?.baseSalary).toBe(
      '1000000.00',
    );
    expect(
      (await rates.baseSalariesForUsers(db, [staffId], nextMonth)).get(staffId)?.baseSalary,
    ).toBe('2000000.00');
  });

  it('reserves ADMIN assignment and existing ADMIN access for ADMIN, including self-edit protection', async () => {
    const adminPosition = (
      await http()
        .post('/api/v1/hr/positions')
        .set(bearer(admin))
        .send({ name: 'Admin position', baseSalary: '3000000', roleIds: [adminRole] })
        .expect(201)
    ).body as PositionJson;
    await http()
      .post('/api/v1/hr/staff')
      .set(bearer(hr))
      .set(idempotency())
      .send({ ...card('88110103', adminPosition.id), password: 'Position-2026' })
      .expect(403);
    const asHr = (await http().get('/api/v1/hr/positions').set(bearer(hr)).expect(200))
      .body as PositionJson[];
    expect(asHr.every((row) => !row.canAssign)).toBe(true);
    expect(asHr.find((row) => row.id === adminPosition.id)).toMatchObject({
      grantsAdmin: true,
      canAssign: false,
    });
    const currentAdmin = await seedUser(app, { roles: ['ADMIN'] });
    const own = (await login(app, currentAdmin)).accessToken;
    const self = await http()
      .put(`/api/v1/hr/staff/${currentAdmin.id}`)
      .set(bearer(own))
      .send(card(currentAdmin.phone!, position.id))
      .expect(409);
    expect(self.body).toMatchObject({ code: 'SELF_EDIT_FORBIDDEN' });
    await http()
      .put(`/api/v1/hr/staff/${currentAdmin.id}`)
      .set(bearer(hr))
      .send(card(currentAdmin.phone!))
      .expect(403);
  });

  it('refuses HR registration and same-role higher-pay moves, including ADMIN self moves', async () => {
    for (const role of ['HR', 'ADMIN'] as const) {
      const employee = await seedUser(app, { roles: [role] });
      const allRoles = (await http().get('/api/v1/roles').set(bearer(admin)).expect(200)).body as {
        data: { id: number; code: string }[];
      };
      const roleId = allRoles.data.find((row) => row.code === role)!.id;
      const positions: PositionJson[] = [];
      for (const salary of ['1000000', '2000000']) {
        positions.push(
          (
            await http()
              .post('/api/v1/hr/positions')
              .set(bearer(admin))
              .send({ name: `${role} self guard ${salary}`, baseSalary: salary, roleIds: [roleId] })
              .expect(201)
          ).body as PositionJson,
        );
      }
      const [lower, higher] = positions as [PositionJson, PositionJson];
      await http()
        .put(`/api/v1/hr/staff/${employee.id}`)
        .set(bearer(admin))
        .send(card(employee.phone!, lower.id))
        .expect(200);
      const own = (await login(app, employee)).accessToken;
      const beforeSalary = await app
        .get(PositionsService)
        .salarySchedulesForUsers(db, [employee.id], month);
      const refused = await http()
        .put(`/api/v1/hr/staff/${employee.id}`)
        .set(bearer(own))
        .send(card(employee.phone!, higher.id))
        .expect(409);
      expect(refused.body).toMatchObject({ code: 'SELF_EDIT_FORBIDDEN' });
      expect(
        await app.get(PositionsService).salarySchedulesForUsers(db, [employee.id], month),
      ).toEqual(beforeSalary);
      const staff = (await http().get('/api/v1/hr/staff').set(bearer(admin)).expect(200)).body as {
        userId: number;
        positionId: number;
      }[];
      expect(staff.find((row) => row.userId === employee.id)?.positionId).toBe(lower.id);
      if (role === 'HR') {
        await http()
          .post('/api/v1/hr/staff')
          .set(bearer(own))
          .set(idempotency())
          .send({ ...card('88110109', lower.id), password: 'Position-2026' })
          .expect(403);
        await http()
          .put(`/api/v1/hr/staff/${staffId}`)
          .set(bearer(own))
          .send(card('88110102', higher.id))
          .expect(403);
        // Ordinary card edits do not assign roles or change the salary schedule.
        await http()
          .put(`/api/v1/hr/staff/${employee.id}`)
          .set(bearer(own))
          .send({ ...card(employee.phone!, lower.id), firstName: 'Edited' })
          .expect(200);
        expect(
          await app.get(PositionsService).salarySchedulesForUsers(db, [employee.id], month),
        ).toEqual(beforeSalary);
      } else {
        const ownRoles = await http()
          .put(`/api/v1/hr/positions/${lower.id}`)
          .set(bearer(own))
          .send({ name: 'Must not save', baseSalary: '9000000', roleIds: [adminRole, officeRole] })
          .expect(422);
        expect(ownRoles.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ path: 'roleIds', constraint: 'ownPositionRoles' }],
        });
        expect(
          (await http().get(`/api/v1/hr/positions/${lower.id}`).set(bearer(own)).expect(200)).body,
        ).toMatchObject({ name: lower.name, nextBaseSalary: null, roleIds: [adminRole] });
        expect(
          (
            await http()
              .put(`/api/v1/hr/positions/${lower.id}`)
              .set(bearer(own))
              .send({ name: 'Allowed catalog edit', baseSalary: '1500000', roleIds: [adminRole] })
              .expect(200)
          ).body,
        ).toMatchObject({
          name: 'Allowed catalog edit',
          nextBaseSalary: '1500000.00',
          roleIds: [adminRole],
        });
      }
    }
  });

  it('masks every HR salary response without payroll view, and archives without changing bound staff', async () => {
    const plainPosition = (
      await http()
        .post('/api/v1/hr/positions')
        .set(bearer(admin))
        .send({ name: 'Private salary roleless', baseSalary: '1777777', roleIds: [] })
        .expect(201)
    ).body as PositionJson;
    const registered = await http()
      .post('/api/v1/hr/staff')
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...card('88110105', plainPosition.id), password: 'Position-2026' })
      .expect(201);
    const plainId = (registered.body as { userId: number }).userId;
    for (const action of [
      () => http().put(`/api/v1/hr/staff/${plainId}`).send(card('88110105', plainPosition.id)),
      () =>
        http()
          .put(`/api/v1/hr/staff/${plainId}/password`)
          .send({ password: 'Position-second-2026' }),
    ]) {
      expect((await action().set(bearer(noPay)).expect(200)).body).toMatchObject({
        positionBaseSalary: null,
        positionNextBaseSalary: null,
      });
    }
    const list = (await http().get('/api/v1/hr/positions').set(bearer(noPay)).expect(200))
      .body as PositionJson[];
    expect(
      list.every(
        (row) =>
          row.baseSalary === null && row.nextBaseSalary === null && row.salaryHistory.length === 0,
      ),
    ).toBe(true);
    const actions = [
      () => http().get('/api/v1/hr/staff'),
      () => http().put(`/api/v1/hr/staff/${staffId}/photo`).send({ fileId: null }),
      () => http().put(`/api/v1/hr/staff/${staffId}/details`).send({ children: [] }),
      () => http().put(`/api/v1/hr/staff/${staffId}/left`).send({ leftOn: null, reason: null }),
    ];
    for (const action of actions) {
      const result = await action().set(bearer(noPay)).expect(200);
      const rows = Array.isArray(result.body)
        ? (result.body as {
            positionBaseSalary: string | null;
            positionNextBaseSalary: string | null;
          }[])
        : [
            result.body as {
              positionBaseSalary: string | null;
              positionNextBaseSalary: string | null;
            },
          ];
      expect(
        rows.every((row) => row.positionBaseSalary === null && row.positionNextBaseSalary === null),
      ).toBe(true);
    }
    await http()
      .put(`/api/v1/hr/positions/${position.id}/archived`)
      .set(bearer(admin))
      .send({ archived: true })
      .expect(200);
    await http()
      .post('/api/v1/hr/staff')
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...card('88110104', position.id), password: 'Position-2026' })
      .expect(422);
  });

  it('retains role references for unstaffed positions and serializes role edits with registration', async () => {
    const role = (
      await http()
        .post('/api/v1/roles')
        .set(bearer(admin))
        .send({ name: 'Position reference', permissions: ['catalog.products.manage'] })
        .expect(201)
    ).body as { id: number };
    const catalog = (
      await http()
        .post('/api/v1/hr/positions')
        .set(bearer(admin))
        .send({ name: 'Concurrent position', baseSalary: '1500000', roleIds: [role.id] })
        .expect(201)
    ).body as PositionJson;
    const refusal = await http().delete(`/api/v1/roles/${role.id}`).set(bearer(admin)).expect(409);
    expect(refusal.body).toMatchObject({
      code: 'ROLE_NAMED_ON_RECORDS',
      params: { entity: 'hr_position' },
    });
    const [, registered] = await Promise.all([
      http()
        .put(`/api/v1/hr/positions/${catalog.id}`)
        .set(bearer(admin))
        .send({ name: catalog.name, baseSalary: '1500000', roleIds: [officeRole] })
        .expect(200),
      http()
        .post('/api/v1/hr/staff')
        .set(bearer(admin))
        .set(idempotency())
        .send({ ...card('88110106', catalog.id), password: 'Position-2026' })
        .expect(201),
    ]);
    const id = (registered.body as { userId: number }).userId;
    const held = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, id));
    expect(held.map((row) => row.roleId)).toEqual([officeRole]);
  });
});
