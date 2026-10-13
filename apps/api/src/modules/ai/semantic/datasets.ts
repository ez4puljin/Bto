/**
 * The views of schema `ai` (migration 0017_ai) the assistant may query, in the order of their columns
 * (ADR-0045 #2). The prompt describes them to the model, the SQL guard accepts only these relations,
 * and the view tests check that the database matches, column by column. Descriptions are English for
 * the model; Mongolian names for screens live in mn.json `ai.datasets`.
 */
export type AiColumnType =
  'bigint' | 'integer' | 'numeric' | 'text' | 'boolean' | 'date' | 'timestamptz';

export interface AiColumn {
  name: string;
  type: AiColumnType;
  description: string;
}

export interface AiDataset {
  name: string;
  description: string;
  columns: readonly AiColumn[];
}

const col = (name: string, type: AiColumnType, description = ''): AiColumn => ({
  name,
  type,
  description,
});

const PRODUCT = [
  col('product_id', 'bigint'),
  col('sku', 'text', 'product code'),
  col('product_name', 'text'),
];
const BASE_UNIT = col('base_unit', 'text', 'name of the base unit every quantity is counted in');
const WAREHOUSE = [col('warehouse_id', 'bigint'), col('warehouse_name', 'text')];

export const AI_DATASETS: readonly AiDataset[] = [
  {
    name: 'categories',
    description: 'Product categories, a tree. One row per category.',
    columns: [
      col('id', 'bigint'),
      col('parent_id', 'bigint', 'NULL for a top-level category'),
      col('name', 'text'),
      col('path', 'text', "full path from the top, names joined by ' / '"),
      col('level', 'integer', '1 = top level, 2 = its children, …'),
      col('top_category_id', 'bigint', 'the top-level category above it (itself at level 1)'),
      col('top_category_name', 'text'),
      col('sku_from', 'numeric', "first product code of the category's code range; NULL = none"),
      col('sku_to', 'numeric', 'last product code of the range'),
    ],
  },
  {
    name: 'products',
    description: 'Products (SKUs). One row per product.',
    columns: [
      col('id', 'bigint'),
      col('sku', 'text', 'product code (digits)'),
      col('name', 'text'),
      col('category_id', 'bigint'),
      col('category_path', 'text'),
      col('top_category_name', 'text'),
      col('status', 'text', "'ACTIVE' or 'INACTIVE' (no longer sold); prefer ACTIVE unless asked"),
      col('ready_for_sale', 'boolean', 'false while a new product waits for its prices'),
      col('sale_ready_at', 'timestamptz', 'when its prices were completed'),
      BASE_UNIT,
      col('vat_type', 'text', 'VAT_ABLE, VAT_FREE, VAT_ZERO or NO_VAT'),
      col('city_tax', 'boolean', 'city tax applies; NULL = not decided'),
      col('classification_code', 'text', 'e-Barimt classification code; NULL = missing'),
      col('tax_product_code', 'text', 'e-Barimt tax product code; NULL = missing'),
      col('weight_kg', 'numeric'),
      col('created_at', 'timestamptz', 'registered at'),
      col('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'product_units',
    description: 'Current units of each product (piece, box, …). One row per unit.',
    columns: [
      col('id', 'bigint', 'product unit id'),
      ...PRODUCT,
      col('unit_name', 'text'),
      col('uom_code', 'text', 'PCS, BOX, BLOCK, KG; NULL for another unit'),
      col('factor_to_base', 'numeric', 'base units in one unit (a box of 24 pieces = 24)'),
      col('is_base', 'boolean'),
      col('is_default_sales', 'boolean'),
      col('is_default_purchase', 'boolean'),
      col('primary_barcode', 'text'),
      col('barcodes', 'text', 'every barcode of the unit, comma-separated'),
    ],
  },
  {
    name: 'warehouses',
    description:
      'Warehouses. kind: WHOLESALE (wholesale centre), STORE (the supermarket), VEHICLE (a delivery vehicle), TRANSIT (goods travelling between warehouses).',
    columns: [
      col('id', 'bigint'),
      col('code', 'text'),
      col('name', 'text'),
      col('kind', 'text'),
      col('status', 'text', "'ACTIVE' or 'INACTIVE'"),
      col('branch_id', 'bigint'),
      col('branch_name', 'text'),
    ],
  },
  {
    name: 'stock',
    description:
      'Current stock per warehouse and product (lots summed); a product never held in a warehouse has no row there. Quantities in base units; costs per base unit in MNT excluding VAT.',
    columns: [
      ...WAREHOUSE,
      col('warehouse_kind', 'text'),
      ...PRODUCT,
      BASE_UNIT,
      col('on_hand', 'numeric', 'quantity in the warehouse'),
      col('sellable_on_hand', 'numeric', 'part of on_hand on sellable shelves'),
      col('reserved', 'numeric', 'reserved for confirmed orders'),
      col('available', 'numeric', 'sellable_on_hand − reserved, never below 0'),
      col('avg_cost', 'numeric', 'weighted average unit cost'),
      col('stock_value', 'numeric', 'on_hand at average cost (MNT)'),
      col('min_qty', 'numeric', 'minimum level in this warehouse; NULL = none'),
      col('max_qty', 'numeric', 'maximum level; NULL = none'),
      col('is_home_warehouse', 'boolean', "this is the product's home (main) warehouse"),
      col('fixed_bin_code', 'text', "the product's fixed shelf in this warehouse"),
    ],
  },
  {
    name: 'low_stock',
    description:
      'Products to restock now: at or below their minimum (LOW), or out of stock (OUT) in a warehouse that held them. Active products only.',
    columns: [
      ...WAREHOUSE,
      ...PRODUCT,
      BASE_UNIT,
      col('status', 'text', "'OUT' or 'LOW'"),
      col('on_hand', 'numeric'),
      col('min_qty', 'numeric'),
      col('max_qty', 'numeric'),
      col('suggested_qty', 'numeric', 'quantity to add to reach the maximum (else the minimum)'),
      col('home_warehouse_id', 'bigint'),
      col('home_warehouse_name', 'text'),
    ],
  },
  {
    name: 'stock_movements',
    description:
      'The stock ledger: every movement, one row per leg; quantity signed (+ in, − out). Bin moves and transfers have an out leg and an in leg, so they cancel out in company totals: count received goods with RECEIPT.',
    columns: [
      col('id', 'bigint'),
      col('posted_at', 'timestamptz', 'when it was recorded'),
      col('movement_date', 'date', 'business date (Ulaanbaatar)'),
      ...WAREHOUSE,
      col('bin_code', 'text', 'shelf'),
      ...PRODUCT,
      BASE_UNIT,
      col('qty_base', 'numeric', 'signed quantity in base units'),
      col('entered_qty', 'numeric', 'quantity as entered, in entered_unit (unsigned)'),
      col('entered_unit', 'text'),
      col(
        'unit_cost',
        'numeric',
        "cost per base unit when posted (MNT excluding VAT); a receipt posts at the average before the accountant's costing, so purchase values come from receipt_lines.amount",
      ),
      col('value', 'numeric', 'qty_base × unit_cost (signed MNT)'),
      col(
        'movement_type',
        'text',
        'RECEIPT (from a supplier), BIN_MOVE_OUT / BIN_MOVE_IN (between shelves), TRANSFER_OUT / TRANSFER_IN (between warehouses), ADJUSTMENT (damage, expiry, shortage, surplus, opening stock), COUNT_CORRECTION (stocktake difference)',
      ),
      col('doc_type', 'text', 'GR receipt, BM bin move, ADJ adjustment, ST stocktake, TR transfer'),
      col('doc_id', 'bigint'),
      col('doc_number', 'text', 'e.g. GR-2026-000012'),
      col(
        'adjustment_reason',
        'text',
        'ADJ only: DAMAGED, EXPIRED, SHORTAGE, SURPLUS, OPENING, OPENING_REVERSAL',
      ),
      col('supplier_id', 'bigint', 'GR only'),
      col('supplier_name', 'text', 'GR only'),
      col('posted_by_name', 'text'),
    ],
  },
  {
    name: 'stock_documents',
    description:
      'Stock document headers: GR goods receipt, BM bin move, ADJ adjustment, ST stocktake, TR transfer between warehouses.',
    columns: [
      col('doc_type', 'text'),
      col('id', 'bigint'),
      col('number', 'text', 'NULL for drafts'),
      col(
        'status',
        'text',
        'GR DRAFT/POSTED/CANCELLED; BM DRAFT/POSTED; ADJ DRAFT/SUBMITTED/POSTED/CANCELLED; ST DRAFT/COUNTING/REVIEW/APPROVED/CANCELLED; TR DRAFT/REQUESTED/SHIPPED/RECEIVED/CANCELLED',
      ),
      col('warehouse_id', 'bigint', 'TR: the sending warehouse'),
      col('warehouse_name', 'text'),
      col('dest_warehouse_id', 'bigint', 'TR: the receiving warehouse'),
      col('dest_warehouse_name', 'text'),
      col('supplier_id', 'bigint', 'GR only'),
      col('supplier_name', 'text', 'GR only'),
      col('supplier_doc_no', 'text', "GR: the supplier's delivery note number"),
      col('adjustment_reason', 'text', 'ADJ only'),
      col('costing_status', 'text', "GR: PENDING (waiting for the accountant's prices) or COSTED"),
      col('effective_date', 'date', 'business date (TR: the receive date, else the ship date)'),
      col('ship_date', 'date', 'TR only'),
      col('receive_date', 'date', 'TR only'),
      col('posted_at', 'timestamptz'),
      col('created_at', 'timestamptz'),
      col('created_by_name', 'text'),
      col('posted_by_name', 'text'),
      col('note', 'text'),
    ],
  },
  {
    name: 'receipt_lines',
    description:
      "Lines of goods receipts from suppliers, with the supplier's cost once the accountant entered it.",
    columns: [
      col('receipt_id', 'bigint'),
      col('receipt_number', 'text'),
      col('receipt_status', 'text', 'DRAFT, POSTED or CANCELLED; count POSTED ones'),
      col('receipt_date', 'date', 'business date of the posting'),
      ...WAREHOUSE,
      col('supplier_id', 'bigint'),
      col('supplier_name', 'text'),
      col('supplier_doc_no', 'text'),
      col('costing_status', 'text', 'PENDING or COSTED'),
      col('line_id', 'bigint'),
      ...PRODUCT,
      col('entered_qty', 'numeric'),
      col('entered_unit', 'text'),
      col('qty_base', 'numeric'),
      BASE_UNIT,
      col('amount', 'numeric', "the line's cost (MNT excluding VAT); NULL until costed"),
      col('free_goods', 'boolean', 'bonus goods received free'),
      col('unit_cost', 'numeric', 'amount ÷ qty_base'),
    ],
  },
  {
    name: 'customers',
    description:
      'Customers (shops and individuals). Sales and receivables are not in the system yet.',
    columns: [
      col('id', 'bigint'),
      col('code', 'text'),
      col('kind', 'text', "'COMPANY' or 'INDIVIDUAL'"),
      col('name', 'text'),
      col('reg_no', 'text', 'registration number'),
      col('tin', 'text', 'taxpayer number (TIN)'),
      col('consumer_no', 'text', 'e-Barimt consumer number'),
      col('phone', 'text', 'E.164, e.g. +97688001122'),
      col('vat_payer', 'boolean'),
      col('city_payer', 'boolean'),
      col('credit_limit', 'numeric', 'MNT; NULL = not decided yet'),
      col('payment_term_days', 'integer', 'NULL = the company-wide term'),
      col('credit_hold', 'boolean', 'credit sales stopped'),
      col('credit_hold_reason', 'text'),
      col('status', 'text', "'ACTIVE' or 'INACTIVE'"),
      col('note', 'text'),
      col('default_address', 'text'),
      col('created_at', 'timestamptz'),
      col('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'customer_addresses',
    description: 'Delivery addresses of customers.',
    columns: [
      col('id', 'bigint'),
      col('customer_id', 'bigint'),
      col('customer_name', 'text'),
      col('label', 'text'),
      col('address', 'text'),
      col('lat', 'numeric', 'GPS latitude'),
      col('lng', 'numeric', 'GPS longitude'),
      col('gps_source', 'text'),
      col('is_default', 'boolean'),
      col('archived', 'boolean'),
      col('note', 'text'),
    ],
  },
  {
    name: 'suppliers',
    description: 'Suppliers.',
    columns: [
      col('id', 'bigint'),
      col('code', 'text'),
      col('name', 'text'),
      col('reg_no', 'text'),
      col('tin', 'text'),
      col('phone', 'text', 'E.164, e.g. +97688001122'),
      col('email', 'text'),
      col('address', 'text'),
      col('bank_name', 'text'),
      col('bank_account', 'text'),
      col('payment_term_days', 'integer'),
      col('status', 'text', "'ACTIVE' or 'INACTIVE'"),
      col('note', 'text'),
      col('created_at', 'timestamptz'),
      col('updated_at', 'timestamptz'),
    ],
  },
  {
    name: 'product_suppliers',
    description: 'Which suppliers deliver which products.',
    columns: [
      ...PRODUCT,
      col('supplier_id', 'bigint'),
      col('supplier_name', 'text'),
      col('is_main', 'boolean', "the product's main supplier"),
    ],
  },
  {
    name: 'prices_today',
    description:
      "Today's selling price of every current unit in both lists: WHOLESALE (every customer) and RETAIL (the supermarket). Whole MNT including VAT. A unit without a price today has no row.",
    columns: [
      col('list', 'text', "'WHOLESALE' or 'RETAIL'"),
      ...PRODUCT,
      col('product_unit_id', 'bigint'),
      col('unit_name', 'text'),
      col('factor_to_base', 'numeric'),
      col('is_base', 'boolean'),
      col('price', 'numeric', 'price of one unit'),
      col('price_source', 'text', "'UNIT' (its own price) or 'DERIVED' (base price × factor)"),
      col('valid_from', 'date', 'start of its own price'),
      col('valid_to', 'date', 'end of its own price (exclusive); NULL = open'),
    ],
  },
  {
    name: 'price_history',
    description:
      'Every price period of every unit: valid from valid_from up to (not including) valid_to; NULL valid_to = open.',
    columns: [
      col('id', 'bigint'),
      col('list', 'text', "'WHOLESALE' or 'RETAIL'"),
      ...PRODUCT,
      col('product_unit_id', 'bigint'),
      col('unit_name', 'text'),
      col('price', 'numeric'),
      col('valid_from', 'date'),
      col('valid_to', 'date'),
      col('created_at', 'timestamptz'),
      col('created_by_name', 'text'),
    ],
  },
  {
    name: 'discount_programs',
    description:
      'Discount programs; every program in force applies, in the order product, category, order.',
    columns: [
      col('id', 'bigint'),
      col('name', 'text'),
      col('list', 'text', "'WHOLESALE' or 'RETAIL'"),
      col('scope', 'text', "'PRODUCT', 'CATEGORY' or 'ORDER'"),
      col('measure', 'text', "'QTY' (a quantity) or 'AMOUNT' (MNT) — what the steps count"),
      col('effect', 'text', "'PRICE' (new unit price), 'PERCENT' (% off) or 'AMOUNT' (MNT off)"),
      col('product_id', 'bigint'),
      col('product_name', 'text'),
      col('unit_name', 'text', 'PRODUCT: the unit it applies to; NULL = every unit'),
      col('threshold_unit_name', 'text', 'PRODUCT: the unit its quantities were typed in'),
      col('category_id', 'bigint'),
      col('category_path', 'text'),
      col('count_unit_name', 'text', 'CATEGORY QTY: the unit counted'),
      col('valid_from', 'date'),
      col('valid_to', 'date', 'end (exclusive); NULL = open'),
      col('status', 'text', "'SCHEDULED', 'ACTIVE' or 'ENDED' as of today"),
      col('steps', 'text', "'threshold => value; …'"),
      col('created_at', 'timestamptz'),
      col('created_by_name', 'text'),
    ],
  },
];

/** The relation names the SQL guard accepts. */
export const AI_DATASET_NAMES: ReadonlySet<string> = new Set(AI_DATASETS.map((set) => set.name));
