import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface PeriodJson {
  id: number;
  price: string;
  validFrom: string;
  validTo: string | null;
}
interface UnitPriceJson {
  productUnitId: number;
  isBase: boolean;
  current: { price: string; source: 'UNIT' | 'DERIVED'; period: PeriodJson | null } | null;
  scheduled: PeriodJson[];
  history: PeriodJson[];
}
interface PricesJson {
  productId: number;
  today: string;
  wholesale: UnitPriceJson[];
  retail: UnitPriceJson[];
}
interface ProgramJson {
  id: number;
  status: string;
  validFrom: string;
  validTo: string | null;
  steps: { threshold: string; value: string }[];
}
interface QuoteLineJson {
  priced: boolean;
  problem: string | null;
  listPrice: string | null;
  unitPrice: string | null;
  subtotal: string | null;
  discountAmount: string | null;
  total: string | null;
  applied: { name: string; value: string; amount: string | null }[];
}
interface QuoteJson {
  lines: QuoteLineJson[];
  subtotal: string;
  discountTotal: string;
  total: string;
}

/** Today's price of each unit as "price SOURCE" (base unit first). */
const currentOf = (units: UnitPriceJson[]) =>
  units.map((unit) => (unit.current ? `${unit.current.price} ${unit.current.source}` : null));

