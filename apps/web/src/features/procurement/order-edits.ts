import { Decimal } from '@tugeel/shared/money';
import { joinBoxes, PO_COLUMN_GROUPS, type PoColumnGroup } from '@tugeel/shared/procurement';
import { useHasAnyPermission } from '@/app/auth-context';
import { parseCount } from '@/features/inventory/helpers';
import { plainDecimal } from '@/lib/money';
import type { ArrivalChange, GridChange, GridRow, GridUnit } from './api';

/** The column groups of the detail page (ADR-0118 #5), hidden per user in the browser (ADR-0050). */
export const GROUP_KEYS: readonly PoColumnGroup[] = PO_COLUMN_GROUPS;
export const COLUMNS_LIST = 'procurement.order';

/**
 * A typed cell kept over the server's rows until it is saved (ADR-0115, ADR-0118): what was typed
 * and the value the cell had when the page opened (`prev*`), so the server can skip a cell someone
 * else changed meanwhile. One map holds every supplier's cells; «Хадгалах (n)» sends them per
 * supplier and per kind.
 */
export type CellEdit =
  | {
      kind: 'order';
      supplierId: number;
      productId: number;
      label: string;
      units: GridUnit[];
      unitId: number;
      qty: string;
      prevUnitId: number | null;
      prevQty: string | null;
    }
  | {
      kind: 'shipped';
      supplierId: number;
      productId: number;
      label: string;
      unitId: number;
      qty: string;
      prevQty: string | null;
    }
  | {
      kind: 'arrival';
      supplierId: number;
      lineId: number;
      productId: number;
      label: string;
      /** Pieces per box of the ordered unit. */
      factor: string;
      boxes: string;
      pieces: string;
      notArrived: boolean;
      note: string;
      prevBase: string | null;
      prevNote: string | null;
    }
  | {
      kind: 'price';
      supplierId: number;
      lineId: number;
      productId: number;
      label: string;
      /** Per the receipt line's unit. */
      unitPrice: string;
      prev: string | null;
    }
  | { kind: 'noteAmount'; supplierId: number; amount: string; prev: string | null };

export type EditKind = CellEdit['kind'];

export const editKey = (edit: CellEdit): string => {
  switch (edit.kind) {
    case 'order':
    case 'shipped':
      return `${edit.kind}:${edit.supplierId}:${edit.productId}`;
    case 'arrival':
    case 'price':
      return `${edit.kind}:${edit.supplierId}:${edit.lineId}`;
    case 'noteAmount':
      return `${edit.kind}:${edit.supplierId}`;
  }
};

/** The largest unit (units come base first, then by factor): people order boxes. */
export const defaultUnitId = (units: readonly GridUnit[]) => units[units.length - 1]?.id ?? 0;

/** Empty or 0 removes the line; otherwise a count with at most three decimals. */
export function normalizeQty(text: string): { valid: boolean; qty: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: true, qty: null };
  const value = parseCount(trimmed);
  if (value === null) return { valid: false, qty: null };
  return { valid: true, qty: new Decimal(value).isZero() ? null : value };
}

/** A shipped quantity: empty = not typed, 0 = not shipped. */
export function normalizeShipped(text: string): { valid: boolean; qty: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: true, qty: null };
  const value = parseCount(trimmed);
  return value === null ? { valid: false, qty: null } : { valid: true, qty: value };
}

/** A price with at most two decimals, not negative. */
export function normalizePrice(text: string): { valid: boolean; price: string | null } {
  const trimmed = text.trim().replace(',', '.').replace(/\s/g, '');
  if (!trimmed) return { valid: true, price: null };
  return /^\d{1,12}(\.\d{1,2})?$/.test(trimmed)
    ? { valid: true, price: trimmed }
    : { valid: false, price: null };
}

/** Boxes × pieces as a base quantity: null while nothing is typed, '0' for «ирээгүй». */
export function arrivedBaseOf(edit: Extract<CellEdit, { kind: 'arrival' }>): {
  valid: boolean;
  base: string | null;
} {
  if (edit.notArrived) return { valid: true, base: '0' };
  const boxes = edit.boxes.trim();
  const pieces = edit.pieces.trim();
  if (!boxes && !pieces) return { valid: true, base: null };
  const b = boxes ? parseCount(boxes) : '0';
  const p = pieces ? parseCount(pieces) : '0';
  if (b === null || p === null) return { valid: false, base: null };
  return { valid: true, base: joinBoxes(b, p, edit.factor).toFixed() };
}

export function isDirty(edit: CellEdit): boolean {
  switch (edit.kind) {
    case 'order': {
      const { valid, qty } = normalizeQty(edit.qty);
      if (!valid) return true;
      if (qty === null) return edit.prevQty !== null;
      if (edit.prevQty === null) return true;
      return !new Decimal(qty).eq(edit.prevQty) || edit.unitId !== edit.prevUnitId;
    }
    case 'shipped': {
      const { valid, qty } = normalizeShipped(edit.qty);
      if (!valid) return true;
      if (qty === null || edit.prevQty === null) return qty !== edit.prevQty;
      return !new Decimal(qty).eq(edit.prevQty);
    }
    case 'arrival': {
      const { valid, base } = arrivedBaseOf(edit);
      if (!valid) return true;
      const noteChanged = (edit.note.trim() || null) !== (edit.prevNote ?? null);
      if (base === null || edit.prevBase === null) return base !== edit.prevBase || noteChanged;
      return !new Decimal(base).eq(edit.prevBase) || noteChanged;
    }
    case 'price': {
      const { valid, price } = normalizePrice(edit.unitPrice);
      if (!valid) return true;
      if (price === null || edit.prev === null) return price !== edit.prev;
      return !new Decimal(price).eq(edit.prev);
    }
    case 'noteAmount': {
      const { valid, price } = normalizePrice(edit.amount);
      if (!valid) return true;
      if (price === null || edit.prev === null) return price !== edit.prev;
      return !new Decimal(price).eq(edit.prev);
    }
  }
}

