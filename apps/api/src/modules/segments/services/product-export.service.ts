import { Inject, Injectable } from '@nestjs/common';
import {
  categoryPaths,
  EXPORTABLE_PRODUCT_COLUMNS,
  type ExportableProductColumn,
  MAX_EXPORT_ROWS,
  productStage,
} from '@tugeel/shared/catalog';
import mn from '@tugeel/shared/i18n/mn.json';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import {
  type ExcelColumn,
  type ExcelColumnKind,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import { AppError } from '../../../common/errors/app-error';
import {
  CategoriesService,
  type ProductListItem,
  type ProductListQuery,
  ProductQueryService,
} from '../../catalog';
import { OrgService } from '../../identity';
import { type ProductLocation, ProductLocationsService } from '../../inventory';
import { type ProductSupplierLink, ProductSuppliersService } from '../../partners';
import { type CurrentTerms, ProductPricesService } from '../../pricing';

/** Products read and written at a time (ADR-0049 #6). */
const CHUNK = 1_000;
/** Exports one process writes at once; a third is refused (429), never queued. */
const MAX_RUNNING = 2;
/** Several values in one cell: barcodes, units, shelves, suppliers. */
const SEPARATOR = ', ';

/** Codes and barcodes stay text (leading zeros, 13 digits); prices and weights are numbers. */
const KINDS: Record<ExportableProductColumn, ExcelColumnKind> = {
  sku: 'text',
  name: 'text',
  category: 'text',
  baseUnit: 'text',
  units: 'text',
  warehousePrice: 'number',
  priceProfile: 'text',
  baseBarcodes: 'text',
  unitBarcodes: 'text',
  weight: 'number',
  homeWarehouse: 'text',
  fixedBins: 'text',
  supplier: 'text',
  status: 'text',
};

/** The owner a column reads besides catalog's list row; only the chosen columns' owners are read. */
const SOURCES: Partial<Record<ExportableProductColumn, 'prices' | 'locations' | 'suppliers'>> = {
  warehousePrice: 'prices',
  priceProfile: 'prices',
  homeWarehouse: 'locations',
  fixedBins: 'locations',
  supplier: 'suppliers',
};

export interface ProductExportRequest {
  /** The ticked products; without them, every product the filters keep. */
  productIds?: readonly number[];
  filters: ProductListQuery;
  columns: readonly ExportableProductColumn[];
}

/** Read once per export. */
interface Names {
  categoryPath: ReadonlyMap<number, string>;
  warehouse: ReadonlyMap<number, string>;
}

/** Other owners' data of one chunk, by product. */
interface Related {
  prices: ReadonlyMap<number, CurrentTerms>;
  locations: ReadonlyMap<number, readonly ProductLocation[]>;
  suppliers: ReadonlyMap<number, readonly ProductSupplierLink[]>;
}

/**
 * The product export (ADR-0049 #6): the ticked products, or every product the list's filters
 * keep (at most 20,000), in the list's order, with the list's visible columns in the list's order.
 * The ids are settled first; the rows are then read in one REPEATABLE READ transaction, 1,000 at
 * a time, from the owners' public services, so a long export sees one moment of the data.
 */
@Injectable()
export class ProductExportService {
  private running = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly products: ProductQueryService,
    private readonly categories: CategoriesService,
    private readonly org: OrgService,
    private readonly locations: ProductLocationsService,
    private readonly suppliers: ProductSuppliersService,
    private readonly prices: ProductPricesService,
  ) {}

  async workbook(request: ProductExportRequest): Promise<Buffer> {
    if (this.running >= MAX_RUNNING) {
      throw new AppError('TOO_MANY_REQUESTS', `${MAX_RUNNING} product exports are running`);
    }
    this.running += 1;
    try {
      return await this.write(request);
    } finally {
      this.running -= 1;
    }
  }

  private async write(request: ProductExportRequest): Promise<Buffer> {
    const keys = EXPORTABLE_PRODUCT_COLUMNS.filter((key) => request.columns.includes(key));
    const columns: ExcelColumn[] = keys.map((key) => ({
      name: mn.catalog.products.columns[key],
      kind: KINDS[key],
    }));
    const ids = await this.idsOf(request);
    const names: Names = {
      categoryPath: categoryPaths(await this.categories.list()),
      warehouse: new Map(
        (await this.org.listWarehouses()).map((warehouse) => [warehouse.id, warehouse.name]),
      ),
    };
    return inTransaction(
      this.db,
      (tx) =>
        tableWorkbook(
          mn.catalog.products.title,
          { yes: mn.common.yes, no: mn.common.no },
          async (sheet) => {
            // The header even when nothing is kept.
            sheet.addRows(columns, []);
            for (let at = 0; at < ids.length; at += CHUNK) {
              const chunk = ids.slice(at, at + CHUNK);
              const items = await this.products.listItemsOf(chunk, tx);
              const related = await this.related(keys, chunk, tx);
              sheet.addRows(
                columns,
                items.map((item) => rowOf(keys, item, related, names)),
              );
            }
          },
        ),
      'repeatable read',
    );
  }

  /** The ticked products in the list's order, or what the filters keep (422 above the limit). */
  private async idsOf(request: ProductExportRequest): Promise<number[]> {
    if (request.productIds) return this.products.orderedOf(request.productIds);
    const { ids, total } = await this.products.orderedIds(request.filters, MAX_EXPORT_ROWS);
    if (total > MAX_EXPORT_ROWS) {
      throw new AppError('EXPORT_TOO_LARGE', `${total} products, at most ${MAX_EXPORT_ROWS}`, {
        count: total,
        limit: MAX_EXPORT_ROWS,
      });
    }
    return ids;
  }

  private async related(
    keys: readonly ExportableProductColumn[],
    ids: readonly number[],
    tx: Tx,
  ): Promise<Related> {
    const needs = new Set(keys.map((key) => SOURCES[key]));
    const prices = needs.has('prices') ? await this.prices.currentOf(ids, tx) : [];
    const locations = needs.has('locations') ? await this.locations.ofProductIds(ids, tx) : [];
    const suppliers = needs.has('suppliers') ? await this.suppliers.ofProductIds(ids, tx) : [];
    return {
      prices: new Map(prices.map((terms) => [terms.productId, terms])),
      locations: byProduct(locations),
      suppliers: byProduct(suppliers),
    };
  }
}

