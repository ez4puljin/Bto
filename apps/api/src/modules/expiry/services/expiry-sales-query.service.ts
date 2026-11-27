import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Decimal } from '@tugeel/shared/money';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError, notFound } from '../../../common/errors/app-error';
import {
  decodeCursor,
  invalidCursor,
  toPage,
  type PageQueryDto,
} from '../../../common/pagination/page';
import { type AuthContext, OrgService } from '../../identity';
import type { ExpirySalesPageDto } from '../dto/expiry-commerce.dto';
import { EXPIRY_SALE_CONTEXTS, type ExpirySaleContexts } from '../ports';
import { expiryItems } from '../schema';

type Event = {
  id: number;
  kind: 'SALE' | 'RETURN';
  occurred_at: string;
  qty_base: string;
  gross_amount: string | null;
  warehouse_id: number;
  channel: 'RETAIL' | 'WHOLESALE';
  context_id: number;
  sale_id: string;
};

/** Only our UTC cursor representation is accepted; Date.parse alone normalizes invalid days. */
function validCursorTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(value) ||
    value.startsWith('0000-')
  )
    return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

/** Allocation evidence only: unrelated product sales and unresolved diagnostics are not sales rows. */
@Injectable()
export class ExpirySalesQueryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly org: OrgService,
    private readonly modules: ModuleRef,
  ) {}

  async list(ctx: AuthContext, itemId: number, query: PageQueryDto): Promise<ExpirySalesPageDto> {
    if (!ctx.permissions.has('inventory.costs.manage')) throw new AppError('FORBIDDEN');
    const [item] = await this.db
      .select({ id: expiryItems.id })
      .from(expiryItems)
      .where(eq(expiryItems.id, itemId));
    if (!item) throw notFound('expiry item', itemId);
    const cursor = decodeCursor(query.cursor);
    if (
      cursor &&
      (cursor.item !== itemId ||
        !validCursorTime(cursor.t) ||
        !['SALE', 'RETURN'].includes(String(cursor.k)) ||
        typeof cursor.i !== 'number' ||
        !Number.isSafeInteger(cursor.i) ||
        cursor.i < 1)
    )
      throw invalidCursor();
    const after = cursor
      ? sql`WHERE (occurred_at, kind, id) < (${cursor.t as string}::timestamptz, ${cursor.k as string}::text, ${cursor.i as number}::bigint)`
      : sql``;
    const limit = query.limit ?? 50;
    const result = await this.db.execute<Event & Record<string, unknown>>(sql`
      WITH events AS (
        SELECT s.id, 'SALE'::text kind, s.sold_at occurred_at, s.qty_base,
          s.input::jsonb->>'grossAmount' gross_amount, m.warehouse_id, m.channel, m.context_id, s.sale_id
        FROM expiry_sale_allocations s JOIN expiry_markdowns m ON m.id=s.markdown_id
        WHERE m.item_id=${itemId}
        UNION ALL
        SELECT r.id, 'RETURN', r.returned_at, r.qty_base, NULL::text,
          m.warehouse_id, m.channel, m.context_id, s.sale_id
        FROM expiry_return_allocations r JOIN expiry_sale_allocations s ON s.id=r.sale_allocation_id
        JOIN expiry_markdowns m ON m.id=s.markdown_id WHERE m.item_id=${itemId}
      ) SELECT id::float8, kind, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at, qty_base::text, gross_amount,
        warehouse_id::float8, channel, context_id::float8, sale_id
      FROM events ${after} ORDER BY events.occurred_at DESC, events.kind DESC, events.id DESC LIMIT ${limit + 1}
    `);
    // Preserve PostgreSQL microseconds in the cursor; JSON Date conversion would skip ties.
    const page = toPage(result.rows, limit, (row) => ({
      item: itemId,
      t: row.occurred_at,
      k: row.kind,
      i: row.id,
    }));
    const [names, contexts] = await Promise.all([
      this.org.warehouseNames(page.data.map((row) => row.warehouse_id)),
      this.modules.get<ExpirySaleContexts>(EXPIRY_SALE_CONTEXTS, { strict: false }).list(this.db),
    ]);
    return {
      nextCursor: page.nextCursor,
      data: page.data.map((row) => {
        const amount =
          row.gross_amount !== null && /^\d+(\.\d+)?$/.test(row.gross_amount)
            ? new Decimal(row.gross_amount)
            : null;
        const context = contexts.find(
          (c) =>
            c.warehouseId === row.warehouse_id &&
            c.channel === row.channel &&
            c.contextId === row.context_id,
        );
        return {
          id: row.id,
          kind: row.kind,
          occurredAt: new Date(row.occurred_at).toISOString(),
          qtyBase: row.qty_base,
          unitPrice: amount?.div(row.qty_base).toFixed(4) ?? null,
          totalAmount: amount?.toFixed(2) ?? null,
          warehouseId: row.warehouse_id,
          warehouseName: names.get(row.warehouse_id) ?? null,
          channel: row.channel,
          contextId: row.context_id,
          contextName: context?.name ?? null,
          saleId: row.sale_id,
        };
      }),
    };
  }
}
