import { Inject, Injectable } from '@nestjs/common';
import { STAFF_ASSORTMENT_LIMITS } from '@tugeel/shared/sales';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { ProductQueryService } from '../../catalog';
import { type AuthContext, actorUserId, AuditService, UserNamesService } from '../../identity';
import {
  staffAppAssortments,
  staffAppAssortmentSegments,
  staffAppAssortmentUsers,
} from '../schema';

export interface StaffAppAssortmentInput {
  title: string;
  segmentIds: readonly number[];
  userIds: readonly number[];
}

export interface StaffAppAssortment {
  id: number;
  title: string;
  /** The live product segments it names, by name. */
  segments: { id: number; name: string }[];
  /** Segments it still names that were archived since: they narrow nothing, a save drops them. */
  goneSegmentCount: number;
  /** The staff it is for, by name; a disabled account stays until the office takes it off. */
  users: { id: number; fullName: string; active: boolean }[];
  updatedAt: Date;
}

/**
 * Which products the staff app shows whom (ADR-0164): a setting is a title, any number of product
 * segments and any number of staff; a staff member sees what all their settings' segments hold, and
 * every sale-ready product when no setting names them. Kept from «Апп → Бараа» with
 * `customer.home.manage` (ADR-0127 #5). Segments have no foreign key (nobody imports segments) and
 * are re-checked on every read through catalog's directory: an archived one narrows nothing.
 */
