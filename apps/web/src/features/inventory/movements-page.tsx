import { cleanBarcode } from '@tugeel/shared/gtin';
import { History } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ColumnChooser } from '@/components/column-chooser';
import {
  EmptyState,
  FilterBar,
  FilterChip,
  ListCard,
  LoadMore,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { DateRangeFilter } from '@/features/finance/date-range-filter';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { Input } from '@/components/ui/input';
import { withScanChar } from '@/lib/barcode-keys';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useWedgeScanner } from '@/lib/scan/use-wedge-scanner';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
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
const DOC_TYPES: readonly MovementDocType[] = ['GR', 'GI', 'BM', 'TR', 'ADJ', 'ST'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Documents that have a page of their own. */
const DOC_PAGES: Partial<Record<StockMovement['docType'], string>> = {
  GR: '/inventory/receipts',
  GI: '/inventory/issues',
  ADJ: '/inventory/adjustments',
  TR: '/inventory/transfers',
  ST: '/inventory/stocktakes',
};

const positiveId = (value: string | null) => {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};
const isDocType = (value: string | null): value is MovementDocType =>
  DOC_TYPES.some((type) => type === value);
const day = (value: string | null) => (value !== null && DAY.test(value) ? value : undefined);
/** A movement's quantity with its sign, thousands grouped («+1,200», «-3»). */
const signed = (qty: string) => (qty.startsWith('-') ? formatQty(qty) : `+${formatQty(qty)}`);

const COLUMNS = [
  'postedAt',
  'document',
  'movement',
  'warehouse',
  'bin',
  'product',
  'qty',
  'warehouseBalance',
  'binBalance',
  'unitCost',
  'value',
] as const;
type Column = (typeof COLUMNS)[number];
const LOCKED: readonly Column[] = ['postedAt', 'document', 'qty'];
const RIGHT: readonly Column[] = ['qty', 'warehouseBalance', 'binBalance', 'unitCost', 'value'];
const COSTS: readonly Column[] = ['unitCost', 'value'];
const NONE: readonly Column[] = [];

/**
 * The costs of a cost holder start hidden below a wide screen (ADR-0066), so the history fits a
 * laptop without a sideways scroll; the column chooser brings them back.
 */
function defaultHiddenColumns(): readonly Column[] {
  const wide =
    typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1536px)').matches;
  return wide ? NONE : COSTS;
}

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
  const [defaultHidden] = useState(defaultHiddenColumns);
  const columnChoice = useHiddenColumns('stockMovements', COLUMNS, LOCKED, defaultHidden);
  // The columns this page can show: balances with a product, costs for cost holders; one product's
  // history needs no product column.
  const available = COLUMNS.filter((column) => {
    if (column === 'product') return !withBalances;
    if (column === 'warehouseBalance' || column === 'binBalance') return withBalances;
    if (column === 'unitCost' || column === 'value') return canSeeCosts;
    return true;
  });
  const shown = (column: Column) => available.includes(column) && !columnChoice.hidden.has(column);

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

  const columns = available.filter(shown).length;

  return (
    <div>
      <PageHeader
        title={t('inventory.movements.title')}
        description={t('inventory.movements.intro')}
      />
      {/* Every filter in one bar (ADR-0066): the product is a search pill until chosen, then a chip. */}
      <FilterBar
        end={
          <ColumnChooser
            keys={available}
            locked={LOCKED}
            label={(column) => t(`inventory.movements.columns.${column}`)}
            hidden={columnChoice.hidden}
            toggle={columnChoice.toggle}
            showAll={columnChoice.showAll}
          />
        }
      >
        {productId !== undefined ? (
          <FilterChip
            clearLabel={t('inventory.movements.clearProduct')}
            onClear={() => update({ product: undefined })}
          >
            <span className="font-mono text-muted-foreground">{product.data?.product.sku}</span>{' '}
            <span>{product.data?.product.name}</span>
          </FilterChip>
        ) : (
          <>
            <label htmlFor="movements-product" className="sr-only">
              {t('inventory.movements.product')}
            </label>
            <ProductSearch
              id="movements-product"
              variant="filter"
              className="sm:w-64"
              pickLabel={t('inventory.movements.pick')}
              onPick={(picked) => update({ product: String(picked.id) })}
            />
          </>
        )}
        <WarehouseSelect
          variant="filter"
          options={warehouses.options}
          value={warehouseId}
          emptyLabel={t('inventory.allWarehouses')}
          onChange={(id) =>
            update({ warehouse: id === undefined ? undefined : String(id), bin: undefined })
          }
        />
        <NativeSelect
          variant="filter"
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
        <DateRangeFilter
          label={t('inventory.date')}
          fromLabel={t('inventory.movements.from')}
          toLabel={t('inventory.movements.to')}
          from={from}
          to={to}
          onFrom={(value) => update({ from: value })}
          onTo={(value) => update({ to: value })}
        />
        {binId !== undefined ? (
          <FilterChip
            clearLabel={t('inventory.movements.clearBin')}
            onClear={() => update({ bin: undefined })}
          >
            <span className="text-muted-foreground">{t('inventory.movements.bin')}</span>{' '}
            <span className="font-mono">{bin.data?.code}</span>
          </FilterChip>
        ) : warehouseId !== undefined ? (
          <ShelfFilter onFind={findBin} />
        ) : null}
      </FilterBar>
      {missingBin && binId === undefined ? (
        <p className="mb-3 text-sm text-destructive">
          {t('inventory.movements.binNotFound', { code: missingBin })}
        </p>
      ) : null}
      <ProblemAlert problem={problemFromError(movements.error)} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              {available.filter(shown).map((column) => (
                <TableHead
                  key={column}
                  className={RIGHT.includes(column) ? 'text-right' : undefined}
                >
                  {t(`inventory.movements.columns.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.isPending ? <SkeletonRows columns={columns} /> : null}
            {rows.map((row) => {
              const docPage = DOC_PAGES[row.docType];
              const number = row.docNumber ?? t('common.none');
              const [date, time] = formatUbDateTime(Date.parse(row.postedAt)).split(' ');
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-mono">
                    <div className="flex flex-col">
                      <span>{date}</span>
                      <span className="text-xs text-muted-foreground">{time}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">
                        {t(`inventory.movements.docTypes.${row.docType}`)}
                      </span>
                      {docPage ? (
                        <Link
                          to={`${docPage}/${row.docId}`}
                          className="font-mono text-link underline-offset-4 hover:underline"
                        >
                          {number}
                        </Link>
                      ) : (
                        <span className="font-mono">{number}</span>
                      )}
                    </div>
                  </TableCell>
                  {shown('movement') ? (
                    <TableCell>{t(`inventory.movements.types.${row.movementType}`)}</TableCell>
                  ) : null}
                  {shown('warehouse') ? (
                    <TableCell>{warehouseName(row.warehouseId)}</TableCell>
                  ) : null}
                  {shown('bin') ? <TableCell className="font-mono">{row.binCode}</TableCell> : null}
                  {shown('product') ? (
                    <TruncateCell
                      text={`${row.product.sku} ${row.product.name}`}
                      fill
                      className="min-w-44"
                    >
                      <Link
                        to={`/inventory/stock/${row.product.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        <span className="font-mono text-muted-foreground">{row.product.sku}</span>{' '}
                        {row.product.name}
                      </Link>
                    </TruncateCell>
                  ) : null}
                  <TableCell className="text-right font-mono">
                    <div className="flex flex-col items-end">
                      <span
                        className={row.qtyBase.startsWith('-') ? 'text-destructive' : undefined}
                      >
                        {t('inventory.qtyWithUnit', {
                          qty: signed(row.qtyBase),
                          unit: row.product.baseUnitName,
                        })}
                      </span>
                      {row.unitName !== row.product.baseUnitName ? (
                        <span className="text-xs text-muted-foreground">
                          {t('inventory.movements.entered', {
                            qty: formatQty(row.enteredQty),
                            unit: row.unitName,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  {shown('warehouseBalance') ? (
                    <TableCell className="text-right font-mono">
                      {row.warehouseBalance ? formatQty(row.warehouseBalance) : t('common.none')}
                    </TableCell>
                  ) : null}
                  {shown('binBalance') ? (
                    <TableCell className="text-right font-mono">
                      {row.binBalance ? formatQty(row.binBalance) : t('common.none')}
                    </TableCell>
                  ) : null}
                  {shown('unitCost') ? (
                    <TableCell className="text-right font-mono">
                      {row.unitCost === undefined ? t('common.none') : formatMnt(row.unitCost)}
                    </TableCell>
                  ) : null}
                  {shown('value') ? (
                    <TableCell className="text-right font-mono">
                      {row.value === undefined ? t('common.none') : formatMnt(row.value)}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!movements.isPending && rows.length === 0 ? (
          <EmptyState icon={History} title={t('inventory.movements.empty')} />
        ) : null}
        <LoadMore query={movements} />
      </ListCard>
    </div>
  );
}

/**
 * The bar's shelf filter (ADR-0066): a pill taking a typed or scanned label, read by physical key
 * so the keyboard layout does not matter; a scanner works without clicking it first.
 */
function ShelfFilter({ onFind }: { onFind: (code: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const submit = (text: string) => {
    const code = cleanBarcode(text);
    setDraft('');
    if (code) onFind(code);
  };
  useWedgeScanner(submit, true, { letters: true, root });
  return (
    <div ref={root} className="w-full sm:w-64">
      <Input
        aria-label={t('inventory.movements.bin')}
        placeholder={t('inventory.movements.binPlaceholder')}
        autoComplete="off"
        spellCheck={false}
        className="h-8 rounded-full font-mono md:text-[13px]"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit(draft);
            return;
          }
          const typed = withScanChar(event, draft);
          if (typed !== null) setDraft(typed);
        }}
      />
    </div>
  );
}
