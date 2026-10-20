import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { type AppStore, appStore } from '../harness/customer-app';
import { salesFlow } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { pngBytes } from '../harness/notifications';
import { pricingApi } from '../harness/pricing';

interface CardJson {
  id: number;
  name: string;
  stock: string;
  basePrice: string | null;
  dealPrice: string | null;
  deal: { kind: string; label: string; lastDay: string | null } | null;
}

interface SectionJson {
  key: string;
  kind: string;
  title: string | null;
  subtitle: string | null;
  lastDay: string | null;
  total: number;
  products: CardJson[];
}

interface HomeJson {
  today: string;
  banners: {
    id: number;
    title: string;
    imageUrl: string | null;
    link: { kind: string; id: number } | null;
  }[];
  categories: { id: number; name: string; imageUrl: string | null; productCount: number }[];
  sections: SectionJson[];
}

interface SectionPageJson {
  key: string;
  data: CardJson[];
  nextCursor: string | null;
  total: number | null;
}

interface BannerJson {
  id: number;
  title: string;
  linkKind: string;
  linkId: number | null;
  linkBroken: boolean;
  state: string;
  position: number;
}

const MINUS = String.fromCharCode(0x2212);

/** «Bto300»'s home as a shop window (ADR-0092, ADR-0093). */
describe('customer app home (ADR-0092)', () => {
  let app: NestExpressApplication;
  let migrator: Client;
  let admin: string;
  let office: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let drinks: number;
  let soda: number;
  let food: number;
  let cola: ProductJson;
  let water: ProductJson;
  let bread: ProductJson;
  let homeless: ProductJson;
  let store: AppStore;
  let other: AppStore;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const homeOf = async (target: AppStore) =>
    (await target.api.get('/home').expect(200)).body as HomeJson;
  const kinds = (home: HomeJson) => home.sections.map((section) => section.key);
  const section = (home: HomeJson, key: string) => {
    const found = home.sections.find((own) => own.key === key);
    if (!found) throw new Error(`no section ${key}: ${kinds(home).join(', ')}`);
    return found;
  };
  const upload = async (kind: string): Promise<number> => {
    const bytes = pngBytes();
    const issued = (
      await http()
        .post('/api/v1/files/presign')
        .set(bearer(admin))
        .send({ kind, contentType: 'image/png', sizeBytes: bytes.length })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await http().put(issued.uploadUrl).set('Content-Type', 'image/png').send(bytes).expect(204);
    return issued.fileId;
  };
  const program = (body: Record<string, unknown>) =>
    http()
      .post('/api/v1/discount-programs')
      .set(bearer(admin))
      .set(idempotency())
      .send({ list: 'WHOLESALE', validFrom: today, ...body })
      .expect(201);
  const banner = async (body: Record<string, unknown>, status = 201): Promise<BannerJson> => {
    // The upload first: a supertest request opened before another one finishes loses its server.
    const imageFileId = await upload('customer.banner_image');
    const response = await http()
      .post('/api/v1/customer/banners')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        imageFileId,
        title: 'Ундааны долоо хоног',
        linkKind: 'NONE',
        validFrom: today,
        ...body,
      })
      .expect(status);
    return response.body as BannerJson;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    migrator = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    flow = await salesFlow(app, admin, 'HOME');
    const catalog = catalogApi(app, admin);
    const inventory = inventoryApi(app, admin);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Нүүрний үнэ');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    drinks = await catalog.category('Ус, ундаа');
    soda = await catalog.category('Газтай ундаа', drinks);
    food = await catalog.category('Хүнс');
    const make = async (
      sku: string,
      name: string,
      categoryId: number,
      options: { qty?: string; box?: boolean; home?: boolean; price?: string },
    ) => {
      const product = await catalog.product({
        sku,
        name,
        categoryId,
        baseUomId: pcs,
        units: options.box ? [{ uomId: box, factorToBase: '12' }] : [],
      });
      if (options.home !== false) await inventory.setHome(product.id, flow.wh.id);
      await pricing.terms(product.id, options.price ?? '1000', profile, options.box ? box : null);
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
            warehouseId: flow.wh.id,
            reason: 'SURPLUS',
            lines: [
              {
                productUnitId: unitOf(product, 'PCS').id,
                enteredQty: options.qty,
                binId: flow.shelf.id,
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
    cola = await make('9301', 'Кола', soda, { qty: '40', box: true });
    water = await make('9302', 'Ус', drinks, {});
    bread = await make('9303', 'Талх', food, { qty: '30' });
    homeless = await make('9304', 'Гэргүй', food, { home: false, qty: '5' });
    store = await appStore(app, office);
    other = await appStore(app, office);
  });
  afterAll(async () => {
    await migrator.end();
    await app.close();
  });

  it('shows only sections that hold products, «Дууссан» last, and the top categories', async () => {
    const home = await homeOf(store);
    // No programs, segments, orders or ♡ yet: only the new products.
    expect(kinds(home)).toEqual(['new']);
    const fresh = section(home, 'new');
    expect(fresh.total).toBe(3);
    expect(fresh.products.map((card) => card.id)).not.toContain(homeless.id);
    expect(fresh.products.at(-1)).toMatchObject({ id: water.id, stock: 'OUT' });
    expect(home.banners).toEqual([]);
    // By name: «Ус, ундаа» before «Хүнс».
    expect(home.categories).toEqual([
      expect.objectContaining({ id: drinks, productCount: 2 }),
      expect.objectContaining({ id: food, productCount: 1 }),
    ]);
    expect(home.today).toBe(today);
  });

  it('builds badges from the first step and puts a promotion before a discount', async () => {
    await program({
      name: 'Колаг олноор',
      scope: 'PRODUCT',
      measure: 'QTY',
      effect: 'PERCENT',
      productId: cola.id,
      steps: [{ threshold: '10', value: '5' }],
    });
    await program({
      name: 'Хүнсний долоо хоног',
      scope: 'CATEGORY',
      measure: 'AMOUNT',
      effect: 'PERCENT',
      categoryId: food,
      validTo: addDays(today, 11),
      steps: [{ threshold: '0', value: '10' }],
    });
    await program({
      name: 'Талх хямд',
      scope: 'PRODUCT',
      measure: 'QTY',
      effect: 'AMOUNT',
      productId: bread.id,
      productUnitId: unitOf(bread, 'PCS').id,
      steps: [{ threshold: '0', value: '200' }],
    });
    await program({
      name: 'Их захиалга',
      scope: 'ORDER',
      measure: 'AMOUNT',
      effect: 'PERCENT',
      steps: [{ threshold: '50000', value: '3' }],
    });
    const home = await homeOf(store);
    // ORDER programs make no section; bread is in both and shows as a promotion only.
    expect(kinds(home)).toEqual(['promotions', 'discounts', 'new']);
    const promotions = section(home, 'promotions');
    expect(promotions.products.map((card) => card.id)).toEqual([bread.id]);
    expect(promotions.lastDay).toBe(addDays(today, 10));
    const lastDay = addDays(today, 10);
    expect(promotions.products[0]?.deal).toMatchObject({
      kind: 'PROMOTION',
      label: `${MINUS}10% · ${lastDay.slice(5, 7)}/${lastDay.slice(8, 10)}`,
    });
    // Unconditional: 1,000₮ − 200₮ = 800₮, then 10% off: 720₮ struck from 1,000₮.
    expect(promotions.products[0]).toMatchObject({ basePrice: '1000', dealPrice: '720' });
    const discounts = section(home, 'discounts');
    expect(discounts.products.map((card) => card.id)).toEqual([cola.id]);
    // From 10 pieces: a condition, so no struck price.
    expect(discounts.products[0]).toMatchObject({
      deal: { kind: 'DISCOUNT', label: `10+ ш ${MINUS}5%` },
      dealPrice: null,
    });
    // The new section carries the same badges.
    expect(section(home, 'new').products.find((card) => card.id === cola.id)?.deal?.label).toBe(
      `10+ ш ${MINUS}5%`,
    );
    // The cart's hint: what the order still needs for the ORDER program.
    const quoted = (
      await store.api
        .post('/quote', { lines: [{ productUnitId: unitOf(cola, 'PCS').id, qty: '1' }] })
        .expect(200)
    ).body as { orderDeals: { name: string; reached: unknown; next: { missing: string } }[] };
    expect(quoted.orderDeals).toEqual([
      expect.objectContaining({
        name: 'Их захиалга',
        reached: null,
        next: expect.objectContaining({ threshold: '50000', value: '3' }),
      }),
    ]);
    expect(Number.parseInt(quoted.orderDeals[0]?.next.missing ?? '0', 10)).toBeGreaterThan(48_000);
    // The shop's chips.
    const deals = (await store.api.get('/products?deals=true').expect(200)).body as {
      data: CardJson[];
    };
    expect(deals.data.map((card) => card.id).sort()).toEqual([cola.id, bread.id].sort());
  });

  it('keeps every store to its own ♡ and orders', async () => {
    await store.api.put(`/favourites/${cola.id}`).expect(204);
    const draft = await flow.draft(store.customerId, [
      { productUnitId: flow.pcs(bread), qty: '2' },
    ]);
    expect(draft.id).toBeGreaterThan(0);
    const mine = await homeOf(store);
    expect(section(mine, 'favourites').products.map((card) => card.id)).toEqual([cola.id]);
    expect(section(mine, 'recent').products.map((card) => card.id)).toEqual([bread.id]);
    expect(kinds(mine)[0]).toBe('recent');
    const theirs = await homeOf(other);
    expect(kinds(theirs)).not.toContain('favourites');
    expect(kinds(theirs)).not.toContain('recent');
    const page = (await other.api.get('/sections/favourites/products').expect(200))
      .body as SectionPageJson;
    expect(page).toMatchObject({ data: [], total: 0, nextCursor: null });
  });

  it('shows a banner from its first day to its last, in order, and archived never', async () => {
    const running = await banner({ title: 'Одоо', validTo: addDays(today, 3) });
    const later = await banner({ title: 'Маргааш', validFrom: addDays(today, 1) });
    const linked = await banner({ title: 'Хүнс', linkKind: 'CATEGORY', linkId: food });
    expect(later.state).toBe('SCHEDULED');
    // An ended one (dates in the past cannot be typed: the migrator writes them).
    const ended = await banner({ title: 'Өнгөрсөн' });
    await migrator.query(
      'UPDATE app_banners SET valid_from = $2::date, valid_to = $3::date WHERE id = $1',
      [ended.id, addDays(today, -5), today],
    );
    let home = await homeOf(store);
    expect(home.banners.map((own) => own.title)).toEqual(['Одоо', 'Хүнс']);
    expect(home.banners[1]?.link).toEqual({ kind: 'CATEGORY', id: food });
    expect(home.banners[0]?.imageUrl).toMatch(/\/api\/v1\/files\/public\//);
    // Moved up past the scheduled one and the running one, then archived.
    for (let step = 0; step < 2; step += 1) {
      await http()
        .post(`/api/v1/customer/banners/${linked.id}/move`)
        .set(bearer(admin))
        .send({ direction: 'UP' })
        .expect(200);
    }
    home = await homeOf(store);
    expect(home.banners.map((own) => own.title)).toEqual(['Хүнс', 'Одоо']);
    await http()
      .post(`/api/v1/customer/banners/${running.id}/archive`)
      .set(bearer(admin))
      .expect(204);
    home = await homeOf(store);
    expect(home.banners.map((own) => own.title)).toEqual(['Хүнс']);
    const listed = (await http().get('/api/v1/customer/banners').set(bearer(admin)).expect(200))
      .body as { data: BannerJson[] };
    expect(listed.data.map((own) => [own.title, own.state])).toEqual([
      ['Хүнс', 'RUNNING'],
      ['Маргааш', 'SCHEDULED'],
      ['Өнгөрсөн', 'ENDED'],
    ]);
    // The category's page carries the banner linked to it.
    const page = (await store.api.get(`/categories/${food}/page`).expect(200)).body as {
      banners: { id: number }[];
      productCount: number;
    };
    expect(page.banners.map((own) => own.id)).toEqual([linked.id]);
    expect(page.productCount).toBe(1);
  });

  it('refuses banners that cannot be shown', async () => {
    await banner({ linkKind: 'PRODUCT', linkId: homeless.id }, 422);
    await banner({ linkKind: 'SEGMENT', linkId: 999_999 }, 422);
    await banner({ linkKind: 'NONE', linkId: food }, 422);
    await banner({ validFrom: addDays(today, -1) }, 422);
    await banner({ validTo: today }, 422);
    // Without the right.
    const clerk = await customRoleUser(app, admin, ['segments.manage']);
    await http().get('/api/v1/customer/banners').set(bearer(clerk)).expect(403);
    const keeper = await customRoleUser(app, admin, ['customer_app.home.manage']);
    await http().get('/api/v1/customer/banners').set(bearer(keeper)).expect(200);
  });

  it('shows a chosen product segment as a section and opens only shown or linked ones', async () => {
    const created = (
      await http()
        .post('/api/v1/segments/lists')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          name: 'Автомашины бүтээгдэхүүн',
          description: 'Өвөлдөө бэлдэцгээе',
          productIds: [water.id, bread.id],
        })
        .expect(201)
    ).body as { id: number };
    await store.api.get(`/sections/segment-${created.id}/products`).expect(404);
    const shown = (
      await http()
        .put(`/api/v1/segments/${created.id}/app`)
        .set(bearer(admin))
        .send({ shown: true })
        .expect(200)
    ).body as { appRank: number | null; appShownCount: number | null };
    expect(shown).toMatchObject({ appRank: 1, appShownCount: 1 });
    const home = await homeOf(store);
    expect(kinds(home)).toEqual([
      'recent',
      'promotions',
      `segment-${created.id}`,
      'discounts',
      'new',
      'favourites',
    ]);
    expect(section(home, `segment-${created.id}`)).toMatchObject({
      title: 'Автомашины бүтээгдэхүүн',
      subtitle: 'Өвөлдөө бэлдэцгээе',
      total: 2,
    });
    // «Дууссан» last.
    expect(section(home, `segment-${created.id}`).products.map((card) => card.id)).toEqual([
      bread.id,
      water.id,
    ]);
    const page = (await store.api.get(`/sections/segment-${created.id}/products`).expect(200))
      .body as SectionPageJson;
    expect(page.total).toBe(2);
    // A customer segment never shows.
    const customers = (
      await http()
        .post('/api/v1/segments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          entity: 'CUSTOMER',
          name: 'Мөрөнгийн дэлгүүр',
          definition: {
            match: 'ALL',
            groups: [
              { match: 'ALL', conditions: [{ field: 'status', op: 'IN', values: ['ACTIVE'] }] },
            ],
          },
        })
        .expect(201)
    ).body as { id: number };
    await http()
      .put(`/api/v1/segments/${customers.id}/app`)
      .set(bearer(admin))
      .send({ shown: true })
      .expect(422);
    // A second one goes after it, then moves up in one swap.
    const second = (
      await http()
        .post('/api/v1/segments/lists')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Өвлийн бараа', productIds: [bread.id] })
        .expect(201)
    ).body as { id: number };
    await http()
      .put(`/api/v1/segments/${second.id}/app`)
      .set(bearer(admin))
      .send({ shown: true })
      .expect(200);
    const moved = (
      await http()
        .post(`/api/v1/segments/${second.id}/app/move`)
        .set(bearer(admin))
        .send({ direction: 'UP' })
        .expect(200)
    ).body as { appRank: number | null; appShownCount: number | null };
    expect(moved).toMatchObject({ appRank: 1, appShownCount: 2 });
    expect(kinds(await homeOf(store)).filter((key) => key.startsWith('segment-'))).toEqual([
      `segment-${second.id}`,
      `segment-${created.id}`,
    ]);
    // At the top nothing moves.
    await http()
      .post(`/api/v1/segments/${second.id}/app/move`)
      .set(bearer(admin))
      .send({ direction: 'UP' })
      .expect(200);
    // Archived: off the home; taken off: the same.
    await http().delete(`/api/v1/segments/${created.id}`).set(bearer(admin)).expect(204);
    await http()
      .put(`/api/v1/segments/${second.id}/app`)
      .set(bearer(admin))
      .send({ shown: false })
      .expect(200);
    const after = kinds(await homeOf(store));
    expect(after).not.toContain(`segment-${created.id}`);
    expect(after).not.toContain(`segment-${second.id}`);
    // Without the right.
    const clerk = await customRoleUser(app, admin, ['segments.manage']);
    await http()
      .put(`/api/v1/segments/${second.id}/app`)
      .set(bearer(clerk))
      .send({ shown: true })
      .expect(403);
  });

  it('pages a section in the order asked, with its filters and a cursor', async () => {
    const asc = (await store.api.get('/sections/new/products?sort=PRICE_ASC&limit=1').expect(200))
      .body as SectionPageJson;
    expect(asc.total).toBe(3);
    expect(asc.data).toHaveLength(1);
    const ids = [...asc.data.map((card) => card.id)];
    let cursor = asc.nextCursor;
    while (cursor) {
      const next = (
        await store.api
          .get(`/sections/new/products?sort=PRICE_ASC&limit=1&cursor=${encodeURIComponent(cursor)}`)
          .expect(200)
      ).body as SectionPageJson;
      expect(next.total).toBeNull();
      ids.push(...next.data.map((card) => card.id));
      cursor = next.nextCursor;
    }
    expect(ids).toHaveLength(3);
    expect(ids.at(-1)).toBe(water.id);
    const inStock = (await store.api.get('/sections/new/products?inStock=true').expect(200))
      .body as SectionPageJson;
    expect(inStock.data.map((card) => card.id)).not.toContain(water.id);
    const drinksOnly = (
      await store.api.get(`/sections/new/products?categoryIds=${drinks}`).expect(200)
    ).body as SectionPageJson;
    expect(drinksOnly.data.map((card) => card.id).sort()).toEqual([cola.id, water.id].sort());
    await store.api.get('/sections/popular/products').expect(404);
    await store.api
      .get(`/sections/new/products?sort=NEW&cursor=${encodeURIComponent(asc.nextCursor ?? '')}`)
      .expect(422);
  });

  it('opens a category page with its subcategories and sections', async () => {
    const page = (await store.api.get(`/categories/${drinks}/page`).expect(200)).body as {
      category: { name: string };
      productCount: number;
      subcategories: { id: number; productCount: number }[];
      sections: SectionJson[];
    };
    expect(page.category.name).toBe('Ус, ундаа');
    expect(page.productCount).toBe(2);
    expect(page.subcategories).toEqual([expect.objectContaining({ id: soda, productCount: 1 })]);
    expect(page.sections.map((own) => own.key)).toEqual(['new', 'deals']);
    expect(
      section({ sections: page.sections } as HomeJson, 'deals').products.map((card) => card.id),
    ).toEqual([cola.id]);
    await store.api.get('/categories/999999/page').expect(404);
  });

  it('gives a top category its picture and drops it when the category moves under another', async () => {
    const fileId = await upload('catalog.category_image');
    await http()
      .put(`/api/v1/categories/${soda}/image`)
      .set(bearer(admin))
      .send({ imageFileId: fileId })
      .expect(422);
    const set = (
      await http()
        .put(`/api/v1/categories/${food}/image`)
        .set(bearer(admin))
        .send({ imageFileId: fileId })
        .expect(200)
    ).body as { imageUrl: string | null };
    expect(set.imageUrl).toMatch(/\/api\/v1\/files\/public\//);
    const tile = (await homeOf(store)).categories.find((own) => own.id === food);
    expect(tile?.imageUrl).toBe(set.imageUrl);
    await http()
      .patch(`/api/v1/categories/${food}`)
      .set(bearer(admin))
      .send({ parentId: drinks })
      .expect(200);
    const rows = await migrator.query<{ image_file_id: string | null; status: string }>(
      'SELECT c.image_file_id, f.status FROM categories c, files f WHERE c.id = $1 AND f.id = $2',
      [food, fileId],
    );
    expect(rows.rows[0]).toEqual({ image_file_id: null, status: 'DELETED' });
  });

  it('refuses a staff token on the customer routes and a customer token on the banners', async () => {
    const staff = await http().get('/api/v1/customer-app/home').set(bearer(admin)).expect(403);
    expect(staff.body).toMatchObject({ params: { reason: 'STAFF_TOKEN' } });
    await http().get('/api/v1/customer/banners').set(bearer(store.token)).expect(403);
  });
});