@Injectable()
export class StaffAppAssortmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly products: ProductQueryService,
    private readonly names: UserNamesService,
  ) {}

  async list(): Promise<StaffAppAssortment[]> {
    const rows = await this.db
      .select()
      .from(staffAppAssortments)
      .where(isNull(staffAppAssortments.deletedAt))
      .orderBy(asc(staffAppAssortments.id));
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const segmentRows = await this.db
      .select()
      .from(staffAppAssortmentSegments)
      .where(inArray(staffAppAssortmentSegments.assortmentId, ids));
    const userRows = await this.db
      .select()
      .from(staffAppAssortmentUsers)
      .where(inArray(staffAppAssortmentUsers.assortmentId, ids));
    const live = await this.liveSegments(segmentRows.map((row) => row.segmentId));
    const people = await this.names.summariesOf(userRows.map((row) => row.userId));
    return rows.map((row) => {
      const named = segmentRows.filter((own) => own.assortmentId === row.id);
      return {
        id: row.id,
        title: row.title,
        segments: named
          .flatMap((own) => {
            const name = live.get(own.segmentId);
            return name === undefined ? [] : [{ id: own.segmentId, name }];
          })
          .sort((a, b) => a.name.localeCompare(b.name, 'mn') || a.id - b.id),
        goneSegmentCount: named.filter((own) => !live.has(own.segmentId)).length,
        users: userRows
          .filter((own) => own.assortmentId === row.id)
          .flatMap((own) => {
            const person = people.get(own.userId);
            return person
              ? [{ id: person.id, fullName: person.fullName, active: person.status === 'ACTIVE' }]
              : [];
          })
          .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn') || a.id - b.id),
        updatedAt: row.updatedAt,
      };
    });
  }

  async create(ctx: AuthContext, input: StaffAppAssortmentInput): Promise<StaffAppAssortment> {
    const checked = await this.checked(input);
    const actor = actorUserId(ctx);
    const id = await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(staffAppAssortments)
        .values({ title: checked.title, createdBy: actor, updatedBy: actor })
        .returning();
      if (!row) throw new Error('staff assortment insert returned no row');
      await this.writeMembers(tx, row.id, checked);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'staff_app_assortments',
        entityId: row.id,
        after: checked,
      });
      return row.id;
    });
    return this.get(id);
  }

  /** Replaces the whole setting; one audit row with what it named before and after. */
  async update(
    ctx: AuthContext,
    id: number,
    input: StaffAppAssortmentInput,
  ): Promise<StaffAppAssortment> {
    const checked = await this.checked(input);
    await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      const members = await this.membersOf(tx, id);
      await tx
        .update(staffAppAssortments)
        .set({ title: checked.title, updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(staffAppAssortments.id, id));
      await tx
        .delete(staffAppAssortmentSegments)
        .where(eq(staffAppAssortmentSegments.assortmentId, id));
      await tx.delete(staffAppAssortmentUsers).where(eq(staffAppAssortmentUsers.assortmentId, id));
      await this.writeMembers(tx, id, checked);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'staff_app_assortments',
        entityId: id,
        before: { title: before.title, ...members },
        after: checked,
      });
    });
    return this.get(id);
  }

  /** Takes a setting away (soft: the row and what it named stay); its staff widen at once. */
  async remove(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      const members = await this.membersOf(tx, id);
      await tx
        .update(staffAppAssortments)
        .set({ deletedAt: sql`now()`, updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(staffAppAssortments.id, id));
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'staff_app_assortments',
        entityId: id,
        before: { title: before.title, ...members },
      });
    });
  }

  /**
   * The live segments a staff member's settings name, or null when nothing narrows their shop: no
   * setting names them, or every segment named was archived since (ADR-0127 #1's rule: the apps
   * keep selling until the office picks another).
   */
  async segmentIdsOf(userId: number): Promise<number[] | null> {
    const rows = await this.db
      .selectDistinct({ segmentId: staffAppAssortmentSegments.segmentId })
      .from(staffAppAssortmentUsers)
      .innerJoin(
        staffAppAssortments,
        and(
          eq(staffAppAssortments.id, staffAppAssortmentUsers.assortmentId),
          isNull(staffAppAssortments.deletedAt),
        ),
      )
      .innerJoin(
        staffAppAssortmentSegments,
        eq(staffAppAssortmentSegments.assortmentId, staffAppAssortmentUsers.assortmentId),
      )
      .where(eq(staffAppAssortmentUsers.userId, userId));
    if (rows.length === 0) return null;
    const live = await this.liveSegments(rows.map((row) => row.segmentId));
    return live.size === 0 ? null : [...live.keys()].sort((a, b) => a - b);
  }

  private async get(id: number): Promise<StaffAppAssortment> {
    const row = (await this.list()).find((own) => own.id === id);
    if (!row) throw notFound('staffAppAssortment', id);
    return row;
  }

  private async liveSegments(ids: readonly number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const live = await this.products.productSegments({ ids: unique });
    return new Map(live.map((segment) => [segment.id, segment.name]));
  }

  private async lock(tx: Tx, id: number) {
    const [row] = await tx
      .select()
      .from(staffAppAssortments)
      .where(and(eq(staffAppAssortments.id, id), isNull(staffAppAssortments.deletedAt)))
      .for('update');
    if (!row) throw notFound('staffAppAssortment', id);
    return row;
  }

  private async membersOf(tx: Tx, id: number) {
    const segments = await tx
      .select({ id: staffAppAssortmentSegments.segmentId })
      .from(staffAppAssortmentSegments)
      .where(eq(staffAppAssortmentSegments.assortmentId, id));
    const users = await tx
      .select({ id: staffAppAssortmentUsers.userId })
      .from(staffAppAssortmentUsers)
      .where(eq(staffAppAssortmentUsers.assortmentId, id));
    return {
      segmentIds: segments.map((row) => row.id).sort((a, b) => a - b),
      userIds: users.map((row) => row.id).sort((a, b) => a - b),
    };
  }

  private async writeMembers(
    tx: Tx,
    id: number,
    members: { segmentIds: readonly number[]; userIds: readonly number[] },
  ): Promise<void> {
    await tx
      .insert(staffAppAssortmentSegments)
      .values(members.segmentIds.map((segmentId) => ({ assortmentId: id, segmentId })));
    await tx
      .insert(staffAppAssortmentUsers)
      .values(members.userIds.map((userId) => ({ assortmentId: id, userId })));
  }

  /** Checked before the transaction: a title, live segments, staff who exist, each once. */
  private async checked(input: StaffAppAssortmentInput) {
    const title = input.title.trim();
    if (title.length === 0 || title.length > STAFF_ASSORTMENT_LIMITS.maxTitle) {
      throw invalid(
        'title',
        'length',
        `a title of 1 to ${STAFF_ASSORTMENT_LIMITS.maxTitle} characters`,
      );
    }
    const segmentIds = [...new Set(input.segmentIds)].sort((a, b) => a - b);
    const userIds = [...new Set(input.userIds)].sort((a, b) => a - b);
    if (segmentIds.length === 0) throw invalid('segmentIds', 'required', 'at least one segment');
    if (userIds.length === 0) throw invalid('userIds', 'required', 'at least one staff member');
    const live = await this.liveSegments(segmentIds);
    if (segmentIds.some((id) => !live.has(id))) {
      throw invalid('segmentIds', 'productSegment', 'live product segments only');
    }
    const people = await this.names.summariesOf(userIds);
    if (userIds.some((id) => !people.has(id))) {
      throw invalid('userIds', 'user', 'staff members who exist');
    }
    return { title, segmentIds, userIds };
  }
}
