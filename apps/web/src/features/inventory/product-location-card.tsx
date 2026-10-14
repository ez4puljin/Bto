import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { DialogFormFooter, FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import {
  type ProductLocation,
  useBinLookup,
  useInventoryMutations,
  useProductLocations,
  useProductStock,
} from './api';
import { isQty, useWarehouseName, useWarehouseOptions } from './helpers';
import { WarehouseSelect } from './shared';

const WHOLESALE = ['WHOLESALE'] as const;
const SHELF_KINDS = ['WHOLESALE', 'STORE'] as const;

/**
 * Where a product lives (owner, 2026-10-11): its home wholesale warehouse (the only one it is
 * received into), its fixed shelf and low/high levels per warehouse, and its stock there.
 */
export function ProductLocationCard({ productId }: { productId: number }) {
  const { t } = useTranslation();
  const canSetHome = useHasPermission('inventory.setup.manage');
  const canLocate = useHasPermission('inventory.locations.manage');
  const locations = useProductLocations(productId);
  const stock = useProductStock(productId);
  const wholesale = useWarehouseOptions(WHOLESALE);
  const warehouseName = useWarehouseName();
  const mutations = useInventoryMutations();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const rows = locations.data ?? [];
  const home = rows.find((row) => row.isHome);
  const placed = rows.filter((row) => row.defaultBinId !== null || row.minQty || row.maxQty);
  const unit = stock.data?.product.baseUnitName ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('inventory.location.title')}</CardTitle>
        <CardAction className="flex gap-2">
          {canLocate ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('inventory.location.edit')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/inventory/stock/${productId}`}>{t('inventory.location.stockLink')}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ProblemAlert
          problem={action.problem ?? problemFromError(locations.error ?? stock.error)}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="product-home">{t('inventory.location.home')}</Label>
          {canSetHome ? (
            <NativeSelect
              id="product-home"
              className="max-w-xs"
              value={home?.warehouseId ?? ''}
              onChange={(event) =>
                void action.run(() =>
                  mutations.setHome.mutateAsync({
                    productId,
                    warehouseId: event.target.value
                      ? Number.parseInt(event.target.value, 10)
                      : null,
                  }),
                )
              }
            >
              <option value="">{t('inventory.location.noHome')}</option>
              {wholesale.options.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <span id="product-home">
              {home ? warehouseName(home.warehouseId) : t('inventory.location.noHome')}
            </span>
          )}
          <p className="text-xs text-muted-foreground">{t('inventory.location.homeHint')}</p>
        </div>
        {placed.length === 0 ? (
          <p className="text-muted-foreground">{t('inventory.location.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {placed.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-4 gap-y-1 py-1.5">
                <span className="font-medium">{warehouseName(row.warehouseId)}</span>
                <span>
                  {t('inventory.location.fixedBin')}{' '}
                  <span className="font-mono">{row.defaultBinCode ?? t('common.none')}</span>
                </span>
                {row.minQty ? <span>{`${t('inventory.location.min')} ${row.minQty}`}</span> : null}
                {row.maxQty ? <span>{`${t('inventory.location.max')} ${row.maxQty}`}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <ul className="flex flex-col divide-y">
          {(stock.data?.warehouses ?? []).map((balance) => (
            <li key={balance.warehouseId} className="flex justify-between py-1.5">
              <span>{warehouseName(balance.warehouseId)}</span>
              <span className="font-mono">
                {t('inventory.qtyWithUnit', { qty: balance.onHand, unit })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      {editing ? (
        <LocationDialog productId={productId} locations={rows} onClose={() => setEditing(false)} />
      ) : null}
    </Card>
  );
}

function LocationDialog(props: {
  productId: number;
  locations: readonly ProductLocation[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const warehouses = useWarehouseOptions(SHELF_KINDS, true);
  const mutations = useInventoryMutations();
  const lookupBin = useBinLookup();
  const action = useAction();
  const [warehouseId, setWarehouseId] = useState<number | undefined>(
    props.locations.find((row) => row.isHome)?.warehouseId,
  );
  const current = props.locations.find((row) => row.warehouseId === warehouseId);
  const [binCode, setBinCode] = useState(current?.defaultBinCode ?? '');
  const [minQty, setMinQty] = useState(current?.minQty ?? '');
  const [maxQty, setMaxQty] = useState(current?.maxQty ?? '');
  const levelsValid = [minQty, maxQty].every((value) => !value.trim() || isQty(value.trim()));

  const pick = (id: number | undefined) => {
    const row = props.locations.find((location) => location.warehouseId === id);
    setWarehouseId(id);
    setBinCode(row?.defaultBinCode ?? '');
    setMinQty(row?.minQty ?? '');
    setMaxQty(row?.maxQty ?? '');
  };

  const save = () =>
    void action.run(async () => {
      if (warehouseId === undefined) return;
      const code = binCode.trim();
      const bin = code ? await lookupBin.mutateAsync({ warehouseId, code }) : null;
      await mutations.setLocation.mutateAsync({
        warehouseId,
        productId: props.productId,
        defaultBinId: bin?.id ?? null,
        minQty: minQty.trim() || null,
        maxQty: maxQty.trim() || null,
      });
      props.onClose();
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-md">
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (warehouseId !== undefined && levelsValid && !mutations.setLocation.isPending) {
              save();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('inventory.location.edit')}</DialogTitle>
          </DialogHeader>
          <ProblemAlert problem={action.problem} />
          <FormField label={t('inventory.warehouse')} htmlFor="location-warehouse">
            <WarehouseSelect
              id="location-warehouse"
              options={warehouses.options}
              value={warehouseId}
              emptyLabel={t('inventory.pickWarehouse')}
              onChange={pick}
            />
          </FormField>
          <FormField label={t('inventory.location.binCode')} htmlFor="location-bin">
            <Input
              id="location-bin"
              className="font-mono sm:w-44"
              autoComplete="off"
              placeholder={t('inventory.bins.codePlaceholder')}
              value={binCode}
              onChange={(event) => setBinCode(event.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('inventory.location.min')} htmlFor="location-min">
              <Input
                id="location-min"
                inputMode="decimal"
                className="font-mono"
                value={minQty}
                onChange={(event) => setMinQty(event.target.value)}
              />
            </FormField>
            <FormField label={t('inventory.location.max')} htmlFor="location-max">
              <Input
                id="location-max"
                inputMode="decimal"
                className="font-mono"
                value={maxQty}
                onChange={(event) => setMaxQty(event.target.value)}
              />
            </FormField>
          </div>
          <DialogFormFooter
            pending={mutations.setLocation.isPending}
            disabled={warehouseId === undefined || !levelsValid}
            onCancel={props.onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
