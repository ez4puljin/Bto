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

/**
 * Where the old page's supplier and author fit too, beside the filter panel: not yet at 1600px
 * (about 66rem of room against the 77.5 they need), but from the root's last step (19px, index.css),
 * which a 1920 screen is on with room to spare.
 */
export const FULL_SCREEN = '(min-width: 1900px)';
export const FULL_DEFAULT_HIDDEN_EXPIRY_COLUMNS: readonly ExpiryColumnKey[] = [
  'liability',
  'createdAt',
];

const QTY_WIDTH = 5.5;

/**
 * The layout of each column (ADR-0119): a name 3, a note or a partner 2, short text 1. The days wrap
 * in their cell («172 хоног / өнгөрсөн»), a row having two lines anyway; a cell of the status holds
 * the longest pill, and a count holds «123,456» or «1,234.56» whole, as its cell gives no other way
 * to read it. The sums are checked against the screens in `expiry-page.test.tsx`.
 */
export const EXPIRY_COLUMN_SPECS: Record<ExpiryColumnKey, ColumnSpec> = {
  product: { key: 'product', kind: 'text', weight: 3, min: 12 },
  supplier: { key: 'supplier', kind: 'text', weight: 2, min: 7 },
  note: { key: 'note', kind: 'text', weight: 2, min: 7 },
  expiryDate: { key: 'expiryDate', kind: 'date' },
  daysLeft: { key: 'daysLeft', kind: 'status', width: 8 },
  qtyFloor: { key: 'qtyFloor', kind: 'qty', width: QTY_WIDTH },
  qtyWarehouse: { key: 'qtyWarehouse', kind: 'qty', width: QTY_WIDTH },
  qtyTotal: { key: 'qtyTotal', kind: 'qty', width: QTY_WIDTH },
  status: { key: 'status', kind: 'status', width: 11.5 },
  liability: { key: 'liability', kind: 'text', weight: 2, min: 9 },
  createdBy: { key: 'createdBy', kind: 'text', weight: 1, min: 6 },
  createdAt: { key: 'createdAt', kind: 'datetime' },
};

export const CHEVRON_COLUMN: ColumnSpec = { key: 'chevron', kind: 'chevron' };

const NUMERIC: readonly ExpiryColumnKey[] = ['qtyFloor', 'qtyWarehouse', 'qtyTotal'];

export const isNumericColumn = (key: ExpiryColumnKey): boolean => NUMERIC.includes(key);
