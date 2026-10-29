# Module `procurement` — contract

Status: **built** as slice 1 (ADR-0115, migration `0052_procurement`, 2026-10-29) and slice 1b (ADR-0118, migration `0055_po_detail`, 2026-10-29, branch `claude/slice1b-order-detail`) of the approved order of work (`docs/workflows.md` §3, §4 and §7). It brings delivery 8 forward in part:
- **Built:** purchase orders by supplier with seven statuses, the order's detail page as in Butenorgil (every supplier's products in one table, every stage's columns side by side), receiving against the order, the price check, the history screen, the order's Excel, archiving.
- **Not built yet:** reorder suggestions, supplier price history, trucks and kg fill (the next slice).

The work is walked by the owner on the development environment only; no real business transaction enters Bto during the trial.

**Code.**
- API: `apps/api/src/modules/procurement/`; the statuses, column groups, history kinds and box arithmetic in `packages/shared/src/procurement`.
- Web: `apps/web/src/features/procurement/` (`orders-pages.tsx` the list, the create dialog and the print; `order-detail-page.tsx`, `order-table.tsx`, `order-header.tsx`, `order-edits.ts` the detail page; `order-history-page.tsx`). The keeper's scanner screen and the receipt window belong to inventory (`apps/web/src/features/inventory/receipt-receive-page.tsx`, `receipt-form.tsx`).

**Dependencies.** procurement depends on `identity`, `partners`, `catalog` and `inventory`, each through its `index.ts` (MODULE_DEPS). Nothing imports procurement: inventory declares the `RECEIPT_PROGRESS` hook and procurement binds it. Counts and prices typed on the order page go through inventory's own services (`ReceiptsService.countLineInTx`, `PUT /receipts/:id/costs`); the history reads identity's `AuditQueryService`.

## 1. Owner's answers behind the design

The scope is in `docs/workflows.md` §4 (slice 1, four question rounds of 2026-10-29) and §7 (slice 1b, the owner's guide of Butenorgil's menu compared with slice 1, every item decided 2026-10-29). In short:

**Ordering.** Orders are grouped by **supplier**; one order holds **several suppliers**, each with its own status (the order shows the lowest); each supplier has **one orderer**; the grid lists the supplier's **main** products; the sales columns count **every outflow from the warehouse** (sales less returns plus transfers to supermarkets).

**Statuses and editing.** Бэлдэж → Илгээсэн → **Ачигдаж байна** → Замд → Ирсэн are moved by the orderer or a manager; «Ирсэн» makes the draft receipt; the keepers' confirmation sets «Нягтлан шалгаж»; the accountant's price confirmation sets «Орлого авсан». The **shipped quantities** are typed at «Ачигдаж байна»; receiving then expects the shipped quantity (the ordered one where none was typed). Quantities change until «Ирсэн» for the orderer and managers; keepers only in «Бэлдэж», only their warehouse's products. Partial arrival **closes** the line (no backorders).

**Receiving and checks.** The note's **pieces** are checked at the keeper's confirmation and its **amount** at the accountant's, within 1₮; goods not on the order are **added** as lines; **each warehouse's keeper confirms their own lines** (one receipt, one number, one payable; stock in at the last confirmation); the arrived quantity **starts empty**, typed as **boxes × loose pieces** with a **note** on a difference.

**The page.** The list opens the detail page directly; header with the statuses as circles, «Хадгалах», «Хэвлэх», «Түүх», «Excel», one step back; a yellow bar when another user changed the order (never an automatic refresh while typing); filters supplier / warehouse / search / «Захиалах ёстой» / «Зөвхөн захиалсан» / «Багана»; a history screen; the order's Excel; archiving. Not in: the dashboard, trucks, the «Ороогүй бараа» basket, a supervisor role, other suppliers' products in a group, store orders from suppliers.

**Menu.** A «Татан авалт» group inside «Агуулах».

## 2. Owned tables (migrations `0052_procurement`, `0055_po_detail`)

