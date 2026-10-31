import { Decimal } from '@tugeel/shared/money';
import type { KeypadUnit } from '../shop/keypad-sheet';
import type { PickLine, PickLineInfo, PickWork } from './types';

// The pure side of «Бэлтгэл» (ADR-0132): the work list in its sections, a line's count state,
// the keypad's units for a line, and the confirmation body; tested without the screens.

export const WORK_SECTIONS = ['take', 'mine', 'others', 'done'] as const;
export type WorkSection = (typeof WORK_SECTIONS)[number];

export interface WorkGroup {
  key: WorkSection;
  data: PickWork[];
}

/**
 * The work list by what the keeper does with it: the parts to take (OPEN), their own being picked,
 * other pickers' (shown to a lead, or when a part was handed away), and the ones done today; each
 * in the server's order (soonest delivery first). Empty sections are left out.
 */
export function workGroups(rows: readonly PickWork[], meId: number): WorkGroup[] {
  const groups: Record<WorkSection, PickWork[]> = { take: [], mine: [], others: [], done: [] };
  for (const row of rows) {
    if (row.status === 'OPEN') groups.take.push(row);
    else if (row.status === 'DONE') groups.done.push(row);
    else if (row.pickerId === meId) groups.mine.push(row);
    else groups.others.push(row);
  }
  return WORK_SECTIONS.filter((key) => groups[key].length > 0).map((key) => ({
    key,
    data: groups[key],
  }));
}

/** The count typed for a line, in base units (a string Decimal), by line id. */
export type Counts = Readonly<Record<number, string>>;

export type LineCountState =
  { kind: 'uncounted' } | { kind: 'out' } | { kind: 'short'; diffBase: string } | { kind: 'full' };

/**
 * A line's state from its count: the one typed on the phone, else the one confirmed on the
 * server (`qtyPicked`), else uncounted. Against the ordered quantity: 0 is «Дууссан», less is
 * «Дутуу n», the rest «Бүтэн».
 */
export function lineCountState(
  line: Pick<PickLine, 'id' | 'qtyBase' | 'qtyPicked'>,
  counts: Counts,
): LineCountState {
  const typed = counts[line.id];
  const picked = typed !== undefined ? typed : line.qtyPicked;
  if (picked === null || picked === undefined) return { kind: 'uncounted' };
  const count = new Decimal(picked);
  if (count.isZero()) return { kind: 'out' };
  const short = new Decimal(line.qtyBase).minus(count);
  return short.gt(0) ? { kind: 'short', diffBase: short.toFixed() } : { kind: 'full' };
}

/** A synthetic id for a line's base unit: the order line names the base unit, not its id. */
export const BASE_UNIT_ID = 0;

/**
 * The keypad's units for a line: the base unit (a synthetic id), the ordered unit when it is a
 * pack, and the scanned unit when it is yet another of the product's. The count comes back in
 * base units through `toBaseQty`.
 */
export function keypadUnitsOfPickLine(
  line: Pick<PickLine, 'productUnitId' | 'unitName' | 'factorSnapshot' | 'baseUnitName'>,
  scanned: { id: number; uomName: string; factorToBase: string; isBase: boolean } | null,
): KeypadUnit[] {
  const units: KeypadUnit[] = [
    {
      id: BASE_UNIT_ID,
      uomName: line.baseUnitName,
      factorToBase: '1',
      isBase: true,
      wholesale: null,
    },
  ];
  if (!new Decimal(line.factorSnapshot).eq(1)) {
    units.push({
      id: line.productUnitId,
      uomName: line.unitName,
      factorToBase: line.factorSnapshot,
      isBase: false,
      wholesale: null,
    });
  }
  if (scanned && !scanned.isBase && !units.some((unit) => unit.id === scanned.id)) {
    units.push({
      id: scanned.id,
      uomName: scanned.uomName,
      factorToBase: scanned.factorToBase,
      isBase: false,
      wholesale: null,
    });
  }
  return units;
}

/** A keypad count in one of the line's units, as base units. */
export function toBaseQty(qty: string, unitId: number, units: readonly KeypadUnit[]): string {
  const factor = units.find((unit) => unit.id === unitId)?.factorToBase ?? '1';
  return new Decimal(qty || '0').times(new Decimal(factor)).toFixed();
}

/** The shelf a line is picked from: the one chosen on the phone, else the server's proposal. */
export function binOf(
  info: Pick<PickLineInfo, 'proposedBinId' | 'bins'> | undefined,
  chosen: number | undefined,
): number | null {
  if (chosen !== undefined) return chosen;
  if (!info) return null;
  return info.proposedBinId ?? info.bins[0]?.id ?? null;
}

export interface ConfirmLine {
  lineId: number;
  qty: string;
  binId: number;
}

/**
 * The confirmation (`POST …/picks/:warehouseId/pick`): every line of the part once, an uncounted
 * line at its reserved quantity, each with its shelf; `missingBins` counts the lines without one
 * (the server would refuse the whole part).
 */
export function confirmBody(
  lines: readonly Pick<PickLine, 'id' | 'qtyApproved'>[],
  counts: Counts,
  infos: readonly Pick<PickLineInfo, 'lineId' | 'proposedBinId' | 'bins'>[],
  bins: Readonly<Record<number, number>>,
): { lines: ConfirmLine[]; uncounted: number; missingBins: number } {
  let uncounted = 0;
  let missingBins = 0;
  const body = lines.map((line) => {
    const typed = counts[line.id];
    if (typed === undefined) uncounted += 1;
    const binId = binOf(
      infos.find((info) => info.lineId === line.id),
      bins[line.id],
    );
    if (binId === null) missingBins += 1;
    return { lineId: line.id, qty: typed ?? line.qtyApproved, binId: binId ?? 0 };
  });
  return { lines: body, uncounted, missingBins };
}
