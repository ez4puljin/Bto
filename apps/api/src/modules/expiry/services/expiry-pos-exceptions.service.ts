import { Inject, Injectable } from '@nestjs/common';
import type {
  ExpirySaleInput,
  ExpiryReturnInput,
  ExpiryExceptionView,
} from '@tugeel/shared/expiry';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  decodeCursor,
  invalidCursor,
  toPage,
  type PageQueryDto,
} from '../../../common/pagination/page';
import { type AuthContext, AuditService, ScopeService } from '../../identity';
import { expiryPosExceptions } from '../schema';
import { ExpiryCommerceService } from './expiry-commerce.service';

const DIAGNOSTIC_REASONS = new Set([
  'EXPIRY_CONTEXT_MISMATCH',
  'EXPIRY_UNIT_MISMATCH',
  'EXPIRY_NOT_EFFECTIVE',
  'EXPIRY_BUDGET_EXCEEDED',
  'EXPIRY_SALE_REPLAY_MISMATCH',
  'EXPIRY_PRICE_MISMATCH',
  'EXPIRY_LIABILITY_UNAVAILABLE',
  'EXPIRY_RETURN_SOURCE_MISSING',
  'EXPIRY_RETURN_REPLAY_MISMATCH',
  'EXPIRY_RETURN_EXCEEDS_SALE',
]);
function diagnosticCode(error: AppError): string {
  const reason = error.params?.reason;
  return typeof reason === 'string' && DIAGNOSTIC_REASONS.has(reason) ? reason : error.code;
}

