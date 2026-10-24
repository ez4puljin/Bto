# ADR-0108: Management reports: the `reporting` module, daily sales totals refreshed every 15 minutes, five reports with Excel, print and drill-down

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-24 |
| Deciders | Owner (three interview rounds, 2026-10-24, through «Bto удирдлага»), Claude (Claude Code worker session, management reports) |
| Implements | SPEC §5.14 (`reporting`, pulled forward from delivery 10), architecture §4 row `reporting` |
| Amends | ADR-0042 / `docs/ui.md` (a chart library, Recharts, is now part of the web kit) |

## Context

The owner wants management reports from Bto's own data, in priority order: an executive dashboard «Захирлын самбар», receivables aging, profitability, stock turnover with slow movers, and a supplier report. Each report needs a screen view, an Excel export and a print, and every figure must lead to its documents. The `reporting` module of delivery 10 (SPEC §5.14) did not exist; the architecture already reserved it: SQL views and materialized views, a `reporting.refresh` job, `/reports/*`, reads every Bto table, reads schema `fin` only through views, never writes, imported by nobody.

Real sales, stock and finance documents are still few, so the reports are proven on fictitious data in tests.

The owner answered (2026-10-24):
1. All five reports in one pull request.
2. «Борлуулалт» counts the wholesale invoices and the supermarket's till, without VAT and city tax, net of returns; wholesale and the supermarket are also shown apart.
3. Margins under 8 % are flagged red, one threshold the admin can change.
4. Charts with the Recharts library.
5. Two new rights: «Тайлан харах» and «Өртөг, ашиг харах»; ADMIN and the accountant hold both, the admin grants them to others.
6. The daily totals are rebuilt every 15 minutes, with a «Шинэчлэх» button and the time of the last rebuild on screen; aging is always live.
7. A rep is the order's author (a rep or an office user); «Bto300» orders and the supermarket are rows of their own.
8. Aging counts the days past the due date set by the settlement days (ADR-0101): «Хугацаа болоогүй», 1–30, 31–60, 61–90, 90+.
9. A slow mover is in stock but not sold for 90 days; 30, 60 and 180 can be chosen.
10. Purchases are shown with VAT, at the delivery notes' amounts, so that purchases − payments ≈ the payable; the amount without VAT stands beside it.
11. The dashboard compares the same days: 1–24 October against 1–24 September and 1–24 October last year; an ended month compares whole months.
12. A category's margin «fell» when it is under 8 % this month or 3 points below last month.

## Decision

