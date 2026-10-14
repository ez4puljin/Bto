import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { ProductBulkService } from '../../src/modules/catalog';
import { systemActor } from '../../src/modules/identity';
import { ProductLocationsService } from '../../src/modules/inventory';
import { ProductSuppliersService } from '../../src/modules/partners';
import { ProductPricesService } from '../../src/modules/pricing';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi, staffContext } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingServices } from '../harness/pricing';

const COUNT = 40;

/**
 * Bulk product edits under concurrency (ADR-0051 #2): every writer takes its locks in id order, so
 * two bulk changes over the same products in opposite orders, or a bulk change beside a single
 * one, wait for each other instead of deadlocking, and the invariants hold after both: one main
 * supplier and one home per product, no overlapping price terms.
 */
describe('integrity: bulk edits under concurrency', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let ids: number[];
  let categories: number[];
  let suppliers: number[];
  let token: string;
  const actor = systemActor('integrity-test');

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const user = await seedUser(app, { roles: ['ADMIN'] });
    token = (await login(app, user)).accessToken;
    const catalog = catalogApi(app, token);
    categories = [await catalog.category('Нэг'), await catalog.category('Хоёр')];
    const pcs = await catalog.uomId('PCS');
    ids = [];
    for (let index = 0; index < COUNT; index += 1) {
      ids.push(
        (
          await catalog.product({
            name: `Зэрэг ${index}`,
            categoryId: categories[0] ?? 0,
            baseUomId: pcs,
          })
        ).id,
      );
    }
    const partners = partnersApi(app, token);
    suppliers = [
      (await partners.supplier({ name: 'Нэгдүгээр' })).id,
      (await partners.supplier({ name: 'Хоёрдугаар' })).id,
    ];
    ctx = staffContext(user.id, 'ADMIN');
    const inventory = inventoryApi(app, token);
    warehouses = [(await inventory.warehouse('RC1')).id, (await inventory.warehouse('RC2')).id];
  });
  let ctx: ReturnType<typeof staffContext>;
  let warehouses: number[];
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('runs bulk status and category changes in opposite orders beside a single edit', async () => {
    const bulk = app.get(ProductBulkService);
    const reversed = [...ids].reverse();
    const results = await Promise.allSettled([
      bulk.setCategory(actor, ids, categories[1] ?? 0),
      bulk.setStatus(actor, reversed, 'INACTIVE'),
      request(app.getHttpServer())
        .patch(`/api/v1/products/${ids[COUNT - 1] ?? 0}`)
        .set(bearer(token))
        .send({ name: 'Ганцаар засварласан' })
        .expect(200),
      bulk.setCategory(actor, reversed, categories[0] ?? 0),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
    const { rows } = await sql.query<{ status: string; categories: string }>(
      `SELECT min(status) AS status, count(DISTINCT category_id)::text AS categories
         FROM products WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    expect(rows[0]).toEqual({ status: 'INACTIVE', categories: '1' });
  });

  it('keeps one main supplier per product when two bulk changes race', async () => {
    const links = app.get(ProductSuppliersService);
    const results = await Promise.allSettled([
      links.setMainMany(actor, ids, suppliers[0] ?? 0),
      links.setMainMany(actor, [...ids].reverse(), suppliers[1] ?? 0),
      links.link(actor, ids[0] ?? 0, suppliers[1] ?? 0),
    ]);
    // The single link may lose to a bulk change that linked the same pair first.
    expect(results.slice(0, 2).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const { rows } = await sql.query<{ product_id: string; mains: string }>(
      `SELECT product_id::text, count(*) FILTER (WHERE is_main)::text AS mains
         FROM product_suppliers WHERE product_id = ANY($1::bigint[]) GROUP BY product_id`,
      [ids],
    );
    expect(rows).toHaveLength(COUNT);
    expect(rows.every((row) => row.mains === '1')).toBe(true);
  });

  it('never overlaps price terms when a bulk profile change meets a single price change', async () => {
    const pricing = pricingServices(app, actor);
    const first = await pricing.profile('Нэгдүгээр');
    const second = await pricing.profile('Хоёрдугаар');
    for (const id of ids) await pricing.terms(id, '1000', first, null);
    const prices = app.get(ProductPricesService);
    const tomorrow = addDays(businessDate(), 1);
    const results = await Promise.allSettled([
      prices.setProfileMany(actor, { productIds: ids, profileId: second, validFrom: tomorrow }),
      prices.set(actor, {
        productId: ids[COUNT - 1] ?? 0,
        validFrom: tomorrow,
        warehousePrice: new Decimal(1500),
        profileId: first,
        wholeUomId: null,
      }),
      prices.setProfileMany(actor, {
        productIds: [...ids].reverse(),
        profileId: first,
        validFrom: tomorrow,
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    // The EXCLUDE constraint would have refused an overlap; every product has terms tomorrow.
    const { rows } = await sql.query<{ products: string }>(
      `SELECT count(DISTINCT product_id)::text AS products FROM product_prices
        WHERE product_id = ANY($1::bigint[]) AND valid_from <= $2::date
          AND (valid_to IS NULL OR valid_to > $2::date)`,
      [ids, tomorrow],
    );
    expect(rows[0]?.products).toBe(String(COUNT));
  });

  it('keeps one home per product when bulk moves race with a single one', async () => {
    const locations = app.get(ProductLocationsService);
    const results = await Promise.allSettled([
      locations.setHomeMany(ctx, {
        productIds: ids,
        warehouseId: warehouses[0] ?? 0,
        dryRun: false,
      }),
      locations.setHomeMany(ctx, {
        productIds: [...ids].reverse(),
        warehouseId: warehouses[1] ?? 0,
        dryRun: false,
      }),
      locations.setHome(ctx, ids[0] ?? 0, warehouses[0] ?? 0),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    const { rows } = await sql.query<{ homes: string }>(
      `SELECT count(*) FILTER (WHERE is_home)::text AS homes
         FROM product_locations WHERE product_id = ANY($1::bigint[]) GROUP BY product_id`,
      [ids],
    );
    expect(rows).toHaveLength(COUNT);
    expect(rows.every((row) => row.homes === '1')).toBe(true);
  });
});
