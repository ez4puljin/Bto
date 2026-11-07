import { Inject, Injectable } from '@nestjs/common';
import type {
  ExpiryCarryOutcome,
  ExpiryChangeKind,
  ExpiryLiabilityType,
  ExpiryStatus,
} from '@tugeel/shared/expiry';
import { Decimal } from '@tugeel/shared/money';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { CatalogService } from '../../catalog';
import { AuditService, type AuthContext } from '../../identity';
import { expiryItemChanges, expiryItems } from '../schema';
import { ExpiryItemsService, liableIds, noteOf, sameIds } from './expiry-items.service';
import type { ExpiryItemRow } from './expiry-view.service';

export interface ExpiryCarriedChange {
  legacyId: number;
  kind: ExpiryChangeKind;
  qtyFloorOld: string;
  qtyFloorNew: string;
  qtyWarehouseOld: string;
  qtyWarehouseNew: string;
  changedAt: string;
  changedByName: string;
}

export interface ExpiryCarryInput {
  legacyId: number;
  productId: number;
  expiryDate: string;
  qtyFloor: string;
  qtyWarehouse: string;
  status: ExpiryStatus;
  liabilityType: ExpiryLiabilityType;
  liabilityRoleIds: readonly number[];
  liabilityUserIds: readonly number[];
  liabilityNote?: string;
  note?: string;
  createdAt: string;
  createdByName: string;
  archivedAt?: string;
  archivedByName?: string;
  history: readonly ExpiryCarriedChange[];
}

const timeOf = (value: Date | null): number | null => value?.getTime() ?? null;

/**
 * One old record into the register (ADR-0172 #12), idempotent on the old id: no date range, duplicate
 * or positive-quantity check, since the old data is what it is. It keeps what the ordinary routes
 * cannot: the old author's name, the dates and the history. A row someone touched in Bto is left
 * alone; old changes not yet present are appended in every case.
 */
