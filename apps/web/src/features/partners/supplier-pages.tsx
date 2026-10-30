import { Factory, ImageOff, Plus } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ColumnChooser } from '@/components/column-chooser';
import { DetailCard } from '@/components/detail';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableBody, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import { randomUuid } from '@/lib/uuid';
import {
  type PartnerStatus,
  useNextSupplierCode,
  usePartnersMutations,
  useSupplier,
  useSupplierProducts,
  useSuppliers,
} from './api';
import { SupplierOrdererCard } from '@/features/procurement/supplier-orderer-card';
import { segmentParam } from '@/features/segments/segment-definition';
import { SegmentFilter } from '@/features/segments/segment-filter';
import { ContactsCard } from './contacts-card';
import { ListColumnCell, ListColumnHead } from './list-column-cell';
import { columnSpecs } from './list-columns';
import {
  emptySupplier,
  PARTNER_STATUSES,
  type SupplierFormValues,
  supplierCreateBody,
  supplierUpdateBody,
  supplierValues,
} from './partner-schema';
import {
  DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
  LOCKED_SUPPLIER_COLUMNS,
  SUPPLIER_COLUMN_KEYS,
  SUPPLIER_COLUMNS,
  WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
} from './supplier-columns';
import { SupplierFacts, SupplierForm } from './supplier-form';

/** The list's name in the column-choice key (ADR-0050). */
const COLUMNS_LIST = 'partners.suppliers';
const CHEVRON_COLUMN: ColumnSpec = { key: 'chevron', kind: 'chevron' };

const isStatus = (value: string | null): value is PartnerStatus =>
  PARTNER_STATUSES.some((status) => status === value);

/**
 * Suppliers: every user reads them (goods receipts); admins add and change them (SPEC §5.3). A user
 * who never chose sees the columns that fit a 1366px screen (ADR-0066).
 */
export function SuppliersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('partners.suppliers.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const segmentId = segmentParam(params);
  const suppliers = useSuppliers({ q, status, segmentId });
  const rows = suppliers.data?.pages.flatMap((page) => page.data) ?? [];
  const columnState = useHiddenColumns(
    COLUMNS_LIST,
    SUPPLIER_COLUMN_KEYS,
    LOCKED_SUPPLIER_COLUMNS,
    DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
    WIDE_DEFAULT_HIDDEN_SUPPLIER_COLUMNS,
  );
  const { hidden } = columnState;
  const columns = useMemo(
    () => SUPPLIER_COLUMNS.filter((column) => !hidden.has(column.key)),
    [hidden],
  );
  // The layout of the shown columns and the chevron (ADR-0119).
  const specs = useMemo(() => [...columnSpecs(columns), CHEVRON_COLUMN], [columns]);
  const filtered = Boolean(q || status || segmentId);
  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div>
      <PageHeader
        title={t('partners.suppliers.title')}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/partners/suppliers/new">
                <Plus />
                {t('partners.suppliers.create')}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar
        end={
          <ColumnChooser
            keys={SUPPLIER_COLUMN_KEYS}
            locked={LOCKED_SUPPLIER_COLUMNS}
            label={(key) => t(`partners.suppliers.columns.${key}`)}
            hidden={hidden}
            toggle={columnState.toggle}
            showAll={columnState.showAll}
          />
        }
      >
        <SearchField
          className="sm:w-60"
          aria-label={t('common.search')}
          placeholder={t('partners.suppliers.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setParam('q', event.target.value.trim());
          }}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('partners.supplier.status')}
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
        <SegmentFilter
          entity="SUPPLIER"
          value={segmentId}
          onChange={(id) => setParam('segment', id ? String(id) : '')}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(suppliers.error)} onRetry={suppliers.refetch} />
      <ListCard scroll>
        <ListTable columns={specs}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <ListColumnHead key={column.key} numeric={column.numeric}>
                  {t(`partners.suppliers.columns.${column.key}`)}
                </ListColumnHead>
              ))}
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.isPending ? <SkeletonRows columns={columns.length + 1} /> : null}
            {rows.map((supplier) => (
              <LinkRow key={supplier.id} to={`/partners/suppliers/${supplier.id}`}>
                {columns.map((column) => (
                  <ListColumnCell key={column.key} column={column} row={supplier} t={t} />
                ))}
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!suppliers.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Factory}
            title={t('partners.suppliers.empty')}
            {...(filtered ? { onClearFilters: clearFilters } : {})}
          />
        ) : null}
        <LoadMore query={suppliers} />
      </ListCard>
    </div>
  );
}

