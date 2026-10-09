import { Decimal } from '@tugeel/shared/money';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { configurePgTypeParsers } from '../../src/common/db/pg-types';
import { cost, factor, money, qty } from '../../src/common/db/types';

const numericProbe = pgTable('numeric_probe', {
  amount: money('amount').notNull(),
  quantity: qty('quantity').notNull(),
  unitCost: cost('unit_cost').notNull(),
  ratio: factor('ratio').notNull(),
});

describe('NUMERIC round-trip through PostgreSQL', () => {
  let pool: Pool;

  beforeAll(() => {
    configurePgTypeParsers();
    // One connection: the TEMP table lives in the session that created it.
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('stores and reads Decimals exactly', async () => {
    const db = drizzle({ client: pool });
    await pool.query(
      `CREATE TEMP TABLE numeric_probe (amount numeric(14,2) NOT NULL, quantity numeric(14,3) NOT NULL,
         unit_cost numeric(14,4) NOT NULL, ratio numeric(18,6) NOT NULL)`,
    );
    await db.insert(numericProbe).values({
      amount: new Decimal('999999999999.99'),
      quantity: new Decimal('-0.001'),
      unitCost: new Decimal('1234567890.1234'),
      ratio: new Decimal('0.000001'),
    });
    const [row] = await db.select().from(numericProbe);
    expect(row).toBeDefined();
    expect(row?.amount.toString()).toBe('999999999999.99');
    expect(row?.quantity.toString()).toBe('-0.001');
    expect(row?.unitCost.toString()).toBe('1234567890.1234');
    expect(row?.ratio.toString()).toBe('0.000001');
    expect(Decimal.isDecimal(row?.amount)).toBe(true);
  });

  it('never turns NUMERIC into a JS number', async () => {
    const { rows } = await pool.query<{ sum: unknown }>(
      'SELECT 0.1::numeric + 0.2::numeric AS sum',
    );
    expect(rows[0]?.sum).toBe('0.3');
  });
});
