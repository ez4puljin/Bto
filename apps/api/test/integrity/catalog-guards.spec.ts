import type { Client } from 'pg';
import { connectAs } from '../harness/apps';

/** The hand-written guards of 0003_catalog exist (ADR-0008, ADR-0016); their behaviour is in catalog-schema. */
describe('integrity: catalog guards', () => {
  let app: Client;

  beforeAll(async () => {
    app = await connectAs('app');
  });
  afterAll(async () => {
    await app.end();
  });

  it('freezes product units and requires a base unit at commit', async () => {
    const { rows } = await app.query<{ name: string; deferrable: boolean }>(
      `SELECT t.tgname AS name, t.tgdeferrable AS deferrable
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname IN ('product_units', 'products') AND NOT t.tgisinternal
        ORDER BY t.tgname`,
    );
    expect(rows).toEqual([
      { name: 'product_units_immutable', deferrable: false },
      { name: 'products_base_unit_required', deferrable: true },
    ]);
  });

  it('never lets the app role delete or truncate products and units', async () => {
    const { rows } = await app.query<Record<string, boolean>>(
      `SELECT has_table_privilege('products', 'DELETE') AS products_delete,
              has_table_privilege('products', 'TRUNCATE') AS products_truncate,
              has_table_privilege('product_units', 'DELETE') AS units_delete,
              has_table_privilege('product_units', 'UPDATE') AS units_update`,
    );
    expect(rows[0]).toEqual({
      products_delete: false,
      products_truncate: false,
      units_delete: false,
      units_update: true,
    });
  });
});