/** A new supplier; the code starts with the next free number. One Idempotency-Key per page. */
export function SupplierCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nextCode = useNextSupplierCode();
  const mutations = usePartnersMutations();
  const [key] = useState(randomUuid);

  const create = async (values: SupplierFormValues) => {
    try {
      const supplier = await mutations.createSupplier.mutateAsync({
        key,
        ...supplierCreateBody(values, nextCode.data ?? ''),
      });
      await navigate(`/partners/suppliers/${supplier.id}`);
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title={t('partners.supplier.newTitle')} />
      <ProblemAlert problem={problemFromError(nextCode.error)} onRetry={nextCode.refetch} />
      {nextCode.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <SupplierForm
          page
          mode="create"
          defaultValues={emptySupplier(nextCode.data ?? '')}
          submitLabel={t('common.save')}
          onCancel={() => void navigate('/partners/suppliers')}
          onSubmit={create}
        />
      )}
    </div>
  );
}

/**
 * One supplier: its data, then from `xl` on a side column with the contacts and the products
 * ordered from it (ADR-0066).
 */
export function SupplierPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const canManage = useHasPermission('partners.suppliers.manage');
  const supplier = useSupplier(id);
  const mutations = usePartnersMutations();

  const loadProblem = problemFromError(supplier.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!supplier.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  const detail = supplier.data;

  const save = async (values: SupplierFormValues, close: () => void) => {
    try {
      await mutations.updateSupplier.mutateAsync({ id, body: supplierUpdateBody(values) });
      toast.success(t('partners.supplier.saved'));
      close();
      return null;
    } catch (error) {
      return problemFromError(error);
    }
  };

  return (
    <div>
      <PageHeader
        title={detail.name}
        meta={
          <>
            <span className="font-mono">{detail.code}</span>
            <Badge variant={detail.status === 'ACTIVE' ? 'success' : 'secondary'}>
              {t(`partners.status.${detail.status}`)}
            </Badge>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <DetailCard
            title={t('partners.supplier.info')}
            canEdit={canManage}
            view={<SupplierFacts detail={detail} />}
            edit={(close) => (
              <SupplierForm
                mode="edit"
                defaultValues={supplierValues(detail)}
                submitLabel={t('common.save')}
                onCancel={close}
                onSubmit={(values) => save(values, close)}
              />
            )}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ContactsCard
            contacts={detail.contacts}
            canManage={canManage}
            onAdd={(body) => mutations.addSupplierContact.mutateAsync({ ownerId: id, body })}
            onUpdate={(contactId, body) =>
              mutations.updateSupplierContact.mutateAsync({ id: contactId, body })
            }
            onDelete={(contactId) => mutations.deleteSupplierContact.mutateAsync(contactId)}
          />
          <SupplierProductsCard supplierId={id} />
          <SupplierOrdererCard supplierId={id} />
        </div>
      </div>
    </div>
  );
}

/** How many of a supplier's products its card lists; the product list shows them all. */
const SHOWN_PRODUCTS = 10;

/**
 * The products linked to a supplier, the first ten, and a link to the product list filtered by it
 * (`?supplier=`); the links are made on the product page.
 */
function SupplierProductsCard({ supplierId }: { supplierId: number }) {
  const { t } = useTranslation();
  const products = useSupplierProducts(supplierId);
  const loaded = products.data?.pages.flatMap((page) => page.data) ?? [];
  const rows = loaded.slice(0, SHOWN_PRODUCTS);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.supplier.products')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ProblemAlert problem={problemFromError(products.error)} onRetry={products.refetch} />
        {!products.isPending && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partners.supplier.productsEmpty')}</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border/80">
          {rows.map(({ linkId, isMain, product }) => (
            <li key={linkId} className="flex items-center gap-3 py-2">
              {product.thumbUrl ? (
                <img
                  src={product.thumbUrl}
                  alt=""
                  loading="lazy"
                  className="size-8 shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  <ImageOff className="size-3.5 text-muted-foreground" />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <Link
                  to={`/catalog/products/${product.id}`}
                  className="truncate font-medium underline-offset-4 hover:underline"
                  title={product.name}
                >
                  {product.name}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">{product.sku}</span>
              </div>
              {isMain ? <Badge variant="secondary">{t('partners.supplier.main')}</Badge> : null}
              {product.status === 'ACTIVE' ? null : (
                <Badge variant="outline">{t(`partners.status.${product.status}`)}</Badge>
              )}
            </li>
          ))}
        </ul>
        {/* The rest are in the product list, with its columns and filters. */}
        {loaded.length > 0 ? (
          <Button variant="link" size="sm" className="self-start px-0" asChild>
            <Link to={`/catalog/products?supplier=${supplierId}`}>
              {t('partners.supplier.productsAll')}
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
