import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '@tugeel/shared/auth';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { ATTENTION_CAP } from '../../../common/attention';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { type AuthContext, OrgService } from '../../identity';
import { adjustments, goodsReceipts, stocktakes, transfers } from '../schema';
import { StockQueryService } from './stock-query.service';

const SHELF_KINDS = new Set(['WHOLESALE', 'STORE']);

export interface InventoryAttention {
  /** Requests waiting for the caller's warehouses to ship them. */
  transfersToShip: number;
  /** Shipments on their way to the caller's warehouses (a request's group is counted there). */
  transfersToReceive: number;
  /** Request groups the caller's warehouses sent, counted by the destination, to confirm (ADR-0116). */
  transfersToConfirm: number;
  adjustmentsToApprove: number;
  stocktakesToReview: number;
  /** Posted receipts waiting for their costs. */
  receiptsToCost: number;
  /** Low-stock lines over the caller's warehouses, and the warehouse with the most of them. */
  lowStock: { count: number; warehouseId: number | null };
}

/**
 * The home page's attention counts for inventory (ADR-0047 #7): the work waiting for the caller,
 * each count capped at ATTENTION_CAP and 0 without the permission that does that work. Warehouse
 * counts follow the caller's write scope (every warehouse for an unscoped caller), as the steps
 * themselves do.
 */
@Injectable()
export class InventoryAttentionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly org: OrgService,
    private readonly stock: StockQueryService,
  ) {}

  async counts(ctx: AuthContext): Promise<InventoryAttention> {
    const may = (permission: Permission) => ctx.permissions.has(permission);
    const scope = ctx.writableWarehouseIds === null ? null : [...ctx.writableWarehouseIds];
    const within = (column: AnyPgColumn): SQL =>
      scope === null ? sql`true` : scope.length === 0 ? sql`false` : inArray(column, scope);
    const count = async (
      table: typeof transfers | typeof adjustments | typeof stocktakes | typeof goodsReceipts,
      where: SQL | undefined,
    ) =>
      (
        await this.db
          .select({ one: sql`1` })
          .from(table)
          .where(where)
          .limit(ATTENTION_CAP)
      ).length;
    const none = Promise.resolve(0);
    const transferring = may('inventory.transfers.manage');

    const [toShip, toReceive, toConfirm, toApprove, toReview, toCost, lowStock] = await Promise.all(
      [
        transferring
          ? count(
              transfers,
              and(eq(transfers.status, 'REQUESTED'), within(transfers.sourceWarehouseId)),
            )
          : none,
        transferring
          ? count(
              transfers,
              and(eq(transfers.status, 'SHIPPED'), within(transfers.destWarehouseId)),
            )
          : none,
        transferring
          ? count(
              transfers,
              and(eq(transfers.status, 'COUNTED'), within(transfers.sourceWarehouseId)),
            )
          : none,
        may('inventory.adjustments.approve')
          ? count(
              adjustments,
              and(eq(adjustments.status, 'SUBMITTED'), within(adjustments.warehouseId)),
            )
          : none,
        may('inventory.stocktakes.approve')
          ? count(stocktakes, and(eq(stocktakes.status, 'REVIEW'), within(stocktakes.warehouseId)))
          : none,
        may('inventory.costs.manage')
          ? count(
              goodsReceipts,
              and(eq(goodsReceipts.status, 'POSTED'), eq(goodsReceipts.costingStatus, 'PENDING')),
            )
          : none,
        transferring ? this.lowStock(scope) : Promise.resolve({ count: 0, warehouseId: null }),
      ],
    );
    return {
      transfersToShip: toShip,
      transfersToReceive: toReceive,
      transfersToConfirm: toConfirm,
      adjustmentsToApprove: toApprove,
      stocktakesToReview: toReview,
      receiptsToCost: toCost,
      lowStock,
    };
  }

  /** The low-stock list's own rule, warehouse by warehouse (ADR-0039). */
  private async lowStock(scope: readonly number[] | null) {
    const warehouses = (await this.org.listWarehouses()).filter(
      (warehouse) =>
        warehouse.status === 'ACTIVE' &&
        SHELF_KINDS.has(warehouse.kind) &&
        (scope === null || scope.includes(warehouse.id)),
    );
    let total = 0;
    let most: { warehouseId: number; count: number } | null = null;
    for (const warehouse of warehouses) {
      const count = await this.stock.lowStockCount(warehouse.id, ATTENTION_CAP);
      total += count;
      if (count > 0 && (most === null || count > most.count)) {
        most = { warehouseId: warehouse.id, count };
      }
      if (total >= ATTENTION_CAP) break;
    }
    return { count: Math.min(total, ATTENTION_CAP), warehouseId: most?.warehouseId ?? null };
  }
}