/** Records only canonical POS facts and stable codes, never arbitrary exception details/params. */
@Injectable()
export class ExpiryPosExceptionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly commerce: ExpiryCommerceService,
  ) {}

  async previous(
    tx: Tx,
    operation: 'SALE' | 'RETURN',
    documentId: string,
    lineId: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ code: expiryPosExceptions.code })
      .from(expiryPosExceptions)
      .where(
        and(
          eq(expiryPosExceptions.operation, operation),
          eq(expiryPosExceptions.documentId, documentId),
          eq(expiryPosExceptions.lineId, lineId),
        ),
      );
    return row?.code ?? null;
  }

  async recordSaleInTx(tx: Tx, input: ExpirySaleInput, error: AppError): Promise<string> {
    const code = diagnosticCode(error);
    await tx
      .insert(expiryPosExceptions)
      .values({
        operation: 'SALE',
        documentId: input.saleId,
        lineId: input.lineId,
        barcode: input.barcode,
        productId: input.productId,
        productUnitId: input.productUnitId,
        warehouseId: input.warehouseId,
        contextId: input.contextId,
        qtyBase: input.qtyBase,
        occurredAt: input.soldAt,
        code,
      })
      .onConflictDoNothing();
    return code;
  }

  async recordReturnInTx(tx: Tx, input: ExpiryReturnInput, error: AppError): Promise<void> {
    const context = input.expiryContext;
    if (!context)
      throw new Error('a POS expiry return diagnostic requires trusted original line context');
    await tx
      .insert(expiryPosExceptions)
      .values({
        operation: 'RETURN',
        documentId: input.returnId,
        lineId: input.returnLineId,
        originalSaleId: input.saleId,
        originalLineId: input.lineId,
        ...context,
        qtyBase: input.qtyBase,
        occurredAt: input.returnedAt,
        code: diagnosticCode(error),
      })
      .onConflictDoNothing();
  }

  async list(
    ctx: AuthContext,
    query: PageQueryDto,
  ): Promise<{ data: ExpiryExceptionView[]; nextCursor: string | null }> {
    if (!ctx.permissions.has('inventory.costs.manage')) throw new AppError('FORBIDDEN');
    const cursor = decodeCursor(query.cursor);
    if (
      cursor &&
      (typeof cursor.t !== 'string' ||
        !Number.isFinite(Date.parse(cursor.t)) ||
        !['SALE_EXCEPTION', 'POS_EXCEPTION'].includes(String(cursor.o)) ||
        !Number.isSafeInteger(cursor.i))
    )
      throw invalidCursor();
    const limit = query.limit ?? 50;
    const after = cursor
      ? sql`WHERE (created_at, origin, id) < (${cursor.t as string}::timestamptz, ${cursor.o as string}::text, ${cursor.i as number}::bigint)`
      : sql``;
    // Reads are global under ADR-0027; warehouse scopes restrict acknowledgement writes only.
    const rows = await this.db.execute<ExpiryExceptionView & Record<string, unknown>>(sql`
      WITH exceptions AS (
        SELECT 'SALE_EXCEPTION'::text AS origin, e.id, 'SALE'::text AS operation,
          e.sale_id AS document_id, e.line_id, NULL::text AS original_sale_id, NULL::text AS original_line_id,
          'BTOEXP-' || m.id::text AS barcode, m.product_id, m.warehouse_id, e.reason,
          e.qty_base, e.sold_at AS occurred_at, e.created_at,
          e.resolved_at AS acknowledged_at, e.resolution_note AS acknowledgement_note,
          'SALE_UNALLOCATED'::text AS financial_effect
        FROM expiry_sale_exceptions e JOIN expiry_markdowns m ON m.id=e.markdown_id
        UNION ALL
        SELECT 'POS_EXCEPTION', id, operation, document_id, line_id, original_sale_id, original_line_id,
          barcode, product_id, warehouse_id, code, qty_base, occurred_at, created_at,
          acknowledged_at, acknowledgement_note,
          CASE WHEN operation='RETURN' THEN 'RETURN_REVERSAL_UNRESOLVED' ELSE 'SALE_UNALLOCATED' END
        FROM expiry_pos_exceptions
      )
      SELECT origin, id::float8 AS id, operation, document_id AS "documentId", line_id AS "lineId",
        original_sale_id AS "originalSaleId", original_line_id AS "originalLineId", barcode,
        product_id::float8 AS "productId", warehouse_id::float8 AS "warehouseId", reason,
        qty_base::text AS "qtyBase", occurred_at::text AS "occurredAt", created_at::text AS "createdAt",
        acknowledged_at::text AS "acknowledgedAt", acknowledgement_note AS "acknowledgementNote",
        financial_effect AS "financialEffect"
      FROM exceptions ${after} ORDER BY created_at DESC, origin DESC, id DESC LIMIT ${limit + 1}
    `);
    return toPage(rows.rows, limit, (row) => ({ t: row.createdAt, o: row.origin, i: row.id }));
  }

  async acknowledge(
    ctx: AuthContext,
    origin: 'SALE_EXCEPTION' | 'POS_EXCEPTION',
    id: number,
    note: string,
  ): Promise<void> {
    if (
      (
        ['inventory.costs.manage', 'expiry.liability.manage', 'pricing.prices.manage'] as const
      ).some((right) => !ctx.permissions.has(right))
    )
      throw new AppError('FORBIDDEN');
    if (!note.trim() || note.trim().length > 500)
      throw invalid('note', 'length', 'a reason of 1 to 500 characters is required');
    if (origin === 'SALE_EXCEPTION') {
      await this.commerce.resolveException(ctx, id, note);
      return;
    }
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(expiryPosExceptions)
        .where(eq(expiryPosExceptions.id, id))
        .for('update');
      if (!row) throw notFound('POS expiry exception', id);
      this.scope.assertCanWriteWarehouse(ctx, row.warehouseId);
      if (row.acknowledgedAt) return;
      await tx
        .update(expiryPosExceptions)
        .set({
          acknowledgedAt: new Date(),
          acknowledgedBy: ctx.userId,
          acknowledgementNote: note.trim(),
        })
        .where(eq(expiryPosExceptions.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'expiry_pos_exceptions',
        entityId: id,
        after: { acknowledged: true, operation: row.operation, financialRepair: false },
      });
    });
  }
}
