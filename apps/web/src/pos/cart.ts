import { Decimal } from '@tugeel/shared/money';
import type { EdgeCartLine, EdgeProductHit } from '@tugeel/shared/pos';
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
  add: (product: EdgeProductHit, unitId: number) => void;
  setQty: (unitId: number, qty: string) => void;
  step: (unitId: number, delta: 1 | -1) => void;
  remove: (unitId: number) => void;
  select: (unitId: number | null) => void;
  moveSelection: (delta: 1 | -1) => void;
  clear: () => void;
  /** A parked basket coming back (ADR-0104): its lines replace the empty cart. */
  load: (lines: readonly CartLine[]) => void;
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

  const add = useCallback((product: EdgeProductHit, unitId: number) => {
    const unit = product.units.find((entry) => entry.unitId === unitId);
    setLines((previous) => {
      if (previous.some((line) => line.productUnitId === unitId)) {
        return previous.map((line) =>
          line.productUnitId === unitId
            ? { ...line, qty: new Decimal(line.qty).plus(1).toFixed() }
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
  }, []);

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
