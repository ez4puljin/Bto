import type { ProductListColumn } from '@tugeel/shared/catalog';
import type { TFunction } from 'i18next';
import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ProductLocation } from '@/features/inventory/api';
import type { ProductSupplierLink } from '@/features/partners/api';
import type { CurrentTerms } from '@/features/pricing/api';
import { formatMnt } from '@/lib/money';
import type { ProductListItem } from './api';
import { ProductStageBadge } from './product-stage-badge';

/**
 * Every column of the product list, in the order of the owner's product sheet (ADR-0037); the
 * price columns are the warehouse price and the price profile, and the tax data lives on the
 * product's e-Barimt card, not here (ADR-0048).
 */
/** The keys live in `@tugeel/shared/catalog` (`PRODUCT_LIST_COLUMNS`): the export uses them too. */
export type ProductColumnKey = ProductListColumn;

/** Columns that name the row; they cannot be hidden. */
export const LOCKED_PRODUCT_COLUMNS: readonly ProductColumnKey[] = ['sku', 'name'];

/**
 * What a user who never chose sees hidden (ADR-0066): photo, code, name, category, warehouse
 * price, supplier and status fit a 1366px screen; every column stays in «Баганууд».
 */
export const DEFAULT_HIDDEN_PRODUCT_COLUMNS: readonly ProductColumnKey[] = [
  'baseUnit',
  'units',
  'priceProfile',
  'baseBarcodes',
  'unitBarcodes',
  'weight',
  'homeWarehouse',
  'fixedBins',
];

/** What the cells read besides the row; `suppliers`, `locations`, `prices` are undefined until loaded. */
export interface ProductCellContext {
  t: TFunction;
  categoryPath: (id: number) => string | undefined;
  warehouseName: (id: number) => string;
  suppliers: ReadonlyMap<number, readonly ProductSupplierLink[]> | undefined;
  locations: ReadonlyMap<number, readonly ProductLocation[]> | undefined;
  prices: ReadonlyMap<number, readonly CurrentTerms[]> | undefined;
}

export interface ProductColumn {
  key: ProductColumnKey;
  /** Read from another module per page, only while the column shows. */
  source?: 'suppliers' | 'locations' | 'prices';
  /** Numbers and money: right-aligned in the head and the cells, tabular figures. */
  numeric?: boolean;
  /**
   * Long text on one line cut with «…», the whole text on hover (`TruncateCell`); `fill` gives the
   * column the table's spare width. Undefined text (not loaded yet) leaves the cell empty.
   */
  truncate?: {
    text: (row: ProductListItem, ctx: ProductCellContext) => string | undefined;
    fill?: boolean;
  };
  className?: string;
  cell: (row: ProductListItem, ctx: ProductCellContext) => ReactNode;
}

const none = (ctx: ProductCellContext) => (
  <span className="text-muted-foreground">{ctx.t('common.none')}</span>
);

/** One value per line, or «—» when there is none. */
const lines = (values: readonly string[], ctx: ProductCellContext, mono = false) =>
  values.length === 0 ? (
    none(ctx)
  ) : (
    <div className={mono ? 'flex flex-col font-mono' : 'flex flex-col'}>
      {values.map((value, index) => (
        <span key={`${index}:${value}`}>{value}</span>
      ))}
    </div>
  );

const text = (value: string | null | undefined, ctx: ProductCellContext) =>
  value ? value : none(ctx);

const otherUnits = (row: ProductListItem) => row.units.filter((unit) => !unit.isBase);

/** Today's price terms of a product (ADR-0048), or undefined while they load. */
const termsOf = (row: ProductListItem, ctx: ProductCellContext) => ctx.prices?.get(row.id)?.[0];

/** How `categoryPaths` joins a path («Хүнс / Гурил», `@tugeel/shared/catalog`). */
const PATH_SEPARATOR = ' / ';

/**
 * A category's path in a narrow column: the parents give way («Туршилтын ба… / Ахуйн бараа») so
 * the category itself stays whole; the whole path shows on hover.
 */
function categoryCell(path: string | undefined, ctx: ProductCellContext): ReactNode {
  if (!path) return none(ctx);
  const parts = path.split(PATH_SEPARATOR);
  const leaf = parts.pop();
  if (parts.length === 0 || leaf === undefined) return path;
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate">{parts.join(PATH_SEPARATOR)}</span>
      {/* The separator stays with the category, after the parents' «…». */}
      <span className="shrink-0">{`\u00a0/ ${leaf}`}</span>
    </span>
  );
}

