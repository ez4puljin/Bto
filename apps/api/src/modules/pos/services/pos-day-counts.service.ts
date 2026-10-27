import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { DENOMINATIONS, denominationTotal, POS_LIMITS } from '@tugeel/shared/pos';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError, invalid } from '../../../common/errors/app-error';
import { type Actor, AuditService, UserNamesService } from '../../identity';
import type { Accepted, DayCountDoc } from '../sale-doc';
import { posDayCounts, posTills } from '../schema';
import type { EdgeNode } from './pos-edge-nodes.service';
import { PosCashiersService } from './pos-cashiers.service';
import { PosTillsService } from './pos-tills.service';

export interface DayCountView {
  id: number;
  tillId: number;
  tillCode: string;
  day: string;
  cashierUserId: number;
  cashierName: string | null;
  counts: { note: number; count: number }[];
  total: Decimal;
  countedAt: Date;
}

/**
 * The tills' banknote counts of their day summaries (ADR-0111, owner 2026-10-27): replayed from
 * the edge as counted and kept; they post nothing. A recount is a new row, the latest shown.
 */
@Injectable()
export class PosDayCountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly tills: PosTillsService,
    private readonly cashiers: PosCashiersService,
  ) {}

  async acceptDayCount(tx: Tx, actor: Actor, node: EdgeNode, doc: DayCountDoc): Promise<Accepted> {
    const [existing] = await tx
      .select({ id: posDayCounts.id, day: posDayCounts.day })
      .from(posDayCounts)
      .where(and(eq(posDayCounts.edgeNodeId, node.id), eq(posDayCounts.clientId, doc.clientId)));
    if (existing) return { id: existing.id, number: existing.day, created: false };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.day)) throw invalid('day', 'date', 'YYYY-MM-DD');
    const seen = new Set<number>();
    doc.counts.forEach((row, index) => {
      if (!(DENOMINATIONS as readonly number[]).includes(row.note) || seen.has(row.note)) {
        throw invalid(`counts[${index}].note`, 'note', 'a banknote, once');
      }
      seen.add(row.note);
      if (!Number.isInteger(row.count) || row.count < 0 || row.count > POS_LIMITS.maxNoteCount) {
        throw invalid(`counts[${index}].count`, 'count', 'a whole number of notes');
      }
    });
    const total = denominationTotal(doc.counts);
    if (!total.eq(doc.total)) {
      throw new AppError('POS_TOTALS_MISMATCH', 'the notes do not make the total', {
        lineNo: null,
        field: 'total',
        expected: total.toFixed(2),
        got: doc.total.toFixed(2),
      });
    }
    const till = await this.tills.activeByCode(node.id, doc.tillCode, tx);
    await this.cashiers.assertActive(doc.cashierUserId, tx);
    const counts = [...doc.counts].sort((a, b) => b.note - a.note);
    const [row] = await tx
      .insert(posDayCounts)
      .values({
        clientId: doc.clientId,
        edgeNodeId: node.id,
        tillId: till.id,
        day: doc.day,
        cashierUserId: doc.cashierUserId,
        counts,
        total,
        countedAt: doc.countedAt,
      })
      .returning({ id: posDayCounts.id });
    if (!row) throw new Error('pos_day_counts insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'ACCEPT',
      entity: 'pos_day_counts',
      entityId: row.id,
      after: { tillCode: till.code, day: doc.day, total: total.toFixed(2), counts },
    });
    return { id: row.id, number: doc.day, created: true };
  }

  /** The counts by day, newest first (`tillId`, `from`, `to`); every recount is listed. */
  async list(query: {
    tillId?: number;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<DayCountView[]> {
    const filters: SQL[] = [];
    if (query.tillId) filters.push(eq(posDayCounts.tillId, query.tillId));
    if (query.from) filters.push(gte(posDayCounts.day, query.from));
    if (query.to) filters.push(lte(posDayCounts.day, query.to));
    const rows = await this.db
      .select({ count: posDayCounts, tillCode: posTills.code })
      .from(posDayCounts)
      .innerJoin(posTills, eq(posTills.id, posDayCounts.tillId))
      .where(and(...filters))
      .orderBy(desc(posDayCounts.day), desc(posDayCounts.id))
      .limit(Math.min(query.limit ?? 100, 500));
    const names = await this.names.namesOf(rows.map((row) => row.count.cashierUserId));
    return rows.map(({ count, tillCode }) => ({
      id: count.id,
      tillId: count.tillId,
      tillCode,
      day: count.day,
      cashierUserId: count.cashierUserId,
      cashierName: names.get(count.cashierUserId) ?? null,
      counts: count.counts as { note: number; count: number }[],
      total: count.total,
      countedAt: count.countedAt,
    }));
  }
}
