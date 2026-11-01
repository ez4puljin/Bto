# ADR-0133: Erkhet's five reports on Bto's books — a prompt, the paper, the lines on a double click

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-01 |
| Deciders | Owner («Тайлан цэс нэм … Авлага, өглөгийн тайлан - Бараа материалын үлдэгдлийн тайлан - Мөнгөн хөрөнгийн тайлан - Борлуулалт /Бараагаар/ - Бараа материал баримтаар … Тайлангийн мөр дээр Doubleclick хийхэд дэлгэрэнгүй харагдаг. Түүн дээр дарахад үндсэн гүйлгээний цонх руу ордог байна. Тайлан бүрийг авахдаа ийм Prompt бөглөдөг байна», 2026-11-01, with Erkhet's screens), Claude (the direct-mode session) |
| Amends | ADR-0114 (the top bar's modules: «Тайлан» becomes a module of its own), ADR-0108 (the management reports move under it) |

## Context

The accountant works in Erkhet's reports every day: a «Тайлан авах» window of conditions, then a paper-like report with the company, the period «(төгрөгөөр)», the conditions and the lines to sign; a double click on a row shows its lines in italics, a click on a line opens the document. Bto had the management reports (ADR-0108) and the Finance Core's trial balance and VAT (ADR-0105), none of them in that shape. The five reports the owner named are the ones the accountant reads to replace Erkhet.

## Decision

1. **A «Тайлан» module.** The top bar gets its own «Тайлан» module with two groups: «Нягтлангийн тайлан» (the five reports below) and «Удирдлагын тайлан» (the management reports of ADR-0108, moved out of «Санхүү»). Below 2xl the module pills drop their arrows and some padding so nine modules fit at 1366.
2. **The prompt.** Every report opens with «Тайлан авах», a two-column dialog of Erkhet's conditions that Bto's data can answer, the dates last; «Нарийвчлал» picks hundredths or whole tögrög. The answers live in the address (`?from&to&…`), so a reload, a link or the back button shows the same report; «Нөхцөл» opens the prompt again from what the report shows. Excel and «Хэвлэх» (the browser's print of the paper alone) sit beside it.
3. **The paper.** Erkhet's layout: the title in the middle, the company with «(Аж ахуй нэгж албан байгууллагын нэр)», the period with «(төгрөгөөр)», «Шүүлтийн нөхцөл:», a bordered table with group rows in bold and «НИЙТ ДҮН» last, and «Тайлан гаргасан … /name/» and «Хянасан нягтлан бодогч …» under it.
4. **The lines.** A double click (or Enter) on a row opens its lines inside the table, in italics, read when opened; a click on a line opens the document behind it — the invoice, the voucher, the receipt, the issue, the transfer, the adjustment, the count, the sales order, the till's sale or shift, else the journal entry. A credit note opens its invoice's panel.
5. **«Авлага өглөгийн тайлан»** (`finance.read`): the RECEIVABLE, PAYABLE and advance accounts per account × party — or the chosen accounts or account groups — with the opening, the period's debit and credit and the closing as debit / credit pairs, grouped «Данс-Харилцагч» or «Харилцагч-Данс». Conditions: account groups, accounts, customer group, customer, supplier, «Хоосон мөр алгасахгүй», «Гүйлгээний утга» (text in the entry or the line), «Харьцсан данс» (an account, or its first digits, on the other side of the entry). A row's lines carry `#number - date - description`, the other side's accounts as «дт:…» / «кт:…», the debit, the credit and the running balance. Read by the Finance Core's `FinReports.ledgerReport` / `ledgerLines`; parties are named as Bto's customers and suppliers.
6. **«Мөнгөн хөрөнгийн тайлан»** (`finance.read`): the same read over the MONEY accounts, one row per account: opening, «Орлого», «Зарлага», closing; the lines name their party.
7. **«Бараа материалын үлдэгдлийн тайлан»** (`reports.view`, values with `reports.margins.view`): from the stock ledger, per product — or per warehouse × product, or grouped by category — the stock before the period, what came in and went out and the stock at its end, in base units and at cost (the ledger's unit cost plus the re-costing of stock on hand, `stock_valuation_adjustments.value_delta`). The moves between bins of one warehouse are left out. A row's lines are its documents with the running quantity.
8. **«Борлуулалт /Бараагаар/»** (`reports.view`, cost and profit with `reports.margins.view`): live from `reporting.sales_lines`, per product: quantity, average price, sales without VAT and city tax, returns, cost, profit, margin; conditions: employee (the order's author), customer group, customer, source (wholesale or the till), product, category, warehouse, sales or returns; a row's lines are its invoices, credit notes and till sales.
9. **«Бараа материалын тайлан /баримтаар/»** (`reports.view`): one row per stock document of the period — receipt, issue, transfer, adjustment, count, sold order, till sale, credit note — with its number, date, what it says, type, author, party, the quantity and cost it moved and, for a sale or a return, the amount with and without VAT; conditions: types, warehouses, product, customer, supplier, author. A row's lines are its products.
10. **Left out, for now.** Erkhet's conditions on the journal by product, brand, product type, «Агуулга» and «Х.Я», the payment split by account (Erkhet's 120101 / 150101 / 310101 columns) and the multi-customer picks: Bto's journal lines carry no product, products have no brand or type, and the five reports were asked for first. A later session adds them when the accountant asks.

## Consequences

- The reports read only; no table, no migration. The lists the prompts offer come from `GET /reports/book-options` (warehouses, categories, customer groups, active staff) so a report reader needs no right on those screens; the ledger reports' accounts from `GET /finance/reports/ledger/accounts`.
- Until the go-live the Finance Core holds only what Bto posted (the dev books are nearly empty); the ledger reports become the accountant's daily reports once Erkhet's opening is in (F5) and the cut-over is done.
- Rows are capped (5,000 report rows, 2,000 lines per row) with «Хэт олон мөр байна» under the table.
- `pnpm ui:shots` routes may carry a `then` script run after the load; the report pages use it to open every row's lines.
