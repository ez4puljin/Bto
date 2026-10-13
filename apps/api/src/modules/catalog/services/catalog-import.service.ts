import { Inject, Injectable } from '@nestjs/common';
import { type ClassifiedBarcode, classifyBarcode } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import { normalizeName, searchKeys } from '@tugeel/shared/text';
import { isExactFactor } from '@tugeel/shared/units';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { categories, productBarcodes, products, productUnits, uoms, type VatType } from '../schema';
import { type Product, type ProductPatch, ProductsService } from './products.service';
import { invalid } from './support';

/** Rows per multi-row statement (bind parameters stay far below the 65,535 limit). */
const CHUNK = 1_000;

export interface CatalogReference {
  categories: { id: number; parentId: number | null; name: string; nameKey: string }[];
  uoms: { id: number; code: string | null; name: string; nameKey: string; fractional: boolean }[];
}

/** A product as the importer compares it: fields, current units and their barcodes. */
export interface ImportProduct {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  vatType: VatType;
  weightKg: Decimal | null;
  status: Product['status'];
  units: {
    id: number;
    uomId: number;
    factorToBase: Decimal;
    isBase: boolean;
    barcodes: { id: number; code: string; lookupKey: string }[];
  }[];
}

export interface BulkProductInput {
  sku: string;
  name: string;
  categoryId: number;
  vatType: VatType;
  weightKg: Decimal | null;
  baseUomId: number;
  baseBarcodes: readonly string[];
  /** A second unit (a box of `factorToBase` base units) with its barcodes. */
  box: { uomId: number; factorToBase: Decimal; barcodes: readonly string[] } | null;
}

export interface CreatedProduct {
  productId: number;
  baseUnitId: number;
  boxUnitId: number | null;
}

/**
 * Bulk reads and writes for the Excel import (ADR-0036): references and products are read in a few
 * statements, and a file's new products are written with multi-row inserts and one audit row each,
 * never with per-product locks. Single-product edits go through ProductsService and UnitsService.
 */
