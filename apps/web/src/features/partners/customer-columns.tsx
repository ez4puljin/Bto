import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { formatTugrik } from '@/lib/money';
import type { CustomerListItem } from './api';
import { MapLink } from './gps-field';
import { contactCell, none, text } from './list-cells';
import { localPhone } from './phone';

/** «Хугацаа хэтэрсэн · MM/DD-оос»: the oldest due date of the overdue debt. */
function overdueTitle(overdue: NonNullable<CustomerListItem['overdue']>, t: TFunction): string {
  return overdue.oldestDueDate
    ? t('partners.settlement.overdueSince', { date: overdue.oldestDueDate })
    : t('partners.settlement.overdue');
}

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
  'settlementGroup',
  'overdue',
  'creditHold',
  'note',
  'app',
  'status',
] as const;
export type CustomerColumnKey = (typeof CUSTOMER_COLUMN_KEYS)[number];

/** Columns that name the row; they cannot be hidden. */
export const LOCKED_CUSTOMER_COLUMNS: readonly CustomerColumnKey[] = ['code', 'name'];

/**
 * What a user who never chose sees hidden (ADR-0066): code, name, kind, phone, TIN, the overdue debt
 * (ADR-0101), credit status and status fit a 1366px screen; every column stays in «Баганууд».
 */
export const DEFAULT_HIDDEN_CUSTOMER_COLUMNS: readonly CustomerColumnKey[] = [
  'regNo',
  'consumerNo',
  'vatPayer',
  'cityPayer',
  'address',
  'gps',
  'contact',
  'creditLimit',
  'settlementGroup',
  'note',
  'app',
];

export interface CustomerColumn {
  key: CustomerColumnKey;
  /** Money and counts: right-aligned in the head and the cells. */
  numeric?: boolean;
  /** Long text on one line with «…» and the whole text on hover; `fill` takes the spare width. */
  truncate?: { text: (row: CustomerListItem, t: TFunction) => string; fill?: boolean };
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
    // The name takes the spare width, never less than 14rem: with many columns the list scrolls.
    truncate: { text: (row) => row.name, fill: true },
    className: 'min-w-56',
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
        <Badge variant="warning">{t('partners.customer.tinPending')}</Badge>
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
    truncate: { text: (row, t) => row.address ?? t('common.none') },
    cell: (row, t) => text(row.address, t),
  },
  {
    key: 'gps',
    cell: (row, t) =>
      row.gps ? (
        <MapLink lat={row.gps.lat} lng={row.gps.lng} />
      ) : (
        <Badge variant="warning">{t('partners.addresses.noGps')}</Badge>
      ),
  },
  { key: 'contact', cell: (row, t) => contactCell(row.contact, t) },
  {
    key: 'creditLimit',
    numeric: true,
    cell: (row, t) =>
      row.creditLimit === null ? (
        <span className="font-sans text-muted-foreground">
          {t('partners.credit.limitUndecided')}
        </span>
      ) : (
        formatTugrik(row.creditLimit)
      ),
  },
  {
    key: 'settlementGroup',
    cell: (row, t) => t(`partners.settlement.groups.${row.settlementGroup}`),
  },
  {
    // ADR-0101: an overdue debt only reminds, in red; it never blocks an order.
    key: 'overdue',
    numeric: true,
    cell: (row, t) =>
      row.overdue === null ? (
        <span className="font-sans">{none(t)}</span>
      ) : (
        <span className="font-medium text-destructive" title={overdueTitle(row.overdue, t)}>
          {formatTugrik(row.overdue.amount)}
        </span>
      ),
  },
  {
    key: 'creditHold',
    cell: (row, t) =>
      row.creditHold ? (
        <div className="flex items-center gap-2">
          <Badge variant="destructive">{t('partners.credit.held')}</Badge>
          {row.creditHoldReason ? (
            <span className="max-w-48 truncate text-muted-foreground" title={row.creditHoldReason}>
              {row.creditHoldReason}
            </span>
          ) : null}
        </div>
      ) : (
        t('partners.credit.open')
      ),
  },
  {
    key: 'note',
    truncate: { text: (row, t) => row.note ?? t('common.none') },
    cell: (row, t) => text(row.note, t),
  },
  {
    // The customer app «Bto300» (ADR-0079 #11): open, closed, or no account.
    key: 'app',
    cell: (row, t) =>
      row.appAccount === null ? (
        none(t)
      ) : (
        <Badge variant={row.appAccount === 'ACTIVE' ? 'success' : 'secondary'}>
          {t(`partners.app.statuses.${row.appAccount}`)}
        </Badge>
      ),
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
