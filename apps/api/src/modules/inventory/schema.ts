import {
  ADJUSTMENT_REASON_CODES,
  BIN_TYPES,
  SELLABLE_BIN_TYPES,
  STOCK_DOC_TYPES,
  TRANSFER_ORIGINS,
  TRANSFER_STATUSES,
  USER_BIN_TYPES,
} from '@tugeel/shared/inventory';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { cost, factor, jsonValue, qty } from '../../common/db/types';
import { productUnits, products } from '../catalog/schema';
import { users, warehouses } from '../identity/schema';
import { suppliers } from '../partners/schema';

// Tables owned by the inventory module (docs/architecture.md §4, §5.1, §5.3; docs/modules/inventory.md;
// ADR-0007, ADR-0019, ADR-0033, ADR-0034). The ledger, the valuation history and the partitioned
// snapshots have hand-written DDL (migration 0006_inventory_ledger) and live in ./ledger.schema.ts,
// which the schema aggregator does not export (ESLint G2). Migration 0005_inventory adds by hand the
// bin guard trigger, NULLS NOT DISTINCT on the active-reservation key, fillfactor and REVOKEs.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const userRef = (name: string) => ref(name).references(() => users.id);
const zero = sql`0`;

/** `column IN ('A', 'B')` for an enum list, written into CHECK constraints. */
const inList = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

export const BIN_STATUSES = ['ACTIVE', 'COUNTING'] as const;
export const RECEIPT_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const;
export const COSTING_STATUSES = ['PENDING', 'COSTED'] as const;
export const BIN_MOVE_STATUSES = ['DRAFT', 'POSTED'] as const;
export const ADJUSTMENT_STATUSES = ['DRAFT', 'SUBMITTED', 'POSTED', 'CANCELLED'] as const;
export const STOCKTAKE_STATUSES = ['DRAFT', 'COUNTING', 'REVIEW', 'APPROVED', 'CANCELLED'] as const;
export const RESERVATION_STATUSES = ['ACTIVE', 'CONSUMED', 'RELEASED'] as const;
export const RECONCILIATION_STATUSES = ['OK', 'DRIFT'] as const;

/**
 * Bins (§5.1). The code is the text of the shelf label (normalised, unique per warehouse); system
 * bins exist once per warehouse and type; `sellable` follows the type. A stocktake sets the bins it
 * counts to COUNTING and names itself in `locked_by_stocktake_id`. A trigger keeps warehouse, code,
 * type and the system flag fixed; a bin that was never used may be deleted, a used one is archived.
 */
export const bins = pgTable(
  'bins',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    code: text('code').notNull(),
    name: text('name'),
    type: text('type', { enum: BIN_TYPES }).notNull(),
    sellable: boolean('sellable')
      .notNull()
      .generatedAlwaysAs(
        sql.raw(`"type" IN (${SELLABLE_BIN_TYPES.map((t) => `'${t}'`).join(', ')})`),
      ),
    status: text('status', { enum: BIN_STATUSES }).notNull().default('ACTIVE'),
    lockedByStocktakeId: ref('locked_by_stocktake_id').references((): AnyPgColumn => stocktakes.id),
    isSystem: boolean('is_system').notNull().default(false),
    pickSequence: integer('pick_sequence'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('bins_warehouse_code_key').on(t.warehouseId, t.code),
    // The target of composite foreign keys: a bin is always used together with its warehouse.
    unique('bins_warehouse_id_key').on(t.warehouseId, t.id),
    uniqueIndex('bins_one_system_type')
      .on(t.warehouseId, t.type)
      .where(sql`${t.isSystem}`),
    check(
      'bins_code',
      sql`length(${t.code}) BETWEEN 1 AND 32 AND ${t.code} ~ '^[A-Z0-9][A-Z0-9._/-]*$'`,
    ),
    check('bins_type', inList(t.type, BIN_TYPES)),
    // People create shelves; every other type is a system bin.
    check('bins_system_type', sql`${t.isSystem} = NOT (${inList(t.type, USER_BIN_TYPES)})`),
    check('bins_status', inList(t.status, BIN_STATUSES)),
    check(
      'bins_counting_lock',
      sql`(${t.status} = 'COUNTING') = (${t.lockedByStocktakeId} IS NOT NULL)`,
    ),
    check(
      'bins_archived_idle',
      sql`NOT (${t.archivedAt} IS NOT NULL AND ${t.status} = 'COUNTING')`,
    ),
    check('bins_name', sql`${t.name} IS NULL OR length(${t.name}) BETWEEN 1 AND 100`),
  ],
);

