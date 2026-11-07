import type { ColumnSpec } from '@/lib/column-layout';

/** Every column of the list (ADR-0172 #8), as on the old page. */
export const EXPIRY_COLUMN_KEYS = [
  'product',
  'supplier',
  'note',
  'expiryDate',
  'daysLeft',
  'qtyFloor',
  'qtyWarehouse',
  'qtyTotal',
  'status',
  'liability',
  'createdBy',
  'createdAt',
] as const;
export type ExpiryColumnKey = (typeof EXPIRY_COLUMN_KEYS)[number];

/** What names the row and what the list is for: never hidden. */
export const LOCKED_EXPIRY_COLUMNS: readonly ExpiryColumnKey[] = ['product', 'expiryDate'];

/**
 * What a user who never chose sees hidden (ADR-0066): the product, the date, the days left, the
 * counts and the status fit a 1366px screen beside the filter panel; every column stays in
 * «Баганууд», and the A4 print shows them all.
 */
export const DEFAULT_HIDDEN_EXPIRY_COLUMNS: readonly ExpiryColumnKey[] = [
  'supplier',
  'note',
  'liability',
  'createdBy',
  'createdAt',
];

/** On a screen of 1600px or more the note fits too (ADR-0119). */
export const WIDE_DEFAULT_HIDDEN_EXPIRY_COLUMNS: readonly ExpiryColumnKey[] = [
  'supplier',
  'liability',
  'createdBy',
  'createdAt',
];

/** The layout of each column (ADR-0119): a name 3, a note or a partner 2, short text 1. */
export const EXPIRY_COLUMN_SPECS: Record<ExpiryColumnKey, ColumnSpec> = {
  product: { key: 'product', kind: 'text', weight: 3, min: 13 },
  supplier: { key: 'supplier', kind: 'text', weight: 2, min: 8 },
  note: { key: 'note', kind: 'text', weight: 2, min: 9 },
  expiryDate: { key: 'expiryDate', kind: 'date' },
  daysLeft: { key: 'daysLeft', kind: 'status', width: 10 },
  qtyFloor: { key: 'qtyFloor', kind: 'qty', width: 4.75 },
  qtyWarehouse: { key: 'qtyWarehouse', kind: 'qty', width: 5 },
  qtyTotal: { key: 'qtyTotal', kind: 'qty', width: 4.75 },
  status: { key: 'status', kind: 'status', width: 11.5 },
  liability: { key: 'liability', kind: 'text', weight: 2, min: 9 },
  createdBy: { key: 'createdBy', kind: 'text', weight: 1, min: 7 },
  createdAt: { key: 'createdAt', kind: 'datetime' },
};

export const CHEVRON_COLUMN: ColumnSpec = { key: 'chevron', kind: 'chevron' };

const NUMERIC: readonly ExpiryColumnKey[] = ['qtyFloor', 'qtyWarehouse', 'qtyTotal'];

export const isNumericColumn = (key: ExpiryColumnKey): boolean => NUMERIC.includes(key);
