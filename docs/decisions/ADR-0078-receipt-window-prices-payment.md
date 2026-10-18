# ADR-0078: The goods receipt as one delivery-note window: prices typed on the draft, VAT taken out for VAT-paying suppliers, costed at posting when priced in full, the payment method kept for the books, delivery notes imported from a sheet

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0033 (#3: a receipt priced in full is costed in its posting transaction; #4: the costing amounts are the delivery note's, VAT included, and the cost is the amount less its VAT; #8 still holds: prices are cost data), ADR-0036 (an import job carries the options its dialog chose; a seventh kind `RECEIPTS`), ADR-0047 #6 (a new receipt opens as a page, not a dialog), architecture §4 (inventory asks finance for money accounts through a hook) |

## Context

The owner (2026-10-18): «Агуулах - Орлого цонхийг эрхэт шиг болго», with a picture of Erkhet's «Бараа материал орлого»: the document's header on one side (number, date, supplier, description, counter-account, VAT and city-tax flags, currency, landed costs) and one line at a time on the other (item, account, location, quantity, unit price, total, weight, discount, pack-breaking), the lines below. Bto's receipt so far was two steps (ADR-0033): the warehouse counted and posted at a provisional cost, the accountant typed the costs on another form afterwards. A read-only study of Erkhet (tmp/erkhet-study, 2026-10-17/18) showed that 70 of the company's last 100 Erkhet imports were receipts.

Interview answers (2026-10-18): one window with the price optional; no discount, landed costs, city tax, currency or pack-breaking; the payment account / payable and an Excel import are wanted; Erkhet's structure in Bto's style; prices as printed on the delivery note with the VAT taken out automatically for a VAT-paying supplier (no VAT field on screen); the import has many delivery notes in one file, its warehouse and payment chosen in the import dialog, the receipts arriving as drafts; prices seen and typed only by cost holders; «Огноо» is the delivery note's date. The payable and its journal entry belong to the Finance Core (ADR-0069 … ADR-0077, worktree `finance-core-architecture`): the owner chose to keep the payment facts on the receipt now and let the core book them.

## Decision

1. **Suppliers say whether they pay VAT.** `suppliers.vat_payer` (default no), on the supplier form and the supplier import (`vatPayer`: «Тийм» / «Үгүй»). A receipt freezes `vat_rate_pct`: the company's VAT rate on the delivery note's date when the company and the supplier both pay VAT, else 0; recomputed when a draft's supplier or date changes, frozen by the posting. A line's rate is the receipt's for a product that carries VAT (`VAT_ABLE`), 0 for an exempt one.
2. **Prices on the draft.** `goods_receipt_lines.doc_unit_price`, `doc_amount` (NUMERIC 14,2, the delivery note's figures, VAT included as printed) and `free_goods`. The figure typed last is the source: a price per unit makes the amount `round(price × entered qty, 2)` and follows a later quantity change; an amount stays as typed; free goods carry no price; null clears. Only a holder of `inventory.costs.manage` types them or sees them (403 `FORBIDDEN` otherwise; the cost-free DTO has no price key).
3. **A receipt priced in full is costed at posting.** When every line has an amount or is free, the posting, in its transaction, posts at the provisional cost as before (ADR-0033 #3) and then writes costing version 1 through `StockPostingService.revalue` with each line's cost `receiptLineCost(doc_amount, line rate)` = the amount less `receiptLineVat` (`amount × rate / (100 + rate)`, two decimals half up, per line) — the coverage rule and the append-only history unchanged — and marks the receipt COSTED. Otherwise it stays PENDING and the accountant prices it later on the same window, the typed prices filled in.
4. **The costing takes delivery-note amounts.** `PUT /receipts/:id/costs` amounts and unit prices are the delivery note's (VAT included); the service takes the VAT out at the receipt's frozen rate. `stock_valuation_adjustments.doc_amount` (new, nullable) keeps what was typed; `amount` stays the ex-VAT cost. For the books per receipt: the payable is Σ `doc_amount`, the input VAT Σ `receiptLineVat`, the stock Σ `amount`, from the latest valuation version.
5. **The payment is a fact of the receipt.** `goods_receipts.payment_method` CREDIT (default, a payable) | CASH | BANK and `money_account_id` (no foreign key: inventory cannot depend on finance). Inventory declares `RECEIPT_MONEY_ACCOUNTS` (`inventory/hooks.ts`: `active`, `assertUsable`); finance binds it with `useExisting` (`ReceiptMoneyAccountsService`), the sales-hook pattern of ADR-0060 #1. CREDIT names no account; CASH and BANK may name one of their kind on the draft and must at posting. `GET /receipts/payment-accounts` lists them. Nothing is booked here: no payable, voucher or journal entry until the Finance Core's payables and inventory postings (ADR-0077).
6. **One window.** `/inventory/receipts/new` and `/inventory/receipts/:id` show the same page: the delivery note's header on top (date, supplier, note number, warehouse, description, payment and account), the line entry with the scanner as before (shelf labels, barcodes, «Тоо», product search) plus a unit price for cost holders, the lines table (product, unit, shelf, quantity, and for cost holders unit price, amount, free goods), the totals with VAT, then «Батлах». A new receipt is created by its first line (or «Хадгалах»); `?new=1` goes to the page. A posted receipt shows the same page read-only, its prices editable by cost holders until the re-costing deadline.
7. **Delivery notes from a sheet.** A seventh import kind `RECEIPTS` (columns: date*, supplier* by code or name, note number, product code or barcode — a box barcode counts boxes —, unit, qty*, unit price). The import's dialog names a wholesale warehouse the user writes for and the payment (method and account), stored in `import_jobs.options`. Rows of one date, supplier and note number make one DRAFT receipt (≤ 500 lines) on the product's fixed shelf, else the receiving area, under the home-warehouse rule; prices are taken only when the user holds the cost right (else a warning `PRICE_IGNORED`). The commit creates the drafts in one transaction; the revert cancels them while every one is still an untouched draft, otherwise `IMPORT_REVERT_BLOCKED`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Copy Erkhet field for field (counter-account, VAT and city-tax blocks, currency, landed costs, discount, weight, pack-breaking, one line at a time in a side panel) | The owner chose none of those fields; one editable lines table with the scanner is faster than Erkhet's one-line editor. |
| A VAT field and a VAT-included switch on each receipt | The owner wanted no VAT field; the supplier's VAT status decides it every time, and the totals show the VAT. |
| Cost at the typed price through the ledger's unit cost (`Movement.unitCost`) | The ledger keeps four decimals and the valuation history would miss version 1; posting then revaluing keeps one costing path and its history. |
| Book the payable and the entry from the receipt now, in Finance I | The Finance Core (ADR-0069 … ADR-0077) redraws payables as open items with posting rules; booking here first would have to be migrated. |
| A money-account foreign key on the receipt | Inventory would depend on finance against architecture §4; the hook checks the account in the same transaction. |

## Consequences

**Positive.** The warehouse's count and the delivery note's prices meet on one page; a priced receipt is costed the moment it posts; the books later find the payable, the input VAT and the stock on each receipt; the most common Erkhet import has its Bto equivalent.

**Negative.** Suppliers must be marked as VAT payers before their prices are typed (default no); a cost holder must type the prices for an immediate costing (warehouse staff cannot); a receipt's payment account is checked through a hook, not by the database.

**Follow-ups.** The Finance Core books the payable / voucher and the stock entry from these facts (ADR-0077, D8). The owner marks the VAT-paying suppliers (supplier page or the supplier import's new column). Landed costs, currency and discounts only if the owner asks.

## Related

ADR-0033, ADR-0036, ADR-0047, ADR-0060, ADR-0069, ADR-0077, `docs/modules/inventory.md`, `docs/modules/imports.md`, `docs/modules/partners.md`, architecture §4, §5.3.
