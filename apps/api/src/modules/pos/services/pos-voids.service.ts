import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { lineMoney, type VoidReason } from '@tugeel/shared/pos';
import { and, asc, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { onBusinessDays } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, UnitConversionService } from '../../catalog';
import { type Actor, AuditService, UserNamesService } from '../../identity';
import type { Accepted, VoidDoc } from '../sale-doc';
import { posShifts, posTills, posVoidLines, posVoids } from '../schema';
import { PosCashiersService } from './pos-cashiers.service';
import type { EdgeNode } from './pos-edge-nodes.service';
import { PosShiftsService } from './pos-shifts.service';
import { PosTillsService } from './pos-tills.service';

export interface VoidSummary {
  id: number;
  clientId: string;
  tillId: number;
  tillCode: string;
  shiftId: number | null;
  shiftNumber: string | null;
  cashierUserId: number;
  cashierName: string | null;
  approvedBy: number | null;
  approvedByName: string | null;
  reason: VoidReason;
  voidedAt: Date;
  total: Decimal;
  lineCount: number;
}

export interface VoidLineView {
  lineNo: number;
  productId: number;
  productUnitId: number;
  productSku: string;
  productName: string;
  uomName: string;
  qty: Decimal;
  unitPrice: Decimal;
  total: Decimal;
}

export interface VoidDetail extends VoidSummary {
  lines: VoidLineView[];
}

