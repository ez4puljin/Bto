import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { systemActor } from '../../src/modules/identity';
import { CustomerAddressesService, CustomersService } from '../../src/modules/partners';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';

/** Concurrency rules of partners (docs/modules/partners.md): codes, default addresses, credit lock. */
describe('integrity: partners concurrency', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let customers: CustomersService;
  let addresses: CustomerAddressesService;
  const actor = systemActor('integrity-test');

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    customers = app.get(CustomersService);
    addresses = app.get(CustomerAddressesService);
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('gives parallel creations without a code distinct next codes', async () => {
    await customers.create(actor, { code: '41', kind: 'COMPANY', name: 'Эхний' });
    const created = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        customers.create(actor, { kind: 'COMPANY', name: `Зэрэг ${index}` }),
      ),
    );
    expect(created.map((row) => row.code).sort()).toEqual(['42', '43', '44', '45']);
  });

  it('keeps exactly one default address when two are made default at once', async () => {
    const shop = await customers.create(actor, {
      kind: 'COMPANY',
      name: 'Хоёр хаяг',
      address: { address: 'Нэг' },
    });
    const second = await addresses.add(actor, shop.id, { address: 'Хоёр' });
    const third = await addresses.add(actor, shop.id, { address: 'Гурав' });
    await Promise.all([
      addresses.setDefault(actor, second.id),
      addresses.setDefault(actor, third.id),
    ]);
    const { rows } = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM customer_addresses WHERE customer_id = $1 AND is_default`,
      [shop.id],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('serialises credit decisions without blocking rows that reference the customer', async () => {
    const shop = await customers.create(actor, { kind: 'COMPANY', name: 'Зээлийн түгжээ' });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const decision = inTransaction(app.get<Db>(DB), async (tx) => {
      const row = await customers.lockForUpdate(tx, shop.id);
      expect(row).toMatchObject({ id: shop.id, status: 'ACTIVE', creditLimit: null });
      locked();
      await held;
    });
    await lockTaken;
    try {
      // A foreign-key check (FOR KEY SHARE) passes while the credit lock is held …
      await sql.query('BEGIN');
      await sql.query(`SET LOCAL lock_timeout = '1s'`);
      await sql.query(
        `INSERT INTO customer_contacts (customer_id, phone) VALUES ($1, '+97699000001')`,
        [shop.id],
      );
      await sql.query('COMMIT');
      // … while a second credit decision waits for the first one.
      await sql.query('BEGIN');
      await sql.query(`SET LOCAL lock_timeout = '300ms'`);
      expect(
        await sqlStateOf(
          sql.query(`SELECT id FROM customers WHERE id = $1 FOR NO KEY UPDATE`, [shop.id]),
        ),
      ).toBe('55P03');
      await sql.query('ROLLBACK');
    } finally {
      release();
      await decision;
    }
  });
});
