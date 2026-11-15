import type { TFunction } from 'i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { formatTugrik } from '@/lib/money';
import type { CustomerListItem } from './api';
import { MapLink } from './gps-field';
import { contactCell, none, text } from './list-cells';
import type { ListColumn } from './list-column-cell';
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
  'category',
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
 * What a user who never chose sees hidden (ADR-0066): the code, the name, the category, the kind,
 * the TIN, the phone, the overdue debt (ADR-0101), the credit status and the status show; every
 * column stays in «Баганууд».
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

/**
 * What that user sees hidden on a screen of 1600px or more (ADR-0119): the credit limit and the
 * settlement group fit there too; the address and the contact would squeeze the names again.
 */
export const WIDE_DEFAULT_HIDDEN_CUSTOMER_COLUMNS: readonly CustomerColumnKey[] = [
  'regNo',
  'consumerNo',
  'vatPayer',
  'cityPayer',
  'address',
  'gps',
  'contact',
  'note',
  'app',
];

/**
 * The columns that leave a default set too wide for its table (ADR-0201), the least needed first
 * and one at a time; the customer's own page shows each. The default set needs 79.25rem: a 1366px
 * window has 76.35 and lets the TIN go (69.25: its 10rem go to the names, and «ТТД хүлээгдэж буй»
 * has its filter); a till PC has 56.2 and keeps the code, the name, the overdue debt, the credit
 * status and the status (48.75); a tablet upright has 41.2 and lets the credit status go too
 * (40.25: the debt in red and the «Зээл хаасан» filter still say it). The wide set's two columns
 * (94.75) go first, so a 1600px window (84.9) shows the default set whole and a 1920px one (97)
 * the wide set. `partners-logic.test.ts` checks the sums against the screens.
 */
export const CUSTOMER_COLUMNS_LEAVING: readonly CustomerColumnKey[] = [
  'settlementGroup',
  'creditLimit',
  'tin',
  'kind',
  'category',
  'phone',
  'creditHold',
];

/** A column of the customer list, sized by the layout (ADR-0119). */
export interface CustomerColumn extends ListColumn<CustomerListItem> {
  key: CustomerColumnKey;
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
  { key: 'code', kind: 'code', className: 'font-mono', cell: (row) => row.code },
  {
    key: 'name',
    // The name takes the largest share of the spare width, never less than 14rem.
    kind: 'text',
    weight: 3,
    min: 14,
    truncate: { text: (row) => row.name },
    cell: (row) => (
      <Link
        to={`/partners/customers/${row.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.name}
      </Link>
    ),
  },
  {
    // The office's category (ADR-0107), the Erkhet group at the migration.
    key: 'category',
    kind: 'text',
    weight: 2,
    truncate: { text: (row, t) => row.categoryName ?? t('common.none') },
    cell: (row, t) => text(row.categoryName, t),
  },
  {
    key: 'kind',
    kind: 'text',
    weight: 0.5,
    min: 5.5,
    cell: (row, t) => t(`partners.kinds.${row.kind}`),
  },
  { key: 'regNo', kind: 'number', className: 'font-mono', cell: (row, t) => text(row.regNo, t) },
  {
    key: 'tin',
    kind: 'number',
    // Holds the «ТТД хүлээгдэж буй» pill of a customer whose number is still awaited.
    width: 10,
    cell: (row, t) =>
      row.tin ? (
        <span className="font-mono">{row.tin}</span>
      ) : row.tinPending ? (
        <Badge variant="warning">{t('partners.customer.tinPending')}</Badge>
      ) : (
        none(t)
      ),
  },
  {
    key: 'consumerNo',
    kind: 'number',
    className: 'font-mono',
    cell: (row, t) => text(row.consumerNo, t),
  },
  {
    key: 'phone',
    kind: 'number',
    width: 8,
    className: 'font-mono',
    cell: (row, t) => (row.phone ? localPhone(row.phone) : none(t)),
  },
  { key: 'vatPayer', kind: 'status', width: 6, cell: (row, t) => payer(row, row.vatPayer, t) },
  { key: 'cityPayer', kind: 'status', width: 6, cell: (row, t) => payer(row, row.cityPayer, t) },
  {
    key: 'address',
    kind: 'text',
    weight: 2,
    truncate: { text: (row, t) => row.address ?? t('common.none') },
    cell: (row, t) => text(row.address, t),
  },
  {
    key: 'gps',
    kind: 'status',
    cell: (row, t) =>
      row.gps ? (
        <MapLink lat={row.gps.lat} lng={row.gps.lng} />
      ) : (
        <Badge variant="warning">{t('partners.addresses.noGps')}</Badge>
      ),
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
    key: 'creditLimit',
    kind: 'money',
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
    kind: 'text',
    cell: (row, t) => t(`partners.settlement.groups.${row.settlementGroup}`),
  },
  {
    // ADR-0101: an overdue debt only reminds, in red; it never blocks an order.
    key: 'overdue',
    kind: 'money',
    width: 9,
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
    kind: 'status',
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
    kind: 'text',
    weight: 2,
    truncate: { text: (row, t) => row.note ?? t('common.none') },
    cell: (row, t) => text(row.note, t),
  },
  {
    // The customer app «Bto300» (ADR-0079 #11): open, closed, or no account.
    key: 'app',
    kind: 'status',
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
    kind: 'status',
    // «Идэвхтэй» and «Идэвхгүй» take 6.2rem with their cell.
    width: 8,
    cell: (row, t) => (
      <Badge variant={row.status === 'ACTIVE' ? 'success' : 'secondary'}>
        {t(`partners.status.${row.status}`)}
      </Badge>
    ),
  },
];
