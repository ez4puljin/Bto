import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { MAX_CATEGORY_DEPTH } from '../../src/modules/catalog/services/categories.service';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

describe('catalog masters: units of measure and categories', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('lists the system units to everyone and lets only the admin add, rename or delete custom ones', async () => {
    const listed = await http().get('/api/v1/uoms').set(bearer(worker)).expect(200);
    const codes = (listed.body as { data: { code: string | null }[] }).data.map((uom) => uom.code);
    expect(codes.slice(0, 4)).toEqual(['PCS', 'BLOCK', 'BOX', 'KG']);

    await http()
      .post('/api/v1/uoms')
      .set(bearer(worker))
      .send({ name: 'уут', fractional: false })
      .expect(403);
    const bag = await http()
      .post('/api/v1/uoms')
      .set(bearer(admin))
      .send({ name: 'уут', fractional: false })
      .expect(201);
    const twin = await http()
      .post('/api/v1/uoms')
      .set(bearer(admin))
      .send({ name: 'УУТ', fractional: true })
      .expect(409);
    expect(twin.body).toMatchObject({
      code: 'DUPLICATE_VALUE',
      params: { constraint: 'uoms_name_key_key' },
    });
    const renamed = await http()
      .patch(`/api/v1/uoms/${bag.body.id}`)
      .set(bearer(admin))
      .send({ name: 'Уут 25кг', measureUnit: 'уут' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: 'Уут 25кг',
      measureUnit: 'уут',
      fractional: false,
      code: null,
    });

    const pcs = await catalogApi(app, admin).uomId('PCS');
    const system = await http().delete(`/api/v1/uoms/${pcs}`).set(bearer(admin)).expect(409);
    expect(system.body).toMatchObject({ code: 'IN_USE', params: { resource: 'uoms' } });
    await http().delete(`/api/v1/uoms/${bag.body.id}`).set(bearer(admin)).expect(204);
  });

  it('keeps the category tree acyclic, unique per parent and at most eight levels deep', async () => {
    const api = catalogApi(app, admin);
    const drinks = await api.category('Ундаа');
    const soda = await api.category('Хийжүүлсэн ундаа', drinks);
    const cola = await api.category('Кола', soda);
    const twin = await http()
      .post('/api/v1/categories')
      .set(bearer(admin))
      .send({ name: 'ундаa' })
      .expect(409);
    expect(twin.body).toMatchObject({
      code: 'DUPLICATE_VALUE',
      params: { constraint: 'categories_sibling_name' },
    });
    await api.category('Кола', drinks);

    const cycle = await http()
      .patch(`/api/v1/categories/${drinks}`)
      .set(bearer(admin))
      .send({ parentId: cola })
      .expect(409);
    expect(cycle.body).toMatchObject({ code: 'CATEGORY_CYCLE' });
    const moved = await http()
      .patch(`/api/v1/categories/${soda}`)
      .set(bearer(admin))
      .send({ parentId: null })
      .expect(200);
    expect(moved.body).toMatchObject({ id: soda, parentId: null, childCount: 1 });

    const notEmpty = await http()
      .delete(`/api/v1/categories/${soda}`)
      .set(bearer(admin))
      .expect(409);
    expect(notEmpty.body.code).toBe('CATEGORY_NOT_EMPTY');
    await http().delete(`/api/v1/categories/${cola}`).set(bearer(admin)).expect(204);

    let parent = await api.category('Түвшин 1');
    for (let level = 2; level <= MAX_CATEGORY_DEPTH; level += 1) {
      parent = await api.category(`Түвшин ${level}`, parent);
    }
    const tooDeep = await http()
      .post('/api/v1/categories')
      .set(bearer(admin))
      .send({ name: 'Хэт гүн', parentId: parent })
      .expect(422);
    expect(tooDeep.body.errors).toEqual([
      expect.objectContaining({ path: 'parentId', constraint: 'maxDepth' }),
    ]);

    const tree = await http().get('/api/v1/categories').set(bearer(worker)).expect(200);
    expect((tree.body as { data: unknown[] }).data.length).toBeGreaterThan(MAX_CATEGORY_DEPTH);
    const { rows } = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_log WHERE entity = 'categories' AND action = 'CREATE'`,
    );
    expect(Number.parseInt(rows[0]?.count ?? '0', 10)).toBeGreaterThanOrEqual(
      4 + MAX_CATEGORY_DEPTH,
    );
  });

  it('has no brands any more (ADR-0043): no route, no column, no product field', async () => {
    const api = catalogApi(app, admin);
    await http().get('/api/v1/brands').set(bearer(admin)).expect(404);
    const { rows } = await sql.query<{ brands: string | null; column: string | null }>(
      `SELECT to_regclass('public.brands')::text AS brands,
              (SELECT column_name::text FROM information_schema.columns
                WHERE table_name = 'products' AND column_name = 'brand_id') AS column`,
    );
    expect(rows[0]).toEqual({ brands: null, column: null });
    const categoryId = await api.category('Брэндгүй');
    const baseUomId = await api.uomId('PCS');
    const refused = await http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({ name: 'Кока кола 0.5л', categoryId, baseUomId, brandId: 1 })
      .expect(422);
    expect(refused.body.code).toBe('VALIDATION_FAILED');
  });
});