/** The main supplier, with «+N» for the others; undefined while the links load. */
function supplierText(row: ProductListItem, ctx: ProductCellContext): string | undefined {
  if (!ctx.suppliers) return undefined;
  const [main, ...others] = ctx.suppliers.get(row.id) ?? [];
  if (!main) return ctx.t('common.none');
  return others.length === 0
    ? main.supplier.name
    : `${main.supplier.name} ${ctx.t('catalog.products.moreSuppliers', { count: others.length })}`;
}

export const PRODUCT_COLUMNS: readonly ProductColumn[] = [
  {
    key: 'image',
    // A 32px photo keeps the row at 36px (ADR-0066).
    className: 'w-12 px-2 py-0.5',
    cell: (row) =>
      row.thumbUrl ? (
        <img src={row.thumbUrl} alt="" loading="lazy" className="size-8 rounded-md object-cover" />
      ) : (
        <div className="flex size-8 items-center justify-center rounded-md bg-muted">
          <ImageOff className="size-3.5 text-muted-foreground" />
        </div>
      ),
  },
  { key: 'sku', className: 'font-mono', cell: (row) => row.sku },
  {
    key: 'name',
    // The name takes the spare width, never less than 11rem: with many columns the list scrolls.
    truncate: { text: (row) => row.name, fill: true },
    className: 'min-w-44',
    cell: (row) => (
      <Link
        to={`/catalog/products/${row.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.name}
      </Link>
    ),
  },
  {
    key: 'category',
    truncate: { text: (row, ctx) => ctx.categoryPath(row.categoryId) },
    className: 'max-w-40 text-muted-foreground min-[1440px]:max-w-64',
    cell: (row, ctx) => categoryCell(ctx.categoryPath(row.categoryId), ctx),
  },
  { key: 'baseUnit', cell: (row) => row.baseUnit.uomName },
  {
    key: 'units',
    cell: (row, ctx) =>
      lines(
        otherUnits(row).map((unit) =>
          ctx.t('catalog.units.factorOf', {
            unit: unit.uomName,
            factor: unit.factorToBase,
            base: row.baseUnit.uomName,
          }),
        ),
        ctx,
      ),
  },
  {
    key: 'warehousePrice',
    source: 'prices',
    numeric: true,
    cell: (row, ctx) => {
      if (!ctx.prices) return null;
      const terms = termsOf(row, ctx);
      return terms
        ? ctx.t('pricing.money', { amount: formatMnt(terms.warehousePrice) })
        : none(ctx);
    },
  },
  {
    key: 'priceProfile',
    source: 'prices',
    cell: (row, ctx) => (ctx.prices ? text(termsOf(row, ctx)?.profileName, ctx) : null),
  },
  {
    key: 'baseBarcodes',
    cell: (row, ctx) => lines(row.units.find((unit) => unit.isBase)?.barcodes ?? [], ctx, true),
  },
  {
    key: 'unitBarcodes',
    cell: (row, ctx) =>
      lines(
        otherUnits(row).flatMap((unit) =>
          unit.barcodes.map((code) =>
            ctx.t('catalog.products.unitBarcode', { code, unit: unit.uomName }),
          ),
        ),
        ctx,
        true,
      ),
  },
  { key: 'weight', numeric: true, cell: (row, ctx) => text(row.weightKg, ctx) },
  {
    key: 'homeWarehouse',
    source: 'locations',
    cell: (row, ctx) => {
      if (!ctx.locations) return null;
      const home = ctx.locations.get(row.id)?.find((location) => location.isHome);
      return home ? ctx.warehouseName(home.warehouseId) : none(ctx);
    },
  },
  {
    key: 'fixedBins',
    source: 'locations',
    cell: (row, ctx) => {
      if (!ctx.locations) return null;
      return lines(
        (ctx.locations.get(row.id) ?? []).flatMap((location) =>
          location.defaultBinCode
            ? [
                ctx.t('catalog.products.fixedBin', {
                  warehouse: ctx.warehouseName(location.warehouseId),
                  bin: location.defaultBinCode,
                }),
              ]
            : [],
        ),
        ctx,
      );
    },
  },
  {
    key: 'supplier',
    source: 'suppliers',
    truncate: { text: supplierText },
    className: 'max-w-40 min-[1800px]:max-w-64',
    cell: (row, ctx) => {
      const shown = supplierText(row, ctx);
      if (shown === undefined) return null;
      return ctx.suppliers?.get(row.id)?.length ? shown : none(ctx);
    },
  },
  {
    key: 'status',
    cell: (row) => <ProductStageBadge product={row} />,
  },
];
