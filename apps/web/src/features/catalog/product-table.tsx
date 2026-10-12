import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ProblemAlert } from '@/components/problem-alert';
import { RecordActionsHead, RecordRow } from '@/components/record-row';
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
import { problemFromError } from '@/lib/problem';
import type { ProductListItem } from './api';
import type { ProductCellContext, ProductColumn } from './product-columns';

/** What every page of rows shares; suppliers and locations are read per page. */
export type ProductTableContext = Omit<ProductCellContext, 'suppliers' | 'locations'>;

/**
 * The product list (ADR-0037): one body for every loaded page; each page reads the supplier links
 * and locations of its own products, only while a column shows them. Rows open the product
 * (`RecordRow`).
 */
export const ProductTable = memo(function ProductTable(props: {
  pages: readonly { data: ProductListItem[] }[];
  columns: readonly ProductColumn[];
  context: ProductTableContext;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <RecordActionsHead />
          {props.columns.map((column) => (
            <TableHead key={column.key}>{t(`catalog.products.columns.${column.key}`)}</TableHead>
          ))}
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
            canManage={props.canManage}
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
  canManage: boolean;
}) {
  const { rows, columns, context, canManage } = props;
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const suppliers = useProductSuppliersOf(
    ids,
    columns.some((column) => column.source === 'suppliers'),
  );
  const locations = useProductLocationsOf(
    ids,
    columns.some((column) => column.source === 'locations'),
  );
  const cellContext = useMemo<ProductCellContext>(
    () => ({
      ...context,
      suppliers: byProduct(suppliers.data),
      locations: byProduct(locations.data),
    }),
    [context, suppliers.data, locations.data],
  );
  const problem = problemFromError(suppliers.error) ?? problemFromError(locations.error);

  return (
    <>
      {problem ? (
        <TableRow>
          <TableCell colSpan={columns.length + 1} className="whitespace-normal">
            <ProblemAlert problem={problem} />
          </TableCell>
        </TableRow>
      ) : null}
      {rows.map((row) => (
        <RecordRow
          key={row.id}
          href={`/catalog/products/${row.id}`}
          name={row.name}
          canManage={canManage}
        >
          {columns.map((column) => (
            <TableCell key={column.key} className={column.className}>
              {column.cell(row, cellContext)}
            </TableCell>
          ))}
        </RecordRow>
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
