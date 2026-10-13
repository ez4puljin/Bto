import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import {
  type DiscountEffect,
  type DiscountMeasure,
  type DiscountScope,
  type DiscountShapeIssue,
  type DiscountStep,
  discountShapeIssue,
  discountStepsIssue,
  type PriceList,
} from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  CatalogService,
  CategoriesService,
  type UnitInfo,
  UnitConversionService,
  UomsService,
} from '../../catalog';
import { type Actor, actorUserId, AuditService } from '../../identity';
import { discountPrograms, discountSteps } from '../schema';
import { applied, assertNotPast } from './support';

type ProgramRow = typeof discountPrograms.$inferSelect;

/** Relative to today: not started, in force, or ended (a program stopped on its first day too). */
export const PROGRAM_STATUSES = ['SCHEDULED', 'ACTIVE', 'ENDED'] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export interface DiscountProgramInput {
  name: string;
  list: PriceList;
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  productId: number | null;
  productUnitId: number | null;
  thresholdUnitId: number | null;
  categoryId: number | null;
  countUomId: number | null;
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

export interface DiscountProgram {
  id: number;
  name: string;
  list: PriceList;
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  product: { id: number; sku: string; name: string } | null;
  productUnit: ProgramUnit | null;
  thresholdUnit: ProgramUnit | null;
  categoryId: number | null;
  countUomId: number | null;
  validFrom: string;
  validTo: string | null;
  status: ProgramStatus;
  steps: DiscountStep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgramQuery {
  list?: PriceList;
  scope?: DiscountScope;
  status?: ProgramStatus;
  productId?: number;
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
  productId: number | null;
  productUnitId: number | null;
  categoryId: number | null;
  countUomId: number | null;
  steps: DiscountStep[];
}

const SHAPE_PATHS: Record<DiscountShapeIssue, string> = {
  PRODUCT_REQUIRED: 'productId',
  UNIT_REQUIRED: 'productUnitId',
  CATEGORY_REQUIRED: 'categoryId',
  COUNT_UNIT_REQUIRED: 'countUomId',
  MEASURE_NOT_ALLOWED: 'measure',
  EFFECT_NOT_ALLOWED: 'effect',
  TARGET_NOT_ALLOWED: 'scope',
};

/**
 * Discount programs (ADR-0041 #2): created for today or later, edited or deleted only before they
 * start, stopped at any time after. Every program in force applies to a quote.
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
  ) {}

  async get(id: number, executor: Db | Tx = this.db): Promise<DiscountProgram> {
    const [row] = await executor.select().from(discountPrograms).where(eq(discountPrograms.id, id));
    if (!row) throw notFound('discount program', id);
    const [program] = await this.views([row], executor);
    if (!program) throw notFound('discount program', id);
    return program;
  }

  /** Newest first; filtered by list, scope, product or status (relative to today). */
  async list(query: ProgramQuery): Promise<{ data: DiscountProgram[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const today = businessDate();
    const filters: SQL[] = [];
    if (query.list) filters.push(eq(discountPrograms.list, query.list));
    if (query.scope) filters.push(eq(discountPrograms.scope, query.scope));
    if (query.productId) filters.push(eq(discountPrograms.productId, query.productId));
    if (query.status) filters.push(statusFilter(query.status, today));
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
    const values = await this.checked(input);
    const id = await inTransaction(this.db, async (tx) => {
      const [row] = await this.mapOverlap(
        tx
          .insert(discountPrograms)
          .values({ ...values, createdBy: actorUserId(actor) })
          .returning(),
      );
      if (!row) throw new Error('discount program insert returned no row');
      await this.insertSteps(tx, row.id, input.steps);
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'discount_programs',
        entityId: row.id,
        after: auditView(row, input.steps),
      });
      return row.id;
    });
    return this.get(id);
  }

  /** Only before the program starts (DISCOUNT_PROGRAM_STARTED after): the whole program replaced. */
  async update(actor: Actor, id: number, input: DiscountProgramInput): Promise<DiscountProgram> {
    const values = await this.checked(input);
    await inTransaction(this.db, async (tx) => {
      const before = await this.lockNotStarted(tx, id);
      const beforeSteps = await this.stepsOf(tx, [id]);
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
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'discount_programs',
        entityId: id,
        before: auditView(before, beforeSteps.get(id) ?? []),
        after: auditView(row, input.steps),
      });
    });
    return this.get(id);
  }

  /**
   * Ends a program now: in force, it stops applying today; not started, it never will. An ended
   * program is left as it is.
   */
  async stop(actor: Actor, id: number): Promise<DiscountProgram> {
    const today = businessDate();
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(discountPrograms)
        .where(eq(discountPrograms.id, id))
        .for('update');
      if (!row) throw notFound('discount program', id);
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

  /** Only before the program starts (DISCOUNT_PROGRAM_STARTED after). */
  async remove(actor: Actor, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const row = await this.lockNotStarted(tx, id);
      const steps = await this.stepsOf(tx, [id]);
      await tx.delete(discountPrograms).where(eq(discountPrograms.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'discount_programs',
        entityId: id,
        before: auditView(row, steps.get(id) ?? []),
      });
    });
  }

  /** The programs of a list in force on a date, with their steps (ascending thresholds). */
  async inForce(
    list: PriceList,
    date: string,
    executor: Db | Tx = this.db,
  ): Promise<ProgramInForce[]> {
    const rows = await executor
      .select()
      .from(discountPrograms)
      .where(
        and(
          eq(discountPrograms.list, list),
          lte(discountPrograms.validFrom, date),
          or(isNull(discountPrograms.validTo), gt(discountPrograms.validTo, date)),
        ),
      );
    const steps = await this.stepsOf(
      executor,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      measure: row.measure,
      effect: row.effect,
      productId: row.productId,
      productUnitId: row.productUnitId,
      categoryId: row.categoryId,
      countUomId: row.countUomId,
      steps: steps.get(row.id) ?? [],
    }));
  }

  /**
   * A superseded unit (ADR-0041 #1): programs on it stop today, planned ones never start; a new
   * price for the new unit is a new program.
   */
  async closeForUnitInTx(tx: Tx, actor: Actor, unitId: number, today: string): Promise<number> {
    const open = await tx
      .select()
      .from(discountPrograms)
      .where(
        and(
          eq(discountPrograms.productUnitId, unitId),
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

  /** Validates an input against the shape rules, its steps, its dates and its targets. */
  private async checked(input: DiscountProgramInput) {
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
    assertNotPast('validFrom', input.validFrom);
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
    return {
      name,
      list: input.list,
      scope: input.scope,
      measure: input.measure,
      effect: input.effect,
      productId: input.productId,
      productUnitId: input.productUnitId,
      thresholdUnitId: input.thresholdUnitId,
      categoryId: input.categoryId,
      countUomId: input.countUomId,
      validFrom: input.validFrom,
      validTo: input.validTo,
    };
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

  private async lockNotStarted(tx: Tx, id: number): Promise<ProgramRow> {
    const [row] = await tx
      .select()
      .from(discountPrograms)
      .where(eq(discountPrograms.id, id))
      .for('update');
    if (!row) throw notFound('discount program', id);
    if (row.validFrom <= businessDate()) {
      throw new AppError('DISCOUNT_PROGRAM_STARTED', `discount program ${id} has started`, {
        id,
      });
    }
    return row;
  }

  private async insertSteps(tx: Tx, programId: number, steps: readonly DiscountStep[]) {
    await tx
      .insert(discountSteps)
      .values(steps.map((step) => ({ programId, threshold: step.threshold, value: step.value })));
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
        { threshold: row.threshold, value: row.value },
      ]);
    }
    return result;
  }

  private async views(
    rows: readonly ProgramRow[],
    executor: Db | Tx = this.db,
  ): Promise<DiscountProgram[]> {
    if (rows.length === 0) return [];
    const today = businessDate();
    const steps = await this.stepsOf(
      executor,
      rows.map((row) => row.id),
    );
    const productIds = [...new Set(rows.flatMap((row) => (row.productId ? [row.productId] : [])))];
    const products = new Map(
      (await this.catalog.getMany(productIds, executor)).map((product) => [product.id, product]),
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
    return rows.map((row) => {
      const product = row.productId ? products.get(row.productId) : undefined;
      return {
        id: row.id,
        name: row.name,
        list: row.list,
        scope: row.scope,
        measure: row.measure,
        effect: row.effect,
        product: product ? { id: product.id, sku: product.sku, name: product.name } : null,
        productUnit: unitOf(row.productUnitId),
        thresholdUnit: unitOf(row.thresholdUnitId),
        categoryId: row.categoryId,
        countUomId: row.countUomId,
        validFrom: row.validFrom,
        validTo: row.validTo,
        status: statusOf(row, today),
        steps: steps.get(row.id) ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}

export function statusOf(
  row: { validFrom: string; validTo: string | null },
  today: string,
): ProgramStatus {
  if (row.validTo !== null && row.validTo <= today) return 'ENDED';
  if (!applied(row)) return 'ENDED';
  return row.validFrom > today ? 'SCHEDULED' : 'ACTIVE';
}

function statusFilter(status: ProgramStatus, today: string): SQL {
  const notVoid = or(
    isNull(discountPrograms.validTo),
    gt(discountPrograms.validTo, discountPrograms.validFrom),
  );
  switch (status) {
    case 'SCHEDULED':
      return and(gt(discountPrograms.validFrom, today), notVoid) as SQL;
    case 'ACTIVE':
      return and(
        lte(discountPrograms.validFrom, today),
        or(isNull(discountPrograms.validTo), gt(discountPrograms.validTo, today)),
      ) as SQL;
    case 'ENDED':
      return or(
        lte(discountPrograms.validTo, today),
        sql`${discountPrograms.validTo} = ${discountPrograms.validFrom}`,
      ) as SQL;
  }
}

function auditView(row: ProgramRow, steps: readonly DiscountStep[]) {
  return {
    name: row.name,
    list: row.list,
    scope: row.scope,
    measure: row.measure,
    effect: row.effect,
    productId: row.productId,
    productUnitId: row.productUnitId,
    thresholdUnitId: row.thresholdUnitId,
    categoryId: row.categoryId,
    countUomId: row.countUomId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    steps: steps.map((step) => ({
      threshold: step.threshold.toString(),
      value: step.value.toString(),
    })),
  };
}
