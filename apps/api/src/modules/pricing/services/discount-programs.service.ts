import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  type DiscountEffect,
  type DiscountMeasure,
  type DiscountScope,
  type DiscountShapeIssue,
  type DiscountStep,
  discountShapeIssue,
  discountStepsIssue,
  MAX_PROGRAM_TARGETS,
  type PriceAdjust,
  priceAdjustIssue,
  type PriceList,
  type ProgramApplyType,
  type ProgramList,
  type ProgramState,
  type ProgramTarget,
} from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  CatalogService,
  CategoriesService,
  ProductQueryService,
  type UnitInfo,
  UnitConversionService,
  UomsService,
} from '../../catalog';
import { type Actor, actorUserId, AuditService, UserNamesService } from '../../identity';
import { SuppliersService } from '../../partners';
import {
  type DiscountLinkRole,
  discountProgramLinks,
  discountPrograms,
  discountSteps,
} from '../schema';
import { ProgramTargetsService } from './program-targets.service';
import { applied, assertNotPast } from './support';

type ProgramRow = typeof discountPrograms.$inferSelect;

/**
 * What a person set together with the dates: a draft, not started, in force, ended (a program
 * stopped on its first day too), archived.
 */
export const PROGRAM_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'ARCHIVED'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

/** A list's priority filter: only the programs that apply alone, or none of them. */
export const PROGRAM_PRIORITY_FILTERS = ['ONLY', 'EXCLUDE'] as const;
export type ProgramPriorityFilter = (typeof PROGRAM_PRIORITY_FILTERS)[number];

export interface DiscountProgramInput {
  name: string;
  list: ProgramList;
  state: ProgramState;
  priority: boolean;
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  productId: number | null;
  productUnitId: number | null;
  thresholdUnitId: number | null;
  categoryId: number | null;
  countUomId: number | null;
  targetKind: ProgramTarget | null;
  targetIds: number[];
  excludeTargetIds: number[];
  excludeProductIds: number[];
  adjustKind: PriceAdjust;
  adjustFactor: number;
  /** Where it serves; empty: everywhere in its channel. */
  pipelineIds: number[];
  tillIds: number[];
  validFrom: string;
  validTo: string | null;
  /** PRODUCT QTY thresholds in base units, CATEGORY QTY in counted units, AMOUNT in MNT. */
  steps: DiscountStep[];
}

export interface ProgramUnit {
  id: number;
  uomName: string;
  factorToBase: Decimal;
}

export interface ProgramProduct {
  id: number;
  sku: string;
  name: string;
}

