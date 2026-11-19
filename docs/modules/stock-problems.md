# stock-problems — «Асуудалтай бараа» (ADR-0230)

**Status:** api built 2026-11-20 (the web pages and the staff app's screen are later tasks). **Depends on:** identity, catalog, partners, inventory, pos (public `index.ts` only, api side only), and reads three sales tables and two pos tables read-only (§4). **Imported by:** nobody. It never writes the stock ledger: goods leave through a goods issue (ADR-0117) and come in through an adjustment.

## 1. Owned tables (migration `0117_stock_problems`)

| Table | Holds | Notes |
|---|---|---|
| `stock_problem_settings` | a warehouse's defaults | `warehouse_id` PK; `customer_id` FK NULL (the fixed party); `expense_type_id` FK NULL (`issue_expense_types`); `updated_at`, `updated_by`. |
| `stock_problem_resolutions` | what took a product off a warehouse's list | `warehouse_id`, `product_id`; `kind` `LEGIT` / `ZERO_OUT` / `COUNT`; `status` `PENDING` / `DONE` / `CANCELLED` (`closed_at` NULL only while PENDING; PENDING needs a document); `covers_until` (the decision's moment); `qty_base`, `on_hand`, `note` (≤ 300); `issue_id`, `adjustment_id`, `sheet_id` FKs NULL; `pos_resolved_at` (the till shortfalls were marked checked); `created_by`. |
| `stock_problem_sheets` | a morning sheet | unique `(warehouse_id, sheet_date)`; `status` `OPEN` / `APPROVED` / `CLOSED`; `built_at`, `built_by` (NULL = the job); `approved_at/by`; `issue_id`, `adjustment_id` of the approval. |
| `stock_problem_sheet_lines` | a product on a sheet | unique `(sheet_id, product_id)`; `system_qty`, `red_qty`, `cut_qty` as built; `counted_qty`, `on_hand_at_count`, `difference` (= counted − on-hand, CHECK), `counted_at/by`; `outcome` `EQUAL` / `SHORTAGE` / `SURPLUS` and `resolution_id`, set by the approval. |

`REVOKE DELETE, TRUNCATE FROM app` on all four. The problem events are never stored here.

## 2. Shared rules (`@tugeel/shared`, `packages/shared/src/stock-problems/index.ts`)

`STOCK_PROBLEM_EVENT_KINDS` (`POS_SHORTFALL`, `BACKORDER`, `SHORT_PICK`), `STOCK_PROBLEM_GROUPS` (`RED` «Улайсан», `CUT` «Дарагдсан») and `stockProblemGroup(kind)`, `STOCK_PROBLEM_RESOLUTION_KINDS`, `STOCK_PROBLEM_RESOLUTION_STATUSES`, `STOCK_PROBLEM_SHEET_STATUSES`, `STOCK_PROBLEM_OUTCOMES`, `STOCK_PROBLEM_WINDOW_DAYS = 30`, `STOCK_PROBLEM_NOTE_MAX = 300`, `STOCK_PROBLEM_QTY_PATTERN`, `STOCK_PROBLEM_SHEET_HOUR = 7`, `stockProblemDifference(counted, onHand)`, `stockProblemOutcome(difference)`. Exported from the package root (no subpath). Texts: mn.json `stockProblems.*`, `roles.system.PRODUCT_SPECIALIST`, `roles.groups.problems`, `permissions.problems.*`.

## 3. API (`/api/v1`)

Every route answers only for the warehouses of the caller's write scope (no scope = every warehouse; another warehouse → 403 `FORBIDDEN` `params.reason = WAREHOUSE_SCOPE`) and only for `WHOLESALE` and `STORE` warehouses. Quantities are decimal strings in base units, instants ISO strings.

