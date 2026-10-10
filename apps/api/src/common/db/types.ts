import { Decimal } from '@tugeel/shared/money';
import { customType } from 'drizzle-orm/pg-core';

/**
 * Drizzle column types for NUMERIC values (ADR-0010). They read and write decimal.js `Decimal`
 * (the shared configured clone), never JS numbers, and refuse values that would be silently rounded
 * or would overflow the column.
 */
function decimalColumn(precision: number, scale: number) {
  const sqlType = `numeric(${precision}, ${scale})`;
  const limit = new Decimal(10).pow(precision - scale);
  return customType<{ data: Decimal; driverData: string }>({
    dataType: () => sqlType,
    toDriver(value: Decimal): string {
      if (!Decimal.isDecimal(value) || !value.isFinite()) {
        throw new TypeError(`${sqlType}: expected a finite Decimal`);
      }
      if (value.decimalPlaces() > scale) {
        throw new RangeError(`${sqlType}: ${value.toString()} needs explicit rounding first`);
      }
      if (value.abs().gte(limit)) {
        throw new RangeError(`${sqlType}: ${value.toString()} overflows`);
      }
      return value.toFixed(scale);
    },
    fromDriver(value: string): Decimal {
      const raw: unknown = value;
      if (typeof raw !== 'string') {
        throw new TypeError(
          `${sqlType} arrived as ${typeof raw}; configurePgTypeParsers() was not applied`,
        );
      }
      return new Decimal(raw);
    },
  });
}

/** MNT amounts, NUMERIC(14,2). */
export const money = decimalColumn(14, 2);
/** Base-unit quantities, NUMERIC(14,3). */
export const qty = decimalColumn(14, 3);
/** Unit costs and avg_cost, NUMERIC(14,4). */
export const cost = decimalColumn(14, 4);
/** Unit conversion factors, NUMERIC(18,6). */
export const factor = decimalColumn(18, 6);

/**
 * JSONB that round-trips every JSON value. Drizzle's own jsonb() runs JSON.parse a second time on
 * string results, so a stored JSON string such as "10" would come back as the number 10;
 * node-postgres has already parsed the column, so this type returns its value untouched.
 */
export const jsonValue = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value: unknown): string => JSON.stringify(value),
  fromDriver: (value: unknown): unknown => value,
});
