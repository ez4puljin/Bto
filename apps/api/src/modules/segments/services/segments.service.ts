import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_SEGMENT_COUNTS,
  MAX_SEGMENT_DESCRIPTION,
  MAX_SEGMENT_NAME,
  SEGMENT_DEFINITION_VERSION,
  type SegmentDefinition,
  type SegmentEntity,
  type SegmentKind,
} from '@tugeel/shared/segments';
import type { Permission } from '@tugeel/shared/auth';
import { nameKey } from '@tugeel/shared/text';
import { and, asc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CategoriesService } from '../../catalog';
import { actorUserId, type AuthContext, AuditService, OrgService } from '../../identity';
import { SuppliersService } from '../../partners';
import { PriceProfilesService } from '../../pricing';
import { segments } from '../schema';
import { checkedDefinition, SegmentEvaluator, type SegmentRow } from './segment-evaluator';

const CUSTOMERS_READ: Permission = 'partners.customers.read';

export interface SegmentInput {
  name: string;
  description?: string | null;
  /** A RULES segment's conditions; a LIST segment takes none (ADR-0052). */
  definition?: unknown;
}

export interface Segment {
  id: number;
  entity: SegmentEntity;
  kind: SegmentKind;
  name: string;
  description: string | null;
  /** Null for a LIST segment (ADR-0052). */
  definition: SegmentDefinition | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Segments (ADR-0049 #5): admins (`segments.manage`) create, change and archive them; every
 * signed-in user reads them and their counts. Customer segments, their counts and previews need
 * `partners.customers.read` as well. A segment is archived, never deleted. A hand-picked (LIST)
 * segment changes only its name and description here; `SegmentListsService` creates it and
 * changes its members (ADR-0052).
 */
@Injectable()
export class SegmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly evaluator: SegmentEvaluator,
    private readonly categories: CategoriesService,
    private readonly suppliers: SuppliersService,
    private readonly org: OrgService,
    private readonly profiles: PriceProfilesService,
  ) {}

