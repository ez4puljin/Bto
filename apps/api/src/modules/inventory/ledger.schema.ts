import type { MovementType, StockDocType } from '@tugeel/shared/inventory';
import {
  bigint,
  boolean,
  date,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { cost, factor, money, qty } from '../../common/db/types';

// The ledger, the valuation history and the stock snapshots (docs/architecture.md §5.3; ADR-0007,
// ADR-0033, ADR-0034). Their DDL is hand-written in migration 0006_inventory_ledger (append-only
// guards, CHECKs, monthly partitions); these Drizzle objects only type the queries of
// stock-posting.service.ts. The schema aggregator does not export this file, so drizzle-kit never
// sees these tables, and ESLint G2 keeps `stockLedger` and `stockValuationAdjustments` inside
// stock-posting.service.ts.

const ref = (name: string) => bigint(name, { mode: 'number' });

/** Every stock movement, append-only; one row per (document line, movement type, leg). */
export const stockLedger = pgTable('stock_ledger', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
  warehouseId: ref('warehouse_id').notNull(),
  binId: ref('bin_id').notNull(),
  productId: ref('product_id').notNull(),
  lotId: ref('lot_id'),
  qtyBase: qty('qty_base').notNull(),
  unitCost: cost('unit_cost').notNull(),
  movementType: text('movement_type').$type<MovementType>().notNull(),
  docType: text('doc_type').$type<StockDocType>().notNull(),
  docId: ref('doc_id').notNull(),
  docLineId: ref('doc_line_id').notNull(),
  leg: smallint('leg').notNull(),
  enteredQty: qty('entered_qty').notNull(),
  productUnitId: ref('product_unit_id').notNull(),
  factorSnapshot: factor('factor_snapshot').notNull(),
  createdBy: ref('created_by'),
});

/** Costing versions of goods-receipt lines and their effect on the average (ADR-0033). */
export const stockValuationAdjustments = pgTable('stock_valuation_adjustments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
  warehouseId: ref('warehouse_id').notNull(),
  productId: ref('product_id').notNull(),
  lotId: ref('lot_id'),
  docType: text('doc_type').$type<StockDocType>().notNull(),
  docId: ref('doc_id').notNull(),
  docLineId: ref('doc_line_id').notNull(),
  version: integer('version').notNull(),
  qtyBase: qty('qty_base').notNull(),
  freeGoods: boolean('free_goods').notNull(),
  amount: money('amount').notNull(),
  valueBefore: money('value_before').notNull(),
  valueDelta: money('value_delta').notNull(),
  onHandAt: qty('on_hand_at').notNull(),
  absorbed: money('absorbed').notNull(),
  variance: money('variance').notNull(),
  avgBefore: cost('avg_before').notNull(),
  avgAfter: cost('avg_after').notNull(),
  createdBy: ref('created_by'),
});

/** Non-zero warehouse balances per Ulaanbaatar day, written by the reconciliation (D9). */
export const stockSnapshotDaily = pgTable('stock_snapshot_daily', {
  snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
  warehouseId: ref('warehouse_id').notNull(),
  productId: ref('product_id').notNull(),
  lotId: ref('lot_id'),
  onHand: qty('on_hand').notNull(),
  sellableOnHand: qty('sellable_on_hand').notNull(),
  reserved: qty('reserved').notNull(),
  avgCost: cost('avg_cost').notNull(),
});

/** Bin balances on the first day of each month (D9; written from delivery 2's schedule). */
export const stockSnapshotBinMonthly = pgTable('stock_snapshot_bin_monthly', {
  snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
  warehouseId: ref('warehouse_id').notNull(),
  binId: ref('bin_id').notNull(),
  productId: ref('product_id').notNull(),
  lotId: ref('lot_id'),
  onHand: qty('on_hand').notNull(),
});
