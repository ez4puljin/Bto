import { normalizeMnPhone } from '@tugeel/shared/phone';
import { cleanTaxNumber, normalizeRegNo, regNoShape, TIN_PATTERN } from '@tugeel/shared/taxpayer';
import { queryTerms, termPattern } from '@tugeel/shared/text';
import { and, eq, like, or, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { escapeLike } from '../../../common/db/like';
import type { Db, Tx } from '../../../common/db/db.types';

/** pg_advisory_xact_lock keys of the partners module (catalog uses 72_026_1xx). */
export const LOCKS = {
  customerCode: 72_027_001,
  supplierCode: 72_027_002,
  /** Two-key form (this, product id): the two key spaces of PostgreSQL never overlap. */
  productSuppliers: 72_027_003,
} as const;

export async function advisoryLock(tx: Tx, key: number, id?: number): Promise<void> {
  await tx.execute(
    id === undefined
      ? sql`SELECT pg_advisory_xact_lock(${key})`
      : sql`SELECT pg_advisory_xact_lock(${key}::int, ${id}::int)`,
  );
}

/**
 * The next free numeric code of a table: the largest one plus one, keeping its width (leading
 * zeros). Callers hold the table's code lock, so two creations never get the same code.
 */
export async function nextNumericCode(
  executor: Db | Tx,
  table: 'customers' | 'suppliers',
): Promise<string> {
  const { rows } = await executor.execute<{ code: string }>(
    sql`SELECT code FROM ${sql.identifier(table)} ORDER BY length(code) DESC, code DESC LIMIT 1`,
  );
  const last = rows[0]?.code;
  if (last === undefined) return '1';
  return (BigInt(last) + 1n).toString().padStart(last.length, '0');
}

/** Optional text as stored: trimmed, empty → null. */
export function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** The columns a partner search reads (customers and suppliers share them). */
export interface SearchColumns {
  code: AnyPgColumn;
  searchText: AnyPgColumn;
  searchPhonetic: AnyPgColumn;
  regNo: AnyPgColumn;
  tin: AnyPgColumn;
  phone: AnyPgColumn;
}

/**
 * Match condition and rank of a partner search (ADR-0028): every word must match the strict or
 * the phonetic key of name and code; a query that is a code, TIN, phone or registration number
 * also matches it exactly and ranks first, then strict matches, then phonetic ones.
 */
export function partnerSearch(
  columns: SearchColumns,
  q: string | undefined,
): { match: SQL; rank: SQL } | null {
  const text = q?.trim() ?? '';
  const terms = queryTerms(text);
  if (terms.length === 0) return null;
  const strict = terms.map((term) =>
    like(columns.searchText, `%${escapeLike(termPattern(term.strict))}%`),
  );
  const either = terms.map((term, index) => {
    const phonetic = term.phonetic
      ? like(columns.searchPhonetic, `%${escapeLike(termPattern(term.phonetic))}%`)
      : undefined;
    return or(strict[index], phonetic) ?? sql`false`;
  });
  const exact: SQL[] = [];
  const regNo = normalizeRegNo(text);
  if (regNoShape(regNo)) exact.push(eq(columns.regNo, regNo));
  const phone = normalizeMnPhone(text);
  if (phone) exact.push(eq(columns.phone, phone));
  const digits = cleanTaxNumber(text);
  let prefix: SQL | undefined;
  if (/^\d+$/.test(digits)) {
    exact.push(eq(columns.code, digits));
    if (TIN_PATTERN.test(digits)) exact.push(eq(columns.tin, digits));
    prefix = like(columns.code, `${digits}%`);
  }
  const exactMatch = or(...exact) ?? sql`false`;
  return {
    match: or(and(...either), prefix, exactMatch) ?? sql`false`,
    rank: sql`CASE WHEN ${exactMatch} THEN 0 WHEN ${and(...strict) ?? sql`false`} THEN 1 ELSE 2 END`,
  };
}