/** Unit prices, discount programs and quotes (SPEC §5.6, ADR-0041). */
describe('pricing', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let drinks: number;
  let boxUom: number;
  let cola: ProductJson;
  let juice: ProductJson;
  let water: ProductJson;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const box = (product: ProductJson) => unitOf(product, 'BOX').id;

  const setPrices = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/unit-prices').set(bearer(token)).set(idempotency()).send(body);
  const pricesOf = async (productId: number) =>
    (await http().get('/api/v1/unit-prices').query({ productId }).set(bearer(office)).expect(200))
      .body as PricesJson;
  const createProgram = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/discount-programs').set(bearer(token)).set(idempotency()).send(body);
  const quote = (body: Record<string, unknown>) =>
    http().post('/api/v1/pricing/quote').set(bearer(office)).send(body);
  const count = async (query: string, params: unknown[]) =>
    (await sql.query<{ count: string }>(query, params)).rows[0]?.count;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    drinks = await catalog.category('Ундаа');
    const juices = await catalog.category('Шүүс', drinks);
    const base = await catalog.uomId('PCS');
    boxUom = await catalog.uomId('BOX');
    cola = await catalog.product({
      sku: '10',
      name: 'Кока кола',
      categoryId: drinks,
      baseUomId: base,
      units: [{ uomId: boxUom, factorToBase: '24' }],
    });
    juice = await catalog.product({
      sku: '11',
      name: 'Шүүс',
      categoryId: juices,
      baseUomId: base,
      units: [{ uomId: boxUom, factorToBase: '12' }],
    });
    water = await catalog.product({ sku: '12', name: 'Ус', categoryId: drinks, baseUomId: base });
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('keeps a dated timeline of unit prices per list, never rewriting it', async () => {
    expect(currentOf((await pricesOf(cola.id)).wholesale)).toEqual([null, null]);

    const first = {
      productId: cola.id,
      validFrom: today,
      entries: [
        { list: 'WHOLESALE', productUnitId: pcs(cola), price: '1000' },
        { list: 'WHOLESALE', productUnitId: box(cola), price: '22800' },
        { list: 'RETAIL', productUnitId: pcs(cola), price: '1200' },
      ],
    };
    const set = (await setPrices(admin, first).expect(200)).body as PricesJson;
    expect(currentOf(set.wholesale)).toEqual(['1000 UNIT', '22800 UNIT']);
    // The supermarket's box comes from its own piece price.
    expect(currentOf(set.retail)).toEqual(['1200 UNIT', '28800 DERIVED']);
    // The same prices again change nothing.
    await setPrices(admin, first).expect(200);
    expect(await count('SELECT count(*)::text AS count FROM unit_prices', [])).toBe('3');

    // A change in ten days, then one in five days slots in before it.
    await setPrices(admin, {
      productId: cola.id,
      validFrom: addDays(today, 10),
      entries: [{ list: 'WHOLESALE', productUnitId: pcs(cola), price: '1100' }],
    }).expect(200);
    const planned = (
      await setPrices(admin, {
        productId: cola.id,
        validFrom: addDays(today, 5),
        entries: [{ list: 'WHOLESALE', productUnitId: pcs(cola), price: '1050' }],
      }).expect(200)
    ).body as PricesJson;
    const piece = planned.wholesale[0];
    expect(piece?.current).toMatchObject({
      price: '1000',
      period: { validFrom: today, validTo: addDays(today, 5) },
    });
    expect(piece?.scheduled).toEqual([
      expect.objectContaining({
        price: '1050',
        validFrom: addDays(today, 5),
        validTo: addDays(today, 10),
      }),
      expect.objectContaining({ price: '1100', validFrom: addDays(today, 10), validTo: null }),
    ]);

    // Changed again today: the morning's price never applied, so it is voided, not history.
    const again = (
      await setPrices(admin, {
        productId: cola.id,
        validFrom: today,
        entries: [
          { list: 'WHOLESALE', productUnitId: pcs(cola), price: '990' },
          { list: 'WHOLESALE', productUnitId: box(cola), price: null },
        ],
      }).expect(200)
    ).body as PricesJson;
    expect(currentOf(again.wholesale)).toEqual(['990 UNIT', '23760 DERIVED']);
    expect(again.wholesale[0]?.current?.period).toMatchObject({ validTo: addDays(today, 5) });
    expect(again.wholesale[0]?.history).toEqual([]);
    expect(
      await count(
        'SELECT count(*)::text AS count FROM unit_prices WHERE valid_to = valid_from',
        [],
      ),
    ).toBe('2');
    expect(
      await count(
        `SELECT count(*)::text AS count FROM audit_log WHERE entity = 'unit_prices' AND entity_id = $1`,
        [String(cola.id)],
      ),
    ).toBe('4');
  });

  it('refuses a past date, a base unit without price, other products’ units and outsiders', async () => {
    const entry = { list: 'WHOLESALE', productUnitId: pcs(cola), price: '1000' };
    const past = await setPrices(admin, {
      productId: cola.id,
      validFrom: addDays(today, -1),
      entries: [entry],
    }).expect(422);
    expect(past.body.errors).toEqual([expect.objectContaining({ path: 'validFrom' })]);
    const cleared = await setPrices(admin, {
      productId: cola.id,
      validFrom: today,
      entries: [{ ...entry, price: null }],
    }).expect(422);
    expect(cleared.body.errors).toEqual([expect.objectContaining({ path: 'entries.0.price' })]);
    await setPrices(admin, {
      productId: juice.id,
      validFrom: today,
      entries: [entry],
    }).expect(404);
    await setPrices(admin, {
      productId: cola.id,
      validFrom: today,
      entries: [{ ...entry, price: '1000.5' }],
    }).expect(422);
    await setPrices(admin, {
      productId: cola.id,
      validFrom: today,
      entries: [entry, entry],
    }).expect(422);
    await setPrices(office, { productId: cola.id, validFrom: today, entries: [entry] }).expect(403);
    const unkeyed = await http()
      .post('/api/v1/unit-prices')
      .set(bearer(admin))
      .send({ productId: cola.id, validFrom: today, entries: [entry] })
      .expect(400);
    expect(unkeyed.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('serves the base unit prices of many products for list columns', async () => {
    const res = await http()
      .get('/api/v1/unit-prices/current')
      .query({ productIds: [cola.id, juice.id] })
      .set(bearer(office))
      .expect(200);
    expect(res.body).toEqual([
      { productId: cola.id, list: 'RETAIL', productUnitId: pcs(cola), price: '1200' },
      { productId: cola.id, list: 'WHOLESALE', productUnitId: pcs(cola), price: '990' },
    ]);
  });

  it('keeps discount programs: no two new prices at once, edits before the start, stops after', async () => {
    const boxPrice = {
      name: 'Кока бөөний үнэ',
      list: 'WHOLESALE',
      scope: 'PRODUCT',
      measure: 'QTY',
      effect: 'PRICE',
      productId: cola.id,
      productUnitId: box(cola),
      thresholdUnitId: box(cola),
      validFrom: today,
      steps: [{ threshold: '240', value: '22800' }],
    };
    const created = (await createProgram(admin, boxPrice).expect(201)).body as ProgramJson;
    expect(created).toMatchObject({
      status: 'ACTIVE',
      product: { id: cola.id, sku: '10' },
      productUnit: { id: box(cola), factorToBase: '24' },
      steps: [{ threshold: '240', value: '22800' }],
    });
    const overlap = await createProgram(admin, {
      ...boxPrice,
      name: 'Давхар',
      validFrom: addDays(today, 1),
    }).expect(409);
    expect(overlap.body.code).toBe('DISCOUNT_PROGRAM_OVERLAP');
    const category = {
      name: 'Ундааны хямдрал',
      list: 'WHOLESALE',
      scope: 'CATEGORY',
      measure: 'QTY',
      effect: 'PERCENT',
      categoryId: drinks,
      countUomId: boxUom,
      validFrom: addDays(today, 3),
      validTo: addDays(today, 30),
      steps: [{ threshold: '50', value: '2' }],
    };
    const wrongShape = await createProgram(admin, { ...category, effect: 'PRICE' }).expect(422);
    expect(wrongShape.body.errors).toEqual([expect.objectContaining({ path: 'effect' })]);
    const wrongStep = await createProgram(admin, {
      ...category,
      steps: [{ threshold: '50', value: '100' }],
    }).expect(422);
    expect(wrongStep.body.errors).toEqual([expect.objectContaining({ path: 'steps.0' })]);
    await createProgram(admin, { ...category, validFrom: addDays(today, -1) }).expect(422);
    await createProgram(office, category).expect(403);

    const later = (await createProgram(admin, category).expect(201)).body as ProgramJson;
    expect(later.status).toBe('SCHEDULED');
    const edited = await http()
      .put(`/api/v1/discount-programs/${later.id}`)
      .set(bearer(admin))
      .send({ ...category, steps: [{ threshold: '50', value: '3' }] })
      .expect(200);
    expect(edited.body.steps).toEqual([{ threshold: '50', value: '3' }]);
    await http().delete(`/api/v1/discount-programs/${later.id}`).set(bearer(admin)).expect(204);

    const started = await http()
      .put(`/api/v1/discount-programs/${created.id}`)
      .set(bearer(admin))
      .send(boxPrice)
      .expect(409);
    expect(started.body.code).toBe('DISCOUNT_PROGRAM_STARTED');
    await http().delete(`/api/v1/discount-programs/${created.id}`).set(bearer(admin)).expect(409);
    const stopped = await http()
      .post(`/api/v1/discount-programs/${created.id}/stop`)
      .set(bearer(admin))
      .expect(200);
    expect(stopped.body).toMatchObject({ status: 'ENDED', validTo: today });
    const active = await http()
      .get('/api/v1/discount-programs')
      .query({ status: 'ACTIVE' })
      .set(bearer(office))
      .expect(200);
    expect(active.body.data).toEqual([]);
    const actions = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'discount_programs' ORDER BY id`,
    );
    expect(actions.rows.map((row) => row.action)).toEqual([
      'CREATE',
      'CREATE',
      'UPDATE',
      'DELETE',
      'STOP',
    ]);
  });

  it('prices a cart through every stage: the owner’s example (ADR-0041 #3)', async () => {
    await setPrices(admin, {
      productId: cola.id,
      validFrom: today,
      entries: [{ list: 'WHOLESALE', productUnitId: box(cola), price: '24000' }],
    }).expect(200);
    for (const program of [
      {
        name: 'Бөөний',
        scope: 'PRODUCT',
        measure: 'QTY',
        effect: 'PRICE',
        productId: cola.id,
        productUnitId: box(cola),
        steps: [{ threshold: '240', value: '22800' }],
      },
      {
        name: 'Ундаа',
        scope: 'CATEGORY',
        measure: 'QTY',
        effect: 'PERCENT',
        categoryId: drinks,
        countUomId: boxUom,
        steps: [{ threshold: '50', value: '2' }],
      },
      {
        name: 'Их захиалга',
        scope: 'ORDER',
        measure: 'AMOUNT',
        effect: 'PERCENT',
        steps: [{ threshold: '1000000', value: '1' }],
      },
    ]) {
      await createProgram(admin, { list: 'WHOLESALE', validFrom: today, ...program }).expect(201);
    }

    const res = await quote({
      lines: [
        { productUnitId: box(cola), qty: '50' },
        { productUnitId: pcs(water), qty: '3' },
        { productUnitId: box(juice), qty: '1' },
      ],
    }).expect(200);
    const result = res.body as QuoteJson;
    expect(result.lines[0]).toMatchObject({
      priced: true,
      listPrice: '24000',
      unitPrice: '22800',
      subtotal: '1140000',
      discountAmount: '33972',
      total: '1106028',
      applied: [
        expect.objectContaining({ name: 'Бөөний', value: '22800', amount: null }),
        expect.objectContaining({ name: 'Ундаа', value: '2', amount: '22800' }),
        expect.objectContaining({ name: 'Их захиалга', value: '1', amount: '11172' }),
      ],
    });
    expect(result.lines.slice(1)).toEqual([
      expect.objectContaining({ priced: false, problem: 'PRICE_MISSING', total: null }),
      expect.objectContaining({ priced: false, problem: 'PRICE_MISSING' }),
    ]);
    expect(result).toMatchObject({ subtotal: '1140000', discountTotal: '33972', total: '1106028' });

    // The supermarket: its own prices and no wholesale programs.
    const retail = (
      await quote({ list: 'RETAIL', lines: [{ productUnitId: box(cola), qty: '2' }] }).expect(200)
    ).body as QuoteJson;
    expect(retail).toMatchObject({ total: '57600', discountTotal: '0' });

    // A price planned for next week is quoted for that day.
    await setPrices(admin, {
      productId: cola.id,
      validFrom: addDays(today, 7),
      entries: [{ list: 'WHOLESALE', productUnitId: box(cola), price: '25000' }],
    }).expect(200);
    const nextWeek = (
      await quote({
        date: addDays(today, 7),
        lines: [{ productUnitId: box(cola), qty: '1' }],
      }).expect(200)
    ).body as QuoteJson;
    expect(nextWeek.lines[0]).toMatchObject({ listPrice: '25000', unitPrice: '25000' });

    expect(
      (await quote({ lines: [{ productUnitId: pcs(cola), qty: '1.5' }] }).expect(422)).body.code,
    ).toBe('UNIT_FACTOR_INEXACT');
    await quote({ lines: [{ productUnitId: 999_999, qty: '1' }] }).expect(404);
  });

  it('ends a superseded unit’s prices and programs; the new unit takes the base price', async () => {
    await setPrices(admin, {
      productId: juice.id,
      validFrom: today,
      entries: [
        { list: 'WHOLESALE', productUnitId: pcs(juice), price: '1200' },
        { list: 'WHOLESALE', productUnitId: box(juice), price: '13000' },
      ],
    }).expect(200);
    const program = (
      await createProgram(admin, {
        name: 'Шүүсний хайрцаг',
        list: 'WHOLESALE',
        scope: 'PRODUCT',
        measure: 'QTY',
        effect: 'AMOUNT',
        productId: juice.id,
        productUnitId: box(juice),
        validFrom: today,
        steps: [{ threshold: '0', value: '500' }],
      }).expect(201)
    ).body as ProgramJson;
    const oldBox = box(juice);
    await http()
      .post(`/api/v1/product-units/${oldBox}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '10' })
      .expect(201);
    juice = await catalogApi(app, admin).get(juice.id);

    expect(currentOf((await pricesOf(juice.id)).wholesale)).toEqual(['1200 UNIT', '12000 DERIVED']);
    const ended = await http()
      .get(`/api/v1/discount-programs/${program.id}`)
      .set(bearer(office))
      .expect(200);
    expect(ended.body.status).toBe('ENDED');
    const system = await sql.query<{ entity: string; action: string }>(
      `SELECT entity, action FROM audit_log WHERE actor_label = 'unit-superseded' ORDER BY id`,
    );
    expect(system.rows).toEqual([
      { entity: 'unit_prices', action: 'CLOSE' },
      { entity: 'discount_programs', action: 'STOP' },
    ]);
    const superseded = await quote({ lines: [{ productUnitId: oldBox, qty: '1' }] }).expect(409);
    expect(superseded.body.code).toBe('UNIT_SUPERSEDED');
  });
});
