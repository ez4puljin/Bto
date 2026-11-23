# ADR-0241: «Ашгийн самбар» counts the discounts of «НӨАТ хасуулах» by their documents, once

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-23 |
| Deciders | Owner (2026-11-23: the board counts the waiver discounts by their documents, once, as a step lowering the operating profit; an information card of the sales that took no VAT receipt; the VAT of such sales is not added to profit), Claude (a brain task, `task/board-vat-waiver`) |
| Extends | ADR-0238 (the board's figures from the books), ADR-0240 («НӨАТ хасуулах») |

## Context

A waiver (ADR-0240) is a discount given after the invoice. It never touches `invoice_lines`, so the board's net sales (`reporting.mv_sales_daily`) do not see it. Its debit goes to the customer's counter account: 520201 «Борлуулалтын хөнгөлөлт» by default — the sales row, which the board deliberately never reads from the books (ADR-0238 #3) — or any plain account the owner set on the customer (ADR-0240 #7): a class-7 expense account would land in the board's expense tree, an ASSET, LIABILITY or EQUITY account nowhere (`reporting.ledger_lines` carries only INCOME and EXPENSE lines). So until now a waiver lowered the board's profit only when its account happened to be an expense, and then as an operating expense.

## Decision

1. **By the document, once.** The board takes the period's waiver discounts from the books by their document (`source_doc_type = 'VAT_WAIVER'` in `reporting.ledger_lines`, the counter account's line; the receivable line is an ASSET line the view never carries): `+amount` on an EXPENSE account, `−amount` on an INCOME one. The core's REVERSE copies the original's source onto the mirror document, so a reversal nets out on its own entry date, as the books have it. When the counter account is neither INCOME nor EXPENSE the view drops the line, and the waiver's own row (`public.vat_waivers`, read in SQL as the module reads other modules' tables) stands in: `amount` on `waiver_date` (the entry's date), `−amount` on the Ulaanbaatar date of `reversed_at` (the reversal is posted that business day). The two parts split by the account's present kind, so no waiver counts in both. No migration and no view changed.
2. **Never twice.** Those documents' lines are left out of the expense tree, the other income, the tax and the expense entries, whatever the account; the tree's total stays «Урсгал зардал».
3. **A step of its own.** `results.*.vatWaiverDiscounts`, «Борлуулалтын хөнгөлөлт (НӨАТ-ын оронд)»: operating profit = gross profit + supplier discounts + other income − waiver discounts − operating expenses; net profit = operating profit − tax; the trend's net profit the same. The three periods and both comparisons as the other results; null under a source filter like the rest of the books; a branch counts its own lines (the invoice's branch). The sales, cost and gross profit stay the sales lines' (they still equal `reports/profit`). The waterfall shows the step between «Бусад орлого» and «Урсгал зардал» when the period or a comparison has any.
4. **The information card** «НӨАТ аваагүй борлуулалт» (`vatWaived`), read live: the POSTED waivers dated in the current period — the number of sales, their invoices' total (VAT included), the VAT inside them (`invoices.vat_total`), the discount given — and, as «Тухайн үеийн борлуулалтаас НӨАТ аваагүй нь», one population on both sides: of the period's invoices by invoice date (not VOID, `wholesaleTotal`), the total of those waived now — a POSTED waiver, whatever its date (`wholesaleWaived`) — in percent of all of them, so it never exceeds 100 %. Not added to or taken from any profit figure. Shown under «Бүх» and «Бөөний», null under «Супермаркет» (a waiver belongs to a wholesale invoice).
5. **The VAT of such sales is not added to profit.** Whether it is to be treated differently stays the owner's and the accountant's later decision (ADR-0240 #3, TODO-VERIFY); the card only shows it.

## Consequences

- The board's figures without a waiver are unchanged.
- A counter account whose kind is changed after waivers were posted moves those waivers between the two reads together (both use the present kind), so they still count once.
- The stand-in date of a reversal is `reversed_at` in Ulaanbaatar; the reversal's own entry is dated the business date of the same moment.
- The card's count, total, VAT and discount follow the waiver's date (a waiver made in the month after its sale counts in the month it was made), while its share follows the invoices' date: a month's share can rise later when its invoices are waived afterwards.

## Tests

`apps/api/test/integration/reporting-vat-waiver.int-spec.ts`, the changed shape in `reporting-expenses.int-spec.ts`, `apps/web/src/features/reports/profit-board-page.test.tsx`.