export interface VoidQuery {
  tillId?: number;
  cashierUserId?: number;
  reason?: VoidReason;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/**
 * The void log (ADR-0104): what a till took off a cart before payment — a removed line, a lowered
 * quantity, a cancelled cart or parked basket — with the supervisor who approved it. Stock and
 * money do not move; the list is for the owner to watch for losses.
 */
@Injectable()
export class PosVoidsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly tills: PosTillsService,
    private readonly cashiers: PosCashiersService,
    private readonly shifts: PosShiftsService,
  ) {}

  async acceptVoid(tx: Tx, actor: Actor, node: EdgeNode, doc: VoidDoc): Promise<Accepted> {
    const [existing] = await tx
      .select({ id: posVoids.id })
      .from(posVoids)
      .where(and(eq(posVoids.edgeNodeId, node.id), eq(posVoids.clientId, doc.clientId)));
    if (existing) return { id: existing.id, number: doc.clientId, created: false };
    const till = await this.tills.activeByCode(node.id, doc.tillCode, tx);
    const shift =
      doc.shiftClientId === null
        ? null
        : await this.shifts.byClientId(tx, node.id, doc.shiftClientId);
    if (doc.shiftClientId !== null && !shift) {
      throw new AppError('POS_SHIFT_STATE_INVALID', `shift ${doc.shiftClientId} is unknown`, {
        status: 'MISSING',
      });
    }
    await this.cashiers.assertActive(doc.cashierUserId, tx);
    if (doc.approvedByUserId !== null && !(await this.names.namesOf([doc.approvedByUserId])).size) {
      throw invalid('approvedByUserId', 'exists', `user ${doc.approvedByUserId} does not exist`);
    }
    const units = await this.units.describe(
      [...new Set(doc.lines.map((line) => line.productUnitId))],
      tx,
    );
    const products = new Map(
      (await this.catalog.getMany([...new Set(doc.lines.map((line) => line.productId))], tx)).map(
        (product) => [product.id, product],
      ),
    );
    let sum = new Decimal(0);
    doc.lines.forEach((line, index) => {
      const unit = units.get(line.productUnitId);
      if (!unit || unit.productId !== line.productId || !products.has(line.productId)) {
        throw invalid(`lines[${index}].productUnitId`, 'product', 'a unit of the line’s product');
      }
      const expected = lineMoney(line.qty, line.unitPrice).total;
      if (!expected.eq(line.total)) {
        throw new AppError('POS_TOTALS_MISMATCH', `void line ${index + 1}: total differs`, {
          lineNo: index + 1,
          field: 'total',
          expected: expected.toFixed(2),
          got: line.total.toFixed(2),
        });
      }
      sum = sum.plus(line.total);
    });
    if (!sum.eq(doc.total)) {
      throw new AppError('POS_TOTALS_MISMATCH', 'void total differs', {
        field: 'total',
        expected: sum.toFixed(2),
        got: doc.total.toFixed(2),
      });
    }
    const [row] = await tx
      .insert(posVoids)
      .values({
        clientId: doc.clientId,
        edgeNodeId: node.id,
        tillId: till.id,
        shiftId: shift?.id ?? null,
        cashierUserId: doc.cashierUserId,
        approvedBy: doc.approvedByUserId,
        reason: doc.reason,
        voidedAt: doc.voidedAt,
        total: doc.total,
      })
      .returning({ id: posVoids.id });
    if (!row) throw new Error('no void row');
    await tx.insert(posVoidLines).values(
      doc.lines.map((line, index) => {
        const product = products.get(line.productId);
        const unit = units.get(line.productUnitId);
        return {
          voidId: row.id,
          lineNo: index + 1,
          productId: line.productId,
          productUnitId: line.productUnitId,
          productSku: product?.sku ?? '',
          productName: product?.name ?? '',
          uomName: unit?.uomName ?? '',
          qty: line.qty,
          unitPrice: line.unitPrice,
          total: line.total,
        };
      }),
    );
    await this.audit.record(tx, actor, {
      action: 'ACCEPT',
      entity: 'pos_voids',
      entityId: row.id,
      after: {
        reason: doc.reason,
        tillCode: till.code,
        shiftNumber: shift?.number ?? null,
        cashierUserId: doc.cashierUserId,
        approvedBy: doc.approvedByUserId,
        total: doc.total.toFixed(2),
        lines: doc.lines.length,
      },
    });
    return { id: row.id, number: doc.clientId, created: true };
  }

  async list(query: VoidQuery): Promise<{
    data: VoidSummary[];
    nextCursor: string | null;
    total: number | null;
    sum: Decimal | null;
  }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.tillId) filters.push(eq(posVoids.tillId, query.tillId));
    if (query.cashierUserId) filters.push(eq(posVoids.cashierUserId, query.cashierUserId));
    if (query.reason) filters.push(eq(posVoids.reason, query.reason));
    if (query.from || query.to) {
      filters.push(onBusinessDays(posVoids.voidedAt, { from: query.from, to: query.to }));
    }
    const after = decodeCursor(query.cursor);
    const paged = typeof after?.id === 'number' ? [lt(posVoids.id, after.id)] : [];
    const rows = await this.db
      .select()
      .from(posVoids)
      .where(and(...filters, ...paged))
      .orderBy(desc(posVoids.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    let total: number | null = null;
    let sum: Decimal | null = null;
    if (!query.cursor) {
      const [counted] = await this.db
        .select({
          count: sql<string>`count(*)`,
          sum: sql<string>`coalesce(sum(${posVoids.total}), 0)`,
        })
        .from(posVoids)
        .where(and(...filters));
      total = Number.parseInt(counted?.count ?? '0', 10);
      sum = new Decimal(counted?.sum ?? '0');
    }
    return { data: await this.summaries(page.data), nextCursor: page.nextCursor, total, sum };
  }

  async get(id: number): Promise<VoidDetail> {
    const [row] = await this.db.select().from(posVoids).where(eq(posVoids.id, id));
    if (!row) throw notFound('pos_void', id);
    const [summary] = await this.summaries([row]);
    if (!summary) throw notFound('pos_void', id);
    const lines = await this.db
      .select()
      .from(posVoidLines)
      .where(eq(posVoidLines.voidId, id))
      .orderBy(asc(posVoidLines.lineNo));
    return {
      ...summary,
      lines: lines.map((line) => ({
        lineNo: line.lineNo,
        productId: line.productId,
        productUnitId: line.productUnitId,
        productSku: line.productSku,
        productName: line.productName,
        uomName: line.uomName,
        qty: line.qty,
        unitPrice: line.unitPrice,
        total: line.total,
      })),
    };
  }

  private async summaries(rows: (typeof posVoids.$inferSelect)[]): Promise<VoidSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const counts = new Map(
      (
        await this.db
          .select({ voidId: posVoidLines.voidId, count: sql<string>`count(*)` })
          .from(posVoidLines)
          .where(inArray(posVoidLines.voidId, ids))
          .groupBy(posVoidLines.voidId)
      ).map((row) => [row.voidId, Number.parseInt(row.count, 10)]),
    );
    const tills = new Map(
      (
        await this.db
          .select({ id: posTills.id, code: posTills.code })
          .from(posTills)
          .where(inArray(posTills.id, [...new Set(rows.map((row) => row.tillId))]))
      ).map((till) => [till.id, till.code]),
    );
    const shiftIds = [
      ...new Set(rows.flatMap((row) => (row.shiftId === null ? [] : [row.shiftId]))),
    ];
    const shifts = new Map(
      shiftIds.length
        ? (
            await this.db
              .select({ id: posShifts.id, number: posShifts.number })
              .from(posShifts)
              .where(inArray(posShifts.id, shiftIds))
          ).map((shift) => [shift.id, shift.number])
        : [],
    );
    const names = await this.names.namesOf([
      ...new Set(
        rows.flatMap((row) =>
          row.approvedBy === null ? [row.cashierUserId] : [row.cashierUserId, row.approvedBy],
        ),
      ),
    ]);
    return rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      tillId: row.tillId,
      tillCode: tills.get(row.tillId) ?? '',
      shiftId: row.shiftId,
      shiftNumber: row.shiftId === null ? null : (shifts.get(row.shiftId) ?? null),
      cashierUserId: row.cashierUserId,
      cashierName: names.get(row.cashierUserId) ?? null,
      approvedBy: row.approvedBy,
      approvedByName: row.approvedBy === null ? null : (names.get(row.approvedBy) ?? null),
      reason: row.reason,
      voidedAt: row.voidedAt,
      total: row.total,
      lineCount: counts.get(row.id) ?? 0,
    }));
  }
}
