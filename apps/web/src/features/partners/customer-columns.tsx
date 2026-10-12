import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { formatMnt } from '@/lib/money';
import type { CustomerListItem } from './api';
import { MapLink } from './gps-field';
import { contactCell, none, text } from './list-cells';
import { localPhone } from './phone';

/** Every column of the customer list (ADR-0037). */
export const CUSTOMER_COLUMN_KEYS = [
  'code',
  'name',
  'kind',
  'regNo',
  'tin',
  'consumerNo',
  'phone',
  'vatPayer',
  'cityPayer',
  'address',
  'gps',
  'contact',
  'creditLimit',
  'paymentTerm',
  'creditHold',
  'note',
  'status',
] as const;
export type CustomerColumnKey = (typeof CUSTOMER_COLUMN_KEYS)[number];

/** Columns that name the row; they cannot be hidden. */
export const LOCKED_CUSTOMER_COLUMNS: readonly CustomerColumnKey[] = ['code', 'name'];

export interface CustomerColumn {
  key: CustomerColumnKey;
  className?: string;
  cell: (row: CustomerListItem, t: TFunction) => ReactNode;
}

/** A payer flag, or «Шалгаагүй» while the tax status was never checked. */
const payer = (row: CustomerListItem, value: boolean, t: TFunction) =>
  row.taxStatusSource === null ? (
    <span className="text-muted-foreground">{t('partners.customers.payerUnchecked')}</span>
  ) : value ? (
    t('common.yes')
  ) : (
    t('common.no')
  );

export const CUSTOMER_COLUMNS: readonly CustomerColumn[] = [
  { key: 'code', className: 'font-mono', cell: (row) => row.code },
  {
    key: 'name',
    className: 'min-w-48 whitespace-normal',
    cell: (row) => (
      <Link
        to={`/partners/customers/${row.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.name}
      </Link>
    ),
  },
  { key: 'kind', cell: (row, t) => t(`partners.kinds.${row.kind}`) },
  { key: 'regNo', className: 'font-mono', cell: (row, t) => text(row.regNo, t) },
  {
    key: 'tin',
    cell: (row, t) =>
      row.tin ? (
        <span className="font-mono">{row.tin}</span>
      ) : row.tinPending ? (
        <Badge variant="outline">{t('partners.customer.tinPending')}</Badge>
      ) : (
        none(t)
      ),
  },
  { key: 'consumerNo', className: 'font-mono', cell: (row, t) => text(row.consumerNo, t) },
  {
    key: 'phone',
    className: 'font-mono',
    cell: (row, t) => (row.phone ? localPhone(row.phone) : none(t)),
  },
  { key: 'vatPayer', cell: (row, t) => payer(row, row.vatPayer, t) },
  { key: 'cityPayer', cell: (row, t) => payer(row, row.cityPayer, t) },
  {
    key: 'address',
    className: 'min-w-48 whitespace-normal',
    cell: (row, t) => text(row.address, t),
  },
  {
    key: 'gps',
    cell: (row, t) =>
      row.gps ? (
        <MapLink lat={row.gps.lat} lng={row.gps.lng} />
      ) : (
        <Badge variant="outline">{t('partners.addresses.noGps')}</Badge>
      ),
  },
  { key: 'contact', className: 'whitespace-normal', cell: (row, t) => contactCell(row.contact, t) },
  {
    key: 'creditLimit',
    className: 'text-right font-mono',
    cell: (row, t) =>
      row.creditLimit === null ? (
        <span className="text-muted-foreground">{t('partners.credit.limitUndecided')}</span>
      ) : (
        formatMnt(row.creditLimit)
      ),
  },
  {
    key: 'paymentTerm',
    cell: (row, t) =>
      row.paymentTerm.source === 'CUSTOMER' ? (
        t('partners.credit.termCustomer', { days: row.paymentTerm.days })
      ) : row.paymentTerm.source === 'DEFAULT' ? (
        t('partners.credit.termDefault', { days: row.paymentTerm.days })
      ) : (
        <span className="text-muted-foreground">{t('partners.credit.termUnset')}</span>
      ),
  },
  {
    key: 'creditHold',
    className: 'whitespace-normal',
    cell: (row, t) =>
      row.creditHold ? (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="destructive">{t('partners.credit.held')}</Badge>
          {row.creditHoldReason ? (
            <span className="text-muted-foreground">{row.creditHoldReason}</span>
          ) : null}
        </div>
      ) : (
        t('partners.credit.open')
      ),
  },
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
