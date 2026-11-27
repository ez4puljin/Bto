import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { RequirePermission } from '@/app/require-auth';
import { FormField } from '@/components/form';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { LeaveGuard } from '@/components/leave-guard';
import { SegmentedControl } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWarehouses } from '@/features/identity/api';
import { ProductSearch } from '@/features/inventory/shared';
import { type PickedSupplier, SupplierPicker } from '@/features/partners/supplier-picker';
import { problemFromError } from '@/lib/problem';
import { ProductBasePrice, ReceiptPriceChanges } from './base-price-view';
import { PriceProfilesPage } from './profile-pages';
import { useLocationPriceRules, useSupplierPriceRules } from './supplier-pricing-api';
import { SupplierPriceRuleForm } from './supplier-price-rule-form';

const TABS = ['suppliers', 'locations', 'products', 'profiles'] as const;
type Tab = (typeof TABS)[number];
const positiveId = (value: string | null) =>
  value && /^\d{1,15}$/.test(value) && Number(value) > 0 ? Number(value) : null;

/** Supplier receipt rules, location choice and a product's manual/automatic base-price history. */
export function SupplierPricingPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const canRules = useHasPermission('pricing.manage');
  const canPrices = useHasPermission('pricing.prices.manage');
  const selected = TABS.find((v) => v === params.get('tab'));
  const tab: Tab =
    selected ??
    (params.has('productId') || params.has('receiptId')
      ? 'products'
      : canRules
        ? 'suppliers'
        : canPrices
          ? 'products'
          : 'profiles');
  const tabs: readonly Tab[] = canRules
    ? TABS
    : canPrices
      ? ['locations', 'products', 'profiles']
      : ['profiles'];
  const receiptId = positiveId(params.get('receiptId'));
  const productId = positiveId(params.get('productId'));
  const [dirty, setDirty] = useState(false);
  const selectTab = (value: Tab) => setParams({ tab: value });
  const content = (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title={t('pricing.settings.title')}
        description={t('pricing.settings.description')}
      />
      <LeaveGuard
        when={dirty}
        title={t('pricing.settings.unsavedTitle')}
        description={t('pricing.settings.unsavedHint')}
        leaveLabel={t('common.discard.confirm')}
        leaves={(current, next) => current.search !== next.search}
      />
      {receiptId !== null ? (
        <>
          <div>
            <Button variant="outline" onClick={() => setParams({ tab: 'products' })}>
              {t('pricing.settings.backToSettings')}
            </Button>
          </div>
          <ReceiptPriceChanges receiptId={receiptId} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              options={tabs}
              value={tab}
              onChange={selectTab}
              label={(v) => t(`pricing.settings.tabs.${v}`)}
            />
          </div>
          {tab === 'profiles' ? (
            <PriceProfilesPage embedded />
          ) : tab === 'suppliers' ? (
            <SupplierRules onDirty={setDirty} />
          ) : tab === 'locations' ? (
            <LocationRules onDirty={setDirty} />
          ) : (
            <>
              <Card>
                <CardContent className="flex flex-wrap items-end gap-3 pt-4">
                  <div className="min-w-64 flex-1">
                    <FormField label={t('inventory.product')} htmlFor="base-product-search">
                      <ProductSearch
                        id="base-product-search"
                        className="max-w-none"
                        onPick={(product) =>
                          setParams({ tab: 'products', productId: String(product.id) })
                        }
                        pickLabel={t('pricing.settings.chooseProduct')}
                        anyStatus
                      />
                    </FormField>
                  </div>
                  {productId !== null ? (
                    <Button variant="ghost" onClick={() => setParams({ tab: 'products' })}>
                      {t('common.clear')}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
              {productId !== null ? (
                <ProductBasePrice productId={productId} onDirty={setDirty} />
              ) : (
                <Empty>{t('pricing.settings.pickProductHint')}</Empty>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
  // Profile reading was already public to signed-in staff. The other tabs retain their rights.
  if (receiptId !== null || tab !== 'profiles') {
    const permission =
      receiptId === null && tab === 'suppliers'
        ? 'pricing.manage'
        : (['pricing.manage', 'pricing.prices.manage'] as const);
    return <RequirePermission permission={permission}>{content}</RequirePermission>;
  }
  return content;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function SupplierRules({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const canSave = useHasPermission('pricing.manage');
  const query = useSupplierPriceRules();
  const [chosen, setChosen] = useState<PickedSupplier | null>(null);
  const [dirty, setDirty] = useState(false);
  const [next, setNext] = useState<PickedSupplier | null | undefined>(undefined);
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  const choose = (value: PickedSupplier | null) => {
    if (dirty) setNext(value);
    else setChosen(value);
  };
  const saved = query.data?.find((rule) => rule.supplierId === chosen?.id) ?? null;
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t('pricing.settings.tabs.suppliers')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FormField label={t('inventory.receipts.supplier')} htmlFor="pricing-supplier">
            {chosen ? (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{chosen.name}</span>
                <Button size="sm" variant="outline" onClick={() => choose(null)}>
                  {t('pricing.settings.changeSupplier')}
                </Button>
              </div>
            ) : (
              <SupplierPicker id="pricing-supplier" value={null} onChange={choose} />
            )}
          </FormField>
          <ProblemAlert problem={problemFromError(query.error)} onRetry={query.refetch} />
          {query.isPending ? <p>{t('common.loading')}</p> : null}
          {(query.data ?? []).map((rule) => (
            <button
              key={rule.supplierId}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                if (chosen?.id !== rule.supplierId)
                  choose({ id: rule.supplierId, name: rule.supplierName, code: '' });
              }}
            >
              <span className="min-w-0 truncate">{rule.supplierName}</span>
              <span className="shrink-0">
                <Badge variant={rule.enabled ? 'success' : 'secondary'}>
                  {t(rule.enabled ? 'pricing.settings.active' : 'pricing.settings.disabled')}
                </Badge>
              </span>
            </button>
          ))}
          {query.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pricing.settings.noSupplierRules')}</p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          {chosen && query.isSuccess ? (
            <SupplierPriceRuleForm
              key={chosen.id}
              kind="supplier"
              targetId={chosen.id}
              name={chosen.name}
              saved={saved}
              canSave={canSave}
              onDirty={reportDirty}
              reload={query.refetch}
            />
          ) : (
            <Empty>{t('pricing.settings.pickSupplierHint')}</Empty>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={next !== undefined}
        title={t('pricing.settings.unsavedTitle')}
        description={t('pricing.settings.unsavedHint')}
        confirmLabel={t('common.discard.confirm')}
        onClose={() => setNext(undefined)}
        onConfirm={() => {
          setChosen(next ?? null);
          setNext(undefined);
          reportDirty(false);
        }}
      />
    </div>
  );
}

function LocationRules({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const canRules = useHasPermission('pricing.manage');
  const auth = useAuthState();
  const warehouses = useWarehouses();
  const query = useLocationPriceRules();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  const choose = (value: number | null) => {
    if (value === warehouseId) return;
    if (dirty) setNext(value);
    else setWarehouseId(value);
  };
  const rows = (warehouses.data ?? []).filter(
    (warehouse) => warehouse.status === 'ACTIVE' && warehouse.kind !== 'TRANSIT',
  );
  const warehouse = rows.find((row) => row.id === warehouseId);
  const saved = query.data?.find((rule) => rule.warehouseId === warehouseId) ?? null;
  const scope = auth.status === 'authenticated' ? auth.me.writableWarehouseIds : [];
  const canSave =
    canRules && (scope === null || (warehouseId !== null && scope.includes(warehouseId)));
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t('pricing.settings.tabs.locations')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <FormField label={t('inventory.warehouse')} htmlFor="pricing-location">
            <SearchSelect
              id="pricing-location"
              value={warehouseId === null ? '' : String(warehouseId)}
              options={rows.map((row) => ({ value: String(row.id), label: row.name }))}
              onChange={(value) => choose(positiveId(value))}
              placeholder={t('pricing.settings.pickLocationHint')}
            />
          </FormField>
          <ProblemAlert
            problem={problemFromError(query.error) ?? problemFromError(warehouses.error)}
            onRetry={() => {
              void query.refetch();
              void warehouses.refetch();
            }}
          />
          {(query.data ?? []).map((rule) => (
            <button
              type="button"
              key={rule.warehouseId}
              className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => choose(rule.warehouseId)}
            >
              <span className="min-w-0 truncate">{rule.warehouseName}</span>
              <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                {t(
                  rule.enabled
                    ? `pricing.settings.types.${rule.priceType}`
                    : 'pricing.settings.disabled',
                )}
              </Badge>
            </button>
          ))}
          {query.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pricing.settings.noLocationRules')}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('pricing.settings.unconfiguredHint')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          {warehouse && query.isSuccess ? (
            <SupplierPriceRuleForm
              key={warehouse.id}
              kind="location"
              targetId={warehouse.id}
              name={warehouse.name}
              saved={saved}
              canSave={canSave}
              onDirty={reportDirty}
              reload={query.refetch}
            />
          ) : (
            <Empty>{t('pricing.settings.pickLocationHint')}</Empty>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={next !== undefined}
        title={t('pricing.settings.unsavedTitle')}
        description={t('pricing.settings.unsavedHint')}
        confirmLabel={t('common.discard.confirm')}
        onClose={() => setNext(undefined)}
        onConfirm={() => {
          setWarehouseId(next ?? null);
          setNext(undefined);
          reportDirty(false);
        }}
      />
    </div>
  );
}