export interface DiscountProgram {
  id: number;
  name: string;
  list: ProgramList;
  state: ProgramState;
  priority: boolean;
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  product: ProgramProduct | null;
  productUnit: ProgramUnit | null;
  thresholdUnit: ProgramUnit | null;
  categoryId: number | null;
  countUomId: number | null;
  targetKind: ProgramTarget | null;
  targetIds: number[];
  excludeTargetIds: number[];
  excludeProductIds: number[];
  /** The chosen and excluded products by name, for the screens. */
  namedProducts: ProgramProduct[];
  adjustKind: PriceAdjust;
  adjustFactor: number;
  pipelineIds: number[];
  tillIds: number[];
  validFrom: string;
  validTo: string | null;
  status: ProgramStatus;
  steps: DiscountStep[];
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgramQuery {
  q?: string;
  list?: ProgramList;
  scope?: DiscountScope;
  status?: ProgramStatus;
  applyType?: ProgramApplyType;
  priority?: ProgramPriorityFilter;
  /** Programs whose product, set or category holds this product. */
  productId?: number;
  /** In force on this date. */
  date?: string;
  /** Programs serving this pipeline or till. */
  pipelineId?: number;
  tillId?: number;
  /** Programs with a real condition on a quantity or an amount. */
  condition?: DiscountMeasure;
  cursor?: string;
  limit?: number;
}

/** A program as the resolver takes it. */
export interface ProgramInForce {
  id: number;
  name: string;
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  priority: boolean;
  productId: number | null;
  productUnitId: number | null;
  categoryId: number | null;
  countUomId: number | null;
  targetKind: ProgramTarget | null;
  targetIds: number[];
  excludeTargetIds: number[];
  excludeProductIds: number[];
  adjustKind: PriceAdjust;
  adjustFactor: number;
  pipelineIds: number[];
  tillIds: number[];
  steps: DiscountStep[];
}

type Links = Record<DiscountLinkRole, number[]>;

const SHAPE_PATHS: Record<DiscountShapeIssue, string> = {
  PRODUCT_REQUIRED: 'productId',
  UNIT_REQUIRED: 'productUnitId',
  CATEGORY_REQUIRED: 'categoryId',
  COUNT_UNIT_REQUIRED: 'countUomId',
  MEASURE_NOT_ALLOWED: 'measure',
  EFFECT_NOT_ALLOWED: 'effect',
  TARGET_NOT_ALLOWED: 'scope',
  PRIORITY_NOT_ALLOWED: 'priority',
  ADJUST_NOT_ALLOWED: 'adjustKind',
};

const noLinks = (): Links => ({
  TARGET: [],
  EXCLUDE_TARGET: [],
  EXCLUDE_PRODUCT: [],
  PIPELINE: [],
  TILL: [],
});

/**
 * Discount programs (ADR-0041 #2, ADR-0159 #1): created for today or later, edited at any time with
 * the audit keeping what they were (orders keep the prices frozen at their submit), archived, or
 * deleted out of every list (the row stays, as business data does). What applies to a quote is
 * decided here by state and dates and in the resolver by priority.
 */
@Injectable()
export class DiscountProgramsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
    private readonly uoms: UomsService,
    private readonly units: UnitConversionService,
    private readonly names: UserNamesService,
    private readonly suppliers: SuppliersService,
    private readonly productQuery: ProductQueryService,
    private readonly targets: ProgramTargetsService,
  ) {}

  async get(id: number, executor: Db | Tx = this.db): Promise<DiscountProgram> {
    const [row] = await executor
      .select()
      .from(discountPrograms)
      .where(and(eq(discountPrograms.id, id), isNull(discountPrograms.deletedAt)));
    if (!row) throw notFound('discount program', id);
    const [program] = await this.views([row], executor);
    if (!program) throw notFound('discount program', id);
    return program;
  }

  /** Newest first, filtered; archived programs only when asked for by status. */
  async list(query: ProgramQuery): Promise<{ data: DiscountProgram[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const today = businessDate();
    const filters: (SQL | undefined)[] = [isNull(discountPrograms.deletedAt)];
    const name = query.q?.trim();
    if (name) {
      filters.push(ilike(discountPrograms.name, `%${name.replace(/[\\%_]/g, '\\$&')}%`));
    }
    if (query.list) {
      filters.push(inArray(discountPrograms.list, [query.list, 'ALL']));
    }
    if (query.scope) filters.push(eq(discountPrograms.scope, query.scope));
    filters.push(
      query.status ? statusFilter(query.status, today) : ne(discountPrograms.state, 'ARCHIVED'),
    );
    if (query.applyType) filters.push(applyTypeFilter(query.applyType));
    if (query.priority) filters.push(eq(discountPrograms.priority, query.priority === 'ONLY'));
    if (query.productId) {
      const touching = await this.touching(query.productId);
      filters.push(
        or(
          eq(discountPrograms.productId, query.productId),
          touching.length > 0 ? inArray(discountPrograms.id, touching) : undefined,
        ),
      );
    }
    if (query.date) {
      filters.push(
        lte(discountPrograms.validFrom, query.date),
        or(isNull(discountPrograms.validTo), gt(discountPrograms.validTo, query.date)),
      );
    }
    if (query.pipelineId) filters.push(servesFilter('PIPELINE', 'RETAIL', query.pipelineId));
    if (query.tillId) filters.push(servesFilter('TILL', 'WHOLESALE', query.tillId));
    if (query.condition) {
      // A product's threshold of one base unit always applies; so does any threshold of zero.
      const from = query.condition === 'QTY' ? 1 : 0;
      filters.push(
        eq(discountPrograms.measure, query.condition),
        sql`EXISTS (SELECT 1 FROM discount_steps s WHERE s.program_id = discount_programs.id AND s.threshold > ${from})`,
      );
    }
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(discountPrograms.id, after.id));
    const rows = await this.db
      .select()
      .from(discountPrograms)
      .where(and(...filters))
      .orderBy(desc(discountPrograms.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.views(page.data), nextCursor: page.nextCursor };
  }

  async create(actor: Actor, input: DiscountProgramInput): Promise<DiscountProgram> {
    const values = await this.checked(input, null);
    const id = await inTransaction(this.db, async (tx) => {
      const [row] = await this.mapOverlap(
        tx
          .insert(discountPrograms)
          .values({ ...values, createdBy: actorUserId(actor) })
          .returning(),
      );
      if (!row) throw new Error('discount program insert returned no row');
      await this.insertSteps(tx, row.id, input.steps);
      await this.insertLinks(tx, row.id, input);
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'discount_programs',
        entityId: row.id,
        after: auditView(row, input.steps, linksOfInput(input)),
      });
      return row.id;
    });
    this.targets.forget();
    return this.get(id);
  }

  /** The whole program replaced; what it was stays in the audit (ADR-0159 #1). */
  async update(actor: Actor, id: number, input: DiscountProgramInput): Promise<DiscountProgram> {
    const [current] = await this.db
      .select()
      .from(discountPrograms)
      .where(and(eq(discountPrograms.id, id), isNull(discountPrograms.deletedAt)));
    if (!current) throw notFound('discount program', id);
    const values = await this.checked(input, current);
    await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      const beforeSteps = await this.stepsOf(tx, [id]);
      const beforeLinks = await this.linksOf(tx, [id]);
      const [row] = await this.mapOverlap(
        tx
          .update(discountPrograms)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(discountPrograms.id, id))
          .returning(),
      );
      if (!row) throw notFound('discount program', id);
      await tx.delete(discountSteps).where(eq(discountSteps.programId, id));
      await this.insertSteps(tx, id, input.steps);
      await tx.delete(discountProgramLinks).where(eq(discountProgramLinks.programId, id));
      await this.insertLinks(tx, id, input);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'discount_programs',
        entityId: id,
        before: auditView(before, beforeSteps.get(id) ?? [], beforeLinks.get(id) ?? noLinks()),
        after: auditView(row, input.steps, linksOfInput(input)),
      });
    });
    this.targets.forget();
    return this.get(id);
  }

  /**
   * Ends a program now: in force, it stops applying today; not started, it never will. An ended
   * program is left as it is.
   */
  async stop(actor: Actor, id: number): Promise<DiscountProgram> {
    const today = businessDate();
    await inTransaction(this.db, async (tx) => {
      const row = await this.lock(tx, id);
      if ((row.validTo !== null && row.validTo <= today) || !applied(row)) return;
      const validTo = row.validFrom > today ? row.validFrom : today;
      await tx
        .update(discountPrograms)
        .set({ validTo, updatedAt: sql`now()` })
        .where(eq(discountPrograms.id, id));
      await this.audit.record(tx, actor, {
        action: 'STOP',
        entity: 'discount_programs',
        entityId: id,
        before: { validTo: row.validTo },
        after: { validTo },
      });
    });
    return this.get(id);
  }

  /** ARCHIVED: it applies nowhere and leaves the lists; ACTIVE brings it back by its dates. */
  async setState(actor: Actor, id: number, state: 'ACTIVE' | 'ARCHIVED'): Promise<DiscountProgram> {
    await inTransaction(this.db, async (tx) => {
      const row = await this.lock(tx, id);
      if (row.state === state) return;
      await this.mapOverlap(
        tx
          .update(discountPrograms)
          .set({ state, updatedAt: sql`now()` })
          .where(eq(discountPrograms.id, id)),
      );
      await this.audit.record(tx, actor, {
        action: state === 'ARCHIVED' ? 'ARCHIVE' : 'RESTORE',
        entity: 'discount_programs',
        entityId: id,
        before: { state: row.state },
        after: { state },
      });
    });
    return this.get(id);
  }

  /**
   * Out of every list and every quote at any time (ADR-0159 #1). The row stays: orders name their
   * programs in the discounts they froze, and business data is never removed.
   */
  async remove(actor: Actor, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const row = await this.lock(tx, id);
      const steps = await this.stepsOf(tx, [id]);
      const links = await this.linksOf(tx, [id]);
      await tx
        .update(discountPrograms)
        .set({ deletedAt: sql`now()`, deletedBy: actorUserId(actor), updatedAt: sql`now()` })
        .where(eq(discountPrograms.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'discount_programs',
        entityId: id,
        before: auditView(row, steps.get(id) ?? [], links.get(id) ?? noLinks()),
      });
    });
  }

  /** The programs of a channel in force on a date, with their steps (ascending thresholds). */
  async inForce(
    list: PriceList,
    date: string,
    executor: Db | Tx = this.db,
  ): Promise<ProgramInForce[]> {
    const rows = await executor.select().from(discountPrograms).where(inForceFilter(list, date));
    const ids = rows.map((row) => row.id);
    const steps = await this.stepsOf(executor, ids);
    const links = await this.linksOf(executor, ids);
    return rows.map((row) => {
      const own = links.get(row.id) ?? noLinks();
      return {
        id: row.id,
        name: row.name,
        scope: row.scope,
        measure: row.measure,
        effect: row.effect,
        priority: row.priority,
        productId: row.productId,
        productUnitId: row.productUnitId,
        categoryId: row.categoryId,
        countUomId: row.countUomId,
        targetKind: row.targetKind,
        targetIds: own.TARGET,
        excludeTargetIds: own.EXCLUDE_TARGET,
        excludeProductIds: own.EXCLUDE_PRODUCT,
        adjustKind: row.adjustKind,
        adjustFactor: row.adjustFactor,
        pipelineIds: own.PIPELINE,
        tillIds: own.TILL,
        steps: steps.get(row.id) ?? [],
      };
    });
  }

  /**
   * The programs of a channel in force on a date as their views (units named, exclusive `validTo`,
   * steps ascending): «Bto300»'s badges (ADR-0093).
   */
  async inForceViews(list: PriceList, date: string): Promise<DiscountProgram[]> {
    const rows = await this.db
      .select()
      .from(discountPrograms)
      .where(inForceFilter(list, date))
      .orderBy(asc(discountPrograms.id));
    return this.views(rows);
  }

  /**
   * A superseded unit (ADR-0041 #6): programs on it stop today, planned ones never start; a new
   * price for the new unit is a new program.
   */
  async closeForUnitInTx(tx: Tx, actor: Actor, unitId: number, today: string): Promise<number> {
    const open = await tx
      .select()
      .from(discountPrograms)
      .where(
        and(
          eq(discountPrograms.productUnitId, unitId),
          isNull(discountPrograms.deletedAt),
          or(isNull(discountPrograms.validTo), gt(discountPrograms.validTo, today)),
        ),
      )
      .for('update');
    for (const row of open.filter(applied)) {
      const validTo = row.validFrom > today ? row.validFrom : today;
      await tx
        .update(discountPrograms)
        .set({ validTo, updatedAt: sql`now()` })
        .where(eq(discountPrograms.id, row.id));
      await this.audit.record(tx, actor, {
        action: 'STOP',
        entity: 'discount_programs',
        entityId: row.id,
        before: { validTo: row.validTo },
        after: { validTo, reason: 'UNIT_SUPERSEDED' },
      });
    }
    return open.length;
  }

  // -------------------------------------------------------------------------------------------

  /** The programs whose set or category holds this product (the list's product filter). */
  private async touching(productId: number): Promise<number[]> {
    const rows = await this.db
      .select()
      .from(discountPrograms)
      .where(
        and(
          isNull(discountPrograms.deletedAt),
          or(isNotNull(discountPrograms.targetKind), isNotNull(discountPrograms.categoryId)),
        ),
      );
    const links = await this.linksOf(
      this.db,
      rows.map((row) => row.id),
    );
    const sets = await this.targets.productSets(
      rows.map((row) => {
        const own = links.get(row.id) ?? noLinks();
        return row.targetKind === null
          ? {
              id: row.id,
              targetKind: 'CATEGORY' as const,
              targetIds: row.categoryId === null ? [] : [row.categoryId],
              excludeTargetIds: [],
              excludeProductIds: [],
            }
          : {
              id: row.id,
              targetKind: row.targetKind,
              targetIds: own.TARGET,
              excludeTargetIds: own.EXCLUDE_TARGET,
              excludeProductIds: own.EXCLUDE_PRODUCT,
            };
      }),
    );
    return [...sets].flatMap(([id, products]) => (products.has(productId) ? [id] : []));
  }

  /** Validates an input against the shape rules, its steps, its dates and its targets. */
  private async checked(input: DiscountProgramInput, before: ProgramRow | null) {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw invalid('name', 'length', 'name must have 1 to 120 characters');
    }
    const shapeIssue = discountShapeIssue(input);
    if (shapeIssue) {
      throw invalid(SHAPE_PATHS[shapeIssue], shapeIssue, `shape: ${shapeIssue}`);
    }
    const stepsIssue = discountStepsIssue(input.effect, input.steps);
    if (stepsIssue) {
      const path = stepsIssue.index === null ? 'steps' : `steps.${stepsIssue.index}`;
      throw invalid(path, stepsIssue.issue, `steps: ${stepsIssue.issue}`);
    }
    if (priceAdjustIssue(input.adjustKind, new Decimal(input.adjustFactor))) {
      throw invalid('adjustFactor', 'ADJUST_FACTOR', 'a whole factor; a power of ten for …9');
    }
    // A program already running keeps its first day when it is edited.
    if (before === null || input.validFrom !== before.validFrom) {
      assertNotPast('validFrom', input.validFrom);
    }
    if (input.validTo !== null && input.validTo <= input.validFrom) {
      throw invalid('validTo', 'afterValidFrom', 'validTo must be after validFrom');
    }
    if (input.productId !== null) {
      const [product] = await this.catalog.getMany([input.productId]);
      if (!product) throw notFound('product', input.productId);
      const unitIds = [input.productUnitId, input.thresholdUnitId].filter(
        (unitId): unitId is number => unitId !== null,
      );
      const units = await this.units.describe(unitIds);
      for (const unitId of unitIds) {
        const unit = units.get(unitId);
        if (!unit || unit.productId !== input.productId) throw notFound('product unit', unitId);
        if (!unit.current) {
          throw new AppError('UNIT_SUPERSEDED', `unit ${unitId} is no longer current`, {
            id: unitId,
          });
        }
      }
    }
    if (input.categoryId !== null) await this.categories.get(input.categoryId);
    if (input.countUomId !== null) await this.uoms.get(input.countUomId);
    await this.checkTargets(input);
    if (input.list === 'RETAIL' && input.pipelineIds.length > 0) {
      throw invalid('pipelineIds', 'list', 'the supermarket has no pipelines');
    }
    if (input.list === 'WHOLESALE' && input.tillIds.length > 0) {
      throw invalid('tillIds', 'list', 'the wholesale channel has no tills');
    }
    return {
      name,
      list: input.list,
      state: input.state,
      priority: input.priority,
      scope: input.scope,
      measure: input.measure,
      effect: input.effect,
      productId: input.productId,
      productUnitId: input.productUnitId,
      thresholdUnitId: input.thresholdUnitId,
      categoryId: input.categoryId,
      countUomId: input.countUomId,
      targetKind: input.targetKind,
      adjustKind: input.adjustKind,
      adjustFactor: input.adjustKind === 'NONE' ? 1 : input.adjustFactor,
      validFrom: input.validFrom,
      validTo: input.validTo,
    };
  }

  /** The targets exist and fit the kind; pipelines and tills belong to modules that follow this one. */
  private async checkTargets(input: DiscountProgramInput): Promise<void> {
    const { targetKind, targetIds, excludeTargetIds, excludeProductIds } = input;
    if (targetKind === null) {
      if (targetIds.length + excludeTargetIds.length + excludeProductIds.length > 0) {
        throw invalid('targetKind', 'required', 'targets need a kind');
      }
      return;
    }
    if (targetIds.length === 0) throw invalid('targetIds', 'required', 'at least one target');
    if (
      targetIds.length + excludeTargetIds.length + excludeProductIds.length >
      MAX_PROGRAM_TARGETS
    ) {
      throw invalid('targetIds', 'count', `at most ${MAX_PROGRAM_TARGETS} targets`);
    }
    if (targetKind === 'PRODUCT' && excludeTargetIds.length + excludeProductIds.length > 0) {
      throw invalid('excludeProductIds', 'chosen', 'chosen products have nothing to exclude');
    }
    const ofKind = [...new Set([...targetIds, ...excludeTargetIds])];
    switch (targetKind) {
      case 'PRODUCT':
        await this.assertProducts(ofKind);
        break;
      case 'CATEGORY':
        for (const id of ofKind) await this.categories.get(id);
        break;
      case 'SUPPLIER':
        for (const id of ofKind) await this.suppliers.get(id);
        break;
      case 'SEGMENT': {
        const live = await this.productQuery.productSegments({ ids: ofKind });
        const found = new Set(live.map((segment) => segment.id));
        for (const id of ofKind) if (!found.has(id)) throw notFound('segment', id);
        break;
      }
    }
    await this.assertProducts(excludeProductIds);
  }

  private async assertProducts(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    const found = new Set((await this.catalog.getMany(ids)).map((product) => product.id));
    for (const id of ids) if (!found.has(id)) throw notFound('product', id);
  }

  /** Two PRICE programs for one unit over overlapping dates (the EXCLUDE constraint). */
  private async mapOverlap<T>(query: PromiseLike<T>): Promise<T> {
    try {
      return await query;
    } catch (error) {
      const database = databaseErrorOf(error);
      if (database?.code === '23P01' && database.constraint === 'discount_programs_one_price') {
        throw new AppError(
          'DISCOUNT_PROGRAM_OVERLAP',
          'another new-price program covers this unit on these dates',
        );
      }
      throw error;
    }
  }

  private async lock(tx: Tx, id: number): Promise<ProgramRow> {
    const [row] = await tx
      .select()
      .from(discountPrograms)
      .where(and(eq(discountPrograms.id, id), isNull(discountPrograms.deletedAt)))
      .for('update');
    if (!row) throw notFound('discount program', id);
    return row;
  }

  private async insertSteps(tx: Tx, programId: number, steps: readonly DiscountStep[]) {
    await tx.insert(discountSteps).values(
      steps.map((step) => ({
        programId,
        threshold: step.threshold,
        value: step.value,
        rule: step.rule ?? 'MINIMUM',
      })),
    );
  }

  private async insertLinks(tx: Tx, programId: number, input: DiscountProgramInput) {
    const links = linksOfInput(input);
    const rows = (Object.entries(links) as [DiscountLinkRole, number[]][]).flatMap(([role, ids]) =>
      [...new Set(ids)].map((refId) => ({ programId, role, refId })),
    );
    if (rows.length > 0) await tx.insert(discountProgramLinks).values(rows);
  }

  private async stepsOf(
    executor: Db | Tx,
    programIds: readonly number[],
  ): Promise<Map<number, DiscountStep[]>> {
    const result = new Map<number, DiscountStep[]>();
    if (programIds.length === 0) return result;
    const rows = await executor
      .select()
      .from(discountSteps)
      .where(inArray(discountSteps.programId, [...programIds]))
      .orderBy(asc(discountSteps.programId), asc(discountSteps.threshold));
    for (const row of rows) {
      result.set(row.programId, [
        ...(result.get(row.programId) ?? []),
        {
          threshold: row.threshold,
          value: row.value,
          // Only when it says something: the POS snapshot's hash stays as it was.
          ...(row.rule === 'MINIMUM' ? {} : { rule: row.rule }),
        },
      ]);
    }
    return result;
  }

  private async linksOf(
    executor: Db | Tx,
    programIds: readonly number[],
  ): Promise<Map<number, Links>> {
    const result = new Map<number, Links>();
    if (programIds.length === 0) return result;
    const rows = await executor
      .select()
      .from(discountProgramLinks)
      .where(inArray(discountProgramLinks.programId, [...programIds]))
      .orderBy(asc(discountProgramLinks.refId));
    for (const row of rows) {
      const own = result.get(row.programId) ?? noLinks();
      own[row.role].push(row.refId);
      result.set(row.programId, own);
    }
    return result;
  }

  private async views(
    rows: readonly ProgramRow[],
    executor: Db | Tx = this.db,
  ): Promise<DiscountProgram[]> {
    if (rows.length === 0) return [];
    const today = businessDate();
    const ids = rows.map((row) => row.id);
    const steps = await this.stepsOf(executor, ids);
    const links = await this.linksOf(executor, ids);
    const productIds = new Set(rows.flatMap((row) => (row.productId ? [row.productId] : [])));
    for (const row of rows) {
      const own = links.get(row.id);
      if (!own) continue;
      for (const id of own.EXCLUDE_PRODUCT) productIds.add(id);
      if (row.targetKind === 'PRODUCT') for (const id of own.TARGET) productIds.add(id);
    }
    const products = new Map(
      (await this.catalog.getMany([...productIds], executor)).map((product) => [
        product.id,
        { id: product.id, sku: product.sku, name: product.name },
      ]),
    );
    const unitIds = [
      ...new Set(
        rows.flatMap((row) =>
          [row.productUnitId, row.thresholdUnitId].filter((id): id is number => id !== null),
        ),
      ),
    ];
    const units = await this.units.describe(unitIds, executor);
    const unitOf = (id: number | null): ProgramUnit | null => {
      const unit: UnitInfo | undefined = id === null ? undefined : units.get(id);
      return unit
        ? { id: unit.unitId, uomName: unit.uomName, factorToBase: unit.factorToBase }
        : null;
    };
    const authors = await this.names.namesOf(
      [...new Set(rows.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])))],
      executor,
    );
    return rows.map((row) => {
      const own = links.get(row.id) ?? noLinks();
      const named = [
        ...(row.targetKind === 'PRODUCT' ? own.TARGET : []),
        ...own.EXCLUDE_PRODUCT,
      ].flatMap((id) => {
        const product = products.get(id);
        return product ? [product] : [];
      });
      return {
        id: row.id,
        name: row.name,
        list: row.list,
        state: row.state,
        priority: row.priority,
        scope: row.scope,
        measure: row.measure,
        effect: row.effect,
        product: row.productId ? (products.get(row.productId) ?? null) : null,
        productUnit: unitOf(row.productUnitId),
        thresholdUnit: unitOf(row.thresholdUnitId),
        categoryId: row.categoryId,
        countUomId: row.countUomId,
        targetKind: row.targetKind,
        targetIds: own.TARGET,
        excludeTargetIds: own.EXCLUDE_TARGET,
        excludeProductIds: own.EXCLUDE_PRODUCT,
        namedProducts: named,
        adjustKind: row.adjustKind,
        adjustFactor: row.adjustFactor,
        pipelineIds: own.PIPELINE,
        tillIds: own.TILL,
        validFrom: row.validFrom,
        validTo: row.validTo,
        status: statusOf(row, today),
        steps: steps.get(row.id) ?? [],
        createdByName: row.createdBy === null ? null : (authors.get(row.createdBy) ?? null),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}

export function statusOf(
  row: { validFrom: string; validTo: string | null; state?: ProgramState },
  today: string,
): ProgramStatus {
  if (row.state === 'DRAFT' || row.state === 'ARCHIVED') return row.state;
  if (row.validTo !== null && row.validTo <= today) return 'ENDED';
  if (!applied(row)) return 'ENDED';
  return row.validFrom > today ? 'SCHEDULED' : 'ACTIVE';
}

/** The programs that apply in a channel on a date: set active, undeleted, within their dates. */
function inForceFilter(list: PriceList, date: string): SQL | undefined {
  return and(
    inArray(discountPrograms.list, [list, 'ALL']),
    eq(discountPrograms.state, 'ACTIVE'),
    isNull(discountPrograms.deletedAt),
    lte(discountPrograms.validFrom, date),
    or(isNull(discountPrograms.validTo), gt(discountPrograms.validTo, date)),
  );
}

function statusFilter(status: ProgramStatus, today: string): SQL {
  const active = eq(discountPrograms.state, 'ACTIVE');
  const notVoid = or(
    isNull(discountPrograms.validTo),
    gt(discountPrograms.validTo, discountPrograms.validFrom),
  );
  switch (status) {
    case 'DRAFT':
    case 'ARCHIVED':
      return eq(discountPrograms.state, status);
    case 'SCHEDULED':
      return and(active, gt(discountPrograms.validFrom, today), notVoid) as SQL;
    case 'ACTIVE':
      return and(
        active,
        lte(discountPrograms.validFrom, today),
        or(isNull(discountPrograms.validTo), gt(discountPrograms.validTo, today)),
      ) as SQL;
    case 'ENDED':
      return and(
        active,
        or(
          lte(discountPrograms.validTo, today),
          sql`${discountPrograms.validTo} = ${discountPrograms.validFrom}`,
        ),
      ) as SQL;
  }
}

function applyTypeFilter(type: ProgramApplyType): SQL | undefined {
  switch (type) {
    case 'ORDER':
      return eq(discountPrograms.scope, 'ORDER');
    case 'SUPPLIER':
    case 'SEGMENT':
      return eq(discountPrograms.targetKind, type);
    case 'PRODUCT':
      return or(eq(discountPrograms.targetKind, 'PRODUCT'), isNotNull(discountPrograms.productId));
    case 'CATEGORY':
      return or(
        eq(discountPrograms.targetKind, 'CATEGORY'),
        isNotNull(discountPrograms.categoryId),
      );
  }
}

/** Names this pipeline or till, or names none in a channel that has them. */
function servesFilter(
  role: 'PIPELINE' | 'TILL',
  otherChannel: ProgramList,
  refId: number,
): SQL | undefined {
  return or(
    sql`EXISTS (SELECT 1 FROM discount_program_links l WHERE l.program_id = discount_programs.id AND l.role = ${role} AND l.ref_id = ${refId})`,
    and(
      ne(discountPrograms.list, otherChannel),
      sql`NOT EXISTS (SELECT 1 FROM discount_program_links l WHERE l.program_id = discount_programs.id AND l.role = ${role})`,
    ),
  );
}

function linksOfInput(input: DiscountProgramInput): Links {
  return {
    TARGET: input.targetIds,
    EXCLUDE_TARGET: input.excludeTargetIds,
    EXCLUDE_PRODUCT: input.excludeProductIds,
    PIPELINE: input.pipelineIds,
    TILL: input.tillIds,
  };
}

function auditView(row: ProgramRow, steps: readonly DiscountStep[], links: Links) {
  return {
    name: row.name,
    list: row.list,
    state: row.state,
    priority: row.priority,
    scope: row.scope,
    measure: row.measure,
    effect: row.effect,
    productId: row.productId,
    productUnitId: row.productUnitId,
    thresholdUnitId: row.thresholdUnitId,
    categoryId: row.categoryId,
    countUomId: row.countUomId,
    targetKind: row.targetKind,
    targetIds: links.TARGET,
    excludeTargetIds: links.EXCLUDE_TARGET,
    excludeProductIds: links.EXCLUDE_PRODUCT,
    adjustKind: row.adjustKind,
    adjustFactor: row.adjustFactor,
    pipelineIds: links.PIPELINE,
    tillIds: links.TILL,
    validFrom: row.validFrom,
    validTo: row.validTo,
    steps: steps.map((step) => ({
      threshold: step.threshold.toString(),
      value: step.value.toString(),
      ...(step.rule ? { rule: step.rule } : {}),
    })),
  };
}
