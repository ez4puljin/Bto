import { BUSINESS_TZ } from '@tugeel/shared/time';
import { and, type Column, type SQL, sql } from 'drizzle-orm';

/**
 * A timestamp column within Ulaanbaatar days, both ends included; an open end is unbounded (the
 * date conditions of segments and list filters, ADR-0049 #2).
 */
export function onBusinessDays(column: Column | SQL, range: { from?: string; to?: string }): SQL {
  const parts: SQL[] = [];
  if (range.from) {
    parts.push(sql`${column} >= (${range.from}::date)::timestamp AT TIME ZONE ${BUSINESS_TZ}`);
  }
  if (range.to) {
    parts.push(sql`${column} < ((${range.to}::date) + 1)::timestamp AT TIME ZONE ${BUSINESS_TZ}`);
  }
  return and(...parts) ?? sql`true`;
}

/** A set of ids as one array parameter (`= ANY($1::bigint[])`), not one parameter per id. */
export function idIn(column: Column | SQL, ids: readonly number[]): SQL {
  return sql`${column} = ANY(${sql.param([...ids])}::bigint[])`;
}
