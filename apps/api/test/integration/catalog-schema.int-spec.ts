import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

const CHECK = '23514';
const UNIQUE = '23505';
const GUARD = '23001';
const DENIED = '42501';

/** Database-level rules of migration 0003_catalog, independent of the services (ADR-0016). */
describe('catalog schema constraints', () => {
  let app: Client;
  let migrator: Client;
  let pcs: string;
  let box: string;
  let category: string;
  let fileNo = 0;

  const one = async (sql: string, params: unknown[] = []) => {
    const { rows } = await app.query<{ id: string }>(sql, params);
    const id = rows[0]?.id;
    if (!id) throw new Error(`no row from ${sql}`);
    return id;
  };

  const insertProduct = (sku: string, column = '', value: unknown = null) =>
    one(
      `INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id${column ? `, ${column}` : ''})
       VALUES ($1, 'Бараа', ' бараа', ' bara', 1, $2${column ? ', $3' : ''}) RETURNING id`,
      column ? [sku, category, value] : [sku, category],
    );

  const unit = (productId: string, uomId: string, factor: string, isBase = false) =>
    one(
      `INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base) VALUES ($1, $2, $3, $4) RETURNING id`,
      [productId, uomId, factor, isBase],
    );

  /** A product and (unless `withBase` is false) its base unit in one transaction. */
  async function product(sku: string, withBase = true): Promise<string> {
    await app.query('BEGIN');
    try {
      const id = await insertProduct(sku);
      if (withBase) await unit(id, pcs, '1', true);
      await app.query('COMMIT');
      return id;
    } catch (error) {
      await app.query('ROLLBACK');
      throw error;
    }
  }

  const baseUnitOf = (productId: string) =>
    one(`SELECT id FROM product_units WHERE product_id = $1 AND is_base`, [productId]);

  const barcode = (
    unitId: string,
    code: string,
    gtin14: string | null,
    lookupKey: string,
    options: { type?: string; primary?: boolean; internal?: boolean } = {},
  ) =>
    app.query(
      `INSERT INTO product_barcodes (product_unit_id, code, gtin14, lookup_key, barcode_type, is_primary, is_internal)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        unitId,
        code,
        gtin14,
        lookupKey,
        options.type ?? 'UNDEFINED',
        options.primary ?? false,
        options.internal ?? false,
      ],
    );

  const readyFile = () => {
    fileNo += 1;
    return one(
      `INSERT INTO files (key, kind, content_type, size_bytes, sha256, status, uploaded_at)
       VALUES ($1, 'catalog.product_image', 'image/jpeg', 10, repeat('a', 64), 'READY', now()) RETURNING id`,
      [`00000000-0000-4000-8000-${String(fileNo).padStart(12, '0')}.jpg`],
    );
  };

  beforeAll(async () => {
    app = await connectAs('app');
    migrator = await connectAs('migrator');
    pcs = await one(
      `INSERT INTO uoms (code, name, name_key) VALUES ('PCS', 'ш', 'ш') RETURNING id`,
    );
    box = await one(
      `INSERT INTO uoms (code, name, name_key) VALUES ('BOX', 'хайрцаг', 'хайрцаг') RETURNING id`,
    );
    category = await one(
      `INSERT INTO categories (name, name_key) VALUES ('Ундаа', 'ундаа') RETURNING id`,
    );
  });
  afterAll(async () => {
    await app.end();
    await migrator.end();
  });

  it('gives every product exactly one base unit with factor 1, checked at commit', async () => {
    const id = await product('100');
    expect(await sqlStateOf(product('101', false))).toBe(CHECK);
    expect(await sqlStateOf(unit(id, box, '1', true))).toBe(UNIQUE);
    await app.query('BEGIN');
    const draft = await insertProduct('102');
    expect(await sqlStateOf(unit(draft, pcs, '2', true))).toBe(CHECK);
    await app.query('ROLLBACK');
  });

  it('keeps a unit’s product, unit, factor and base flag; writes supersede columns once', async () => {
    const id = await product('110');
    const old = await unit(id, box, '24');
    expect(await sqlStateOf(unit(id, box, '20'))).toBe(UNIQUE);
    for (const client of [app, migrator]) {
      const change = client.query(`UPDATE product_units SET factor_to_base = 20 WHERE id = $1`, [
        old,
      ]);
      expect(await sqlStateOf(change)).toBe(GUARD);
    }
    const base = await baseUnitOf(id);
    expect(
      await sqlStateOf(app.query(`UPDATE product_units SET is_base = false WHERE id = $1`, [base])),
    ).toBe(GUARD);
    expect(
      await sqlStateOf(
        app.query(`UPDATE product_units SET superseded_at = now() WHERE id = $1`, [base]),
      ),
    ).toBe(CHECK);
    expect(
      await sqlStateOf(
        app.query(`UPDATE product_units SET superseded_by = id WHERE id = $1`, [old]),
      ),
    ).toBe(CHECK);

    await app.query(`UPDATE product_units SET superseded_at = now() WHERE id = $1`, [old]);
    const next = await unit(id, box, '20');
    await app.query(`UPDATE product_units SET superseded_by = $2 WHERE id = $1`, [old, next]);
    const moveTime = app.query(
      `UPDATE product_units SET superseded_at = now() + interval '1 day' WHERE id = $1`,
      [old],
    );
    expect(await sqlStateOf(moveTime)).toBe(GUARD);
    const unlink = app.query(`UPDATE product_units SET superseded_by = NULL WHERE id = $1`, [old]);
    expect(await sqlStateOf(unlink)).toBe(GUARD);

    const defaultOnRetired = app.query(
      `UPDATE product_units SET is_default_sales = true WHERE id = $1`,
      [old],
    );
    expect(await sqlStateOf(defaultOnRetired)).toBe(CHECK);
    await app.query(`UPDATE product_units SET is_default_sales = true WHERE id = $1`, [next]);
    const secondDefault = app.query(
      `UPDATE product_units SET is_default_sales = true WHERE id = $1`,
      [base],
    );
    expect(await sqlStateOf(secondDefault)).toBe(UNIQUE);
  });

  it('never lets the app role delete products or units', async () => {
    const id = await product('120');
    const deleteUnits = app.query(`DELETE FROM product_units WHERE product_id = $1`, [id]);
    expect(await sqlStateOf(deleteUnits)).toBe(DENIED);
    expect(await sqlStateOf(app.query(`DELETE FROM products WHERE id = $1`, [id]))).toBe(DENIED);
    expect(await sqlStateOf(app.query(`TRUNCATE products CASCADE`))).toBe(DENIED);
  });

  it('keeps one lookup key across all barcodes, consistent with gtin14 and the code', async () => {
    const id = await product('130');
    const base = await baseUnitOf(id);
    const pack = await unit(id, box, '6');
    await barcode(base, '4006381333931', '04006381333931', '04006381333931', { type: 'GS1' });
    const sameGtin = barcode(pack, '04006381333931', '04006381333931', '04006381333931');
    expect(await sqlStateOf(sameGtin)).toBe(UNIQUE);
    const wrongKey = barcode(pack, '4006381333931', '04006381333931', '4006381333931');
    expect(await sqlStateOf(wrongKey)).toBe(CHECK);
    await barcode(pack, 'abc-1', null, 'ABC-1');
    expect(await sqlStateOf(barcode(pack, 'abc-2', null, 'abc-2'))).toBe(CHECK);
    expect(await sqlStateOf(barcode(pack, 'a b', null, 'A B'))).toBe(CHECK);
    const internalGs1 = barcode(pack, '2000000000015', '02000000000015', '02000000000015', {
      type: 'GS1',
      internal: true,
    });
    expect(await sqlStateOf(internalGs1)).toBe(CHECK);
    await barcode(pack, 'P-1', null, 'P-1', { primary: true });
    expect(await sqlStateOf(barcode(pack, 'P-2', null, 'P-2', { primary: true }))).toBe(UNIQUE);
    const { rows } = await app.query<{ next: string }>(
      `SELECT nextval('catalog_internal_barcode_seq') AS next`,
    );
    expect(rows[0]?.next).toMatch(/^\d+$/);
  });

  it('repeats a category name only under different parents', async () => {
    await app.query(`INSERT INTO categories (name, name_key) VALUES ('Хүнс', 'хүнс')`);
    const twin = app.query(`INSERT INTO categories (name, name_key) VALUES ('ХҮНС', 'хүнс')`);
    expect(await sqlStateOf(twin)).toBe(UNIQUE);
    await app.query(
      `INSERT INTO categories (parent_id, name, name_key) VALUES ($1, 'Хүнс', 'хүнс')`,
      [category],
    );
    const ownParent = app.query(`UPDATE categories SET parent_id = id WHERE id = $1`, [category]);
    expect(await sqlStateOf(ownParent)).toBe(CHECK);
  });

  it('checks SKU, e-Barimt codes, weight, VAT type and status formats', async () => {
    expect(await sqlStateOf(insertProduct('A1'))).toBe(CHECK);
    expect(await sqlStateOf(insertProduct('141', 'classification_code', '123'))).toBe(CHECK);
    expect(await sqlStateOf(insertProduct('142', 'tax_product_code', '12a'))).toBe(CHECK);
    expect(await sqlStateOf(insertProduct('143', 'weight_kg', '0'))).toBe(CHECK);
    expect(await sqlStateOf(insertProduct('144', 'vat_type', 'VAT_MAYBE'))).toBe(CHECK);
    expect(await sqlStateOf(insertProduct('145', 'status', 'GONE'))).toBe(CHECK);
  });

  it('pairs two distinct files per image and keeps one primary image', async () => {
    const id = await product('150');
    const image = await readyFile();
    const thumb = await readyFile();
    const image2 = await readyFile();
    const thumb2 = await readyFile();
    const insert = (a: string, b: string, primary: boolean) =>
      app.query(
        `INSERT INTO product_images (product_id, image_file_id, thumb_file_id, is_primary) VALUES ($1, $2, $3, $4)`,
        [id, a, b, primary],
      );
    expect(await sqlStateOf(insert(image, image, false))).toBe(CHECK);
    await insert(image, thumb, true);
    expect(await sqlStateOf(insert(image, thumb2, false))).toBe(UNIQUE);
    expect(await sqlStateOf(insert(image2, thumb2, true))).toBe(UNIQUE);
    await insert(image2, thumb2, false);
  });
});
