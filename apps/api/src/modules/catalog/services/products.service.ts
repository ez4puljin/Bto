import { Inject, Injectable } from '@nestjs/common';
import { classifyBarcode, lookupCandidates } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import { normalizeName, queryTerms, searchKeys, termPattern } from '@tugeel/shared/text';
import { isExactFactor } from '@tugeel/shared/units';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { idIn } from '../../../common/db/days';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  invalidCursor,
  toPage,
} from '../../../common/pagination/page';
import { type Actor, AuditService, StorageService } from '../../identity';
import {
  categories,
  PRODUCT_STATUSES,
  productBarcodes,
  productImages,
  products,
  productUnits,
  uoms,
  type VatType,
} from '../schema';
import { type Barcode, BarcodeService } from './barcode.service';
import { SkuRangesService } from './sku-ranges.service';
import { escapeLike, invalid, notFound } from './support';

export type Product = typeof products.$inferSelect;
export type ProductUnit = typeof productUnits.$inferSelect;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface UnitView extends ProductUnit {
  uomName: string;
  uomCode: string | null;
  fractional: boolean;
  /** The unit's e-Barimt measure unit, falling back to its unit of measure's default. */
  effectiveMeasureUnit: string | null;
  barcodes: Barcode[];
}

export interface ImageView {
  id: number;
  url: string | null;
  thumbUrl: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ProductDetail extends Product {
  units: UnitView[];
  images: ImageView[];
}

export interface ProductSummary {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  status: ProductStatus;
  /** NULL while the product waits for its prices (ADR-0044). */
  saleReadyAt: Date | null;
  vatType: VatType;
  cityTax: boolean | null;
  baseUnit: { id: number; uomId: number; uomName: string };
  thumbUrl: string | null;
}

/** A current unit on the product list: base first, then by factor. */
export interface ProductListUnit {
  id: number;
  uomId: number;
  uomName: string;
  factorToBase: Decimal;
  isBase: boolean;
  /** The primary barcode first. */
  barcodes: string[];
}

/** A row of the product list screen (ADR-0037). */
export interface ProductListItem extends ProductSummary {
  weightKg: Decimal | null;
  classificationCode: string | null;
  taxProductCode: string | null;
  units: ProductListUnit[];
}

export interface BarcodeResolution {
  product: ProductSummary;
  unit: { id: number; uomId: number; uomName: string; factorToBase: Decimal; isBase: boolean };
  barcode: Barcode;
}

export interface NewUnitInput {
  uomId: number;
  factorToBase: Decimal;
  isDefaultSales?: boolean;
  isDefaultPurchase?: boolean;
  measureUnit?: string | null;
  barcodes?: string[];
}

export interface ProductInput {
  sku?: string;
  name: string;
  categoryId: number;
  vatType?: VatType;
  cityTax?: boolean | null;
  classificationCode?: string | null;
  taxProductCode?: string | null;
  weightKg?: Decimal | null;
  baseUomId: number;
  baseMeasureUnit?: string | null;
  baseBarcodes?: string[];
  units?: NewUnitInput[];
}

export interface ProductPatch {
  sku?: string;
  name?: string;
  categoryId?: number;
  vatType?: VatType;
  cityTax?: boolean | null;
  classificationCode?: string | null;
  taxProductCode?: string | null;
  weightKg?: Decimal | null;
  status?: ProductStatus;
}

export interface ProductQuery {
  q?: string;
  categoryId?: number;
  status?: ProductStatus;
  /** true: completed products; false: those waiting for prices (ADR-0044). */
  saleReady?: boolean;
  /**
   * After the search rank: NAME (the default) by name, then id; NEW the sale-ready products, the
   * latest to become sale-ready first, then the higher id (the rep app's shop, ADR-0066).
   */
  sort?: ProductSort;
  cursor?: string;
  limit?: number;
}

export type ProductSort = 'NAME' | 'NEW';

/** A cell of a product's image list: the picture and its thumbnail, relative to the server. */
export interface ProductImageUrls {
  url: string;
  thumbUrl: string | null;
}

/** What the rep app reads of a current unit beside the list's columns (ADR-0066). */
export interface UnitFlags {
  uomCode: string | null;
  isDefaultSales: boolean;
}

/** Products with their units, barcodes and images (SPEC §5.2, ADR-0008, ADR-0028). */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly barcodes: BarcodeService,
    private readonly ranges: SkuRangesService,
  ) {}

  create(actor: Actor, input: ProductInput): Promise<ProductDetail> {
    return inTransaction(this.db, (tx) => this.createInTx(tx, actor, input));
  }

  /**
   * A new product with its units and barcodes in the caller's transaction (a registration,
   * ADR-0044 #5); it waits for its prices until the price clerk completes it.
   */
  async createInTx(tx: Tx, actor: Actor, input: ProductInput): Promise<ProductDetail> {
    await this.assertReferences(tx, input);
    const baseUom = await this.uom(tx, input.baseUomId, 'baseUomId');
    const extra = input.units ?? [];
    await this.assertUnits(tx, baseUom, extra);
    // A typed code keeps to the category's range (ADR-0044 #1); an omitted one is suggested.
    if (input.sku !== undefined) await this.ranges.assertAllowed(tx, input.categoryId, input.sku);
    const sku = input.sku ?? (await this.ranges.suggest(input.categoryId, tx));
    const name = normalizeName(input.name);
    const keys = searchKeys(name, [sku]);
    const [product] = await tx
      .insert(products)
      .values({
        sku,
        name,
        searchText: keys.strict,
        searchPhonetic: keys.phonetic,
        searchVersion: keys.version,
        categoryId: input.categoryId,
        vatType: input.vatType ?? 'VAT_ABLE',
        cityTax: input.cityTax ?? null,
        classificationCode: input.classificationCode ?? null,
        taxProductCode: input.taxProductCode ?? null,
        weightKg: input.weightKg ?? null,
      })
      .returning();
    if (!product) throw new Error('product insert returned no row');
    const [base] = await tx
      .insert(productUnits)
      .values({
        productId: product.id,
        uomId: baseUom.id,
        factorToBase: new Decimal(1),
        isBase: true,
        isDefaultSales: !extra.some((unit) => unit.isDefaultSales),
        isDefaultPurchase: !extra.some((unit) => unit.isDefaultPurchase),
        measureUnit: input.baseMeasureUnit ?? null,
      })
      .returning();
    if (!base) throw new Error('base unit insert returned no row');
    for (const code of input.baseBarcodes ?? [])
      await this.barcodes.addInTx(tx, actor, base.id, code);
    for (const unit of extra) {
      const [row] = await tx
        .insert(productUnits)
        .values({
          productId: product.id,
          uomId: unit.uomId,
          factorToBase: unit.factorToBase,
          isDefaultSales: unit.isDefaultSales ?? false,
          isDefaultPurchase: unit.isDefaultPurchase ?? false,
          measureUnit: unit.measureUnit ?? null,
        })
        .returning();
      if (!row) throw new Error('unit insert returned no row');
      for (const code of unit.barcodes ?? []) await this.barcodes.addInTx(tx, actor, row.id, code);
    }
    const created = await this.get(product.id, tx);
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'products',
      entityId: product.id,
      after: auditView(created),
    });
    return created;
  }

  update(actor: Actor, id: number, patch: ProductPatch): Promise<ProductDetail> {
    return inTransaction(this.db, async (tx) => {
      await this.updateInTx(tx, actor, id, patch);
      return this.get(id, tx);
    });
  }

  /** Changes a product's fields in the caller's transaction; returns the row before the change. */
  async updateInTx(tx: Tx, actor: Actor, id: number, patch: ProductPatch): Promise<Product> {
    const [before] = await tx.select().from(products).where(eq(products.id, id)).for('update');
    if (!before) throw notFound('product', id);
    await this.assertReferences(tx, patch);
    // Only a changed code is checked: old codes outside a range stay editable (ADR-0044 #1).
    if (patch.sku !== undefined && patch.sku !== before.sku) {
      await this.ranges.assertAllowed(tx, patch.categoryId ?? before.categoryId, patch.sku, id);
    }
    const name = patch.name === undefined ? before.name : normalizeName(patch.name);
    const sku = patch.sku ?? before.sku;
    const keys = searchKeys(name, [sku]);
    const [after] = await tx
      .update(products)
      .set({
        sku,
        name,
        searchText: keys.strict,
        searchPhonetic: keys.phonetic,
        searchVersion: keys.version,
        ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
        ...(patch.vatType === undefined ? {} : { vatType: patch.vatType }),
        ...(patch.cityTax === undefined ? {} : { cityTax: patch.cityTax }),
        ...(patch.classificationCode === undefined
          ? {}
          : { classificationCode: patch.classificationCode }),
        ...(patch.taxProductCode === undefined ? {} : { taxProductCode: patch.taxProductCode }),
        ...(patch.weightKg === undefined ? {} : { weightKg: patch.weightKg }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        updatedAt: sql`now()`,
      })
      .where(eq(products.id, id))
      .returning();
    if (!after) throw notFound('product', id);
    await this.audit.record(tx, actor, {
      action: 'UPDATE',
      entity: 'products',
      entityId: id,
      before,
      after,
    });
    return before;
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<ProductDetail> {
    const [product] = await executor.select().from(products).where(eq(products.id, id));
    if (!product) throw notFound('product', id);
    const unitRows = await executor
      .select({ unit: productUnits, uom: uoms })
      .from(productUnits)
      .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
      .where(eq(productUnits.productId, id))
      .orderBy(
        sql`${productUnits.supersededAt} IS NOT NULL`,
        desc(productUnits.isBase),
        asc(productUnits.factorToBase),
        asc(productUnits.id),
      );
    const barcodes = await this.barcodes.ofUnits(
      unitRows.map((row) => row.unit.id),
      executor,
    );
    const images = await executor
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.id));
    const urls = await this.storage.publicUrls(
      images.flatMap((image) => [image.imageFileId, image.thumbFileId]),
      executor,
    );
    return {
      ...product,
      units: unitRows.map(({ unit, uom }) => ({
        ...unit,
        uomName: uom.name,
        uomCode: uom.code,
        fractional: uom.fractional,
        effectiveMeasureUnit: unit.measureUnit ?? uom.measureUnit,
        barcodes: barcodes.filter((barcode) => barcode.productUnitId === unit.id),
      })),
      images: images.map((image) => ({
        id: image.id,
        url: urls.get(image.imageFileId) ?? null,
        thumbUrl: urls.get(image.thumbFileId) ?? null,
        isPrimary: image.isPrimary,
        sortOrder: image.sortOrder,
      })),
    };
  }

  /**
   * Keyset list. Without `q`: by name, then id. With `q`: every word must match a search key
   * (ADR-0028); exact SKU or barcode hits rank first, then strict matches, then phonetic ones.
   */
  async list(query: ProductQuery): Promise<{ data: ProductSummary[]; nextCursor: string | null }> {
    const page = await this.pageRows(query);
    return { data: await this.summaries(page.data), nextCursor: page.nextCursor };
  }

  /**
   * The product list screen's rows (ADR-0037): the summary plus weight, e-Barimt codes and the
   * current units with their barcodes, read with one statement each for the whole page. `within`
   * narrows the list to a set of products (a segment filter, ADR-0049 #4); null: no narrowing.
   */
  async listItems(
    query: ProductQuery,
    within: readonly number[] | null = null,
  ): Promise<{ data: ProductListItem[]; nextCursor: string | null }> {
    if (within?.length === 0) return { data: [], nextCursor: null };
    const page = await this.pageRows(query, within);
    return { data: await this.enrich(page.data), nextCursor: page.nextCursor };
  }

  /** How many products the list's filters keep (the list's total, ADR-0049 #4). */
  async countItems(query: ProductQuery, within: readonly number[] | null = null): Promise<number> {
    if (within?.length === 0) return 0;
    const { filters } = this.filtersOf(query, within);
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(and(...filters));
    return row?.count ?? 0;
  }

  /**
   * The ids the list's filters keep, in the list's order (rank, name, id), at most `cap` of them:
   * the order of a filtered export (ADR-0049 #6).
   */
  async orderedIds(
    query: ProductQuery,
    within: readonly number[] | null,
    cap: number,
    executor: Db | Tx = this.db,
  ): Promise<number[]> {
    if (within?.length === 0) return [];
    const { filters, searched } = this.filtersOf(query, within);
    const rows = await executor
      .select({ id: products.id })
      .from(products)
      .where(and(...filters))
      .orderBy(...this.orderOf(query, searched))
      .limit(cap);
    return rows.map((row) => row.id);
  }

  /**
   * Each product's pictures, the primary first, then as the product page orders them; only those
   * whose file is ready (the rep app's product page, ADR-0066).
   */
  async imagesOf(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, ProductImageUrls[]>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select()
      .from(productImages)
      .where(idIn(productImages.productId, productIds))
      .orderBy(
        asc(productImages.productId),
        desc(productImages.isPrimary),
        asc(productImages.sortOrder),
        asc(productImages.id),
      );
    const urls = await this.storage.publicUrls(
      rows.flatMap((row) => [row.imageFileId, row.thumbFileId]),
      executor,
    );
    const result = new Map<number, ProductImageUrls[]>();
    for (const row of rows) {
      const url = urls.get(row.imageFileId);
      if (!url) continue;
      const list = result.get(row.productId) ?? [];
      list.push({ url, thumbUrl: urls.get(row.thumbFileId) ?? null });
      result.set(row.productId, list);
    }
    return result;
  }

  /**
   * The thumbnail of each product's primary picture, those whose file is ready: the rep app keeps
   * every shop product's once on the phone (ADR-0066).
   */
  async primaryThumbsOf(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, string>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({ productId: productImages.productId, fileId: productImages.thumbFileId })
      .from(productImages)
      .where(and(idIn(productImages.productId, productIds), eq(productImages.isPrimary, true)))
      .orderBy(asc(productImages.productId));
    const urls = await this.storage.publicUrls(
      rows.map((row) => row.fileId),
      executor,
    );
    const result = new Map<number, string>();
    for (const row of rows) {
      const url = urls.get(row.fileId);
      if (url) result.set(row.productId, url);
    }
    return result;
  }

  /** The unit of measure's code and the default-sales flag of these products' current units. */
  async unitFlagsOf(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, UnitFlags>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({
        id: productUnits.id,
        uomCode: uoms.code,
        isDefaultSales: productUnits.isDefaultSales,
      })
      .from(productUnits)
      .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
      .where(and(idIn(productUnits.productId, productIds), isNull(productUnits.supersededAt)));
    return new Map(
      rows.map((row) => [row.id, { uomCode: row.uomCode, isDefaultSales: row.isDefaultSales }]),
    );
  }

  /** List rows of these products, in the order given (an export reads 1,000 at a time). */
  async listItemsOf(
    ids: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<ProductListItem[]> {
    if (ids.length === 0) return [];
    const rows = await executor.select().from(products).where(idIn(products.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return this.enrich(
      ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      }),
      executor,
    );
  }

  /** Rows with their summary, units and barcodes: one statement each for all of them. */
  private async enrich(rows: Product[], executor: Db | Tx = this.db): Promise<ProductListItem[]> {
    const summaries = await this.summaries(rows, executor);
    const ids = rows.map((row) => row.id);
    const units =
      ids.length === 0
        ? []
        : await executor
            .select({
              id: productUnits.id,
              productId: productUnits.productId,
              uomId: uoms.id,
              uomName: uoms.name,
              factorToBase: productUnits.factorToBase,
              isBase: productUnits.isBase,
            })
            .from(productUnits)
            .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
            .where(and(inArray(productUnits.productId, ids), isNull(productUnits.supersededAt)))
            .orderBy(
              asc(productUnits.productId),
              desc(productUnits.isBase),
              asc(productUnits.factorToBase),
              asc(productUnits.id),
            );
    const codes =
      units.length === 0
        ? []
        : await executor
            .select({ unitId: productBarcodes.productUnitId, code: productBarcodes.code })
            .from(productBarcodes)
            .where(
              inArray(
                productBarcodes.productUnitId,
                units.map((unit) => unit.id),
              ),
            )
            .orderBy(desc(productBarcodes.isPrimary), asc(productBarcodes.id));
    const codesOf = new Map<number, string[]>();
    for (const row of codes) {
      const list = codesOf.get(row.unitId) ?? [];
      list.push(row.code);
      codesOf.set(row.unitId, list);
    }
    const unitsOf = new Map<number, ProductListUnit[]>();
    for (const { productId, ...unit } of units) {
      const list = unitsOf.get(productId) ?? [];
      list.push({ ...unit, barcodes: codesOf.get(unit.id) ?? [] });
      unitsOf.set(productId, list);
    }
    const summaryOf = new Map(summaries.map((summary) => [summary.id, summary]));
    return rows.flatMap((row) => {
      const summary = summaryOf.get(row.id);
      return summary
        ? [
            {
              ...summary,
              weightKg: row.weightKg,
              classificationCode: row.classificationCode,
              taxProductCode: row.taxProductCode,
              units: unitsOf.get(row.id) ?? [],
            },
          ]
        : [];
    });
  }

  /**
   * One keyset page of product rows: search rank, then name and id (NAME), or the moment the
   * product became sale-ready and id, both descending (NEW). A NEW cursor carries that moment as
   * PostgreSQL's text, never a JS Date, which would drop the microseconds products made sale-ready
   * together share.
   */
  private async pageRows(
    query: ProductQuery,
    within: readonly number[] | null = null,
  ): Promise<{ data: Product[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const { filters, searched } = this.filtersOf(query, within);
    // Without a search every row ranks 0; a bare 0 in ORDER BY would mean "column 0".
    const rank = searched ?? sql`0`;
    const after = decodeCursor(query.cursor);
    if (query.sort === 'NEW') {
      if (after) {
        if (
          after.s !== 'NEW' ||
          typeof after.id !== 'number' ||
          typeof after.rank !== 'number' ||
          typeof after.t !== 'string'
        ) {
          throw invalidCursor();
        }
        // Every key descending: rank is negated so a smaller rank still comes first.
        filters.push(
          sql`(-(${rank}), ${products.saleReadyAt}, ${products.id}) < (${-after.rank}, ${after.t}::timestamptz, ${after.id})`,
        );
      }
      const rows = await this.db
        .select({
          product: products,
          rank: sql<number>`${rank}`,
          readyAt: sql<string>`${products.saleReadyAt}::text`,
        })
        .from(products)
        .where(and(...filters))
        .orderBy(...this.orderOf(query, searched))
        .limit(limit + 1);
      const page = toPage(rows, limit, (row) => ({
        s: 'NEW',
        rank: row.rank,
        t: row.readyAt,
        id: row.product.id,
      }));
      return { data: page.data.map((row) => row.product), nextCursor: page.nextCursor };
    }
    if (after?.s !== undefined) throw invalidCursor();
    if (typeof after?.id === 'number' && typeof after.rank === 'number') {
      filters.push(
        sql`(${rank}, ${products.name}, ${products.id}) > (${after.rank}, (SELECT name FROM ${products} WHERE id = ${after.id}), ${after.id})`,
      );
    }
    const rows = await this.db
      .select({ product: products, rank: sql<number>`${rank}` })
      .from(products)
      .where(and(...filters))
      .orderBy(...this.orderOf(query, searched))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.product.id, rank: row.rank }));
    return { data: page.data.map((row) => row.product), nextCursor: page.nextCursor };
  }

  /** The list's order: the search rank first, then the sort's keys. */
  private orderOf(query: ProductQuery, searched: SQL | null): SQL[] {
    const keys =
      query.sort === 'NEW'
        ? [desc(products.saleReadyAt), desc(products.id)]
        : [asc(products.name), asc(products.id)];
    return [...(searched ? [searched] : []), ...keys];
  }

  /**
   * The list's conditions — status, stage, category subtree, a set of products (one array
   * parameter, not one per id), the search — and the search's rank expression.
   */
  private filtersOf(
    query: ProductQuery,
    within: readonly number[] | null,
  ): { filters: SQL[]; searched: SQL | null } {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(products.status, query.status));
    if (query.saleReady !== undefined) {
      filters.push(
        query.saleReady ? isNotNull(products.saleReadyAt) : isNull(products.saleReadyAt),
      );
    }
    // NEW orders by the moment of becoming sale-ready: a row without one has no place in it (and a
    // row comparison against NULL would drop rows from the keyset).
    if (query.sort === 'NEW') filters.push(isNotNull(products.saleReadyAt));
    if (query.categoryId !== undefined) {
      filters.push(sql`${products.categoryId} IN (
        WITH RECURSIVE down(id) AS (
          SELECT id FROM ${categories} WHERE id = ${query.categoryId}
          UNION ALL
          SELECT c.id FROM ${categories} c JOIN down ON c.parent_id = down.id
        )
        SELECT id FROM down)`);
    }
    if (within) filters.push(idIn(products.id, within));
    const search = productSearch(query.q);
    if (search) filters.push(search.match);
    return { filters, searched: search?.rank ?? null };
  }

  /**
   * The product and current unit a scanned code belongs to (SPEC §5.2): GTIN-8/12/13/14 forms are
   * normalised first; superseded and retired units never answer (ADR-0029).
   */
  async resolveBarcode(code: string): Promise<BarcodeResolution> {
    const classified = classifyBarcode(code);
    if (!classified.ok || lookupCandidates(code).length === 0) {
      throw new AppError('BARCODE_INVALID', 'barcode cannot be read', {
        problem: classified.ok ? 'CHECK_DIGIT' : classified.problem,
      });
    }
    const hits = await this.barcodes.lookup(code);
    const [hit] = hits;
    if (!hit) throw new AppError('NOT_FOUND', 'no product has this barcode');
    if (new Set(hits.map((row) => row.productId)).size > 1) {
      throw new AppError('BARCODE_AMBIGUOUS', 'barcode matches several products', {
        count: hits.length,
      });
    }
    const [product] = await this.db.select().from(products).where(eq(products.id, hit.productId));
    if (!product) throw notFound('product', hit.productId);
    const [summary] = await this.summaries([product]);
    const [unit] = await this.db
      .select({
        id: productUnits.id,
        uomId: productUnits.uomId,
        uomName: uoms.name,
        factorToBase: productUnits.factorToBase,
        isBase: productUnits.isBase,
      })
      .from(productUnits)
      .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
      .where(eq(productUnits.id, hit.unitId));
    if (!summary || !unit) throw notFound('product unit', hit.unitId);
    return { product: summary, unit, barcode: hit.barcode };
  }

  async summaries(rows: Product[], executor: Db | Tx = this.db): Promise<ProductSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const bases = await executor
      .select({
        productId: productUnits.productId,
        id: productUnits.id,
        uomId: uoms.id,
        uomName: uoms.name,
      })
      .from(productUnits)
      .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
      .where(and(inArray(productUnits.productId, ids), eq(productUnits.isBase, true)));
    const primaries = await executor
      .select({ productId: productImages.productId, fileId: productImages.thumbFileId })
      .from(productImages)
      .where(and(inArray(productImages.productId, ids), eq(productImages.isPrimary, true)));
    const urls = await this.storage.publicUrls(
      primaries.map((image) => image.fileId),
      executor,
    );
    const baseOf = new Map(bases.map((unit) => [unit.productId, unit]));
    const thumbOf = new Map(primaries.map((image) => [image.productId, image]));
    return rows.map((row) => {
      const base = baseOf.get(row.id);
      if (!base) throw new Error(`product ${row.id} has no base unit`);
      const thumb = thumbOf.get(row.id);
      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        categoryId: row.categoryId,
        status: row.status,
        saleReadyAt: row.saleReadyAt,
        vatType: row.vatType,
        cityTax: row.cityTax,
        baseUnit: { id: base.id, uomId: base.uomId, uomName: base.uomName },
        thumbUrl: thumb ? (urls.get(thumb.fileId) ?? null) : null,
      };
    });
  }

  private async assertReferences(tx: Tx, input: { categoryId?: number }): Promise<void> {
    if (input.categoryId !== undefined) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, input.categoryId));
      if (!category)
        throw invalid('categoryId', 'exists', `category ${input.categoryId} not found`);
    }
  }

  async uom(tx: Db | Tx, id: number, path: string) {
    const [row] = await tx.select().from(uoms).where(eq(uoms.id, id));
    if (!row) throw invalid(path, 'exists', `unit of measure ${id} not found`);
    return row;
  }

  private async assertUnits(
    tx: Tx,
    baseUom: typeof uoms.$inferSelect,
    units: readonly NewUnitInput[],
  ): Promise<void> {
    const seen = new Set<number>([baseUom.id]);
    for (const [index, unit] of units.entries()) {
      await this.uom(tx, unit.uomId, `units.${index}.uomId`);
      if (seen.has(unit.uomId)) {
        throw invalid(
          `units.${index}.uomId`,
          'unique',
          'a product has one current unit per unit of measure',
        );
      }
      seen.add(unit.uomId);
      if (!isExactFactor(unit.factorToBase, baseUom.fractional)) {
        throw new AppError(
          'UNIT_FACTOR_INEXACT',
          `factor ${unit.factorToBase.toString()} is not exact`,
          {
            path: `units.${index}.factorToBase`,
          },
        );
      }
    }
    for (const flag of ['isDefaultSales', 'isDefaultPurchase'] as const) {
      if (units.filter((unit) => unit[flag]).length > 1) {
        throw invalid('units', flag, `only one unit can be ${flag}`);
      }
    }
  }
}

