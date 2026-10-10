import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type Actor, AuditService } from '../../identity';
import { products } from '../schema';
import { CategoriesService } from './categories.service';
import { type ProductSummary, ProductsService } from './products.service';

export const READINESS_GAPS = [
  'classificationCode',
  'taxProductCode',
  'measureUnit',
  'cityTax',
] as const;
export type ReadinessGap = (typeof READINESS_GAPS)[number];

export interface ReadinessReport {
  activeProducts: number;
  missing: Record<ReadinessGap, number>;
}

export interface ReadinessRow {
  product: ProductSummary;
  missing: ReadinessGap[];
}

export interface AssignInput {
  categoryId: number;
  includeSubcategories?: boolean;
  classificationCode?: string;
  taxProductCode?: string;
  cityTax?: boolean;
  dryRun?: boolean;
}

export type AssignResult = Record<'classificationCode' | 'taxProductCode' | 'cityTax', number>;

/** A current unit without an e-Barimt measure unit, its own or its unit of measure's default. */
const MISSING_MEASURE_UNIT = sql`EXISTS (
  SELECT 1 FROM product_units pu JOIN uoms u ON u.id = pu.uom_id
   WHERE pu.product_id = products.id AND pu.superseded_at IS NULL
     AND coalesce(pu.measure_unit, u.measure_unit) IS NULL)`;

const GAP_CONDITIONS: Record<ReadinessGap, SQL> = {
  classificationCode: sql`${products.classificationCode} IS NULL`,
  taxProductCode: sql`${products.vatType} IN ('VAT_FREE', 'VAT_ZERO') AND ${products.taxProductCode} IS NULL`,
  measureUnit: MISSING_MEASURE_UNIT,
  cityTax: sql`${products.cityTax} IS NULL`,
};

/**
 * e-Barimt readiness (SPEC §5.2, ADR-0015 #3): which active products still lack the attributes a
 * receipt line will need in delivery 3, and a fill-only bulk assignment by category subtree.
 * Measure units are set per unit of measure (uoms.measure_unit), so they are not bulk-assigned here.
 */
@Injectable()
export class EbarimtReadinessService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
  ) {}

  async report(): Promise<ReadinessReport> {
    const missing = (gap: ReadinessGap) =>
      sql<number>`count(*) FILTER (WHERE ${GAP_CONDITIONS[gap]})::int`;
    const [row] = await this.db
      .select({
        activeProducts: sql<number>`count(*)::int`,
        classificationCode: missing('classificationCode'),
        taxProductCode: missing('taxProductCode'),
        measureUnit: missing('measureUnit'),
        cityTax: missing('cityTax'),
      })
      .from(products)
      .where(eq(products.status, 'ACTIVE'));
    return {
      activeProducts: row?.activeProducts ?? 0,
      missing: {
        classificationCode: row?.classificationCode ?? 0,
        taxProductCode: row?.taxProductCode ?? 0,
        measureUnit: row?.measureUnit ?? 0,
        cityTax: row?.cityTax ?? 0,
      },
    };
  }

  /** Active products missing an attribute (one, or any), by id. */
  async list(query: {
    gap?: ReadinessGap;
    categoryId?: number;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: ReadinessRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const gaps = query.gap ? [query.gap] : [...READINESS_GAPS];
    const conditions: (SQL | undefined)[] = [
      eq(products.status, 'ACTIVE'),
      or(...gaps.map((gap) => GAP_CONDITIONS[gap])),
    ];
    if (typeof after?.id === 'number') conditions.push(gt(products.id, after.id));
    if (query.categoryId !== undefined) {
      conditions.push(
        inArray(products.categoryId, await this.categories.subtreeIds(query.categoryId)),
      );
    }
    const rows = await this.db
      .select({
        product: products,
        classificationCode: sql<boolean>`(${GAP_CONDITIONS.classificationCode})`,
        taxProductCode: sql<boolean>`(${GAP_CONDITIONS.taxProductCode})`,
        measureUnit: sql<boolean>`(${GAP_CONDITIONS.measureUnit})`,
        cityTax: sql<boolean>`(${GAP_CONDITIONS.cityTax})`,
      })
      .from(products)
      .where(and(...conditions))
      .orderBy(asc(products.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.product.id }));
    const summaries = await this.products.summaries(page.data.map((row) => row.product));
    return {
      data: page.data.map((row, index) => {
        const summary = summaries[index];
        if (!summary) throw new Error('summary missing');
        return { product: summary, missing: READINESS_GAPS.filter((gap) => row[gap]) };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Fills empty attributes of the active products in a category (and, by default, its subtree):
   * the classification code, the tax product code (VAT_FREE / VAT_ZERO products only) and the city-tax
   * decision. Never overwrites a value; `dryRun` only counts. One audit row lists the products.
   */
  assign(actor: Actor, input: AssignInput): Promise<AssignResult> {
    return inTransaction(this.db, async (tx) => {
      const categoryIds =
        input.includeSubcategories === false
          ? [(await this.categories.get(input.categoryId, tx)).id]
          : await this.categories.subtreeIds(input.categoryId, tx);
      if (categoryIds.length === 0) await this.categories.get(input.categoryId, tx);
      const scope = and(eq(products.status, 'ACTIVE'), inArray(products.categoryId, categoryIds));
      const result: AssignResult = { classificationCode: 0, taxProductCode: 0, cityTax: 0 };
      const changed = new Set<number>();
      const apply = async (
        field: keyof AssignResult,
        where: SQL | undefined,
        set: Partial<typeof products.$inferInsert>,
      ) => {
        const matches = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(scope, where));
        result[field] = matches.length;
        for (const match of matches) changed.add(match.id);
        if (!input.dryRun && matches.length > 0) {
          await tx
            .update(products)
            .set({ ...set, updatedAt: sql`now()` })
            .where(
              inArray(
                products.id,
                matches.map((match) => match.id),
              ),
            );
        }
      };
      if (input.classificationCode !== undefined) {
        await apply('classificationCode', isNull(products.classificationCode), {
          classificationCode: input.classificationCode,
        });
      }
      if (input.taxProductCode !== undefined) {
        await apply(
          'taxProductCode',
          and(isNull(products.taxProductCode), inArray(products.vatType, ['VAT_FREE', 'VAT_ZERO'])),
          { taxProductCode: input.taxProductCode },
        );
      }
      if (input.cityTax !== undefined) {
        await apply('cityTax', isNull(products.cityTax), { cityTax: input.cityTax });
      }
      if (!input.dryRun && changed.size > 0) {
        await this.audit.record(tx, actor, {
          action: 'ASSIGN',
          entity: 'categories',
          entityId: input.categoryId,
          after: {
            includeSubcategories: input.includeSubcategories !== false,
            classificationCode: input.classificationCode ?? null,
            taxProductCode: input.taxProductCode ?? null,
            cityTax: input.cityTax ?? null,
            counts: result,
            productIds: [...changed].sort((a, b) => a - b),
          },
        });
      }
      return result;
    });
  }
}
