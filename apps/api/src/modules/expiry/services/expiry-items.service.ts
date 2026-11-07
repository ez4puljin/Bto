import { Inject, Injectable } from '@nestjs/common';
import {
  type ExpiryLiabilityType,
  type ExpiryStatus,
  isExpiryDateInRange,
} from '@tugeel/shared/expiry';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, ne } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService } from '../../catalog';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { expiryItemChanges, expiryItemRoles, expiryItems, expiryItemUsers } from '../schema';
import { type ExpiryItemRow, type ExpiryItemView, ExpiryViewService } from './expiry-view.service';

export interface ExpiryCreateInput {
  productId: number;
  expiryDate: string;
  qtyFloor: string;
  qtyWarehouse: string;
  note?: string;
  allowDuplicate?: boolean;
}

export interface ExpiryPatchInput {
  expectedVersion: number;
  expiryDate?: string;
  qtyFloor?: string;
  qtyWarehouse?: string;
  note?: string;
}

export interface ExpiryLiabilityInput {
  type: ExpiryLiabilityType;
  roleIds: readonly number[];
  userIds: readonly number[];
  note?: string;
}

/** A note as it is stored: trimmed, and NULL when nothing is left. */
export function noteOf(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** What a record stores of a liability's roles or people: only SPECIFIC names anyone. */
export function liableIds(type: ExpiryLiabilityType, ids: readonly number[]): number[] {
  return type === 'SPECIFIC' ? [...new Set(ids)].sort((a, b) => a - b) : [];
}

export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Recording and deciding (ADR-0172 #3–#6). A record is never deleted, a quantity's change adds a
 * history row, and every write is audited in its transaction. The stock ledger is never touched.
 */
@Injectable()
export class ExpiryItemsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly views: ExpiryViewService,
    private readonly catalog: CatalogService,
    private readonly names: UserNamesService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: AuthContext, input: ExpiryCreateInput): Promise<ExpiryItemView> {
    assertDateInRange(input.expiryDate);
    const qtyFloor = new Decimal(input.qtyFloor);
    const qtyWarehouse = new Decimal(input.qtyWarehouse);
    if (qtyFloor.isZero() && qtyWarehouse.isZero()) {
      throw invalid('qtyFloor', 'positive', 'a record starts with at least one positive quantity');
    }
    const row = await inTransaction(this.db, async (tx) => {
      await this.assertWhole(tx, input.productId, [
        ['qtyFloor', qtyFloor],
        ['qtyWarehouse', qtyWarehouse],
      ]);
      if (!input.allowDuplicate) {
        const [same] = await tx
          .select({ id: expiryItems.id })
          .from(expiryItems)
          .where(
            and(
              eq(expiryItems.productId, input.productId),
              eq(expiryItems.expiryDate, input.expiryDate),
              ne(expiryItems.status, 'ARCHIVED'),
            ),
          )
          .orderBy(desc(expiryItems.id))
          .limit(1);
        if (same) {
          throw new AppError(
            'EXPIRY_ITEM_EXISTS',
            `open record ${same.id} has this product and date`,
            { itemId: same.id },
          );
        }
      }
      const [created] = await tx
        .insert(expiryItems)
        .values({
          productId: input.productId,
          expiryDate: input.expiryDate,
          qtyFloor,
          qtyWarehouse,
          note: noteOf(input.note),
          createdBy: ctx.userId,
          createdByName: ctx.fullName,
          updatedBy: ctx.userId,
        })
        .returning();
      if (!created) throw new Error('expiry item insert returned nothing');
      await tx.insert(expiryItemChanges).values({
        itemId: created.id,
        kind: 'CREATE',
        qtyFloorOld: qtyFloor,
        qtyFloorNew: qtyFloor,
        qtyWarehouseOld: qtyWarehouse,
        qtyWarehouseNew: qtyWarehouse,
        changedBy: ctx.userId,
        changedByName: ctx.fullName,
      });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'expiry_items',
        entityId: created.id,
        after: created,
      });
      return created;
    });
    return this.views.view(row);
  }

  /**
   * A correction (ADR-0172 #6): refused when someone edited the record since the screen read it.
   * Only what differs is checked, so a carried record outside today's rules can still be corrected;
   * asking for what already stands writes nothing.
   */
  async patch(ctx: AuthContext, id: number, input: ExpiryPatchInput): Promise<ExpiryItemView> {
    const row = await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      if (before.status === 'ARCHIVED') throw archived(id);
      if (before.editVersion !== input.expectedVersion) {
        throw new AppError(
          'EXPIRY_ITEM_CHANGED',
          `record ${id} is at version ${before.editVersion}, not ${input.expectedVersion}`,
          { currentVersion: before.editVersion },
        );
      }
      const expiryDate = input.expiryDate ?? before.expiryDate;
      const qtyFloor = input.qtyFloor ? new Decimal(input.qtyFloor) : before.qtyFloor;
      const qtyWarehouse = input.qtyWarehouse
        ? new Decimal(input.qtyWarehouse)
        : before.qtyWarehouse;
      const note = input.note === undefined ? before.note : noteOf(input.note);

      const dateChanged = expiryDate !== before.expiryDate;
      const floorChanged = !qtyFloor.eq(before.qtyFloor);
      const warehouseChanged = !qtyWarehouse.eq(before.qtyWarehouse);
      if (!dateChanged && !floorChanged && !warehouseChanged && note === before.note) return before;

      if (dateChanged) assertDateInRange(expiryDate);
      if (floorChanged || warehouseChanged) {
        await this.assertWhole(tx, before.productId, [
          ...(floorChanged ? ([['qtyFloor', qtyFloor]] as const) : []),
          ...(warehouseChanged ? ([['qtyWarehouse', qtyWarehouse]] as const) : []),
        ]);
      }
      const [after] = await tx
        .update(expiryItems)
        .set({
          expiryDate,
          qtyFloor,
          qtyWarehouse,
          note,
          editVersion: before.editVersion + 1,
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        })
        .where(eq(expiryItems.id, id))
        .returning();
      if (!after) throw notFound('expiry item', id);
      if (floorChanged || warehouseChanged) {
        await tx.insert(expiryItemChanges).values({
          itemId: id,
          kind: 'UPDATE',
          qtyFloorOld: before.qtyFloor,
          qtyFloorNew: qtyFloor,
          qtyWarehouseOld: before.qtyWarehouse,
          qtyWarehouseNew: qtyWarehouse,
          changedBy: ctx.userId,
          changedByName: ctx.fullName,
        });
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'expiry_items',
        entityId: id,
        before,
        after,
      });
      return after;
    });
    return this.views.view(row);
  }

  /**
   * What happens to the goods. An archived record is read-only until it is restored, which puts it
   * back in REVIEW (ADR-0172 #3); this leaves the edit version alone (#6).
   */
  async setStatus(ctx: AuthContext, id: number, status: ExpiryStatus): Promise<ExpiryItemView> {
    const row = await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      if (before.status === status) return before;
      const restoring = before.status === 'ARCHIVED';
      if (restoring && status !== 'REVIEW') throw archived(id);
      const archiving = status === 'ARCHIVED';
      const now = new Date();
      const [after] = await tx
        .update(expiryItems)
        .set({
          status,
          archivedAt: archiving ? now : null,
          archivedBy: archiving ? ctx.userId : null,
          archivedByName: archiving ? ctx.fullName : null,
          updatedAt: now,
          updatedBy: ctx.userId,
        })
        .where(eq(expiryItems.id, id))
        .returning();
      if (!after) throw notFound('expiry item', id);
      await this.audit.record(tx, ctx, {
        action: archiving ? 'ARCHIVE' : restoring ? 'UNARCHIVE' : 'UPDATE',
        entity: 'expiry_items',
        entityId: id,
        before: { status: before.status },
        after: { status },
      });
      return after;
    });
    return this.views.view(row);
  }

  /**
   * Who is liable (ADR-0172 #4): the roles and people are replaced whole, SPECIFIC needs one of
   * them, and NONE leaves no note behind. Allowed on an archived record; the version stays.
   */
  async setLiability(
    ctx: AuthContext,
    id: number,
    input: ExpiryLiabilityInput,
  ): Promise<ExpiryItemView> {
    const roleIds = liableIds(input.type, input.roleIds);
    const userIds = liableIds(input.type, input.userIds);
    if (input.type === 'SPECIFIC' && roleIds.length === 0 && userIds.length === 0) {
      throw invalid('roleIds', 'required', 'a specific liability names a role or a person');
    }
    const note = input.type === 'NONE' ? null : noteOf(input.note);
    const row = await inTransaction(this.db, async (tx) => {
      const before = await this.lock(tx, id);
      const held = await this.liableOf(tx, id);
      if (
        before.liabilityType === input.type &&
        before.liabilityNote === note &&
        sameIds(held.roleIds, roleIds) &&
        sameIds(held.userIds, userIds)
      ) {
        return before;
      }
      await this.assertLiable(tx, roleIds, userIds);
      const [after] = await tx
        .update(expiryItems)
        .set({
          liabilityType: input.type,
          liabilityNote: note,
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        })
        .where(eq(expiryItems.id, id))
        .returning();
      if (!after) throw notFound('expiry item', id);
      await this.replaceLiable(tx, id, roleIds, userIds);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'expiry_items',
        entityId: id,
        before: {
          liabilityType: before.liabilityType,
          liabilityNote: before.liabilityNote,
          ...held,
        },
        after: { liabilityType: input.type, liabilityNote: note, roleIds, userIds },
      });
      return after;
    });
    return this.views.view(row);
  }

  /** The people and roles a choice names must exist; a foreign key would answer with a 500. */
  async assertLiable(
    tx: Tx,
    roleIds: readonly number[],
    userIds: readonly number[],
  ): Promise<void> {
    const roles = await this.names.rolesBrief(roleIds, tx);
    if (roles.length !== roleIds.length) {
      throw invalid('roleIds', 'exists', 'a role of this liability does not exist');
    }
    const people = await this.names.namesOf(userIds, tx);
    if (people.size !== userIds.length) {
      throw invalid('userIds', 'exists', 'a person of this liability does not exist');
    }
  }

  /** A record's liable roles and people, ascending. */
  async liableOf(tx: Tx, itemId: number): Promise<{ roleIds: number[]; userIds: number[] }> {
    const roles = await tx
      .select({ id: expiryItemRoles.roleId })
      .from(expiryItemRoles)
      .where(eq(expiryItemRoles.itemId, itemId))
      .orderBy(expiryItemRoles.roleId);
    const people = await tx
      .select({ id: expiryItemUsers.userId })
      .from(expiryItemUsers)
      .where(eq(expiryItemUsers.itemId, itemId))
      .orderBy(expiryItemUsers.userId);
    return { roleIds: roles.map((row) => row.id), userIds: people.map((row) => row.id) };
  }

  /** Replaces a record's liable roles and people whole. */
  async replaceLiable(
    tx: Tx,
    itemId: number,
    roleIds: readonly number[],
    userIds: readonly number[],
  ): Promise<void> {
    await tx.delete(expiryItemRoles).where(eq(expiryItemRoles.itemId, itemId));
    await tx.delete(expiryItemUsers).where(eq(expiryItemUsers.itemId, itemId));
    if (roleIds.length > 0) {
      await tx.insert(expiryItemRoles).values(roleIds.map((roleId) => ({ itemId, roleId })));
    }
    if (userIds.length > 0) {
      await tx.insert(expiryItemUsers).values(userIds.map((userId) => ({ itemId, userId })));
    }
  }

  private async lock(tx: Tx, id: number): Promise<ExpiryItemRow> {
    const [row] = await tx.select().from(expiryItems).where(eq(expiryItems.id, id)).for('update');
    if (!row) throw notFound('expiry item', id);
    return row;
  }

  /** Whole quantities unless the product's base unit is fractional (ADR-0172 #2). */
  private async assertWhole(
    tx: Tx,
    productId: number,
    quantities: readonly (readonly [string, Decimal])[],
  ): Promise<void> {
    const product = await this.catalog.get(productId, tx);
    if (product.units.find((unit) => unit.isBase)?.fractional) return;
    for (const [path, value] of quantities) {
      if (!value.isInteger()) {
        throw invalid(path, 'whole', `${path} must be whole: the base unit is not fractional`);
      }
    }
  }
}

function archived(id: number): AppError {
  return new AppError('EXPIRY_ITEM_ARCHIVED', `record ${id} is archived`);
}

function assertDateInRange(date: string): void {
  if (!isExpiryDateInRange(date, businessDate())) {
    throw invalid('expiryDate', 'range', 'the date is too far back or too far ahead');
  }
}
