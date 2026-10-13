import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface CategoryJson {
  id: number;
  name: string;
  skuFrom: string | null;
  skuTo: string | null;
}

/** Code ranges of categories (ADR-0044 #1): suggestions, typed codes and the laminar rule. */
describe('category code ranges', () => {
  let app: NestExpressApplication;
  let admin: string;
  let pcs: number;
  let food: CategoryJson;
  let flour: CategoryJson;
  let rice: CategoryJson;
  let drinks: CategoryJson;
  let other: CategoryJson;
  const http = () => request(app.getHttpServer());

  const createCategory = (body: Record<string, unknown>) =>
    http().post('/api/v1/categories').set(bearer(admin)).send(body);
  const category = async (body: Record<string, unknown>) =>
    (await createCategory(body).expect(201)).body as CategoryJson;
  const nextSku = async (categoryId: number) =>
    (
      (
        await http()
          .get('/api/v1/products/next-sku')
          .query({ categoryId })
          .set(bearer(admin))
          .expect(200)
      ).body as { sku: string }
    ).sku;
  const createProduct = (categoryId: number, sku?: string) =>
    http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({
        name: `Бараа ${sku ?? 'шинэ'}`,
        categoryId,
        baseUomId: pcs,
        ...(sku ? { sku } : {}),
      });

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    pcs = await catalogApi(app, admin).uomId('PCS');
    // Хүнс 20000–29999 with Гурил's own block inside and Будаа using Хүнс's; Ундаа 10000–19999;
    // Бусад without any range.
    food = await category({ name: 'Хүнс', skuFrom: '20000', skuTo: '29999' });
    flour = await category({ name: 'Гурил', parentId: food.id, skuFrom: '21000', skuTo: '21999' });
    rice = await category({ name: 'Будаа', parentId: food.id });
    drinks = await category({ name: 'Ундаа', skuFrom: '10000', skuTo: '19999' });
    other = await category({ name: 'Бусад' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps ranges laminar: nested only down the tree, both ends, in order', async () => {
    expect(flour).toMatchObject({ skuFrom: '21000', skuTo: '21999' });
    expect(rice).toMatchObject({ skuFrom: null, skuTo: null });
    const sibling = await createCategory({ name: 'Хуучин', skuFrom: '19000', skuTo: '20500' });
    expect(sibling.status).toBe(409);
    expect(sibling.body).toMatchObject({ code: 'SKU_RANGE_OVERLAP' });
    // A root category's block inside Хүнс's range is not under Хүнс.
    const stranger = await createCategory({ name: 'Гадны', skuFrom: '22000', skuTo: '22999' });
    expect(stranger.status).toBe(409);
    expect(stranger.body).toMatchObject({ params: { category: 'Хүнс' } });
    await createCategory({ name: 'Хагас', skuFrom: '30000' }).expect(422);
    await createCategory({ name: 'Урвуу', skuFrom: '39999', skuTo: '30000' }).expect(422);
    // Moving Гурил to the root would leave its block inside Хүнс's: refused.
    const move = await http()
      .patch(`/api/v1/categories/${flour.id}`)
      .set(bearer(admin))
      .send({ parentId: null })
      .expect(409);
    expect(move.body).toMatchObject({ code: 'SKU_RANGE_OVERLAP', params: { category: 'Хүнс' } });
  });

  it('suggests codes from the range, skipping subcategories, and checks typed ones', async () => {
    expect(await nextSku(rice.id)).toBe('20000');
    expect(await nextSku(flour.id)).toBe('21000');
    expect(await nextSku(drinks.id)).toBe('10000');
    const auto = await createProduct(rice.id).expect(201);
    expect(auto.body).toMatchObject({ sku: '20000' });
    await createProduct(rice.id, '20999').expect(201);
    // Past 20999 comes Гурил's block: Будаа's next code is 22000.
    expect(await nextSku(rice.id)).toBe('22000');

    const outside = await createProduct(flour.id, '20500').expect(422);
    expect(outside.body).toMatchObject({
      code: 'SKU_OUT_OF_RANGE',
      params: { from: '21000', to: '21999' },
    });
    const reserved = await createProduct(rice.id, '21500').expect(422);
    expect(reserved.body).toMatchObject({ code: 'SKU_RESERVED', params: { category: 'Гурил' } });
    // A category without a range keeps out of every range.
    expect((await createProduct(other.id, '15000').expect(422)).body).toMatchObject({
      code: 'SKU_RESERVED',
      params: { category: 'Ундаа' },
    });
    await createProduct(other.id, '30000').expect(201);
    expect(await nextSku(other.id)).toBe('30001');
  });

  it('checks a changed code only, fills gaps and says when a range is full', async () => {
    const old = (await createProduct(other.id, '35000').expect(201)).body as { id: number };
    const shelf = await category({ name: 'Тавиурын бараа', skuFrom: '50000', skuTo: '50002' });
    await http()
      .patch(`/api/v1/products/${old.id}`)
      .set(bearer(admin))
      .send({ categoryId: shelf.id, name: 'Хуучин код' })
      .expect(200);
    const moved = await http()
      .patch(`/api/v1/products/${old.id}`)
      .set(bearer(admin))
      .send({ sku: '35001' })
      .expect(422);
    expect(moved.body).toMatchObject({ code: 'SKU_OUT_OF_RANGE' });
    await http()
      .patch(`/api/v1/products/${old.id}`)
      .set(bearer(admin))
      .send({ sku: '50002' })
      .expect(200);
    // 50002 is the end: the lowest free code comes next, then the range is full.
    expect(await nextSku(shelf.id)).toBe('50000');
    await createProduct(shelf.id).expect(201);
    await createProduct(shelf.id).expect(201);
    const full = await http()
      .get('/api/v1/products/next-sku')
      .query({ categoryId: shelf.id })
      .set(bearer(admin))
      .expect(409);
    expect(full.body).toMatchObject({
      code: 'SKU_RANGE_FULL',
      params: { from: '50000', to: '50002' },
    });
  });
});
