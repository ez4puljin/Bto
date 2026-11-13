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

An ordinary table too (migration `0101_report_views`, `schema.ts`, ADR-0194): `report_views` — a saved view of a report page: `page` (one of `REPORT_VIEW_PAGES`), `name` (unique per author and page without case), `query` (the page's address parameters, without the dates when `period` is set), `period` (a preset that moves with the calendar, or null), `shared`, `created_by`. Hard delete, audited. Not copied by `store:seed`.

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
| `GET book-options` | reports.view | The prompts' lists: active warehouses, categories, customer groups, active staff (ADR-0133) |
| `GET stock-balance?from&to&by=product|warehouse&warehouseIds&categoryId&productId` (+ `.xlsx`), `GET stock-balance/lines?from&to&productId&warehouseIds` | reports.view | «Бараа материалын үлдэгдлийн тайлан»: opening, in, out, closing in base units and at cost (values null without margins); 5,000 rows, 2,000 lines |
| `GET product-sales?from&to&source&kind=ALL|SALES|RETURNS&repUserId&customerCategoryId&customerId&productId&categoryId&warehouseId&brandIds&segmentIds&by=none|category|brand|segment|user&payments` (+ `.xlsx`), `GET product-sales/documents?…&productId&group` | reports.view | «Борлуулалт /Бараагаар/», live from `sales_lines`; cost and profit null without margins; rows carry their group (ADR-0134) and, with `payments`, the net sales by payment (wholesale «Авлага», a till's sale by its tenders) |
| `GET product-sales/data?from&to` | reports.view | the period's every sales line for the browser to work the report out (ADR-0135): lines as parallel columns (cost only with margins), documents with tenders, products with brand and segments, customers' groups, group names; `truncated` and empty over 200,000 lines |
| `GET stock-documents?from&to&docTypes&warehouseIds&productId&customerId&supplierId&userId` (+ `.xlsx`), `GET stock-documents/lines?docType&docId&warehouseIds` | reports.view | «Бараа материалын тайлан /баримтаар/»: one row per stock document; 3,000 rows |
| `GET views?page=`, `POST views`, `PATCH views/:id`, `DELETE views/:id` | signed in; the page's own right is asked for | Saved views (ADR-0194): own and shared; only the author changes one; `identity.settings.manage` deletes another person's shared view; outside the reports' gate |

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
- Erkhet's stock reports (ADR-0133) count the warehouse movements only (receipt, delivery, till sale, issue and its reversal, transfer legs, return, adjustment, count); bin moves inside a warehouse are left out. Stock value = Σ qty × the ledger's unit cost + `stock_valuation_adjustments.value_delta` (the re-costing of stock on hand; its `variance` goes to the cost of sales, not to stock).

- Reports take turns (ADR-0193): every route of the two controllers stands behind the process's `ReportGate` except `refresh-state` and `book-options` (`@UngatedReport()`); a new route is gated unless marked (the Finance Core's and HR's report routes carry `@GatedReport()` on the method). On the report replicas a statement is ended at `DB_STATEMENT_TIMEOUT_MS`.

## 6. Error codes introduced

Validation is `VALIDATION_FAILED` 422. `REPORT_VIEW_LIMIT` 409 (a person's views of one page are full, ADR-0194). `REPORTS_BUSY` 429 (the gate is full or the wait ran out, with `Retry-After`) and `QUERY_TIMEOUT` 503 (a statement met its time limit) are raised by the platform (`common/reports`, `common/errors`), ADR-0193.

## 7. Screens (`apps/web/src/features/reports/`)

Top-bar module «Тайлан» (ADR-0133). «Удирдлагын тайлан»: «Захирлын самбар», «Авлагын насжилт», «Ашигт ажиллагаа», «Барааны эргэлт», «Нийлүүлэгчийн тайлан»; each with Excel, an A4 print page and drill sheets from rows to documents. Charts: Recharts 3. «Нягтлангийн тайлан» (`features/reports/books/`): «Авлага өглөгийн тайлан», «Мөнгөн хөрөнгийн тайлан» (the finance module's `/finance/reports/ledger`), «Бараа материалын үлдэгдэл», «Борлуулалт /Бараагаар/», «Бараа материал баримтаар» — each opens «Тайлан авах» (the conditions, kept in the address), draws Erkhet's paper, opens a row's lines on a double click and a line's document on a click; Excel and the browser's print.10.1.

## 8. Tests

- `apps/api/test/integration/reporting.int-spec.ts`: rights and hidden costs, sales ex-VAT net of returns with the ledger's cost, the documents behind a figure, the flag, the dashboard moved by its documents against the same days, aging by due date with the invoice link, stock cover and slow movers, the supplier report, the refresh lock and grants (fictitious data).
- `apps/api/src/modules/reporting/services/report-periods.spec.ts`: same-days periods, short months, whole months, ranges.
- `apps/api/test/integration/report-views.int-spec.ts`: own and shared views, the author alone changes one, the page's right, a moving period without dates, the name once per person and page, the limit; `packages/shared/src/reports/reports.test.ts`: presets and the kept address; `apps/web/src/features/reports/report-views.test.tsx`: the menu, opening, saving, replacing, deleting.
- `nightly-jobs.int-spec.ts` lists the schedule; web tests in `apps/web/src/features/reports/`.

## 9. Open items

- Delivery performance and the VAT summary (SPEC §5.14) come with the delivery module and the Finance Core.
- An incremental refresh if `duration_ms` grows past a minute.
