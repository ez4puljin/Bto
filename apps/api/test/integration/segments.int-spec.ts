import { randomInt } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import type { SegmentCondition, SegmentDefinition } from '@tugeel/shared/segments';
import { addDays, businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

interface QueryPage {
  data: { id: number; name: string }[];
  nextCursor: string | null;
  total: number | null;
}
interface SegmentJson {
  id: number;
  entity: string;
  name: string;
  description: string | null;
  definition: SegmentDefinition;
}

const all = (...conditions: SegmentCondition[]): SegmentDefinition => ({
  match: 'ALL',
  groups: [{ match: 'ALL', conditions }],
});
const idsOf = (...rows: { id: number }[]) => rows.map((row) => row.id).sort((a, b) => a - b);

/** A valid EAN-13 in the Mongolian range, different on every call. */
function ean13(): string {
  const body = `865${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`;
  return `${body}${gtinCheckDigit(body)}`;
}

/**
 * Segments and the filtered product list (ADR-0049): every product condition is answered by the
 * module that owns its data (catalog, partners, inventory, pricing), AND / OR groups combine them,
 * negative conditions subtract from every product, and saved segments narrow the product,
 * customer and supplier lists; the list also gives every id its filters keep (ADR-0052). Product
 * queries keep to the file's category tree, so the list's own filters apply too; partner segments
 * match names carrying the file's tag (the search condition).
 */
describe('segments and filtered lists', () => {
  const tag = `S${randomInt(10_000, 99_999)}`;
  let app: NestExpressApplication;
  let admin: string;
  let worker: string;
  let office: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let root: number;
  let drinks: number;
  let food: number;
  let msm: number;
  let apu: number;
  let idle: number;
  let profile: number;
  let cola: ProductJson;
  let still: ProductJson;
  let rice: ProductJson;
  let tea: ProductJson;
  let old: ProductJson;
  const http = () => request(app.getHttpServer());

  async function query(body: Record<string, unknown>, token = admin, status = 200) {
    const res = await http()
      .post('/api/v1/products/query')
      .set(bearer(token))
      .send(body)
      .expect(status);
    return res.body as QueryPage;
  }
  /** The ids of this file's products a definition keeps; one page, so the total matches. */
  async function kept(where: SegmentDefinition): Promise<number[]> {
    const page = await query({ where, categoryId: root, limit: 200 });
    expect(page.total).toBe(page.data.length);
    return idsOf(...page.data);
  }
  async function createSegment(body: Record<string, unknown>, status = 201) {
    return http()
      .post('/api/v1/segments')
      .set(bearer(admin))
      .set(idempotency())
      .send(body)
      .expect(status);
  }

  beforeAll(async () => {
    app = await createHttpApp();
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    office = await token('OFFICE');
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse(`${tag}A`);
    wh2 = await inventory.warehouse(`${tag}B`);
    const shelf1 = (await inventory.bin(wh1.id, 'A-01-01')).id;
    const shelf2 = (await inventory.bin(wh2.id, 'B-01-01')).id;
    const catalog = catalogApi(app, admin);
    root = await catalog.category(`Сегмент ${tag}`);
    drinks = await catalog.category(`Ундаа ${tag}`, root);
    const water = await catalog.category(`Ус ${tag}`, drinks);
    food = await catalog.category(`Хүнс ${tag}`, root);
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    cola = await catalog.product({
      name: 'Кока кола',
      categoryId: drinks,
      baseUomId: pcs,
      weightKg: '0.5',
      baseBarcodes: [ean13()],
      units: [{ uomId: box, factorToBase: '24', barcodes: [ean13()] }],
    });
    still = await catalog.product({
      name: 'Ус 0.5л',
      categoryId: water,
      baseUomId: pcs,
      weightKg: '0.5',
    });
    rice = await catalog.product({ name: 'Будаа', categoryId: food, baseUomId: pcs });
    tea = await catalog.product({
      name: 'Цай',
      categoryId: food,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '10', barcodes: [ean13()] }],
    });
    old = await catalog.product({ name: 'Хуучин бараа', categoryId: food, baseUomId: pcs });
    await http()
      .patch(`/api/v1/products/${old.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);

    const partners = partnersApi(app, admin);
    msm = (await partners.supplier({ name: `МСМ ${tag}` })).id;
    apu = (await partners.supplier({ name: `АПУ ${tag}` })).id;
    idle = (await partners.supplier({ name: `Шинэ ${tag}` })).id;
    // The first link of a product is its main one.
    for (const [productId, supplierId] of [
      [cola.id, msm],
      [cola.id, apu],
      [rice.id, apu],
    ] as const) {
      await http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId, supplierId })
        .expect(201);
    }

    await inventory.homeShelf(cola.id, wh1.id, shelf1);
    await inventory.setHome(still.id, wh1.id);
    await inventory.homeShelf(rice.id, wh2.id, shelf2);
    await http()
      .put('/api/v1/product-locations')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, productId: still.id, minQty: '5' })
      .expect(200);
    // Each line goes to its product's home and fixed shelf (ADR-0099 #1).
    for (const line of [
      { productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2' },
      { productUnitId: unitOf(rice, 'PCS').id, enteredQty: '10' },
    ]) {
      const created = await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({ supplierId: msm, lines: [line] })
        .expect(201);
      await http()
        .post(`/api/v1/receipts/${(created.body as { id: number }).id}/post`)
        .set(bearer(admin))
        .set(idempotency())
        .expect(200);
    }

    const pricing = pricingApi(app, admin);
    profile = await pricing.profile(`Ундаа ${tag}`);
    await pricing.terms(cola.id, '1000', profile, box);
    await pricing.terms(still.id, '500', profile, null);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('answers each product condition from the module that owns its data', async () => {
    // catalog: a category with its subcategories, search, stage, dates, missing data
    expect(await kept(all({ field: 'category', op: 'IN', ids: [drinks] }))).toEqual(
      idsOf(cola, still),
    );
    expect(await kept(all({ field: 'category', op: 'NOT_IN', ids: [drinks] }))).toEqual(
      idsOf(rice, tea, old),
    );
    expect(await kept(all({ field: 'search', op: 'CONTAINS', text: 'кока' }))).toEqual(idsOf(cola));
    expect(await kept(all({ field: 'stage', op: 'IN', values: ['INACTIVE'] }))).toEqual(idsOf(old));
    expect(await kept(all({ field: 'createdAt', op: 'LAST_DAYS', days: 1 }))).toEqual(
      idsOf(cola, still, rice, tea, old),
    );
    const yesterday = addDays(businessDate(), -1);
    expect(await kept(all({ field: 'createdAt', op: 'BETWEEN', to: yesterday }))).toEqual([]);
    expect(await kept(all({ field: 'missing', op: 'IS', values: ['BASE_BARCODE'] }))).toEqual(
      idsOf(still, rice, tea, old),
    );
    expect(await kept(all({ field: 'missing', op: 'IS', values: ['ANY_BARCODE'] }))).toEqual(
      idsOf(still, rice, old),
    );
    expect(await kept(all({ field: 'missing', op: 'IS', values: ['WEIGHT'] }))).toEqual(
      idsOf(rice, tea, old),
    );
    // partners: any link, the main one, none, not one of
    expect(await kept(all({ field: 'supplier', op: 'IN', ids: [apu] }))).toEqual(idsOf(cola, rice));
    expect(await kept(all({ field: 'supplier', op: 'MAIN_IN', ids: [apu] }))).toEqual(idsOf(rice));
    expect(await kept(all({ field: 'supplier', op: 'NONE' }))).toEqual(idsOf(still, tea, old));
    expect(await kept(all({ field: 'supplier', op: 'NOT_IN', ids: [apu] }))).toEqual(
      idsOf(still, tea, old),
    );
    // inventory: home warehouses and stock
    expect(await kept(all({ field: 'homeWarehouse', op: 'IN', ids: [wh1.id] }))).toEqual(
      idsOf(cola, still),
    );
    expect(await kept(all({ field: 'homeWarehouse', op: 'NONE' }))).toEqual(idsOf(tea, old));
    expect(await kept(all({ field: 'stock', op: 'IN_STOCK' }))).toEqual(idsOf(cola, rice));
    expect(await kept(all({ field: 'stock', op: 'IN_STOCK', warehouseId: wh2.id }))).toEqual(
      idsOf(rice),
    );
    expect(await kept(all({ field: 'stock', op: 'OUT_OF_STOCK', warehouseId: wh1.id }))).toEqual(
      idsOf(still, rice, tea, old),
    );
    expect(await kept(all({ field: 'stock', op: 'AT_OR_BELOW_MIN', warehouseId: wh1.id }))).toEqual(
      idsOf(still),
    );
    // pricing: the terms in force today
    expect(await kept(all({ field: 'priceProfile', op: 'IN', ids: [profile] }))).toEqual(
      idsOf(cola, still),
    );
    expect(await kept(all({ field: 'priceProfile', op: 'NONE' }))).toEqual(idsOf(rice, tea, old));
    expect(
      await kept(all({ field: 'warehousePrice', op: 'BETWEEN', min: '600', max: '2000' })),
    ).toEqual(idsOf(cola));
  });

  it('combines conditions in AND / OR groups and with the list filters', async () => {
    const either: SegmentDefinition = {
      match: 'ANY',
      groups: [
        {
          match: 'ALL',
          conditions: [
            { field: 'category', op: 'IN', ids: [food] },
            { field: 'homeWarehouse', op: 'IN', ids: [wh2.id] },
          ],
        },
        {
          match: 'ALL',
          conditions: [{ field: 'stock', op: 'AT_OR_BELOW_MIN', warehouseId: wh1.id }],
        },
      ],
    };
    expect(await kept(either)).toEqual(idsOf(still, rice));
    const anyOf: SegmentDefinition = {
      match: 'ALL',
      groups: [
        {
          match: 'ANY',
          conditions: [
            { field: 'missing', op: 'IS', values: ['WEIGHT'] },
            { field: 'supplier', op: 'MAIN_IN', ids: [msm] },
          ],
        },
        { match: 'ALL', conditions: [{ field: 'stage', op: 'NOT_IN', values: ['INACTIVE'] }] },
      ],
    };
    expect(await kept(anyOf)).toEqual(idsOf(cola, rice, tea));
    // The list's own filters still apply; pages keep the list's order (by name) and the total
    // comes with the first page only.
    const first = await query({ where: anyOf, categoryId: food, limit: 1 });
    expect(first).toMatchObject({ total: 2, data: [{ id: rice.id }] });
    const second = await query({
      where: anyOf,
      categoryId: food,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ total: null, data: [{ id: tea.id }], nextCursor: null });
    const searched = await query({ where: anyOf, categoryId: root, q: 'цай' });
    expect(searched).toMatchObject({ total: 1, data: [{ id: tea.id }] });
  });

  it('gives every product the list keeps, in its order, for «Таарсан бүх N» (ADR-0052)', async () => {
    const ids = async (body: Record<string, unknown>, status = 200) =>
      (
        await http()
          .post('/api/v1/products/query/ids')
          .set(bearer(worker))
          .send(body)
          .expect(status)
      ).body as { ids: number[] };
    // The list's filters and its order (by name): the same products as every page put together.
    const listed = await query({ categoryId: root, limit: 200 });
    expect((await ids({ categoryId: root })).ids).toEqual(listed.data.map((row) => row.id));
    expect((await ids({ categoryId: root, q: 'кока' })).ids).toEqual([cola.id]);
    expect((await ids({ categoryId: root, status: 'INACTIVE' })).ids).toEqual([old.id]);
    const homed = all({ field: 'homeWarehouse', op: 'IN', ids: [wh1.id] });
    expect((await ids({ categoryId: root, where: homed })).ids).toEqual(
      (await query({ categoryId: root, where: homed })).data.map((row) => row.id),
    );
    // A page's cursor or size has no place here.
    await ids({ categoryId: root, limit: 10 }, 422);
    await ids({ categoryId: root, cursor: 'x' }, 422);
  });

  it('refuses conditions that fail the shared rules, at their path', async () => {
    const res = await http()
      .post('/api/v1/products/query')
      .set(bearer(worker))
      .send({ where: all({ field: 'creditHold', op: 'YES' }) })
      .expect(422);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'where.groups.0.conditions.0.field', constraint: 'FIELD_NOT_ALLOWED' }],
    });
  });

  it('keeps segments that admins write and everyone reads, counts and filters with', async () => {
    const drinksSegment = (
      await createSegment({
        entity: 'PRODUCT',
        name: 'Ундаа, агуулах 1',
        description: 'Жишээ',
        definition: all(
          { field: 'category', op: 'IN', ids: [drinks] },
          { field: 'homeWarehouse', op: 'IN', ids: [wh1.id] },
        ),
      })
    ).body as SegmentJson;
    // A live name repeats only in another entity.
    const duplicate = await createSegment(
      {
        entity: 'PRODUCT',
        name: ' ундаа, агуулах 1 ',
        definition: all({ field: 'stock', op: 'IN_STOCK' }),
      },
      409,
    );
    expect((duplicate.body as { code: string }).code).toBe('DUPLICATE_VALUE');
    const idleSuppliers = (
      await createSegment({
        entity: 'SUPPLIER',
        name: 'Ундаа, агуулах 1',
        definition: all(
          { field: 'search', op: 'CONTAINS', text: tag },
          { field: 'products', op: 'NONE' },
        ),
      })
    ).body as SegmentJson;
    // A definition names only what exists.
    const unknown = await createSegment(
      {
        entity: 'PRODUCT',
        name: 'Буруу',
        definition: all({ field: 'category', op: 'IN', ids: [999_999_999] }),
      },
      422,
    );
    expect(unknown.body).toMatchObject({
      errors: [{ path: 'definition.groups.0.conditions.0.ids', constraint: 'exists' }],
    });
    // Writing needs segments.manage; reading does not.
    await http()
      .post('/api/v1/segments')
      .set(bearer(worker))
      .set(idempotency())
      .send({
        entity: 'PRODUCT',
        name: 'Миний',
        definition: all({ field: 'stock', op: 'IN_STOCK' }),
      })
      .expect(403);
    const listed = await http()
      .get('/api/v1/segments')
      .query({ entity: 'PRODUCT' })
      .set(bearer(worker))
      .expect(200);
    expect(listed.body).toMatchObject({
      data: [{ id: drinksSegment.id, description: 'Жишээ' }],
      nextCursor: null,
    });
    const counts = await http()
      .get('/api/v1/segments/counts')
      .query({ segmentIds: [drinksSegment.id, idleSuppliers.id] })
      .set(bearer(worker))
      .expect(200);
    expect(counts.body).toEqual([
      { segmentId: drinksSegment.id, count: 2 },
      { segmentId: idleSuppliers.id, count: 1 },
    ]);
    const preview = await http()
      .post('/api/v1/segments/preview')
      .set(bearer(admin))
      .send({
        entity: 'PRODUCT',
        definition: all(
          { field: 'category', op: 'IN', ids: [root] },
          { field: 'stock', op: 'IN_STOCK' },
        ),
      })
      .expect(200);
    expect(preview.body).toEqual({ count: 2 });
    await http()
      .post('/api/v1/segments/preview')
      .set(bearer(worker))
      .send({ entity: 'PRODUCT', definition: all({ field: 'stock', op: 'IN_STOCK' }) })
      .expect(403);

    // The product list narrows to the segment, alone or with conditions of the moment.
    expect(idsOf(...(await query({ segmentId: drinksSegment.id }, worker)).data)).toEqual(
      idsOf(cola, still),
    );
    const both = await query({
      segmentId: drinksSegment.id,
      where: all({ field: 'stock', op: 'IN_STOCK' }),
    });
    expect(idsOf(...both.data)).toEqual(idsOf(cola));
    await query({ segmentId: idleSuppliers.id }, admin, 422);
    // The supplier list narrows to its segment and reads given suppliers by id.
    const idleOnly = await http()
      .get('/api/v1/suppliers')
      .query({ segmentId: idleSuppliers.id })
      .set(bearer(worker))
      .expect(200);
    expect(idsOf(...(idleOnly.body as QueryPage).data)).toEqual([idle]);
    const byIds = await http()
      .get('/api/v1/suppliers')
      .query({ ids: [msm, apu] })
      .set(bearer(worker))
      .expect(200);
    expect(idsOf(...(byIds.body as QueryPage).data)).toEqual([msm, apu].sort((a, b) => a - b));
    await http()
      .get('/api/v1/customers')
      .query({ segmentId: drinksSegment.id })
      .set(bearer(office))
      .expect(422);

    // A change keeps the entity; archiving hides the segment from everything.
    const renamed = await http()
      .put(`/api/v1/segments/${drinksSegment.id}`)
      .set(bearer(admin))
      .send({ name: 'Ундаа', definition: all({ field: 'category', op: 'IN', ids: [drinks] }) })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: 'Ундаа', entity: 'PRODUCT', description: null });
    await http().delete(`/api/v1/segments/${drinksSegment.id}`).set(bearer(admin)).expect(204);
    await http().get(`/api/v1/segments/${drinksSegment.id}`).set(bearer(worker)).expect(404);
    await query({ segmentId: drinksSegment.id }, admin, 404);
    const after = await http()
      .get('/api/v1/segments/counts')
      .query({ segmentIds: [drinksSegment.id] })
      .set(bearer(admin))
      .expect(200);
    expect(after.body).toEqual([{ segmentId: drinksSegment.id, count: null }]);
  });

  it('keeps customer segments to those who may read customers', async () => {
    const partners = partnersApi(app, admin);
    const held = await partners.customer({ name: `Номин ${tag}` });
    await partners.customer({ name: `Оргил ${tag}` });
    await partners.customer({ name: `Бат ${tag}`, kind: 'INDIVIDUAL' });
    await http()
      .put(`/api/v1/customers/${held.id}/credit`)
      .set(bearer(admin))
      .send({
        creditLimit: null,
        settlementGroup: 'DAY_20',
        creditHold: true,
        creditHoldReason: 'Хугацаа хэтэрсэн',
      })
      .expect(200);
    const companies = (
      await createSegment({
        entity: 'CUSTOMER',
        name: 'Зээл хаасан компани',
        definition: all(
          { field: 'search', op: 'CONTAINS', text: tag },
          { field: 'kind', op: 'IN', values: ['COMPANY'] },
          { field: 'creditHold', op: 'YES' },
        ),
      })
    ).body as SegmentJson;
    const list = await http()
      .get('/api/v1/customers')
      .query({ segmentId: companies.id })
      .set(bearer(office))
      .expect(200);
    expect(idsOf(...(list.body as QueryPage).data)).toEqual([held.id]);
    const notHeld = await http()
      .post('/api/v1/segments/preview')
      .set(bearer(admin))
      .send({
        entity: 'CUSTOMER',
        definition: all(
          { field: 'search', op: 'CONTAINS', text: tag },
          { field: 'creditHold', op: 'NO' },
        ),
      })
      .expect(200);
    expect(notHeld.body).toEqual({ count: 2 });
    // A warehouse worker reads no customers, so no customer segments either.
    const seen = await http().get('/api/v1/segments').set(bearer(worker)).expect(200);
    expect((seen.body as { data: SegmentJson[] }).data.map((row) => row.entity)).not.toContain(
      'CUSTOMER',
    );
    await http().get(`/api/v1/segments/${companies.id}`).set(bearer(worker)).expect(403);
    const counted = await http()
      .get('/api/v1/segments/counts')
      .query({ segmentIds: [companies.id] })
      .set(bearer(worker))
      .expect(200);
    expect(counted.body).toEqual([{ segmentId: companies.id, count: null }]);
  });

  it('marks a product changed when its barcodes change (the «updated» condition)', async () => {
    const before = await catalogApi(app, admin).get(rice.id);
    await http()
      .post(`/api/v1/product-units/${unitOf(rice, 'PCS').id}/barcodes`)
      .set(bearer(admin))
      .send({ code: ean13() })
      .expect(201);
    const after = await catalogApi(app, admin).get(rice.id);
    expect(Date.parse(String(after.updatedAt))).toBeGreaterThan(
      Date.parse(String(before.updatedAt)),
    );
  });
});