| Route | Right | Body / query → answer |
|---|---|---|
| `GET /stock-problems/warehouses` | `problems.read` | → `StockProblemWarehouseDto[]`: `warehouseId, warehouseCode, warehouseName, productCount, redCount, cutCount, settingsReady` for each warehouse of the scope. |
| `GET /stock-problems?warehouseId=` | `problems.read` | `warehouseId` required → `{ data: StockProblemDto[] }`, newest event first, not paged (bounded by the window). |
| `POST /stock-problems/legitimate` | `problems.manage`, `Idempotency-Key` | `{ warehouseId, productId, note? }` → 200 `StockProblemResolutionDto` (`LEGIT`, `DONE`). 404 when the product is not on the list; 409 `CONFLICT` `params.reason = STOCK_PROBLEM_PENDING` while a decision waits. |
| `POST /stock-problems/zero-out` | `problems.manage`, `Idempotency-Key` | `{ warehouseId, productId, qty? }` (`qty` base units; omitted = the whole on-hand) → 201 `StockProblemResolutionDto` (`ZERO_OUT`, `PENDING`, `issueId`, `issueStatus` `SENT`). 409 `SETTING_MISSING` (`params.key = stockProblems.settings`, `warehouseId`); 409 `STOCK_INSUFFICIENT` (more than on hand); 422 `qty` `min` (nothing on hand); 404 / 409 as above. |
| `GET /stock-problems/settings` | `problems.read` | → `StockProblemSettingsDto[]`: `warehouseId, warehouseCode, warehouseName, customerId, customerName, expenseTypeId, expenseTypeName, updatedAt`, one per warehouse of the scope (nulls when never set). |
| `PUT /stock-problems/settings/:warehouseId` | `problems.manage` | `{ customerId: number \| null, expenseTypeId: number \| null }` → `StockProblemSettingsDto`. 404 unknown customer or type; 409 `EXPENSE_TYPE_INACTIVE`. The expense types are `GET /issues/expense-types`. |
| `POST /stock-problems/sheets/build` | `problems.manage`, `Idempotency-Key` | `{ warehouseId? }` (omitted = every warehouse of the scope) → 200 `StockProblemSheetDto[]`: today's sheets, built or topped up (§5). |
| `GET /stock-problems/sheets` | `problems.read` | `warehouseId?, status?, sheetDate?, cursor?, limit?` → `{ data: StockProblemSheetDto[], nextCursor }`, newest first. |
| `GET /stock-problems/sheets/:id` | `problems.read` | → `StockProblemSheetDetailDto` (the sheet + `lines` in shelf order): the read the web prints. |
| `GET /stock-problems/sheets/mine` | `problems.count` | → `StockProblemSheetDetailDto[]`: today's `OPEN` sheets of the caller's warehouses, with lines (the staff app). |
| `POST /stock-problems/sheet-lines/:id/count` | `problems.count`, `Idempotency-Key` | `{ countedQty }` (base units, ≥ 0, ≤ 3 decimals) → 200 `StockProblemSheetLineDto`. May be sent again until the approval (a new key re-reads the on-hand). 409 `DOC_STATE_INVALID` once the sheet is not `OPEN`. |
| `POST /stock-problems/sheets/:id/approve` | `problems.manage`, `Idempotency-Key` | `{ countedOnly? }` → 200 `StockProblemSheetDetailDto` (`APPROVED`, `issueId`, `adjustmentId`, each line's `outcome`). 409 `CONFLICT` `params = { reason: SHEET_LINES_UNCOUNTED, count }` unless `countedOnly`; 422 `lines` `empty` when nothing is counted; 409 `SETTING_MISSING` with a shortage and no defaults; 409 `STOCK_INSUFFICIENT` when a shortage is more than is on hand now; `PRODUCT_NOT_IN_WAREHOUSE` for a surplus of a product homed elsewhere. Repeating it on an approved sheet changes nothing. |

`StockProblemDto`: `warehouseId; product: { id, sku, name, baseUomName }; onHand; redQty; cutQty; lastEventAt; events: StockProblemEventDto[]; pending: { id, kind, qtyBase, issueId, adjustmentId, sheetId, createdAt } | null`.

`StockProblemEventDto`: `kind; qtyBase; at; shortfallId, saleId, saleNumber` (a till sale) `; orderId, orderNumber, orderLineId, customerId, customerName, repName, orderedQtyBase` (an order; `repName` is who entered it) — the fields of the other source are null.

`StockProblemResolutionDto`: `id, warehouseId, productId, kind, status, qtyBase, onHand, note, issueId, issueStatus, adjustmentId, sheetId, createdAt`.

`StockProblemSheetDto`: `id, warehouseId, warehouseCode, warehouseName, sheetDate, status, lineCount, countedCount, builtAt, builtByName (null = the job), approvedAt, approvedByName, issueId, adjustmentId`.

`StockProblemSheetLineDto`: `id, sheetId, product, binCode (the product's fixed shelf), systemQty, redQty, cutQty, countedQty, onHandAtCount, difference, countedAt, countedByName, outcome, resolutionId`.

## 4. The list

- **Events** (`ProblemSourcesService`): the tills' open shortfalls read with plain SQL from `pos_shortfalls` + `pos_sales` (`resolved_at IS NULL`); order lines with `qty_backordered > 0` of non-draft orders (`BACKORDER`, at `confirmed_at`) and picked lines with `qty_picked < qty_approved` (`SHORT_PICK`, at the part's `done_at`), read with plain SQL from `sales_order_lines`, `sales_orders`, `sales_order_picks` (+ the customer's and the creator's names). Only this file names another module's tables, read only (ADR-0230 #2). Events older than 30 days are not read. The worker's `StockProblemsWorkerModule` does not import pos (its `PinHasher` needs `AUTH_PEPPER`, which the worker is not given): it provides the same services with `WorkerShortfallResolver`, and only the api binds `ShortfallResolver` to `PosQueryService.resolveShortfall` (2026-11-20).
- **A product is on a warehouse's list** while it has an event later than the latest `covers_until` of its DONE resolutions there. `pending` names a decision that waits for its document.
- **`sync`** (before every read, and in the morning job): a PENDING resolution whose goods issue or adjustment is `POSTED` becomes DONE, `CANCELLED` becomes CANCELLED. With a manager's context it also sends or submits a draft that a failed request left, and marks the answered till shortfalls checked in pos (`pos_resolved_at`), so «Супермаркет → Дутагдал» agrees.

