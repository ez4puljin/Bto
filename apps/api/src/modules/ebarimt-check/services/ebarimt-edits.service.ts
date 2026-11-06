import { Inject, Injectable } from '@nestjs/common';
import { Decimal, toMoney } from '@tugeel/shared/money';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { actorUserId, type AuthContext, AuditService, UserNamesService } from '../../identity';
import { SuppliersService } from '../../partners';
import { SupplierOrderersService } from '../../procurement';
import {
  ebarimtCheckAssignments,
  ebarimtCheckMonthValues,
  ebarimtCheckReceiptLinks,
  ebarimtCheckSupplierProfiles,
} from '../schema';
import { EbarimtDataService, OrdererTimeline, registerOwners } from './ebarimt-data.service';
import { EbarimtHistoryService } from './ebarimt-history.service';

/** A colleague's change since the cell was read: reported, never written over. */
const cellConflict = (value: string | null | undefined) =>
  new AppError('EBARIMT_CELL_CONFLICT', 'a colleague changed this cell meanwhile', {
    value: value || '—',
  });

/**
 * What the page writes, each cell on its own and naming the value it replaces: two people, at two
 * cells or at one, never overwrite each other (owner 2026-10-30, ADR-0118, ADR-0170).
 */
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
    input: {
      period: number;
      supplierId: number;
      exemptAmount?: Decimal;
      previousExemptAmount?: Decimal;
      note?: string | null;
      previousNote?: string | null;
    },
  ): Promise<void> {
    await this.assertSuppliers([input.supplierId]);
    const note = input.note === undefined ? undefined : input.note?.trim() || null;
    const amount = input.exemptAmount === undefined ? undefined : toMoney(input.exemptAmount);
    const key = and(
      eq(ebarimtCheckMonthValues.period, input.period),
      eq(ebarimtCheckMonthValues.supplierId, input.supplierId),
    );
    await inTransaction(this.db, async (tx) => {
      // The row first: two people's first saves of one month then meet on its lock.
      const created = await tx
        .insert(ebarimtCheckMonthValues)
        .values({
          period: input.period,
          supplierId: input.supplierId,
          exemptAmount: new Decimal(0),
          updatedBy: actorUserId(ctx),
        })
        .onConflictDoNothing()
        .returning({ period: ebarimtCheckMonthValues.period });
      const isNew = created.length > 0;
      const [before] = await tx.select().from(ebarimtCheckMonthValues).where(key).for('update');
      const was = before?.exemptAmount ?? new Decimal(0);
      const wasNote = before?.note ?? null;
      if (amount !== undefined && input.previousExemptAmount?.equals(was) === false) {
        throw cellConflict(was.toFixed(2));
      }
      if (
        note !== undefined &&
        input.previousNote !== undefined &&
        (input.previousNote?.trim() || null) !== wasNote
      ) {
        throw cellConflict(wasNote);
      }
      await tx
        .update(ebarimtCheckMonthValues)
        .set({
          ...(amount === undefined ? {} : { exemptAmount: amount }),
          ...(note === undefined ? {} : { note }),
          updatedBy: actorUserId(ctx),
          updatedAt: new Date(),
        })
        .where(key);
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
        action: isNew ? 'CREATE' : 'UPDATE',
        entity: 'ebarimt_check_month_values',
        entityId: input.supplierId,
        before: isNew
          ? null
          : { period: input.period, exemptAmount: was.toFixed(2), note: wasNote },
        after: {
          period: input.period,
          exemptAmount: (amount ?? was).toFixed(2),
          note: note === undefined ? wasNote : note,
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
    const orderers = new OrdererTimeline(await this.orderers.changes());
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
        const orderer = orderers.at(supplierId, input.period);
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
   * value; null goes back to the record's; `previous…` is what the cell showed, the record's value
   * included. A new register moves e-Barimt's totals, which the history notes for every month holding
   * a file.
   */
  async saveProfile(
    ctx: AuthContext,
    supplierId: number,
    input: {
      registers?: string | null;
      previousRegisters?: string;
      phone?: string | null;
      previousPhone?: string;
      remark?: string | null;
      previousRemark?: string;
    },
  ): Promise<void> {
    await this.assertSuppliers([supplierId]);
    const trim = (value: string | null | undefined) =>
      value === undefined || value === null ? value : value.trim();
    const registers = trim(input.registers);
    const phone = trim(input.phone);
    const remark = trim(input.remark);
    const periods = registers === undefined ? [] : await this.data.allActivePeriods();
    const key = eq(ebarimtCheckSupplierProfiles.supplierId, supplierId);
    await inTransaction(this.db, async (tx) => {
      // The row first: two people's first saves of one supplier then meet on its lock.
      const created = await tx
        .insert(ebarimtCheckSupplierProfiles)
        .values({ supplierId, updatedBy: actorUserId(ctx) })
        .onConflictDoNothing()
        .returning({ supplierId: ebarimtCheckSupplierProfiles.supplierId });
      const isNew = created.length > 0;
      const [before] = await tx
        .select()
        .from(ebarimtCheckSupplierProfiles)
        .where(key)
        .for('update');
      const shown = (await this.data.suppliersWithProfiles(tx)).find(
        (supplier) => supplier.id === supplierId,
      );
      const moved = (previous: string | undefined, now: string | undefined) =>
        previous !== undefined && previous.trim() !== (now ?? '').trim();
      if (registers !== undefined && moved(input.previousRegisters, shown?.registers)) {
        throw cellConflict(shown?.registers);
      }
      if (phone !== undefined && moved(input.previousPhone, shown?.phone)) {
        throw cellConflict(shown?.phone);
      }
      if (remark !== undefined && moved(input.previousRemark, shown?.remark)) {
        throw cellConflict(shown?.remark);
      }
      await tx
        .update(ebarimtCheckSupplierProfiles)
        .set({
          ...(registers === undefined ? {} : { registers }),
          ...(phone === undefined ? {} : { phone }),
          ...(remark === undefined ? {} : { remark: remark || null }),
          updatedBy: actorUserId(ctx),
          updatedAt: new Date(),
        })
        .where(key);
      for (const period of periods) {
        await this.history.syncEbarimt(tx, ctx, period, 'EDIT', registers ?? null, [supplierId]);
      }
      await this.audit.record(tx, ctx, {
        action: isNew ? 'CREATE' : 'UPDATE',
        entity: 'ebarimt_check_supplier_profiles',
        entityId: supplierId,
        before: isNew
          ? null
          : {
              registers: before?.registers ?? null,
              phone: before?.phone ?? null,
              remark: before?.remark ?? null,
            },
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
   * be in the month's file to be linked; undoing needs only its link, and only the link the person
   * saw (`previousSupplierId`). A receipt already counted for someone is undone first, never taken
   * over: a colleague may have just linked it. What could not be done is counted in `skipped`.
   */
  async linkReceipts(
    ctx: AuthContext,
    input: {
      period: number;
      receiptKeys: readonly string[];
      supplierId: number | null;
      previousSupplierId?: number;
    },
  ): Promise<{ linked: number; unlinked: number; skipped: number }> {
    const receiptKeys = [...new Set(input.receiptKeys)];
    if (input.supplierId !== null) await this.assertSuppliers([input.supplierId]);
    const files = await this.data.activeFiles([input.period]);
    const file = files.get(input.period);
    const entries = file ? await this.data.entriesOf([file.id]) : [];
    // A key can stand on several lines of a file: a link takes them all.
    const entryOf = new Map<string, { ttd: string; amount: Decimal }>();
    for (const entry of entries) {
      const seen = entryOf.get(entry.receiptKey);
      entryOf.set(entry.receiptKey, {
        ttd: seen?.ttd ?? entry.ttd,
        amount: (seen?.amount ?? new Decimal(0)).plus(entry.totalAmount),
      });
    }
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
      const moved = new Set<number>();
      for (const receiptKey of receiptKeys) {
        const link = linkOf.get(receiptKey);
        if (input.supplierId === null) {
          if (!link || link.supplierId !== input.previousSupplierId) {
            skipped += 1;
            continue;
          }
          await tx
            .update(ebarimtCheckReceiptLinks)
            .set({ removedBy: actorUserId(ctx), removedAt: new Date() })
            .where(eq(ebarimtCheckReceiptLinks.id, link.id));
          ttds.add(link.ttd);
          moved.add(link.supplierId);
          unlinked += 1;
          continue;
        }
        if (link) {
          if (link.supplierId !== input.supplierId) skipped += 1;
          continue;
        }
        const entry = entryOf.get(receiptKey);
        if (!entry) {
          skipped += 1;
          continue;
        }
        // Two people's first links of one receipt: the one index holds them apart.
        const inserted = await tx
          .insert(ebarimtCheckReceiptLinks)
          .values({
            period: input.period,
            receiptKey,
            supplierId: input.supplierId,
            ttd: entry.ttd,
            amount: entry.amount,
            createdBy: actorUserId(ctx),
          })
          .onConflictDoNothing()
          .returning({ id: ebarimtCheckReceiptLinks.id });
        if (inserted.length === 0) {
          skipped += 1;
          continue;
        }
        ttds.add(entry.ttd);
        moved.add(input.supplierId);
        linked += 1;
      }
      if (linked + unlinked > 0) {
        const source = [...ttds].sort().join(', ').slice(0, 300);
        // Only whom a link can move: its suppliers and those holding its registers.
        const owners = registerOwners(await this.data.suppliersWithProfiles(tx));
        for (const ttd of ttds) for (const holder of owners.get(ttd) ?? []) moved.add(holder);
        await this.history.syncEbarimt(
          tx,
          ctx,
          input.period,
          input.supplierId === null ? 'UNLINK' : 'LINK',
          source,
          [...moved],
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
