import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronHead, LinkRow } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProductLocationsOf } from '@/features/inventory/api';
import { useProductSuppliersOf } from '@/features/partners/api';
import { useCurrentPricesOf } from '@/features/pricing/api';
import { problemFromError } from '@/lib/problem';
import type { ProductListItem } from './api';
import type { ProductCellContext, ProductColumn } from './product-columns';

/** What every page of rows shares; suppliers, locations and prices are read per page. */
export type ProductTableContext = Omit<ProductCellContext, 'suppliers' | 'locations' | 'prices'>;

/** The ticked rows of the list (ADR-0049) and how to change them. */
export interface ProductSelection {
  selected: ReadonlySet<number>;
  toggle: (id: number, on: boolean) => void;
  /** Ticks or clears every loaded row. */
  setAll: (ids: readonly number[], on: boolean) => void;
}

/**
 * The product list (ADR-0037): one body for every loaded page; each page reads the supplier links
 * and locations of its own products, only while a column shows them. Rows open the product
 * (`LinkRow`, ADR-0042). With a selection, a first column of checkboxes (ADR-0049): each in a label
 * filling its cell, so a click beside the box ticks it rather than opening the product.
 */
export const ProductTable = memo(function ProductTable(props: {
  pages: readonly { data: ProductListItem[] }[];
  columns: readonly ProductColumn[];
  context: ProductTableContext;
  selection?: ProductSelection;
}) {
  const { t } = useTranslation();
  const { selection } = props;
  const loaded = useMemo(
    () => props.pages.flatMap((page) => page.data.map((row) => row.id)),
    [props.pages],
  );
  const ticked = selection ? loaded.filter((id) => selection.selected.has(id)).length : 0;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selection ? (
            <TableHead className="w-10">
              <Checkbox
                aria-label={t('common.selectAll')}
                checked={
                  ticked > 0 && ticked === loaded.length
                    ? true
                    : ticked > 0
                      ? 'indeterminate'
                      : false
                }
                disabled={loaded.length === 0}
                onCheckedChange={(checked) => selection.setAll(loaded, checked === true)}
              />
            </TableHead>
          ) : null}
          {props.columns.map((column) => (
            <TableHead key={column.key}>{t(`catalog.products.columns.${column.key}`)}</TableHead>
          ))}
          <ChevronHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.pages.map((page, index) => (
          <ProductPageRows
            // Pages only grow at the end, so their position is a stable key.
            key={index}
            rows={page.data}
            columns={props.columns}
            context={props.context}
            selection={selection}
          />
        ))}
      </TableBody>
    </Table>
  );
});

const ProductPageRows = memo(function ProductPageRows(props: {
  rows: ProductListItem[];
  columns: readonly ProductColumn[];
  context: ProductTableContext;
  selection: ProductSelection | undefined;
}) {
  const { t } = useTranslation();
  const { rows, columns, context, selection } = props;
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const suppliers = useProductSuppliersOf(
    ids,
    columns.some((column) => column.source === 'suppliers'),
  );
  const locations = useProductLocationsOf(
    ids,
    columns.some((column) => column.source === 'locations'),
  );
  const prices = useCurrentPricesOf(
    ids,
    columns.some((column) => column.source === 'prices'),
  );
  const cellContext = useMemo<ProductCellContext>(
    () => ({
      ...context,
      suppliers: byProduct(suppliers.data),
      locations: byProduct(locations.data),
      prices: byProduct(prices.data),
    }),
    [context, suppliers.data, locations.data, prices.data],
  );
  const problem =
    problemFromError(suppliers.error) ??
    problemFromError(locations.error) ??
    problemFromError(prices.error);

  return (
    <>
      {problem ? (
        <TableRow>
          <TableCell colSpan={columns.length + (selection ? 2 : 1)} className="whitespace-normal">
            <ProblemAlert problem={problem} />
          </TableCell>
        </TableRow>
      ) : null}
      {rows.map((row) => (
        <LinkRow
          key={row.id}
          to={`/catalog/products/${row.id}`}
          selected={selection?.selected.has(row.id) ?? false}
        >
          {selection ? (
            <TableCell className="w-10 p-0">
              <label className="flex cursor-pointer items-center px-3 py-3">
                <Checkbox
                  aria-label={t('common.selectRow', { name: row.sku })}
                  checked={selection.selected.has(row.id)}
                  onCheckedChange={(checked) => selection.toggle(row.id, checked === true)}
                />
              </label>
            </TableCell>
          ) : null}
          {columns.map((column) => (
            <TableCell key={column.key} className={column.className}>
              {column.cell(row, cellContext)}
            </TableCell>
          ))}
        </LinkRow>
      ))}
    </>
  );
});

/** Rows of a batch read grouped by product, keeping the server's order within a product. */
function byProduct<T extends { productId: number }>(
  rows: readonly T[] | undefined,
): ReadonlyMap<number, T[]> | undefined {
  if (!rows) return undefined;
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const list = map.get(row.productId) ?? [];
    list.push(row);
    map.set(row.productId, list);
  }
  return map;
}
