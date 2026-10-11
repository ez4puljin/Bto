import type { components } from '@tugeel/api-client';
import { ADJUSTMENT_REASONS, type AdjustmentReason } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { useMemo } from 'react';
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
  return (id) => names.get(id) ?? String(id);
}

/** A scanned text that looks like a shelf label ("A-01-03") rather than a product barcode. */
export function looksLikeLabel(code: string): boolean {
  return /[A-Za-z-]/.test(code);
}

/** A positive quantity with at most three decimals (NUMERIC(14,3)). */
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

export function isQty(value: string): boolean {
  return QTY.test(value) && new Decimal(value).isPositive();
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

export type CostingMode = 'amount' | 'unitPrice';
export interface CostingValue {
  value: string;
  free: boolean;
}

/** The amount a receipt line will be costed at, or null while its field is empty or invalid. */
export function lineAmount(
  mode: CostingMode,
  entry: CostingValue,
  enteredQty: string,
): Decimal | null {
  if (entry.free) return new Decimal(0);
  const value = entry.value.trim();
  if (!MONEY.test(value)) return null;
  return mode === 'amount'
    ? new Decimal(value)
    : new Decimal(value).times(enteredQty).toDecimalPlaces(2);
}
