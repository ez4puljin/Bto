# Module `inventory` — contract

Status: **core built** in delivery 1 (week 3), session of 2026-10-11; two-step transfers follow in week 4 and the module is accepted locally together with the rest of delivery 1. Code: `apps/api/src/modules/inventory/`, shared rules in `packages/shared/src/inventory`, screens in `apps/web/src/features/inventory/`. Decisions: ADR-0007 (ledger and caches), ADR-0016, ADR-0019 (lots, reservations), ADR-0027 (access control), ADR-0033 (receipts and costing), ADR-0034 (posting protocol), architecture §4 (inventory row), §5.1 and §5.3.

inventory depends on `identity` (audit, numbering, scopes, warehouses, `WAREHOUSE_CREATED_HOOK`), `catalog` (products, unit conversion, barcodes) and `partners` (active suppliers). imports, sales, delivery, procurement, POS and reporting import its `index.ts`.

## 1. Owner's answers behind the design (interview of 2026-10-11)

- **Warehouses and shelves.** Four or more wholesale warehouses besides the supermarket; numbered shelves, 300 and more per warehouse, each with a barcode label whose text is the shelf code (`A-01-03`: row letter, rack, level). Labels exist, so the system does not print them.
- **Home warehouse.** The Excel column "харьяалагдах агуулах" means a product is stored only there; receiving it into another wholesale warehouse is refused. A product usually sits on one fixed shelf.
- **Receiving.** Warehouse staff count the goods and register them; they do not know prices and must not see costs. The goods go straight onto the shelf and are sold at once. The accountant enters the supplier's prices ex-VAT separately, the same day; mistakes are corrected until the end of the next month. Suppliers add free bonus goods.
- **Adjustments.** Reasons: damaged, expired, shortage (lost), surplus (found). Warehouse staff create them, an admin approves.
- **Stocktakes.** Done when there is time, on no fixed day.
- **Devices.** Computer + USB scanner for now; no phone camera, so no LAN HTTPS during development.

## 2. Owned tables