| Table | What | Guards |
|---|---|---|
| `purchase_orders` | One order, numbered at creation `PO-YYYY-NNNNNN` (`NumberingService`, scope `PO`, Ulaanbaatar year). Holds `order_date`, `note`, `status` (the lowest supplier status, refreshed in every transaction that moves a supplier), `archived_at` / `archived_by` (ADR-0118 #5). | Number unique; status CHECK (seven values); note ≤ 500; index `(archived_at, id)`; `REVOKE DELETE, TRUNCATE` |
| `purchase_order_suppliers` | A supplier inside an order: `status`, `receipt_id` (the draft or posted goods receipt from «Ирсэн» on) and `status_changed_at/by`. | (order, supplier) unique; `receipt_id` unique; CHECK `receipt_id IS NOT NULL ⇔ status ∈ {ARRIVED, ACCOUNTING, RECEIVED}`; deleted only by `removeSupplier` in «Бэлдэж» |
| `purchase_order_lines` | An ordered product: `product_unit_id`, `qty`, `factor_snapshot`, `qty_base`, `shipped_qty` (in the line's unit; NULL until typed, 0 = not shipped), `updated_by/at`. | (order supplier, product) unique; qty > 0 (a zero deletes the row); `shipped_qty IS NULL OR ≥ 0` |
| `supplier_orderers` | The orderer of a supplier, by user. | Primary key on the supplier; index on the user |

Inventory's side of the same migrations is listed in `docs/modules/inventory.md`: the receipt lines' `expected_qty`, `checked_at` and `note`; the receipts' note totals, photo and origin; `goods_receipt_confirmations`.

## 3. Public API (`modules/procurement/index.ts`)

| Export | Use |
|---|---|
| `ProcurementModule` | The services below. Binds inventory's `RECEIPT_PROGRESS` to `OrderProgressService`, so a supplier follows its receipt in the receipt's transaction. |
| `ProcurementHttpModule` | The controllers (api only). |

Services (not exported beyond the module):

**`PurchaseOrdersService`**
- `create`, `update` (the note), `addSuppliers`, `removeSupplier`;
- `move` (one step forward or back);
- `archive`, `unarchive`;
- `get`, `list`, `version`;
- `refreshStatus(tx, orderId)`.

**`PurchaseOrderGridService`**
- `rows`: a supplier's page of the detail table, a keyset page of 200 over its main products by name, with the sales months, the receipt line and the caller's rights;
- `saveLines`: the changed ordered (`ORDERED`) and shipped (`SHIPPED`) cells, against the values they had when the page opened;
- `saveArrivals`: the counts typed on the page, through `ReceiptsService.countLineInTx`;
- `sheets`: the print; `exportLines`: the order's Excel rows.

**`OrderHistoryService`**
- `list`: the order's history over the audit rows; `workbook`: the same as one sheet.

**`SupplierOrderersService`**
- `get`, `candidates` (active holders of `procurement.orders.edit`), `set`.

**`OrderProgressService`**
- ARRIVED → ACCOUNTING on `receiptPostedInTx`; ACCOUNTING → RECEIVED on `receiptCostedInTx`.

## 4. REST surface (`/api/v1`)

| Route | Right | What |
|---|---|---|
| `GET /purchase-orders?status&supplierId&mine&archived&q&cursor&limit` | `procurement.orders.read` | Orders, newest first; `mine` keeps those with a supplier the caller orders from; `archived=true` the archived ones (hidden otherwise) |
| `POST /purchase-orders` (`Idempotency-Key`) | `procurement.orders.manage` | `{orderDate?, note?, supplierIds}` |
| `GET /purchase-orders/:id` | read | Header (with `archivedAt`, `canArchive`) and suppliers with status, orderer, line count, Σ pieces and kg, Σ shipped, Σ arrived, unchecked lines, the estimated and the final amount and the price differences (price readers), the note's totals, the receipt, and what the caller may do (`canEdit`, `canShip`, `canCount`, `canPrice`, `canMoveNext`, `canMoveBack`) |
| `GET /purchase-orders/:id/version` | read | `{updatedAt, receiptsUpdatedAt}`: the stamps the page polls every 30 s (ADR-0118 #2) |
| `PATCH /purchase-orders/:id` | manage | The note |
| `POST /purchase-orders/:id/suppliers` / `DELETE …/suppliers/:supplierId` | manage | Add suppliers / remove one in «Бэлдэж» |
| `POST /purchase-orders/:id/archive` / `…/unarchive` (`Idempotency-Key`) | manage | Out of the list and back (received, or nothing ordered: `PO_NOT_ARCHIVABLE`) |
| `POST /purchase-orders/:id/suppliers/:supplierId/status` (`Idempotency-Key`) | read + the rule of §5 | `{to}`: one step forward or back |
| `GET /purchase-orders/:id/suppliers/:supplierId/rows?q&filter=ALL\|ORDERED\|BELOW_MIN&warehouseId&cursor&limit` | read | The page: rows with `sales`, `line.shippedQty`, `canShip`, `receipt` (the receipt line: expected and arrived base quantity, note, confirmed, `canCount`, the prices for cost holders), `rights`, the receipt's version and totals, `extra` rows (first page) |
| `PUT /purchase-orders/:id/suppliers/:supplierId/lines` | `procurement.orders.edit` | `{changes:[{productId, field?, productUnitId, qty, previousUnitId, previousQty}]}` → `{applied, conflicts, refused}` |
| `PUT /purchase-orders/:id/suppliers/:supplierId/arrivals` | read + the rule of §5 | `{changes:[{lineId, arrivedQtyBase?, note?, previousArrivedQtyBase}]}` → `{applied, conflicts, refused}` |
| `GET /purchase-orders/:id/history?userId&supplierId&productId&cursor&limit`, `GET …/history.xlsx` | read | The history (§7), 100 a page, and as one sheet |
| `GET /purchase-orders/:id/export.xlsx` | read | The order as one sheet (prices for price readers) |
| `GET /purchase-orders/:id/print?supplierId` | read | The order sheets |
| `GET /procurement/orderer-candidates`, `GET/PUT /procurement/supplier-orderers/:supplierId` | read / manage | The orderers |

## 5. Rules worth knowing

**Who edits a cell.** This is `editRight`, checked per cell under `FOR UPDATE` on the order and its supplier rows:

| Who | Rows | Statuses |
|---|---|---|
| Manager (`manage`) | Every row | Up to «Замд» |
| The supplier's orderer (with `edit`) | Every row | Up to «Замд» |
| Others with `edit` | Products whose home warehouse is in their write scope (null = every warehouse) | «Бэлдэж» only |

Other cases:
- A product without a home warehouse is refused (`NO_HOME`).
- A product the supplier is not the main supplier of, and that has no line yet, is refused (`NOT_SUPPLIER`).
- Past the editable statuses, the whole save is 409 `PO_NOT_EDITABLE`.

**Shipped quantities (ADR-0118 #1).** `SHIPPED` cells are taken in «Ачигдаж байна» only (`canShip`: a manager, or the orderer with `edit`); otherwise the save is 409 `PO_NOT_EDITABLE` with `reason: 'SHIPPED'`. A product without a line is refused `NO_LINE`. Null clears, 0 means not shipped.

**Counts on the page (ADR-0118 #3).** `saveArrivals` works in «Ирсэн» only (`PO_NOT_EDITABLE`, `reason: 'ARRIVALS'`): a manager counts every line, a receipt holder the lines of a warehouse in their write scope (`canCount`; else `SCOPE`); a confirmed warehouse's line is `CONFIRMED`; a stale count (the stored base quantity, null while unchecked) is a conflict. The receipt is locked before the order. A base quantity that does not divide by the line's factor switches the line to pieces (`docs/modules/inventory.md` §5).

**The price check (ADR-0118 #4).** A cost holder at «Нягтлан шалгаж» types the unit price per line; the page calls `PUT /receipts/:id/costs` with the receipt's costing version, which makes the payable and moves the supplier to RECEIVED.

**Optimistic save.** Each change carries the value the page opened with (null = none). A cell whose stored value differs is skipped and returned in `conflicts` with its current value. This is Butenorgil's lesson: a stale page once zeroed 13 brands. Every applied change is audited.

**Moves.**
- Forward: by a manager or the supplier's orderer; refused with nothing ordered (`PO_SUPPLIER_EMPTY`); refused on an archived order (`PO_STATUS_INVALID`).
- Back: by a manager only, up to «Ирсэн» (`PO_STATUS_INVALID` beyond).
- **«Ирсэн»** makes the draft receipt: origin ORDER, `origin_ref` = the order's number, the business date as the note's date.
  - Each line expects the shipped quantity in its unit (the ordered one where none was typed); a line shipped as 0 is left out; nothing left → `PO_SUPPLIER_EMPTY`.
  - Its `doc_unit_price` is the product's last delivery-note price per base unit × the unit's factor.
  - A homeless product refuses the move (`PRODUCT_NO_HOME`).
- **Back from «Ирсэн»** cancels the draft (`ReceiptsService.cancelOrderDraftInTx`). It is refused once a keeper confirmed a warehouse (`RECEIPT_WAREHOUSE_CONFIRMED`).
- **Lock order.** The receipt is locked before the order, as the receipt's own hook does (receipt → order), so the two never wait on each other.

**Progress from the receipt.**
- The keepers' last confirmation posts the receipt; procurement sets ARRIVED → ACCOUNTING.
- The accountant's first price check (costing version 1) sets ACCOUNTING → RECEIVED.

**Archiving (ADR-0118 #5).** A manager archives an order that is RECEIVED, or on which nothing is ordered; `PO_NOT_ARCHIVABLE` otherwise. Archived orders leave the list (`archived=true` shows them) and cannot move.

**The rows.**
- **Products:** the supplier's main products, plus any already ordered, that are ACTIVE, by name, searched like the product list (`ProductQueryService.orderedIds`, at most 5,000); `warehouseId` keeps the rows homed there.
- **On hand and minimum:** the home warehouse's `warehouse_stock.on_hand` and `product_locations.min_qty`.
- **Sales:** `StockQueryService.outflowByMonth` over the 12 calendar months before this one (Asia/Ulaanbaatar): `avg12` = Σ / 12, `avg3` = Σ of the last three / 3, `lastMonth`, `sameMonthLastYear` (the first of the twelve), base units, home warehouse; `lastMonthOut` is kept.
- **Last price:** `ReceiptsService.lastPrices`, for price readers only (the key is absent for others).
- **Estimated cost:** Σ ordered `qty_base` × last price per base unit.
- **Receipt line:** from `ReceiptsService.get` (and `costing` for cost holders of a posted receipt): expected and arrived base quantities, the note, whether its warehouse is confirmed, `canCount`, the prices.

## 6. Error codes introduced

| Code | Status | When |
|---|---|---|
| `PO_NOT_EDITABLE` | 409 | The supplier is past the statuses the caller may type in (`reason`: the status, `SHIPPED` or `ARRIVALS`) |
| `PO_SUPPLIER_EMPTY` | 409 | Moving on a supplier with nothing ordered (or nothing shipped at «Ирсэн») |
| `PO_STATUS_INVALID` | 409 | Not the next or previous status; removing a supplier past «Бэлдэж»; moving on an archived order |
| `PO_NOT_ARCHIVABLE` | 409 | Archiving an order not received, with something ordered |

The receipt codes of the slice are in `docs/modules/inventory.md` §6.

## 7. Audit and the history

| What | Audited as |
|---|---|
| Order creation | `CREATE purchase_orders` |
| Note change; suppliers added or removed | `UPDATE purchase_orders` |
| Archiving | `ARCHIVE` / `UNARCHIVE purchase_orders` |
| Every move, including the hook's | `UPDATE purchase_order_suppliers` (status before, after) |
| Every applied ordered cell | `UPDATE purchase_order_suppliers` (`productId`, `line` before, after) |
| Every applied shipped cell | `UPDATE purchase_order_suppliers` (`productId`, `shipped`) |
| Counts, notes, lines added or removed on an ORDER receipt (page or scanner screen) | inventory's `COUNT` / `LINE_ADD` / `LINE_REMOVE goods_receipts` |
| Orderer changes | `UPDATE supplier_orderers` |

The **history** (`OrderHistoryService`, ADR-0118 #5) is a view over those rows and the receipts' `CONFIRM`, `WITHDRAW`, `POST`, `CANCEL` and `COST` rows: kinds `PO_HISTORY_KINDS` (CREATED, NOTE, SUPPLIERS_ADDED, SUPPLIER_REMOVED, STATUS, ORDER_QTY, SHIPPED_QTY, ARRIVED_QTY, LINE_NOTE, LINE_ADDED, LINE_REMOVED, RECEIPT_CONFIRMED, RECEIPT_WITHDRAWN, RECEIPT_POSTED, RECEIPT_CANCELLED, PRICES, ARCHIVED, UNARCHIVED), each with the user, the time, the supplier, the product and «from → to» (a status code for STATUS, quantities with their unit otherwise). Filters: user, supplier, product (`before`/`after` JSON, or a COST row's `lines[].productId`).

## 8. Screens (`apps/web`)

All in «Агуулах → Татан авалт»:
- **«Худалдан авах захиалга»** (`/procurement/orders`): the list with «Архив», and a new order on `?new=1` (date, note, the ticked suppliers). A row opens the detail page.
- **The order** (`/procurement/orders/:id`, full width, ADR-0118):
  - the header: number, status, date, author; the seven statuses as circles; «Хадгалах (n)», «Excel», «Түүх», «Хэвлэх», one step back for the filtered supplier, archive, the note and suppliers dialogs; the totals line; the yellow bar with «Дахин ачаалах»;
  - the filter row: supplier, warehouse, search, «Захиалах ёстой», «Зөвхөн захиалсан», «Баганууд» (column groups, ADR-0050's storage under `procurement.order`);
  - one table: a header row per supplier (status, «→ дараагийн шат», «N захиалаагүй», pieces · kg, orderer, receipt, «Захиалгад байхгүй бараа нэмэх», the note's amount at «Нягтлан шалгаж»), its rows with the stage columns, its footer; conflicts shown per cell.
- **The history** (`/procurement/orders/:id/history`, wide): user / supplier / product filters, «Excel».
- **The order sheets** (`/procurement/orders/:id/print?supplierId=`, browser print, ADR-0058).
- **«Захиалагч» card** on the supplier page.

The scanner screen and the receipt window are inventory's (`docs/modules/inventory.md` §9).

## 9. Tests

- **Integration:** `procurement.int-spec.ts`:
  - numbering and every role rule; the rows' figures with keepers seeing no price; the warehouse filter; the stale-page conflict and refused rows; the version stamps;
  - «Ачигдаж байна»: shipped cells by the orderer, refused for a keeper and out of the status, a stale shipped cell, `NO_LINE`; Σ shipped;
  - «Ирсэн» → a draft expecting the shipped quantities (a line shipped as 0 left out; nothing shipped refused);
  - the counts on the page: 4 boxes + 2 pieces of 12 → the line in pieces with its expectation and price converted, the note; `SCOPE`, a conflict, `CONFIRMED`, a manager's count; the extra row;
  - each keeper confirming their warehouse, the pieces mismatch, the posting onto NOSHELF (sellable at once);
  - the price check from the page's data, the 1₮ amount check, RECEIVED, the bill, `finalAmount` and `priceDiffCount`;
  - the history's kinds and filters, both Excel files, archiving refused then allowed, the list's `archived` filter, unarchive;
  - stepping back from «Ирсэн» cancelling an untouched draft, refused once posted.
- **Integrity:** `procurement-races.spec.ts`: two saves of one empty cell → one applied, one conflict; two keepers confirming at once → posted once; two counts of one line from two pages → one applied, one conflict.
- **Shared (Vitest):** `procurement.test.ts` (seven statuses, the editable ones, boxes × pieces, the groups a stage requires, the 1₮ check).
- **Web:** `features/procurement/orders-pages.test.tsx` (the list with «Архив», one table with two suppliers and one request per supplier and kind, conflicts kept, shipped cells and the locked column group, the price check through the receipt's costs, the yellow bar and reload, a keeper without prices, the history page).

## 10. Open items

- **Trucks and kg fill:** the next slice.
- **Reorder suggestions and supplier price history:** delivery 8's remainder.
- **The assistant's views:** `ai.purchase_orders` / `ai.purchase_order_lines`.
- **The staff app's receiving.**
- **The driver's fee in the goods' cost:** for the accountant (TODO-VERIFY, `docs/workflows.md` §1).
