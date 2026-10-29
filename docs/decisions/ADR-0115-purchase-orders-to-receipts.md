# ADR-0115: Purchase orders by supplier, receiving by scan against the order with each warehouse's confirmation, and the accountant's price check as the only source of the payable (slice 1)

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-29 |
| Deciders | Owner (scope in `docs/workflows.md` §4 and four question rounds, 2026-10-29), Claude (Claude Code session started by «Bto удирдлага») |
| Amends | ADR-0078 #3 (a receipt is never costed at posting), ADR-0091 #3 (the bill is made only by the accountant's price check), ADR-0099 #1 (a posted line goes to the fixed shelf, else the sellable «Тавиургүй» shelf, never RECEIVING) and #2 (the confirmation takes the warehouse scope), ADR-0103 #2 (a discount above its lines is refused at the price check, no longer at posting) |

## Context

On 2026-10-28 the owner stopped feature work: Bto did not fit the real flow. The approved order of work (`docs/workflows.md` §3) starts with purchase order → receipt, the step that causes the most errors today. The real flow (`docs/workflows.md` §1):

1. The company orders from suppliers in Ulaanbaatar. Butenorgil's «Захиалга» menu is the reference (a read-only study of its code, 2026-10-29).
2. The draft receipt exists before the goods arrive.
3. The keeper checks what arrived against it.
4. The accountant then confirms the prices.
5. That confirmation creates the supplier's payable.
6. Shelves are not used.

Before this decision, Bto had no purchase orders. A receipt had one quantity per line and went to RECEIVING, which is not sellable. A receipt priced in full became the supplier's bill at the keeper's posting.

The scope agreed for slice 1 is in `docs/workflows.md` §4. The owner then answered four rounds of questions (2026-10-29):

1. **Grouping.** Orders are grouped by **supplier**, not brand; Bto has no brands (dropped in 0014).
2. **Suppliers per order.** One order holds **several suppliers**, each with its own status. The order shows the lowest of them.
3. **Orderer.** Each supplier has **one orderer**, a staff member.
4. **Partial arrival.** What did not arrive **drops out**. There are no backorders.
5. **Statuses.**
   - The orderer or a manager moves Бэлдэж → Илгээсэн → Замд → Ирсэн.
   - «Ирсэн» makes the draft receipt.
   - The keepers' confirmation sets «Нягтлан шалгаж».
   - The accountant's price confirmation sets «Орлого авсан».
6. **Note totals.** The keeper checks the delivery note's **pieces** at confirmation. The accountant checks its **amount**, within 1₮. **Every receipt** carries both totals, including the window and the import.
7. **Goods not on the order.** The keeper **adds** the line.
8. **Editing quantities.** Quantities can be changed **until «Ирсэн»**:
   - by the orderer and managers;
   - by keepers only in «Бэлдэж».
9. **Products shown.** The grid lists the supplier's **main** products.
10. **"Recent sales" column.** It shows **last month's outflow**: wholesale sales plus transfers to supermarkets, less returns.
11. **Receipts spanning warehouses.** **Each warehouse's keeper confirms their own lines.** It stays one receipt and one payable, and the stock comes in at the **last** confirmation.
12. **Arrived quantity.** It **starts empty**. Every line is checked, or marked «ирээгүй».
13. **Menu.** The orders sit in a **«Татан авалт» group inside «Агуулах»**.

## Decision

### 1. A new module, `procurement` (migration `0052_procurement`)

**Tables:**
- `purchase_orders`:
  - `PO-YYYY-NNNNNN`, numbered at creation like sales orders (ADR-0057).
  - `order_date` and `note`.
  - `status`, a cache of the lowest supplier status, kept in the transaction that moves a supplier.
- `purchase_order_suppliers`: (order, supplier) unique. Holds the six statuses PREPARING / SENT / IN_TRANSIT / ARRIVED / ACCOUNTING / RECEIVED, and `receipt_id`, which is set exactly from ARRIVED on (CHECK).
- `purchase_order_lines`: one row per (order supplier, product), with a quantity in any current unit and `factor_snapshot` / `qty_base`. Having no row means nothing is ordered; a zero deletes the row.
- `supplier_orderers`: one user per supplier.

**Permissions:**

