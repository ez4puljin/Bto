import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, salesApi } from '../harness/sales';
import { repApi } from '../harness/sales-rep';

const jpeg = (size: number) => {
  const body = Buffer.alloc(size, 9);
  body.set([0xff, 0xd8, 0xff]);
  return body;
};

/**
 * The rep app's shop filters and orders (ADR-0068): categories with their subtrees, the home
 * warehouse, the main supplier and stock free at home; the latest to become sale-ready first, or by
 * the base price with unpriced products last; «Шинэ» for 14 days; pictures, unit flags, the old price
 * of a notice; the suppliers to filter by; the warehouses and branches of the context. Every query
 * searches «Зүмбэр», the word only this file's products carry. Synthetic data.
 */
describe('sales rep shop filters', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let rep: string;
  let scopedRep: string;
  let cola: ProductJson;
  let water: ProductJson;
  let flour: ProductJson;
  let unpriced: ProductJson;
  let juice: ProductJson;
  let parent: number;
  let child: number;
  let food: number;
  let w1: { id: number; branchId: number };
  let w2: { id: number; branchId: number };
  let s1: number;
  let s2: number;
  let ownBranch: { id: number; name: string };
  const Q = { q: 'Зүмбэр' };
  const http = () => request(app.getHttpServer());

  async function upload(kind: 'catalog.product_image' | 'catalog.product_thumb'): Promise<number> {
    const body = jpeg(kind === 'catalog.product_image' ? 2048 : 512);
    const issued = await http()
      .post('/api/v1/files/presign')
      .set(bearer(admin))
      .send({ kind, contentType: 'image/jpeg', sizeBytes: body.length })
      .expect(201);
    await http()
      .put(issued.body.uploadUrl)
      .set('Content-Type', 'image/jpeg')
      .send(body)
      .expect(204);
    return issued.body.fileId as number;
  }

  async function stock(
    warehouseId: number,
    shelf: number,
    product: ProductJson,
    qty: string,
  ): Promise<void> {
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId,
        reason: 'SURPLUS',
        lines: [
          {
            productUnitId: unitOf(product, 'PCS').id,
            enteredQty: qty,
            binId: shelf,
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

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('admin');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    rep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    // Two warehouses in two branches: each inventoryApi makes its own branch.
    w1 = await inventoryApi(app, admin).warehouse('ZF1');
    w2 = await inventoryApi(app, admin).warehouse('ZF2');
    ownBranch = (
      await http()
        .post('/api/v1/branches')
        .set(bearer(admin))
        .send({ code: `ZB${Date.now().toString(36).toUpperCase()}`, name: 'Зүмбэрийн салбар' })
        .expect(201)
    ).body as { id: number; name: string };
    scopedRep = (
      await login(app, await seedUser(app, { roles: ['SALES_REP'], branchIds: [ownBranch.id] }))
    ).accessToken;

    const catalog = catalogApi(app, admin);
    parent = await catalog.category('Зүмбэрийн бараа');
    child = await catalog.category('Зүмбэрийн ундаа', parent);
    food = await catalog.category('Зүмбэрийн хүнс');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    const product = (sku: string, name: string, categoryId: number, packs = true) =>
      catalog.product({
        sku,
        name,
        categoryId,
        baseUomId: pcs,
        ...(packs ? { units: [{ uomId: box, factorToBase: '6', isDefaultSales: true }] } : {}),
      });
    cola = await product('7981', 'Зүмбэр кола', child);
    water = await product('7982', 'Зүмбэр ус', child);
    flour = await product('7983', 'Зүмбэр гурил', food);
    unpriced = await product('7984', 'Зүмбэр үнэгүй', parent, false);
    juice = await product('7985', 'Зүмбэр шүүс', child, false);

    const inventory = inventoryApi(app, admin);
    for (const [own, warehouse] of [
      [cola, w1],
      [water, w1],
      [juice, w1],
      [flour, w2],
      [unpriced, w2],
    ] as const) {
      await inventory.setHome(own.id, warehouse.id);
    }
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Зүмбэр: ундаа');
    await pricing.terms(cola.id, '1000', profile, box);
    await pricing.terms(water.id, '3000', profile, box);
    await pricing.terms(flour.id, '2000', profile, box);
    await pricing.terms(juice.id, '500', profile, null);
    // One call: the same moment of becoming sale-ready, the tie NEW breaks by id.
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, water.id, flour.id, juice.id] })
      .expect(200);
    // A sale-ready product without a price today (its terms ended), and older ones.
    await sql.query(
      `UPDATE products SET sale_ready_at = now() - interval '20 days' WHERE id = $1`,
      [unpriced.id],
    );
    await sql.query(
      `UPDATE products SET sale_ready_at = now() - interval '13 days' WHERE id = $1`,
      [water.id],
    );
    await sql.query(
      `UPDATE products SET sale_ready_at = now() - interval '15 days' WHERE id = $1`,
      [flour.id],
    );

    const shelf1 = (await inventory.bin(w1.id, 'A-01-01')).id;
    const shelf2 = (await inventory.bin(w2.id, 'A-01-01')).id;
    await stock(w1.id, shelf1, cola, '30');
    await stock(w1.id, shelf1, water, '6');
    await stock(w2.id, shelf2, flour, '5');
    // The water's six are all reserved: on hand, but not free.
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const partners = partnersApi(app, admin);
    const customer = await partners.customer({ name: 'Зүмбэрийн дэлгүүр' });
    const order = (
      await salesApi(app, office)
        .create(orderBody(customer.id, [{ productUnitId: unitOf(water, 'PCS').id, qty: '6' }]))
        .expect(201)
    ).body as { id: number };
    await salesApi(app, office).submit(order.id).expect(200);

    s1 = (await partners.supplier({ name: 'Зүмбэр ХХК' })).id;
    s2 = (await partners.supplier({ name: 'Зүмбэр Хоёр ХХК' })).id;
    for (const [productId, supplierId] of [
      [cola.id, s1],
      [flour.id, s1],
      [water.id, s2],
      [water.id, s1],
    ] as const) {
      await http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId, supplierId })
        .expect(201);
    }
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('puts the latest to become sale-ready first, ties by the higher id, page after page', async () => {
    const shop = repApi(app, rep);
    const first = await shop.productPage({ ...Q, limit: 2 });
    expect(first.total).toBe(5);
    expect(await shop.allIds(Q, 1)).toEqual([juice.id, cola.id, water.id, flour.id, unpriced.id]);
    expect(await shop.allIds({ ...Q, sort: 'NEW' }, 2)).toEqual([
      juice.id,
      cola.id,
      water.id,
      flour.id,
      unpriced.id,
    ]);
    const next = await shop.productPage({ ...Q, limit: 2, cursor: first.nextCursor });
    expect(next.total).toBeNull();
    // «Шинэ» for 14 days after becoming sale-ready.
    const flags = Object.fromEntries(
      first.data.concat(next.data).map((row) => [row.id, row.isNew]),
    );
    expect(flags).toEqual({
      [juice.id]: true,
      [cola.id]: true,
      [water.id]: true,
      [flour.id]: false,
    });
    // A cursor of one sort is refused by another, and a cursor not of ours.
    await http()
      .get('/api/v1/sales-rep/products')
      .query({ ...Q, sort: 'PRICE_ASC', cursor: first.nextCursor })
      .set(bearer(rep))
      .expect(422);
    await http()
      .get('/api/v1/sales-rep/products')
      .query({ ...Q, cursor: 'bm90LWEtY3Vyc29y' })
      .set(bearer(rep))
      .expect(422);
  });

  it('sorts by the base price both ways, the unpriced product last either way', async () => {
    const shop = repApi(app, rep);
    expect(await shop.allIds({ ...Q, sort: 'PRICE_ASC' }, 2)).toEqual([
      juice.id,
      cola.id,
      flour.id,
      water.id,
      unpriced.id,
    ]);
    expect(await shop.allIds({ ...Q, sort: 'PRICE_DESC' }, 1)).toEqual([
      water.id,
      flour.id,
      cola.id,
      juice.id,
      unpriced.id,
    ]);
    const page = await shop.productPage({ ...Q, sort: 'PRICE_DESC' });
    expect(page.total).toBe(5);
    expect(page.data.map((row) => row.basePrice)).toEqual(['3000', '2000', '1000', '500', null]);
    const sorted = await shop.productPage({ ...Q, sort: 'PRICE_ASC', limit: 2 });
    await http()
      .get('/api/v1/sales-rep/products')
      .query({ ...Q, sort: 'PRICE_DESC', cursor: sorted.nextCursor })
      .set(bearer(rep))
      .expect(422);
  });

  it('filters by category subtree, home warehouse, main supplier and stock free at home', async () => {
    const ids = async (query: Record<string, unknown>) =>
      (await repApi(app, rep).allIds({ ...Q, ...query }, 50)).sort((a, b) => a - b);
    const sorted = (...list: number[]) => list.sort((a, b) => a - b);
    expect(await ids({ categoryIds: [parent] })).toEqual(
      sorted(cola.id, water.id, unpriced.id, juice.id),
    );
    expect(await ids({ categoryIds: [child] })).toEqual(sorted(cola.id, water.id, juice.id));
    expect(await ids({ categoryIds: [child, food] })).toEqual(
      sorted(cola.id, water.id, flour.id, juice.id),
    );
    expect(await ids({ warehouseId: w2.id })).toEqual(sorted(flour.id, unpriced.id));
    // The first link is the main one: the water's main supplier is the second supplier.
    expect(await ids({ supplierIds: [s1] })).toEqual(sorted(cola.id, flour.id));
    expect(await ids({ supplierIds: [s1, s2] })).toEqual(sorted(cola.id, water.id, flour.id));
    // The water's six are reserved; the juice holds none.
    expect(await ids({ inStock: true })).toEqual(sorted(cola.id, flour.id));
    expect(await ids({ inStock: false })).toHaveLength(5);
    expect(await ids({ categoryIds: [child], inStock: true, warehouseId: w1.id })).toEqual([
      cola.id,
    ]);
    expect(await ids({ inStock: true, sort: 'PRICE_DESC' })).toEqual(sorted(cola.id, flour.id));
    const first = await repApi(app, rep).productPage({
      ...Q,
      supplierIds: [s1],
      sort: 'PRICE_ASC',
    });
    expect(first.total).toBe(2);
    for (const query of [
      { categoryIds: 0 },
      { categoryIds: 'a' },
      { supplierIds: Array.from({ length: 201 }, (_, index) => index + 1) },
      { inStock: 'maybe' },
      { sort: 'NAME' },
      { categoryId: parent },
    ]) {
      await http()
        .get('/api/v1/sales-rep/products')
        .query({ ...Q, ...query })
        .set(bearer(rep))
        .expect(422);
    }
  });

  it('gives each product its pictures, unit flags, home and base price, and the old price', async () => {
    // The first picture becomes the primary one.
    for (let index = 0; index < 2; index += 1) {
      const imageFileId = await upload('catalog.product_image');
      const thumbFileId = await upload('catalog.product_thumb');
      await http()
        .post(`/api/v1/products/${cola.id}/images`)
        .set(bearer(admin))
        .send({ imageFileId, thumbFileId })
        .expect(201);
    }
    const detail = (await http().get(`/api/v1/products/${cola.id}`).set(bearer(admin)).expect(200))
      .body as { images: { url: string; thumbUrl: string }[] };
    const [own] = (
      await http()
        .get('/api/v1/sales-rep/products/batch')
        .query({ productIds: `${cola.id}`, priceBefore: addDays(businessDate(), -1) })
        .set(bearer(rep))
        .expect(200)
    ).body as {
      images: { url: string; thumbUrl: string | null }[];
      homeWarehouseId: number | null;
      basePrice: string | null;
      basePriceBefore: string | null;
      units: { uomCode: string | null; isDefaultSales: boolean }[];
    }[];
    expect(own?.images).toEqual(
      detail.images.map((image) => ({ url: image.url, thumbUrl: image.thumbUrl })),
    );
    expect(own?.images).toHaveLength(2);
    expect(own).toMatchObject({ homeWarehouseId: w1.id, basePrice: '1000', basePriceBefore: null });
    expect(own?.units.map((unit) => [unit.uomCode, unit.isDefaultSales])).toEqual([
      ['PCS', false],
      ['BOX', true],
    ]);
    const today = (
      await http()
        .get('/api/v1/sales-rep/products/batch')
        .query({ productIds: `${cola.id}`, priceBefore: businessDate() })
        .set(bearer(rep))
        .expect(200)
    ).body as { basePriceBefore: string | null }[];
    expect(today[0]?.basePriceBefore).toBe('1000');
    await http()
      .get('/api/v1/sales-rep/products/batch')
      .query({ productIds: `${cola.id}`, priceBefore: '2026-02-30' })
      .set(bearer(rep))
      .expect(422);
    // The product list keeps its own shape: none of the rep app's fields leak into it.
    const list = (
      await http()
        .get('/api/v1/products')
        .query({ q: 'Зүмбэр кола' })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: Record<string, unknown>[] };
    const row = list.data.find((entry) => entry.id === cola.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('images');
    expect(row).not.toHaveProperty('basePrice');
    for (const unit of (row?.units ?? []) as Record<string, unknown>[]) {
      expect(unit).not.toHaveProperty('isDefaultSales');
    }
  });

  it('lists the main suppliers of the shop with how many products each has', async () => {
    const suppliers = (await http().get('/api/v1/sales-rep/suppliers').set(bearer(rep)).expect(200))
      .body as { id: number; name: string; productCount: number }[];
    expect(suppliers.filter((row) => row.id === s1 || row.id === s2)).toEqual([
      { id: s1, name: 'Зүмбэр ХХК', productCount: 2 },
      { id: s2, name: 'Зүмбэр Хоёр ХХК', productCount: 1 },
    ]);
    const counts = suppliers.map((row) => row.productCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('lists the primary thumbnail of every shop product and nothing off the shop', async () => {
    const picture = async (productId: number) => {
      const imageFileId = await upload('catalog.product_image');
      const thumbFileId = await upload('catalog.product_thumb');
      await http()
        .post(`/api/v1/products/${productId}/images`)
        .set(bearer(admin))
        .send({ imageFileId, thumbFileId })
        .expect(201);
    };
    const thumbsOf = async (productId: number) =>
      (
        (await http().get(`/api/v1/products/${productId}`).set(bearer(admin)).expect(200)).body as {
          images: { thumbUrl: string; isPrimary: boolean }[];
        }
      ).images;
    const catalog = catalogApi(app, admin);
    // Waiting for its prices: never in the shop, so never kept on the phone.
    const waiting = await catalog.product({
      sku: '7986',
      name: 'Зүмбэр хүлээгдэж буй',
      categoryId: parent,
      baseUomId: await catalog.uomId('PCS'),
    });
    await picture(juice.id);
    await picture(juice.id);
    await picture(waiting.id);
    const juices = await thumbsOf(juice.id);
    const primary = juices.find((image) => image.isPrimary);
    const other = juices.find((image) => !image.isPrimary);
    const [waitingThumb] = await thumbsOf(waiting.id);

    const { urls } = (await http().get('/api/v1/sales-rep/thumbs').set(bearer(rep)).expect(200))
      .body as { urls: string[] };
    expect(primary).toBeDefined();
    expect(urls).toContain(primary?.thumbUrl);
    expect(urls).not.toContain(other?.thumbUrl);
    expect(urls).not.toContain(waitingThumb?.thumbUrl);
    expect(new Set(urls).size).toBe(urls.length);
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    await http().get('/api/v1/sales-rep/thumbs').set(bearer(office)).expect(403);
  });

  it('gives the context the active wholesale warehouses, the rep branches and board branches', async () => {
    const idle = await inventoryApi(app, admin).warehouse('ZF3');
    await http()
      .patch(`/api/v1/warehouses/${idle.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    // The scoped rep writes for the branch's warehouse, so the branch is theirs.
    await http()
      .post('/api/v1/warehouses')
      .set(bearer(admin))
      .send({ code: 'ZF4', name: 'Зүмбэрийн агуулах', kind: 'WHOLESALE', branchId: ownBranch.id })
      .expect(201);
    const board = (
      await http()
        .post('/api/v1/sales-boards')
        .set(bearer(admin))
        .send({ name: 'Зүмбэрийн самбар', branchId: ownBranch.id })
        .expect(201)
    ).body as { id: number };
    // A board shows in the context once it has a stage a rep may place on.
    await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(admin))
      .send({
        boardId: board.id,
        name: 'Зүмбэрийн борлуулалт',
        visibility: 'PUBLIC',
        ownOrdersOnly: false,
        roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
        stages: [
          {
            name: 'Зүмбэрийн шат',
            action: 'NONE',
            printPickList: false,
            printDeliveryNote: false,
            roles: { VIEW: [], EDIT: [], MOVE: [] },
          },
        ],
      })
      .expect(201);
    const context = await repApi(app, rep).context();
    expect(context.boards.find((entry) => entry.id === board.id)?.branchName).toBe(
      'Зүмбэрийн салбар',
    );
    const ids = context.warehouses.map((warehouse) => warehouse.id);
    expect(ids).toEqual(expect.arrayContaining([w1.id, w2.id]));
    expect(ids).not.toContain(idle.id);
    expect(context.warehouses.find((warehouse) => warehouse.id === w1.id)).toMatchObject({
      branchId: w1.branchId,
      branchName: expect.any(String),
    });
    expect(context.branchNames).toEqual([]);
    expect((await repApi(app, scopedRep).context()).branchNames).toEqual(['Зүмбэрийн салбар']);
  });
});
