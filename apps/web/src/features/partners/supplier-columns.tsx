import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { formatCount } from '@/lib/money';
import type { SupplierListItem } from './api';
import { contactCell, none, text } from './list-cells';
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

export interface SupplierColumn {
  key: SupplierColumnKey;
  /** Counts: right-aligned in the head and the cells. */
  numeric?: boolean;
  /** Long text on one line with «…» and the whole text on hover; `fill` takes the spare width. */
  truncate?: { text: (row: SupplierListItem, t: TFunction) => string; fill?: boolean };
  className?: string;
  cell: (row: SupplierListItem, t: TFunction) => ReactNode;
}

export const SUPPLIER_COLUMNS: readonly SupplierColumn[] = [
  { key: 'code', className: 'font-mono', cell: (row) => row.code },
  {
    key: 'name',
    // The name takes the spare width, never less than 14rem: with many columns the list scrolls.
    truncate: { text: (row) => row.name, fill: true },
    className: 'min-w-56',
    cell: (row) => (
      <Link
        to={`/partners/suppliers/${row.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.name}
      </Link>
    ),
  },
  { key: 'regNo', className: 'font-mono', cell: (row, t) => text(row.regNo, t) },
  { key: 'tin', className: 'font-mono', cell: (row, t) => text(row.tin, t) },
  {
    key: 'phone',
    className: 'font-mono',
    cell: (row, t) => (row.phone ? localPhone(row.phone) : none(t)),
  },
  { key: 'email', cell: (row, t) => text(row.email, t) },
  {
    key: 'address',
    truncate: { text: (row, t) => row.address ?? t('common.none') },
    cell: (row, t) => text(row.address, t),
  },
  { key: 'bankName', cell: (row, t) => text(row.bankName, t) },
  { key: 'bankAccount', className: 'font-mono', cell: (row, t) => text(row.bankAccount, t) },
  {
    key: 'paymentTerm',
    cell: (row, t) =>
      row.paymentTermDays === null
        ? none(t)
        : t('partners.credit.termCustomer', { days: row.paymentTermDays }),
  },
  { key: 'contact', cell: (row, t) => contactCell(row.contact, t) },
  { key: 'productCount', numeric: true, cell: (row) => formatCount(row.productCount) },
  {
    key: 'note',
    truncate: { text: (row, t) => row.note ?? t('common.none') },
    cell: (row, t) => text(row.note, t),
  },
  {
    key: 'status',
    cell: (row, t) => (
      <Badge variant={row.status === 'ACTIVE' ? 'success' : 'secondary'}>
        {t(`partners.status.${row.status}`)}
      </Badge>
    ),
  },
];