Migration `0005_inventory` (generated, then CHECKs, triggers and REVOKEs by hand) and `0006_inventory_ledger` (`--custom`, hand-written; the Drizzle objects live in `ledger.schema.ts`, which the aggregator does not export, ADR-0034 #6).

| Table | Purpose | Key rules (DB-enforced unless noted) |
|---|---|---|
| `bins` | shelves and system bins | `code` 1–32 `^[A-Z0-9][A-Z0-9._/-]*$`, unique per warehouse (`bins_warehouse_code_key`); `type` one of the ten §5.1 types, `sellable` generated (STORAGE, PICKING, SALESFLOOR); `is_system` = not STORAGE/PICKING, one system bin per warehouse and type (`bins_one_system_type`); `status` ACTIVE/COUNTING with `locked_by_stocktake_id` exactly while COUNTING; `archived_at` never while COUNTING; `(warehouse_id, id)` unique as the target of composite FKs; trigger `bins_fixed_columns` keeps warehouse, code, type and the system flag (23001) |
| `product_locations` | home warehouse, fixed shelf, levels | `(warehouse_id, product_id)` unique; one `is_home` per product (`product_locations_one_home`); `default_bin_id` composite FK to a bin of the same warehouse; `min_qty ≤ max_qty` |
| `lots` | lots (empty until ADR-0019 is activated) | `(product_id, lot_no)` unique |
| `warehouse_stock` | balance per warehouse, product, lot | `UNIQUE NULLS NOT DISTINCT` key; `on_hand ≥ 0`, `reserved ≥ 0`, `0 ≤ sellable_on_hand ≤ on_hand`; `avg_cost NUMERIC(14,4)`; fillfactor 80; written only by `StockPostingService` |
| `bin_stock` | balance per bin, product, lot | `UNIQUE NULLS NOT DISTINCT` key; composite FK to its bin; `on_hand ≥ 0`; written only by `StockPostingService` |
| `stock_reservations` | reservations (table only; ADR-0019, delivery 2) | one active row per document line (`NULLS NOT DISTINCT` partial unique) |
| `goods_receipts` + `goods_receipt_lines` | `GR-` | DRAFT/POSTED/CANCELLED; supplier, delivery note number and date; `costing_status` PENDING/COSTED, `costing_version`, `costed_at`; POSTED ⇔ number, `posted_at`, `effective_date`; lines: unit, entered qty, `factor_snapshot`, `qty_base`, bin, lot |
| `bin_moves` + `bin_move_lines` | `BM-` | from ≠ to bin; posted on creation |
| `adjustments` + `adjustment_lines` | `ADJ-` | `reason` DAMAGED/EXPIRED/SHORTAGE/SURPLUS/OPENING; DRAFT/SUBMITTED/POSTED/CANCELLED with `submitted_at`/`submitted_by`; lines carry an optional `unit_cost` (inbound reasons) |
| `stocktakes` + `stocktake_bins` + `stocktake_lines` | `ST-` | DRAFT/COUNTING/REVIEW/APPROVED/CANCELLED; `started_at` exactly from COUNTING on; lines: frozen `expected_qty`, `counted_qty`, surplus `unit_cost`; `(stocktake, bin, product, lot)` unique NULLS NOT DISTINCT |
| `reconciliation_runs` | every check of the caches | OK/DRIFT, `diff_count` (0 ⇔ OK), the first 100 differences |
| `stock_ledger` (0006) | the append-only movement ledger | movement type, sign and leg checked per type; `abs(qty_base) = entered_qty × factor_snapshot`; `unit_cost ≥ 0`; composite FK to the bin; idempotency key `stock_ledger_idem` (doc type, line, movement, leg); indexes (product, id), (doc type, doc id), BRIN `posted_at`; `REVOKE UPDATE, DELETE, TRUNCATE` + triggers `stock_ledger_no_update_delete` / `_no_truncate` (23001 even for the owner) |
| `stock_valuation_adjustments` (0006) | costing history of receipt lines (ADR-0033 #5) | one row per line and version; `value_delta = amount − value_before`, `absorbed + variance = value_delta`, free goods ⇒ amount 0; the ledger's guards |
| `stock_snapshot_daily`, `stock_snapshot_bin_monthly` (0006) | snapshots (D9) | partitioned by month, 24 partitions created ahead (2026-10 … 2028-09); `REVOKE DELETE, TRUNCATE` |

Document headers (`goods_receipts`, `bin_moves`, `adjustments`, `stocktakes`) and the caches are `REVOKE DELETE, TRUNCATE … FROM app`; draft lines are deleted by their service only.

## 3. Public API (`modules/inventory/index.ts`)

| Export | Use |
|---|---|
| `InventoryModule` | the services below (`InventoryHttpModule` adds controllers and the boot backfill; api only). It binds identity's `WAREHOUSE_CREATED_HOOK` to `SystemBinsService`, so a new warehouse gets its system bins in its creating transaction |
| `StockPostingService.post(tx, actor, { docs, movements })` → `PostingResult` | the only writer of the ledger and both caches (G2). Any number of documents per call, zero movements allowed; returns `postedAt`, `effectiveDate`, the numbers by document id and the unit cost of every leg. Inventory checks the status of its own documents (`GR`, `BM`, `ADJ`, `ST`); a module with its own stock document runs its guarded UPDATE first (ADR-0034 #5) |
| `StockPostingService.revalue(tx, actor, …)`, `costingOf`, `receiptCosts` | receipt costing (ADR-0033); used by `ReceiptsService.cost` |
| `StockPostingService.reconcile(triggeredBy)`, `rebuildBalances()` | the nightly check (job: cut line #5) and the CLI commands of §7 |
| `SystemBinsService.ensure(tx, warehouses)`, `backfill()` | system bins per warehouse kind: RECEIVING, STAGING, SHIP, DAMAGED, RETURNS (+ SALESFLOOR for STORE, + CARGO for VEHICLE; TRANSIT only TRANSIT) |
| `BinsService.get / getMany / lookup(warehouseId, code) / systemBin(warehouseId, type) / list` | a scanned label (normalised: NFKC, no spaces, upper case, dash variants and Cyrillic look-alikes → Latin) |
| `ProductLocationsService.ofProduct`, `ofWarehouse`, `homeOf`, `defaultBinOf(warehouseId, productIds)`, `assertMayReceive(tx, warehouseId, productIds)`, `set`, `setHome` | the home rule (`PRODUCT_NOT_IN_WAREHOUSE`) for receipts, positive adjustments and the opening-stock import |
| `ReceiptsService.createInTx / post / cost / get / list` | goods receipts; `createInTx` for the importer |
| `BinMovesService.createInTx(tx, actor, input)` | put-away and shelf moves (also for the transfer receive of week 4) |
| `AdjustmentsService.createInTx(tx, actor, input)`, `approveInTx(tx, actor, id, costs)` | adjustments; the opening-stock import creates OPENING adjustments with costs and approves them in its own transaction |
| `StocktakesService.create / start / count / review / approve / cancel / get` | stocktakes (service only; REST and screens are cut line #3) |
| `StockQueryService.overview / ofProduct / ofBin / latestReconciliation` | balances for screens and other modules (sales availability comes with `ReservationService`, delivery 2) |
| types `Bin`, `ProductLocation`, `ReceiptDetail`, `ReceiptSummary`, `ReceiptCosting`, `BinMoveDetail`, `AdjustmentDetail`, `StocktakeDetail`, `ProductStock`, `WarehouseBalance`, `Movement`, `PostingDoc`, `PostingResult`, `ReconciliationRun`, … | |

Other modules never write inventory tables and never read them directly.

## 4. REST surface (`/api/v1`)

Permissions (ADR-0027 system mappings, assignable to custom roles): `inventory.setup.manage` (ADMIN), `inventory.locations.manage`, `inventory.receipts.manage`, `inventory.moves.manage`, `inventory.adjustments.manage`, `inventory.stocktakes.manage` (ADMIN, WAREHOUSE), `inventory.adjustments.approve`, `inventory.stocktakes.approve` (ADMIN), `inventory.costs.manage` (ADMIN, ACCOUNTANT). Reads are open to every signed-in user and never carry costs without `inventory.costs.manage`. Every write checks the warehouse write scope (`ScopeService.assertCanWriteWarehouse`).

| Method and path | Access | Notes |
|---|---|---|
| `GET /bins`, `GET /bins/:id`, `GET /bins/lookup?warehouseId&code` | authenticated | list by code prefix, type, archived; keyset |
| `POST /bins`, `POST /bins/bulk` (200), `PATCH /bins/:id`, `POST /bins/:id/archive` (200), `POST /bins/:id/restore` (200), `DELETE /bins/:id` (204) | `inventory.setup.manage` | shelves (STORAGE/PICKING) of WHOLESALE and STORE warehouses; bulk = rows × racks × levels (≤ 500, `dryRun` previews; existing codes skipped); archive refuses stock (`BIN_NOT_EMPTY`) and counted bins; a used bin cannot be deleted (`IN_USE`) |
| `GET /product-locations?productId|warehouseId` | authenticated | |
| `PUT /product-locations` | `inventory.locations.manage` | fixed shelf (a STORAGE/PICKING bin of that warehouse), min/max in base units |
| `PUT /product-locations/home`, `DELETE /product-locations/:id` (204) | `inventory.setup.manage` / `inventory.locations.manage` | home: a WHOLESALE warehouse or null |
| `GET /receipts`, `GET /receipts/:id` | authenticated | filters: warehouse, status, `costingPending`, supplier, `q` (number or delivery note) |
| `POST /receipts` (`Idempotency-Key`), `PATCH /receipts/:id`, `POST /receipts/:id/lines`, `PATCH/DELETE /receipt-lines/:id`, `POST /receipts/:id/post` (200, `Idempotency-Key`), `POST /receipts/:id/cancel` (200) | `inventory.receipts.manage` | WHOLESALE only; active supplier; a line without a bin goes to the fixed shelf, else RECEIVING |
| `GET /receipts/:id/costing`, `PUT /receipts/:id/costs` (`Idempotency-Key`) | `inventory.costs.manage` | all lines at once with `costingVersion` (409 `CONFLICT` when stale); `COSTING_CLOSED` after the end of the next month |
| `GET /bin-moves`, `GET /bin-moves/:id` | authenticated | posted moves |
| `POST /bin-moves` (`Idempotency-Key`) | `inventory.moves.manage` | WHOLESALE/STORE; created and posted in one request; from RECEIVING = PUTAWAY, else BIN_MOVE |
| `GET /adjustments`, `GET /adjustments/:id` | authenticated | filters: warehouse, status |
| `POST /adjustments` (`Idempotency-Key`), `PATCH /adjustments/:id`, `POST /adjustments/:id/lines`, `PATCH/DELETE /adjustment-lines/:id`, `POST /adjustments/:id/submit` (200), `POST /adjustments/:id/cancel` (200) | `inventory.adjustments.manage` | OPENING only for approvers; a cost on a line needs `inventory.costs.manage` |
| `POST /adjustments/:id/return` (200), `POST /adjustments/:id/post` (200, `Idempotency-Key`, body `{ costs: [{ lineId, unitCost }] }`) | `inventory.adjustments.approve` (+ `inventory.costs.manage` for costs) | |
| `GET /stock?q&warehouseId&inStock`, `GET /stock/products/:id`, `GET /stock/bins/:id` | authenticated | `avgCost` and `value` only for `inventory.costs.manage` |
| `GET /stock/reconciliation/latest` | `inventory.setup.manage` | the admin banner |

## 5. Rules worth knowing

- **Posting protocol (ADR-0034).** Lock order: document headers (`SELECT … FOR UPDATE` and a status check; the final UPDATE sets status, number and dates) → lines → bins `FOR SHARE` in id order (COUNTING → `BIN_LOCKED_FOR_COUNT`, archived → `BIN_ARCHIVED`) → missing cache rows of inbound keys (one sorted `INSERT … ON CONFLICT DO NOTHING`) → `warehouse_stock` `FOR UPDATE` → `bin_stock` `FOR UPDATE` → ledger → cache UPDATEs → numbers last. Keys are matched through `VALUES … IS NOT DISTINCT FROM`, so NULL lots lock correctly. Deltas are summed per key; any bin below zero is `STOCK_INSUFFICIENT` with `binCode`, `available` and `requested`. One `now()` per posting gives `posted_at`, the Ulaanbaatar `effective_date` and the number's year.
- **Costs (ADR-0007, ADR-0033).** Outbound legs carry the average; inbound legs the explicit cost, else the paired outbound leg's, else the average. A receipt posts at the average and the accountant's costing applies the coverage rule (absorbed = Δ × min(Q, on hand) / Q); the rest is a recorded variance. Adjustments and count surpluses take the given cost or the average.
- **Home warehouse.** Receipts and SURPLUS/OPENING adjustments into a WHOLESALE warehouse other than the product's home are refused (`PRODUCT_NOT_IN_WAREHOUSE`, `params.warehouse` = the home's name); write-offs, moves and count corrections never are.
- **Stocktakes.** Starting locks the bins `FOR UPDATE` in id order, refuses bins another count holds, sets them COUNTING and freezes `bin_stock` (read after the locks). Counts are in base units; a repeated count replaces the last; goods found on a bin add a line with expected 0. Review needs every line counted. Approval checks that the frozen quantities still match `bin_stock` (409 `CONFLICT` otherwise), frees the bins and posts COUNT_CORRECTION = counted − frozen in the base unit; a count without differences still gets its `ST-` number. Cancelling frees the bins without postings.
- **Numbers.** `GR-`, `BM-`, `ADJ-`, `ST-` + year + 6 digits, allocated at posting inside its transaction; a refused posting uses no number.
- **Scanning (web).** Scan contexts read Latin letters and `-` `.` `/` by physical key, so labels scan on the Mongolian layout; a scan that lands in a quantity field goes to the scan box and the quantity is restored.
- **Advisory locks.** `72_028_001` system bins, `72_028_002` product home (per product).

## 6. Error codes introduced

`BIN_NOT_EMPTY`, `BIN_ARCHIVED`, `DOC_STATE_INVALID`, `PRODUCT_NOT_IN_WAREHOUSE`, `COSTING_CLOSED` (409). Also used: `STOCK_INSUFFICIENT`, `BIN_LOCKED_FOR_COUNT`, `DOC_ALREADY_POSTED`, `ALREADY_POSTED`, `UNIT_SUPERSEDED`, `WAREHOUSE_KIND_NOT_ALLOWED`, `SUPPLIER_INACTIVE`, `CONFLICT`, `IN_USE` (409), `VALIDATION_FAILED` (422), `FORBIDDEN` (403), `NOT_FOUND` (404).

## 7. Commands

- `pnpm inventory:reconcile` — compares both caches with the ledger in one REPEATABLE READ snapshot, writes the day's warehouse snapshot and a `reconciliation_runs` row; prints the first 20 differences and exits with 2 on drift.
- `pnpm inventory:rebuild-balances` — recomputes `bin_stock` and `warehouse_stock` quantities from the ledger with both tables locked against postings (averages are kept; a missing warehouse row takes the latest known average), then reconciles. Find the cause of a drift before running it.

## 8. Audit

Actions `CREATE`, `UPDATE`, `DELETE`, `ARCHIVE`, `POST`, `CANCEL`, `SUBMIT`, `RETURN`, `COST`, `START`, `REVIEW` on `bins` (a bulk creation is one row), `product_locations`, `goods_receipts`, `bin_moves`, `adjustments`, `stocktakes`. Draft line edits are not audited; the posting audit row carries the lines.

## 9. Screens (`apps/web`)

Menu group «Агуулах»: `/inventory/stock` (everyone; search or the products in stock, warehouse filter, value column for cost holders, red drift banner for admins) and `/inventory/stock/:id` (by warehouse and by bin); `/inventory/receipts` (everyone; warehouse, status, «өртөг хүлээгдэж буй» for cost holders), `/inventory/receipts/new` (`inventory.receipts.manage`), `/inventory/receipts/:id` (the scan editor of a draft: a label scan sets the active shelf, a barcode adds or counts the line, product search, quantity fields guarded against scans, post with confirmation; read-only once posted), `/inventory/receipts/:id/costing` (`inventory.costs.manage`; line amount or unit price, bonus, total, re-costing); `/inventory/moves` (`inventory.moves.manage` in the menu; from-shelf, product, quantity, to-shelf by scanning, several lines, one move); `/inventory/adjustments` and `/:id` (`inventory.adjustments.manage` in the menu; create, scan lines, submit; approvers approve with optional costs for found goods, return or cancel); `/inventory/bins` (`inventory.setup.manage`; single shelf, range with preview, archive, restore, delete). The product page shows «Байршил ба үлдэгдэл»: home warehouse (admins), fixed shelf and levels per warehouse (`inventory.locations.manage`), stock per warehouse.

## 10. Tests

Shared (Vitest): `inventory` (bin codes and ranges, document numbers, reasons, cost arithmetic, coverage rule, costing deadline). Integration (`apps/api/test/integration/`): `inventory-schema`, `bins`, `receipts` (flow, rights, home rule, inactive supplier, units, coverage rule, re-costing window, bonus, cost-free responses), `moves-adjustments`, `stock`, `stocktakes`. Integrity (`apps/api/test/integrity/`): `inventory-guards` (ledger and valuation append-only, privileges), `stock-posting` (numbering, double posting, overdraw race, opposite lock orders, counted and archived bins, archive vs posting, costing vs issue, drift and rebuild), `receipts-races`, `adjustments-races`, `stocktake-races` (start vs move, approve vs cancel). Every inventory test file ends with a reconciliation that must find no difference. ADR-0016 integrity cases covered so far: concurrent postings over the same rows, overdraw rejection, idempotent re-post, bin-move net zero, posting into a COUNTING bin and correction = counted − frozen, ledger guards; still to come with their modules: `reserve()` oversell (delivery 2), short-pick, transfer receive zeroing TRANSIT (week 4). Web: `features/inventory/inventory-pages.test.tsx`, `lib/catalog-helpers.test.ts` (`scanChar`), `lib/scan/wedge-detector.test.ts` (labels).

## 11. Open items

- Two-step transfers (`TR-`, TRANSIT, receive with shortfall adjustment): week 4.
- Opening stock import (OPENING adjustments with cost through `AdjustmentsService.createInTx` + `approveInTx`): `imports`, week 4.
- Below the cut line (SPEC §8.2, in order): movement-history screen, shelf labels page, stocktake REST and screens, low-stock report, nightly reconciliation schedule (pg-boss).
- `ReservationService`, picking and availability: delivery 2.
- Cost-of-goods / variance report from `stock_valuation_adjustments`: delivery 10.
- Lots and FEFO (ADR-0019): later, unscheduled.
- Snapshot partitions beyond 2028-09: the monthly partition job (with the nightly schedule).
