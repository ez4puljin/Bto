import { Inject, Injectable } from '@nestjs/common';
import { businessDate } from '@tugeel/shared/time';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import {
  actorUserId,
  type AuthContext,
  AuditService,
  PermissionHoldersService,
  UserNamesService,
} from '../../identity';
import { SuppliersService } from '../../partners';
import { supplierOrdererHistory, supplierOrderers } from '../schema';
import { assertManage, EDIT } from './support';

export interface SupplierOrdererChange {
  supplierId: number;
  userId: number | null;
  effectiveDate: string;
}

export interface SupplierOrderer {
  supplierId: number;
  userId: number | null;
  fullName: string | null;
}

/**
 * Each supplier's orderer (owner 2026-10-29, ADR-0115): the one staff member who orders from it and
 * may type its quantities up to «Замд» and move it forward. Managers set it; a candidate holds the
 * edit right.
 */
@Injectable()
export class SupplierOrderersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly holders: PermissionHoldersService,
    private readonly userNames: UserNamesService,
    private readonly suppliers: SuppliersService,
  ) {}

  async get(supplierId: number, executor: Db | Tx = this.db): Promise<SupplierOrderer> {
    const [row] = await executor
      .select()
      .from(supplierOrderers)
      .where(eq(supplierOrderers.supplierId, supplierId));
    if (!row) return { supplierId, userId: null, fullName: null };
    const names = await this.userNames.namesOf([row.userId]);
    return { supplierId, userId: row.userId, fullName: names.get(row.userId) ?? null };
  }

  /** Every change of every supplier's orderer, oldest first (ADR-0170). */
  async changes(executor: Db | Tx = this.db): Promise<SupplierOrdererChange[]> {
    return executor
      .select({
        supplierId: supplierOrdererHistory.supplierId,
        userId: supplierOrdererHistory.userId,
        effectiveDate: supplierOrdererHistory.effectiveDate,
      })
      .from(supplierOrdererHistory)
      .orderBy(asc(supplierOrdererHistory.effectiveDate), asc(supplierOrdererHistory.id));
  }

  /** The staff members who may be an orderer: the active holders of the edit right, by name. */
  async candidates(): Promise<{ id: number; fullName: string }[]> {
    const ids = await this.holders.activeHolders(EDIT);
    const names = await this.userNames.namesOf(ids);
    return ids
      .map((id) => ({ id, fullName: names.get(id) ?? '' }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  set(ctx: AuthContext, supplierId: number, userId: number | null): Promise<SupplierOrderer> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      await this.suppliers.assertActive(tx, supplierId);
      const [before] = await tx
        .select()
        .from(supplierOrderers)
        .where(eq(supplierOrderers.supplierId, supplierId))
        .for('update');
      if (userId === null) {
        await tx.delete(supplierOrderers).where(eq(supplierOrderers.supplierId, supplierId));
      } else {
        if (!(await this.holders.activeHolders(EDIT, {}, tx)).includes(userId)) {
          throw invalid('userId', 'orderer', 'the orderer holds the right to type quantities');
        }
        await tx
          .insert(supplierOrderers)
          .values({ supplierId, userId, updatedBy: actorUserId(ctx) })
          .onConflictDoUpdate({
            target: supplierOrderers.supplierId,
            set: { userId, updatedBy: actorUserId(ctx), updatedAt: sql`now()` },
          });
      }
      if ((before?.userId ?? null) !== userId) {
        await tx.insert(supplierOrdererHistory).values({
          supplierId,
          userId,
          effectiveDate: businessDate(),
          changedBy: actorUserId(ctx),
        });
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'supplier_orderers',
        entityId: supplierId,
        before: before ?? null,
        after: { supplierId, userId },
      });
      return this.get(supplierId, tx);
    });
  }
}
