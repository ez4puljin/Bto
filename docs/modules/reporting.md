# Module `reporting` — contract

Status (built 2026-10-24, ADR-0108): the management reports — «Захирлын самбар», receivables aging, profitability, stock turnover and slow movers, the supplier report — on screen, in Excel and in print, with drill-down to the documents. Read only; imported by nobody (ESLint, §3.1 rule 4). Depends on `identity` (rights, settings) and reads other modules' tables in SQL; schema `fin` only through the views below.

## 1. Owner's answers behind the design (2026-10-24, three rounds)

- All five reports in one pull request.
- Sales = wholesale invoices + the supermarket's till, without VAT and city tax, net of returns (credit notes, till returns); wholesale and the supermarket also apart.
- A margin under 8 % is red (`reports.margin_threshold_pct`, admin-editable).
- Recharts for the charts.
- Two rights: «Тайлан харах» `reports.view`, «Өртөг, ашиг харах» `reports.margins.view`; ADMIN and ACCOUNTANT hold both.
- The daily totals refresh every 15 minutes, plus «Шинэчлэх»; aging live.
- A rep is the order's author; «Bto300» orders and the supermarket are rows of their own.
- Aging by days past the due date (the settlement days, ADR-0101): not due, 1–30, 31–60, 61–90, 90+.
- A slow mover is in stock and not sold for 90 days (30 / 60 / 180 selectable).
- Purchases with VAT at the delivery notes' amounts; the amount without VAT beside it.
- The dashboard compares the same days a month and a year earlier; an ended month compares whole months.
- A category's margin «fell» under 8 % or by 3 points against the month before.

## 2. Owned objects (migration `0046_reporting`, schema `reporting`, owner migrator)

| Object | Kind | What it holds |
|---|---|---|
| `reporting.sales_lines` | view | Every sold line with its document: `doc_kind` INVOICE / CREDIT_NOTE / POS_SALE / POS_RETURN / COST_ADJ, `doc_id`, `doc_number`, `order_id`, `day`, `source` WHOLESALE / POS / COST_ADJ, `channel`, `warehouse_id`, `customer_id`, `product_id`, `rep_user_id`, `qty_base`, `net_sales` (total − VAT − city tax, negative for returns), `cost` (from the stock ledger), `returns` |
| `reporting.mv_sales_daily` | materialized view | `sales_lines` by day × source × channel × warehouse × customer × product × rep, with `branch_id`, `category_id`, `row_key` (the unique index for `REFRESH … CONCURRENTLY`), `line_count` |
| `reporting.refresh_state` | table (one row) | `refreshed_at` (the totals are as of), `duration_ms`; written only by the function |
| `reporting.refresh_sales()` | function, SECURITY DEFINER | One run at a time (advisory lock; a second caller gets NULL), refreshes the view concurrently, writes the state |
| `reporting.ar_open_items` | view over `fin` | Open receivable items: company code, party, `customer_id` (from `party_refs` `customer:<id>`), side, item and due dates, amounts, the document and its source |
| `reporting.ap_entries` | view over `fin` | Payable movement per journal entry and supplier: `amount` (+ raises the payable), `vat_amount` (the entry's VAT_INPUT), `kind` PURCHASE / OPENING / PAYMENT / OTHER_BILL (a reversal keeps its original's), the document and its source |
| `reporting.control_daily` | view over `fin` | Debit − credit per day on the RECEIVABLE and PAYABLE accounts |

Grants: app USAGE on the schema, SELECT on every object, EXECUTE on `refresh_sales()`; nothing else (it cannot refresh or write). ai_reader nothing.

A migration that changes a column these objects use recreates them (the materialized view after its view) in the same migration.

## 3. Public API

`index.ts` exports only `ReportingHttpModule` and `ReportingWorkerModule` (the composition roots).

Services (module-internal): `ReportContext` (today, company code, threshold, margins flag), `RefreshService`, `DashboardService`, `AgingService`, `ProfitService` (also the documents), `StockReportService`, `SupplierReportService`; `report-periods.ts` (`monthPeriods`, `trailingMonths`, `checkedRange`), `report-sql.ts`, `report-workbooks.ts`.

