import { CUSTOMER_KINDS } from '@tugeel/shared/taxpayer';
import { Plus, Store } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ColumnChooser } from '@/components/column-chooser';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  LoadMore,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { type CustomerKind, type PartnerStatus, useCustomers } from './api';
import {
  CUSTOMER_COLUMN_KEYS,
  CUSTOMER_COLUMNS,
  LOCKED_CUSTOMER_COLUMNS,
} from './customer-columns';
import { PARTNER_STATUSES } from './partner-schema';

const FLAGS = ['tinPending', 'gpsMissing', 'creditHold'] as const;
/** The list's name in the column-choice key (ADR-0050). */
const COLUMNS_LIST = 'partners.customers';
type Flag = (typeof FLAGS)[number];

const isKind = (value: string | null): value is CustomerKind =>
  CUSTOMER_KINDS.some((kind) => kind === value);
const isStatus = (value: string | null): value is PartnerStatus =>
  PARTNER_STATUSES.some((status) => status === value);

/**
 * Customers: search by name in either script, code, phone, TIN or registration number; filter by
 * kind and status, and find the rows that still miss a TIN or a GPS point, or are on credit hold
 * (SPEC §5.3). Filters live in the URL so "back" keeps them.
 */
export function CustomersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('partners.customers.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const kindParam = params.get('kind');
  const statusParam = params.get('status');
  const kind = isKind(kindParam) ? kindParam : undefined;
  const status = isStatus(statusParam) ? statusParam : undefined;
  const flag = (name: Flag) => (params.get(name) === '1' ? true : undefined);
  const customers = useCustomers({
    q,
    kind,
    status,
    tinPending: flag('tinPending'),
    gpsMissing: flag('gpsMissing'),
    creditHold: flag('creditHold'),
  });
  const rows = customers.data?.pages.flatMap((page) => page.data) ?? [];
  const columnState = useHiddenColumns(COLUMNS_LIST, CUSTOMER_COLUMN_KEYS, LOCKED_CUSTOMER_COLUMNS);
  const { hidden } = columnState;
  const columns = useMemo(
    () => CUSTOMER_COLUMNS.filter((column) => !hidden.has(column.key)),
    [hidden],
  );

  const setParam = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader
        title={t('partners.customers.title')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/partners/customers/new">
                <Plus />
                {t('partners.customers.create')}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar
        end={
          <ColumnChooser
            keys={CUSTOMER_COLUMN_KEYS}
            locked={LOCKED_CUSTOMER_COLUMNS}
            label={(key) => t(`partners.customers.columns.${key}`)}
            hidden={hidden}
            toggle={columnState.toggle}
            showAll={columnState.showAll}
          />
        }
      >
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('partners.customers.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('partners.customer.kind')}
          value={kind ?? ''}
          onChange={(event) => setParam('kind', event.target.value)}
        >
          <option value="">{t('partners.customers.allKinds')}</option>
          {CUSTOMER_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`partners.kinds.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('partners.customer.status')}
          value={status ?? ''}
          onChange={(event) => setParam('status', event.target.value)}
        >
          <option value="">{t('partners.customers.allStatuses')}</option>
          {PARTNER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`partners.status.${value}`)}
            </option>
          ))}
        </NativeSelect>
        {FLAGS.map((name) => (
          <FilterToggle
            key={name}
            label={t(`partners.customers.filters.${name}`)}
            checked={flag(name) === true}
            onCheckedChange={(checked) => setParam(name, checked ? '1' : '')}
          />
        ))}
      </FilterBar>
      <ProblemAlert problem={problemFromError(customers.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>
                  {t(`partners.customers.columns.${column.key}`)}
                </TableHead>
              ))}
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.isPending ? <SkeletonRows columns={columns.length + 1} /> : null}
            {rows.map((customer) => (
              <LinkRow key={customer.id} to={`/partners/customers/${customer.id}`}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.cell(customer, t)}
                  </TableCell>
                ))}
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!customers.isPending && rows.length === 0 ? (
          <EmptyState icon={Store} title={t('partners.customers.empty')} />
        ) : null}
        <LoadMore query={customers} />
      </ListCard>
    </div>
  );
}
