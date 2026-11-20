import { randomUUID } from 'node:crypto';
import { Decimal, toMoney } from '@tugeel/shared/money';
import {
  KPI_SOURCES,
  type KpiSource,
  PAYROLL_AMOUNT_PATTERN,
  PAYROLL_LIMITS,
} from '@tugeel/shared/payroll';
import { invalid } from '../../common/errors/app-error';

/** One item of a KPI sheet or template as it is stored (jsonb) and sent. */
export interface KpiSheetItem {
  /** Stable within the sheet: a payslip's item keeps its score through a refresh of the terms. */
  key: string;
  name: string;
  source: KpiSource;
  /** Money as text with two decimals. */
  amount: string;
  sort: number;
}

export interface KpiSheetItemInput {
  key?: string | null;
  name: string;
  source: KpiSource;
  amount: string;
  sort?: number | null;
}

/** `1234.5` → a money Decimal; refuses anything that is not a plain non-negative amount. */
export function amountOf(path: string, value: string): Decimal {
  if (!PAYROLL_AMOUNT_PATTERN.test(value)) {
    throw invalid(path, 'isAmount', 'an amount of at most 99,999,999.99 with two decimals');
  }
  return toMoney(value);
}

/**
 * A sheet's items checked and cleaned: named, a known source, an amount, at most one ATTENDANCE
 * item (there is one attendance score a month), keys unique; ordered by `sort`, then as given.
 */
export function checkedItems(raw: readonly KpiSheetItemInput[], path = 'items'): KpiSheetItem[] {
  if (raw.length > PAYROLL_LIMITS.maxItems) {
    throw invalid(path, 'arrayMaxSize', `at most ${PAYROLL_LIMITS.maxItems} KPI items`);
  }
  const keys = new Set<string>();
  let attendance = 0;
  const items = raw.map((item, index): KpiSheetItem => {
    const at = `${path}[${index}]`;
    const name = item.name.trim();
    if (name.length === 0) throw invalid(`${at}.name`, 'isNotEmpty', 'a KPI item needs a name');
    if ([...name].length > PAYROLL_LIMITS.maxName) {
      throw invalid(`${at}.name`, 'maxLength', `at most ${PAYROLL_LIMITS.maxName} characters`);
    }
    if (!KPI_SOURCES.includes(item.source)) {
      throw invalid(`${at}.source`, 'isIn', KPI_SOURCES.join(', '));
    }
    if (item.source === 'ATTENDANCE') attendance += 1;
    const key = item.key?.trim() ? item.key.trim() : randomUUID();
    if (key.length > 64) throw invalid(`${at}.key`, 'maxLength', 'at most 64 characters');
    if (keys.has(key)) throw invalid(`${at}.key`, 'unique', 'a key is used once on a sheet');
    keys.add(key);
    return {
      key,
      name,
      source: item.source,
      amount: amountOf(`${at}.amount`, item.amount).toFixed(2),
      sort: Number.isInteger(item.sort) ? (item.sort as number) : index,
    };
  });
  if (attendance > 1) {
    throw invalid(path, 'oneAttendance', 'a sheet has at most one attendance item');
  }
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.sort - b.item.sort || a.index - b.index)
    .map(({ item }) => item);
}

/** The stored jsonb read back; rows written by this module only, so a light shape check suffices. */
export function storedItems(value: unknown): KpiSheetItem[] {
  if (!Array.isArray(value)) return [];
  return (value as KpiSheetItem[]).map((item) => ({
    key: String(item.key),
    name: String(item.name),
    source: item.source,
    amount: new Decimal(item.amount).toFixed(2),
    sort: item.sort,
  }));
}

/** A template's items copied onto a person's sheet: the same rows under new keys. */
export function copiedItems(items: readonly KpiSheetItem[]): KpiSheetItem[] {
  return items.map((item) => ({ ...item, key: randomUUID() }));
}
