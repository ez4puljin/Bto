import { Decimal } from '@tugeel/shared/money';
import type { EdgeCartLine, EdgeProductHit, EdgeQuotedLine } from '@tugeel/shared/pos';
import { bonusSplit, bonusTotalFromPaid } from '@tugeel/shared/pricing';
import { useCallback, useMemo, useState } from 'react';

/** One line of the basket: a product's unit and how many; the prices come from the edge's quote. */
export interface CartLine {
  productUnitId: number;
  productId: number;
  sku: string;
  name: string;
  uomName: string;
  qty: string;
}

export interface Cart {
  lines: readonly CartLine[];
  /** The line the keyboard acts on (↑/↓, + / −, Delete), by its unit. */
  selected: number | null;
  /** The cart as the edge prices and sells it. */
  wire: readonly EdgeCartLine[];
  /** One more unit; on a line entered by its paid quantity, one more paid unit. */
  add: (product: EdgeProductHit, unitId: number, entry?: PaidEntry | null) => void;
  setQty: (unitId: number, qty: string) => void;
  step: (unitId: number, delta: 1 | -1) => void;
  remove: (unitId: number) => void;
  select: (unitId: number | null) => void;
  moveSelection: (delta: 1 | -1) => void;
  clear: () => void;
  /** A parked basket coming back (ADR-0104): its lines replace the empty cart. */
  load: (lines: readonly CartLine[]) => void;
}

/**
 * An N+M line the cashier enters by the quantity the customer pays for (owner 2026-11-17): the
 * edge's latest quote says the line is the product's only line, in its base unit, under one N+M
 * program. The cart still holds and sends the goods that leave (paid + free, ADR-0159 #3).
 */
export interface PaidEntry {
  n: Decimal;
  m: Decimal;
}

export function paidEntryOf(quoted: EdgeQuotedLine | undefined): PaidEntry | null {
  const bonus = quoted?.bonus;
  return bonus?.paidEntry ? { n: new Decimal(bonus.n), m: new Decimal(bonus.m) } : null;
}

/** The quantity the cashier sees and types: the paid part on a paid-entry line, else as held. */
export function shownQty(qty: string, entry: PaidEntry | null): string {
  return entry ? bonusSplit(new Decimal(qty), entry.n, entry.m).paid.toFixed() : qty;
}

/** The free part of a paid-entry line's quantity (0 otherwise). */
export function freeQty(qty: string, entry: PaidEntry | null): string {
  return entry ? bonusSplit(new Decimal(qty), entry.n, entry.m).free.toFixed() : '0';
}

/** The quantity the cart holds and sends for a typed (paid) quantity. */
export function heldQty(shown: string, entry: PaidEntry | null): string {
  return entry ? bonusTotalFromPaid(new Decimal(shown), entry.n, entry.m).toFixed() : shown;
}

/** Whether − may take one off: the line keeps more than zero. */
export function canDecrease(qty: string): boolean {
  return new Decimal(qty).minus(1).gt(0);
}

/**
 * The basket of the sale on screen. A scan or a search adds the unit with quantity 1, or 1 more to
 * that unit's line, and selects it; a line is one unit of one product.
 */
export function useCart(): Cart {
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const add = useCallback(
    (product: EdgeProductHit, unitId: number, entry: PaidEntry | null = null) => {
      const unit = product.units.find((one) => one.unitId === unitId);
      setLines((previous) => {
        if (previous.some((line) => line.productUnitId === unitId)) {
          return previous.map((line) =>
            line.productUnitId === unitId
              ? {
                  ...line,
                  qty: heldQty(new Decimal(shownQty(line.qty, entry)).plus(1).toFixed(), entry),
                }
              : line,
          );
        }
        return [
          ...previous,
          {
            productUnitId: unitId,
            productId: product.productId,
            sku: product.sku,
            name: product.name,
            uomName: unit?.uomName ?? '',
            qty: '1',
          },
        ];
      });
      setSelected(unitId);
    },
    [],
  );

  const setQty = useCallback((unitId: number, qty: string) => {
    setLines((previous) =>
      previous.map((line) => (line.productUnitId === unitId ? { ...line, qty } : line)),
    );
  }, []);

  const step = useCallback((unitId: number, delta: 1 | -1) => {
    setLines((previous) =>
      previous.map((line) => {
        if (line.productUnitId !== unitId) return line;
        if (delta < 0 && !canDecrease(line.qty)) return line;
        return { ...line, qty: new Decimal(line.qty).plus(delta).toFixed() };
      }),
    );
  }, []);

  const remove = useCallback(
    (unitId: number) => {
      const index = lines.findIndex((line) => line.productUnitId === unitId);
      const rest = lines.filter((line) => line.productUnitId !== unitId);
      setLines(rest);
      if (selected === unitId) {
        const next = rest[Math.min(index, rest.length - 1)];
        setSelected(next ? next.productUnitId : null);
      }
    },
    [lines, selected],
  );

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      if (lines.length === 0) return;
      const index = lines.findIndex((line) => line.productUnitId === selected);
      const start = index === -1 ? (delta > 0 ? -1 : lines.length) : index;
      const next = lines[Math.max(0, Math.min(lines.length - 1, start + delta))];
      if (next) setSelected(next.productUnitId);
    },
    [lines, selected],
  );

  const clear = useCallback(() => {
    setLines([]);
    setSelected(null);
  }, []);

  const load = useCallback((next: readonly CartLine[]) => {
    setLines(next);
    setSelected(next.at(-1)?.productUnitId ?? null);
  }, []);

  const wire = useMemo(
    () => lines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty })),
    [lines],
  );

  return {
    lines,
    selected,
    wire,
    add,
    setQty,
    step,
    remove,
    select: setSelected,
    moveSelection,
    clear,
    load,
  };
}