Job: `reporting.refresh`, cron `*/15 * * * *` (Ulaanbaatar time), the scheduled queue policy.

## 4. REST surface (`/api/v1/reports`, rights in brackets)

| Route | Right | Notes |
|---|---|---|
| `GET refresh-state`, `POST refresh` | reports.view | «Шинэчлэх» rebuilds unless the totals are younger than a minute |
| `GET dashboard?month=` (+ `.xlsx`) | reports.view | Default month: the current one; a later month is 422 |
| `GET aging?settlementGroup&q&overdueOnly` (+ `.xlsx`), `GET aging/:partyId/items` | reports.view | Live |
| `GET profit?by=customer\|product\|category\|rep&from&to&source&customerId&productId&categoryId&repUserId&app` (+ `.xlsx`) | reports.margins.view | 2,000 rows, the rest in `others` |
| `GET sales-documents?…` (the same filters) | reports.view | Newest 500, `more`; costs null without margins |
| `GET stock?slowDays&filter&warehouseId&categoryId&q&offset&limit` (+ `.xlsx`) | reports.view | `slowDays` 30 / 60 / 90 / 180; the Excel holds up to 30,000 products |
| `GET suppliers?from&to&q` (+ `.xlsx`), `GET suppliers/:partyId/entries?from&to` | reports.margins.view | Purchases are costs |

Without `reports.margins.view` every cost, profit, margin and stock value comes back null.

## 5. Rules worth knowing

- Sales and cost of a period come from `mv_sales_daily` (up to 15 minutes old); aging, the supplier report, the dashboard's receivables, stock value and low stock read live.
- An invoice line's cost is its share of what its order line booked out (`DELIVERY_ISSUE`, by base quantity); a credit note's and a till line's cost are their own ledger rows (`RETURN_IN`, `POS_SALE`); a re-costing's variance (ADR-0033) is a COST_ADJ row with cost only.
- Void invoices are left out; a credit note counts on its own date.
- The category of a row is the product's category at refresh time.
- The dashboard's receivables are the RECEIVABLE accounts' balance at each period's end; overdue is today's.
- The stock value a month or a year ago comes from `stock_snapshot_daily` (the latest snapshot within a week before the date); turnover days = the period's average snapshot value × days ÷ the period's cost.
- Low stock follows `ai.low_stock`: a location with a minimum at or under it.
- Supplier purchases = the PURCHASE entries (the goods receipt's bill, re-costing differences, supplier returns); an unpriced receipt is no purchase yet.
- Margin = profit ÷ sales × 100, one decimal, HALF_UP; flagged under the threshold, or a loss without sales.

## 6. Error codes introduced

None (validation is `VALIDATION_FAILED` 422).

## 7. Screens (`apps/web/src/features/reports/`)

Menu «Тайлан»: «Захирлын самбар», «Авлагын насжилт», «Ашигт ажиллагаа», «Барааны эргэлт», «Нийлүүлэгчийн тайлан»; each with Excel, an A4 print page and drill sheets from rows to documents. Charts: Recharts 3.10.1.

## 8. Tests

- `apps/api/test/integration/reporting.int-spec.ts`: rights and hidden costs, sales ex-VAT net of returns with the ledger's cost, the documents behind a figure, the flag, the dashboard moved by its documents against the same days, aging by due date with the invoice link, stock cover and slow movers, the supplier report, the refresh lock and grants (fictitious data).
- `apps/api/src/modules/reporting/services/report-periods.spec.ts`: same-days periods, short months, whole months, ranges.
- `nightly-jobs.int-spec.ts` lists the schedule; web tests in `apps/web/src/features/reports/`.

## 9. Open items

- Delivery performance and the VAT summary (SPEC §5.14) come with the delivery module and the Finance Core.
- An incremental refresh if `duration_ms` grows past a minute.
