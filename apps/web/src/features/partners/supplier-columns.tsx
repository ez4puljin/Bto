import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { formatCount } from '@/lib/money';
import type { SupplierListItem } from './api';
import { contactCell, none, text } from './list-cells';
import type { ListColumn } from './list-column-cell';
import { localPhone } from './phone';

/** Every column of the supplier list (ADR-0037). */
export const SUPPLIER_COLUMN_KEYS = [
  'code',
  'name',
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
 * What a user who never chose sees hidden (ADR-0066): code, name, phone, TIN, the contact, the
 * product count and status fit a 1366px screen; every column stays in «Баганууд».
 */
export const DEFAULT_HIDDEN_SUPPLIER_COLUMNS: readonly SupplierColumnKey[] = [
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
  { key: 'contact', kind: 'text', weight: 2, cell: (row, t) => contactCell(row.contact, t) },
  {
    key: 'productCount',
    kind: 'count',
    numeric: true,
    cell: (row) => formatCount(row.productCount),
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