/** The audit snapshot of a product: rows only, without URLs. */
function auditView(product: ProductDetail) {
  return {
    ...product,
    units: product.units.map(({ barcodes, ...unit }) => ({
      ...unit,
      barcodes: barcodes.map((b) => b.code),
    })),
    images: undefined,
  };
}

/**
 * A list search (ADR-0028): every word of the name in either script, or the start of a SKU, or an
 * exact SKU or barcode. `match` keeps the products; `rank` orders them (exact hits, then strict
 * matches, then phonetic ones). Null without a search. The segment conditions use the same match.
 */
export function productSearch(q: string | undefined): { match: SQL; rank: SQL } | null {
  const text = q?.trim() ?? '';
  const terms = queryTerms(text);
  if (terms.length === 0) return null;
  const strict = terms.map((term) =>
    like(products.searchText, `%${escapeLike(termPattern(term.strict))}%`),
  );
  const either = terms.map((term, index) => {
    const phonetic = term.phonetic
      ? like(products.searchPhonetic, `%${escapeLike(termPattern(term.phonetic))}%`)
      : undefined;
    return or(strict[index], phonetic) ?? sql`false`;
  });
  let exact: SQL = sql`false`;
  let match = and(...either) ?? sql`false`;
  if (/^\d+$/.test(text)) {
    const keys = lookupCandidates(text);
    const barcode = keys.length
      ? sql`EXISTS (SELECT 1 FROM ${productBarcodes} b JOIN ${productUnits} u ON u.id = b.product_unit_id
           WHERE u.product_id = products.id AND u.superseded_at IS NULL
             AND b.lookup_key IN (${sql.join(
               keys.map((key) => sql`${key}`),
               sql`, `,
             )}))`
      : sql`false`;
    exact = or(eq(products.sku, text), barcode) ?? sql`false`;
    match = or(match, like(products.sku, `${text}%`), barcode) ?? match;
  }
  return {
    match,
    rank: sql`CASE WHEN ${exact} THEN 0 WHEN ${and(...strict) ?? sql`false`} THEN 1 ELSE 2 END`,
  };
}
