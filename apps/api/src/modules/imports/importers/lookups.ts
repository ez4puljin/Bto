import { parseDecimal, type RowErrorCode } from '@tugeel/shared/imports';
import { normalizeBinCode } from '@tugeel/shared/inventory';
import type { Decimal } from '@tugeel/shared/money';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import type { CatalogReference } from '../../catalog';
import type { Warehouse } from '../../identity';
import type { Bin } from '../../inventory';

/** A name as the database keys it (spelling and case variants folded, ADR-0028). */
export const keyOf = (text: string): string => nameKey(normalizeName(text));

/** Separators of a category path: «Ундаа / Хийжүүлсэн», «Ундаа > Хийжүүлсэн». */
const PATH_SEPARATOR = /\s*[/>»\\]\s*/;

export type Found<T> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'AMBIGUOUS' };

/** Categories by their full path from the root, or by a leaf name only one category has. */
export class CategoryIndex {
  private readonly byPath = new Map<string, number>();
  private readonly byName = new Map<string, number[]>();

  constructor(rows: CatalogReference['categories']) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const row of rows) {
      const keys: string[] = [];
      for (let node: typeof row | undefined = row, depth = 0; node && depth < 16; depth += 1) {
        keys.unshift(node.nameKey);
        node = node.parentId === null ? undefined : byId.get(node.parentId);
      }
      this.byPath.set(keys.join('/'), row.id);
      this.byName.set(row.nameKey, [...(this.byName.get(row.nameKey) ?? []), row.id]);
    }
  }

  find(text: string): Found<number> {
    const parts = text.split(PATH_SEPARATOR).filter((part) => part !== '');
    if (parts.length > 1) {
      const id = this.byPath.get(parts.map(keyOf).join('/'));
      return id === undefined ? { ok: false, code: 'NOT_FOUND' } : { ok: true, value: id };
    }
    const ids = this.byName.get(keyOf(text)) ?? [];
    if (ids.length > 1) return { ok: false, code: 'AMBIGUOUS' };
    const [id] = ids;
    return id === undefined ? { ok: false, code: 'NOT_FOUND' } : { ok: true, value: id };
  }
}

/** Rows found by a name key; a key two rows share is AMBIGUOUS. */
export function byNameKey<T>(rows: readonly T[], keyOfRow: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(keyOfRow(row), [...(map.get(keyOfRow(row)) ?? []), row]);
  return (text: string): Found<T> => {
    const found = map.get(keyOf(text)) ?? [];
    if (found.length > 1) return { ok: false, code: 'AMBIGUOUS' };
    const [row] = found;
    return row === undefined ? { ok: false, code: 'NOT_FOUND' } : { ok: true, value: row };
  };
}

/** Warehouses by code (as typed, any case) or by name. */
export function warehouseFinder(warehouses: readonly Warehouse[]) {
  const named = byNameKey(warehouses, (warehouse) => keyOf(warehouse.name));
  return (text: string): Found<Warehouse> => {
    const code = text.trim().toUpperCase();
    const byCode = warehouses.find((warehouse) => warehouse.code.toUpperCase() === code);
    return byCode ? { ok: true, value: byCode } : named(text);
  };
}

/** Bins of some warehouses by (warehouse, code as printed on the label). */
export function binFinder(bins: readonly Bin[]) {
  const map = new Map(bins.map((bin) => [`${bin.warehouseId}:${bin.code}`, bin]));
  return (warehouseId: number, text: string): Bin | undefined =>
    map.get(`${warehouseId}:${normalizeBinCode(text)}`);
}

/**
 * A non-negative decimal from a cell with at most `scale` decimals and at most `max`; FORMAT for
 * text that is not a number, OUT_OF_RANGE beyond the limits.
 */
export function decimalCell(
  text: string,
  scale: number,
  max: Decimal | number,
): { ok: true; value: Decimal } | { ok: false; code: RowErrorCode } {
  const value = parseDecimal(text);
  if (value === null) return { ok: false, code: 'FORMAT' };
  if (value.decimalPlaces() > scale || value.gt(max)) return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, value };
}

/** A whole number within [min, max]. */
export function integerCell(
  text: string,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; code: RowErrorCode } {
  const value = parseDecimal(text);
  if (value === null || !value.isInteger()) return { ok: false, code: 'FORMAT' };
  if (value.lt(min) || value.gt(max)) return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, value: value.toNumber() };
}
