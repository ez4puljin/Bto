import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import type { SupplierListItem } from './api';
import { contactCell, none, text } from './list-cells';
import type { ListColumn } from './list-column-cell';
import { localPhone } from './phone';
import { SupplierProductCount } from './supplier-products-popover';

/** Every column of the supplier list (ADR-0037). */
export const SUPPLIER_COLUMN_KEYS = [
  'code',
  'name',
  'category',
  'regNo',
  'tin',
  'phone',
  'email',
  'address',
  'bankName',
  'bankAccount',
  'paymentTerm',
  'contact',
  'productCount',
  'note',
  'status',
] as const;
export type SupplierColumnKey = (typeof SUPPLIER_COLUMN_KEYS)[number];

/** Columns that name the row; they cannot be hidden. */
export const LOCKED_SUPPLIER_COLUMNS: readonly SupplierColumnKey[] = ['code', 'name'];

/**
 * What a user who never chose sees hidden (ADR-0066): the code, the name, the category, the phone,
 * the contact, the product count and the status show; every column stays in «Баганууд».
 */
export const DEFAULT_HIDDEN_SUPPLIER_COLUMNS: readonly SupplierColumnKey[] = [
  'tin',
  'regNo',
  'email',
  'address',
  'bankName',
  'bankAccount',
  'paymentTerm',
  'note',
];

/**
 * What that user sees hidden on a screen of 1600px or more (ADR-0119): the email, the address,
 * the bank and the payment term fit there too.
 */
export const WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS: readonly SupplierColumnKey[] = [
  'regNo',
  'bankAccount',
  'note',
];

/**
 * The columns that leave a default set too wide for its table (ADR-0201), the least needed first
 * and one at a time; the supplier's own page shows each. The default set needs 62.75rem: beside
 * the filters a 1366px window has 59.35 and lets the contact go (52.75), which a till PC's 56.2
 * holds too; a tablet upright has 41.2 and keeps the code, the name, the product count and the
 * status (36.75). The wide set's five columns (98.75) go first: beside the filters a 1600px window
 * (67.9) shows the default set and a 1920px one (80) the TIN and the email with it (77.75).
 * `partners-logic.test.ts` checks the sums against the screens.
 */
export const SUPPLIER_COLUMNS_LEAVING: readonly SupplierColumnKey[] = [
  'paymentTerm',
  'bankName',
  'address',
  'email',
  'tin',
  'contact',
  'phone',
  'category',
];

/** A column of the supplier list, sized by the layout (ADR-0119). */
export interface SupplierColumn extends ListColumn<SupplierListItem> {
  key: SupplierColumnKey;
}

export const SUPPLIER_COLUMNS: readonly SupplierColumn[] = [
  { key: 'code', kind: 'code', className: 'font-mono', cell: (row) => row.code },
  {
    key: 'name',
    // The name takes the largest share of the spare width, never less than 12rem: with many
    // columns the list scrolls.
    kind: 'text',
    weight: 3,
    min: 12,
    truncate: { text: (row) => row.name },
    cell: (row) => (
      <Link
        to={`/partners/suppliers/${row.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.name}
      </Link>
    ),
  },
  {
    key: 'category',
    kind: 'text',
    weight: 2,
    min: 8,
    truncate: { text: (row, t) => row.categoryPath ?? t('common.none') },
    cell: (row, t) => text(row.categoryPath, t),
  },
  { key: 'regNo', kind: 'number', className: 'font-mono', cell: (row, t) => text(row.regNo, t) },
  {
    key: 'tin',
    kind: 'number',
    width: 8,
    className: 'font-mono',
    cell: (row, t) => text(row.tin, t),
  },
  {
    key: 'phone',
    kind: 'number',
    width: 8,
    className: 'font-mono',
    cell: (row, t) => (row.phone ? localPhone(row.phone) : none(t)),
  },
  { key: 'email', kind: 'text', weight: 2, cell: (row, t) => text(row.email, t) },
  {
    key: 'address',
    kind: 'text',
    weight: 2,
    truncate: { text: (row, t) => row.address ?? t('common.none') },
    cell: (row, t) => text(row.address, t),
  },
  { key: 'bankName', kind: 'text', cell: (row, t) => text(row.bankName, t) },
  {
    key: 'bankAccount',
    kind: 'number',
    className: 'font-mono',
    cell: (row, t) => text(row.bankAccount, t),
  },
  {
    key: 'paymentTerm',
    kind: 'text',
    cell: (row, t) =>
      row.paymentTermDays === null
        ? none(t)
        : t('partners.credit.termCustomer', { days: row.paymentTermDays }),
  },
  {
    key: 'contact',
    kind: 'text',
    weight: 2,
    // The phone whole and some letters of the name.
    min: 10,
    cell: (row, t) => contactCell(row.contact, t),
  },
  {
    key: 'productCount',
    kind: 'count',
    width: 7,
    numeric: true,
    cell: (row) => (
      <SupplierProductCount supplierId={row.id} name={row.name} count={row.productCount} />
    ),
  },
  {
    key: 'note',
    kind: 'text',
    weight: 2,
    truncate: { text: (row, t) => row.note ?? t('common.none') },
    cell: (row, t) => text(row.note, t),
  },
  {
    key: 'status',
    kind: 'status',
    cell: (row, t) => (
      <Badge variant={row.status === 'ACTIVE' ? 'success' : 'secondary'}>
        {t(`partners.status.${row.status}`)}
      </Badge>
    ),
  },
];
