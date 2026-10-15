import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';
import { importsApi } from '../harness/imports';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

const COUNT = 10_000;

/** A valid EAN-13 with the Mongolian GS1 prefix 865 and a running number. */
function ean13(index: number): string {
  const body = `865${String(index).padStart(9, '0')}`;
  const sum = [...body].reduce(
    (total, digit, at) => total + Number.parseInt(digit, 10) * (at % 2 === 0 ? 1 : 3),
    0,
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/**
 * The owner's catalogue at full size (ADR-0036 #3): 10,000 products with barcodes, a box unit, a
 * home warehouse and a supplier are checked and committed in one transaction holding a handful of
 * advisory locks, then their opening stock is posted as one adjustment. Timings are logged.
 */
describe('integrity: imports at scale', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let imports: ReturnType<typeof importsApi>;
  let admin: string;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    imports = importsApi(app, admin);
    await inventoryApi(app, admin).warehouse('WH1');
    await catalogApi(app, admin).category('Ундаа');
    await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('commits 10,000 products and their opening stock in one transaction each', async () => {
    const rows = Array.from({ length: COUNT }, (_, index) => ({
      sku: String(100_000 + index),
      name: `Бараа ${index}`,
      category: 'Ундаа',
      barcodes: ean13(index),
      boxQty: 12,
      boxBarcodes: ean13(COUNT + index),
      homeWarehouse: 'WH1',
      supplier: 'МСМ ХХК',
    }));
    let started = Date.now();
    const checked = await imports.check('PRODUCTS', rows);
    const checkSeconds = (Date.now() - started) / 1000;
    expect(checked).toMatchObject({ status: 'VALIDATED', totalRows: COUNT });
    started = Date.now();
    const committed = await imports.commit(checked.id);
    const commitSeconds = (Date.now() - started) / 1000;
    expect(committed.status).toBe('COMMITTED');
    expect(committed.summary?.advisoryLocks).toBeLessThanOrEqual(3);
    const { rows: counts } = await sql.query(
      `SELECT (SELECT count(*) FROM products)::int AS products,
              (SELECT count(*) FROM product_units)::int AS units,
              (SELECT count(*) FROM product_barcodes)::int AS barcodes,
              (SELECT count(*) FROM product_suppliers)::int AS links,
              (SELECT count(*) FROM product_locations WHERE is_home)::int AS homes`,
    );
    expect(counts[0]).toEqual({
      products: COUNT,
      units: COUNT * 2,
      barcodes: COUNT * 2,
      links: COUNT,
      homes: COUNT,
    });

    started = Date.now();
    const opening = await imports.check(
      'OPENING_STOCK',
      rows.map((row, index) => ({ warehouse: 'WH1', sku: row.sku, qty: (index % 7) + 1 })),
    );
    expect(opening.status).toBe('VALIDATED');
    const stocked = await imports.commit(opening.id);
    const openingSeconds = (Date.now() - started) / 1000;
    expect(stocked.status).toBe('COMMITTED');
    const { rows: stock } = await sql.query(
      `SELECT count(*)::int AS lines, sum(on_hand)::text AS total FROM bin_stock WHERE on_hand <> 0`,
    );
    expect(stock[0]).toEqual({ lines: COUNT, total: '39994.000' });
    // Logged for the delivery notes: the time an import of the whole catalogue takes here.
    console.log(
      `imports at scale: check ${checkSeconds}s, commit ${commitSeconds}s, opening stock ${openingSeconds}s`,
    );
    expect(checkSeconds + commitSeconds + openingSeconds).toBeLessThan(240);
  }, 600_000);

  it('prices the whole catalogue under one table lock while a single change waits (ADR-0054)', async () => {
    const pricing = pricingApi(app, admin);
    const profile = 'Бүх бараа';
    const profileId = await pricing.profile(profile);
    const idOf = async (query: string) =>
      Number.parseInt((await sql.query<{ id: string }>(query)).rows[0]?.id ?? '0', 10);
    const raced = await idOf(`SELECT id::text FROM products WHERE sku = '100000'`);
    const boxUom = await idOf(`SELECT id::text FROM uoms WHERE code = 'BOX'`);
    await pricing.terms(raced, '10', profileId, boxUom);

    let started = Date.now();
    const checked = await imports.check(
      'PRICES',
      Array.from({ length: COUNT }, (_, index) => ({
        sku: String(100_000 + index),
        warehousePrice: 1_000 + (index % 50),
        profile,
        wholePack: 'хайрцаг',
      })),
    );
    const checkSeconds = (Date.now() - started) / 1000;
    expect(checked.status).toBe('VALIDATED');
    started = Date.now();
    // A clerk changes one of the products while the commit runs: one waits for the other.
    const [committed] = await Promise.all([
      imports.commit(checked.id),
      pricing.terms(raced, '20', profileId, boxUom),
    ]);
    const commitSeconds = (Date.now() - started) / 1000;
    expect(committed.status).toBe('COMMITTED');
    expect(committed.summary?.advisoryLocks).toBe(1);
    expect(committed.summary?.applied).toMatchObject({ CREATE: COUNT - 1, UPDATE: 1 });
    const { rows: priced } = await sql.query(
      `SELECT count(DISTINCT product_id)::int AS products, count(*)::int AS rows
         FROM product_prices
        WHERE valid_from <= $1 AND (valid_to IS NULL OR valid_to > $1)`,
      [businessDate()],
    );
    expect(priced[0]).toEqual({ products: COUNT, rows: COUNT });
    const { rows: last } = await sql.query<{ price: string }>(
      `SELECT warehouse_price::text AS price FROM product_prices
        WHERE product_id = $1 AND valid_to IS NULL`,
      [raced],
    );
    expect(['1000.00', '20.00']).toContain(last[0]?.price);
    const { rows: waiting } = await sql.query(
      `SELECT count(*)::int AS count FROM products WHERE sale_ready_at IS NULL`,
    );
    expect(waiting[0]).toEqual({ count: 0 });

    started = Date.now();
    expect((await imports.revert(checked.id)).status).toBe('REVERTED');
    const revertSeconds = (Date.now() - started) / 1000;
    console.log(
      `price import at scale: check ${checkSeconds}s, commit ${commitSeconds}s, revert ${revertSeconds}s`,
    );
    expect(checkSeconds + commitSeconds + revertSeconds).toBeLessThan(180);
  }, 600_000);
});
