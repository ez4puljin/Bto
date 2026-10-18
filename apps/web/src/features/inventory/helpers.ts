import type { components } from '@tugeel/api-client';
import { ADJUSTMENT_REASONS, type AdjustmentReason, lineAmountOf } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { fromBase } from '@tugeel/shared/units';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthState } from '@/app/auth-context';
import { useWarehouses } from '@/features/identity/api';

type WarehouseKind = components['schemas']['WarehouseKind'];

/**
 * Active warehouses of the given kinds; with `writable`, only those the user may write documents
 * for (ADR-0027 #7), so a form never offers a warehouse the server would refuse.
 */
export function useWarehouseOptions(kinds: readonly WarehouseKind[], writable = false) {
  const warehouses = useWarehouses();
  const state = useAuthState();
  const scope = state.status === 'authenticated' ? state.me.writableWarehouseIds : null;
  const options = useMemo(
    () =>
      (warehouses.data ?? []).filter(
        (warehouse) =>
          warehouse.status === 'ACTIVE' &&
          kinds.includes(warehouse.kind) &&
          (!writable || scope === null || scope.includes(warehouse.id)),
      ),
    [warehouses.data, kinds, writable, scope],
  );
  return { options, isPending: warehouses.isPending, error: warehouses.error };
}

/** Warehouse names by id, for list rows that carry only the id (TRANSIT by its kind, as on /warehouses). */
export function useWarehouseName(): (id: number) => string {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const names = useMemo(
    () =>
      new Map(
        (warehouses.data ?? []).map((warehouse) => [
          warehouse.id,
          warehouse.kind === 'TRANSIT' ? t('org.kinds.TRANSIT') : warehouse.name,
        ]),
      ),
    [warehouses.data, t],
  );
  // Stable while the names are, so memoised lists that receive it do not re-render.
  return useCallback((id: number) => names.get(id) ?? String(id), [names]);
}

/** A scanned text that looks like a shelf label ("A-01-03") rather than a product barcode. */
export function looksLikeLabel(code: string): boolean {
  return /[A-Za-z-]/.test(code);
}

/** A positive quantity with at most three decimals (NUMERIC(14,3)). */
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

export function isQty(value: string): boolean {
  return QTY.test(value) && new Decimal(value).gt(0);
}

/** A typed count: at most three decimals, "," taken as the decimal mark of a phone keyboard. */
export function parseCount(text: string): string | null {
  const value = text.trim().replace(',', '.');
  return QTY.test(value) ? value : null;
}

/** The quantity a scan adds («Тоо»): a count above zero. */
export function parseScanQty(text: string): string | null {
  const value = parseCount(text);
  return value !== null && new Decimal(value).gt(0) ? value : null;
}

/** The reason adds stock (found goods, opening stock) rather than writing it off. */
export function isInbound(reason: AdjustmentReason): boolean {
  return ADJUSTMENT_REASONS[reason] === 1;
}

export interface RangeForm {
  rowFrom: string;
  rowTo: string;
  rackFrom: string;
  rackTo: string;
  levelFrom: string;
  levelTo: string;
}

/** The values of a shelf range form, or null while a field is not a letter or a number 0–999. */
export function rangeNumbers(form: RangeForm) {
  const [rackFrom, rackTo, levelFrom, levelTo] = [
    form.rackFrom,
    form.rackTo,
    form.levelFrom,
    form.levelTo,
  ].map((value) => (/^\d{1,3}$/.test(value.trim()) ? Number.parseInt(value.trim(), 10) : null));
  const rowFrom = form.rowFrom.trim().toUpperCase();
  const rowTo = form.rowTo.trim().toUpperCase();
  if (
    rackFrom == null ||
    rackTo == null ||
    levelFrom == null ||
    levelTo == null ||
    !/^[A-Z]$/.test(rowFrom) ||
    !/^[A-Z]$/.test(rowTo)
  ) {
    return null;
  }
  return { rowFrom, rowTo, rackFrom, rackTo, levelFrom, levelTo };
}

/** MNT with at most two decimals, as the API takes it (NUMERIC(14,2)). */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** A receipt line's costing as typed: the field typed last (price per entered unit or line amount), or bonus. */
export interface CostEntry {
  source: 'unitPrice' | 'amount';
  value: string;
  free: boolean;
}

/** The amount a receipt line will be costed at, or null while its field is empty or invalid. */
export function entryAmount(entry: CostEntry, enteredQty: string): Decimal | null {
  if (entry.free) return new Decimal(0);
  const value = parseMoney(entry.value);
  if (value === null) return null;
  return entry.source === 'amount' ? new Decimal(value) : lineAmountOf(value, enteredQty);
}

/** A typed MNT amount as the API takes it ("," read as the decimal mark), or null. */
export function parseMoney(text: string): string | null {
  const value = text.trim().replace(',', '.');
  return MONEY.test(value) ? value : null;
}

/** A transfer count as typed: in the line's unit, or in base units. */
export interface CountEntry {
  qty: string;
  base: boolean;
}

/** The base units of a count, or null while it is not a quantity (zero is one: nothing came). */
export function countBase(count: CountEntry, line: { requestFactor: string }): Decimal | null {
  const text = count.qty.trim();
  if (!QTY.test(text)) return null;
  return new Decimal(text).times(count.base ? 1 : line.requestFactor);
}

/** A base quantity as a count in the line's unit when that is exact, else in base units. */
export function countEntry(qtyBase: string, line: { requestFactor: string }): CountEntry {
  const inLineUnit = new Decimal(qtyBase).dividedBy(line.requestFactor);
  return inLineUnit.decimalPlaces() <= 3
    ? { qty: inLineUnit.toFixed(), base: false }
    : { qty: new Decimal(qtyBase).toFixed(), base: true };
}

/** A base quantity in a line's unit, for display: 30 pieces are 1.25 boxes of 24. */
export function inUnit(qtyBase: string, factor: string): string {
  return fromBase(qtyBase, factor).toFixed();
}

/** Whether a page was opened by its create dialog, which asks for the scan box's focus. */
export function wantsScanFocus(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'focusScan' in state && state.focusScan === true
  );
}

/** Whether the user writes documents for a warehouse (ADR-0027 #7). */
export function useCanWrite(): (warehouseId: number) => boolean {
  const state = useAuthState();
  const scope = state.status === 'authenticated' ? state.me.writableWarehouseIds : [];
  return (warehouseId) => scope === null || scope.includes(warehouseId);
}