| Permission | What it allows |
|---|---|
| `procurement.orders.read` | Reading orders |
| `procurement.orders.edit` | Typing quantities, row by row as described below |
| `procurement.orders.manage` | Creating orders; adding and removing suppliers; every supplier's quantities and statuses; orderers |
| `procurement.prices.read` | The last price and the estimated cost |

The system roles receive them as follows:
- PROCUREMENT gets all four.
- WAREHOUSE gets read and edit.
- ACCOUNTANT gets read and prices.
- OFFICE gets read.

### 2. Who types quantities

Each cell of a supplier's quantities is checked on save, under a lock on the order and its supplier rows:
- A manager may type for every product, up to «Замд».
- The supplier's orderer, holding `edit`, may also type for every product up to «Замд».
- Anyone else holding `edit` may type only:
  - in «Бэлдэж»;
  - for products whose home warehouse lies in their write scope.

The page sends only the changed cells, each with the unit and quantity it had when the page opened. If a cell differs now, it is skipped and returned in `conflicts` with what it holds now. A row the caller may not write is returned in `refused`, with the reason SCOPE, NO_HOME or NOT_SUPPLIER.

### 3. The grid

The grid holds the supplier's main products (and any already ordered), ACTIVE only, ordered by name and searchable. Beside each it shows:
- the home warehouse, its on-hand and its minimum (`product_locations.min_qty`);
- last calendar month's outflow from the home warehouse (Asia/Ulaanbaatar). This is DELIVERY_ISSUE, less credit-note RETURN_IN, plus TRANSFER_OUT of transfers to a STORE warehouse. It is read from the ledger by `StockPostingService.outflow`, the ledger's only reader (G2).
- for price readers, the last delivery-note price per base unit and the estimated cost.

Filters: «Захиалсан» and «Доод үлдэгдлээс бага». The order sheet is printed per supplier in the browser (ADR-0058): code, name, warehouse, unit, quantity, pieces and kg.

### 4. Statuses

- The orderer or a manager moves a supplier one step forward up to «Ирсэн». A supplier with nothing ordered cannot move on.
- Only a manager steps back, and only up to and including «Ирсэн».
- **«Ирсэн»** calls `ReceiptsService.createInTx`:
  - origin ORDER, `origin_ref` set to the order's number, the business date as the note's date;
  - one line per ordered product, `expected_qty` set to the ordered quantity in its unit, arrived 0 and unchecked;
  - the product's last delivery-note price for that unit filled in as `doc_unit_price`.

  A product without a home refuses the move (`PRODUCT_NO_HOME`).
- **Back from «Ирсэн»** cancels that draft (`cancelOrderDraftInTx`). It is refused once a keeper has confirmed a warehouse. It locks the receipt before the order, the same lock order the receipt's own hook uses.
- **«Нягтлан шалгаж»** and **«Орлого авсан»** are set only by inventory's new hook `RECEIPT_PROGRESS` (`receiptPostedInTx`, `receiptCostedInTx`). Procurement binds it with `useExisting`, and inventory never imports procurement.
- The receipt window cannot cancel an ORDER draft (`RECEIPT_FROM_ORDER`) or change its supplier.

### 5. Receiving against expected quantities

Receipt lines gain `expected_qty` (null on a line typed by hand) and `checked_at`:
- A line typed by hand is checked when entered.
- A line from the order waits until its quantity is set.
- Zero is allowed only on an expected line; it means «ирээгүй». The CHECK enforces this.

Receipts gain:
- `note_total_qty` (pieces = Σ `qty_base` of every line, free goods included);
- `note_total_amount`;
- `note_photo_file_id` (file kind `inventory.receipt_note`, private, for receipt and cost holders);
- `origin` (MANUAL / IMPORT / ORDER) and `origin_ref`.

The keeper's screen `/inventory/receipts/:id/receive` works with a handheld wedge scanner anywhere on the page:
- A scan jumps to the line and shows what was ordered.
- A product not on the order is added after a question.

### 6. Each warehouse's confirmation

`POST /receipts/:id/post` is now the keeper's confirmation:
- It confirms every warehouse of the receipt in the caller's write scope (`goods_receipt_confirmations`); a user without a scope confirms them all at once.
- Every line there must be checked (`RECEIPT_LINES_UNCHECKED`).
- A confirmed warehouse's lines are frozen (`RECEIPT_WAREHOUSE_CONFIRMED`) until that warehouse's keeper withdraws the confirmation (`DELETE /receipts/:id/confirmations/:warehouseId`).

