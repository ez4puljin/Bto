# ADR-0099: The receipt window, improved: no warehouse on the receipt (each line in its product's home), a line panel above the table, the delivery note's discount, sale prices set by the posting, the last receipt price, printing and list filters

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-23 |
| Deciders | Owner, Claude (Claude Code session, started by «Bto удирдлага») |
| Amends | ADR-0078 (#6 one window: the warehouse field and the scan-to-shelf box are gone, the lines come from a panel; #7 the import's warehouse; #3 and #4 the costing takes the discount), ADR-0033 (#1 the receipt's warehouse becomes the line's; the home rule of #2 now picks the warehouse), ADR-0027 (the warehouse scope no longer limits receipts), ADR-0091 #3 and ADR-0097 #3 (the books take the costing net of the discount, their bindings unchanged), ADR-0048 (a price change from a receipt's posting) |

## Context

The owner (2026-10-23): «Орлого цонхыг сайжруулах» — no details, so seven rounds of questions came first, with a picture of Erkhet's «Бараа материал орлого» (header left, a one-line editor right — product, account, location, quantity, unit price, total, discount, weight — the lines below).

Interview answers (2026-10-23):

1. What gets in the way today: **a warehouse must not be chosen on a receipt; one receipt may hold goods of several warehouses**; adding goods is slow; editing a line is awkward; fields are missing; the list's search.
2. Who uses it: both the accountant (typing from the delivery note) and the warehouse (counting with a scanner).
3. What Erkhet does better: a one-line editing panel, fast keyboard entry, the previous price shown, printing.
4. Several warehouses: each line goes to **its product's home warehouse** (proposed and taken); **one number, one document** for the whole note.
5. Slow adding means: the name search answers slowly and shows too few matches (8), words in another order; mouse travel; choosing the box or the piece.
6. Missing fields: the last receipt price, the stock on hand, the sale price, the discount and the product code.
7. The line editor: **a panel above, the table below** (not Erkhet's side panel, not in-table editing).
8. The discount: **the whole delivery note's discount** (not per line).
9. The sale price: **shown and editable** by those who may change prices, **in force from the day the receipt is posted**; the receipt and sale prices compared as a percentage.
10. The previous price: **the latest receipt, from any supplier**.
11. The discount's form (% or amount, what it lowers): no preference → the proposal: a percentage or an amount, spread over the lines, lowering the cost and the payable.
12. The markup: **(sale − receipt) / receipt** (1,000 → 1,200 is 20%), with the receipt price **as typed on the note** (VAT included, before the discount), **always per piece**.
13. Who makes and posts a receipt of several warehouses: **anyone with the receipt right**.
14. A product without a home warehouse (63 in the real master): **the window asks for the warehouse and makes it the home**.
15. List filters: **a date range, the supplier, the product**; **the amount and the payment method** as columns.
16. The stock shown: **the home warehouse's**.
17. The import: **no warehouse in its dialog**; each row to its product's home.
18. Printing: **an A4 document with prices and signatures, with the total weight**, and **a list for the warehouse** (product, quantity, shelf), **one sheet per warehouse**.
19. Shelf scanning on the receipt: **not needed** — the fixed shelf, else the receiving area, then put-away.
20. Free goods: **kept**. A suggested sale price from a markup: **not needed**.

## Decision

1. **The warehouse is the line's.** `goods_receipt_lines.warehouse_id` (NOT NULL, migration `0038_receipt_window`, backfilled from the header, which loses `warehouse_id`). A line goes to its product's home warehouse, on the product's fixed shelf there, else that warehouse's RECEIVING bin; no shelf is chosen on a receipt any more. A product without a home takes the warehouse the line request names (`warehouseId`), which becomes its home in the same transaction (`ProductLocationsService.setHomeInTx`, audited); without one, 409 `PRODUCT_NO_HOME`. The posting re-checks each line against its product's home (`PRODUCT_NOT_IN_WAREHOUSE` when a home moved meanwhile) and posts each movement into its line's warehouse; the GR number stays one global series. The detail lists `warehouses`; the list's `warehouseId` filter means "has a line there".
2. **No warehouse scope on receipts.** Anyone holding `inventory.receipts.manage` creates, edits, posts and cancels any receipt; costing needs `inventory.costs.manage` as before; the accountants' «Өртөг хүлээгдэж буй» count is not narrowed by scope. Other warehouse documents keep ADR-0027's scope.
3. **The line panel and the reads behind it.** The window is the header, then a line panel, then the lines table (read-only cells; «Засах» or a click opens a line in the panel; its product and unit stay). The panel walks product → (home warehouse, only when missing) → unit → «Тоо» → «Нэгж үнэ» → «Шинэ зарах үнэ (ш)» by Enter and adds the line from the last field; «Дүн» and «Бонус» stay a Tab away; a scan anywhere on the page lands in it, the same code again counts one more; a product and unit already on the draft add to its line. Under the fields: the home warehouse and its stock, the last receipt price (unit and per piece, date, supplier), the sale price in force and the markup. New reads: `GET /products/lookup` (active products, the list's match and order, units and barcodes, no pictures, ≤ 30; the panel debounces 200 ms and shows 20) and `GET /receipts/last-prices` (cost holders: each product's newest posted priced line, any supplier, the latest costing's amount else the typed one, per entered unit and per base unit, before the discount).
4. **The delivery note's discount.** `goods_receipts.discount_pct` (0 < p ≤ 100) or `discount_amount` (> 0), never both; typed by cost holders on the draft and with the costing (`PUT /receipts/:id/costs` takes either; given, it replaces the receipt's). The discount in tugriks (a percentage of the priced lines' total, two decimals half up) is spread over the priced, non-free lines in proportion to their amounts, the rounding remainder on the largest line (`allocateReceiptDiscount`, `@tugeel/shared/inventory`); a discount above that total is 422 `RECEIPT_DISCOUNT_TOO_LARGE`. Each line's cost is `receiptLineCost(amount − share, rate)`: the VAT comes out of the net amount. Each costing version keeps the share (`stock_valuation_adjustments.discount_amount`) beside the typed `doc_amount`, so the books' payable is Σ (`doc_amount` − share) and the history explains itself; F3's bill and F4's stock postings read `bookFacts` and need no change.
5. **Sale prices from the receipt.** `goods_receipt_lines.sale_price`: a new warehouse price per base unit (whole MNT, VAT included), typed only by holders of `pricing.prices.manage` (403 otherwise; every user sees it). The posting puts each in force from its business date in the posting's transaction through inventory's new `RECEIPT_SALE_PRICES` hook, bound by pricing (`ReceiptSalePricesHook` → `ProductPricesService.setInTx`, the dated-row rules and lock order of `set`), keeping the profile and the whole pack of the terms in force that day; an equal price writes nothing; a product without terms in force is 409 `SALE_PRICE_NO_TERMS` (its first terms are set on the price page); two lines of one product with different prices are refused. Pricing gains `inventory` in its module dependencies for the token (no cycle). The markup shown is `(sale − receipt) / receipt × 100` per base unit, the receipt price as typed (`markupPct`).
6. **Printing** (browser, A4, ADR-0058): `/inventory/receipts/:id/print/document` — the note with its prices for cost holders, the discount, VAT, the payable, the total weight (Σ base quantity × `weight_kg`; lines without a weight named) and the signatures «Хүлээлгэн өгсөн», «Хүлээн авсан», «Нягтлан бодогч»; `/inventory/receipts/:id/print/warehouse` — one sheet per warehouse: shelf, code, product, unit, quantity and a «Тоолсон» box.
7. **The list and the import.** The receipt list filters by the delivery note's date range (else the posting's), the supplier, a product and a warehouse, and shows the payment method and, for cost holders, the payable (the latest costing's, else the typed prices less the discount). The `RECEIPTS` import's dialog names only the payment; each row goes to its product's home, a product without one is a row error `NO_HOME`; old jobs' stored warehouse is ignored.
8. **The assistant's views.** `ai.receipt_lines` takes the line's warehouse and adds `doc_amount` and `discount_amount`; `ai.stock_documents` gives a receipt a warehouse only when all its lines share one, `warehouse_name` listing them.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One receipt per warehouse made from one window | The owner chose one number and one document per delivery note; one payable per note keeps the books simple. |
| Choosing the warehouse per line | Each product has exactly one home warehouse it may be received into (ADR-0033 #2); asking would only allow mistakes. |
| Erkhet's side panel, or editing in the table | The owner chose the panel above the table. |
| A discount per line | The owner chose the whole note's discount; a per-line discount can still be typed as a lower price. |
| Storing net amounts in the valuation's `doc_amount` | The typed note would no longer be readable from the history; a separate share keeps both. |
| Inventory depending on pricing directly | The hook keeps inventory free of pricing and runs in the posting transaction, the pattern of `RECEIPT_MONEY_ACCOUNTS`. |
| Setting the sale price as soon as it is typed | The owner chose the posting day: a draft may wait, and an unposted receipt must not change the price list. |

## Consequences

**Positive.** A delivery note for several warehouses is one receipt; the line panel is keyboard-only and shows what the owner looked up in Erkhet; the discount reaches the cost and the payable; sale prices follow the purchase prices on the posting day; the warehouse gets a list per warehouse.

**Negative.** Receipts are no longer limited by warehouse scope; a product's home now decides where it is received, so a wrong home sends goods to the wrong warehouse (moved by a transfer); sale prices typed on a receipt change the price list when anyone posts it.

**Follow-ups.** Per-line discounts, landed costs and currency only if the owner asks. A suggested sale price from a target markup was declined.

## Related

ADR-0027, ADR-0033, ADR-0036, ADR-0048, ADR-0058, ADR-0078, ADR-0091, ADR-0097, ADR-0098, `docs/modules/inventory.md`, `docs/modules/imports.md`, `docs/modules/pricing.md`, architecture §4, §5.3.
