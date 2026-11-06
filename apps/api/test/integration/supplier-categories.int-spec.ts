import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface CategoryJson {
  id: number;
  parentId: number | null;
  name: string;
  path: string;
  depth: number;
  active: boolean;
  supplierCount: number;
}

interface SupplierJson {
  id: number;
  name: string;
  categoryId: number | null;
  categoryPath: string | null;
}

/**
 * Supplier categories (ADR-0161): a tree with a name unique among siblings, no circles, a retired
 * one leaving the pickers, the supplier's category and the list's filter over a whole branch.
 */
describe('supplier categories', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  const http = () => request(app.getHttpServer());
  const create = (body: Record<string, unknown>, token = admin) =>
    http().post('/api/v1/supplier-categories').set(bearer(token)).set(idempotency()).send(body);
  const patch = (id: number, body: Record<string, unknown>) =>
    http().patch(`/api/v1/supplier-categories/${id}`).set(bearer(admin)).send(body);
  const tree = async () =>
    (await http().get('/api/v1/supplier-categories').set(bearer(worker)).expect(200))
      .body as CategoryJson[];
  const make = async (name: string, parentId?: number) =>
    (await create({ name, ...(parentId ? { parentId } : {}) }).expect(201)).body as CategoryJson;
  const supplier = async (name: string, phone: string, categoryId?: number) =>
    (
      await http()
        .post('/api/v1/suppliers')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name, phone, ...(categoryId ? { categoryId } : {}) })
        .expect(201)
    ).body as SupplierJson;
  const namesIn = async (categoryId: number) =>
    (
      (await http().get('/api/v1/suppliers').query({ categoryId }).set(bearer(worker)).expect(200))
        .body as { data: SupplierJson[] }
    ).data.map((row) => row.name);

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

  it('keeps a tree: paths, depth, order, a name unique among its siblings', async () => {
    const food = await make('Хүнс');
    const dairy = await make('Сүүн бүтээгдэхүүн', food.id);
    const cheese = await make('Бяслаг', dairy.id);
    expect(cheese).toMatchObject({
      parentId: dairy.id,
      path: 'Хүнс / Сүүн бүтээгдэхүүн / Бяслаг',
      depth: 2,
    });
    const after = await make('Ахуйн бараа');
    const rows = await tree();
    // Parents before their children, whatever the order they were made in.
    expect(rows.map((row) => row.name)).toEqual([
      'Хүнс',
      'Сүүн бүтээгдэхүүн',
      'Бяслаг',
      'Ахуйн бараа',
    ]);
    const twin = await create({ name: ' хүнс ' }).expect(409);
    expect((twin.body as { code: string }).code).toBe('DUPLICATE_VALUE');
    // The same name elsewhere in the tree is fine.
    await make('Бяслаг', after.id);
    await create({ name: 'Эрхгүй' }, worker).expect(403);
    await create({ name: 'Эцэггүй', parentId: 999_999 }).expect(422);
  });

  it('moves a category but never below itself', async () => {
    const top = await make('Дээд');
    const middle = await make('Дунд', top.id);
    const low = await make('Доод', middle.id);
    const circle = (await patch(top.id, { parentId: low.id }).expect(422)).body as {
      errors: { path: string; constraint: string }[];
    };
    expect(circle.errors).toEqual([expect.objectContaining({ path: 'parentId' })]);
    await patch(top.id, { parentId: top.id }).expect(422);
    const moved = (await patch(low.id, { parentId: top.id }).expect(200)).body as CategoryJson;
    expect(moved).toMatchObject({ path: 'Дээд / Доод', depth: 1 });
    const root = (await patch(low.id, { parentId: null }).expect(200)).body as CategoryJson;
    expect(root).toMatchObject({ parentId: null, path: 'Доод', depth: 0 });
  });

  it('retires one only once nothing active sits below it', async () => {
    const parent = await make('Эцэг');
    const child = await make('Хүү', parent.id);
    const refused = await patch(parent.id, { active: false }).expect(409);
    expect((refused.body as { code: string }).code).toBe('SUPPLIER_CATEGORY_HAS_CHILDREN');
    await patch(child.id, { active: false }).expect(200);
    await patch(parent.id, { active: false }).expect(200);
    // A child cannot come back under a retired parent, or be made under one.
    const under = await patch(child.id, { active: true }).expect(409);
    expect((under.body as { code: string }).code).toBe('SUPPLIER_CATEGORY_INACTIVE');
    await create({ name: 'Шинэ', parentId: parent.id }).expect(409);
    await patch(parent.id, { active: true }).expect(200);
    await patch(child.id, { active: true }).expect(200);
    await http().get('/api/v1/supplier-categories').set(bearer(worker)).expect(200);
    const audit = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'supplier_categories' AND entity_id = $1 ORDER BY id`,
      [String(parent.id)],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
  });

  it('gives a supplier a category, and the list filters a whole branch', async () => {
    const drinks = await make('Ундаа');
    const water = await make('Ус', drinks.id);
    const home = await make('Гэр ахуй');
    const aqua = await supplier('Аква ХХК', '99110101', water.id);
    expect(aqua).toMatchObject({ categoryId: water.id, categoryPath: 'Ундаа / Ус' });
    await supplier('Ундаа ХХК', '99110102', drinks.id);
    await supplier('Саван ХХК', '99110103', home.id);
    const plain = await supplier('Ангилалгүй ХХК', '99110104');
    expect(plain).toMatchObject({ categoryId: null, categoryPath: null });

    expect((await namesIn(drinks.id)).sort()).toEqual(['Аква ХХК', 'Ундаа ХХК'].sort());
    expect(await namesIn(water.id)).toEqual(['Аква ХХК']);
    const rows = (
      (await http().get('/api/v1/suppliers').query({ q: 'Аква' }).set(bearer(worker)).expect(200))
        .body as { data: SupplierJson[] }
    ).data;
    expect(rows[0]).toMatchObject({ categoryId: water.id, categoryPath: 'Ундаа / Ус' });

    // A category counts what sits in it and below it.
    const counted = await tree();
    expect(counted.find((row) => row.id === drinks.id)?.supplierCount).toBe(2);
    expect(counted.find((row) => row.id === water.id)?.supplierCount).toBe(1);

    // Changed, cleared; an unrelated edit leaves it alone.
    const edit = (body: object) =>
      http().patch(`/api/v1/suppliers/${plain.id}`).set(bearer(admin)).send(body);
    await edit({ categoryId: home.id }).expect(200);
    await edit({ note: 'тэмдэглэл' }).expect(200);
    expect(((await edit({}).expect(200)).body as SupplierJson).categoryId).toBe(home.id);
    expect(((await edit({ categoryId: null }).expect(200)).body as SupplierJson).categoryId).toBe(
      null,
    );

    // A retired category refuses new suppliers; one already in it stays.
    const old = await make('Хуучин');
    const kept = await supplier('Хуучин ХХК', '99110105', old.id);
    await patch(old.id, { active: false }).expect(200);
    const refused = await http()
      .post('/api/v1/suppliers')
      .set(bearer(admin))
      .set(idempotency())
      .send({ name: 'Шинэ ХХК', phone: '99110106', categoryId: old.id })
      .expect(409);
    expect((refused.body as { code: string }).code).toBe('SUPPLIER_CATEGORY_INACTIVE');
    await http()
      .patch(`/api/v1/suppliers/${kept.id}`)
      .set(bearer(admin))
      .send({ categoryId: old.id, note: 'хэвээр' })
      .expect(200);
    await http()
      .post('/api/v1/suppliers')
      .set(bearer(admin))
      .set(idempotency())
      .send({ name: 'Алга ХХК', phone: '99110107', categoryId: 999_999 })
      .expect(422);
  });

  it('finds the suppliers of a product category, its whole branch (#7)', async () => {
    const catalog = catalogApi(app, admin);
    const pcs = await catalog.uomId('PCS');
    const flour = await catalog.category('Гурил будаа');
    const fine = await catalog.category('Нарийн гурил', flour);
    const sweets = await catalog.category('Амттан');
    const empty = await catalog.category('Хоосон');
    const product = (sku: string, name: string, categoryId: number) =>
      catalog.product({ sku, name, categoryId, baseUomId: pcs });
    const wheat = await product('9101', 'Улаан буудайн гурил', fine);
    const rice = await product('9102', 'Будаа', flour);
    const candy = await product('9103', 'Чихэр', sweets);
    const miller = await supplier('Тээрэм ХХК', '99220101');
    const confectioner = await supplier('Амттан ХХК', '99220102');
    const both = await supplier('Холимог ХХК', '99220103');
    await supplier('Бараагүй ХХК', '99220104');
    const link = (productId: number, supplierId: number) =>
      http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId, supplierId })
        .expect(201);
    await link(wheat.id, miller.id);
    await link(rice.id, miller.id);
    await link(candy.id, confectioner.id);
    await link(wheat.id, both.id);
    await link(candy.id, both.id);

    const counts = async (productCategoryId: number) =>
      new Map(
        (
          (
            await http()
              .get('/api/v1/suppliers')
              .query({ productCategoryId })
              .set(bearer(worker))
              .expect(200)
          ).body as { data: (SupplierJson & { productCount: number })[] }
        ).data.map((row) => [row.name, row.productCount]),
      );
    // The parent takes what is below it; the count is of that category alone.
    expect(await counts(flour)).toEqual(
      new Map([
        ['Тээрэм ХХК', 2],
        ['Холимог ХХК', 1],
      ]),
    );
    expect(await counts(fine)).toEqual(
      new Map([
        ['Тээрэм ХХК', 1],
        ['Холимог ХХК', 1],
      ]),
    );
    expect(await counts(sweets)).toEqual(
      new Map([
        ['Амттан ХХК', 1],
        ['Холимог ХХК', 1],
      ]),
    );
    expect(await counts(empty)).toEqual(new Map());

    // The brief list follows the same category and names each product's own.
    const products = async (id: number, query: object = {}) =>
      (
        (
          await http()
            .get(`/api/v1/suppliers/${id}/products`)
            .query(query)
            .set(bearer(worker))
            .expect(200)
        ).body as { data: { product: { name: string; categoryId: number } }[] }
      ).data.map((row) => row.product);
    expect((await products(both.id)).map((row) => row.name).sort()).toEqual(
      ['Улаан буудайн гурил', 'Чихэр'].sort(),
    );
    expect(await products(both.id, { productCategoryId: flour })).toEqual([
      expect.objectContaining({ name: 'Улаан буудайн гурил', categoryId: fine }),
    ]);
    expect(await products(both.id, { productCategoryId: empty })).toEqual([]);
  });
});
