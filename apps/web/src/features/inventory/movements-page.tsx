import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import {
  type MovementDocType,
  type StockMovement,
  useBin,
  useBinLookup,
  useProductStock,
  useStockMovements,
} from './api';
import { useWarehouseName, useWarehouseOptions } from './helpers';
import { ProductSearch, WarehouseSelect } from './shared';

const KINDS = ['WHOLESALE', 'STORE', 'VEHICLE', 'TRANSIT'] as const;
const DOC_TYPES: readonly MovementDocType[] = ['GR', 'BM', 'TR', 'ADJ', 'ST'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Documents that have a page of their own. */
const DOC_PAGES: Partial<Record<StockMovement['docType'], string>> = {
  GR: '/inventory/receipts',
  ADJ: '/inventory/adjustments',
  TR: '/inventory/transfers',
};

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};
const isDocType = (value: string | null): value is MovementDocType =>
  DOC_TYPES.some((type) => type === value);
const day = (value: string | null) => (value !== null && DAY.test(value) ? value : undefined);
const signed = (qty: string) => (qty.startsWith('-') ? qty : `+${qty}`);

/**
 * Movement history (SPEC §8.2 #1): every ledger row newest first, by product, warehouse, shelf,
 * document type and day, with a link to its document. Filtered by a product, each row also shows
 * the stock left in its warehouse and on its shelf; costs only for cost holders.
 */
