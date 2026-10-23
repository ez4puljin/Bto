import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { type AppStore, appStore } from '../harness/customer-app';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { pricingApi } from '../harness/pricing';

interface RepCardJson {
  id: number;
  available: string;
  sellable: boolean;
  basePrice: string | null;
  dealPrice: string | null;
  deal: {
    kind: string;
    label: string;
    programName: string;
    scope: string;
    effect: string;
    value: string;
    threshold: { qty: string | null; unitName: string | null; amount: string | null } | null;
    lastDay: string | null;
  } | null;
}

interface SectionJson {
  key: string;
  kind: string;
  title: string | null;
  lastDay: string | null;
  total: number;
  products: RepCardJson[];
}

interface HomeJson {
  today: string;
  banners: { id: number; title: string }[];
  categories: { id: number; name: string; productCount: number }[];
  sections: SectionJson[];
}

interface SectionPageJson {
  key: string;
  kind: string;
  lastDay: string | null;
  data: RepCardJson[];
  nextCursor: string | null;
  total: number | null;
}

const MINUS = String.fromCharCode(0x2212);

/**
 * The rep app's home as «Bto300»'s shop window (the owner, 2026-10-23): the customer home's
 * banners, categories and sections without the store's RECENT and FAVOURITES, with the rep's card,
 * which now carries the deal badge and the struck-through price everywhere.
 */
