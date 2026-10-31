import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { type AppStore, appStore } from '../harness/customer-app';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { pricingApi } from '../harness/pricing';

interface ShopProductJson {
  id: number;
  name: string;
  stock: string;
  favourite: boolean;
  basePrice: string | null;
  units: { id: number; uomCode: string | null; wholesale: string | null }[];
  [key: string]: unknown;
}

interface ShopPageJson {
  data: ShopProductJson[];
  nextCursor: string | null;
  total: number | null;
  favouriteCount: number | null;
}

/** «Бараа» in «Bto300» (ADR-0079 #4): words instead of numbers, ★, the scanner, the quote. */
describe('customer app shop (ADR-0079)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let store: AppStore;
  let plenty: ProductJson;
  let fewLoose: ProductJson;
  let boxed: ProductJson;
  let belowMin: ProductJson;
  let empty: ProductJson;
  let homeless: ProductJson;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const inventory = inventoryApi(app, admin);
    const pricing = pricingApi(app, admin);
    const wh = await inventory.warehouse('CAS1');
    const shelf = await inventory.bin(wh.id, 'A-01-01');
    const category = await catalog.category('Аппын бараа');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    const profile = await pricing.profile('Аппын үнэ');
    const auth = bearer(admin);
    const stock = async (product: ProductJson, qty: string) => {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(auth)
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          reason: 'SURPLUS',
          lines: [
            {
              productUnitId: unitOf(product, 'PCS').id,
              enteredQty: qty,
              binId: shelf.id,
              unitCost: '700',
            },
          ],
        })
        .expect(201);
      const id = (created.body as { id: number }).id;
      await http().post(`/api/v1/adjustments/${id}/submit`).set(auth).expect(200);
      await http()
        .post(`/api/v1/adjustments/${id}/post`)
        .set(auth)
        .set(idempotency())
        .send({})
        .expect(200);
    };
    const make = async (
      sku: string,
      name: string,
      options: { qty?: string; box?: boolean; home?: boolean; barcode?: string },
    ) => {
      const product = await catalog.product({
        sku,
        name,
        categoryId: category,
        baseUomId: pcs,
        // A product with a pack prices it whole (ADR-0048): one pack is the «Цөөхөн» line.
        units: options.box
          ? [
              {
                uomId: box,
                factorToBase: '12',
                ...(options.barcode ? { barcodes: [options.barcode] } : {}),
              },
            ]
          : [],
      });
      if (options.home !== false) await inventory.setHome(product.id, wh.id);
      await pricing.terms(product.id, '1200', profile, options.box ? box : null);
      await http()
        .post('/api/v1/pricing/sale-ready')
        .set(auth)
        .set(idempotency())
        .send({ productIds: [product.id] })
        .expect(200);
      if (options.qty) await stock(product, options.qty);
      return product;
    };
    plenty = await make('9201', 'Элбэг', { qty: '40', box: true });
    fewLoose = await make('9202', 'Цөөн задгай', { qty: '9' });
    boxed = await make('9203', 'Хайрцагтай', { qty: '11', box: true, barcode: 'BX-92030' });
    belowMin = await make('9204', 'Доод хэмжээтэй', { qty: '30', box: true });
    await http()
      .put('/api/v1/product-locations')
      .set(auth)
      .send({ warehouseId: wh.id, productId: belowMin.id, minQty: '50', maxQty: '100' })
      .expect(200);
    empty = await make('9205', 'Дууссан бараа', {});
    homeless = await make('9206', 'Гэргүй', { home: false });
    store = await appStore(app, office);
  });
  afterAll(async () => {
    await app.close();
  });

  const page = async (query = '') =>
    (await store.api.get(`/products${query}`).expect(200)).body as ShopPageJson;

  it('shows the stock in three words and never the number', async () => {
    const listed = await page('?limit=50');
    const word = (product: ProductJson) => listed.data.find((row) => row.id === product.id)?.stock;
    expect(word(plenty)).toBe('IN');
    expect(word(fewLoose)).toBe('LOW');
    expect(word(boxed)).toBe('LOW');
    expect(word(belowMin)).toBe('LOW');
    expect(word(empty)).toBe('OUT');
    // A product without a home warehouse is not on sale in the app.
    expect(listed.data.some((row) => row.id === homeless.id)).toBe(false);
    for (const row of listed.data) {
      expect(row).not.toHaveProperty('available');
      expect(row).not.toHaveProperty('minLevel');
      expect(row).not.toHaveProperty('packBase');
    }
    expect(listed.data.find((row) => row.id === plenty.id)?.units[0]?.wholesale).toEqual(
      expect.any(String),
    );
    const batch = (
      await store.api.get(`/products/batch?productIds=${plenty.id},${homeless.id}`).expect(200)
    ).body as ShopProductJson[];
    expect(batch.map((row) => row.id)).toEqual([plenty.id]);
  });

  it('keeps the store’s stars on the server and filters by them', async () => {
    await store.api.put(`/favourites/${boxed.id}`).expect(204);
    await store.api.put(`/favourites/${boxed.id}`).expect(204);
    await store.api.put(`/favourites/${plenty.id}`).expect(204);
    await store.api.put(`/favourites/${homeless.id}`).expect(404);
    await store.api.put('/favourites/999999').expect(404);
    expect((await store.api.get('/favourites').expect(200)).body).toEqual({
      productIds: [plenty.id, boxed.id],
    });
    const starred = await page('?favourites=true');
    expect(starred.data.map((row) => row.id).sort()).toEqual([plenty.id, boxed.id].sort());
    expect(starred.data.every((row) => row.favourite)).toBe(true);
    expect(starred.favouriteCount).toBe(2);
    await store.api.delete(`/favourites/${plenty.id}`).expect(204);
    expect((await page()).favouriteCount).toBe(1);
  });

  it('opens a scanned box barcode on the box unit', async () => {
    const found = (await store.api.get('/barcodes/BX-92030').expect(200)).body as {
      productUnitId: number;
      product: ShopProductJson;
    };
    expect(found.product.id).toBe(boxed.id);
    expect(found.productUnitId).toBe(unitOf(boxed, 'BOX').id);
    await store.api.get('/barcodes/NOPE-1').expect(404);
  });

  it('prices the cart on the server and says when a quantity may wait for stock', async () => {
    const quoted = (
      await store.api
        .post('/quote', {
          lines: [
            { productUnitId: unitOf(plenty, 'PCS').id, qty: '10' },
            { productUnitId: unitOf(fewLoose, 'PCS').id, qty: '12' },
          ],
        })
        .expect(200)
    ).body as {
      quote: { list: string; total: string; lines: { productId: number }[] };
      stock: { productUnitId: number; stock: string; mayBackorder: boolean }[];
    };
    expect(quoted.quote.list).toBe('WHOLESALE');
    expect(quoted.stock).toEqual([
      { productUnitId: unitOf(plenty, 'PCS').id, stock: 'IN', mayBackorder: false },
      { productUnitId: unitOf(fewLoose, 'PCS').id, stock: 'LOW', mayBackorder: true },
    ]);
    await store.api.post('/quote', { lines: [] }).expect(422);
  });

  it('lists the categories and the thumbnails, and keeps staff tokens out', async () => {
    const categories = (await store.api.get('/categories').expect(200)).body as { name: string }[];
    expect(categories.map((row) => row.name)).toContain('Аппын бараа');
    expect((await store.api.get('/thumbs').expect(200)).body).toEqual({ urls: expect.any(Array) });
    await http().get('/api/v1/customer-app/products').set(bearer(admin)).expect(403);
    await http().get('/api/v1/customer-app/products').expect(401);
  });

  it('sells only the assortment segment’s products once the office picks one (ADR-0127 #1)', async () => {
    const settingsOf = async (token = admin) =>
      (await http().get('/api/v1/app-settings').set(bearer(token)).expect(200)).body as {
        assortmentSegmentId: number | null;
        assortment: { segmentId: number | null; segmentName: string | null; broken: boolean };
        shopProductCount: number;
        homeSections: Record<string, boolean>;
        minOrderAmount: string | null;
        appName: string | null;
        appColor: string | null;
      };
    const save = (body: Record<string, unknown>, token = admin) =>
      http()
        .put('/api/v1/app-settings')
        .set(bearer(token))
        .send({
          assortmentSegmentId: null,
          homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: true },
          minOrderAmount: null,
          appName: null,
          appColor: null,
          ...body,
        });
    const before = await settingsOf();
    expect(before).toMatchObject({
      assortmentSegmentId: null,
      assortment: { segmentId: null, broken: false },
      minOrderAmount: null,
      appName: null,
    });
    expect(before.shopProductCount).toBeGreaterThanOrEqual(5);
    // Only the home's keepers (customer.home.manage) read and change the apps' settings.
    const clerk = await customRoleUser(app, admin, ['identity.settings.read']);
    await http().get('/api/v1/app-settings').set(bearer(clerk)).expect(403);
    await save({ appName: 'Бто' }, clerk).expect(403);
    await save({ appColor: 'blue' }).expect(422);
    await save({ assortmentSegmentId: 999_999 }).expect(422);
    const segment = (
      await http()
        .post('/api/v1/segments/lists')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Аппын нэр төрөл', productIds: [plenty.id, boxed.id, homeless.id] })
        .expect(201)
    ).body as { id: number };
    const saved = (
      await save({
        assortmentSegmentId: segment.id,
        appName: 'Bto дэлгүүр',
        appColor: '#0A84FF',
      }).expect(200)
    ).body as Awaited<ReturnType<typeof settingsOf>>;
    expect(saved).toMatchObject({
      assortmentSegmentId: segment.id,
      assortment: { segmentId: segment.id, segmentName: 'Аппын нэр төрөл', broken: false },
      // The homeless product is in the segment but not in the shop.
      shopProductCount: 2,
      appName: 'Bto дэлгүүр',
      appColor: '#0A84FF',
    });
    const listed = await page('?limit=50');
    expect(listed.data.map((row) => row.id).sort()).toEqual([plenty.id, boxed.id].sort());
    const batch = (
      await store.api
        .get(`/products/batch?productIds=${plenty.id},${fewLoose.id},${boxed.id}`)
        .expect(200)
    ).body as ShopProductJson[];
    expect(batch.map((row) => row.id).sort()).toEqual([plenty.id, boxed.id].sort());
    await store.api.get('/barcodes/BX-92030').expect(200);
    await store.api.put(`/favourites/${fewLoose.id}`).expect(404);
    await store.api.put(`/favourites/${boxed.id}`).expect(204);
    // Before a token: the apps' sign-in screens read the name and colour.
    expect((await http().get('/api/v1/app-settings/branding').expect(200)).body).toEqual({
      appName: 'Bto дэлгүүр',
      appColor: '#0A84FF',
    });
    expect((await store.api.get('/me').expect(200)).body).toMatchObject({
      appName: 'Bto дэлгүүр',
      appColor: '#0A84FF',
      minOrderAmount: null,
    });
    // The segment archived: nothing narrows the shop until the office picks another.
    await http().delete(`/api/v1/segments/${segment.id}`).set(bearer(admin)).expect(204);
    const broken = await settingsOf();
    expect(broken.assortment).toEqual({ segmentId: null, segmentName: null, broken: true });
    expect(broken.assortmentSegmentId).toBe(segment.id);
    expect((await page('?limit=50')).data.some((row) => row.id === fewLoose.id)).toBe(true);
    await save({}).expect(200);
    expect((await settingsOf()).assortment.broken).toBe(false);
  });
});
