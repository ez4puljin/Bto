import { Decimal, roundHalfUp } from '@tugeel/shared/money';
import { queryTerms, termPattern } from '@tugeel/shared/text';
import { type SQL, sql } from 'drizzle-orm';
import { escapeLike } from '../../../common/db/like';
import type { Db } from '../../../common/db/db.types';

/** A row as `db.execute` returns it: every NUMERIC and date as text. */
export type SqlRow = Record<string, unknown>;

export async function rowsOf<T extends SqlRow = SqlRow>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

/** A scalar column's text (node-postgres gives NUMERIC, DATE and BIGINT as text). */
export function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  throw new Error(`unexpected SQL value of type ${typeof value}`);
}

/** A NUMERIC column (NULL is zero). */
export function dec(value: unknown): Decimal {
  return value === null || value === undefined ? new Decimal(0) : new Decimal(scalar(value));
}

export function decOrNull(value: unknown): Decimal | null {
  return value === null || value === undefined ? null : new Decimal(scalar(value));
}

export function int(value: unknown): number {
  return Number.parseInt(scalar(value), 10);
}

export function intOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number.parseInt(scalar(value), 10);
}

export function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : scalar(value);
}

/** A date column as `YYYY-MM-DD` (node-postgres gives a DATE as text, a cast result maybe a Date). */
export function dateText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return scalar(value).slice(0, 10);
}

/** Gross margin in percent with one decimal, or null without sales. */
export function marginPct(profit: Decimal, sales: Decimal): Decimal | null {
  if (sales.lte(0)) return null;
  return roundHalfUp(profit.div(sales).times(100), 1);
}

/** Money as the API writes it. */
export function money(value: Decimal): string {
  return value.toFixed(2);
}

export function moneyOrNull(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export function pct(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed(1);
}

/**
 * Every term of `q` in a row's search keys (`<alias>.search_text` / `search_phonetic`, the
 * normalised keys of @tugeel/shared/text), or its code exactly; null without a term.
 */
export function searchSql(alias: string, q: string | undefined, codeColumn = 'code'): SQL | null {
  const text = q?.trim() ?? '';
  const terms = queryTerms(text);
  if (terms.length === 0) return null;
  const table = sql.raw(alias);
  const each = terms.map((term) => {
    const strict = sql`${table}.search_text LIKE ${`%${escapeLike(termPattern(term.strict))}%`}`;
    return term.phonetic
      ? sql`(${strict} OR ${table}.search_phonetic LIKE ${`%${escapeLike(termPattern(term.phonetic))}%`})`
      : strict;
  });
  return sql`((${sql.join(each, sql` AND `)}) OR ${table}.${sql.raw(codeColumn)}::text = ${text})`;
}

/** `a AND b AND …` of the given conditions (TRUE for none). */
export function allOf(conditions: readonly (SQL | null | undefined)[]): SQL {
  const kept = conditions.filter((c): c is SQL => !!c);
  return kept.length === 0 ? sql`TRUE` : sql.join(kept, sql` AND `);
}
