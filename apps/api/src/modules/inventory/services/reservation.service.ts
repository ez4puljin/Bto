import { Injectable } from '@nestjs/common';
import type { StockDocType } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { stockReservations } from '../schema';
import { StockQueryService } from './stock-query.service';

const ZERO = new Decimal(0);

export interface ReservationLine {
  /** The document line the reservation belongs to. */
  lineId: number;
  warehouseId: number;
  productId: number;
  qtyBase: Decimal;
}

export interface ReservedLine {
  lineId: number;
  reserved: Decimal;
  /** What was wanted beyond the available stock (SPEC §6.4 #4). */
  backordered: Decimal;
}

/** A product's available stock in one warehouse. */
export interface Availability {
  warehouseId: number;
  available: Decimal;
}

type LockedRow = {
  id: string;
  warehouse_id: string;
  product_id: string;
  sellable_on_hand: string;
  reserved: string;
};

/**
 * Warehouse-level reservations (architecture §5.3, ADR-0055). A document reserves inside its own
 * transaction: the `warehouse_stock` rows of its (warehouse, product) pairs are locked in key
 * order, each line takes what is available (sellable − reserved) in line order, and the rest is
 * backordered; the cache's `reserved` and the ACTIVE rows of `stock_reservations` change together
 * (the nightly reconciliation compares them). Lots come with ADR-0019: today the lot-less row is
 * the one reserved.
 */
@Injectable()
export class ReservationService {
  constructor(private readonly stock: StockQueryService) {}

  async reserveInTx(
    tx: Tx,
    input: { docType: StockDocType; docId: number; lines: readonly ReservationLine[] },
  ): Promise<ReservedLine[]> {
    if (input.lines.length === 0) return [];
    const rows = await this.lockRows(tx, input.lines);
    const left = new Map<string, Decimal>();
    for (const row of rows) {
      left.set(
        `${row.warehouse_id}:${row.product_id}`,
        Decimal.max(ZERO, new Decimal(row.sellable_on_hand).minus(row.reserved)),
      );
    }
    const taken = new Map<string, Decimal>();
    const result = input.lines.map((line): ReservedLine => {
      const key = `${line.warehouseId}:${line.productId}`;
      const available = left.get(key) ?? ZERO;
      const reserved = Decimal.min(available, line.qtyBase);
      left.set(key, available.minus(reserved));
      if (reserved.gt(0)) taken.set(key, (taken.get(key) ?? ZERO).plus(reserved));
      return { lineId: line.lineId, reserved, backordered: line.qtyBase.minus(reserved) };
    });
    const updates = rows.flatMap((row) => {
      const qty = taken.get(`${row.warehouse_id}:${row.product_id}`);
      return qty ? [{ id: row.id, qty: qty.toFixed(3) }] : [];
    });
    await this.addReserved(tx, updates);
    const byLine = new Map(input.lines.map((line) => [line.lineId, line]));
    const inserts = result.flatMap((entry) => {
      const line = byLine.get(entry.lineId);
      return line && entry.reserved.gt(0)
        ? [
            {
              warehouseId: line.warehouseId,
              productId: line.productId,
              docType: input.docType,
              docId: input.docId,
              docLineId: line.lineId,
              qtyBase: entry.reserved,
            },
          ]
        : [];
    });
    if (inserts.length > 0) await tx.insert(stockReservations).values(inserts);
    return result;
  }

  /** Releases a document's ACTIVE reservations (a cancelled order); returns the rows released. */
  async releaseInTx(tx: Tx, docType: StockDocType, docId: number): Promise<number> {
    const { rows: held } = await tx.execute<{ warehouse_id: string; product_id: string }>(sql`
      SELECT DISTINCT warehouse_id::text, product_id::text FROM stock_reservations
       WHERE doc_type = ${docType} AND doc_id = ${docId} AND status = 'ACTIVE'`);
    if (held.length === 0) return 0;
    const rows = await this.lockRows(
      tx,
      held.map((row) => ({
        warehouseId: Number.parseInt(row.warehouse_id, 10),
        productId: Number.parseInt(row.product_id, 10),
      })),
    );
    const { rows: released } = await tx.execute<{
      warehouse_id: string;
      product_id: string;
      qty: string;
    }>(sql`
      WITH released AS (
        UPDATE stock_reservations SET status = 'RELEASED', updated_at = now()
         WHERE doc_type = ${docType} AND doc_id = ${docId} AND status = 'ACTIVE'
        RETURNING warehouse_id, product_id, qty_base)
      SELECT warehouse_id::text, product_id::text, sum(qty_base)::text AS qty
        FROM released GROUP BY warehouse_id, product_id`);
    const byKey = new Map(rows.map((row) => [`${row.warehouse_id}:${row.product_id}`, row.id]));
    const updates = released.flatMap((row) => {
      const id = byKey.get(`${row.warehouse_id}:${row.product_id}`);
      return id ? [{ id, qty: new Decimal(row.qty).negated().toFixed(3) }] : [];
    });
    await this.addReserved(tx, updates);
    return released.length;
  }

  /** Each product's available stock per warehouse (warehouses holding none are left out). */
  async availableOf(productIds: readonly number[]): Promise<Map<number, Availability[]>> {
    const balances = await this.stock.balancesOf(productIds);
    return new Map(
      [...balances].map(([productId, list]) => [
        productId,
        list.map((balance) => ({ warehouseId: balance.warehouseId, available: balance.available })),
      ]),
    );
  }

  /**
   * The lot-less `warehouse_stock` rows of these pairs, locked FOR UPDATE in (warehouse, product)
   * order, the lock order of every stock writer (architecture §5.3). A pair without a row has
   * nothing to reserve.
   */
  private async lockRows(
    tx: Tx,
    pairs: readonly { warehouseId: number; productId: number }[],
  ): Promise<LockedRow[]> {
    const keys = [
      ...new Map(pairs.map((p) => [`${p.warehouseId}:${p.productId}`, p])).values(),
    ].sort((a, b) => a.warehouseId - b.warehouseId || a.productId - b.productId);
    const warehouses = keys.map((key) => key.warehouseId);
    const products = keys.map((key) => key.productId);
    const { rows } = await tx.execute<LockedRow>(sql`
      SELECT ws.id::text, ws.warehouse_id::text, ws.product_id::text,
             ws.sellable_on_hand::text, ws.reserved::text
        FROM warehouse_stock ws
        JOIN unnest(${sql.param(warehouses)}::bigint[], ${sql.param(products)}::bigint[]) AS k(w, p)
          ON ws.warehouse_id = k.w AND ws.product_id = k.p
       WHERE ws.lot_id IS NULL
       ORDER BY ws.warehouse_id, ws.product_id
         FOR UPDATE OF ws`);
    return rows;
  }

  private async addReserved(
    tx: Tx,
    updates: readonly { id: string; qty: string }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    await tx.execute(sql`
      UPDATE warehouse_stock ws SET reserved = ws.reserved + v.qty, updated_at = now()
        FROM unnest(${sql.param(updates.map((u) => u.id))}::bigint[],
                    ${sql.param(updates.map((u) => u.qty))}::numeric[]) AS v(id, qty)
       WHERE ws.id = v.id`);
  }
}
