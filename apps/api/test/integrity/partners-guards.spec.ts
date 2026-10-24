import type { Client } from 'pg';
import { connectAs } from '../harness/apps';

/** The hand-written guards of 0004_partners exist (ADR-0016); their behaviour is in partners-schema. */
describe('integrity: partners guards', () => {
  let app: Client;

  beforeAll(async () => {
    app = await connectAs('app');
  });
  afterAll(async () => {
    await app.end();
  });

  it('never lets the app role delete or truncate customers, addresses, categories and suppliers', async () => {
    const { rows } = await app.query<Record<string, boolean>>(
      `SELECT has_table_privilege('customers', 'DELETE') AS customers_delete,
              has_table_privilege('customers', 'TRUNCATE') AS customers_truncate,
              has_table_privilege('customer_addresses', 'DELETE') AS addresses_delete,
              has_table_privilege('customer_categories', 'DELETE') AS categories_delete,
              has_table_privilege('customer_categories', 'TRUNCATE') AS categories_truncate,
              has_table_privilege('suppliers', 'DELETE') AS suppliers_delete,
              has_table_privilege('suppliers', 'UPDATE') AS suppliers_update,
              has_table_privilege('customer_contacts', 'DELETE') AS contacts_delete,
              has_table_privilege('product_suppliers', 'DELETE') AS links_delete`,
    );
    expect(rows[0]).toEqual({
      customers_delete: false,
      customers_truncate: false,
      addresses_delete: false,
      categories_delete: false,
      categories_truncate: false,
      suppliers_delete: false,
      suppliers_update: true,
      contacts_delete: true,
      links_delete: true,
    });
  });
});
