import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

const CHECK = '23514';
const UNIQUE = '23505';
const DENIED = '42501';

/** Database-level rules of migration 0004_partners, independent of the services (ADR-0016). */
describe('partners schema constraints', () => {
  let app: Client;
  let product: string;
  let codeNo = 0;

  const one = async (sql: string, params: unknown[] = []) => {
    const { rows } = await app.query<{ id: string }>(sql, params);
    const id = rows[0]?.id;
    if (!id) throw new Error(`no row from ${sql}`);
    return id;
  };

  /** A customer row; `columns` adds or overrides values. */
  const customer = (columns: Record<string, unknown> = {}) => {
    codeNo += 1;
    const values: Record<string, unknown> = {
      code: String(1000 + codeNo),
      kind: 'COMPANY',
      name: 'Дэлгүүр',
      search_text: ' дэлгүүр',
      search_phonetic: ' delguur',
      search_version: 1,
      settlement_group: 'DAY_20',
      ...columns,
    };
    const names = Object.keys(values);
    return one(
      `INSERT INTO customers (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(values),
    );
  };

  const supplier = (code: string, name: string) =>
    one(
      `INSERT INTO suppliers (code, name, name_key, search_text, search_phonetic, search_version)
       VALUES ($1, $2, lower($2), ' ' || lower($2), ' ' || lower($2), 1) RETURNING id`,
      [code, name],
    );

  const address = (customerId: string, columns: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = { customer_id: customerId, ...columns };
    const names = Object.keys(values);
    return one(
      `INSERT INTO customer_addresses (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(values),
    );
  };

  beforeAll(async () => {
    app = await connectAs('app');
    const pcs = await one(
      `INSERT INTO uoms (code, name, name_key) VALUES ('PCS', 'ш', 'ш') RETURNING id`,
    );
    const category = await one(
      `INSERT INTO categories (name, name_key) VALUES ('Хүнс', 'хүнс') RETURNING id`,
    );
    await app.query('BEGIN');
    product = await one(
      `INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id)
       VALUES ('1', 'Гурил', ' гурил', ' guril', 1, $1) RETURNING id`,
      [category],
    );
    await app.query(
      `INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base) VALUES ($1, $2, 1, true)`,
      [product, pcs],
    );
    await app.query('COMMIT');
  });
  afterAll(async () => {
    await app.end();
  });

  it('keeps codes numeric and unique, and TIN, consumer number and phone in their formats', async () => {
    await customer({ code: '007' });
    expect(await sqlStateOf(customer({ code: '007' }))).toBe(UNIQUE);
    expect(await sqlStateOf(customer({ code: 'A-1' }))).toBe(CHECK);
    await customer({ tin: '12345678901', tin_source: 'MANUAL', reg_no: '2034567' });
    // Every store is its own customer: registration number and TIN may repeat.
    await customer({ tin: '12345678901', tin_source: 'MANUAL', reg_no: '2034567' });
    expect(await sqlStateOf(customer({ tin: '2034567', tin_source: 'MANUAL' }))).toBe(CHECK);
    expect(await sqlStateOf(customer({ tin: '12345678901' }))).toBe(CHECK);
    expect(await sqlStateOf(customer({ consumer_no: '11234567' }))).toBe(CHECK);
    await customer({ kind: 'INDIVIDUAL', consumer_no: '11234567' });
    expect(await sqlStateOf(customer({ phone: '99112233' }))).toBe(CHECK);
    await customer({ phone: '+97699112233' });
  });

  it('keeps payer flags false until checked and credit fields consistent', async () => {
    expect(await sqlStateOf(customer({ vat_payer: true }))).toBe(CHECK);
    await customer({
      vat_payer: true,
      tax_status_source: 'MANUAL',
      tax_status_checked_at: new Date(),
    });
    expect(await sqlStateOf(customer({ tax_status_source: 'MANUAL' }))).toBe(CHECK);
    expect(await sqlStateOf(customer({ credit_limit: '-1' }))).toBe(CHECK);
    expect(await sqlStateOf(customer({ settlement_group: 'DAY_30' }))).toBe(CHECK);
    expect(await sqlStateOf(customer({ settlement_group: null }))).toBe('23502');
    await customer({ settlement_group: 'MONTH_END' });
    expect(await sqlStateOf(customer({ credit_hold_reason: 'Өртэй' }))).toBe(CHECK);
    await customer({ credit_hold: true, credit_hold_reason: 'Өртэй', credit_limit: null });
  });

  it('places addresses in Mongolia with one default that is never archived', async () => {
    const id = await customer();
    await address(id, { address: 'Баянзүрх', is_default: true });
    expect(await sqlStateOf(address(id, { address: 'Хоёр дахь', is_default: true }))).toBe(UNIQUE);
    expect(await sqlStateOf(address(id, {}))).toBe(CHECK);
    expect(await sqlStateOf(address(id, { lat: '47.9', gps_source: 'OFFICE' }))).toBe(CHECK);
    expect(await sqlStateOf(address(id, { lat: '47.9', lng: '106.9' }))).toBe(CHECK);
    expect(await sqlStateOf(address(id, { lat: '0', lng: '0', gps_source: 'OFFICE' }))).toBe(CHECK);
    const placed = await address(id, { lat: '47.918412', lng: '106.917712', gps_source: 'FIELD' });
    expect(placed).toBeDefined();
    const other = await customer();
    const archived = await address(other, { address: 'Хуучин', archived_at: new Date() });
    expect(
      await sqlStateOf(
        app.query(`UPDATE customer_addresses SET is_default = true WHERE id = $1`, [archived]),
      ),
    ).toBe(CHECK);
  });

  it('gives a product one main supplier and keeps supplier names unique', async () => {
    const first = await supplier('1', 'МСМ');
    const second = await supplier('2', 'Номин');
    expect(await sqlStateOf(supplier('3', 'МСМ'))).toBe(UNIQUE);
    await app.query(
      `INSERT INTO product_suppliers (product_id, supplier_id, is_main) VALUES ($1, $2, true)`,
      [product, first],
    );
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO product_suppliers (product_id, supplier_id, is_main) VALUES ($1, $2, true)`,
          [product, second],
        ),
      ),
    ).toBe(UNIQUE);
    expect(
      await sqlStateOf(
        app.query(`INSERT INTO product_suppliers (product_id, supplier_id) VALUES ($1, $2)`, [
          product,
          first,
        ]),
      ),
    ).toBe(UNIQUE);
    expect(
      await sqlStateOf(
        app.query(`UPDATE suppliers SET bank_account = 'mn 12' WHERE id = $1`, [first]),
      ),
    ).toBe(CHECK);
  });

  it('never lets the app role delete customers, addresses or suppliers', async () => {
    const id = await customer();
    const place = await address(id, { address: 'Сүхбаатар' });
    expect(
      await sqlStateOf(app.query(`DELETE FROM customer_addresses WHERE id = $1`, [place])),
    ).toBe(DENIED);
    expect(await sqlStateOf(app.query(`DELETE FROM customers WHERE id = $1`, [id]))).toBe(DENIED);
    expect(await sqlStateOf(app.query(`DELETE FROM suppliers`))).toBe(DENIED);
    const contact = await one(
      `INSERT INTO customer_contacts (customer_id, phone) VALUES ($1, '+97699112233') RETURNING id`,
      [id],
    );
    await app.query(`DELETE FROM customer_contacts WHERE id = $1`, [contact]);
  });
});
