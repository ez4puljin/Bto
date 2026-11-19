import { Decimal } from '@tugeel/shared/money';
import type { ErxesStockMatchReason } from './schema';

/**
 * Erkhet's balances beside Bto's for one Bto warehouse (ADR-0221). Units are not converted: Erkhet's
 * quantity is in erxes's unit of the product, Bto's in its base unit, and a row whose unit names
 * differ says so; the conversion rule is the owner's to decide.
 */

/** An erxes product of the run, its Erkhet quantity summed over the warehouse's locations. */
export interface ErkhetSide {
  erxesId: string;
  code: string | null;
  name: string | null;
  uom: string | null;
  productId: number | null;
  matchReason: ErxesStockMatchReason | null;
  /** false: a call for it was refused, its quantity is unknown. */
  readOk: boolean;
  quantity: Decimal;
}

/** A Bto product's on-hand in the warehouse, in its base unit. */
export interface BtoSide {
  productId: number;
  sku: string;
  name: string;
  /** The base unit's name. */
  unit: string | null;
  onHand: Decimal;
}

export interface MatchedRow {
  productId: number;
  sku: string;
  name: string;
  /** The erxes products that are this Bto product (usually one). */
  erxes: { erxesId: string; code: string | null; name: string | null; uom: string | null }[];
  /** null when a call for one of its erxes products was refused. */
  erkhet: Decimal | null;
  bto: Decimal;
  /** Erkhet − Bto; null when Erkhet's side is unknown. */
  difference: Decimal | null;
  btoUnit: string | null;
  /** An erxes unit name is not Bto's base unit name: the quantities may not be comparable. */
  unitDiffers: boolean;
}

export interface NotInBtoRow {
  erxesId: string;
  code: string | null;
  name: string | null;
  uom: string | null;
  erkhet: Decimal;
  reason: ErxesStockMatchReason;
}

export interface NotInErkhetRow {
  productId: number;
  sku: string;
  name: string;
  bto: Decimal;
  btoUnit: string | null;
}

export interface StockComparison {
  matched: MatchedRow[];
  notInBto: NotInBtoRow[];
  notInErkhet: NotInErkhetRow[];
}

const ZERO = new Decimal(0);

/** Unit names compared as people write them: case and spaces aside. */
export function sameUnit(a: string | null, b: string | null): boolean {
  const key = (value: string | null) => (value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return key(a) === key(b);
}

/**
 * The comparison. `erkhet` holds the run's products that have a balance at the locations or whose
 * Bto product holds stock there; `bto` the Bto side of every product either list names (products
 * that hold no stock with zero). A row with nothing on either side is left out.
 */
export function compareStock(
  erkhet: readonly ErkhetSide[],
  bto: ReadonlyMap<number, BtoSide>,
): StockComparison {
  const groups = new Map<number, ErkhetSide[]>();
  const notInBto: NotInBtoRow[] = [];
  for (const line of erkhet) {
    if (line.productId === null) {
      if (line.readOk && !line.quantity.isZero()) {
        notInBto.push({
          erxesId: line.erxesId,
          code: line.code,
          name: line.name,
          uom: line.uom,
          erkhet: line.quantity,
          reason: line.matchReason ?? 'PRODUCT_NOT_FOUND',
        });
      }
      continue;
    }
    const group = groups.get(line.productId) ?? [];
    group.push(line);
    groups.set(line.productId, group);
  }

  const matched: MatchedRow[] = [];
  for (const [productId, lines] of groups) {
    const side = bto.get(productId);
    const onHand = side?.onHand ?? ZERO;
    const known = lines.every((line) => line.readOk);
    const sum = lines.reduce((total, line) => total.plus(line.quantity), ZERO);
    const erkhetQty = known ? sum : null;
    if (erkhetQty !== null && erkhetQty.isZero() && onHand.isZero()) continue;
    const btoUnit = side?.unit ?? null;
    matched.push({
      productId,
      sku: side?.sku ?? lines[0]?.code ?? '',
      name: side?.name ?? lines[0]?.name ?? '',
      erxes: lines.map(({ erxesId, code, name, uom }) => ({ erxesId, code, name, uom })),
      erkhet: erkhetQty,
      bto: onHand,
      difference: erkhetQty === null ? null : erkhetQty.minus(onHand),
      btoUnit,
      unitDiffers: lines.some((line) => line.uom !== null && !sameUnit(line.uom, btoUnit)),
    });
  }

  const notInErkhet: NotInErkhetRow[] = [];
  for (const side of bto.values()) {
    if (groups.has(side.productId) || side.onHand.isZero()) continue;
    notInErkhet.push({
      productId: side.productId,
      sku: side.sku,
      name: side.name,
      bto: side.onHand,
      btoUnit: side.unit,
    });
  }

  const byCode = (a: { sku: string }, b: { sku: string }) => a.sku.localeCompare(b.sku);
  matched.sort(byCode);
  notInErkhet.sort(byCode);
  notInBto.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''));
  return { matched, notInBto, notInErkhet };
}