/**
 * Where a product lives in a warehouse (owner, 2026-10-11): one home warehouse per product (the
 * only wholesale warehouse it may be received into, ADR-0033), its fixed shelf there and the
 * low-stock levels. The fixed bin must belong to the same warehouse (composite key).
 */
export const productLocations = pgTable(
  'product_locations',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    isHome: boolean('is_home').notNull().default(false),
    defaultBinId: ref('default_bin_id'),
    minQty: qty('min_qty'),
    maxQty: qty('max_qty'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_locations_key').on(t.warehouseId, t.productId),
    uniqueIndex('product_locations_one_home')
      .on(t.productId)
      .where(sql`${t.isHome}`),
    index('product_locations_product_idx').on(t.productId),
    foreignKey({
      name: 'product_locations_default_bin_fk',
      columns: [t.warehouseId, t.defaultBinId],
      foreignColumns: [bins.warehouseId, bins.id],
    }),
    check(
      'product_locations_levels',
      sql`(${t.minQty} IS NULL OR ${t.minQty} >= 0) AND (${t.maxQty} IS NULL OR ${t.maxQty} >= 0)
        AND (${t.minQty} IS NULL OR ${t.maxQty} IS NULL OR ${t.minQty} <= ${t.maxQty})`,
    ),
  ],
);