@Injectable()
export class ExpiryCarryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly items: ExpiryItemsService,
    private readonly audit: AuditService,
  ) {}

  async carry(
    ctx: AuthContext,
    input: ExpiryCarryInput,
  ): Promise<{ id: number; outcome: ExpiryCarryOutcome }> {
    const isArchived = input.status === 'ARCHIVED';
    const createdAt = new Date(input.createdAt);
    // An old row archived without a time still has to satisfy the record's own rule.
    const archivedAt = isArchived ? new Date(input.archivedAt ?? input.createdAt) : null;
    const wanted = {
      productId: input.productId,
      expiryDate: input.expiryDate,
      qtyFloor: new Decimal(input.qtyFloor),
      qtyWarehouse: new Decimal(input.qtyWarehouse),
      status: input.status,
      liabilityType: input.liabilityType,
      liabilityNote: noteOf(input.liabilityNote),
      note: noteOf(input.note),
      createdAt,
      createdByName: input.createdByName,
      archivedAt,
      archivedByName: isArchived ? noteOf(input.archivedByName) : null,
    };
    const roleIds = liableIds(input.liabilityType, input.liabilityRoleIds);
    const userIds = liableIds(input.liabilityType, input.liabilityUserIds);

    return inTransaction(this.db, async (tx) => {
      const [product] = await this.catalog.getMany([input.productId], tx);
      if (!product) throw invalid('productId', 'exists', `product ${input.productId} not found`);
      await this.items.assertLiable(tx, roleIds, userIds);

      const [existing] = await tx
        .select()
        .from(expiryItems)
        .where(eq(expiryItems.legacyId, input.legacyId))
        .for('update');

      if (!existing) {
        const [created] = await tx
          .insert(expiryItems)
          .values({ ...wanted, legacyId: input.legacyId, updatedAt: createdAt })
          .returning({ id: expiryItems.id });
        if (!created) throw new Error('expiry item insert returned nothing');
        await this.items.replaceLiable(tx, created.id, roleIds, userIds);
        const appended = await this.appendHistory(tx, created.id, input.history);
        await this.record(tx, ctx, created.id, 'CREATED', appended, input.legacyId);
        return { id: created.id, outcome: 'CREATED' };
      }

      let outcome: ExpiryCarryOutcome = 'KEPT';
      if (existing.updatedBy === null) {
        const held = await this.items.liableOf(tx, existing.id);
        const differs =
          differsFrom(existing, wanted) ||
          !sameIds(held.roleIds, roleIds) ||
          !sameIds(held.userIds, userIds);
        outcome = differs ? 'UPDATED' : 'UNCHANGED';
        if (differs) {
          // A screen holding the older values must not overwrite these silently (ADR-0172 #6).
          const edited =
            existing.expiryDate !== wanted.expiryDate ||
            !existing.qtyFloor.eq(wanted.qtyFloor) ||
            !existing.qtyWarehouse.eq(wanted.qtyWarehouse) ||
            existing.note !== wanted.note;
          await tx
            .update(expiryItems)
            .set({
              ...wanted,
              editVersion: existing.editVersion + (edited ? 1 : 0),
              updatedAt: new Date(),
            })
            .where(eq(expiryItems.id, existing.id));
          await this.items.replaceLiable(tx, existing.id, roleIds, userIds);
        }
      }
      const appended = await this.appendHistory(tx, existing.id, input.history);
      if (outcome === 'UPDATED' || appended > 0) {
        await this.record(tx, ctx, existing.id, outcome, appended, input.legacyId);
      }
      return { id: existing.id, outcome };
    });
  }

  /** The old changes not yet present, by their old id; a row already here stays as it is. */
  private async appendHistory(
    tx: Tx,
    itemId: number,
    history: readonly ExpiryCarriedChange[],
  ): Promise<number> {
    if (history.length === 0) return 0;
    const rows = await tx
      .insert(expiryItemChanges)
      .values(
        history.map((change) => ({
          itemId,
          kind: change.kind,
          qtyFloorOld: new Decimal(change.qtyFloorOld),
          qtyFloorNew: new Decimal(change.qtyFloorNew),
          qtyWarehouseOld: new Decimal(change.qtyWarehouseOld),
          qtyWarehouseNew: new Decimal(change.qtyWarehouseNew),
          changedAt: new Date(change.changedAt),
          changedByName: change.changedByName,
          legacyId: change.legacyId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: expiryItemChanges.id });
    return rows.length;
  }

  /** The audit row names the person running the tool, not the old author. */
  private record(
    tx: Tx,
    ctx: AuthContext,
    id: number,
    outcome: ExpiryCarryOutcome,
    appendedChanges: number,
    legacyId: number,
  ): Promise<void> {
    return this.audit.record(tx, ctx, {
      action: 'IMPORT',
      entity: 'expiry_items',
      entityId: id,
      after: { legacyId, outcome, appendedChanges },
    });
  }
}

function differsFrom(
  row: ExpiryItemRow,
  wanted: {
    productId: number;
    expiryDate: string;
    qtyFloor: Decimal;
    qtyWarehouse: Decimal;
    status: ExpiryStatus;
    liabilityType: ExpiryLiabilityType;
    liabilityNote: string | null;
    note: string | null;
    createdAt: Date;
    createdByName: string;
    archivedAt: Date | null;
    archivedByName: string | null;
  },
): boolean {
  return (
    row.productId !== wanted.productId ||
    row.expiryDate !== wanted.expiryDate ||
    !row.qtyFloor.eq(wanted.qtyFloor) ||
    !row.qtyWarehouse.eq(wanted.qtyWarehouse) ||
    row.status !== wanted.status ||
    row.liabilityType !== wanted.liabilityType ||
    row.liabilityNote !== wanted.liabilityNote ||
    row.note !== wanted.note ||
    timeOf(row.createdAt) !== timeOf(wanted.createdAt) ||
    row.createdByName !== wanted.createdByName ||
    timeOf(row.archivedAt) !== timeOf(wanted.archivedAt) ||
    row.archivedByName !== wanted.archivedByName
  );
}