@Injectable()
export class CatalogImportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
  ) {}

  /** Every category and unit of measure (a few hundred rows each). */
  async reference(executor: Db | Tx = this.db): Promise<CatalogReference> {
    return {
      categories: await executor
        .select({
          id: categories.id,
          parentId: categories.parentId,
          name: categories.name,
          nameKey: categories.nameKey,
        })
        .from(categories)
        .orderBy(asc(categories.id)),
      uoms: await executor
        .select({
          id: uoms.id,
          code: uoms.code,
          name: uoms.name,
          nameKey: uoms.nameKey,
          fractional: uoms.fractional,
        })
        .from(uoms)
        .orderBy(asc(uoms.id)),
    };
  }

  /** Products by SKU with their current units and barcodes. */
  async productsBySku(
    skus: readonly string[],
    executor: Db | Tx = this.db,
  ): Promise<ImportProduct[]> {
    const found: ImportProduct[] = [];
    const unique = [...new Set(skus)];
    for (let start = 0; start < unique.length; start += CHUNK) {
      const rows = await executor
        .select()
        .from(products)
        .where(inArray(products.sku, unique.slice(start, start + CHUNK)));
      found.push(...(await this.withUnits(rows, executor)));
    }
    return found;
  }

  /** Products by id with their current units and barcodes (an import revert). */
  async productsByIds(
    ids: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<ImportProduct[]> {
    const found: ImportProduct[] = [];
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += CHUNK) {
      const rows = await executor
        .select()
        .from(products)
        .where(inArray(products.id, unique.slice(start, start + CHUNK)));
      found.push(...(await this.withUnits(rows, executor)));
    }
    return found;
  }

  /** Lookup key → the product holding it (any unit, current or not). */
  async barcodeOwners(
    lookupKeys: readonly string[],
    executor: Db | Tx = this.db,
  ): Promise<Map<string, { productId: number; sku: string }>> {
    const owners = new Map<string, { productId: number; sku: string }>();
    const unique = [...new Set(lookupKeys)];
    for (let start = 0; start < unique.length; start += CHUNK) {
      const rows = await executor
        .select({
          lookupKey: productBarcodes.lookupKey,
          productId: products.id,
          sku: products.sku,
        })
        .from(productBarcodes)
        .innerJoin(productUnits, eq(productUnits.id, productBarcodes.productUnitId))
        .innerJoin(products, eq(products.id, productUnits.productId))
        .where(inArray(productBarcodes.lookupKey, unique.slice(start, start + CHUNK)));
      for (const row of rows) owners.set(row.lookupKey, { productId: row.productId, sku: row.sku });
    }
    return owners;
  }

  /**
   * New products with their base unit, an optional box unit and barcodes, in the caller's
   * transaction: multi-row inserts in chunks and one audit row per product. A taken SKU or barcode
   * fails the statement (the caller validated the file first). Returns the ids by SKU.
   */
  async createManyInTx(
    tx: Tx,
    actor: Actor,
    inputs: readonly BulkProductInput[],
  ): Promise<Map<string, CreatedProduct>> {
    const created = new Map<string, CreatedProduct>();
    if (inputs.length === 0) return created;
    await this.assertReferences(tx, inputs);
    for (let start = 0; start < inputs.length; start += CHUNK) {
      const part = inputs.slice(start, start + CHUNK);
      const rows = await tx
        .insert(products)
        .values(
          part.map((input) => {
            const name = normalizeName(input.name);
            const keys = searchKeys(name, [input.sku]);
            return {
              sku: input.sku,
              name,
              searchText: keys.strict,
              searchPhonetic: keys.phonetic,
              searchVersion: keys.version,
              categoryId: input.categoryId,
              vatType: input.vatType,
              weightKg: input.weightKg,
            };
          }),
        )
        .returning({ id: products.id, sku: products.sku });
      const idOf = new Map(rows.map((row) => [row.sku, row.id]));
      const productId = (sku: string) => {
        const id = idOf.get(sku);
        if (id === undefined) throw new Error(`product ${sku} was not inserted`);
        return id;
      };
      const bases = await tx
        .insert(productUnits)
        .values(
          part.map((input) => ({
            productId: productId(input.sku),
            uomId: input.baseUomId,
            factorToBase: new Decimal(1),
            isBase: true,
            isDefaultSales: true,
            isDefaultPurchase: true,
          })),
        )
        .returning({ id: productUnits.id, productId: productUnits.productId });
      const boxed = part.filter((input) => input.box !== null);
      const boxes =
        boxed.length === 0
          ? []
          : await tx
              .insert(productUnits)
              .values(
                boxed.map((input) => ({
                  productId: productId(input.sku),
                  uomId: input.box?.uomId ?? 0,
                  factorToBase: input.box?.factorToBase ?? new Decimal(0),
                })),
              )
              .returning({ id: productUnits.id, productId: productUnits.productId });
      const baseOf = new Map(bases.map((row) => [row.productId, row.id]));
      const boxOf = new Map(boxes.map((row) => [row.productId, row.id]));
      const barcodes: (typeof productBarcodes.$inferInsert)[] = [];
      for (const input of part) {
        const id = productId(input.sku);
        const baseUnitId = baseOf.get(id);
        if (baseUnitId === undefined) throw new Error(`product ${input.sku} has no base unit`);
        const boxUnitId = boxOf.get(id) ?? null;
        created.set(input.sku, { productId: id, baseUnitId, boxUnitId });
        barcodes.push(...barcodeRows(baseUnitId, input.baseBarcodes));
        if (boxUnitId !== null) barcodes.push(...barcodeRows(boxUnitId, input.box?.barcodes ?? []));
      }
      for (let at = 0; at < barcodes.length; at += CHUNK) {
        await tx.insert(productBarcodes).values(barcodes.slice(at, at + CHUNK));
      }
      await this.audit.recordMany(
        tx,
        actor,
        part.map((input) => ({
          action: 'CREATE',
          entity: 'products',
          entityId: productId(input.sku),
          after: {
            sku: input.sku,
            name: normalizeName(input.name),
            categoryId: input.categoryId,
            vatType: input.vatType,
            weightKg: input.weightKg,
            baseUomId: input.baseUomId,
            baseBarcodes: input.baseBarcodes,
            box: input.box,
          },
        })),
      );
    }
    return created;
  }

  /**
   * Locks existing products in id order before an import changes them one by one: every writer
   * of several products (the price clerk's completion among them) locks in this order, so they
   * wait for each other instead of deadlocking (architecture §5.3).
   */
  async lockManyInTx(tx: Tx, productIds: readonly number[]): Promise<void> {
    const ids = [...new Set(productIds)].sort((a, b) => a - b);
    for (let start = 0; start < ids.length; start += CHUNK) {
      await tx
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, ids.slice(start, start + CHUNK)))
        .orderBy(asc(products.id))
        .for('update');
    }
  }

  /** Changes one product's fields (ProductsService.updateInTx); returns the row before. */
  updateProductInTx(tx: Tx, actor: Actor, id: number, patch: ProductPatch): Promise<Product> {
    return this.products.updateInTx(tx, actor, id, patch);
  }

  /**
   * Takes back products an import created (ADR-0036 #7): they become INACTIVE, wait for their
   * prices again if they are ever re-imported (ADR-0044) and their barcodes are released. The
   * caller checks first that they hold no stock.
   */
  async deactivateManyInTx(tx: Tx, actor: Actor, productIds: readonly number[]): Promise<void> {
    for (let start = 0; start < productIds.length; start += CHUNK) {
      const part = productIds.slice(start, start + CHUNK);
      const before = await tx
        .select({ id: products.id, status: products.status })
        .from(products)
        .where(inArray(products.id, part))
        .orderBy(asc(products.id))
        .for('update');
      const released = await tx
        .select({ productId: productUnits.productId, code: productBarcodes.code })
        .from(productBarcodes)
        .innerJoin(productUnits, eq(productUnits.id, productBarcodes.productUnitId))
        .where(inArray(productUnits.productId, part))
        .orderBy(asc(productBarcodes.id));
      await tx
        .update(products)
        .set({ status: 'INACTIVE', saleReadyAt: null, updatedAt: sql`now()` })
        .where(inArray(products.id, part));
      await tx
        .delete(productBarcodes)
        .where(
          inArray(
            productBarcodes.productUnitId,
            tx
              .select({ id: productUnits.id })
              .from(productUnits)
              .where(inArray(productUnits.productId, part)),
          ),
        );
      const codes = new Map<number, string[]>();
      for (const row of released) {
        const list = codes.get(row.productId) ?? [];
        list.push(row.code);
        codes.set(row.productId, list);
      }
      await this.audit.recordMany(
        tx,
        actor,
        before.map((row) => ({
          action: 'UPDATE',
          entity: 'products',
          entityId: row.id,
          before: { status: row.status, barcodes: codes.get(row.id) ?? [] },
          after: { status: 'INACTIVE', barcodes: [] },
        })),
      );
    }
  }

  /** Current units and their barcodes of up to one chunk of products. */
  private async withUnits(rows: Product[], executor: Db | Tx): Promise<ImportProduct[]> {
    if (rows.length === 0) return [];
    const units = await executor
      .select()
      .from(productUnits)
      .where(
        and(
          inArray(
            productUnits.productId,
            rows.map((row) => row.id),
          ),
          isNull(productUnits.supersededAt),
        ),
      )
      .orderBy(asc(productUnits.id));
    const codes = new Map<number, { id: number; code: string; lookupKey: string }[]>();
    if (units.length > 0) {
      const barcodeRows = await executor
        .select({
          id: productBarcodes.id,
          unitId: productBarcodes.productUnitId,
          code: productBarcodes.code,
          lookupKey: productBarcodes.lookupKey,
        })
        .from(productBarcodes)
        .where(
          inArray(
            productBarcodes.productUnitId,
            units.map((unit) => unit.id),
          ),
        )
        .orderBy(asc(productBarcodes.id));
      for (const { unitId, ...code } of barcodeRows) {
        codes.set(unitId, [...(codes.get(unitId) ?? []), code]);
      }
    }
    const unitsOf = new Map<number, ImportProduct['units']>();
    for (const unit of units) {
      unitsOf.set(unit.productId, [
        ...(unitsOf.get(unit.productId) ?? []),
        {
          id: unit.id,
          uomId: unit.uomId,
          factorToBase: unit.factorToBase,
          isBase: unit.isBase,
          barcodes: codes.get(unit.id) ?? [],
        },
      ]);
    }
    return rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      categoryId: row.categoryId,
      vatType: row.vatType,
      weightKg: row.weightKg,
      status: row.status,
      units: unitsOf.get(row.id) ?? [],
    }));
  }

  /** Every referenced category and unit of measure exists; box factors are exact. */
  private async assertReferences(tx: Tx, inputs: readonly BulkProductInput[]): Promise<void> {
    const categoryIds = [...new Set(inputs.map((input) => input.categoryId))];
    const foundCategories = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, categoryIds));
    if (foundCategories.length !== categoryIds.length) {
      throw invalid('categoryId', 'exists', 'unknown category');
    }
    const uomIds = [
      ...new Set(
        inputs.flatMap((input) => [input.baseUomId, ...(input.box ? [input.box.uomId] : [])]),
      ),
    ];
    const fractional = new Map(
      (
        await tx
          .select({ id: uoms.id, fractional: uoms.fractional })
          .from(uoms)
          .where(inArray(uoms.id, uomIds))
      ).map((row) => [row.id, row.fractional]),
    );
    if (fractional.size !== uomIds.length) throw invalid('uomId', 'exists', 'unknown unit');
    for (const input of inputs) {
      const baseFractional = fractional.get(input.baseUomId) ?? false;
      if (input.box && !isExactFactor(input.box.factorToBase, baseFractional)) {
        throw new AppError('UNIT_FACTOR_INEXACT', `factor of ${input.sku} is not exact`, {
          path: 'box.factorToBase',
        });
      }
    }
  }
}

/** Barcode rows of one unit, the first one primary; an unreadable code fails the import. */
function barcodeRows(unitId: number, codes: readonly string[]) {
  return codes.map((input, index) => {
    const classified = classifyBarcode(input);
    if (!classified.ok) {
      throw new AppError('BARCODE_INVALID', `barcode rejected: ${classified.problem}`, {
        problem: classified.problem,
      });
    }
    const value: ClassifiedBarcode = classified.value;
    return {
      productUnitId: unitId,
      code: value.code,
      gtin14: value.gtin14,
      lookupKey: value.lookupKey,
      barcodeType: value.barcodeType,
      isPrimary: index === 0,
    };
  });
}
