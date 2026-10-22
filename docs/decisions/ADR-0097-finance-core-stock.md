# ADR-0097: The Finance Core's stock and cost (F4): every stock posting books its value, unpriced receipts through goods received, each expense type its account

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-22 |
| Deciders | Owner (one round of defaults and the plan, 2026-10-22; the accountant's D8 not answered yet), Claude (Claude Code session, Finance Core F4) |
| Implements | ADR-0083 #3 (phase F4), ADR-0077 (cost of goods sold and the inventory postings before go-live), ADR-0072 #1, #2 (JOURNAL documents through the intake with durable source keys) |
| Amends | ADR-0091 #3 (the receipt's bill and its re-costing differences debit goods received, not the stock: the receipt's posting and its costings book the stock since F4), ADR-0033 (a costing's variance — goods already gone — reaches the books as cost of goods sold) |

## Context

After F3 only supplier bills and supplier returns touched the stock account. The cost of goods sold, write-offs, adjustments, stocktakes and the till's cost were nowhere in the books, and an F3 bill debited the stock with the full cost although part of a receipt may already have been sold (the costing's variance). Erkhet stops at go-live, so the books must follow the stock. The accountant has not answered D8; on 2026-10-22 the owner chose the defaults:
1. **Per document, at once** (as seen in Erkhet), not a daily batch.
2. **An unpriced receipt enters the books at once at its provisional cost**, against a clearing account «Нэхэмжлэл ирээгүй бараа»; the bill clears it.
3. **Each goods-issue expense type has its own account** (temporary accounts the accountant re-points).
4. **Shortages, damage and expiry are an expense; surpluses an income.**

## Decision

1. **Chart.** Eleven roles and keys with temporary accounts (TODO-VERIFY D8, D16): `GOODS_RECEIVED` 310201 «Нэхэмжлэл ирээгүй бараа», `COGS` 610101, `STOCK_LOSS` 740201, `STOCK_GAIN` 511030, `OPENING_STOCK` 390101 (the opening stock's offset, cleared by F5's opening import), and `ISSUE_INTERNAL` 730201, `ISSUE_BONUS` 730202, `ISSUE_MARKETING` 730203, `ISSUE_WRITE_OFF` 730204, `ISSUE_TRANSFER_OUT` 730205, `ISSUE_OTHER` 730209 (an admin-added type, or the SUPPLIER_RETURN type issued to a non-supplier). The accountant moves any of them on «Данс». One document type `BTO.STOCK_VALUE` (JOURNAL), numbered by the core from the series `STOCK` `Б-{year}{month}{day}-` (TODO-VERIFY). Migration `0037_fin_stock` (data only).
2. **One hook at the source.** `StockPostingService.post`, after the documents are finished, groups the rows it wrote by document and values them with the ledger's own costs (`valueOf(qty, unit cost)`); inventory's `STOCK_BOOKS` hook (bound by finance's `StockBooksService`) books each document in the same transaction as `BTO/STOCK/<docType>:<docId>:<first ledger row>`: the change of INVENTORY against the kind's account —
   - RECEIPT → GOODS_RECEIVED; a sale (DELIVERY_ISSUE, POS_SALE) and a sales or till return (RETURN_IN) → COGS;
   - ADJUSTMENT by its reason: DAMAGED / EXPIRED / SHORTAGE → STOCK_LOSS, SURPLUS and the till's POS_SHORTFALL → STOCK_GAIN, OPENING / OPENING_REVERSAL → OPENING_STOCK; COUNT_CORRECTION by its sign;
   - GOODS_ISSUE → its type's account; **an issue to a supplier books nothing here** (F3's AP credit takes the stock out);
   - transfers, picks, put-away and bin moves are value-neutral; a remainder (rounding) goes to LOSS / GAIN. A document worth nothing books nothing.
3. **A receipt's costing** (`StockPostingService.revalue`) books `BTO/STOCK_REVALUE/<receipt>:<version>`, dated the costing day: what moved the stock's value (absorbed) on INVENTORY, what had already left (the variance) on COGS, against GOODS_RECEIVED.
4. **F3's bill clears goods received.** The bill and the re-costing differences debit GOODS_RECEIVED with the cost; the supplier return still credits INVENTORY. Per costed receipt, GOODS_RECEIVED nets to zero; while a receipt waits for its price it holds the provisional value.
5. **The check.** `pnpm finance:reconcile` prints the stock's value (Σ on hand × average, rounded) against the INVENTORY account (information: the averages' four decimals leave cents). The core's `postingKeyBalances` reads an account by its key.
6. **Development re-post.** `pnpm finance:repost-journal` reverses an F3 bill that debited the stock and books it again (revision 2) on goods received, then books the stock ledger's history (one posting at a time) and the receipts' costings, skipping what the books hold.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One cost-of-goods-sold entry per warehouse and day | The owner chose per document; the stock account would lag inside a day. |
| Book receipts only with their bill (F3 as it was) | The stock account would miss pending receipts and keep the variance of goods sold before the price; the owner chose the clearing account. |
| Each caller (sales, POS, finance's credit notes, inventory) books its own cost | Five places to keep right; `StockPostingService` is where every value is known. |
| One account for every expense type | The owner chose one per type. |
| Inventory per branch or warehouse | Not asked; one INVENTORY account, a branch split later if the accountant asks. |

## Consequences

**Positive.** The stock account follows the stock's value; goods received shows what is received but not billed; the cost of goods sold, losses, gains and expense types are in the books the moment they happen; a costing's variance is no longer lost.

**Negative.** Every stock posting writes one more journal entry; a finance refusal (an unmapped key) stops a stock posting, as it stops a sale (a till's sale is parked); the accounts are temporary until D8 and D16.

**Follow-ups.** The accountant answers D8 (the accounts, returns at original or current cost, the variance's period) and D16 (the chart). F5's opening import offsets OPENING_STOCK with Erkhet's inventory balance. An admin-added expense type shares ISSUE_OTHER until a per-type mapping screen is wanted.

## Related

ADR-0033, ADR-0072, ADR-0077, ADR-0078, ADR-0081, ADR-0083, ADR-0091, `docs/modules/finance-core.md` §3.10, `docs/modules/finance.md`, `docs/modules/inventory.md`.
