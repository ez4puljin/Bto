import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { systemActor } from '../../src/modules/identity';
import { UnitPricesService } from '../../src/modules/pricing';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { catalogApi, type ProductJson, unitOf } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';

const DENIED = '42501';
const RESTRICT = '23001';
const EXCLUSION = '23P01';
const CHECK = '23514';

/**
 * The pricing guards (ADR-0041): a price's history cannot be rewritten or deleted, even by the
 * migrator for rewrites; a unit has one price per list and day; a unit has one new-price program
 * per day; concurrent price changes of a unit never overlap. If a trigger, a REVOKE or an EXCLUDE
 * is ever lost, this suite fails.
 */
describe('integrity: pricing guards', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let migrator: Client;
  let product: ProductJson;
  let piece: number;
  let box: number;
  const today = businessDate();

  const insertPrice = (
    unitId: number,
    price: number,
    from: string,
    to: string | null,
    list = 'WHOLESALE',
  ) =>
    sql.query<{ id: string }>(
      `INSERT INTO unit_prices (list, product_unit_id, price, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
      [list, unitId, price, from, to],
    );

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    migrator = await connectAs('migrator');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    product = await catalog.product({
      sku: '70001',
      name: 'Үнийн хамгаалалт',
      categoryId: await catalog.category('Integrity'),
      baseUomId: await catalog.uomId('PCS'),
      units: [{ uomId: await catalog.uomId('BOX'), factorToBase: '24' }],
    });
    piece = unitOf(product, 'PCS').id;
    box = unitOf(product, 'BOX').id;
  });
  afterAll(async () => {
    await migrator.end();
    await sql.end();
    await app.close();
  });

  it('lets a price only move its end earlier, and never be deleted', async () => {
    const { rows } = await insertPrice(piece, 1000, today, null);
    const id = rows[0]?.id;
    const update = (client: Client, set: string) =>
      sqlStateOf(client.query(`UPDATE unit_prices SET ${set} WHERE id = $1`, [id]));
    expect(await update(sql, 'price = 1100')).toBe(RESTRICT);
    expect(await update(migrator, 'price = 1100')).toBe(RESTRICT);
    expect(await update(sql, `valid_from = '${addDays(today, 1)}'`)).toBe(RESTRICT);
    expect(await update(sql, `product_unit_id = ${box}`)).toBe(RESTRICT);
    expect(await update(sql, `list = 'RETAIL'`)).toBe(RESTRICT);
    expect(await update(sql, `valid_to = '${addDays(today, 10)}'`)).toBeUndefined();
    expect(await update(sql, `valid_to = '${addDays(today, 20)}'`)).toBe(RESTRICT);
    expect(await update(sql, 'valid_to = NULL')).toBe(RESTRICT);
    expect(await update(sql, `valid_to = '${addDays(today, 5)}'`)).toBeUndefined();
    expect(await update(sql, `valid_to = '${addDays(today, -1)}'`)).toBe(CHECK);
    expect(await sqlStateOf(sql.query('DELETE FROM unit_prices WHERE id = $1', [id]))).toBe(DENIED);
    expect(await sqlStateOf(sql.query('TRUNCATE unit_prices'))).toBe(DENIED);
  });

  it('never holds two prices of a unit in a list on one day', async () => {
    await insertPrice(box, 22_000, today, addDays(today, 5));
    expect(await sqlStateOf(insertPrice(box, 23_000, addDays(today, 4), null))).toBe(EXCLUSION);
    expect(await sqlStateOf(insertPrice(box, 23_000, addDays(today, 5), null))).toBeUndefined();
    expect(await sqlStateOf(insertPrice(box, 26_000, today, null, 'RETAIL'))).toBeUndefined();
    // A row closed on its first day never applied and overlaps nothing.
    expect(
      await sqlStateOf(insertPrice(box, 21_000, addDays(today, 2), addDays(today, 2))),
    ).toBeUndefined();
    expect(await sqlStateOf(insertPrice(box, 1, today, null))).toBe(EXCLUSION);
    expect(await sqlStateOf(insertPrice(piece, 999, '2026-01-01', '2026-01-01'))).toBeUndefined();
    expect(await sqlStateOf(insertPrice(box, 100.5, addDays(today, 50), null, 'RETAIL'))).toBe(
      CHECK,
    );
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

  it('serialises concurrent changes of a unit: one price in force, no overlap', async () => {
    const prices = app.get(UnitPricesService);
    const actor = systemActor('integrity-test');
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        prices.set(actor, {
          productId: product.id,
          validFrom: index % 2 === 0 ? today : addDays(today, 3),
          entries: [{ list: 'RETAIL', productUnitId: piece, price: new Decimal(1_000 + index) }],
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    const { rows } = await sql.query<{ valid_from: string; valid_to: string | null }>(
      `SELECT valid_from::text, valid_to::text FROM unit_prices
        WHERE list = 'RETAIL' AND product_unit_id = $1 AND (valid_to IS NULL OR valid_to > valid_from)
        ORDER BY valid_from`,
      [piece],
    );
    // Contiguous from today: one row up to the third day, one from it on.
    expect(rows).toEqual([
      { valid_from: today, valid_to: addDays(today, 3) },
      { valid_from: addDays(today, 3), valid_to: null },
    ]);
  });
});
