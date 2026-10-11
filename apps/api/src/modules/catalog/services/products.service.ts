import { Inject, Injectable } from '@nestjs/common';
import { classifyBarcode, lookupCandidates } from '@tugeel/shared/gtin';
import { Decimal } from '@tugeel/shared/money';
import { normalizeName, queryTerms, searchKeys, termPattern } from '@tugeel/shared/text';
import { isExactFactor } from '@tugeel/shared/units';
import { and, asc, desc, eq, inArray, like, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type Actor, AuditService, StorageService } from '../../identity';
import {
  brands,
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
  brandId: number | null;
  status: ProductStatus;
  vatType: VatType;
  cityTax: boolean | null;
  baseUnit: { id: number; uomId: number; uomName: string };
  thumbUrl: string | null;
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
  brandId?: number | null;
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
  brandId?: number | null;
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
  brandId?: number;
  status?: ProductStatus;
  cursor?: string;
  limit?: number;
}

/** Products with their units, barcodes and images (SPEC §5.2, ADR-0008, ADR-0028). */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly barcodes: BarcodeService,
  ) {}

  /** The next free numeric SKU: the largest one plus one, keeping its width (leading zeros). */
  async nextSku(executor: Db | Tx = this.db): Promise<string> {
    const [last] = await executor
      .select({ sku: products.sku })
      .from(products)
      .orderBy(desc(sql`length(${products.sku})`), desc(products.sku))
      .limit(1);
    if (!last) return '1';
    return (BigInt(last.sku) + 1n).toString().padStart(last.sku.length, '0');
  }

  create(actor: Actor, input: ProductInput): Promise<ProductDetail> {
    return inTransaction(this.db, async (tx) => {
      await this.assertReferences(tx, input);
      const baseUom = await this.uom(tx, input.baseUomId, 'baseUomId');
      const extra = input.units ?? [];
      await this.assertUnits(tx, baseUom, extra);
      const sku = input.sku ?? (await this.nextSku(tx));
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
          brandId: input.brandId ?? null,
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
        for (const code of unit.barcodes ?? [])
          await this.barcodes.addInTx(tx, actor, row.id, code);
      }
      const created = await this.get(product.id, tx);
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'products',
        entityId: product.id,
        after: auditView(created),
      });
      return created;
    });
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
        ...(patch.brandId === undefined ? {} : { brandId: patch.brandId }),
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
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(products.status, query.status));
    if (query.brandId !== undefined) filters.push(eq(products.brandId, query.brandId));
    if (query.categoryId !== undefined) {
      filters.push(sql`${products.categoryId} IN (
        WITH RECURSIVE down(id) AS (
          SELECT id FROM ${categories} WHERE id = ${query.categoryId}
          UNION ALL
          SELECT c.id FROM ${categories} c JOIN down ON c.parent_id = down.id
        )
        SELECT id FROM down)`);
    }
    const searched = this.searchRank(query.q, filters);
    // Without a search every row ranks 0; a bare 0 in ORDER BY would mean "column 0".
    const rank = searched ?? sql`0`;
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number' && typeof after.rank === 'number') {
      filters.push(
        sql`(${rank}, ${products.name}, ${products.id}) > (${after.rank}, (SELECT name FROM ${products} WHERE id = ${after.id}), ${after.id})`,
      );
    }
    const rows = await this.db
      .select({ product: products, rank: sql<number>`${rank}` })
      .from(products)
      .where(and(...filters))
      .orderBy(...(searched ? [searched] : []), asc(products.name), asc(products.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.product.id, rank: row.rank }));
    return {
      data: await this.summaries(page.data.map((row) => row.product)),
      nextCursor: page.nextCursor,
    };
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
    return rows.map((row) => {
      const base = bases.find((unit) => unit.productId === row.id);
      if (!base) throw new Error(`product ${row.id} has no base unit`);
      const thumb = primaries.find((image) => image.productId === row.id);
      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        categoryId: row.categoryId,
        brandId: row.brandId,
        status: row.status,
        vatType: row.vatType,
        cityTax: row.cityTax,
        baseUnit: { id: base.id, uomId: base.uomId, uomName: base.uomName },
        thumbUrl: thumb ? (urls.get(thumb.fileId) ?? null) : null,
      };
    });
  }

  /** The rank expression of a search (null without one) and, as a side effect, its match condition in `filters`. */
  private searchRank(q: string | undefined, filters: SQL[]): SQL | null {
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
    filters.push(match);
    return sql`CASE WHEN ${exact} THEN 0 WHEN ${and(...strict) ?? sql`false`} THEN 1 ELSE 2 END`;
  }

  private async assertReferences(
    tx: Tx,
    input: { categoryId?: number; brandId?: number | null },
  ): Promise<void> {
    if (input.categoryId !== undefined) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, input.categoryId));
      if (!category)
        throw invalid('categoryId', 'exists', `category ${input.categoryId} not found`);
    }
    if (input.brandId !== undefined && input.brandId !== null) {
      const [brand] = await tx
        .select({ id: brands.id })
        .from(brands)
        .where(eq(brands.id, input.brandId));
      if (!brand) throw invalid('brandId', 'exists', `brand ${input.brandId} not found`);
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