Drafts are still edited by any holder of the receipt right (ADR-0099 #2), but **confirmation takes the scope**.

The **last** confirmation:
- requires both note totals (`RECEIPT_NOTE_MISSING`);
- requires the pieces to equal exactly (`RECEIPT_NOTE_QTY_MISMATCH`);
- refuses a receipt where nothing arrived (`RECEIPT_NOTHING_ARRIVED`);
- posts the arrived lines, each on its product's fixed shelf, else the warehouse's sellable **«Тавиургүй»** (`NOSHELF`, created on first use). Goods are on sale at once.

The sale prices and the supplier links follow as before (ADR-0099 #5, ADR-0103 #6).

### 7. The accountant's price check is the only source of the payable

The posting **never costs**: every posted receipt is POSTED / PENDING (amends ADR-0078 #3). `PUT /receipts/:id/costs` is the price check:
- It shows each arrived line's **previous price**. That is the product's line on the receipt posted before this one, from any supplier, per this line's unit (`GET /receipts/:id/costing` → `previousUnitPrice`). The new price sits beside it, and the screen highlights a difference.
- It takes the arrived lines only.
- It checks the payable (Σ amounts less the discounts) against `note_total_amount` within **1₮** (`RECEIPT_NOTE_AMOUNT_MISMATCH`). The accountant may correct the note's total in the same request.
- Its version 1 is the supplier's bill through `PURCHASE_BOOKS`, unchanged (amends ADR-0091 #3: no bill at the keeper's posting). It also fires `RECEIPT_PROGRESS.receiptCostedInTx`.

Receipts made in the window or by the import go through the same check. A discount larger than its lines is now refused at the price check rather than at posting.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Group orders by brand (Butenorgil) | The owner chose suppliers; Bto has no brands, and a brand field would need a whole catalogue pass. |
| One draft receipt per supplier and warehouse, each posted by its keeper at once | The owner chose one receipt, one number and one payable per delivery note, with the stock coming in at the last confirmation (round 4). |
| Partial posting per warehouse into one GR | A document posting in several steps breaks the ledger's one-number, one-status model (ADR-0034) for little gain; the truck arrives at once. |
| Backorders for what did not arrive | The owner chose to close the line; it goes on a later order. |
| The arrived quantity defaulting to the expected one | Fast, but a blind confirmation passes unchecked goods. The owner chose empty fields, every line checked. |
| Costing at posting when the draft is priced (ADR-0078 #3 as it was) | The owner wants the accountant's confirmation on every receipt; prices from the order are last prices, not the note's. |
| The amount check at the keeper's confirmation | The keeper sees the order's last prices, not the note's; the amount can only match once the accountant has the note's prices. |
| A NOSHELF bin only for order receipts | Shelves are not used at all today; every receipt should be sellable at once. |
| A foreign key from `goods_receipts` to the order | Inventory would depend on procurement against architecture §4; procurement holds the link (`purchase_order_suppliers.receipt_id`) and inventory tells it about progress through a hook. |

## Consequences

**Positive:**
- The real flow is in one place: order, print, arrival, scan against the order, each keeper's confirmation, the price check and the payable.
- A stale page never overwrites a colleague.
- Received goods are on sale at once.
- No payable exists without the accountant's confirmation.
- Every receipt's delivery note is reconciled in pieces and in amount.

**Negative:**
- Every receipt, including one typed by the accountant in the window, now needs the two steps: confirmation, then price check. It also needs the note's totals.
- A receipt spanning warehouses waits for the last keeper.
- A pending receipt's stock sits in the books at the provisional cost until the price check (as before, for unpriced receipts).
- Last month's outflow is read from the ledger on each grid page; it is cheap for one supplier's products but not cached.

**Follow-ups:**
- Trucks and kg fill (the next slice).
- The assistant's `ai.*` views for orders.
- Receiving in the staff app.
- The driver's fee in cost (accountant, TODO-VERIFY).

## Related

ADR-0027, ADR-0033, ADR-0034, ADR-0057, ADR-0058, ADR-0078, ADR-0091, ADR-0099, ADR-0103, `docs/workflows.md` §1, §3, §4, `docs/modules/procurement.md`, `docs/modules/inventory.md`, `docs/modules/finance.md`, architecture §4.
