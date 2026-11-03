# ADR-0135: «Борлуулалт /Бараагаар/» worked out in the browser

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-02 |
| Deciders | Owner («борлуулалт тайлан авахад бүх мэдээлэл комьютер chrome дээр татагдана. Гарч ирсэн тайлан дээр нөхцлийг өөрчлөхөд шууд өөрчлөгдөж харагддаг байхаар», 2026-11-02), Claude (the direct-mode session) |
| Amends | ADR-0133 (the sales report's prompt), ADR-0134 (the same figures, now computed in the browser) |

## Context

Every change of a condition asked the server again: two to four queries over `reporting.sales_lines` for the report and one or two more for each row opened. The owner wants the period's data in Chrome once and every other condition to change the report at once.

## Decision

1. **One download per period.** `GET /reports/product-sales/data?from&to` (`reports.view`) returns every line of the period: one per document × product × warehouse as parallel columns (document and product indexes, warehouse id, quantity, net sales, returns and — only with `reports.margins.view` — cost), the documents (kind, number, date, customer, the order's author or the cashier, the customer-app flag, a till sale's tenders by payment key), the products (category, brand = main supplier, live hand-picked segments), the customers' groups and the names of the groups met. The browser keeps it for a minute and does not fetch it again on focus.
2. **The browser computes the rest** (`product-sales-cube.ts`): the filters (source, kind, warehouse, author, customer, customer group, product, category with its children, brands, segments), the grouping, the split by payment and a row's documents follow ADR-0134's rules exactly. The figures are whole numbers of their smallest unit (`bigint`): money in cents, costs in 10⁻⁸, payment shares in 10⁻⁹, rounded half up only when shown.
3. **A conditions bar above the paper.** Pills change the report at once and keep the address current (no new history entry). The prompt still sets the period and picks a customer or product. A new period downloads anew.
4. **A ceiling.** Over 200,000 lines the server sends nothing but `truncated`, and the paper asks for a shorter period. Measured on 200,000 synthetic lines: 12.9 MB of JSON before compression (production's Caddy compresses with zstd/gzip), 0.2 s to read it, about 0.05 s per change.
5. The Excel copy and `GET /reports/product-sales` / `…/documents` stay on the server, with the same rules.

## Consequences

- The server's load on this report becomes one query per period instead of several per click; the browser carries the data. A period too long for the ceiling must be split.
- The margins right is still enforced by the server: without it the cost column is never sent.