export function isValid(edit: CellEdit): boolean {
  switch (edit.kind) {
    case 'order':
      return normalizeQty(edit.qty).valid;
    case 'shipped':
      return normalizeShipped(edit.qty).valid;
    case 'arrival':
      return arrivedBaseOf(edit).valid;
    case 'price':
      return normalizePrice(edit.unitPrice).valid;
    case 'noteAmount':
      return normalizePrice(edit.amount).valid;
  }
}

export function toGridChange(edit: Extract<CellEdit, { kind: 'order' | 'shipped' }>): GridChange {
  if (edit.kind === 'shipped') {
    return {
      productId: edit.productId,
      field: 'SHIPPED',
      productUnitId: edit.unitId,
      qty: normalizeShipped(edit.qty).qty,
      previousUnitId: edit.unitId,
      previousQty: edit.prevQty,
    };
  }
  const { qty } = normalizeQty(edit.qty);
  return {
    productId: edit.productId,
    field: 'ORDERED',
    productUnitId: qty === null ? null : edit.unitId,
    qty,
    previousUnitId: edit.prevUnitId,
    previousQty: edit.prevQty,
  };
}

export function toArrivalChange(edit: Extract<CellEdit, { kind: 'arrival' }>): ArrivalChange {
  const { base } = arrivedBaseOf(edit);
  const note = edit.note.trim() || null;
  const baseChanged =
    base === null || edit.prevBase === null
      ? base !== edit.prevBase
      : !new Decimal(base).eq(edit.prevBase);
  return {
    lineId: edit.lineId,
    ...(base !== null && baseChanged ? { arrivedQtyBase: base } : {}),
    ...(note !== (edit.prevNote ?? null) ? { note } : {}),
    previousArrivedQtyBase: edit.prevBase,
  };
}

/** Whether the signed-in user may type anything on the page at all (the save button shows). */
export function useCanTypeOnOrder(): boolean {
  return useHasAnyPermission([
    'procurement.orders.edit',
    'procurement.orders.manage',
    'inventory.receipts.manage',
    'inventory.costs.manage',
  ]);
}

export const rowLabel = (row: GridRow) => `${row.sku} ${row.name}`;

export function orderEditOf(
  supplierId: number,
  row: GridRow,
): Extract<CellEdit, { kind: 'order' }> {
  return {
    kind: 'order',
    supplierId,
    productId: row.productId,
    label: rowLabel(row),
    units: row.units,
    unitId: row.line?.productUnitId ?? defaultUnitId(row.units),
    qty: row.line ? plainDecimal(row.line.qty) : '',
    prevUnitId: row.line?.productUnitId ?? null,
    prevQty: row.line?.qty ?? null,
  };
}

export function shippedEditOf(
  supplierId: number,
  row: GridRow,
): Extract<CellEdit, { kind: 'shipped' }> {
  return {
    kind: 'shipped',
    supplierId,
    productId: row.productId,
    label: rowLabel(row),
    unitId: row.line?.productUnitId ?? defaultUnitId(row.units),
    qty: row.line?.shippedQty ? plainDecimal(row.line.shippedQty) : '',
    prevQty: row.line?.shippedQty ?? null,
  };
}

/** The ordered unit's factor: boxes × pieces are shown in the unit the goods were ordered in. */
export function orderedFactor(row: GridRow): string {
  const unit = row.units.find((candidate) => candidate.id === row.line?.productUnitId);
  return unit?.factor ?? row.units[row.units.length - 1]?.factor ?? '1';
}

export function arrivalEditOf(
  supplierId: number,
  row: GridRow,
): Extract<CellEdit, { kind: 'arrival' }> | null {
  if (!row.receipt) return null;
  const factor = orderedFactor(row);
  const base = row.receipt.arrivedBase;
  const split =
    base === null
      ? { boxes: '', pieces: '' }
      : new Decimal(factor).lte(1)
        ? { boxes: '', pieces: plainDecimal(base) }
        : {
            boxes: plainDecimal(new Decimal(base).div(factor).floor().toString()),
            pieces: plainDecimal(
              new Decimal(base)
                .minus(new Decimal(base).div(factor).floor().times(factor))
                .toString(),
            ),
          };
  return {
    kind: 'arrival',
    supplierId,
    lineId: row.receipt.lineId,
    productId: row.productId,
    label: rowLabel(row),
    factor,
    boxes: split.boxes,
    pieces: split.pieces,
    notArrived: base !== null && new Decimal(base).isZero(),
    note: row.receipt.note ?? '',
    prevBase: base,
    prevNote: row.receipt.note,
  };
}

export function priceEditOf(
  supplierId: number,
  row: GridRow,
): Extract<CellEdit, { kind: 'price' }> | null {
  if (!row.receipt) return null;
  const current = row.receipt.docUnitPrice ?? null;
  return {
    kind: 'price',
    supplierId,
    lineId: row.receipt.lineId,
    productId: row.productId,
    label: rowLabel(row),
    unitPrice: current === null ? '' : plainDecimal(current),
    prev: current,
  };
}
