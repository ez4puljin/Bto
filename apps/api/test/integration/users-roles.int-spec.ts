import type { NestExpressApplication } from '@nestjs/platform-express';
import { isAssignablePermission, PERMISSIONS } from '@tugeel/shared/auth';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { bearer, login, seedUser, testIp, uniquePhone } from '../harness/identity';

interface RoleBody {
  id: number;
  code: string | null;
  name: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
}

describe('users and roles API (SPEC §5.1, ADR-0027)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let adminToken: string;
  let adminId: number;
  let systemRoles: Map<string, number>;
  const http = () => request(app.getHttpServer());
  const asAdmin = () => bearer(adminToken);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = await seedUser(app, { roles: ['ADMIN'] });
    adminId = admin.id;
    adminToken = (await login(app, admin)).accessToken;
    const roles = await http().get('/api/v1/roles').set(asAdmin()).expect(200);
    systemRoles = new Map(
      (roles.body as { data: RoleBody[] }).data
        .filter((role) => role.code)
        .map((role) => [role.code ?? '', role.id]),
    );
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  const roleId = (code: string) => systemRoles.get(code) ?? 0;

  describe('permission matrix', () => {
    it('refuses anonymous callers, warehouse workers and accountants where SPEC §5.1 says so', async () => {
      await http().get('/api/v1/users').expect(401);
      const worker = await seedUser(app, { roles: ['WAREHOUSE'] });
      const workerToken = (await login(app, worker)).accessToken;
      const createAttempt = await http()
        .post('/api/v1/users')
        .set(bearer(workerToken))
        .send({ phone: uniquePhone(), fullName: 'Х', roleIds: [] })
        .expect(403);
      expect(createAttempt.body).toMatchObject({ code: 'FORBIDDEN' });
      const accountant = await seedUser(app, { roles: ['ACCOUNTANT'] });
      const accountantToken = (await login(app, accountant)).accessToken;
      await http().get('/api/v1/users').set(bearer(accountantToken)).expect(403);
      await http()
        .post('/api/v1/roles')
        .set(bearer(accountantToken))
        .send({ name: 'Хориотой', permissions: [] })
        .expect(403);
    });
  });

  describe('users', () => {
    it('creates a user by name and phone without a password; a one-time code lets them in', async () => {
      const created = await http()
        .post('/api/v1/users')
        .set(asAdmin())
        .send({
          fullName: '  Шинэ ажилтан ',
          phone: '9911 2233',
          roleIds: [roleId('WAREHOUSE')],
        })
        .expect(201);
      const body = created.body as {
        id: number;
        username: string;
        fullName: string;
        phone: string;
        passwordSet: boolean;
        roleIds: number[];
      };
      expect(body).toMatchObject({
        username: 'p99112233',
        fullName: 'Шинэ ажилтан',
        phone: '+97699112233',
        passwordSet: false,
        roleIds: [roleId('WAREHOUSE')],
      });
      const issued = await http()
        .post(`/api/v1/users/${body.id}/password-code`)
        .set(asAdmin())
        .expect(200);
      expect(issued.headers['cache-control']).toBe('no-store');
      const { code } = issued.body as { code: string };
      await http()
        .post('/api/v1/auth/password/setup')
        .set('X-Forwarded-For', testIp())
        .send({ login: '99112233', code, newPassword: 'worker-password-1' })
        .expect(200);
      const detail = await http().get(`/api/v1/users/${body.id}`).set(asAdmin()).expect(200);
      expect((detail.body as { passwordSet: boolean }).passwordSet).toBe(true);
      const audit = await sql.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE entity = 'users' AND entity_id = $1 ORDER BY id`,
        [String(body.id)],
      );
      expect(audit.rows.map((row) => row.action)).toEqual([
        'CREATE',
        'PASSWORD_CODE_ISSUED',
        'PASSWORD_SET',
      ]);
    });

    it('requires a phone, keeps it unique and never lets it go (ADR-0128 #3)', async () => {
      const phone = uniquePhone();
      const first = await http()
        .post('/api/v1/users')
        .set(asAdmin())
        .send({ phone, fullName: 'А', roleIds: [] })
        .expect(201);
      const firstId = (first.body as { id: number }).id;
      const duplicate = await http()
        .post('/api/v1/users')
        .set(asAdmin())
        .send({ phone: ` ${phone.slice(-8)} `, fullName: 'Б', roleIds: [] })
        .expect(422);
      expect(duplicate.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'phone', constraint: 'unique' }],
      });
      for (const [body, path, constraint] of [
        [{ fullName: 'А', roleIds: [] }, 'phone', 'isNotEmpty'],
        [{ fullName: 'А', phone: '   ', roleIds: [] }, 'phone', 'required'],
        [{ fullName: 'А', phone: '123', roleIds: [] }, 'phone', 'isMnPhone'],
        [{ fullName: 'А', phone: uniquePhone(), roleIds: [999_999] }, 'roleIds', undefined],
      ] as const) {
        const response = await http().post('/api/v1/users').set(asAdmin()).send(body).expect(422);
        expect(response.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: expect.arrayContaining([
            expect.objectContaining(constraint ? { path, constraint } : { path }),
          ]) as unknown,
        });
      }
      // An older typed login name equal to the generated one: the new record takes a suffix.
      const legacyPhone = uniquePhone();
      await seedUser(app, { username: `p${legacyPhone.slice(-8)}`, phone: null });
      const suffixed = await http()
        .post('/api/v1/users')
        .set(asAdmin())
        .send({ phone: legacyPhone, fullName: 'В', roleIds: [] })
        .expect(201);
      expect((suffixed.body as { username: string }).username).toBe(`p${legacyPhone.slice(-8)}-1`);
      // The phone changes but never goes away; another staff member's phone is refused.
      const other = await seedUser(app);
      const cleared = await http()
        .patch(`/api/v1/users/${firstId}`)
        .set(asAdmin())
        .send({ phone: null })
        .expect(422);
      expect(cleared.body).toMatchObject({ errors: [{ path: 'phone', constraint: 'required' }] });
      const taken = await http()
        .patch(`/api/v1/users/${firstId}`)
        .set(asAdmin())
        .send({ phone: other.phone })
        .expect(422);
      expect(taken.body).toMatchObject({ errors: [{ path: 'phone', constraint: 'unique' }] });
      const moved = await http()
        .patch(`/api/v1/users/${firstId}`)
        .set(asAdmin())
        .send({ phone: uniquePhone().slice(-8) })
        .expect(200);
      expect((moved.body as { phone: string }).phone).toMatch(/^\+976\d{8}$/);
      await http()
        .patch(`/api/v1/users/${firstId}`)
        .set(asAdmin())
        .send({ phone: (moved.body as { phone: string }).phone })
        .expect(200);
    });

    it('lists users with keyset pagination and search', async () => {
      const page1 = await http().get('/api/v1/users?limit=2').set(asAdmin()).expect(200);
      const first = page1.body as { data: { id: number }[]; nextCursor: string | null };
      expect(first.data).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      const page2 = await http()
        .get(`/api/v1/users?limit=2&cursor=${first.nextCursor ?? ''}`)
        .set(asAdmin())
        .expect(200);
      const second = page2.body as { data: { id: number }[] };
      expect(second.data[0]?.id).toBeGreaterThan(first.data[1]?.id ?? 0);
      const found = await http().get('/api/v1/users?q=Шинэ').set(asAdmin()).expect(200);
      const foundRows = (found.body as { data: { fullName: string; phone: string | null }[] }).data;
      expect(foundRows.length).toBeGreaterThan(0);
      expect(foundRows.every((u) => u.fullName.includes('Шинэ'))).toBe(true);
      const byPhone = await http().get('/api/v1/users?q=99112233').set(asAdmin()).expect(200);
      expect((byPhone.body as { data: { phone: string | null }[] }).data).toEqual([
        expect.objectContaining({ phone: '+97699112233' }),
      ]);
      const active = await http().get('/api/v1/users?status=DISABLED').set(asAdmin()).expect(200);
      expect(
        (active.body as { data: { status: string }[] }).data.every((u) => u.status === 'DISABLED'),
      ).toBe(true);
      await http().get('/api/v1/users?cursor=***').set(asAdmin()).expect(422);
    });

    it('changes roles and scopes, but nobody changes their own access', async () => {
      const user = await seedUser(app, { roles: ['WAREHOUSE'] });
      const { rows } = await sql.query<{ id: string }>(
        `INSERT INTO branches (code, name) VALUES ('USR-B', 'Салбар') RETURNING id`,
      );
      const branchId = Number.parseInt(rows[0]?.id ?? '0', 10);
      const updated = await http()
        .patch(`/api/v1/users/${user.id}`)
        .set(asAdmin())
        .send({ roleIds: [roleId('OFFICE')], scopes: { warehouseIds: [], branchIds: [branchId] } })
        .expect(200);
      expect(updated.body).toMatchObject({
        roleIds: [roleId('OFFICE')],
        scopes: { warehouseIds: [], branchIds: [branchId] },
      });
      for (const body of [
        { status: 'DISABLED' },
        { roleIds: [] },
        { scopes: { warehouseIds: [], branchIds: [] } },
      ]) {
        const self = await http()
          .patch(`/api/v1/users/${adminId}`)
          .set(asAdmin())
          .send(body)
          .expect(409);
        expect(self.body).toMatchObject({ code: 'SELF_EDIT_FORBIDDEN' });
      }
      await http()
        .patch(`/api/v1/users/${adminId}`)
        .set(asAdmin())
        .send({ fullName: 'Эзэн' })
        .expect(200);
    });

    it('disabling a user ends their sessions at once', async () => {
      const user = await seedUser(app, { roles: ['WAREHOUSE'] });
      const { accessToken } = await login(app, user);
      await http().get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
      await http()
        .patch(`/api/v1/users/${user.id}`)
        .set(asAdmin())
        .send({ status: 'DISABLED' })
        .expect(200);
      await http().get('/api/v1/auth/me').set(bearer(accessToken)).expect(401);
    });

    it('lists and revokes devices, and unlocks a locked account', async () => {
      const user = await seedUser(app);
      const phone = await login(app, user);
      const desk = await login(app, user);
      const sessions = await http()
        .get(`/api/v1/users/${user.id}/sessions`)
        .set(asAdmin())
        .expect(200);
      const list = (sessions.body as { data: { id: string; ip: string }[] }).data;
      expect(list).toHaveLength(2);
      const phoneSession = list.find((s) => s.ip.endsWith(phone.ip));
      await http()
        .delete(`/api/v1/users/${user.id}/sessions/${phoneSession?.id ?? ''}`)
        .set(asAdmin())
        .expect(204);
      await http().get('/api/v1/auth/me').set(bearer(phone.accessToken)).expect(401);
      await http().get('/api/v1/auth/me').set(bearer(desk.accessToken)).expect(200);
      await http().delete(`/api/v1/users/${user.id}/sessions`).set(asAdmin()).expect(204);
      await http().get('/api/v1/auth/me').set(bearer(desk.accessToken)).expect(401);
      await sql.query(`UPDATE users SET locked_until = now() + interval '1 hour' WHERE id = $1`, [
        user.id,
      ]);
      await http().post(`/api/v1/users/${user.id}/unlock`).set(asAdmin()).expect(204);
      await login(app, user);
    });
  });

  describe('roles', () => {
    it('lists the catalog with the admin-only codes marked', async () => {
      const response = await http().get('/api/v1/permissions').set(asAdmin()).expect(200);
      expect(response.body).toEqual({
        data: PERMISSIONS.map((code) => ({ code, assignable: isAssignablePermission(code) })),
        nextCursor: null,
      });
    });

    it('keeps system roles read-only and validates custom roles', async () => {
      const edit = await http()
        .patch(`/api/v1/roles/${roleId('WAREHOUSE')}`)
        .set(asAdmin())
        .send({ permissions: ['identity.audit.read'] })
        .expect(409);
      expect(edit.body).toMatchObject({ code: 'ROLE_SYSTEM_READONLY' });
      for (const permissions of [['identity.users.manage'], ['identity.nothing']]) {
        const response = await http()
          .post('/api/v1/roles')
          .set(asAdmin())
          .send({ name: 'Буруу дүр', permissions })
          .expect(422);
        expect(response.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ path: 'permissions' }],
        });
      }
    });

    it('grants a custom role at once, refuses a duplicate name and deletes only unused roles', async () => {
      const created = await http()
        .post('/api/v1/roles')
        .set(asAdmin())
        .send({ name: 'Хэрэглэгч харагч', permissions: ['identity.users.read'] })
        .expect(201);
      const role = created.body as RoleBody;
      expect(role).toMatchObject({
        isSystem: false,
        code: null,
        permissions: ['identity.users.read'],
        userCount: 0,
      });
      await http()
        .post('/api/v1/roles')
        .set(asAdmin())
        .send({ name: 'хэрэглэгч ХАРАГЧ', permissions: [] })
        .expect(409);
      const viewer = await seedUser(app);
      const viewerToken = (await login(app, viewer)).accessToken;
      await http().get('/api/v1/users').set(bearer(viewerToken)).expect(403);
      await http()
        .patch(`/api/v1/users/${viewer.id}`)
        .set(asAdmin())
        .send({ roleIds: [role.id] })
        .expect(200);
      await http().get('/api/v1/users').set(bearer(viewerToken)).expect(200);
      const inUse = await http().delete(`/api/v1/roles/${role.id}`).set(asAdmin()).expect(409);
      expect(inUse.body).toMatchObject({ code: 'ROLE_IN_USE' });
      await http()
        .patch(`/api/v1/users/${viewer.id}`)
        .set(asAdmin())
        .send({ roleIds: [] })
        .expect(200);
      await http().delete(`/api/v1/roles/${role.id}`).set(asAdmin()).expect(204);
      const audit = await sql.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE entity = 'roles' ORDER BY id`,
      );
      expect(audit.rows.map((row) => row.action)).toEqual(['CREATE', 'DELETE']);
    });
  });
});