  /** Live segments by name, the caller's readable entities only. */
  async list(
    ctx: AuthContext,
    query: { entity?: SegmentEntity; cursor?: string; limit?: number },
  ): Promise<{ data: Segment[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [isNull(segments.archivedAt)];
    if (query.entity) filters.push(eq(segments.entity, query.entity));
    if (!ctx.permissions.has(CUSTOMERS_READ)) filters.push(sql`${segments.entity} <> 'CUSTOMER'`);
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') {
      filters.push(
        sql`(${segments.name}, ${segments.id}) > ((SELECT name FROM ${segments} WHERE id = ${after.id}), ${after.id})`,
      );
    }
    const rows = await this.db
      .select()
      .from(segments)
      .where(and(...filters))
      .orderBy(asc(segments.name), asc(segments.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: page.data.map(toSegment), nextCursor: page.nextCursor };
  }

  async get(ctx: AuthContext, id: number): Promise<Segment> {
    return toSegment(await this.readable(ctx, id));
  }

  /** How many records each segment keeps; null for one the caller may not count. */
  async counts(
    ctx: AuthContext,
    ids: readonly number[],
  ): Promise<{ segmentId: number; count: number | null }[]> {
    if (ids.length > MAX_SEGMENT_COUNTS) {
      throw invalid('segmentIds', 'arrayMaxSize', `at most ${MAX_SEGMENT_COUNTS} segments`);
    }
    const result: { segmentId: number; count: number | null }[] = [];
    for (const id of [...new Set(ids)]) {
      const [row] = await this.db.select().from(segments).where(eq(segments.id, id));
      const readable =
        row !== undefined &&
        row.archivedAt === null &&
        (row.entity !== 'CUSTOMER' || ctx.permissions.has(CUSTOMERS_READ));
      if (!readable) {
        result.push({ segmentId: id, count: null });
        continue;
      }
      try {
        result.push({ segmentId: id, count: await this.evaluator.count(ctx, row) });
      } catch (error) {
        if (error instanceof AppError && error.code === 'SEGMENT_INVALID') {
          result.push({ segmentId: id, count: null });
        } else {
          throw error;
        }
      }
    }
    return result;
  }

  /** The live count of conditions not saved yet (the editor). */
  async preview(ctx: AuthContext, entity: SegmentEntity, definition: unknown): Promise<number> {
    this.assertEntityReadable(ctx, entity);
    const checked = checkedDefinition(entity, definition, 'definition');
    return (await this.evaluator.evaluate(ctx, entity, checked)).length;
  }

  async create(ctx: AuthContext, entity: SegmentEntity, input: SegmentInput): Promise<Segment> {
    this.assertEntityReadable(ctx, entity);
    const values = checkedInput(input);
    const definition = checkedDefinition(entity, input.definition, 'definition');
    await this.assertReferences(entity, definition);
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(segments)
        .values({
          entity,
          kind: 'RULES',
          name: values.name,
          nameKey: nameKey(values.name),
          description: values.description,
          definition: plain(definition),
          definitionVersion: SEGMENT_DEFINITION_VERSION,
          createdBy: actorUserId(ctx),
          updatedBy: actorUserId(ctx),
        })
        .returning();
      if (!row) throw new Error('segment insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'segments',
        entityId: row.id,
        after: auditView(row),
      });
      return toSegment(row);
    });
  }

  async update(ctx: AuthContext, id: number, input: SegmentInput): Promise<Segment> {
    const values = checkedInput(input);
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx.select().from(segments).where(eq(segments.id, id)).for('update');
      if (!before || before.archivedAt) throw notFound('segment', id);
      this.assertEntityReadable(ctx, before.entity);
      // A list changes its name and description only; its members have their own routes.
      let rules: { definition: SegmentDefinition; definitionVersion: number } | null = null;
      if (before.kind === 'LIST') {
        if (input.definition !== undefined) {
          throw invalid('definition', 'notAllowed', `segment ${id} is a list of products`);
        }
      } else {
        if (input.definition === undefined) {
          throw invalid('definition', 'required', `segment ${id} keeps conditions`);
        }
        const definition = checkedDefinition(before.entity, input.definition, 'definition');
        await this.assertReferences(before.entity, definition);
        rules = { definition: plain(definition), definitionVersion: SEGMENT_DEFINITION_VERSION };
      }
      const [row] = await tx
        .update(segments)
        .set({
          name: values.name,
          nameKey: nameKey(values.name),
          description: values.description,
          ...(rules ?? {}),
          updatedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        })
        .where(eq(segments.id, id))
        .returning();
      if (!row) throw notFound('segment', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'segments',
        entityId: id,
        before: auditView(before),
        after: auditView(row),
      });
      return toSegment(row);
    });
  }

  /** Archives a segment; an archived one is no longer listed, counted or usable as a filter. */
  async archive(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx.select().from(segments).where(eq(segments.id, id)).for('update');
      if (!before) throw notFound('segment', id);
      this.assertEntityReadable(ctx, before.entity);
      if (before.archivedAt) return;
      await tx
        .update(segments)
        .set({ archivedAt: sql`now()`, updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(segments.id, id));
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'segments',
        entityId: id,
        before: auditView(before),
      });
    });
  }

  /** A live segment of an entity the caller may read. */
  private async readable(ctx: AuthContext, id: number): Promise<SegmentRow> {
    const [row] = await this.db.select().from(segments).where(eq(segments.id, id));
    if (!row || row.archivedAt) throw notFound('segment', id);
    this.assertEntityReadable(ctx, row.entity);
    return row;
  }

  private assertEntityReadable(ctx: AuthContext, entity: SegmentEntity): void {
    if (entity === 'CUSTOMER' && !ctx.permissions.has(CUSTOMERS_READ)) {
      throw new AppError('FORBIDDEN', 'customer segments need partners.customers.read', {
        permission: CUSTOMERS_READ,
      });
    }
  }

  /** Ids a definition names must exist: categories, suppliers, warehouses, price profiles. */
  private async assertReferences(
    entity: SegmentEntity,
    definition: SegmentDefinition,
  ): Promise<void> {
    if (entity !== 'PRODUCT') return;
    let categories: Set<number> | null = null;
    let warehouses: Set<number> | null = null;
    for (const [g, group] of definition.groups.entries()) {
      for (const [c, condition] of group.conditions.entries()) {
        const at = `definition.groups.${g}.conditions.${c}`;
        const ids = condition.ids ?? [];
        let known: Set<number>;
        if (condition.field === 'category' && ids.length) {
          categories ??= new Set((await this.categories.list()).map((category) => category.id));
          known = categories;
        } else if (condition.field === 'supplier' && ids.length) {
          known = new Set((await this.suppliers.getMany(ids)).map((supplier) => supplier.id));
        } else if (condition.field === 'priceProfile' && ids.length) {
          known = new Set((await this.profiles.namesOf(ids)).keys());
        } else if (condition.field === 'homeWarehouse' || condition.warehouseId !== undefined) {
          warehouses ??= new Set(
            (await this.org.listWarehouses()).map((warehouse) => warehouse.id),
          );
          known = warehouses;
          if (condition.warehouseId !== undefined && !known.has(condition.warehouseId)) {
            throw invalid(`${at}.warehouseId`, 'exists', `warehouse ${condition.warehouseId}`);
          }
        } else {
          continue;
        }
        const missing = ids.find((id) => !known.has(id));
        if (missing !== undefined) throw invalid(`${at}.ids`, 'exists', `id ${missing} not found`);
      }
    }
  }
}

/** A segment's name and description, trimmed; 422 outside their lengths. */
export function checkedInput(input: { name: string; description?: string | null }): {
  name: string;
  description: string | null;
} {
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_SEGMENT_NAME) {
    throw invalid('name', 'length', `1 to ${MAX_SEGMENT_NAME} characters`);
  }
  const description = input.description?.trim() ?? '';
  if (description.length > MAX_SEGMENT_DESCRIPTION) {
    throw invalid('description', 'length', `at most ${MAX_SEGMENT_DESCRIPTION} characters`);
  }
  return { name, description: description || null };
}

/** The definition as plain JSON (a validated DTO instance stores its own fields only). */
function plain(definition: SegmentDefinition): SegmentDefinition {
  return JSON.parse(JSON.stringify(definition)) as SegmentDefinition;
}

export function toSegment(row: SegmentRow): Segment {
  return {
    id: row.id,
    entity: row.entity,
    kind: row.kind,
    name: row.name,
    description: row.description,
    definition: row.definition === null ? null : (row.definition as SegmentDefinition),
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function auditView(row: SegmentRow) {
  return {
    entity: row.entity,
    kind: row.kind,
    name: row.name,
    description: row.description,
    definition: row.definition,
    archivedAt: row.archivedAt,
  };
}