1. **The module.** `apps/api/src/modules/reporting/` (MODULE_DEPS `identity`; ESLint lets it import every `schema.ts`; nobody imports it). It reads other modules' tables in SQL and schema `fin` only through views of schema `reporting`, which a migration defines (only migrations name a `fin` relation, `tools/finance-core/fin-sql.test.mjs`). It never writes a business table.
2. **Schema `reporting` (migration `0046_reporting`, owned by migrator; app gets USAGE, SELECT and EXECUTE on the refresh function; ai_reader nothing):**
   - `reporting.sales_lines` (view): every sold line with its document — issued invoices (+), credit notes (−), till sales (+) and returns (−), and a re-costing's variance on goods already sold (`stock_valuation_adjustments.variance`, cost only). Sales are the line total − VAT − city tax. The cost is what the stock ledger booked out: an invoice line takes its share of its order line's `DELIVERY_ISSUE` rows, a credit note line and a till line their own rows (found by the ledger's unique index `(doc_type, doc_line_id, …)`). The rep is the order's author, none for `CUSTOMER_APP` orders and the till.
   - `reporting.mv_sales_daily` (materialized): `sales_lines` summed by day × source × channel × warehouse × customer × product × rep, with the branch and the product's category; a `row_key` column carries the unique index `REFRESH … CONCURRENTLY` needs (it refuses expression indexes).
   - `reporting.refresh_sales()` (SECURITY DEFINER, owner migrator): one run at a time (`pg_try_advisory_xact_lock`), rebuilds the view concurrently and writes `reporting.refresh_state` (one row: `refreshed_at`, `duration_ms`). app can call it but cannot refresh or write anything itself.
   - Live views over the Finance Core: `reporting.ar_open_items` (the receivables' open items with the customer, the due date and the document), `reporting.ap_entries` (the payables by journal entry and supplier: `amount` + raises the payable, `vat_amount`, `kind` PURCHASE / OPENING / PAYMENT / OTHER_BILL, a reversal keeping its original's kind), `reporting.control_daily` (the receivable and payable accounts' movement by day, for balances on past dates).
3. **Refresh.** The pg-boss job `reporting.refresh` runs every 15 minutes (cron `*/15 * * * *`, Ulaanbaatar time, the scheduled queue policy). `POST /reports/refresh` («Шинэчлэх») rebuilds unless the totals are younger than a minute. Aging, the supplier report, the dashboard's receivables and stock read live.
4. **The reports (`/api/v1/reports/*`, each with an `.xlsx` twin built by `tableWorkbook`):**
   - `dashboard?month=` — sales (wholesale, supermarket, returns), gross profit and margin, receivables at each period's end and overdue today, the stock value (live, or from `stock_snapshot_daily` for past dates within a week of the date) and turnover days (average stock value over the period × days ÷ the period's cost), each for the period, the same days a month earlier and a year earlier; the 12-month trend with last year's months; top-level categories with this and last month's margins; alerts: the five most overdue customers, the lowest stock under its minimum (as `ai.low_stock`), the falling-margin categories, the top order author by wholesale sales and their share.
   - `aging` (+ `aging/:partyId/items`) — per customer the open debit items in the five buckets by days past due, the open credit items (advances, unapplied payments) apart and netted in the total; filters: settlement group, search, overdue only. The items link to their Bto invoice.
   - `profit?by=customer|product|category|rep` — sales, returns, cost, profit, margin and the flag under the threshold, from the daily totals, filtered by source, customer, product, category subtree, author or «Bto300»; at most 2,000 rows and the rest summed. `sales-documents` returns the documents behind any figure (newest 500), live from `reporting.sales_lines`.
   - `stock?slowDays=` — per product the stock today, its value, the base units sold in the last `slowDays` days, the days of cover at that pace, the last sale and the days since, the slow and low flags; filters: all / slow / low, warehouse, category, search; 200 a page with «load more».
   - `suppliers` (+ `suppliers/:partyId/entries`) — per supplier purchases with and without VAT, other bills, payments and the balance at the period's end, the largest first; the entries link to their goods receipt.
5. **Rights.** `reports.view` («Тайлан харах») reads the dashboard, aging, stock and the documents; `reports.margins.view` («Өртөг, ашиг харах») adds costs, profit, margins and stock values, and alone opens the profitability and supplier reports (purchase amounts are costs). Without it the API leaves those fields out (null). ADMIN holds both through `PERMISSIONS`; ACCOUNTANT gets both; OFFICE and the other roles get neither.
6. **The threshold** is the effective-dated setting `reports.margin_threshold_pct` (percent, default 8), changed on «Систем → Тохиргоо».
7. **The web.** A menu group «Тайлан» with the five pages, filters in the URL, Excel downloads, A4 print pages in `PrintFrame`, drill sheets from rows to documents, a phone layout of one column for the dashboard. Charts use **Recharts 3.10.1** (released 2026-07-25, React 19 peer, pinned exactly with `react-is` 19.2.3), coloured only from the design tokens.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Live queries over the documents for every figure | The dashboard sums a year and more of lines on every load; SPEC §5.14 asks reports to read snapshots and materialized views. The live view stays for the drill-down only. |
| A summary table maintained by triggers or incrementally by the job | More code and more ways to drift; a concurrent refresh of the whole view takes seconds at today's volume. Revisit when a refresh passes a minute (the state row records the duration). |
| A nightly refresh only | The owner wants today's sales on the dashboard. |
| Reading `fin.*` from the module through `FinReader` | `reporting` imports only `identity`; the architecture's rule is views (`ai, reporting --SQL views only--> fin`). |
| Hand-drawn SVG charts | The owner chose a library; Recharts is the common React choice and needs no canvas. |
| One right for everything | Costs and margins are confidential (warehouse staff never see costs, ADR-0033 #8). |

## Consequences

**Positive.** One fast source for every sales figure, rebuilt every 15 minutes; the reports agree with each other because they share `sales_lines`; the owner and the accountant see margins, other staff can be given the reports without costs; every figure leads to its documents.

**Negative.**
- Sales figures can be up to 15 minutes old (the time is shown; «Шинэчлэх» rebuilds).
- A product's category is taken at refresh time, so a moved product moves its history.
- The stock value a month or a year ago needs the nightly snapshot (kept 13 months); without one the figure is empty.
- A migration that changes a column the views use must recreate them (and the materialized view) in the same migration.
- Unpriced receipts are not purchases until they get their prices (the supplier's bill, ADR-0091).

**Follow-ups.** The delivery performance and VAT summary reports of SPEC §5.14 come with their modules; an incremental refresh if the duration grows; per-category thresholds if the owner asks.
