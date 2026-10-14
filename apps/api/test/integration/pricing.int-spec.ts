import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { PROFILE_BODY, pricingApi } from '../harness/pricing';

interface VersionJson {
  looseMarkupPct: string;
  retailMarkupPct: string;
  retailBulkMinQty: string | null;
  retailBulkMarkupPct: string | null;
  rounding: string;
  validFrom: string;
  validTo: string | null;
}
interface ProfileJson {
  id: number;
  name: string;
  archivedAt: string | null;
  current: VersionJson | null;
  scheduled: VersionJson[];
  history: VersionJson[];
  productsToday: number;
}
interface TermsJson {
  warehousePrice: string;
  profileId: number;
  profileName: string;
  wholeUomId: number | null;
  validFrom: string;
  validTo: string | null;
}
interface PriceViewJson {
  current: TermsJson | null;
  wholeUnitId: number | null;
  problems: string[];
  table: {
    productUnitId: number;
    wholesale: string;
    wholesaleBasis: string;
    retail: string;
    retailBulk: string | null;
  }[];
  scheduled: TermsJson[];
  history: TermsJson[];
}
interface ProgramJson {
  id: number;
  status: string;
  validFrom: string;
  validTo: string | null;
  steps: { threshold: string; value: string }[];
}
interface PartJson {
  productUnitId: number;
  basis: string;
  qty: string;
  listPrice: string;
  unitPrice: string;
  total: string;
  applied: { name: string; value: string; amount: string | null }[];
}
interface QuoteLineJson {
  priced: boolean;
  problem: string | null;
  parts: PartJson[];
  subtotal: string | null;
  discountAmount: string | null;
  total: string | null;
}
interface QuoteJson {
  lines: QuoteLineJson[];
  subtotal: string;
  discountTotal: string;
  total: string;
}

/** A line's parts as "qty×unit basis listPrice→unitPrice = total". */
const partsOf = (line: QuoteLineJson | undefined) =>
  (line?.parts ?? []).map(
    (part) =>
      `${part.qty}×${part.productUnitId} ${part.basis} ${part.listPrice}→${part.unitPrice} = ${part.total}`,
  );