export function MovementsPage() {
  const { t } = useTranslation();
  const canSeeCosts = useHasPermission('inventory.costs.manage');
  const [params, setParams] = useSearchParams();
  const productId = positiveId(params.get('product'));
  const warehouseId = positiveId(params.get('warehouse'));
  const binId = positiveId(params.get('bin'));
  const docParam = params.get('doc');
  const docType = isDocType(docParam) ? docParam : undefined;
  const from = day(params.get('from'));
  const to = day(params.get('to'));
  const movements = useStockMovements({ productId, warehouseId, binId, docType, from, to });
  const product = useProductStock(productId ?? 0, productId !== undefined);
  const bin = useBin(binId);
  const warehouses = useWarehouseOptions(KINDS);
  const warehouseName = useWarehouseName();
  const lookup = useBinLookup();
  const [missingBin, setMissingBin] = useState<string | null>(null);
  const rows = movements.data?.pages.flatMap((page) => page.data) ?? [];
  const withBalances = productId !== undefined;

  const update = (changes: Record<string, string | undefined>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const findBin = (code: string) => {
    if (warehouseId === undefined) return;
    lookup.mutate(
      { warehouseId, code },
      {
        onSuccess: (found) => {
          setMissingBin(null);
          update({ bin: String(found.id) });
        },
        onError: () => setMissingBin(code),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('inventory.movements.title')} />
      <p className="-mt-2 text-sm text-muted-foreground">{t('inventory.movements.intro')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>{t('inventory.movements.product')}</Label>
          {productId === undefined ? (
            <ProductSearch
              pickLabel={t('inventory.movements.pick')}
              onPick={(picked) => update({ product: String(picked.id) })}
            />
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-muted-foreground">{product.data?.product.sku}</span>
              <span className="font-medium">{product.data?.product.name}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('inventory.movements.clearProduct')}
                onClick={() => update({ product: undefined })}
              >
                <X />
              </Button>
            </div>
          )}
        </div>
        <div className="grid content-start gap-2 sm:grid-cols-2">
          <WarehouseSelect
            options={warehouses.options}
            value={warehouseId}
            emptyLabel={t('inventory.allWarehouses')}
            onChange={(id) =>
              update({ warehouse: id === undefined ? undefined : String(id), bin: undefined })
            }
          />
          <NativeSelect
            aria-label={t('inventory.movements.docType')}
            value={docType ?? ''}
            onChange={(event) => update({ doc: event.target.value || undefined })}
          >
            <option value="">{t('inventory.movements.allDocTypes')}</option>
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`inventory.movements.docTypes.${type}`)}
              </option>
            ))}
          </NativeSelect>
          <Input
            type="date"
            aria-label={t('inventory.movements.from')}
            value={from ?? ''}
            onChange={(event) => update({ from: event.target.value || undefined })}
          />
          <Input
            type="date"
            aria-label={t('inventory.movements.to')}
            value={to ?? ''}
            onChange={(event) => update({ to: event.target.value || undefined })}
          />
        </div>
      </div>
      {binId !== undefined ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('inventory.movements.bin')}</span>
          <span className="font-mono font-medium">{bin.data?.code}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('inventory.movements.clearBin')}
            onClick={() => update({ bin: undefined })}
          >
            <X />
          </Button>
        </div>
      ) : warehouseId !== undefined ? (
        <div className="flex flex-col gap-1">
          <ScanBox
            letters
            label={t('inventory.movements.bin')}
            placeholder={t('inventory.movements.binPlaceholder')}
            onScan={findBin}
          />
          {missingBin ? (
            <p className="text-sm text-destructive">
              {t('inventory.movements.binNotFound', { code: missingBin })}
            </p>
          ) : null}
        </div>
      ) : null}
      <ProblemAlert problem={problemFromError(movements.error)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('inventory.movements.columns.postedAt')}</TableHead>
            <TableHead>{t('inventory.movements.columns.document')}</TableHead>
            <TableHead>{t('inventory.movements.columns.movement')}</TableHead>
            <TableHead>{t('inventory.movements.columns.warehouse')}</TableHead>
            <TableHead>{t('inventory.movements.columns.bin')}</TableHead>
            <TableHead>{t('inventory.movements.columns.product')}</TableHead>
            <TableHead className="text-right">{t('inventory.movements.columns.qty')}</TableHead>
            {withBalances ? (
              <>
                <TableHead className="text-right">
                  {t('inventory.movements.columns.warehouseBalance')}
                </TableHead>
                <TableHead className="text-right">
                  {t('inventory.movements.columns.binBalance')}
                </TableHead>
              </>
            ) : null}
            {canSeeCosts ? (
              <>
                <TableHead className="text-right">
                  {t('inventory.movements.columns.unitCost')}
                </TableHead>
                <TableHead className="text-right">
                  {t('inventory.movements.columns.value')}
                </TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const docPage = DOC_PAGES[row.docType];
            const number = row.docNumber ?? t('common.none');
            return (
              <TableRow key={row.id}>
                <TableCell className="font-mono">
                  {formatUbDateTime(Date.parse(row.postedAt))}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-muted-foreground">
                      {t(`inventory.movements.docTypes.${row.docType}`)}
                    </span>
                    {docPage ? (
                      <Link
                        to={`${docPage}/${row.docId}`}
                        className="font-mono underline-offset-4 hover:underline"
                      >
                        {number}
                      </Link>
                    ) : (
                      <span className="font-mono">{number}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{t(`inventory.movements.types.${row.movementType}`)}</TableCell>
                <TableCell>{warehouseName(row.warehouseId)}</TableCell>
                <TableCell className="font-mono">{row.binCode}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">
                  <Link
                    to={`/inventory/stock/${row.product.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    <span className="font-mono text-muted-foreground">{row.product.sku}</span>{' '}
                    {row.product.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono">
                  <div className="flex flex-col items-end">
                    <span className={row.qtyBase.startsWith('-') ? 'text-destructive' : undefined}>
                      {t('inventory.qtyWithUnit', {
                        qty: signed(row.qtyBase),
                        unit: row.product.baseUnitName,
                      })}
                    </span>
                    {row.unitName !== row.product.baseUnitName ? (
                      <span className="text-xs text-muted-foreground">
                        {t('inventory.movements.entered', {
                          qty: row.enteredQty,
                          unit: row.unitName,
                        })}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                {withBalances ? (
                  <>
                    <TableCell className="text-right font-mono">
                      {row.warehouseBalance ?? t('common.none')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.binBalance ?? t('common.none')}
                    </TableCell>
                  </>
                ) : null}
                {canSeeCosts ? (
                  <>
                    <TableCell className="text-right font-mono">
                      {row.unitCost === undefined ? t('common.none') : formatMnt(row.unitCost)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.value === undefined ? t('common.none') : formatMnt(row.value)}
                    </TableCell>
                  </>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {!movements.isPending && rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t('inventory.movements.empty')}</p>
      ) : null}
      {movements.hasNextPage ? (
        <Button
          className="self-start"
          variant="outline"
          disabled={movements.isFetchingNextPage}
          onClick={() => void movements.fetchNextPage()}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
