import { Inject, Injectable } from '@nestjs/common';
import { Decimal, toMoney } from '@tugeel/shared/money';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { actorUserId, type AuthContext, AuditService, UserNamesService } from '../../identity';
import { SuppliersService } from '../../partners';
import { SupplierOrderersService } from '../../procurement';
import {
  ebarimtCheckAssignments,
  ebarimtCheckMonthValues,
  ebarimtCheckReceiptLinks,
  ebarimtCheckSupplierProfiles,
} from '../schema';
import { EbarimtDataService } from './ebarimt-data.service';
import { EbarimtHistoryService } from './ebarimt-history.service';

/** What the page writes, each cell on its own: two people at two cells never overwrite each other. */
@Injectable()
export class EbarimtEditsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly suppliers: SuppliersService,
    private readonly orderers: SupplierOrderersService,
    private readonly userNames: UserNamesService,
    private readonly data: EbarimtDataService,
    private readonly history: EbarimtHistoryService,
  ) {}

  /** A supplier's month: the amount exempt from VAT and/or the note. */
  async saveMonthValue(
    ctx: AuthContext,
    input: { period: number; supplierId: number; exemptAmount?: Decimal; note?: string | null },
  ): Promise<void> {
    await this.assertSuppliers([input.supplierId]);
    const note = input.note === undefined ? undefined : input.note?.trim() || null;
    const amount = input.exemptAmount === undefined ? undefined : toMoney(input.exemptAmount);
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(ebarimtCheckMonthValues)
        .where(
          and(
            eq(ebarimtCheckMonthValues.period, input.period),
            eq(ebarimtCheckMonthValues.supplierId, input.supplierId),
          ),
        )
        .for('update');
      const changes = {
        ...(amount === undefined ? {} : { exemptAmount: amount }),
        ...(note === undefined ? {} : { note }),
        updatedBy: actorUserId(ctx),
        updatedAt: new Date(),
      };
      if (before) {
        await tx
          .update(ebarimtCheckMonthValues)
          .set(changes)
          .where(
            and(
              eq(ebarimtCheckMonthValues.period, input.period),
              eq(ebarimtCheckMonthValues.supplierId, input.supplierId),
            ),
          );
      } else {
        await tx.insert(ebarimtCheckMonthValues).values({
          period: input.period,
          supplierId: input.supplierId,
          exemptAmount: amount ?? new Decimal(0),
          note: note ?? null,
          updatedBy: actorUserId(ctx),
        });
      }
      const was = before?.exemptAmount ?? new Decimal(0);
      if (amount !== undefined && !amount.equals(was)) {
        await this.history.record(tx, ctx, {
          period: input.period,
          supplierId: input.supplierId,
          field: 'EXEMPT',
          kind: 'MANUAL',
          amount,
        });
      }
      await this.audit.record(tx, ctx, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'ebarimt_check_month_values',
        entityId: input.supplierId,
        before: before
          ? { period: input.period, exemptAmount: was.toFixed(2), note: before.note }
          : null,
        after: {
          period: input.period,
          exemptAmount: (amount ?? was).toFixed(2),
          note: note === undefined ? (before?.note ?? null) : note,
        },
      });
    });
  }

  /**
   * Suppliers given to an employee on this page, this month and those after it until the next
   * change; the months before keep theirs. `userId` null: back to each supplier's own orderer. The
   * orderer on the supplier's page stays as it is (owner 2026-11-07).
   */
  async assignEmployee(
    ctx: AuthContext,
    input: { period: number; supplierIds: readonly number[]; userId: number | null },
  ): Promise<{ changed: number }> {
    const supplierIds = [...new Set(input.supplierIds)];
    await this.assertSuppliers(supplierIds);
    if (input.userId !== null) {
      const names = await this.userNames.namesOf([input.userId]);
      if (!names.has(input.userId)) throw invalid('userId', 'exists', 'no such staff member');
    }
    const orderers = await this.orderers.allUserIds();
    return inTransaction(this.db, async (tx) => {
      let changed = 0;
      for (const supplierId of supplierIds) {
        const [current] = await tx
          .select({ userId: ebarimtCheckAssignments.userId })
          .from(ebarimtCheckAssignments)
          .where(
            and(
              eq(ebarimtCheckAssignments.supplierId, supplierId),
              lte(ebarimtCheckAssignments.period, input.period),
            ),
          )
          .orderBy(desc(ebarimtCheckAssignments.period))
          .limit(1)
          .for('update');
        const orderer = orderers.get(supplierId) ?? null;
        // Already theirs this month: nothing to write.
        if ((current?.userId ?? orderer) === (input.userId ?? orderer)) continue;
        await tx
          .insert(ebarimtCheckAssignments)
          .values({
            period: input.period,
            supplierId,
            userId: input.userId,
            updatedBy: actorUserId(ctx),
          })
          .onConflictDoUpdate({
            target: [ebarimtCheckAssignments.period, ebarimtCheckAssignments.supplierId],
            set: { userId: input.userId, updatedBy: actorUserId(ctx), updatedAt: new Date() },
          });
        await this.history.record(tx, ctx, {
          period: input.period,
          supplierId,
          field: 'EMPLOYEE',
          kind: input.userId === null ? 'REVERT' : 'MANUAL',
          userId: input.userId ?? orderer,
        });
        changed += 1;
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'ebarimt_check_assignments',
        entityId: input.period,
        before: null,
        after: { period: input.period, userId: input.userId, supplierIds, changed },
      });
      return { changed };
    });
  }

  /**
   * A supplier's values on this page (every month's): registers, phone, remark. Undefined leaves a
   * value; null goes back to the record's. A new register moves e-Barimt's totals, which the history
   * notes for every month holding a file.
   */
  async saveProfile(
    ctx: AuthContext,
    supplierId: number,
    input: { registers?: string | null; phone?: string | null; remark?: string | null },
  ): Promise<void> {
    await this.assertSuppliers([supplierId]);
    const trim = (value: string | null | undefined) =>
      value === undefined || value === null ? value : value.trim();
    const registers = trim(input.registers);
    const phone = trim(input.phone);
    const remark = trim(input.remark);
    const periods = registers === undefined ? [] : await this.data.allActivePeriods();
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(ebarimtCheckSupplierProfiles)
        .where(eq(ebarimtCheckSupplierProfiles.supplierId, supplierId))
        .for('update');
      const changes = {
        ...(registers === undefined ? {} : { registers }),
        ...(phone === undefined ? {} : { phone }),
        ...(remark === undefined ? {} : { remark: remark || null }),
        updatedBy: actorUserId(ctx),
        updatedAt: new Date(),
      };
      await tx
        .insert(ebarimtCheckSupplierProfiles)
        .values({ supplierId, ...changes })
        .onConflictDoUpdate({ target: ebarimtCheckSupplierProfiles.supplierId, set: changes });
      for (const period of periods) {
        await this.history.syncEbarimt(tx, ctx, period, 'EDIT', registers ?? null, [supplierId]);
      }
      await this.audit.record(tx, ctx, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'ebarimt_check_supplier_profiles',
        entityId: supplierId,
        before: before
          ? { registers: before.registers, phone: before.phone, remark: before.remark }
          : null,
        after: {
          registers: registers === undefined ? (before?.registers ?? null) : registers,
          phone: phone === undefined ? (before?.phone ?? null) : phone,
          remark: remark === undefined ? (before?.remark ?? null) : remark || null,
        },
      });
    });
  }

  /**
   * Receipts of a month counted for a chosen supplier; `supplierId` null undoes them. A receipt must
   * be in the month's file to be linked; undoing needs only its link.
   */
  async linkReceipts(
    ctx: AuthContext,
    input: { period: number; receiptKeys: readonly string[]; supplierId: number | null },
  ): Promise<{ linked: number; unlinked: number; skipped: number }> {
    const receiptKeys = [...new Set(input.receiptKeys)];
    if (input.supplierId !== null) await this.assertSuppliers([input.supplierId]);
    const files = await this.data.activeFiles([input.period]);
    const file = files.get(input.period);
    const entries = file ? await this.data.entriesOf([file.id]) : [];
    const entryOf = new Map(entries.map((entry) => [entry.receiptKey, entry]));
    return inTransaction(this.db, async (tx) => {
      const existing = await tx
        .select()
        .from(ebarimtCheckReceiptLinks)
        .where(
          and(
            eq(ebarimtCheckReceiptLinks.period, input.period),
            inArray(ebarimtCheckReceiptLinks.receiptKey, receiptKeys),
            isNull(ebarimtCheckReceiptLinks.removedAt),
          ),
        )
        .for('update');
      const linkOf = new Map(existing.map((link) => [link.receiptKey, link]));
      let linked = 0;
      let unlinked = 0;
      let skipped = 0;
      const ttds = new Set<string>();
      for (const receiptKey of receiptKeys) {
        const link = linkOf.get(receiptKey);
        const entry = entryOf.get(receiptKey);
        if (input.supplierId !== null && !entry) {
          skipped += 1;
          continue;
        }
        if (link && link.supplierId !== input.supplierId) {
          await tx
            .update(ebarimtCheckReceiptLinks)
            .set({ removedBy: actorUserId(ctx), removedAt: new Date() })
            .where(eq(ebarimtCheckReceiptLinks.id, link.id));
          ttds.add(link.ttd);
          if (input.supplierId === null) unlinked += 1;
        }
        if (input.supplierId === null) {
          if (!link) skipped += 1;
          continue;
        }
        if (link?.supplierId === input.supplierId) continue;
        await tx.insert(ebarimtCheckReceiptLinks).values({
          period: input.period,
          receiptKey,
          supplierId: input.supplierId,
          ttd: entry?.ttd ?? '',
          amount: entry?.totalAmount ?? new Decimal(0),
          createdBy: actorUserId(ctx),
        });
        ttds.add(entry?.ttd ?? '');
        linked += 1;
      }
      if (linked + unlinked > 0) {
        const source = [...ttds].sort().join(', ').slice(0, 300);
        await this.history.syncEbarimt(
          tx,
          ctx,
          input.period,
          input.supplierId === null ? 'UNLINK' : 'LINK',
          source,
        );
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'ebarimt_check_receipt_links',
        entityId: input.period,
        before: null,
        after: {
          period: input.period,
          supplierId: input.supplierId,
          receipts: receiptKeys.length,
          linked,
          unlinked,
          skipped,
        },
      });
      return { linked, unlinked, skipped };
    });
  }

  private async assertSuppliers(ids: readonly number[]): Promise<void> {
    const found = new Set((await this.suppliers.getMany(ids)).map((row) => row.id));
    for (const id of ids) if (!found.has(id)) throw notFound('supplier', id);
  }
}
