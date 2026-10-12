import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
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

export interface SupplierColumn {
  key: SupplierColumnKey;
  className?: string;
  cell: (row: SupplierListItem, t: TFunction) => ReactNode;
}

export const SUPPLIER_COLUMNS: readonly SupplierColumn[] = [
  { key: 'code', className: 'font-mono', cell: (row) => row.code },
  {
    key: 'name',
    className: 'min-w-48 whitespace-normal',
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
    className: 'min-w-48 whitespace-normal',
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
  { key: 'contact', className: 'whitespace-normal', cell: (row, t) => contactCell(row.contact, t) },
  { key: 'productCount', className: 'text-right font-mono', cell: (row) => row.productCount },
  { key: 'note', className: 'min-w-48 whitespace-normal', cell: (row, t) => text(row.note, t) },
  {
    key: 'status',
    cell: (row, t) => (
      <Badge variant={row.status === 'ACTIVE' ? 'secondary' : 'outline'}>
        {t(`partners.status.${row.status}`)}
      </Badge>
    ),
  },
];
