import { SETTLEMENT_GROUPS, type SettlementGroup } from '@tugeel/shared/finance';
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
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { segmentParam } from '@/features/segments/segment-definition';
import { SegmentFilter } from '@/features/segments/segment-filter';
import {
  type AppAccountFilter,
  type CustomerKind,
  type PartnerStatus,
  useCustomerCategories,
  useCustomers,
} from './api';
import {
  CUSTOMER_COLUMN_KEYS,
  CUSTOMER_COLUMNS,
  DEFAULT_HIDDEN_CUSTOMER_COLUMNS,
  LOCKED_CUSTOMER_COLUMNS,
} from './customer-columns';
import { ListColumnCell, ListColumnHead } from './list-column-cell';
import { PARTNER_STATUSES } from './partner-schema';

const FLAGS = ['tinPending', 'gpsMissing', 'creditHold'] as const;
/** The customer app filter (ADR-0079 #11): open, closed, or no account linked. */
const APP_FILTERS: readonly AppAccountFilter[] = ['ACTIVE', 'DISABLED', 'NONE'];
/** The list's name in the column-choice key (ADR-0050). */
const COLUMNS_LIST = 'partners.customers';
type Flag = (typeof FLAGS)[number];

const isKind = (value: string | null): value is CustomerKind =>
  CUSTOMER_KINDS.some((kind) => kind === value);
const isStatus = (value: string | null): value is PartnerStatus =>
  PARTNER_STATUSES.some((status) => status === value);
const isAppFilter = (value: string | null): value is AppAccountFilter =>
  APP_FILTERS.some((entry) => entry === value);
const isGroup = (value: string | null): value is SettlementGroup =>
  SETTLEMENT_GROUPS.some((group) => group === value);

/**
 * Customers: search by name in either script, code, phone, TIN or registration number; filter by
 * category (ADR-0107), kind, status, settlement group (ADR-0101) and the customer app account (ADR-0079 #11), and find the rows that still miss a
 * TIN or a GPS point, or are on credit hold (SPEC §5.3). Filters live in the URL so "back" keeps them. A user who never chose sees the
 * columns that fit a 1366px screen (ADR-0066).
 */
export function CustomersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('partners.customers.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const kindParam = params.get('kind');
  const statusParam = params.get('status');
  const kind = isKind(kindParam) ? kindParam : undefined;
  const status = isStatus(statusParam) ? statusParam : undefined;
  const appParam = params.get('app');
  const app = isAppFilter(appParam) ? appParam : undefined;
  const groupParam = params.get('group');
  const settlementGroup = isGroup(groupParam) ? groupParam : undefined;
  const categories = useCustomerCategories();
  const categoryParam = Number.parseInt(params.get('category') ?? '', 10);
  const categoryId = categoryParam > 0 ? categoryParam : undefined;
  const flag = (name: Flag) => (params.get(name) === '1' ? true : undefined);
  const segmentId = segmentParam(params);
  const customers = useCustomers({
    q,
    kind,
    status,
    segmentId,
    app,
    settlementGroup,
    categoryId,
    tinPending: flag('tinPending'),
    gpsMissing: flag('gpsMissing'),
    creditHold: flag('creditHold'),
  });
  const rows = customers.data?.pages.flatMap((page) => page.data) ?? [];
  const columnState = useHiddenColumns(
    COLUMNS_LIST,
    CUSTOMER_COLUMN_KEYS,
    LOCKED_CUSTOMER_COLUMNS,
    DEFAULT_HIDDEN_CUSTOMER_COLUMNS,
  );
  const { hidden } = columnState;
  const columns = useMemo(
    () => CUSTOMER_COLUMNS.filter((column) => !hidden.has(column.key)),
    [hidden],
  );
  const filtered = Boolean(
    q ||
    kind ||
    status ||
    app ||
    settlementGroup ||
    categoryId ||
    segmentId ||
    FLAGS.some((name) => flag(name) === true),
  );
  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

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
          className="sm:w-60"
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
          aria-label={t('partners.customer.category')}
          value={categoryId ?? ''}
          onChange={(event) => setParam('category', event.target.value)}
        >
          <option value="">{t('partners.customers.allCategories')}</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </NativeSelect>
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
        <NativeSelect
          variant="filter"
          aria-label={t('partners.settlement.group')}
          value={settlementGroup ?? ''}
          onChange={(event) => setParam('group', event.target.value)}
        >
          <option value="">{t('partners.settlement.allGroups')}</option>
          {SETTLEMENT_GROUPS.map((value) => (
            <option key={value} value={value}>
              {t(`partners.settlement.groups.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('partners.customers.appFilter.label')}
          value={app ?? ''}
          onChange={(event) => setParam('app', event.target.value)}
        >
          <option value="">{t('partners.customers.appFilter.all')}</option>
          {APP_FILTERS.map((value) => (
            <option key={value} value={value}>
              {t(`partners.customers.appFilter.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <SegmentFilter
          entity="CUSTOMER"
          value={segmentId}
          onChange={(id) => setParam('segment', id ? String(id) : '')}
        />
        {FLAGS.map((name) => (
          <FilterToggle
            key={name}
            label={t(`partners.customers.filters.${name}`)}
            checked={flag(name) === true}
            onCheckedChange={(checked) => setParam(name, checked ? '1' : '')}
          />
        ))}
      </FilterBar>
      <ProblemAlert problem={problemFromError(customers.error)} onRetry={customers.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <ListColumnHead key={column.key} numeric={column.numeric}>
                  {t(`partners.customers.columns.${column.key}`)}
                </ListColumnHead>
              ))}
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.isPending ? <SkeletonRows columns={columns.length + 1} /> : null}
            {rows.map((customer) => (
              <LinkRow key={customer.id} to={`/partners/customers/${customer.id}`}>
                {columns.map((column) => (
                  <ListColumnCell key={column.key} column={column} row={customer} t={t} />
                ))}
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!customers.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Store}
            title={t('partners.customers.empty')}
            {...(filtered ? { onClearFilters: clearFilters } : {})}
          />
        ) : null}
        <LoadMore query={customers} />
      </ListCard>
    </div>
  );
}
