import { Inject, Injectable } from '@nestjs/common';
import { STOCK_PROBLEM_WINDOW_DAYS, type StockProblemEventKind } from '@tugeel/shared';
import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { MAX_PAGE_LIMIT } from '../../../common/pagination/page';
import { PosQueryService } from '../../pos';

/** One thing the system got wrong about a product in a warehouse. */
export interface ProblemEvent {
  kind: StockProblemEventKind;
  warehouseId: number;
  productId: number;
  /** Base units: what the till sold beyond the shelf, or what the order lost. */
  qtyBase: Decimal;
  at: Date;
  /** A till sale (`POS_SHORTFALL`). */
  shortfallId: number | null;
  saleId: number | null;
  saleNumber: string | null;
  /** An order (`BACKORDER`, `SHORT_PICK`). */
  orderId: number | null;
  orderNumber: string | null;
  orderLineId: number | null;
  customerId: number | null;
  customerName: string | null;
  /** Who entered the order: the rep for the rep app's orders. */
  repName: string | null;
  /** Ordered, in base units. */
  orderedQtyBase: Decimal | null;
}

interface CutRow extends Record<string, unknown> {
  kind: 'BACKORDER' | 'SHORT_PICK';
  warehouse_id: string;
  product_id: string;
  qty_base: string;
  at: Date;
  order_id: string;
  order_number: string | null;
  order_line_id: string;
  customer_id: string;
  customer_name: string;
  rep_name: string | null;
  ordered_qty_base: string;
}

const toId = (value: string): number => Number.parseInt(value, 10);

/** The first moment the list looks back to: older events leave by themselves. */
export function problemWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - STOCK_PROBLEM_WINDOW_DAYS * 86_400_000);
}

/**
 * Where the problem events are read (ADR-0230 #2). The tills' open shortfalls come from the pos
 * module's own list. The orders' cut lines have no reader in the sales module, so this one file
 * reads `sales_order_lines`, `sales_orders` and `sales_order_picks` with plain SQL, read only, as
 * the reports do (architecture §3.1 rule 4); nothing else in the module names another module's
 * table, and nothing here writes one.
 */
@Injectable()
export class ProblemSourcesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly pos: PosQueryService,
  ) {}

  /**
   * The events of these warehouses inside the window, newest first. `productId` narrows the read
   * to one product.
   */
  async events(
    warehouseIds: readonly number[],
    productId?: number,
    now: Date = new Date(),
  ): Promise<ProblemEvent[]> {
    if (warehouseIds.length === 0) return [];
    const since = problemWindowStart(now);
    const [red, cut] = await Promise.all([
      this.shortfalls(new Set(warehouseIds), since, productId),
      this.cuts(warehouseIds, since, productId),
    ]);
    return [...red, ...cut].sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /** «Улайсан»: the till shortfalls nobody has checked yet (ADR-0063 #5), newest first. */
  async shortfalls(
    warehouseIds: ReadonlySet<number>,
    since: Date,
    productId?: number,
  ): Promise<ProblemEvent[]> {
    const events: ProblemEvent[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.pos.listShortfalls({
        resolved: false,
        limit: MAX_PAGE_LIMIT,
        ...(productId === undefined ? {} : { productId }),
        ...(cursor === undefined ? {} : { cursor }),
      });
      let older = false;
      for (const row of page.data) {
        if (row.createdAt < since) {
          older = true;
          continue;
        }
        if (!warehouseIds.has(row.warehouseId)) continue;
        events.push({
          kind: 'POS_SHORTFALL',
          warehouseId: row.warehouseId,
          productId: row.productId,
          qtyBase: row.qtyBase,
          at: row.createdAt,
          shortfallId: row.id,
          saleId: row.saleId,
          saleNumber: row.saleNumber,
          orderId: null,
          orderNumber: null,
          orderLineId: null,
          customerId: null,
          customerName: null,
          repName: null,
          orderedQtyBase: null,
        });
      }
      // The list is newest first by id: once a page reaches the window's start, the rest is older.
      if (older || page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    return events;
  }

  /**
   * «Дарагдсан»: a confirmed order's line the system could not reserve in full (`BACKORDER`, at the
   * order's confirmation) and a picked line the picker found less of than was reserved
   * (`SHORT_PICK`, when the warehouse's part was picked). Drafts have no split yet.
   */
  private async cuts(
    warehouseIds: readonly number[],
    since: Date,
    productId?: number,
  ): Promise<ProblemEvent[]> {
    const warehouses = sql.join(
      warehouseIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const product = productId === undefined ? sql`` : sql`AND l.product_id = ${productId}`;
    const { rows } = await this.db.execute<CutRow>(sql`
      SELECT 'BACKORDER' AS kind, l.warehouse_id, l.product_id, l.qty_backordered AS qty_base,
             COALESCE(o.confirmed_at, o.submitted_at, o.created_at) AS at,
             o.id AS order_id, o.number AS order_number, l.id AS order_line_id,
             o.customer_id, c.name AS customer_name, u.full_name AS rep_name,
             l.qty_base AS ordered_qty_base
        FROM sales_order_lines l
        JOIN sales_orders o ON o.id = l.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = o.created_by
       WHERE l.qty_backordered > 0
         AND o.status <> 'DRAFT'
         AND l.warehouse_id IN (${warehouses})
         AND COALESCE(o.confirmed_at, o.submitted_at, o.created_at) >= ${since.toISOString()}::timestamptz
         ${product}
      UNION ALL
      SELECT 'SHORT_PICK' AS kind, l.warehouse_id, l.product_id,
             l.qty_approved - l.qty_picked AS qty_base,
             p.done_at AS at,
             o.id AS order_id, o.number AS order_number, l.id AS order_line_id,
             o.customer_id, c.name AS customer_name, u.full_name AS rep_name,
             l.qty_base AS ordered_qty_base
        FROM sales_order_lines l
        JOIN sales_orders o ON o.id = l.order_id
        JOIN sales_order_picks p ON p.order_id = l.order_id AND p.warehouse_id = l.warehouse_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = o.created_by
       WHERE l.qty_picked IS NOT NULL
         AND l.qty_picked < l.qty_approved
         AND p.status = 'DONE'
         AND l.warehouse_id IN (${warehouses})
         AND p.done_at >= ${since.toISOString()}::timestamptz
         ${product}
       ORDER BY at DESC, order_line_id DESC
    `);
    return rows.map((row) => ({
      kind: row.kind,
      warehouseId: toId(row.warehouse_id),
      productId: toId(row.product_id),
      qtyBase: new Decimal(row.qty_base),
      at: new Date(row.at),
      shortfallId: null,
      saleId: null,
      saleNumber: null,
      orderId: toId(row.order_id),
      orderNumber: row.order_number,
      orderLineId: toId(row.order_line_id),
      customerId: toId(row.customer_id),
      customerName: row.customer_name,
      repName: row.rep_name,
      orderedQtyBase: new Decimal(row.ordered_qty_base),
    }));
  }
}
