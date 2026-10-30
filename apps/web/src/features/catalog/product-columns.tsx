import { BINS_SOON } from '@/lib/features';
import type { ProductListColumn } from '@tugeel/shared/catalog';
import type { TFunction } from 'i18next';
import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ProductLocation } from '@/features/inventory/api';
import type { ProductSupplierLink } from '@/features/partners/api';
import type { CurrentTerms } from '@/features/pricing/api';
import type { ColumnKind } from '@/lib/column-layout';
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

/**
 * What that user sees hidden on a screen of 1600px or more (ADR-0119): the base unit, the weight
 * and the home warehouse fit there too.
 */
export const WIDE_DEFAULT_HIDDEN_PRODUCT_COLUMNS: readonly ProductColumnKey[] = [
  'units',
  'priceProfile',
  'baseBarcodes',
  'unitBarcodes',
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
  /** How the column is sized in the list's layout (ADR-0119, `lib/column-layout.ts`). */
  kind: ColumnKind;
  /** A text column's share of the spare width (default 1). */
  weight?: number;
  /** A text column's narrowest width in rem (default 8). */
  min?: number;
  /** A fixed column's width in rem when the kind's default does not fit its values. */
  width?: number;
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
    kind: 'image',
    // A 32px photo keeps the row at 36px (ADR-0066).
    className: 'px-2 py-0.5',
    cell: (row) =>
      row.thumbUrl ? (
        <img src={row.thumbUrl} alt="" loading="lazy" className="size-8 rounded-md object-cover" />
      ) : (
        <div className="flex size-8 items-center justify-center rounded-md bg-muted">
          <ImageOff className="size-3.5 text-muted-foreground" />
        </div>
      ),
  },
  { key: 'sku', kind: 'code', className: 'font-mono', cell: (row) => row.sku },
  {
    key: 'name',
    // The name takes the largest share of the spare width, never less than 12rem: with many
    // columns the list scrolls.
    kind: 'text',
    weight: 3,
    min: 12,
    truncate: { text: (row) => row.name },
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
    kind: 'text',
    weight: 2.5,
    truncate: { text: (row, ctx) => ctx.categoryPath(row.categoryId) },
    className: 'text-muted-foreground',
    cell: (row, ctx) => categoryCell(ctx.categoryPath(row.categoryId), ctx),
  },
  { key: 'baseUnit', kind: 'text', weight: 0.5, min: 5, cell: (row) => row.baseUnit.uomName },
  {
    key: 'units',
    kind: 'text',
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
    kind: 'money',
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
    kind: 'text',
    source: 'prices',
    cell: (row, ctx) => (ctx.prices ? text(termsOf(row, ctx)?.profileName, ctx) : null),
  },
  {
    key: 'baseBarcodes',
    kind: 'text',
    cell: (row, ctx) => lines(row.units.find((unit) => unit.isBase)?.barcodes ?? [], ctx, true),
  },
  {
    key: 'unitBarcodes',
    kind: 'text',
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
  { key: 'weight', kind: 'qty', numeric: true, cell: (row, ctx) => text(row.weightKg, ctx) },
  {
    key: 'homeWarehouse',
    kind: 'text',
    source: 'locations',
    cell: (row, ctx) => {
      if (!ctx.locations) return null;
      const home = ctx.locations.get(row.id)?.find((location) => location.isHome);
      return home ? ctx.warehouseName(home.warehouseId) : none(ctx);
    },
  },
  {
    key: 'fixedBins',
    kind: 'text',
    source: 'locations',
    cell: (row, ctx) => {
      if (BINS_SOON) return none(ctx);
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
    kind: 'text',
    weight: 2,
    source: 'suppliers',
    truncate: { text: supplierText },
    cell: (row, ctx) => {
      const shown = supplierText(row, ctx);
      if (shown === undefined) return null;
      return ctx.suppliers?.get(row.id)?.length ? shown : none(ctx);
    },
  },
  {
    key: 'status',
    kind: 'status',
    cell: (row) => <ProductStageBadge product={row} />,
  },
];
