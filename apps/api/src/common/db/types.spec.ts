import { Decimal } from '@tugeel/shared/money';
import { getTableConfig, pgTable } from 'drizzle-orm/pg-core';
import { cost, factor, money, qty } from './types';

const probe = pgTable('probe', {
  amount: money('amount'),
  quantity: qty('quantity'),
  unitCost: cost('unit_cost'),
  ratio: factor('ratio'),
});

type Mapper = {
  getSQLType(): string;
  mapToDriverValue(value: unknown): unknown;
  mapFromDriverValue(value: unknown): unknown;
};
const column = (name: string): Mapper => {
  const found = getTableConfig(probe).columns.find((c) => c.name === name);
  if (!found) throw new Error(`no column ${name}`);
  return found;
};

describe('NUMERIC custom column types', () => {
  it('declares the documented precision and scale', () => {
    expect(column('amount').getSQLType()).toBe('numeric(14, 2)');
    expect(column('quantity').getSQLType()).toBe('numeric(14, 3)');
    expect(column('unit_cost').getSQLType()).toBe('numeric(14, 4)');
    expect(column('ratio').getSQLType()).toBe('numeric(18, 6)');
  });

  it('writes fixed-scale strings and reads Decimals back exactly', () => {
    const amount = column('amount');
    expect(amount.mapToDriverValue(new Decimal('1.5'))).toBe('1.50');
    expect(amount.mapToDriverValue(new Decimal('999999999999.99'))).toBe('999999999999.99');
    const read = amount.mapFromDriverValue('999999999999.99');
    expect(Decimal.isDecimal(read)).toBe(true);
    expect((read as Decimal).toString()).toBe('999999999999.99');
    expect((column('quantity').mapFromDriverValue('-0.001') as Decimal).toString()).toBe('-0.001');
    expect((column('ratio').mapFromDriverValue('0.000001') as Decimal).toString()).toBe('0.000001');
  });

  it('refuses values that would be rounded or overflow silently', () => {
    expect(() => column('amount').mapToDriverValue(new Decimal('1.005'))).toThrow(
      'needs explicit rounding first',
    );
    expect(() => column('amount').mapToDriverValue(new Decimal('1000000000000'))).toThrow(
      'overflows',
    );
  });

  it('refuses JS numbers and non-finite values', () => {
    expect(() => column('amount').mapToDriverValue(1.5)).toThrow('expected a finite Decimal');
    expect(() => column('amount').mapToDriverValue(new Decimal(NaN))).toThrow(
      'expected a finite Decimal',
    );
    expect(() => column('amount').mapFromDriverValue(1.5)).toThrow(
      'configurePgTypeParsers() was not applied',
    );
  });
});
