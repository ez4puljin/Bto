import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';
import { importsApi } from '../harness/imports';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

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

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
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
});
