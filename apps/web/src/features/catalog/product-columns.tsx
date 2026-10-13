import type { TFunction } from 'i18next';
import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ProductLocation } from '@/features/inventory/api';
import type { ProductSupplierLink } from '@/features/partners/api';
import type { CurrentPrice } from '@/features/pricing/api';
import { formatMnt } from '@/lib/money';
import type { ProductListItem } from './api';
import { ProductStageBadge } from './product-stage-badge';

/** Every column of the product list, in the order of the owner's product sheet (ADR-0037). */
export const PRODUCT_COLUMN_KEYS = [
  'image',
  'sku',
  'name',
  'category',
  'baseUnit',
  'units',
  'wholesalePrice',
  'retailPrice',
  'baseBarcodes',
  'unitBarcodes',
  'vatType',
  'cityTax',
  'weight',
  'homeWarehouse',
  'fixedBins',
  'supplier',
  'classificationCode',
  'taxProductCode',
  'status',
] as const;
export type ProductColumnKey = (typeof PRODUCT_COLUMN_KEYS)[number];

/** Columns that name the row; they cannot be hidden. */
export const LOCKED_PRODUCT_COLUMNS: readonly ProductColumnKey[] = ['sku', 'name'];

/** What the cells read besides the row; `suppliers`, `locations`, `prices` are undefined until loaded. */
export interface ProductCellContext {
  t: TFunction;
  categoryPath: (id: number) => string | undefined;
  warehouseName: (id: number) => string;
  suppliers: ReadonlyMap<number, readonly ProductSupplierLink[]> | undefined;
  locations: ReadonlyMap<number, readonly ProductLocation[]> | undefined;
  prices: ReadonlyMap<number, readonly CurrentPrice[]> | undefined;
}

export interface ProductColumn {
  key: ProductColumnKey;
  /** Read from another module per page, only while the column shows. */
  source?: 'suppliers' | 'locations' | 'prices';
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

/** The base unit's price today in a list (ADR-0041), or «—». */
const priceCell = (row: ProductListItem, ctx: ProductCellContext, list: CurrentPrice['list']) => {
  if (!ctx.prices) return null;
  const price = ctx.prices.get(row.id)?.find((entry) => entry.list === list);
  return price ? ctx.t('pricing.money', { amount: formatMnt(price.price) }) : none(ctx);
};

export const PRODUCT_COLUMNS: readonly ProductColumn[] = [
  {
    key: 'image',
    className: 'w-14',
    cell: (row) =>
      row.thumbUrl ? (
        <img src={row.thumbUrl} alt="" loading="lazy" className="size-10 rounded-md object-cover" />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <ImageOff className="size-4 text-muted-foreground" />
        </div>
      ),
  },
  { key: 'sku', className: 'font-mono', cell: (row) => row.sku },
  {
    key: 'name',
    className: 'min-w-48 whitespace-normal',
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
    className: 'whitespace-normal text-muted-foreground',
    cell: (row, ctx) => text(ctx.categoryPath(row.categoryId), ctx),
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
    key: 'wholesalePrice',
    source: 'prices',
    className: 'text-right font-mono',
    cell: (row, ctx) => priceCell(row, ctx, 'WHOLESALE'),
  },
  {
    key: 'retailPrice',
    source: 'prices',
    className: 'text-right font-mono',
    cell: (row, ctx) => priceCell(row, ctx, 'RETAIL'),
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
  { key: 'vatType', cell: (row, ctx) => ctx.t(`catalog.product.vatTypes.${row.vatType}`) },
  {
    key: 'cityTax',
    cell: (row, ctx) =>
      ctx.t(
        row.cityTax === null
          ? 'catalog.product.cityTaxValues.unknown'
          : row.cityTax
            ? 'catalog.product.cityTaxValues.yes'
            : 'catalog.product.cityTaxValues.no',
      ),
  },
  { key: 'weight', className: 'font-mono', cell: (row, ctx) => text(row.weightKg, ctx) },
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
    className: 'whitespace-normal',
    cell: (row, ctx) => {
      if (!ctx.suppliers) return null;
      const [main, ...others] = ctx.suppliers.get(row.id) ?? [];
      if (!main) return none(ctx);
      return others.length === 0
        ? main.supplier.name
        : `${main.supplier.name} ${ctx.t('catalog.products.moreSuppliers', { count: others.length })}`;
    },
  },
  {
    key: 'classificationCode',
    className: 'font-mono',
    cell: (row, ctx) => text(row.classificationCode, ctx),
  },
  {
    key: 'taxProductCode',
    className: 'font-mono',
    cell: (row, ctx) => text(row.taxProductCode, ctx),
  },
  {
    key: 'status',
    cell: (row) => <ProductStageBadge product={row} />,
  },
];