/** Lots (ADR-0019): empty until a product tracks lots; `lot_id` is already on every stock table. */
export const lots = pgTable(
  'lots',
  {
    id: id(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    lotNo: text('lot_no').notNull(),
    expiryDate: date('expiry_date', { mode: 'string' }),
    supplierRef: text('supplier_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('lots_product_lot_key').on(t.productId, t.lotNo),
    check('lots_lot_no', sql`length(${t.lotNo}) BETWEEN 1 AND 50`),
  ],
);

/**
 * Warehouse balances (§5.3, D2): on hand, the sellable part, reserved and the moving average.
 * `reserved` may exceed `sellable_on_hand` after a shortage posting, so no CHECK ties them.
 * Written only by StockPostingService (and ReservationService for `reserved`, delivery 2).
 */
export const warehouseStock = pgTable(
  'warehouse_stock',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    lotId: ref('lot_id').references(() => lots.id),
    onHand: qty('on_hand').notNull().default(zero),
    sellableOnHand: qty('sellable_on_hand').notNull().default(zero),
    reserved: qty('reserved').notNull().default(zero),
    avgCost: cost('avg_cost').notNull().default(zero),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('warehouse_stock_key').on(t.warehouseId, t.productId, t.lotId).nullsNotDistinct(),
    index('warehouse_stock_product_idx').on(t.productId),
    check('warehouse_stock_nonneg', sql`${t.onHand} >= 0 AND ${t.reserved} >= 0`),
    check(
      'warehouse_stock_sellable',
      sql`${t.sellableOnHand} >= 0 AND ${t.sellableOnHand} <= ${t.onHand}`,
    ),
    check('warehouse_stock_avg_cost', sql`${t.avgCost} >= 0`),
  ],
);

/** Bin balances (§5.3), written only by StockPostingService. */
export const binStock = pgTable(
  'bin_stock',
  {
    id: id(),
    warehouseId: ref('warehouse_id').notNull(),
    binId: ref('bin_id').notNull(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    lotId: ref('lot_id').references(() => lots.id),
    onHand: qty('on_hand').notNull().default(zero),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('bin_stock_key').on(t.warehouseId, t.binId, t.productId, t.lotId).nullsNotDistinct(),
    index('bin_stock_product_idx').on(t.productId),
    foreignKey({
      name: 'bin_stock_bin_fk',
      columns: [t.warehouseId, t.binId],
      foreignColumns: [bins.warehouseId, bins.id],
    }),
    check('bin_stock_nonneg', sql`${t.onHand} >= 0`),
  ],
);

/**
 * Warehouse-level reservations of order lines (§5.3; ReservationService arrives in delivery 2).
 * Migration 0005 makes the active key NULLS NOT DISTINCT by hand (ADR-0019).
 */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    lotId: ref('lot_id').references(() => lots.id),
    docType: text('doc_type', { enum: STOCK_DOC_TYPES }).notNull(),
    docId: ref('doc_id').notNull(),
    docLineId: ref('doc_line_id').notNull(),
    qtyBase: qty('qty_base').notNull(),
    status: text('status', { enum: RESERVATION_STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('stock_reservations_active_key')
      .on(t.docType, t.docLineId, t.lotId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('stock_reservations_stock_idx')
      .on(t.warehouseId, t.productId)
      .where(sql`${t.status} = 'ACTIVE'`),
    check('stock_reservations_qty', sql`${t.qtyBase} > 0`),
    check('stock_reservations_doc_type', inList(t.docType, STOCK_DOC_TYPES)),
    check('stock_reservations_status', inList(t.status, RESERVATION_STATUSES)),
  ],
);

/** Columns every stock document header shares (ADR-0034): a number and dates only once posted. */
const postingColumns = () => ({
  number: text('number'),
  effectiveDate: date('effective_date', { mode: 'string' }),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  postedBy: userRef('posted_by'),
  createdBy: userRef('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Line columns of a quantity entered in a product unit (ADR-0008 #2). */
const lineQtyColumns = () => ({
  productId: ref('product_id')
    .notNull()
    .references(() => products.id),
  productUnitId: ref('product_unit_id')
    .notNull()
    .references(() => productUnits.id),
  enteredQty: qty('entered_qty').notNull(),
  factorSnapshot: factor('factor_snapshot').notNull(),
  qtyBase: qty('qty_base').notNull(),
  lotId: ref('lot_id').references(() => lots.id),
});

/**
 * Goods receipts (GR-, ADR-0033): counted by the warehouse and posted at once into each line's bin;
 * the accountant costs them afterwards. Costs live in stock_valuation_adjustments, never here.
 */
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    /** The supplier's delivery note (падаан) number and date. */
    supplierDocNo: text('supplier_doc_no'),
    supplierDocDate: date('supplier_doc_date', { mode: 'string' }),
    status: text('status', { enum: RECEIPT_STATUSES }).notNull().default('DRAFT'),
    costingStatus: text('costing_status', { enum: COSTING_STATUSES }),
    costingVersion: integer('costing_version').notNull().default(0),
    costedAt: timestamp('costed_at', { withTimezone: true }),
    costedBy: userRef('costed_by'),
    note: text('note'),
    ...postingColumns(),
  },
  (t) => [
    unique('goods_receipts_number_key').on(t.number),
    index('goods_receipts_warehouse_idx').on(t.warehouseId, t.status, t.id),
    index('goods_receipts_supplier_idx').on(t.supplierId, t.id),
    index('goods_receipts_costing_idx')
      .on(t.id)
      .where(sql`${t.status} = 'POSTED' AND ${t.costingStatus} = 'PENDING'`),
    check('goods_receipts_status', inList(t.status, RECEIPT_STATUSES)),
    check(
      'goods_receipts_posted',
      sql`(${t.status} = 'POSTED') = (${t.number} IS NOT NULL AND ${t.postedAt} IS NOT NULL
        AND ${t.effectiveDate} IS NOT NULL AND ${t.costingStatus} IS NOT NULL)`,
    ),
    check(
      'goods_receipts_costing',
      sql`(${t.costingStatus} IS NULL OR ${inList(t.costingStatus, COSTING_STATUSES)})
        AND ${t.costingVersion} >= 0
        AND (${t.costingVersion} = 0) = (${t.costedAt} IS NULL)
        AND (${t.costingStatus} = 'COSTED') = (${t.costingVersion} > 0)`,
    ),
    check(
      'goods_receipts_texts',
      sql`(${t.supplierDocNo} IS NULL OR length(${t.supplierDocNo}) BETWEEN 1 AND 50)
        AND (${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 500)`,
    ),
  ],
);

export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: id(),
    receiptId: ref('receipt_id')
      .notNull()
      .references(() => goodsReceipts.id),
    ...lineQtyColumns(),
    /** Destination bin in the receipt's warehouse (checked by the service and at posting). */
    binId: ref('bin_id')
      .notNull()
      .references(() => bins.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('goods_receipt_lines_receipt_idx').on(t.receiptId, t.id),
    check('goods_receipt_lines_qty', sql`${t.enteredQty} > 0 AND ${t.qtyBase} > 0`),
  ],
);

/** Bin moves (BM-): put-away from RECEIVING and any shelf-to-shelf move, posted on creation. */
export const binMoves = pgTable(
  'bin_moves',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: text('status', { enum: BIN_MOVE_STATUSES }).notNull().default('DRAFT'),
    note: text('note'),
    ...postingColumns(),
  },
  (t) => [
    unique('bin_moves_number_key').on(t.number),
    index('bin_moves_warehouse_idx').on(t.warehouseId, t.status, t.id),
    check('bin_moves_status', inList(t.status, BIN_MOVE_STATUSES)),
    check(
      'bin_moves_posted',
      sql`(${t.status} = 'POSTED') = (${t.number} IS NOT NULL AND ${t.postedAt} IS NOT NULL
        AND ${t.effectiveDate} IS NOT NULL)`,
    ),
    check('bin_moves_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 500`),
  ],
);

export const binMoveLines = pgTable(
  'bin_move_lines',
  {
    id: id(),
    moveId: ref('move_id')
      .notNull()
      .references(() => binMoves.id),
    ...lineQtyColumns(),
    fromBinId: ref('from_bin_id')
      .notNull()
      .references(() => bins.id),
    toBinId: ref('to_bin_id')
      .notNull()
      .references(() => bins.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('bin_move_lines_move_idx').on(t.moveId, t.id),
    check('bin_move_lines_qty', sql`${t.enteredQty} > 0 AND ${t.qtyBase} > 0`),
    check('bin_move_lines_bins', sql`${t.fromBinId} <> ${t.toBinId}`),
  ],
);

/**
 * Adjustments (ADJ-): the reason decides the direction (owner, 2026-10-11); warehouse staff submit,
 * an approver posts. Inbound lines may carry an explicit unit cost; otherwise the average applies.
 */
export const adjustments = pgTable(
  'adjustments',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    reason: text('reason', { enum: ADJUSTMENT_REASON_CODES }).notNull(),
    status: text('status', { enum: ADJUSTMENT_STATUSES }).notNull().default('DRAFT'),
    note: text('note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedBy: userRef('submitted_by'),
    /** An OPENING_REVERSAL names the adjustment it takes back, at most once (ADR-0036). */
    reversesAdjustmentId: ref('reverses_adjustment_id').references(
      (): AnyPgColumn => adjustments.id,
    ),
    ...postingColumns(),
  },
  (t) => [
    unique('adjustments_number_key').on(t.number),
    unique('adjustments_reverses_key').on(t.reversesAdjustmentId),
    index('adjustments_warehouse_idx').on(t.warehouseId, t.status, t.id),
    check('adjustments_reason', inList(t.reason, ADJUSTMENT_REASON_CODES)),
    check('adjustments_status', inList(t.status, ADJUSTMENT_STATUSES)),
    check(
      'adjustments_posted',
      sql`(${t.status} = 'POSTED') = (${t.number} IS NOT NULL AND ${t.postedAt} IS NOT NULL
        AND ${t.effectiveDate} IS NOT NULL)`,
    ),
    check('adjustments_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 500`),
  ],
);

export const adjustmentLines = pgTable(
  'adjustment_lines',
  {
    id: id(),
    adjustmentId: ref('adjustment_id')
      .notNull()
      .references(() => adjustments.id),
    ...lineQtyColumns(),
    binId: ref('bin_id')
      .notNull()
      .references(() => bins.id),
    /** Inbound lines: the cost per base unit set by an approver; NULL = the average at posting. */
    unitCost: cost('unit_cost'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('adjustment_lines_adjustment_idx').on(t.adjustmentId, t.id),
    check('adjustment_lines_qty', sql`${t.enteredQty} > 0 AND ${t.qtyBase} > 0`),
    check('adjustment_lines_cost', sql`${t.unitCost} IS NULL OR ${t.unitCost} >= 0`),
    check('adjustment_lines_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 300`),
  ],
);

/**
 * Transfers (TR-, ADR-0035): requested by the receiver (REQUEST) or sent on the sender's own
 * initiative (PUSH, e.g. supermarket returns); shipped into TRANSIT and received at the destination,
 * where a shortfall goes back to the sender and a surplus comes out of the sender's stock.
 */
export const transfers = pgTable(
  'transfers',
  {
    id: id(),
    number: text('number'),
    origin: text('origin', { enum: TRANSFER_ORIGINS }).notNull(),
    sourceWarehouseId: ref('source_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    destWarehouseId: ref('dest_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: text('status', { enum: TRANSFER_STATUSES }).notNull().default('DRAFT'),
    note: text('note'),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    requestedBy: userRef('requested_by'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    shippedBy: userRef('shipped_by'),
    shipDate: date('ship_date', { mode: 'string' }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    receivedBy: userRef('received_by'),
    receiveDate: date('receive_date', { mode: 'string' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: userRef('cancelled_by'),
    cancelReason: text('cancel_reason'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('transfers_number_key').on(t.number),
    index('transfers_source_idx').on(t.sourceWarehouseId, t.status, t.id),
    index('transfers_dest_idx').on(t.destWarehouseId, t.status, t.id),
    check('transfers_origin', inList(t.origin, TRANSFER_ORIGINS)),
    check('transfers_status', inList(t.status, TRANSFER_STATUSES)),
    check('transfers_warehouses', sql`${t.sourceWarehouseId} <> ${t.destWarehouseId}`),
    // Drafts have no number, except a request taken back for editing (ADR-0046); a sent request
    // and everything after it has one (SPEC §6.13).
    check(
      'transfers_number',
      sql`(${t.status} <> 'DRAFT' OR ${t.number} IS NULL OR ${t.origin} = 'REQUEST')
        AND (${t.status} NOT IN ('REQUESTED', 'SHIPPED', 'RECEIVED') OR ${t.number} IS NOT NULL)`,
    ),
    check(
      'transfers_requested',
      sql`(${t.status} <> 'REQUESTED' OR ${t.requestedAt} IS NOT NULL)
        AND (${t.origin} = 'REQUEST' OR ${t.requestedAt} IS NULL)`,
    ),
    check(
      'transfers_shipped',
      sql`(${t.status} IN ('SHIPPED', 'RECEIVED'))
        = (${t.shippedAt} IS NOT NULL AND ${t.shipDate} IS NOT NULL)`,
    ),
    check(
      'transfers_received',
      sql`(${t.status} = 'RECEIVED') = (${t.receivedAt} IS NOT NULL AND ${t.receiveDate} IS NOT NULL)`,
    ),
    check('transfers_cancelled', sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} IS NOT NULL)`),
    check('transfers_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 500`),
    check(
      'transfers_cancel_reason',
      sql`${t.cancelReason} IS NULL OR length(${t.cancelReason}) BETWEEN 1 AND 300`,
    ),
  ],
);

/**
 * One line per product (and lot) of a transfer: the unit and quantity asked for (planned, for a
 * push), and what was shipped and received, in base units (ADR-0035 #4).
 */
export const transferLines = pgTable(
  'transfer_lines',
  {
    id: id(),
    transferId: ref('transfer_id')
      .notNull()
      .references(() => transfers.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    requestUnitId: ref('request_unit_id')
      .notNull()
      .references(() => productUnits.id),
    requestFactor: factor('request_factor').notNull(),
    /** In the request unit. */
    requestedQty: qty('requested_qty').notNull(),
    /** Set when shipped; 0 for a line the sender did not ship. */
    shippedQtyBase: qty('shipped_qty_base'),
    fromBinId: ref('from_bin_id').references(() => bins.id),
    /** Set when received. */
    receivedQtyBase: qty('received_qty_base'),
    toBinId: ref('to_bin_id').references(() => bins.id),
    lotId: ref('lot_id').references(() => lots.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('transfer_lines_product_key').on(t.transferId, t.productId, t.lotId).nullsNotDistinct(),
    index('transfer_lines_transfer_idx').on(t.transferId, t.id),
    check(
      'transfer_lines_qty',
      sql`${t.requestFactor} > 0 AND ${t.requestedQty} > 0
        AND (${t.shippedQtyBase} IS NULL OR ${t.shippedQtyBase} >= 0)
        AND (${t.receivedQtyBase} IS NULL OR (${t.shippedQtyBase} IS NOT NULL AND ${t.receivedQtyBase} >= 0))`,
    ),
  ],
);

/**
 * Stocktakes (ST-, SPEC §6.8): starting one locks its bins (COUNTING) and freezes the expected
 * quantities; approval posts COUNT_CORRECTION = counted − frozen and frees the bins.
 */
export const stocktakes = pgTable(
  'stocktakes',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: text('status', { enum: STOCKTAKE_STATUSES }).notNull().default('DRAFT'),
    note: text('note'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    startedBy: userRef('started_by'),
    ...postingColumns(),
  },
  (t) => [
    unique('stocktakes_number_key').on(t.number),
    index('stocktakes_warehouse_idx').on(t.warehouseId, t.status, t.id),
    check('stocktakes_status', inList(t.status, STOCKTAKE_STATUSES)),
    check(
      'stocktakes_approved',
      sql`(${t.status} = 'APPROVED') = (${t.number} IS NOT NULL AND ${t.postedAt} IS NOT NULL
        AND ${t.effectiveDate} IS NOT NULL)`,
    ),
    check(
      'stocktakes_started',
      sql`(${t.status} <> 'DRAFT' OR ${t.startedAt} IS NULL)
        AND (${t.status} NOT IN ('COUNTING', 'REVIEW', 'APPROVED') OR ${t.startedAt} IS NOT NULL)`,
    ),
    check('stocktakes_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 500`),
  ],
);

/**
 * The bins a stocktake counts. A counter finishes each bin (ADR-0038): its uncounted lines become 0
 * and the bin is marked, so an empty shelf is told apart from one nobody reached.
 */
export const stocktakeBins = pgTable(
  'stocktake_bins',
  {
    stocktakeId: ref('stocktake_id')
      .notNull()
      .references(() => stocktakes.id),
    binId: ref('bin_id')
      .notNull()
      .references(() => bins.id),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    finishedBy: userRef('finished_by'),
  },
  (t) => [
    unique('stocktake_bins_key').on(t.stocktakeId, t.binId),
    check('stocktake_bins_finished', sql`(${t.finishedAt} IS NULL) = (${t.finishedBy} IS NULL)`),
  ],
);

export const stocktakeLines = pgTable(
  'stocktake_lines',
  {
    id: id(),
    stocktakeId: ref('stocktake_id')
      .notNull()
      .references(() => stocktakes.id),
    binId: ref('bin_id')
      .notNull()
      .references(() => bins.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    lotId: ref('lot_id').references(() => lots.id),
    /** On hand when counting started; 0 for goods found during the count. */
    expectedQty: qty('expected_qty').notNull(),
    countedQty: qty('counted_qty'),
    /**
     * When a person last counted the line. Finishing a bin sets the lines nobody counted to 0 and
     * leaves this NULL: «not found», never shown to counters (ADR-0038).
     */
    countedAt: timestamp('counted_at', { withTimezone: true }),
    /** Cost per base unit of a surplus; NULL = the average at approval. */
    unitCost: cost('unit_cost'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('stocktake_lines_key')
      .on(t.stocktakeId, t.binId, t.productId, t.lotId)
      .nullsNotDistinct(),
    check(
      'stocktake_lines_qty',
      sql`${t.expectedQty} >= 0 AND (${t.countedQty} IS NULL OR ${t.countedQty} >= 0)
        AND (${t.unitCost} IS NULL OR ${t.unitCost} >= 0)`,
    ),
    check('stocktake_lines_counted', sql`${t.countedAt} IS NULL OR ${t.countedQty} IS NOT NULL`),
  ],
);

/** One row per reconciliation run (§5.3 D10), OK or DRIFT, with the first differences. */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: id(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status', { enum: RECONCILIATION_STATUSES }).notNull(),
    diffCount: integer('diff_count').notNull(),
    diffs: jsonValue('diffs').notNull(),
    triggeredBy: text('triggered_by').notNull(),
  },
  (t) => [
    index('reconciliation_runs_started_idx').on(t.startedAt),
    check('reconciliation_runs_status', inList(t.status, RECONCILIATION_STATUSES)),
    check(
      'reconciliation_runs_count',
      sql`${t.diffCount} >= 0 AND (${t.status} = 'OK') = (${t.diffCount} = 0)`,
    ),
  ],
);