describe('sales rep home (Bto300 shop window)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let rep: string;
  let office: string;
  let drinks: number;
  let food: number;
  let cola: ProductJson;
  let water: ProductJson;
  let bread: ProductJson;
  let homeless: ProductJson;
  let store: AppStore;
  let segmentId: number;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const get = async <T>(path: string, token = rep) =>
    (await http().get(`/api/v1/sales-rep${path}`).set(bearer(token)).expect(200)).body as T;
  const keys = (home: { sections: SectionJson[] }) => home.sections.map((own) => own.key);
  const section = (home: { sections: SectionJson[] }, key: string) => {
    const found = home.sections.find((own) => own.key === key);
    if (!found) throw new Error(`no section ${key}: ${keys(home).join(', ')}`);
    return found;
  };
  const card = (cards: readonly RepCardJson[], id: number) => {
    const found = cards.find((own) => own.id === id);
    if (!found) throw new Error(`no card ${id}`);
    return found;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    rep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const inventory = inventoryApi(app, admin);
    const pricing = pricingApi(app, admin);
    const wh = await inventory.warehouse('RH1');
    const shelf = await inventory.bin(wh.id, 'A-01-01');
    const profile = await pricing.profile('Төлөөлөгчийн нүүр');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    drinks = await catalog.category('Төлөөлөгчийн ундаа');
    const soda = await catalog.category('Төлөөлөгчийн газтай ундаа', drinks);
    food = await catalog.category('Төлөөлөгчийн хүнс');
    const make = async (
      sku: string,
      name: string,
      categoryId: number,
      options: { qty?: string; box?: boolean; home?: boolean },
    ) => {
      const product = await catalog.product({
        sku,
        name,
        categoryId,
        baseUomId: pcs,
        units: options.box ? [{ uomId: box, factorToBase: '12' }] : [],
      });
      if (options.home !== false) await inventory.setHome(product.id, wh.id);
      await pricing.terms(product.id, '1000', profile, options.box ? box : null);
      await http()
        .post('/api/v1/pricing/sale-ready')
        .set(bearer(admin))
        .set(idempotency())
        .send({ productIds: [product.id] })
        .expect(200);
      if (options.qty) {
        const created = await http()
          .post('/api/v1/adjustments')
          .set(bearer(admin))
          .set(idempotency())
          .send({
            warehouseId: wh.id,
            reason: 'SURPLUS',
            lines: [
              {
                productUnitId: unitOf(product, 'PCS').id,
                enteredQty: options.qty,
                binId: shelf.id,
                unitCost: '700',
              },
            ],
          })
          .expect(201);
        const id = (created.body as { id: number }).id;
        await http().post(`/api/v1/adjustments/${id}/submit`).set(bearer(admin)).expect(200);
        await http()
          .post(`/api/v1/adjustments/${id}/post`)
          .set(bearer(admin))
          .set(idempotency())
          .send({})
          .expect(200);
      }
      return product;
    };
    cola = await make('9751', 'Төлөөлөгч кола', soda, { qty: '40', box: true });
    water = await make('9752', 'Төлөөлөгч ус', drinks, {});
    bread = await make('9753', 'Төлөөлөгч талх', food, { qty: '30' });
    homeless = await make('9754', 'Төлөөлөгч гэргүй', food, { home: false, qty: '5' });
    const program = (body: Record<string, unknown>) =>
      http()
        .post('/api/v1/discount-programs')
        .set(bearer(admin))
        .set(idempotency())
        .send({ list: 'WHOLESALE', validFrom: today, ...body })
        .expect(201);
    // A discount with a condition: a badge, no struck price.
    await program({
      name: 'Төлөөлөгч колаг олноор',
      scope: 'PRODUCT',
      measure: 'QTY',
      effect: 'PERCENT',
      productId: cola.id,
      steps: [{ threshold: '10', value: '5' }],
    });
    // An unconditional promotion: 1,000₮ − 200₮ = 800₮ struck from 1,000₮.
    await program({
      name: 'Төлөөлөгч талх хямд',
      scope: 'PRODUCT',
      measure: 'QTY',
      effect: 'AMOUNT',
      productId: bread.id,
      productUnitId: unitOf(bread, 'PCS').id,
      validTo: addDays(today, 11),
      steps: [{ threshold: '0', value: '200' }],
    });
    const created = (
      await http()
        .post('/api/v1/segments/lists')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Төлөөлөгчийн сонголт', productIds: [water.id, bread.id] })
        .expect(201)
    ).body as { id: number };
    segmentId = created.id;
    await http()
      .put(`/api/v1/segments/${segmentId}/app`)
      .set(bearer(admin))
      .send({ shown: true })
      .expect(200);
    store = await appStore(app, office);
    // The store's own sections exist for the store: a ♡.
    await store.api.put(`/favourites/${cola.id}`).expect(204);
  });
  afterAll(async () => {
    await app.close();
  });

  it('carries the deal badge and the struck-through price on the rep shop and batch', async () => {
    const page = (
      await http()
        .get('/api/v1/sales-rep/products')
        .query({ q: 'Төлөөлөгч' })
        .set(bearer(rep))
        .expect(200)
    ).body as { data: RepCardJson[] };
    const breadCard = card(page.data, bread.id);
    const lastDay = addDays(today, 10);
    expect(breadCard).toMatchObject({
      basePrice: '1000',
      dealPrice: '800',
      deal: {
        kind: 'PROMOTION',
        label: `${MINUS}200₮ · ${lastDay.slice(5, 7)}/${lastDay.slice(8, 10)}`,
        programName: 'Төлөөлөгч талх хямд',
        scope: 'PRODUCT',
        effect: 'AMOUNT',
        value: '200',
        threshold: null,
        lastDay,
      },
    });
    expect(card(page.data, cola.id)).toMatchObject({
      dealPrice: null,
      deal: {
        kind: 'DISCOUNT',
        label: `10+ ш ${MINUS}5%`,
        threshold: { qty: '10', unitName: expect.any(String) as string, amount: null },
        lastDay: null,
      },
    });
    expect(card(page.data, water.id)).toMatchObject({ deal: null, dealPrice: null });
    // The rep's shop also lists a product without a home warehouse (not sellable).
    expect(card(page.data, homeless.id)).toMatchObject({ sellable: false, deal: null });
    // The struck price is what a quote gives for one base unit.
    const quote = (
      await http()
        .post('/api/v1/pricing/quote')
        .set(bearer(admin))
        .send({ lines: [{ productUnitId: unitOf(bread, 'PCS').id, qty: '1' }] })
        .expect(200)
    ).body as { lines: { total: string | null }[] };
    const total = quote.lines[0]?.total;
    expect(total).not.toBeNull();
    expect(new Decimal(total ?? '0').eq(new Decimal(breadCard.dealPrice ?? '-1'))).toBe(true);
    // The batch (a cart refreshed, a notice) carries the same.
    const batch = (
      await http()
        .get('/api/v1/sales-rep/products/batch')
        .query({ productIds: `${bread.id},${water.id}` })
        .set(bearer(rep))
        .expect(200)
    ).body as RepCardJson[];
    expect(card(batch, bread.id)).toMatchObject({ dealPrice: '800', deal: { kind: 'PROMOTION' } });
    expect(card(batch, water.id)).toMatchObject({ dealPrice: null, deal: null });
  });

  it('shows «Bto300»s window without RECENT and FAVOURITES, the same sections as a store', async () => {
    const home = await get<HomeJson>('/home');
    expect(home.today).toBe(today);
    const order = keys(home);
    expect(order).not.toContain('recent');
    expect(order).not.toContain('favourites');
    // Fixed order: PROMOTIONS, the shown segments, DISCOUNTS, NEW.
    const at = (key: string) => order.indexOf(key);
    expect(at('promotions')).toBe(0);
    expect(at('promotions')).toBeLessThan(at(`segment-${segmentId}`));
    expect(at(`segment-${segmentId}`)).toBeLessThan(at('discounts'));
    expect(at('discounts')).toBeLessThan(at('new'));
    expect(order.at(-1)).toBe('new');
    // The rep's card: numbers and the badge, in every section.
    const promoted = card(section(home, 'promotions').products, bread.id);
    expect(promoted).toMatchObject({ available: '30', dealPrice: '800' });
    expect(promoted).not.toHaveProperty('stock');
    expect(promoted).not.toHaveProperty('favourite');
    expect(section(home, 'promotions').lastDay).toBe(addDays(today, 10));
    expect(card(section(home, 'discounts').products, cola.id).deal?.label).toBe(`10+ ш ${MINUS}5%`);
    expect(card(section(home, 'new').products, bread.id).dealPrice).toBe('800');
    expect(section(home, `segment-${segmentId}`)).toMatchObject({
      title: 'Төлөөлөгчийн сонголт',
      total: 2,
    });
    // «Дууссан» last: water has no stock.
    expect(section(home, `segment-${segmentId}`).products.map((own) => own.id)).toEqual([
      bread.id,
      water.id,
    ]);
    // The customer shop's universe: never a product without a home warehouse.
    for (const own of home.sections) {
      expect(own.products.map((product) => product.id)).not.toContain(homeless.id);
    }
    // The same window a store sees, less the store's own sections.
    // A store's cards differ (stock words, ♡); only the ids and totals are compared.
    const storeHome = (await store.api.get('/home').expect(200)).body as HomeJson;
    expect(keys(storeHome)).toContain('favourites');
    expect(keys(storeHome).filter((key) => key !== 'recent' && key !== 'favourites')).toEqual(
      order,
    );
    for (const own of home.sections) {
      const theirs = section(storeHome, own.key);
      expect(own.total).toBe(theirs.total);
      expect(own.products.map((product) => product.id)).toEqual(
        theirs.products.map((product) => product.id),
      );
    }
    expect(home.categories).toEqual(storeHome.categories);
    expect(home.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: drinks, productCount: 2 }),
        expect.objectContaining({ id: food, productCount: 1 }),
      ]),
    );
    expect(home.banners).toEqual(storeHome.banners);
  });

  it('opens a section list with sorts, filters and a cursor; RECENT and FAVOURITES are not found', async () => {
    const promotions = await get<SectionPageJson>('/sections/promotions/products');
    expect(promotions).toMatchObject({ key: 'promotions', kind: 'PROMOTIONS' });
    expect(card(promotions.data, bread.id)).toMatchObject({
      dealPrice: '800',
      deal: { kind: 'PROMOTION' },
    });
    const deals = await get<SectionPageJson>(
      `/sections/deals/products?categoryIds=${drinks}&sort=DEAL`,
    );
    expect(deals.data.map((own) => own.id)).toEqual([cola.id]);
    expect(deals.total).toBe(1);
    // Paged by one through the segment, «Дууссан» last.
    const first = await get<SectionPageJson>(`/sections/segment-${segmentId}/products?limit=1`);
    expect(first).toMatchObject({ total: 2 });
    expect(first.data.map((own) => own.id)).toEqual([bread.id]);
    const next = await get<SectionPageJson>(
      `/sections/segment-${segmentId}/products?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    expect(next).toMatchObject({ total: null, nextCursor: null });
    expect(next.data.map((own) => own.id)).toEqual([water.id]);
    const inStock = await get<SectionPageJson>(
      `/sections/segment-${segmentId}/products?inStock=true`,
    );
    expect(inStock.data.map((own) => own.id)).toEqual([bread.id]);
    for (const key of ['recent', 'favourites', 'popular']) {
      await http().get(`/api/v1/sales-rep/sections/${key}/products`).set(bearer(rep)).expect(404);
    }
  });

  it('opens a category page with the rep card', async () => {
    const page = await get<{
      category: { id: number; name: string };
      productCount: number;
      subcategories: { id: number; productCount: number }[];
      sections: SectionJson[];
    }>(`/categories/${food}/page`);
    expect(page.category).toMatchObject({ id: food, name: 'Төлөөлөгчийн хүнс' });
    expect(page.productCount).toBe(1);
    expect(keys(page)).toEqual(['new', 'deals']);
    expect(card(section(page, 'deals').products, bread.id)).toMatchObject({
      available: '30',
      dealPrice: '800',
    });
    await http().get('/api/v1/sales-rep/categories/999999/page').set(bearer(rep)).expect(404);
  });

  it('needs sales.orders.rep, and a store token never fits', async () => {
    for (const path of ['/home', '/sections/new/products', `/categories/${food}/page`]) {
      await http().get(`/api/v1/sales-rep${path}`).set(bearer(rep)).expect(200);
      await http().get(`/api/v1/sales-rep${path}`).set(bearer(office)).expect(403);
      await http().get(`/api/v1/sales-rep${path}`).set(bearer(store.token)).expect(403);
    }
    await http().get('/api/v1/customer-app/home').set(bearer(rep)).expect(403);
  });
});
