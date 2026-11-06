import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface PageJson {
  data: { sku: string }[];
  nextCursor: string | null;
  total: number | null;
}

/** The product list by category (owner 2026-11-06): the blocks' order, whole across its pages. */
describe('product list by category', () => {
  let app: NestExpressApplication;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const page = async (body: object) =>
    (
      await http()
        .post('/api/v1/products/query')
        .set(bearer(admin))
        .send({ q: '', ...body })
        .expect(200)
    ).body as PageJson;

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const pcs = await catalog.uomId('PCS');
    const later = await catalog.category('Ш-102 Архи');
    const first = await catalog.category('Ш-101 Дарс');
    const none = await catalog.category('Ш-Кодгүй');
    for (const [id, from, to] of [
      [later, '902000', '902999'],
      [first, '901000', '901999'],
    ] as const) {
      await http()
        .patch(`/api/v1/categories/${id}`)
        .set(bearer(admin))
        .send({ skuFrom: from, skuTo: to })
        .expect(200);
    }
    // Names against the order, so a sort by name would show.
    for (const [sku, name, categoryId] of [
      ['902001', 'А архи', later],
      ['902002', 'Б архи', later],
      ['901001', 'Я дарс', first],
      ['901002', 'Э дарс', first],
      ['903001', 'В кодгүй', none],
    ] as const) {
      await catalog.product({ sku, name, categoryId, baseUomId: pcs });
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('walks the categories by their blocks, then the codes, over every page', async () => {
    const skus: string[] = [];
    let cursor: string | null = null;
    do {
      const body: PageJson = await page({
        sort: 'CATEGORY',
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      skus.push(...body.data.map((row) => row.sku));
      cursor = body.nextCursor;
    } while (cursor);
    expect(skus).toEqual(['901001', '901002', '902001', '902002', '903001']);
  });

  it('stays by name unless asked, and refuses another sort or a foreign cursor', async () => {
    const byName = await page({});
    expect(byName.data.map((row) => row.sku)[0]).toBe('902001');
    await http()
      .post('/api/v1/products/query')
      .set(bearer(admin))
      .send({ q: '', sort: 'NEW' })
      .expect(422);
    const byNamePage = await page({ limit: 1 });
    await http()
      .post('/api/v1/products/query')
      .set(bearer(admin))
      .send({ q: '', sort: 'CATEGORY', cursor: byNamePage.nextCursor })
      .expect((response) => {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      });
  });
});