/** Price profiles, price terms, discount programs and quotes (SPEC §5.6, ADR-0041, ADR-0048). */
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
  let fresh: ProductJson;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const box = (product: ProductJson) => unitOf(product, 'BOX').id;
  const pricing = () => pricingApi(app, admin);

  const createProfile = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/price-profiles').set(bearer(token)).set(idempotency()).send(body);
  const setVersion = (id: number, body: Record<string, unknown>) =>
    http()
      .post(`/api/v1/price-profiles/${id}/versions`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ ...PROFILE_BODY, ...body });
  const setTerms = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/product-prices').set(bearer(token)).set(idempotency()).send(body);
  const pricesOf = async (productId: number) =>
    (
      await http()
        .get('/api/v1/product-prices')
        .query({ productId })
        .set(bearer(office))
        .expect(200)
    ).body as PriceViewJson;
  const createProgram = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/discount-programs').set(bearer(token)).set(idempotency()).send(body);
  const quote = async (body: Record<string, unknown>) =>
    (await http().post('/api/v1/pricing/quote').set(bearer(office)).send(body).expect(200))
      .body as QuoteJson;
  const count = async (query: string, params: unknown[] = []) =>
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
    fresh = await catalog.product({ sku: '13', name: 'Шинэ', categoryId: drinks, baseUomId: base });
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('keeps a profile’s values by date, never rewriting them', async () => {
    const created = (
      await createProfile(admin, { name: 'Ундаа', validFrom: today, ...PROFILE_BODY }).expect(201)
    ).body as ProfileJson;
    expect(created).toMatchObject({
      name: 'Ундаа',
      archivedAt: null,
      productsToday: 0,
      current: {
        looseMarkupPct: '15.00',
        retailMarkupPct: '30.00',
        retailBulkMinQty: '24',
        retailBulkMarkupPct: '20.00',
        rounding: 'WHOLE',
        validFrom: today,
        validTo: null,
      },
      scheduled: [],
      history: [],
    });

    // A change in ten days, then one in five days slots in before it.
    await setVersion(created.id, { validFrom: addDays(today, 10), looseMarkupPct: '17' }).expect(
      200,
    );
    const planned = (
      await setVersion(created.id, { validFrom: addDays(today, 5), looseMarkupPct: '16' }).expect(
        200,
      )
    ).body as ProfileJson;
    expect(planned.current).toMatchObject({ looseMarkupPct: '15.00', validTo: addDays(today, 5) });
    expect(planned.scheduled).toEqual([
      expect.objectContaining({
        looseMarkupPct: '16.00',
        validFrom: addDays(today, 5),
        validTo: addDays(today, 10),
      }),
      expect.objectContaining({ looseMarkupPct: '17.00', validFrom: addDays(today, 10) }),
    ]);
    // The same values again change nothing.
    await setVersion(created.id, { validFrom: addDays(today, 5), looseMarkupPct: '16' }).expect(
      200,
    );

    // Changed again today: the morning's values never applied, so they are voided, not history.
    const again = (
      await setVersion(created.id, { validFrom: today, looseMarkupPct: '14' }).expect(200)
    ).body as ProfileJson;
    expect(again.current).toMatchObject({
      looseMarkupPct: '14.00',
      validFrom: today,
      validTo: addDays(today, 5),
    });
    expect(again.history).toEqual([]);
    expect(
      await count(
        'SELECT count(*)::text AS count FROM price_profile_versions WHERE profile_id = $1',
        [created.id],
      ),
    ).toBe('4');
    const actions = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'price_profiles' AND entity_id = $1 ORDER BY id`,
      [String(created.id)],
    );
    expect(actions.rows.map((row) => row.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE', 'UPDATE']);
  });

  it('refuses bad values, a past date, a live name twice and outsiders', async () => {
    const body = { name: 'Буруу', validFrom: today, ...PROFILE_BODY };
    const notBelow = await createProfile(admin, { ...body, retailBulkMarkupPct: '30' }).expect(422);
    expect(notBelow.body.errors).toEqual([
      expect.objectContaining({ path: 'retailBulkMarkupPct' }),
    ]);
    const unpaired = await createProfile(admin, { ...body, retailBulkMinQty: null }).expect(422);
    expect(unpaired.body.errors).toEqual([expect.objectContaining({ path: 'retailBulkMinQty' })]);
    await createProfile(admin, { ...body, looseMarkupPct: '1000' }).expect(422);
    await createProfile(admin, { ...body, validFrom: addDays(today, -1) }).expect(422);
    const twice = await createProfile(admin, { ...body, name: ' ундаа ' }).expect(409);
    expect(twice.body.code).toBe('DUPLICATE_VALUE');
    await createProfile(office, body).expect(403);
    const unkeyed = await http()
      .post('/api/v1/price-profiles')
      .set(bearer(admin))
      .send(body)
      .expect(400);
    expect(unkeyed.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('keeps a product’s price terms by date and computes its prices from the profile', async () => {
    const profile = await pricing().profile('Хүнс');
    const terms = {
      productId: cola.id,
      validFrom: today,
      warehousePrice: '1000',
      profileId: profile,
      wholeUomId: boxUom,
    };
    const view = (await setTerms(admin, terms).expect(200)).body as PriceViewJson;
    expect(view.current).toMatchObject({
      warehousePrice: '1000',
      profileId: profile,
      profileName: 'Хүнс',
      wholeUomId: boxUom,
      validFrom: today,
      validTo: null,
    });
    expect(view.problems).toEqual([]);
    expect(view.wholeUnitId).toBe(box(cola));
    expect(view.table).toEqual([
      {
        productUnitId: pcs(cola),
        wholesale: '1150',
        wholesaleBasis: 'LOOSE',
        retail: '1300',
        retailBulk: '1200',
      },
      {
        productUnitId: box(cola),
        wholesale: '24000',
        wholesaleBasis: 'WAREHOUSE',
        retail: '31200',
        retailBulk: '28800',
      },
    ]);
    // The same terms again change nothing; a change next week is planned.
    await setTerms(admin, terms).expect(200);
    const planned = (
      await setTerms(admin, {
        ...terms,
        validFrom: addDays(today, 7),
        warehousePrice: '1050',
      }).expect(200)
    ).body as PriceViewJson;
    expect(planned.current).toMatchObject({ warehousePrice: '1000', validTo: addDays(today, 7) });
    expect(planned.scheduled).toEqual([
      expect.objectContaining({
        warehousePrice: '1050',
        validFrom: addDays(today, 7),
        validTo: null,
      }),
    ]);
    // Changed again today: voided, not history.
    const again = (await setTerms(admin, { ...terms, warehousePrice: '990' }).expect(200))
      .body as PriceViewJson;
    expect(again.current).toMatchObject({ warehousePrice: '990', validTo: addDays(today, 7) });
    expect(again.history).toEqual([]);
    expect(
      await count(
        'SELECT count(*)::text AS count FROM product_prices WHERE product_id = $1 AND valid_to = valid_from',
        [cola.id],
      ),
    ).toBe('1');
    expect(
      await count(
        `SELECT count(*)::text AS count FROM audit_log WHERE entity = 'product_prices' AND entity_id = $1`,
        [String(cola.id)],
      ),
    ).toBe('3');

    const columns = await http()
      .get('/api/v1/product-prices/current')
      .query({ productIds: [cola.id, juice.id] })
      .set(bearer(office))
      .expect(200);
    expect(columns.body).toEqual([
      {
        productId: cola.id,
        warehousePrice: '990',
        profileId: profile,
        profileName: 'Хүнс',
        wholeUomId: boxUom,
      },
    ]);
    const used = await http()
      .get(`/api/v1/price-profiles/${profile}`)
      .set(bearer(office))
      .expect(200);
    expect(used.body.productsToday).toBe(1);
  });

  it('refuses a missing or stale whole unit, a profile without values yet, an archived one', async () => {
    const profile = await pricing().profile('Тамхи');
    const body = {
      productId: cola.id,
      validFrom: today,
      warehousePrice: '1000',
      profileId: profile,
      wholeUomId: boxUom,
    };
    const unchosen = await setTerms(admin, { ...body, wholeUomId: null }).expect(422);
    expect(unchosen.body.errors).toEqual([expect.objectContaining({ path: 'wholeUomId' })]);
    const noPacks = await setTerms(admin, { ...body, productId: water.id }).expect(422);
    expect(noPacks.body.errors).toEqual([expect.objectContaining({ path: 'wholeUomId' })]);
    const later = await pricing().profile('Дараа', { validFrom: addDays(today, 3) });
    const early = await setTerms(admin, { ...body, profileId: later }).expect(422);
    expect(early.body.errors).toEqual([expect.objectContaining({ path: 'profileId' })]);
    await setTerms(admin, { ...body, validFrom: addDays(today, -1) }).expect(422);
    await setTerms(admin, { ...body, warehousePrice: '1000.5' }).expect(422);
    await setTerms(office, body).expect(403);

    // A profile in use stays; an unused one is archived and can no longer be chosen.
    await pricing().terms(water.id, '800', profile, null);
    const inUse = await http()
      .post(`/api/v1/price-profiles/${profile}/archive`)
      .set(bearer(admin))
      .expect(409);
    expect(inUse.body).toMatchObject({ code: 'PRICE_PROFILE_IN_USE', params: { count: 1 } });
    const unused = await pricing().profile('Хэрэггүй');
    const archived = await http()
      .post(`/api/v1/price-profiles/${unused}/archive`)
      .set(bearer(admin))
      .expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
    const chosen = await setTerms(admin, { ...body, profileId: unused }).expect(409);
    expect(chosen.body.code).toBe('PRICE_PROFILE_ARCHIVED');
    const live = await http().get('/api/v1/price-profiles').set(bearer(office)).expect(200);
    expect((live.body.data as ProfileJson[]).map((row) => row.name)).not.toContain('Хэрэггүй');
    const gone = await http()
      .get('/api/v1/price-profiles')
      .query({ archived: true })
      .set(bearer(office))
      .expect(200);
    expect((gone.body.data as ProfileJson[]).map((row) => row.name)).toEqual(['Хэрэггүй']);
    // An archived name is free again.
    await pricing().profile('Хэрэггүй');
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

  it('prices a cart in parts through every stage: the owner’s examples (ADR-0048 #4)', async () => {
    const profile = await pricing().profile('Ундааны үнэ');
    await pricing().terms(cola.id, '1000', profile, boxUom);
    await pricing().terms(juice.id, '1100', profile, boxUom);
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

    // 50 boxes of 24: 24,000 → 22,800 → −2 % → −1 % = 1,106,028.
    const big = await quote({
      lines: [
        { productUnitId: box(cola), qty: '50' },
        { productUnitId: pcs(fresh), qty: '3' },
      ],
    });
    expect(partsOf(big.lines[0])).toEqual([`50×${box(cola)} WAREHOUSE 24000→22800 = 1106028`]);
    expect(big.lines[0]).toMatchObject({
      priced: true,
      subtotal: '1140000',
      discountAmount: '33972',
      total: '1106028',
    });
    expect(big.lines[0]?.parts[0]?.applied).toEqual([
      expect.objectContaining({ name: 'Бөөний', value: '22800', amount: null }),
      expect.objectContaining({ name: 'Ундаа', value: '2', amount: '22800' }),
      expect.objectContaining({ name: 'Их захиалга', value: '1', amount: '11172' }),
    ]);
    expect(big.lines[1]).toMatchObject({ priced: false, problem: 'PRICE_MISSING', parts: [] });
    expect(big).toMatchObject({ subtotal: '1140000', discountTotal: '33972', total: '1106028' });

    // 25 pieces with a box of 12: 2 boxes at the warehouse price and 1 loose piece.
    const mixed = await quote({ lines: [{ productUnitId: pcs(juice), qty: '25' }] });
    expect(partsOf(mixed.lines[0])).toEqual([
      `2×${box(juice)} WAREHOUSE 13200→13200 = 26400`,
      `1×${pcs(juice)} LOOSE 1265→1265 = 1265`,
    ]);
    expect(mixed.total).toBe('27665');

    // The supermarket: its own price, the bulk price from 24 pieces, and no wholesale programs.
    const few = await quote({ list: 'RETAIL', lines: [{ productUnitId: pcs(cola), qty: '10' }] });
    expect(partsOf(few.lines[0])).toEqual([`10×${pcs(cola)} RETAIL 1300→1300 = 13000`]);
    const many = await quote({ list: 'RETAIL', lines: [{ productUnitId: pcs(cola), qty: '30' }] });
    expect(partsOf(many.lines[0])).toEqual([`30×${pcs(cola)} RETAIL_BULK 1200→1200 = 36000`]);

    // The price planned for next week (1,050) is quoted for that day.
    const nextWeek = await quote({
      date: addDays(today, 7),
      lines: [{ productUnitId: box(cola), qty: '1' }],
    });
    expect(nextWeek.lines[0]?.parts[0]).toMatchObject({ listPrice: '25200', unitPrice: '25200' });

    const inexact = await http()
      .post('/api/v1/pricing/quote')
      .set(bearer(office))
      .send({ lines: [{ productUnitId: pcs(cola), qty: '1.5' }] })
      .expect(422);
    expect(inexact.body.code).toBe('UNIT_FACTOR_INEXACT');
    await http()
      .post('/api/v1/pricing/quote')
      .set(bearer(office))
      .send({ lines: [{ productUnitId: 999_999, qty: '1' }] })
      .expect(404);
  });

  it('follows a superseded box as the whole pack; a retired one leaves the warehouse price', async () => {
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

    // The new box of 10 is the whole pack at once: 1,100 × 10.
    const view = await pricesOf(juice.id);
    expect(view.problems).toEqual([]);
    expect(view.wholeUnitId).toBe(box(juice));
    expect(view.table.find((row) => row.productUnitId === box(juice))).toMatchObject({
      wholesale: '11000',
      wholesaleBasis: 'WAREHOUSE',
    });
    const ended = await http()
      .get(`/api/v1/discount-programs/${program.id}`)
      .set(bearer(office))
      .expect(200);
    expect(ended.body.status).toBe('ENDED');
    const system = await sql.query<{ entity: string; action: string }>(
      `SELECT entity, action FROM audit_log WHERE actor_label = 'unit-superseded' ORDER BY id`,
    );
    expect(system.rows).toEqual([{ entity: 'discount_programs', action: 'STOP' }]);
    const superseded = await http()
      .post('/api/v1/pricing/quote')
      .set(bearer(office))
      .send({ lines: [{ productUnitId: oldBox, qty: '1' }] })
      .expect(409);
    expect(superseded.body.code).toBe('UNIT_SUPERSEDED');

    // Retired without a successor: everything at the warehouse price, and the card says why.
    await http()
      .post(`/api/v1/product-units/${box(juice)}/retire`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    const retired = await pricesOf(juice.id);
    expect(retired.problems).toEqual(['GONE']);
    expect(retired.wholeUnitId).toBeNull();
    const loose = await quote({ lines: [{ productUnitId: pcs(juice), qty: '25' }] });
    expect(partsOf(loose.lines[0])).toEqual([`25×${pcs(juice)} WAREHOUSE 1100→1100 = 27500`]);
  });
});
