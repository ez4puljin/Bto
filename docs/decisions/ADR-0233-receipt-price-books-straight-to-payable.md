# ADR-0233: Receipt pricing books straight to the payable

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-20 |
| Deciders | Owner («Тийм, устга», 2026-11-20: the clearing account 310201 «Нэхэмжлэл ирээгүй бараа» leaves the receipts), Claude (a brain task, `task/grni-off`) |
| Supersedes | The goods-received parts of ADR-0091 (the bill debits goods received) and ADR-0097 (a receipt's stock posting and its costing book against goods received) for goods receipts; amends ADR-0115 (the price check still makes the payable, now in one entry) |

## Context

Since F4 (ADR-0097) a receipt reached the books in pieces that met on 310201: its confirmation booked the stock at the provisional cost (Dr stock / Cr 310201), its costing `BTO/STOCK_REVALUE/<receipt>:<version>` the rest (Dr stock, Dr cost of goods sold / Cr 310201) on the costing day, and the supplier's bill `BTO/GOODS_RECEIPT/<receipt>` cleared it (Dr 310201, Dr input VAT / Cr payable) on the receipt's date. The costing and the bill always happen in one transaction, so 310201 only passed the amount through, and because their dates differed it showed a balance between them (GR-2026-000001, dated 11-17 and priced 11-20). The owner's flow is unchanged: a draft, the keeper's confirmation raises the stock (quantities only, the receipt «дутуу»), the price check makes the supplier's payable at once.

## Decision

1. **The first costing is one entry, the supplier's bill** `BTO/GOODS_RECEIPT/<receipt>` (document type `BTO.SUPPLIER_BILL`, unchanged): Dr INVENTORY, Dr COGS, Dr VAT_INPUT / Cr AP on the supplier (the receipt's own counter key when it names an account, ADR-0154; the open item due on the receipt's date, group `receipt:<id>`). COGS takes the costing's variance (`stock_valuation_adjustments.variance`: the part of the price difference that belongs to goods already sold); INVENTORY takes the costed value less that variance. The discount stays inside the costed values. With no payable (free goods only) and a stock movement, the same document is a journal (`BTO.RECEIPT_RECOST`).
2. **A later costing is one entry of the differences** `BTO/RECEIPT_RECOST/<receipt>:<version>`: the differences of INVENTORY, COGS, VAT_INPUT and AP between the two versions, a bill, a credit (settling the receipt's open bill) or a journal by the payable's direction as before.
3. **The date rule is the bill's existing one, kept (brain, 2026-11-20).** Both entries are dated the receipt's date as `ReceiptBookFacts.date` always gave it: the delivery note's date (`supplier_doc_date`) when the receipt has one, else the confirmation's business date (`effective_date`). It is not strictly the effective date: a note dated before the goods arrived dates the entry on the note's day. A re-costing's open item is due on that date too (before: the costing day). When that month takes no posting (closed, or missing behind a closed month), the entry's accounting date is the company's business date today and the document keeps the receipt's date; `FinReader.postingDate` reads the rule of `openPeriodInTx` before the posting, so a closed month never fails a costing.
4. **A receipt's confirmation books nothing.** `StockPostingService` no longer hands a receipt's ledger rows to `STOCK_BOOKS`, and `StockBooksService` ignores a RECEIPT line; no `STOCK_REVALUE` document is written and the hook's `stockRevaluedInTx` is gone. The posting key GOODS_RECEIVED, its rule and the account 310201 stay (history lines exist), and no receipt posts on them.
5. **The development re-post** books a costed receipt as the one bill at its latest costing (COGS = the variance of all its versions) and no longer re-books bills or writes costings.

### What the confirmation carried (the brief's question)

A receipt's stock rows are written without a unit cost whatever the draft's prices, its origin (the window, a purchase order, an import) or its discounts: only `ReceiptsService.post` writes RECEIPT rows, and it never passes `unitCost`. `StockPostingService` then values them at the product's average in that warehouse (ADR-0033's provisional cost). So the confirmation's value was zero only for a product with no average yet (GR-2026-000001) and `quantity × average` for every product bought before; the old code booked that against 310201 at the confirmation. Under this ADR that value is not booked at the confirmation: it enters INVENTORY inside the bill (the costed value less the variance already contains it).

## Consequences

**Positive.** A receipt is one line of history in the books: stock (and the cost of what was sold meanwhile) and VAT against the supplier, on the receipt's date. 310201 shows nothing for receipts.

**Negative.**
- Between the confirmation and the price check, INVENTORY is lower than the stock's value (Σ on hand × average) by the provisional value of the receipts waiting for prices, and a sale of such goods already credits INVENTORY at the average. `pnpm finance:reconcile` prints that value (`StockPostingService.unpricedReceiptValue`) beside the comparison. Before, 310201 held it.
- An entry dated the receipt's date can land days before it was made (as the bill always could).
- `StockBooks.stockRevaluedInTx` is removed from the hook and from finance.

**Receipts confirmed before this ADR.** The real system has none waiting (its only receipt, GR-2026-000001, was priced before this ADR and nets 310201 to zero); the rule below protects any other installation and the development data. One whose confirmation credited 310201 (`BTO/STOCK/GR:<id>:<first ledger row>` exists and is not reversed) and that is priced afterwards: its bill debits 310201 with that amount instead of debiting the stock twice, so the account returns to zero for it. Existing entries are neither rewritten nor reversed. Until such a receipt is priced, `pnpm finance:reconcile` takes its provisional value off the stock's value although the books already hold it, so the printed difference is off by that value; the line says so. A receipt costed before this ADR and costed again after it books its difference the new way; its earlier entries had already cleared 310201.

## Related

ADR-0033, ADR-0091, ADR-0097, ADR-0115, ADR-0154, ADR-0206.
