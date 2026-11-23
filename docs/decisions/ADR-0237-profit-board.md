# ADR-0237: «Ашгийн самбар» — the profit dashboard of a month, quarter or year, drawn with ECharts

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-23 |
| Deciders | Owner (2026-11-23: «Удирдлагын dashboard … хамгийн сайн санг ашиглаж илүү мэргэжлийн харагддаг байхаар»; phase 1 of the plan he approved), Claude (a brain task, `task/profit-board`) |
| Amends | ADR-0108 #7 (Recharts for the reports): this page draws with ECharts, as ADR-0146 #7 chose for the HR dashboards. The earlier reports keep Recharts |

## Context

«Захирлын самбар» (ADR-0108) shows one month's sales, profit, receivables and stock; «Ашигт ажиллагаа» lists profit by customer, product, category or rep for any dates. The owner wants a management dashboard of the profit itself that looks professional: a month, a quarter or a year with its comparisons, the trend, the structure of the profit, and the gross profit broken down by supplier, category, location, sales rep and branch, each down to the products — he asked expressly for «ХТ бүрийн борлуулсан бараагаар ашиг». Later phases add operating expenses, taxes and net profit to the same page.

## Decision

1. **One page, «Тайлан → Ашгийн самбар»** (`/reports/profit-board`, right after «Захирлын самбар» in the menu), with `reports.margins.view` only. «Захирлын самбар» stays as it is.
2. **The figures are `reports/profit`'s.** Net sales (without VAT and city tax, net of returns) and the cost of goods sold (the stock ledger's; a re-costing's variance a COST_ADJ row with cost only) come from `reporting.mv_sales_daily` with the same source rule, so the page's totals for any range equal `GET reports/profit`'s. Gross profit = net sales − cost; margin as in the other reports (one decimal, flagged under `reports.margin_threshold_pct` or a loss). No view, grant or migration changes.
3. **Periods.** A month (`2026-11`), a quarter (`2026-Q4`, «2026 оны 4-р улирал») or a year (`2026`) in Ulaanbaatar business dates (`@tugeel/shared/reports`). Each compares with the period before and the same period a year earlier; a running period counts to today and its comparisons take the same position in theirs (the month within the period and the day, a shorter month's last day), as ADR-0108 #11 does for the month; an ended period compares whole periods. The trend shows the last 12 months, 8 quarters or 5 years.
4. **Breakdowns of the period's gross profit**, each row with net sales, cost, gross profit, margin and its share of the whole gross profit; the top 100 rows and the rest summed («Бусад»); the chart shows the top 10:
   - **supplier** = the product's main supplier (`product_suppliers.is_main`) at the time of reading; products without one are one row «Нийлүүлэгчгүй бараа»;
   - **category** = the product's category rolled up to its top-level category; a row opens to the categories right under it (and a row for products right on the top);
   - **location** = the line's warehouse (`warehouse_id`; the till's warehouse and «Заал» are warehouses like any other);
   - **rep** = `profit?by=rep`'s rule: the order's author, «Bto300» orders and the supermarket rows of their own;
   - **branch** = the warehouse's branch (`branch_id` of the view).
   A row opens its products (base quantity, net sales, cost, gross profit, margin), the most profit first, the first 500 and the rest summed.
5. **Supplier discounts are counted in the period of the receipt, not of the sale.** «Нийлүүлэгчийн хөнгөлөлт» is what the books credit to 520202 «Худалдан авалтын хөнгөлөлт» (ADR-0236) for the receipts' payable entries dated in the period, per supplier: each costing row's income as the bill works it out (its cost plus the VAT inside what is owed, less what is owed: the discount without the VAT not taken back), carried by the receipt's bill and re-costings exactly as ADR-0234's view carries the note's discount (`receipt-discounts.ts`, `receipt-discount-entries.ts`, one reading shared with the supplier report). A receipt costed before ADR-0236 has its discount inside its cost and adds nothing. The discounts are shown beside the gross profit and in «Хөнгөлөлттэй нийт ашиг» = gross profit + discounts, on the tiles, the waterfall and the supplier rows; never inside the gross profit. With a branch filter only the receipt lines of that branch's warehouses count; with a source filter (wholesale or supermarket) the discounts and the free goods are not shown, because a purchase belongs to no sales channel.
6. **Free goods are shown, never added.** «Урамшууллаар авсан бараа»: the posted receipts' lines marked `free_goods` received in the period (by the receipt's date), their base quantity and a value at the unit cost of the same product's priced line in the same receipt, else the free line's costing `avg_before`, else no value. Their zero cost is already inside the average cost of what was sold, so the value is information only.
7. **API** under the reports controller (the report replica and its gate, ADR-0192, ADR-0193): `GET reports/profit-board?kind&period&branchId&source` (the three periods' totals, the discounts, the free goods, the trend, the five breakdowns, the branches for the filter, `refreshedAt`) and `GET reports/profit-board/products?…&dimension&rowKind&id&own`, both `reports.margins.view`, read-only, nothing kept in memory.
8. **The page** draws with Apache ECharts through `components/chart` (ADR-0146 #7), colours only from the tokens: KPI tiles, the trend (net sales and gross profit as bars, the margin as a line), the waterfall «Ашгийн бүтэц» (net sales → − cost → gross profit → + supplier discounts → gross profit with discounts) and the breakdown card with five tabs, each a horizontal bar chart beside its table. The tiles and the waterfall's steps are lists, so the later phases' operating expenses, taxes and net profit are added as more tiles and steps.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Recharts, as the other reports (ADR-0108 #7) | The owner asked for the most professional look; ECharts is already in the web (ADR-0146) with animated bars, a waterfall by stacking and a chunk loaded only with the first chart. |
| A supplier by the receipts the sold goods came from | Bto's average cost does not trace a sold unit to its receipt; the main supplier is the product's supplier on every other page. |
| Discounts in the period of the sale (spread over the goods sold) | The books take the discount as income when the receipt is costed (ADR-0236); spreading it would be a second rule the books do not follow. |
| Adding the free goods' value to the profit | It is already in the profit: free goods enter the average at zero, so what was sold cost less. |
| Extending «Захирлын самбар» | Its month, receivables and stock answer another question; the owner keeps it. |

## Consequences

**Positive.** One page answers how much was earned, against when, from which suppliers, categories, locations, reps and branches, down to the products; its totals agree with «Ашигт ажиллагаа».

**Negative.**
- The supplier is the main supplier now: a product whose main supplier changed moves its history with it (like the category, ADR-0108).
- The discounts of a period belong to receipts dated in it, so a month with a large receipt shows a large discount whatever was sold of it.
- Sales are up to 15 minutes old (the daily totals); discounts and free goods are live.
- Under a source filter the discounts and free goods are not shown (`TODO-VERIFY` if the owner wants them split by the warehouse instead).

## Related

ADR-0033, ADR-0108, ADR-0146, ADR-0192, ADR-0193, ADR-0234, ADR-0236, `docs/modules/reporting.md`, the guide's article `reports/10-profit-board.md`.
