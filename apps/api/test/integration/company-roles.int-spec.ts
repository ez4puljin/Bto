import type { NestExpressApplication } from '@nestjs/platform-express';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { createAdmin } from '../../src/modules/identity/cli/create-admin';
import { AccessService } from '../../src/modules/identity/services/access.service';
import { connectAs, createHttpApp } from '../harness/apps';
import { bearer, login, seedUser, TEST_PEPPER } from '../harness/identity';

/**
 * The installation's Finance Core company (ADR-0084 #2, #3): `bto.company_code` is fixed, every
 * role write mirrors into `user_company_roles`, and the AuthContext carries the finance rights
 * per company that fin-bridge hands the core.
 */
describe('company code and per-company roles', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let adminToken: string;
  let roleIds: Map<string, number>;
  const http = () => request(app.getHttpServer());
  const asAdmin = () => bearer(adminToken);

  const mirrored = async (userId: number) => {
    const { rows } = await sql.query<{ company_code: string; role_id: string }>(
      `SELECT company_code, role_id::text FROM user_company_roles WHERE user_id = $1 ORDER BY role_id`,
      [userId],
    );
    return rows.map((row) => `${row.company_code}:${row.role_id}`);
  };
  const direct = async (userId: number) => {
    const { rows } = await sql.query<{ role_id: string }>(
      `SELECT role_id::text FROM user_roles WHERE user_id = $1 ORDER BY role_id`,
      [userId],
    );
    return rows.map((row) => `BO:${row.role_id}`);
  };
  const companyPermissions = async (userId: number) => {
    const { rows } = await sql.query<{ id: string }>(
      `SELECT id FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const access = await app.get(AccessService).resolve(userId, rows[0]?.id ?? '');
    return Object.fromEntries(
      [...(access?.companyPermissions ?? new Map<string, Set<string>>())].map(([code, set]) => [
        code,
        [...set].sort(),
      ]),
    );
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = await seedUser(app, { roles: ['ADMIN'] });
    adminToken = (await login(app, admin)).accessToken;
    const roles = await http().get('/api/v1/roles').set(asAdmin()).expect(200);
    roleIds = new Map(
      (roles.body as { data: { id: number; code: string | null }[] }).data
        .filter((role) => role.code)
        .map((role) => [role.code ?? '', role.id]),
    );
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('shows bto.company_code as BO and refuses a new value', async () => {
    const list = await http().get('/api/v1/settings').set(asAdmin()).expect(200);
    expect((list.body as { data: { key: string; current: unknown }[] }).data).toContainEqual(
      expect.objectContaining({ key: 'bto.company_code', current: 'BO', entries: [] }),
    );
    const refused = await http()
      .post('/api/v1/settings')
      .set(asAdmin())
      .set('Idempotency-Key', 'company-code-1')
      .send({ key: 'bto.company_code', value: 'OTHER', effectiveFrom: '2099-01-01' })
      .expect(409);
    expect(refused.body).toMatchObject({
      code: 'SETTING_NOT_EDITABLE',
      params: { key: 'bto.company_code' },
    });
  });

  it('mirrors the roles of every user write into the installation company', async () => {
    const created = await http()
      .post('/api/v1/users')
      .set(asAdmin())
      .send({
        username: 'nyagtlan1',
        fullName: 'Нягтлан',
        roleIds: [roleIds.get('ACCOUNTANT'), roleIds.get('OFFICE')],
      })
      .expect(201);
    const userId = (created.body as { id: number }).id;
    expect(await mirrored(userId)).toHaveLength(2);
    expect(await mirrored(userId)).toEqual(await direct(userId));

    await http()
      .patch(`/api/v1/users/${userId}`)
      .set(asAdmin())
      .send({ roleIds: [roleIds.get('WAREHOUSE')] })
      .expect(200);
    expect(await mirrored(userId)).toEqual([`BO:${roleIds.get('WAREHOUSE')}`]);

    await http().patch(`/api/v1/users/${userId}`).set(asAdmin()).send({ roleIds: [] }).expect(200);
    expect(await mirrored(userId)).toEqual([]);

    const seeded = await seedUser(app, { roles: ['ACCOUNTANT'] });
    expect(await mirrored(seeded.id)).toEqual(await direct(seeded.id));

    const admin = await createAdmin(app.get<Db>(DB), {
      username: 'owner2',
      fullName: 'Эзэн',
      pepper: TEST_PEPPER,
    });
    expect(await mirrored(admin.userId)).toEqual([`BO:${roleIds.get('ADMIN')}`]);
  });

  it('gives the AuthContext the finance rights per company, none without a company role', async () => {
    const accountant = await seedUser(app, { roles: ['ACCOUNTANT'] });
    await login(app, accountant);
    expect(await companyPermissions(accountant.id)).toEqual({
      BO: SYSTEM_ROLE_PERMISSIONS.ACCOUNTANT.filter((code) => code.startsWith('finance.')).sort(),
    });

    const worker = await seedUser(app, { roles: ['WAREHOUSE'] });
    await login(app, worker);
    expect(await companyPermissions(worker.id)).toEqual({});

    // ADR-0075: no company row, no access there, whatever the user's direct roles say.
    const admin = await connectAs('admin');
    try {
      await admin.query('DELETE FROM user_company_roles WHERE user_id = $1', [accountant.id]);
    } finally {
      await admin.end();
    }
    expect(await companyPermissions(accountant.id)).toEqual({});
  });

  it('keeps a role that a company still grants', async () => {
    const role = await http()
      .post('/api/v1/roles')
      .set(asAdmin())
      .send({ name: 'Санхүү харагч', permissions: ['finance.read'] })
      .expect(201);
    const roleId = (role.body as { id: number }).id;
    const holder = await seedUser(app);
    const admin = await connectAs('admin');
    try {
      await admin.query(
        `INSERT INTO user_company_roles (user_id, company_code, role_id) VALUES ($1, 'BO', $2)`,
        [holder.id, roleId],
      );
    } finally {
      await admin.end();
    }
    const inUse = await http().delete(`/api/v1/roles/${roleId}`).set(asAdmin()).expect(409);
    expect(inUse.body).toMatchObject({ code: 'ROLE_IN_USE', params: { userCount: 1 } });
  });
});
