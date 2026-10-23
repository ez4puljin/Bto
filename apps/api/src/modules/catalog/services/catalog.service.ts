import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { productBarcodes, products, productUnits, uoms, type VatType } from '../schema';
import {
  type ProductDetail,
  type ProductQuery,
  ProductsService,
  type ProductSummary,
} from './products.service';

/** A product the store edge may sell (ADR-0067): its current units and their barcode lookup keys. */
export interface PosCatalogueProduct {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  vatType: VatType;
  cityTax: boolean | null;
  units: {
    unitId: number;
    uomId: number;
    uomName: string;
    factor: Decimal;
    isBase: boolean;
    barcodes: string[];
    /** The same barcodes as printed (ADR-0104: shown at the till). */
    codes: string[];
  }[];
}

/** Rows per `IN (…)` list, well under PostgreSQL's 65,535 bind parameters. */
const IN_CHUNK = 10_000;

/** Read access to products for other modules (docs/architecture.md §4 catalog row). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly products: ProductsService,
  ) {}

  get(id: number, executor: Db | Tx = this.db): Promise<ProductDetail> {
    return this.products.get(id, executor);
  }

  async getMany(ids: readonly number[], executor: Db | Tx = this.db): Promise<ProductSummary[]> {
    if (ids.length === 0) return [];
    const rows = await executor
      .select()
      .from(products)
      .where(inArray(products.id, [...ids]));
    return this.products.summaries(rows, executor);
  }

  /**
   * Every active product that is ready for sale, with its current units, their unit-of-measure names
   * and barcode lookup keys: the store edge's catalogue (ADR-0067). A few queries whatever the count.
   */
  async posCatalogue(executor: Db | Tx = this.db): Promise<PosCatalogueProduct[]> {
    const rows = await executor
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        categoryId: products.categoryId,
        vatType: products.vatType,
        cityTax: products.cityTax,
      })
      .from(products)
      .where(and(eq(products.status, 'ACTIVE'), isNotNull(products.saleReadyAt)))
      .orderBy(asc(products.id));
    const byProduct = new Map<number, PosCatalogueProduct>(
      rows.map((row) => [row.id, { ...row, units: [] }]),
    );
    const ids = rows.map((row) => row.id);
    const unitRows: {
      unitId: number;
      productId: number;
      uomId: number;
      uomName: string;
      factor: Decimal;
      isBase: boolean;
    }[] = [];
    for (let at = 0; at < ids.length; at += IN_CHUNK) {
      unitRows.push(
        ...(await executor
          .select({
            unitId: productUnits.id,
            productId: productUnits.productId,
            uomId: productUnits.uomId,
            uomName: uoms.name,
            factor: productUnits.factorToBase,
            isBase: productUnits.isBase,
          })
          .from(productUnits)
          .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
          .where(
            and(
              inArray(productUnits.productId, ids.slice(at, at + IN_CHUNK)),
              isNull(productUnits.supersededAt),
            ),
          )
          .orderBy(asc(productUnits.productId), asc(productUnits.id))),
      );
    }
    const codes = new Map<number, string[]>();
    const printed = new Map<number, string[]>();
    const unitIds = unitRows.map((unit) => unit.unitId);
    for (let at = 0; at < unitIds.length; at += IN_CHUNK) {
      const barcodeRows = await executor
        .select({
          unitId: productBarcodes.productUnitId,
          code: productBarcodes.code,
          lookupKey: productBarcodes.lookupKey,
        })
        .from(productBarcodes)
        .where(inArray(productBarcodes.productUnitId, unitIds.slice(at, at + IN_CHUNK)))
        .orderBy(asc(productBarcodes.id));
      for (const row of barcodeRows) {
        codes.set(row.unitId, [...(codes.get(row.unitId) ?? []), row.lookupKey]);
        printed.set(row.unitId, [...(printed.get(row.unitId) ?? []), row.code]);
      }
    }
    for (const unit of unitRows) {
      byProduct.get(unit.productId)?.units.push({
        unitId: unit.unitId,
        uomId: unit.uomId,
        uomName: unit.uomName,
        factor: unit.factor,
        isBase: unit.isBase,
        barcodes: codes.get(unit.unitId) ?? [],
        codes: printed.get(unit.unitId) ?? [],
      });
    }
    return [...byProduct.values()];
  }

  search(query: ProductQuery) {
    return this.products.list(query);
  }

  /** Active products waiting for their prices (ADR-0044), counted up to `cap` (ADR-0047 #7). */
  async countWaitingForPrices(cap: number): Promise<number> {
    const rows = await this.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.status, 'ACTIVE'), isNull(products.saleReadyAt)))
      .limit(cap);
    return rows.length;
  }
}