function rowOf(
  keys: readonly ExportableProductColumn[],
  item: ProductListItem,
  related: Related,
  names: Names,
): ExcelRow {
  const others = item.units.filter((unit) => !unit.isBase);
  const terms = related.prices.get(item.id);
  const locations = related.locations.get(item.id) ?? [];
  const home = locations.find((location) => location.isHome);
  const cells: Record<ExportableProductColumn, string | null> = {
    sku: item.sku,
    name: item.name,
    category: names.categoryPath.get(item.categoryId) ?? null,
    baseUnit: item.baseUnit.uomName,
    units: listed(
      others.map((unit) =>
        fill(mn.catalog.units.factorOf, {
          unit: unit.uomName,
          factor: unit.factorToBase.toFixed(),
          base: item.baseUnit.uomName,
        }),
      ),
    ),
    warehousePrice: terms ? terms.warehousePrice.toFixed() : null,
    priceProfile: terms && terms.profileName !== '' ? terms.profileName : null,
    baseBarcodes: listed(item.units.find((unit) => unit.isBase)?.barcodes ?? []),
    unitBarcodes: listed(
      others.flatMap((unit) =>
        unit.barcodes.map((code) =>
          fill(mn.catalog.products.unitBarcode, { code, unit: unit.uomName }),
        ),
      ),
    ),
    weight: item.weightKg ? item.weightKg.toFixed() : null,
    homeWarehouse: home ? (names.warehouse.get(home.warehouseId) ?? null) : null,
    fixedBins: listed(
      locations.flatMap((location) =>
        location.defaultBinCode
          ? [
              fill(mn.catalog.products.fixedBin, {
                warehouse: names.warehouse.get(location.warehouseId) ?? '',
                bin: location.defaultBinCode,
              }),
            ]
          : [],
      ),
    ),
    // Every supplier, the main one first.
    supplier: listed((related.suppliers.get(item.id) ?? []).map((link) => link.supplier.name)),
    status: mn.catalog.products.status[productStage(item)],
  };
  return keys.map((key) => cells[key]);
}

/** Values in one cell, or an empty cell when there are none. */
function listed(values: readonly string[]): string | null {
  return values.length === 0 ? null : values.join(SEPARATOR);
}

/** An mn.json message with its {{placeholders}} filled. */
function fill(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params[name] ?? '');
}

function byProduct<T extends { productId: number }>(rows: readonly T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const list = map.get(row.productId);
    if (list) list.push(row);
    else map.set(row.productId, [row]);
  }
  return map;
}