## 5. The morning sheet

- `StockProblemSheetsService.build(null)` is the 07:00 job's work (`stockproblems.morningSheets`, cron `0 7 * * *` Ulaanbaatar); `build(ctx, warehouseId?)` is the manager's button. One sheet per warehouse and day; building again adds only new problem products; an approved sheet is left alone; no sheet for a warehouse without problems.
- Left off a sheet: a product with a PENDING decision, and a product counted on an older open sheet that still waits for its approval. An older open sheet nobody counted becomes `CLOSED`.
- **Count:** `on_hand_at_count` is the warehouse's on-hand (every bin) when the entry is saved; `difference = counted − on_hand_at_count`.
- **Approve:** shortages → one goods issue (a line per bin that holds the product, fullest first; recipient = the warehouse's customer, the warehouse's expense type), sent; surpluses → one `SURPLUS` adjustment into the product's fixed shelf (else a store's sales floor, else the receiving area), submitted and, with `inventory.adjustments.approve`, posted; equal lines DONE at once. A counted product whose decision already waits (zeroed after the sheet was built) gets no outcome.

## 6. Rights

| Right | Roles (defaults) | Allows |
|---|---|---|
| `problems.read` | ADMIN, ACCOUNTANT, WAREHOUSE, PRODUCT_SPECIALIST | the list, the settings, the sheets |
| `problems.count` | ADMIN, PRODUCT_SPECIALIST | today's sheets in the staff app, a line's count |
| `problems.manage` | ADMIN, ACCOUNTANT | «Зүй ёсны», «Үлдэгдэл тэглэх», build, approve, the settings |

`PRODUCT_SPECIALIST` «Барааны мэргэжилтэн» is a system role (ADR-0165); give the person a warehouse scope, else they see every warehouse.

## 7. Audit

`stock_problem_resolutions` `RESOLVE` / `CREATE` / `CANCEL`, `stock_problem_settings` `CREATE` / `UPDATE`, `stock_problem_sheets` `CREATE` / `UPDATE` / `CLOSE` / `APPROVE`, `stock_problem_sheet_lines` `COUNT`; the goods issue and the adjustment write their own rows.

## 8. Tests

`apps/api/test/integration/stock-problems.int-spec.ts`: both kinds on the list, the scope, «Зүй ёсны» (and the pos shortfall), the settings, zero-out → issue → off the list, the morning sheet, count → approve → issue + `SURPLUS` adjustment → resolved. `packages/shared/src/stock-problems/stock-problems.test.ts`.

## 9. Open

- A reader in sales (and a posted-issue hook in inventory) would replace the SQL read and the sync on read.
