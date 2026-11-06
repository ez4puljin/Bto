import { Injectable } from '@nestjs/common';
import { EBARIMT_DIFF_TOLERANCE, type EbarimtHistoryKind } from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, inArray, lte, or } from 'drizzle-orm';
import type { Db, Tx } from '../../../common/db/db.types';
import { actorUserId, type AuthContext } from '../../identity';
import { ebarimtCheckHistory } from '../schema';
import { allocateEntries, EbarimtDataService, registerOwners } from './ebarimt-data.service';

const CHUNK = 500;
const SAME = new Decimal(EBARIMT_DIFF_TOLERANCE);

export type EbarimtHistoryRow = typeof ebarimtCheckHistory.$inferSelect;

/**
 * How a supplier's month changed (the old list's «түүх»): each value's first reading and every change
 * after it, with why and who. The e-Barimt total is compared with its last reading whenever something
 * on this page can move it: a file, a link, a register typed here. A register changed on the
 * supplier's own record is noted only at the month's next file (ADR-0170).
 */
@Injectable()
export class EbarimtHistoryService {
  constructor(private readonly data: EbarimtDataService) {}

  /**
   * Writes what moved in a month's e-Barimt totals. `only`: just these suppliers (a register typed,
   * a link); the rest of the month cannot have moved. The month's first file comes as `INIT`, each
   * supplier's first reading; after it, a total that rises from nothing is a change like any other.
   */
  async syncEbarimt(
    tx: Tx,
    ctx: AuthContext,
    period: number,
    kind: EbarimtHistoryKind,
    source: string | null,
    only?: readonly number[],
  ): Promise<void> {
    const files = await this.data.activeFiles([period], tx);
    const file = files.get(period);
    const entries = file ? await this.data.entriesOf([file.id], tx) : [];
    const links = await this.data.liveLinks([period], tx);
    const suppliers = await this.data.suppliersWithProfiles(tx);
    const { bySupplier } = allocateEntries(entries, links, registerOwners(suppliers));
    const last = await this.lastAmounts(tx, period);
    const wanted = only ? new Set(only) : null;
    const now = new Date();
    const rows: (typeof ebarimtCheckHistory.$inferInsert)[] = [];
    for (const supplier of suppliers) {
      if (wanted && !wanted.has(supplier.id)) continue;
      const amount = bySupplier.get(supplier.id)?.amount ?? new Decimal(0);
      const before = last.get(supplier.id);
      if (before === undefined && amount.isZero()) continue;
      if (before !== undefined && amount.minus(before).abs().lessThanOrEqualTo(SAME)) continue;
      rows.push({
        period,
        supplierId: supplier.id,
        field: 'EBARIMT',
        amount,
        kind,
        source,
        changedBy: actorUserId(ctx),
        changedAt: now,
      });
    }
    for (let start = 0; start < rows.length; start += CHUNK) {
      await tx.insert(ebarimtCheckHistory).values(rows.slice(start, start + CHUNK));
    }
  }

  private async lastAmounts(tx: Tx, period: number): Promise<Map<number, Decimal>> {
    const rows = await tx
      .select({ supplierId: ebarimtCheckHistory.supplierId, amount: ebarimtCheckHistory.amount })
      .from(ebarimtCheckHistory)
      .where(and(eq(ebarimtCheckHistory.period, period), eq(ebarimtCheckHistory.field, 'EBARIMT')))
      .orderBy(asc(ebarimtCheckHistory.id));
    const last = new Map<number, Decimal>();
    for (const row of rows) last.set(row.supplierId, row.amount ?? new Decimal(0));
    return last;
  }

  /** One line of a change made by hand: an employee or an exempt amount. */
  async record(
    tx: Tx,
    ctx: AuthContext,
    row: {
      period: number;
      supplierId: number;
      field: 'EMPLOYEE' | 'EXEMPT';
      kind: EbarimtHistoryKind;
      userId?: number | null;
      amount?: Decimal | null;
    },
  ): Promise<void> {
    await tx.insert(ebarimtCheckHistory).values({
      period: row.period,
      supplierId: row.supplierId,
      field: row.field,
      kind: row.kind,
      userId: row.userId ?? null,
      amount: row.amount ?? null,
      changedBy: actorUserId(ctx),
    });
  }

  /**
   * The months' history, with every earlier change of an employee: a choice carries forward, so the
   * month it was made explains the months after it.
   */
  async ofPeriods(periods: readonly number[], executor: Db | Tx): Promise<EbarimtHistoryRow[]> {
    const last = periods[periods.length - 1];
    if (last === undefined) return [];
    return executor
      .select()
      .from(ebarimtCheckHistory)
      .where(
        or(
          inArray(ebarimtCheckHistory.period, [...periods]),
          and(eq(ebarimtCheckHistory.field, 'EMPLOYEE'), lte(ebarimtCheckHistory.period, last)),
        ),
      )
      .orderBy(asc(ebarimtCheckHistory.id));
  }
}
