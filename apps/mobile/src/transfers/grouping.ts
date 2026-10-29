import { Decimal } from '@tugeel/shared/money';
import type { TransferLine, TransferRequestRow } from './types';

/** The request editor's sections: the rows of one home warehouse (ADR-0116 #2). */
export interface HomeSection<R extends Pick<TransferRequestRow, 'homeWarehouseId'>> {
  /** null: products without a home, which cannot be requested; shown last. */
  homeWarehouseId: number | null;
  homeWarehouseName: string | null;
  data: R[];
}

/**
 * Rows grouped by their home warehouse, the sections in the order the rows arrived (the server
 * sorts by name); the products without a home come last.
 */
export function sectionsByHome<
  R extends Pick<TransferRequestRow, 'homeWarehouseId' | 'homeWarehouseName'>,
>(rows: readonly R[]): HomeSection<R>[] {
  const sections = new Map<number | null, HomeSection<R>>();
  for (const row of rows) {
    const key = row.homeWarehouseId;
    let section = sections.get(key);
    if (!section) {
      section = { homeWarehouseId: key, homeWarehouseName: row.homeWarehouseName, data: [] };
      sections.set(key, section);
    }
    section.data.push(row);
  }
  const list = [...sections.values()];
  return [
    ...list.filter((section) => section.homeWarehouseId !== null),
    ...list.filter((section) => section.homeWarehouseId === null),
  ];
}

/**
 * A request's label from its groups' numbers: one number whole («TR-2026-000005»); several
 * shortened to «TR-…05 · TR-…06»; null while no group is numbered (a draft).
 */
export function numbersLabel(numbers: readonly (string | null)[]): string | null {
  const known = numbers.filter((number): number is string => number !== null && number !== '');
  if (known.length === 0) return null;
  if (known.length === 1) return known[0] ?? null;
  return known.map((number) => `${number.slice(0, 3)}…${number.slice(-2)}`).join(' · ');
}

/** A quantity in base units told in a unit of `factor` base units («48» by 24 → «2»). */
export function inUnit(baseQty: string, factor: string): string {
  const divisor = new Decimal(factor);
  if (divisor.lte(0)) return new Decimal(baseQty).toFixed();
  return new Decimal(baseQty).div(divisor).toDecimalPlaces(3).toFixed();
}

/** A quantity of a unit in base units («2» by 24 → «48»). */
export function toBase(qty: string, factor: string): string {
  return new Decimal(qty).times(new Decimal(factor)).toFixed();
}

/** The words of a line's quantities: what was asked, what left, what was counted. */
export interface LineQtyWords {
  /** «5 хайрцаг», in the request unit. */
  requested: { qty: string; unit: string };
  /** The request quantity in base units, when the request unit is not the base; else null. */
  requestedBase: { qty: string; unit: string } | null;
  /** What left, in the request unit; null before shipping. */
  shipped: { qty: string; unit: string } | null;
  /** What was counted, in the request unit; null until counted; qty «0» = nothing arrived. */
  counted: { qty: string; unit: string } | null;
}

export function lineQtyWords(
  line: Pick<
    TransferLine,
    | 'requestedQty'
    | 'unitName'
    | 'requestFactor'
    | 'baseUnitName'
    | 'shippedQtyBase'
    | 'countedQtyBase'
  >,
): LineQtyWords {
  const isBase = new Decimal(line.requestFactor).eq(1);
  const unit = line.unitName;
  return {
    requested: { qty: new Decimal(line.requestedQty).toFixed(), unit },
    requestedBase: isBase
      ? null
      : { qty: toBase(line.requestedQty, line.requestFactor), unit: line.baseUnitName },
    shipped:
      line.shippedQtyBase === null
        ? null
        : { qty: inUnit(line.shippedQtyBase, line.requestFactor), unit },
    counted:
      line.countedQtyBase === null
        ? null
        : { qty: inUnit(line.countedQtyBase, line.requestFactor), unit },
  };
}
