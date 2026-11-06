import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { repApi, repOrderBody } from '../harness/sales-rep';

/**
 * Which products the staff app shows whom (ADR-0164): settings of any number of product segments and
 * staff, a staff member seeing what all theirs hold and everything when none names them; «Апп →
 * Бараа»'s one segment narrows only «Bto300». Synthetic data.
 */
describe('the staff app’s products by setting', () => {
  let app: NestExpressApplication;
  let admin: string;
  let oneToken: string;
  let otherToken: string;
  let oneId: number;
  let otherId: number;
  let cola: ProductJson;
  let water: ProductJson;
  let juice: ProductJson;
  let shop: CustomerJson;
  let onlyCola: number;
  let onlyWater: number;
  const http = () => request(app.getHttpServer());
  const ROUTE = '/api/v1/app-settings/staff-assortments';

  const seesOf = async (token: string) =>
    (
      (await http().get('/api/v1/sales-rep/products').set(bearer(token)).expect(200)).body as {
        data: { id: number }[];
      }
    ).data
      .map((product) => product.id)
      .sort((a, b) => a - b);
  const sorted = (...products: ProductJson[]) =>
    products.map((product) => product.id).sort((a, b) => a - b);
  const listSegment = async (name: string, productIds: number[]) =>
    (
      (
        await http()
          .post('/api/v1/segments/lists')
          .set(bearer(admin))
          .set(idempotency())
          .send({ name, productIds })
          .expect(201)
      ).body as { id: number }
    ).id;
  const create = (body: Record<string, unknown>, token = admin) =>
    http().post(ROUTE).set(bearer(token)).set(idempotency()).send(body);

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const one = await seedUser(app, { roles: ['SALES_REP'] });
    const other = await seedUser(app, { roles: ['SALES_REP'] });
    oneId = one.id;
    otherId = other.id;
    oneToken = (await login(app, one)).accessToken;
    otherToken = (await login(app, other)).accessToken;
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('SA1');
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ажилтны барааны ангилал');
    const base = await catalog.uomId('PCS');
    const make = (sku: string, name: string) =>
      catalog.product({ sku, name, categoryId: category, baseUomId: base });
    cola = await make('7971', 'Кола');
    water = await make('7972', 'Ус');
    juice = await make('7973', 'Жүүс');
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Ажилтны үнэ');
    for (const product of [cola, water, juice]) {
      await inventory.setHome(product.id, wh.id);
      await pricing.terms(product.id, '1000', profile, null);
    }
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, water.id, juice.id] })
      .expect(200);
    shop = await partnersApi(app, admin).customer({ name: 'Ажилтны дэлгүүр', phone: '99113344' });
    onlyCola = await listSegment('Зөвхөн кола', [cola.id]);
    onlyWater = await listSegment('Зөвхөн ус', [water.id]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps a setting from the web only, and refuses what cannot narrow anything', async () => {
    await http().get(ROUTE).set(bearer(oneToken)).expect(403);
    await create({ title: 'Хориотой', segmentIds: [onlyCola], userIds: [oneId] }, oneToken).expect(
      403,
    );
    const refused = async (body: Record<string, unknown>) =>
      (await create(body).expect(422)).body as { code: string };
    await refused({ title: 'Сегментгүй', segmentIds: [], userIds: [oneId] });
    await refused({ title: 'Ажилтангүй', segmentIds: [onlyCola], userIds: [] });
    await refused({ title: '  ', segmentIds: [onlyCola], userIds: [oneId] });
    await refused({ title: 'Байхгүй сегмент', segmentIds: [999_999], userIds: [oneId] });
    await refused({ title: 'Байхгүй ажилтан', segmentIds: [onlyCola], userIds: [999_999] });
    expect((await http().get(ROUTE).set(bearer(admin)).expect(200)).body).toEqual({
      data: [],
      nextCursor: null,
    });
  });

  it('shows each staff member what all their settings hold, everything without one', async () => {
    expect(await seesOf(oneToken)).toEqual(sorted(cola, water, juice));
    const first = (
      await create({
        title: 'Кола',
        segmentIds: [onlyCola],
        userIds: [oneId],
      }).expect(201)
    ).body as { id: number; segments: { id: number; name: string }[]; users: { id: number }[] };
    expect(first.segments).toEqual([{ id: onlyCola, name: 'Зөвхөн кола' }]);
    expect(first.users.map((user) => user.id)).toEqual([oneId]);
    expect(await seesOf(oneToken)).toEqual(sorted(cola));
    // Nobody else moves.
    expect(await seesOf(otherToken)).toEqual(sorted(cola, water, juice));

    // Every read of the shop follows it.
    const batch = (
      await http()
        .get('/api/v1/sales-rep/products/batch')
        .query({ productIds: `${cola.id},${water.id}` })
        .set(bearer(oneToken))
        .expect(200)
    ).body as { id: number }[];
    expect(batch.map((product) => product.id)).toEqual([cola.id]);
    const home = (await http().get('/api/v1/sales-rep/home').set(bearer(oneToken)).expect(200))
      .body as { categories: { productCount: number }[] };
    expect(home.categories.map((category) => category.productCount)).toEqual([1]);
    const homeOfOther = (
      await http().get('/api/v1/sales-rep/home').set(bearer(otherToken)).expect(200)
    ).body as { categories: { productCount: number }[] };
    expect(homeOfOther.categories.map((category) => category.productCount)).toEqual([3]);

    // An order is refused outside them, and passes that check inside them (the stage is checked next).
    const rep = repApi(app, oneToken);
    const line = (product: ProductJson) => ({
      productUnitId: unitOf(product, 'PCS').id,
      qty: '1',
    });
    const outside = await rep.create(repOrderBody(999_999, shop.id, [line(water)])).expect(409);
    expect(outside.body).toMatchObject({
      code: 'PRODUCT_NOT_IN_APP',
      params: { productIds: String(water.id) },
    });
    const inside = await rep.create(repOrderBody(999_999, shop.id, [line(cola)]));
    expect(inside.status).not.toBe(409);

    // A second setting adds what its segments hold; two segments in one setting add too.
    const second = (
      await create({
        title: 'Ус',
        segmentIds: [onlyWater],
        userIds: [oneId, otherId],
      }).expect(201)
    ).body as { id: number };
    expect(await seesOf(oneToken)).toEqual(sorted(cola, water));
    expect(await seesOf(otherToken)).toEqual(sorted(water));
    const widened = (
      await http()
        .put(`${ROUTE}/${second.id}`)
        .set(bearer(admin))
        .send({ title: 'Ус ба кола', segmentIds: [onlyWater, onlyCola], userIds: [otherId] })
        .expect(200)
    ).body as { title: string; segments: unknown[]; users: { id: number }[] };
    expect(widened.title).toBe('Ус ба кола');
    expect(widened.segments).toHaveLength(2);
    expect(await seesOf(otherToken)).toEqual(sorted(cola, water));
    expect(await seesOf(oneToken)).toEqual(sorted(cola));

    // Taken away: the row stays for the audit, its staff widen at once, a repeat is 404.
    await http().delete(`${ROUTE}/${first.id}`).set(bearer(admin)).expect(204);
    await http().delete(`${ROUTE}/${first.id}`).set(bearer(admin)).expect(404);
    expect(await seesOf(oneToken)).toEqual(sorted(cola, water, juice));
    const rows = (await http().get(ROUTE).set(bearer(admin)).expect(200)).body as {
      data: { id: number }[];
    };
    expect(rows.data.map((row) => row.id)).toEqual([second.id]);
    await http().delete(`${ROUTE}/${second.id}`).set(bearer(admin)).expect(204);
  });

  it('lets an archived segment narrow nothing and says so', async () => {
    const soonGone = await listSegment('Удахгүй архивлагдах', [juice.id]);
    const setting = (
      await create({ title: 'Жүүс', segmentIds: [soonGone], userIds: [oneId] }).expect(201)
    ).body as { id: number };
    expect(await seesOf(oneToken)).toEqual(sorted(juice));
    await http().delete(`/api/v1/segments/${soonGone}`).set(bearer(admin)).expect(204);
    expect(await seesOf(oneToken)).toEqual(sorted(cola, water, juice));
    const rows = (await http().get(ROUTE).set(bearer(admin)).expect(200)).body as {
      data: { id: number; segments: unknown[]; goneSegmentCount: number }[];
    };
    expect(rows.data.find((row) => row.id === setting.id)).toMatchObject({
      segments: [],
      goneSegmentCount: 1,
    });
    await http().delete(`${ROUTE}/${setting.id}`).set(bearer(admin)).expect(204);
  });

  it('narrows the staff app by nothing else: «Апп → Бараа»’s segment is Bto300’s alone', async () => {
    const save = (assortmentSegmentId: number | null) =>
      http()
        .put('/api/v1/app-settings')
        .set(bearer(admin))
        .send({
          assortmentSegmentId,
          homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: true },
          minOrderAmount: null,
          appName: null,
          appColor: null,
        });
    await save(onlyWater).expect(200);
    expect(await seesOf(oneToken)).toEqual(sorted(cola, water, juice));
    const counted = (await http().get('/api/v1/app-settings').set(bearer(admin)).expect(200))
      .body as { shopProductCount: number };
    expect(counted.shopProductCount).toBe(1);
    await save(null).expect(200);
  });
});
