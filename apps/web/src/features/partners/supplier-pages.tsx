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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
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
import { ContactsCard } from './contacts-card';
import {
  emptySupplier,
  PARTNER_STATUSES,
  type SupplierFormValues,
  supplierCreateBody,
  supplierUpdateBody,
  supplierValues,
} from './partner-schema';
import {
  LOCKED_SUPPLIER_COLUMNS,
  SUPPLIER_COLUMN_KEYS,
  SUPPLIER_COLUMNS,
} from './supplier-columns';
import { SupplierFacts, SupplierForm } from './supplier-form';

const COLUMNS_STORAGE_KEY = 'tugeel.partners.suppliers.hiddenColumns.v1';

const isStatus = (value: string | null): value is PartnerStatus =>
  PARTNER_STATUSES.some((status) => status === value);

/** Suppliers: every user reads them (goods receipts); admins add and change them (SPEC §5.3). */
export function SuppliersPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('partners.suppliers.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDeferredValue(search.trim());
  const statusParam = params.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const suppliers = useSuppliers({ q, status });
  const rows = suppliers.data?.pages.flatMap((page) => page.data) ?? [];
  const columnState = useHiddenColumns(
    COLUMNS_STORAGE_KEY,
    SUPPLIER_COLUMN_KEYS,
    LOCKED_SUPPLIER_COLUMNS,
  );
  const { hidden } = columnState;
  const columns = useMemo(
    () => SUPPLIER_COLUMNS.filter((column) => !hidden.has(column.key)),
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
      </FilterBar>
      <ProblemAlert problem={problemFromError(suppliers.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>
                  {t(`partners.suppliers.columns.${column.key}`)}
                </TableHead>
              ))}
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.isPending ? <SkeletonRows columns={columns.length + 1} /> : null}
            {rows.map((supplier) => (
              <LinkRow key={supplier.id} to={`/partners/suppliers/${supplier.id}`}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.cell(supplier, t)}
                  </TableCell>
                ))}
              </LinkRow>
            ))}
          </TableBody>
        </Table>
        {!suppliers.isPending && rows.length === 0 ? (
          <EmptyState icon={Factory} title={t('partners.suppliers.empty')} />
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
    <div>
      <PageHeader title={t('partners.supplier.newTitle')} />
      <ProblemAlert problem={problemFromError(nextCode.error)} />
      {nextCode.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <Card>
          <CardContent>
            <SupplierForm
              mode="create"
              defaultValues={emptySupplier(nextCode.data ?? '')}
              submitLabel={t('common.save')}
              onSubmit={create}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** One supplier: data, contacts and the products ordered from it. */
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
    <div className="flex flex-col gap-4">
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
    </div>
  );
}

/** The products linked to a supplier; the links are made on the product page. */
function SupplierProductsCard({ supplierId }: { supplierId: number }) {
  const { t } = useTranslation();
  const products = useSupplierProducts(supplierId);
  const rows = products.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('partners.supplier.products')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ProblemAlert problem={problemFromError(products.error)} />
        {!products.isPending && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partners.supplier.productsEmpty')}</p>
        ) : null}
        <ul className="flex flex-col divide-y">
          {rows.map(({ linkId, isMain, product }) => (
            <li key={linkId} className="flex flex-wrap items-center gap-3 py-2">
              {product.thumbUrl ? (
                <img
                  src={product.thumbUrl}
                  alt=""
                  loading="lazy"
                  className="size-10 rounded-md object-cover"
                />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-md bg-muted">
                  <ImageOff className="size-4 text-muted-foreground" />
                </div>
              )}
              <span className="font-mono text-sm text-muted-foreground">{product.sku}</span>
              <Link
                to={`/catalog/products/${product.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {product.name}
              </Link>
              {isMain ? <Badge variant="secondary">{t('partners.supplier.main')}</Badge> : null}
              {product.status === 'ACTIVE' ? null : (
                <Badge variant="outline">{t(`partners.status.${product.status}`)}</Badge>
              )}
            </li>
          ))}
        </ul>
        {products.hasNextPage ? (
          <Button
            variant="outline"
            className="self-start"
            disabled={products.isFetchingNextPage}
            onClick={() => void products.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
