import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import { IsOptional, IsString } from 'class-validator';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { AppError } from '../../src/common/errors/app-error';
import {
  Authenticated,
  Idempotent,
  IdentityModule,
  NumberingService,
} from '../../src/modules/identity';
import { connectAs, createHttpApp } from '../harness/apps';
import { bearer, login, seedUser } from '../harness/identity';

class ProbeBody {
  @IsOptional()
  @IsString()
  note?: string;
}

/** A document-creating route stand-in: every real run takes the next number. */
@Controller('probe-documents')
class IdempotentProbe {
  constructor(
    private readonly numbering: NumberingService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post()
  @Authenticated()
  @Idempotent()
  async create(@Body() body: ProbeBody) {
    const value = await inTransaction(this.db, (tx) => this.numbering.next(tx, 'PROBE', '2026'));
    if (body.note === 'fail') throw new AppError('CONFLICT', 'probe failure');
    return { value, note: body.note ?? null };
  }
}

describe('branches, warehouses, settings, audit and idempotency', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let adminToken: string;
  let workerToken: string;
  let accountantToken: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp({ controllers: [IdempotentProbe], imports: [IdentityModule] });
    sql = await connectAs('app');
    adminToken = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    workerToken = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    accountantToken = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] })))
      .accessToken;
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  describe('branches and warehouses', () => {
    it('lets every staff member read and only org managers write', async () => {
      const created = await http()
        .post('/api/v1/branches')
        .set(bearer(adminToken))
        .send({ code: ' hq ', name: ' Бөөний төв ', branchNo: '001', districtCode: '2301' })
        .expect(201);
      const branch = created.body as { id: number; code: string; name: string };
      expect(branch).toMatchObject({ code: 'HQ', name: 'Бөөний төв' });
      await http()
        .post('/api/v1/branches')
        .set(bearer(workerToken))
        .send({ code: 'X', name: 'Х' })
        .expect(403);
      const listed = await http().get('/api/v1/branches').set(bearer(workerToken)).expect(200);
      expect(listed.body).toMatchObject({ data: [{ code: 'HQ' }], nextCursor: null });
      await http()
        .post('/api/v1/branches')
        .set(bearer(adminToken))
        .send({ code: 'HQ', name: 'Давхар' })
        .expect(409);
      await http()
        .post('/api/v1/branches')
        .set(bearer(adminToken))
        .send({ code: 'B2', name: 'Салбар', branchNo: '12' })
        .expect(422);

      const warehouse = await http()
        .post('/api/v1/warehouses')
        .set(bearer(adminToken))
        .send({ code: 'wh-1', name: 'Төв агуулах', kind: 'WHOLESALE', branchId: branch.id })
        .expect(201);
      expect(warehouse.body).toMatchObject({
        code: 'WH-1',
        kind: 'WHOLESALE',
        branchId: branch.id,
      });
      for (const kind of ['TRANSIT', 'VEHICLE']) {
        const refused = await http()
          .post('/api/v1/warehouses')
          .set(bearer(adminToken))
          .send({ code: `K-${kind}`, name: 'Х', kind, branchId: branch.id })
          .expect(422);
        expect(refused.body).toMatchObject({ code: 'WAREHOUSE_KIND_NOT_ALLOWED' });
      }
      const all = await http().get('/api/v1/warehouses').set(bearer(workerToken)).expect(200);
      expect((all.body as { data: { kind: string }[] }).data.map((w) => w.kind).sort()).toEqual([
        'TRANSIT',
        'WHOLESALE',
      ]);
      const transitOnly = await http()
        .get('/api/v1/warehouses?kind=TRANSIT')
        .set(bearer(workerToken))
        .expect(200);
      const transit = (transitOnly.body as { data: { id: number }[] }).data[0];
      await http()
        .patch(`/api/v1/warehouses/${transit?.id ?? 0}`)
        .set(bearer(adminToken))
        .send({ name: 'Өөр' })
        .expect(422);
      const renamed = await http()
        .patch(`/api/v1/branches/${branch.id}`)
        .set(bearer(adminToken))
        .send({ name: 'Төв салбар', status: 'INACTIVE' })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'Төв салбар', status: 'INACTIVE' });
    });
  });

  describe('settings', () => {
    it('is readable by accountants, writable by admins only (SPEC §5.1)', async () => {
      const today = businessDate();
      const refused = await http()
        .post('/api/v1/settings')
        .set(bearer(workerToken))
        .send({ key: 'tax.vat_rate_pct', value: '10', effectiveFrom: today })
        .expect(403);
      expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
      await http()
        .post('/api/v1/settings')
        .set(bearer(accountantToken))
        .send({ key: 'tax.vat_rate_pct', value: '10', effectiveFrom: today })
        .expect(403);
      const created = await http()
        .post('/api/v1/settings')
        .set(bearer(adminToken))
        .send({ key: 'tax.vat_rate_pct', value: '10', effectiveFrom: '2026-01-01' })
        .expect(201);
      expect(created.body).toMatchObject({ key: 'tax.vat_rate_pct', value: '10' });
      const future = await http()
        .post('/api/v1/settings')
        .set(bearer(adminToken))
        .send({ key: 'auth.staff_session_hours', value: 8, effectiveFrom: addDays(today, 7) })
        .expect(201);
      const listed = await http().get('/api/v1/settings').set(bearer(accountantToken)).expect(200);
      const views = (listed.body as { data: { key: string; current: unknown }[] }).data;
      expect(views.find((v) => v.key === 'tax.vat_rate_pct')?.current).toBe('10');
      expect(views.find((v) => v.key === 'auth.staff_session_hours')?.current).toBe(12);
      expect(views.find((v) => v.key === 'tax.city_tax_rate_pct')?.current).toBeNull();
      await http()
        .post('/api/v1/settings')
        .set(bearer(adminToken))
        .send({ key: 'tax.vat_rate_pct', value: 'ten', effectiveFrom: today })
        .expect(422);
      await http()
        .post('/api/v1/settings')
        .set(bearer(adminToken))
        .send({ key: 'tax.vat_rate_pct', value: '9', effectiveFrom: '2026-02-01' })
        .expect(409);
      await http()
        .delete(`/api/v1/settings/${(future.body as { id: number }).id}`)
        .set(bearer(adminToken))
        .expect(204);
      await http()
        .delete(`/api/v1/settings/${(created.body as { id: number }).id}`)
        .set(bearer(adminToken))
        .expect(409);
    });

    it('applies the session length setting to new logins', async () => {
      await http()
        .post('/api/v1/settings')
        .set(bearer(adminToken))
        .send({ key: 'auth.staff_session_hours', value: 2, effectiveFrom: businessDate() })
        .expect(201);
      const user = await seedUser(app);
      const { response } = await login(app, user);
      const sessionEnd = Date.parse(
        (response.body as { sessionExpiresAt: string }).sessionExpiresAt,
      );
      expect(sessionEnd - Date.now()).toBeGreaterThan(2 * 3600_000 - 60_000);
      // The end comes from the database clock, which may run a little ahead of ours.
      expect(sessionEnd - Date.now()).toBeLessThanOrEqual(2 * 3600_000 + 5_000);
    });
  });

  describe('audit', () => {
    it('shows who changed what, newest first, to auditors only', async () => {
      await http().get('/api/v1/audit').set(bearer(workerToken)).expect(403);
      const page = await http()
        .get('/api/v1/audit?entity=branches&limit=1')
        .set(bearer(accountantToken))
        .expect(200);
      const body = page.body as {
        data: { action: string; entity: string; actorUsername: string; after: unknown }[];
        nextCursor: string | null;
      };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ action: 'UPDATE', entity: 'branches' });
      expect(body.data[0]?.actorUsername).toEqual(expect.any(String));
      expect(body.nextCursor).toEqual(expect.any(String));
      const older = await http()
        .get(`/api/v1/audit?entity=branches&limit=1&cursor=${body.nextCursor ?? ''}`)
        .set(bearer(accountantToken))
        .expect(200);
      expect((older.body as { data: { action: string }[] }).data[0]?.action).toBe('CREATE');
      const today = businessDate();
      const dated = await http()
        .get(`/api/v1/audit?entity=branches&from=${today}&to=${today}`)
        .set(bearer(accountantToken))
        .expect(200);
      expect((dated.body as { data: unknown[] }).data.length).toBeGreaterThanOrEqual(2);
      const tomorrow = await http()
        .get(`/api/v1/audit?entity=branches&from=${addDays(today, 1)}`)
        .set(bearer(accountantToken))
        .expect(200);
      expect((tomorrow.body as { data: unknown[] }).data).toHaveLength(0);
    });
  });

  describe('Idempotency-Key', () => {
    const post = (key: string | undefined, body: Record<string, string>, token = adminToken) => {
      const call = http().post('/api/v1/probe-documents').set(bearer(token));
      return (key ? call.set('Idempotency-Key', key) : call).send(body);
    };
    const counter = async () => {
      const { rows } = await sql.query<{ last_value: string }>(
        `SELECT last_value::text FROM number_sequences WHERE scope_key = 'PROBE'`,
      );
      return rows[0]?.last_value ?? '0';
    };

    it('requires a UUID key', async () => {
      const missing = await post(undefined, {}).expect(400);
      expect(missing.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
      await post('not-a-uuid', {}).expect(400);
    });

    it('replays the stored response for a retry and runs the handler once', async () => {
      const key = crypto.randomUUID();
      const first = await post(key, { note: 'a' }).expect(201);
      const before = await counter();
      const retry = await post(key, { note: 'a' }).expect(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(await counter()).toBe(before);
      const reused = await post(key, { note: 'b' }).expect(409);
      expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      // Keys belong to their user: the same UUID from someone else is a new request.
      await post(key, { note: 'a' }, workerToken).expect(201);
    });

    it('frees the key when the handler fails, so the client may retry', async () => {
      const key = crypto.randomUUID();
      await post(key, { note: 'fail' }).expect(409);
      await post(key, { note: 'fail' }).expect(409);
      const { rows } = await sql.query(`SELECT 1 FROM idempotency_keys WHERE key = $1`, [key]);
      expect(rows).toHaveLength(0);
    });
  });
});
