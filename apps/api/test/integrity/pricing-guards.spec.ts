import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { systemActor } from '../../src/modules/identity';
import { PriceProfilesService, ProductPricesService } from '../../src/modules/pricing';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { catalogApi, codeOf, type ProductJson, unitOf } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';
import { pricingServices } from '../harness/pricing';

const DENIED = '42501';
const RESTRICT = '23001';
const EXCLUSION = '23P01';
const CHECK = '23514';

/**
 * The pricing guards (ADR-0041, ADR-0048): the history of price terms and profile versions cannot
 * be rewritten or deleted, even by the migrator for rewrites; a product has one set of terms and a
 * profile one version per day; a unit has one new-price program per day; concurrent changes never
 * overlap; archiving a profile and choosing it wait for each other. If a trigger, a REVOKE or an
 * EXCLUDE is ever lost, this suite fails.
 */
describe('integrity: pricing guards', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let migrator: Client;
  let catalog: ReturnType<typeof catalogApi>;
  let product: ProductJson;
  let box: number;
  let boxUom: number;
  let category: number;
  let pcsUom: number;
  let profile: number;
  const today = businessDate();
  const actor = systemActor('integrity-test');

  const insertTerms = (
    productId: number,
    price: number,
    from: string,
    to: string | null,
    wholeUomId: number | null = boxUom,
  ) =>
    sql.query<{ id: string }>(
      `INSERT INTO product_prices (product_id, warehouse_price, profile_id, whole_uom_id, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
      [productId, price, profile, wholeUomId, from, to],
    );
  const insertVersion = (
    from: string,
    to: string | null,
    values: {
      loose?: number;
      retail?: number;
      bulkQty?: number | null;
      bulk?: number | null;
      rounding?: string;
    } = {},
  ) =>
    sql.query<{ id: string }>(
      `INSERT INTO price_profile_versions (profile_id, loose_markup_pct, retail_markup_pct,
                                           retail_bulk_min_qty, retail_bulk_markup_pct, rounding,
                                           valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
      [
        profile,
        values.loose ?? 15,
        values.retail ?? 30,
        values.bulkQty === undefined ? 24 : values.bulkQty,
        values.bulk === undefined ? 20 : values.bulk,
        values.rounding ?? 'WHOLE',
        from,
        to,
      ],
    );
  const plainProduct = (sku: string) =>
    catalog.product({
      sku,
      name: `Үнийн хамгаалалт ${sku}`,
      categoryId: category,
      baseUomId: pcsUom,
    });

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    migrator = await connectAs('migrator');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    catalog = catalogApi(app, admin);
    boxUom = await catalog.uomId('BOX');
    pcsUom = await catalog.uomId('PCS');
    category = await catalog.category('Integrity');
    product = await catalog.product({
      sku: '70001',
      name: 'Үнийн хамгаалалт',
      categoryId: category,
      baseUomId: pcsUom,
      units: [{ uomId: boxUom, factorToBase: '24' }],
    });
    box = unitOf(product, 'BOX').id;
    profile = await pricingServices(app, actor).profile('Хамгаалалт');
  });
  afterAll(async () => {
    await migrator.end();
    await sql.end();
    await app.close();
  });

  it('lets terms and versions only move their end earlier, and never be deleted', async () => {
    const { rows } = await insertTerms(product.id, 1000, today, null);
    const id = rows[0]?.id;
    const update = (client: Client, set: string) =>
      sqlStateOf(client.query(`UPDATE product_prices SET ${set} WHERE id = $1`, [id]));
    expect(await update(sql, 'warehouse_price = 1100')).toBe(RESTRICT);
    expect(await update(migrator, 'warehouse_price = 1100')).toBe(RESTRICT);
    expect(await update(sql, `valid_from = '${addDays(today, 1)}'`)).toBe(RESTRICT);
    expect(await update(sql, 'whole_uom_id = NULL')).toBe(RESTRICT);
    expect(await update(sql, 'created_at = now()')).toBe(RESTRICT);
    expect(await update(sql, `valid_to = '${addDays(today, 10)}'`)).toBeUndefined();
    expect(await update(sql, `valid_to = '${addDays(today, 20)}'`)).toBe(RESTRICT);
    expect(await update(sql, 'valid_to = NULL')).toBe(RESTRICT);
    expect(await update(sql, `valid_to = '${addDays(today, 5)}'`)).toBeUndefined();
    expect(await update(sql, `valid_to = '${addDays(today, -1)}'`)).toBe(CHECK);
    expect(await sqlStateOf(sql.query('DELETE FROM product_prices WHERE id = $1', [id]))).toBe(
      DENIED,
    );
    expect(await sqlStateOf(sql.query('TRUNCATE product_prices'))).toBe(DENIED);

    const version = (
      await sql.query<{ id: string }>(
        'SELECT id::text FROM price_profile_versions WHERE profile_id = $1',
        [profile],
      )
    ).rows[0]?.id;
    const change = (client: Client, set: string) =>
      sqlStateOf(client.query(`UPDATE price_profile_versions SET ${set} WHERE id = $1`, [version]));
    expect(await change(sql, 'loose_markup_pct = 16')).toBe(RESTRICT);
    expect(await change(migrator, 'rounding = $$UP_10$$')).toBe(RESTRICT);
    expect(
      await sqlStateOf(sql.query('DELETE FROM price_profile_versions WHERE id = $1', [version])),
    ).toBe(DENIED);
    expect(await sqlStateOf(sql.query('DELETE FROM price_profiles WHERE id = $1', [profile]))).toBe(
      DENIED,
    );
    expect(await sqlStateOf(sql.query('TRUNCATE price_profiles CASCADE'))).toBe(DENIED);
  });

  it('never holds two terms of a product or two versions of a profile on one day', async () => {
    const other = await plainProduct('70002');
    await insertTerms(other.id, 1000, today, addDays(today, 5), null);
    expect(await sqlStateOf(insertTerms(other.id, 1100, addDays(today, 4), null, null))).toBe(
      EXCLUSION,
    );
    expect(
      await sqlStateOf(insertTerms(other.id, 1100, addDays(today, 5), null, null)),
    ).toBeUndefined();
    // A row closed on its first day never applied and overlaps nothing.
    expect(
      await sqlStateOf(insertTerms(other.id, 900, addDays(today, 2), addDays(today, 2), null)),
    ).toBeUndefined();
    expect(await sqlStateOf(insertTerms(other.id, 100.5, addDays(today, 50), null, null))).toBe(
      CHECK,
    );

    // The service made an open version from today: another one later overlaps it.
    expect(await sqlStateOf(insertVersion(addDays(today, 3), null))).toBe(EXCLUSION);
    const later = addDays(today, 400);
    expect(await sqlStateOf(insertVersion(later, later, { bulk: 30 }))).toBe(CHECK);
    expect(await sqlStateOf(insertVersion(later, later, { bulk: null }))).toBe(CHECK);
    expect(await sqlStateOf(insertVersion(later, later, { loose: -1 }))).toBe(CHECK);
    expect(await sqlStateOf(insertVersion(later, later, { rounding: 'UP_20' }))).toBe(CHECK);
    expect(
      await sqlStateOf(insertVersion(later, later, { bulkQty: null, bulk: null })),
    ).toBeUndefined();
  });

  it('never holds two new-price programs for a unit on one day; other effects may overlap', async () => {
    const program = (effect: string, from: string, to: string | null, unit: number | null = box) =>
      sql.query(
        `INSERT INTO discount_programs (name, list, scope, measure, effect, product_id, product_unit_id,
                                        valid_from, valid_to)
         VALUES ('P', 'WHOLESALE', 'PRODUCT', 'QTY', $1, $2, $3, $4, $5)`,
        [effect, product.id, unit, from, to],
      );
    await program('PRICE', today, addDays(today, 10));
    expect(await sqlStateOf(program('PRICE', addDays(today, 9), null))).toBe(EXCLUSION);
    expect(await sqlStateOf(program('PRICE', addDays(today, 10), null))).toBeUndefined();
    expect(await sqlStateOf(program('PERCENT', today, null))).toBeUndefined();
    expect(await sqlStateOf(program('PERCENT', today, null))).toBeUndefined();
    expect(await sqlStateOf(program('PRICE', today, null, null))).toBe(CHECK);
    expect(
      await sqlStateOf(
        sql.query(
          `INSERT INTO discount_programs (name, list, scope, measure, effect, product_id, valid_from)
           VALUES ('O', 'WHOLESALE', 'ORDER', 'AMOUNT', 'PERCENT', $1, $2)`,
          [product.id, today],
        ),
      ),
    ).toBe(CHECK);
  });

  it('serialises concurrent changes of a product’s terms: no overlap', async () => {
    const item = await plainProduct('70003');
    const prices = app.get(ProductPricesService);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        prices.set(actor, {
          productId: item.id,
          validFrom: index % 2 === 0 ? today : addDays(today, 3),
          warehousePrice: new Decimal(1_000 + index),
          profileId: profile,
          wholeUomId: null,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    const { rows } = await sql.query<{ valid_from: string; valid_to: string | null }>(
      `SELECT valid_from::text, valid_to::text FROM product_prices
        WHERE product_id = $1 AND (valid_to IS NULL OR valid_to > valid_from)
        ORDER BY valid_from`,
      [item.id],
    );
    // Contiguous from today: one row up to the third day, one from it on.
    expect(rows).toEqual([
      { valid_from: today, valid_to: addDays(today, 3) },
      { valid_from: addDays(today, 3), valid_to: null },
    ]);
  });

  it('lets archiving a profile and choosing it wait for each other', async () => {
    const item = await plainProduct('70004');
    const contested = await pricingServices(app, actor).profile('Маргаантай');
    const outcomes = await Promise.all([
      codeOf(app.get(PriceProfilesService).archive(actor, contested)),
      codeOf(
        app.get(ProductPricesService).set(actor, {
          productId: item.id,
          validFrom: today,
          warehousePrice: new Decimal(1000),
          profileId: contested,
          wholeUomId: null,
        }),
      ),
    ]);
    const [archive, choose] = outcomes;
    const { rows } = await sql.query<{ archived: boolean; used: string }>(
      `SELECT archived_at IS NOT NULL AS archived,
              (SELECT count(*) FROM product_prices WHERE profile_id = $1)::text AS used
         FROM price_profiles WHERE id = $1`,
      [contested],
    );
    // Whichever came first won; the other saw it.
    if (rows[0]?.archived) {
      expect([archive, choose]).toEqual([undefined, 'PRICE_PROFILE_ARCHIVED']);
      expect(rows[0]?.used).toBe('0');
    } else {
      expect([archive, choose]).toEqual(['PRICE_PROFILE_IN_USE', undefined]);
      expect(rows[0]?.used).toBe('1');
    }
  });
});
