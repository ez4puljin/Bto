import { Inject, Injectable } from '@nestjs/common';
import {
  conditionKey,
  positiveCondition,
  SEGMENT_FIELDS,
  type SegmentCondition,
  type SegmentDefinition,
  type SegmentEntity,
  segmentIssue,
} from '@tugeel/shared/segments';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  ProductFiltersService,
  type ProductSetFilter,
  type ProductSetResolver,
} from '../../catalog';
import type { AuthContext } from '../../identity';
import { ProductLocationsService, StockQueryService } from '../../inventory';
import {
  CustomersService,
  type PartnerSetEntity,
  type PartnerSetResolver,
  ProductSuppliersService,
  SuppliersService,
} from '../../partners';
import { ProductPricesService } from '../../pricing';
import { segments } from '../schema';
import { ascendingUnique, difference, intersect, union } from './set-algebra';

export type SegmentRow = typeof segments.$inferSelect;

/**
 * Turns segment conditions into ids (ADR-0049 #3). Each leaf is answered by the module that owns
 * its data, through that module's public services, as ascending ids; ALL intersects, ANY unites,
 * a negative operator subtracts from the entity's universe (read only when needed). Leaves run
 * one after another (the pool is small) and a condition repeated in a request is asked once.
 * Bound to catalog's PRODUCT_SET_RESOLVER and partners' PARTNER_SET_RESOLVER (ADR-0049 #4).
 */
@Injectable()
export class SegmentEvaluator implements ProductSetResolver, PartnerSetResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly productFilters: ProductFiltersService,
    private readonly productSuppliers: ProductSuppliersService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
    private readonly locations: ProductLocationsService,
    private readonly stock: StockQueryService,
    private readonly prices: ProductPricesService,
  ) {}

  /** The product list's narrowing: `where` and the segment both apply. */
  async productIds(filter: ProductSetFilter): Promise<number[]> {
    let ids: number[] | null = null;
    if (filter.segmentId !== undefined) {
      ids = await this.ofSegment(null, 'PRODUCT', filter.segmentId);
    }
    if (filter.where !== undefined) {
      const where = checkedDefinition('PRODUCT', filter.where, 'where');
      const kept = await this.evaluate(null, 'PRODUCT', where);
      ids = ids === null ? kept : intersect(ids, kept);
    }
    return ids ?? [];
  }

  /** The customer or supplier list's narrowing to a saved segment. */
  ids(ctx: AuthContext, entity: PartnerSetEntity, segmentId: number): Promise<number[]> {
    return this.ofSegment(ctx, entity, segmentId);
  }

  /** The ids a live segment keeps; 404 when unknown or archived, 422 for another entity. */
  async ofSegment(
    ctx: AuthContext | null,
    entity: SegmentEntity,
    segmentId: number,
  ): Promise<number[]> {
    const [row] = await this.db.select().from(segments).where(eq(segments.id, segmentId));
    if (!row || row.archivedAt) throw notFound('segment', segmentId);
    if (row.entity !== entity) {
      throw invalid('segmentId', 'entity', `segment ${segmentId} is not a ${entity} segment`);
    }
    return this.evaluate(ctx, entity, storedDefinition(row));
  }

  /** How many records a stored segment keeps (the segments list). */
  async count(ctx: AuthContext | null, row: SegmentRow): Promise<number> {
    return (await this.evaluate(ctx, row.entity, storedDefinition(row))).length;
  }

  /** The ids a checked definition keeps, ascending. Customer conditions need the caller. */
  async evaluate(
    ctx: AuthContext | null,
    entity: SegmentEntity,
    definition: SegmentDefinition,
  ): Promise<number[]> {
    const answers = new Map<string, number[]>();
    let universe: number[] | null = null;
    const universeOf = async () => (universe ??= await this.universe(ctx, entity));
    const leaf = async (condition: SegmentCondition): Promise<number[]> => {
      const key = conditionKey(condition);
      const known = answers.get(key);
      if (known) return known;
      const { condition: positive, negated } = positiveCondition(condition);
      const kept = ascendingUnique(await this.positive(ctx, entity, positive));
      const ids = negated ? difference(await universeOf(), kept) : kept;
      answers.set(key, ids);
      return ids;
    };
    let result: number[] | null = null;
    for (const group of definition.groups) {
      // An empty result can only stay empty under ALL; skip the rest.
      if (definition.match === 'ALL' && result?.length === 0) break;
      let kept: number[] | null = null;
      for (const condition of group.conditions) {
        if (group.match === 'ALL' && kept?.length === 0) break;
        const ids = await leaf(condition);
        kept =
          kept === null ? ids : group.match === 'ALL' ? intersect(kept, ids) : union(kept, ids);
      }
      const groupIds = kept ?? [];
      result =
        result === null
          ? groupIds
          : definition.match === 'ALL'
            ? intersect(result, groupIds)
            : union(result, groupIds);
    }
    return result ?? [];
  }

  /** Every record of the entity a negative condition subtracts from. */
  private universe(ctx: AuthContext | null, entity: SegmentEntity): Promise<number[]> {
    switch (entity) {
      case 'PRODUCT':
        return this.productFilters.allIds();
      case 'CUSTOMER':
        return this.customers.allIds(requireCaller(ctx));
      case 'SUPPLIER':
        return this.suppliers.allIds();
    }
  }

  /** One positive condition, answered by the module that owns the field's data. */
  private positive(
    ctx: AuthContext | null,
    entity: SegmentEntity,
    condition: SegmentCondition,
  ): Promise<number[]> {
    if (entity === 'CUSTOMER') return this.customers.idsWhere(requireCaller(ctx), condition);
    if (entity === 'SUPPLIER') return this.suppliers.idsWhere(condition);
    const field = SEGMENT_FIELDS.PRODUCT[condition.field];
    switch (field?.owner) {
      case 'catalog':
        return this.productFilters.idsWhere(condition);
      case 'partners':
        return this.productSuppliers.productIdsWhere(condition);
      case 'inventory':
        return condition.field === 'stock'
          ? this.stock.productIdsWhere(condition)
          : this.locations.productIdsWhere(condition);
      case 'pricing':
        return this.prices.productIdsWhere(condition, businessDate());
      default:
        return Promise.resolve([]);
    }
  }
}

/** A definition from a request, checked against the entity's registry (422 at its path). */
export function checkedDefinition(
  entity: SegmentEntity,
  definition: unknown,
  path: string,
): SegmentDefinition {
  const problem = segmentIssue(entity, definition);
  if (problem) {
    const at = problem.path ? `${path}.${problem.path}` : path;
    throw invalid(at, problem.issue, `segment condition rejected: ${problem.issue}`);
  }
  return definition as SegmentDefinition;
}

/** A stored definition, checked again: a registry change must not run stale conditions. */
function storedDefinition(row: SegmentRow): SegmentDefinition {
  const problem = segmentIssue(row.entity, row.definition);
  if (problem) {
    throw new AppError('SEGMENT_INVALID', `segment ${row.id} no longer validates`, {
      name: row.name,
      issue: problem.issue,
    });
  }
  return row.definition as SegmentDefinition;
}

function requireCaller(ctx: AuthContext | null): AuthContext {
  if (!ctx) throw new Error('customer segments are evaluated for a caller');
  return ctx;
}
