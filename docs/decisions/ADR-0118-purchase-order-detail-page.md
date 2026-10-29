# ADR-0118: The purchase order's detail page as in Butenorgil — seven supplier statuses with «Ачигдаж байна», every stage's columns on one page, the history screen, the order's Excel and archiving (slice 1b)

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-29 |
| Deciders | Owner (`docs/workflows.md` §7: a user guide of Butenorgil's «Захиалга» menu compared with slice 1, every item decided 2026-10-29), Claude (Claude Code session started by «Bto удирдлага») |
| Amends | ADR-0115 #1 (the statuses: SHIPPING comes back between SENT and IN_TRANSIT; `shipped_qty` on the lines; `archived_at` on the orders), #2 (the shipped quantities and the counts typed on the page, per role and stage), #3 (the grid becomes one table of every supplier, with the sales averages), #4 («Ирсэн» expects the shipped quantity; a line shipped as 0 is left out), #5 (a receipt line carries a `note`; a count may come as a base quantity) |

## Context

Slice 1 (ADR-0115) built purchase orders by supplier, but the work is spread over three places: the order grid (one supplier at a time), the keeper's receiving screen and the receipt window's price check. The owner wrote a user guide of Butenorgil's «Захиалга» menu (kept outside the repository) and compared it with slice 1. Already in Bto: suppliers with their own statuses and the lowest shown, the orderer, box ordering with stock / minimum / last price / estimated cost, the stale-page protection, the printed sheet, receiving against the order with «ирээгүй» and extra lines by scan, the accountant's price check with the previous price beside. Gone by design: Butenorgil's file imports, the live Erkhet stock and the ERP import.

The owner's main want: **Butenorgil's detail page** — one page per order with every supplier's products in one table and every stage's columns side by side, from ordering to the price check. The decisions of 2026-10-29 (`docs/workflows.md` §7, items 1–9) are the scope of this slice. Also decided there: no dashboard, no trucks and capacity (a slice of their own), no «Ороогүй бараа» basket dialog, no supervisor role or forced status jumps, no products of another supplier in a group, no store orders from suppliers.

## Decision

### 1. Seven statuses; the shipped quantities (migration `0055_po_detail`)

- A supplier inside an order moves PREPARING → SENT → **SHIPPING («Ачигдаж байна»)** → IN_TRANSIT → ARRIVED → ACCOUNTING → RECEIVED. The move rules stand: forward by a manager or the orderer, back by a manager up to and including «Ирсэн», the order's status the lowest of its suppliers (`lowestPoStatus`). The CHECKs of both status columns are rewritten; no data changes (SHIPPING is a new value).
- `purchase_order_lines.shipped_qty` NUMERIC(14,3), nullable, in the line's unit: what the supplier shipped. It is typed in SHIPPING only, by a manager or the supplier's orderer (`canShip`), as a `SHIPPED` cell of the same save (`PUT …/lines`, `GridChange.field`), against the value the page opened with (a conflict names the stored value; a product without a line is refused `NO_LINE`; a save of shipped cells in another status is 409 `PO_NOT_EDITABLE` with `reason: 'SHIPPED'`).
- Null means not typed: the receipt expects the ordered quantity. **0 means not shipped: the line is left out of the draft receipt.** A supplier whose every line is shipped as 0 cannot move to «Ирсэн» (`PO_SUPPLIER_EMPTY`).
- The ordered quantities stay editable until «Ирсэн» (`PO_EDITABLE_STATUSES` = PREPARING, SENT, SHIPPING, IN_TRANSIT) under ADR-0115 #2's rules; keepers still type only in «Бэлдэж», only their warehouse's products.

### 2. One table of every supplier, every stage side by side

`/procurement/orders/:id` is one table grouped by supplier (`GET …/suppliers/:supplierId/rows`, keyset pages of 200 per supplier, `?supplier=` and `?warehouse=` as filters, code / name search, «Захиалах ёстой», «Зөвхөн захиалсан» — on by default once the order is past «Замд»). Each group has a header row (name, status, «→ дараагийн шат», «N захиалаагүй», Σ pieces · kg, the orderer, the receipt, «Захиалгад байхгүй бараа нэмэх» at «Ирсэн», the delivery note's amount at «Нягтлан шалгаж») and a footer (pieces, kg, the estimated and the final amount, «N бараа дээр үнэ зөрсөн»). Receipt lines of products the order never listed come under the first page as `extra` rows with a «Захиалгад байхгүй» badge.

**Columns by group** (`PO_COLUMN_GROUPS`; hidden per user in the browser under `procurement.order` like ADR-0050; the groups the present stages type in — `requiredGroupsFor(statuses)` — cannot be hidden):
- `stock`: the home warehouse, on hand and the minimum as boxes · pieces of the ordered unit; a red «Захиалах» badge in the name cell below the minimum;
- `sales`: the **12-month average, the 3-month average, last month, the same month last year** — `StockQueryService.outflowByMonth` (inventory's ledger reader, grouped by the business month, the same movements as ADR-0115 #3) over the 12 calendar months before this one in Asia/Ulaanbaatar; averages are per calendar month, base units, shown as boxes · pieces;
- `order`: box size (the unit's factor), unit weight, the unit, **Захиалах** with pieces and kg computed, the last price and the estimated amount (price readers);
- `shipping`: **Ачигдсан** (#1);
- `receiving`: **Ирсэн as boxes × loose pieces**, the difference against the expected quantity, a **note** shown only on a difference (#3);
- `pricing` (cost holders): the unit price, the amount, the difference with «Хуучин» under it (#4).

Rows refresh only on the page's own saves or on «Дахин ачаалах»; the page polls `GET /purchase-orders/:id/version` (`updated_at` and the receipts' latest `updated_at`) every 30 s and shows the yellow bar «Өөр хэрэглэгч энэ захиалгыг шинэчиллээ» when the stamps moved past the ones it loaded with. One «Хадгалах (n)» sends every changed cell: per supplier one `PUT …/lines` (ordered and shipped cells), one `PUT …/arrivals` (#3) and one `PUT /receipts/:id/costs` (#4); conflicts and refusals are shown per cell, as before.

### 3. The counts on the page, written to the receipt lines

- `goods_receipt_lines.note` (text ≤ 500): the keeper's note on a difference.
- `ReceiptLinePatch` takes `arrivedQtyBase` (the count as a base quantity, boxes × pieces) and `note`; `PATCH /receipt-lines/:id` gains both, so the keeper's scanner screen and the order page write the same lines through `ReceiptsService.countLineInTx`. **When the base quantity does not divide by the line's factor, the line is counted in pieces**: it switches to the product's base unit (`factor_snapshot` 1), `expected_qty` is converted to base, `doc_unit_price` divided by the old factor (2 dp) and the amount recomputed, so `qty_base` is exact. The page always shows boxes × pieces from `qty_base` and the ordered unit's factor.
- `PUT /purchase-orders/:id/suppliers/:supplierId/arrivals` `{changes:[{lineId, arrivedQtyBase?, note?, previousArrivedQtyBase}]}` → `{applied, conflicts, refused}`: in «Ирсэн» only (409 `PO_NOT_EDITABLE`, `reason: 'ARRIVALS'`); each line by a manager, or by a receipt holder whose write scope holds the line's warehouse (`canCount`; else refused `SCOPE`); a confirmed warehouse's line is refused `CONFIRMED`; a stale count (the stored `qty_base` of a checked line, null while unchecked) is a conflict with the current count and note. The receipt is locked before the order, the order the confirmation hook takes.
- Inventory **audits draft edits of ORDER receipts** (`COUNT`, `LINE_ADD`, `LINE_REMOVE` on `goods_receipts`, with the line's facts), so the order's history is complete whichever screen typed the count; the COST audit's lines now carry `productId`.

### 4. The price check from the page

The accountant (`inventory.costs.manage`) types the unit price per line at «Нягтлан шалгаж»; the page reads `GET /receipts/:id/costing` and calls the existing `PUT /receipts/:id/costs` with the receipt's costing version, the typed prices, the other arrived lines at the price they carry, and the delivery note's amount when corrected. Version 1 makes the payable and moves the supplier to RECEIVED (ADR-0115 #7, unchanged). The detail reports per supplier the receipt's payable (`finalAmount`) and the lines priced differently from the product's previous price (`priceDiffCount`).

### 5. History, Excel, archiving

- `GET /purchase-orders/:id/history?userId&supplierId&productId&cursor&limit` (`procurement.orders.read`): a view over the audit rows procurement and inventory already write — `purchase_orders`, the order's `purchase_order_suppliers` rows, the suppliers' `goods_receipts` — read through identity's `AuditQueryService.entriesOf` (several records at once, keyset by id, a `productId` filter on the JSON), newest first, 100 a page, each row a kind of `PO_HISTORY_KINDS` (creation, note, suppliers, status, ordered / shipped / arrived quantity, line note, lines added or removed, the receipt's confirmations, posting and cancellation, prices, archiving) with who, when, the supplier, the product and «хуучин → шинэ». `GET …/history.xlsx` is the same rows as one sheet (exceljs). Screen: `/procurement/orders/:id/history`.
- `GET /purchase-orders/:id/export.xlsx`: supplier, code, name, warehouse, ordered (quantity, unit, pieces), shipped, arrived, difference, and for price readers the unit price and amount.
- `purchase_orders.archived_at` / `archived_by`; `POST /purchase-orders/:id/archive` and `/unarchive` (`Idempotency-Key`, managers) when the order is RECEIVED or nothing is ordered on any supplier (`PO_NOT_ARCHIVABLE` 409). The list hides archived orders unless `archived=true` («Архив» toggle); an archived order's suppliers cannot move.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The arrived count kept in the ordered unit with three decimals | 50 pieces of a box of 12 is 4.167 boxes: `qty_base` would round. Counting in pieces keeps the ledger exact. |
| Per-user column choices on the server | ADR-0050 chose the browser; the page reuses it with its own list key. |
| A WebSocket or a full refetch for the stale check | A 30 s poll of two stamps is enough; refreshing rows under a typing hand is what the owner refused. |
| A separate history table | The audit rows already hold every change; a view over them cannot drift from the truth. |
| A CANCELLED order status for archiving | Bto has none; an order with nothing ordered is archived as "cancelled". |

## Consequences

**Positive.** One screen per order from ordering to the payable; the keepers' and the accountant's typing sits beside the ordered quantities; every change is traceable; finished orders leave the list.

**Negative.** The rows carry more per request (sales months, receipt lines, costing); the page is wide (the column groups and the horizontal scroll of the list card answer that). A line counted with loose pieces changes its unit to pieces on the receipt.

**Follow-ups.** Trucks and kg fill (the next slice); the assistant's views for orders; receiving in the staff app, only on the owner's word.

## Related

ADR-0050, ADR-0058, ADR-0115, `docs/workflows.md` §7, `docs/modules/procurement.md`, `docs/modules/inventory.md`.
