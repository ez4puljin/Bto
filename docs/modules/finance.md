# Module `finance` — contract

Status (Finance I, delivery 3, built 2026-10-16, ADR-0060):
- **Invoices** from sold orders: the sale stage issues one for the delivered quantities at the frozen prices, the VAT and city tax split per line; voided by a reversing entry while nothing is allocated to it.
- **Receivables**: an append-only ledger per customer with a cached balance, aging and the overdue amount; checked every night.
- **Credit control** behind the sales hook: no tolerance, every payment method, hold / overdue / limit.
- **Vouchers** of the cash and bank books: customer payments allocated oldest due first or by hand, refunds, other income and expenses; voided by a reversing entry.
- **Credit notes**: goods back into a warehouse (`CN` / `RETURN_IN`), the invoice settled, the receivable and the sales returns posted.
- **The general journal**: a small chart of accounts with roles, automatic entries from every document, manual and opening entries, reversals.
- **Number formats** for the four documents, in the owner's style (`Н-20261016-0001`).

- **The customer app's reads** (ADR-0079 #7, ADR-0082, 2026-10-19): «Харилцагчид харуулах» on bank accounts, the store's own invoice and payment reads, and `PAYMENT_LISTENER` telling notifications of a customer payment.

Still to come: e-Barimt on the invoices (ADR-0017, next session), bank statement import and reports (delivery 10), the opening-receivables importer (before go-live), cost of goods sold postings, the screens of delivery 3 slice 5 (`docs/ui.md`).
- **Code:** `apps/api/src/modules/finance/`; shared rules in `packages/shared/src/finance`; screens in `apps/web/src/features/finance/`.
- **Decisions:** ADR-0060 (everything here), ADR-0010 (the tax split), ADR-0055 … ADR-0057 (the sale that invoices), ADR-0017 / ADR-0018 (what waits).
- **Architecture:** §4 (the row), §5.5 (credit), §5.6 (INVOICED), §5.8 (payments), §5.13 (the journal).

finance depends on these modules, always through their `index.ts`:
- `identity`: audit, numbering, user names, branches and warehouses (`OrgService`), the warehouse scope.
- `catalog`: `TaxService.companyRates` / `ratesFor`, `VatType`.
- `partners`: `CustomersService.lockForUpdate`, `creditTerms`, `getMany`, `findByIds`, `list`.
- `inventory`: `StockPostingService.post` (document `CN`), `BinsService.systemBin` (RETURNS).
- `sales`: only the hook contracts `CREDIT_CHECKER` / `SALE_SINK` and their types (`sales/hooks.ts`). **Finance never reads a sales table**; the sale hands it a snapshot by value.

Nobody imports `finance`. Sales finds the two hooks through `ModuleRef` (`strict: false`) and runs without them when the module is absent (the worker, tests that load sales alone).

## 1. Owner's answers behind the design (2026-10-15 / 16)

| Topic | Answer | Where |
|---|---|---|
| Scope | sales finance plus the general journal; the balance sheet, P&L, payroll and fixed assets stay in Erkhet for now | ADR-0060 context |
| Invoice | created automatically at the «Борлуулалт» stage, for the delivered quantities; e-Barimt postponed to the next session | #3 |
| Money | customers and drivers hand cash to the accountant, who records it and closes receivables; bank transfers typed by hand; no QPay (ADR-0080); no warehouse cashier, no shifts | #5 |
| Accounts | a small built-in chart; automatic postings for sales, receivables, payments and VAT; manual entries allowed; COGS later | #7 |
| Credit | 30-day term; **no tolerance**: over the limit or any overdue invoice blocks every order, cash too; NULL limit = no limit; no approval state; only the owner raises limits | #2 |
| Cash book | one per branch cash box and bank account, income and expense vouchers, the driver named on what he hands in | #5 |
| Numbers | configurable like order numbers; defaults `Н-`, `Т-`, `К-`, `Ж-` + `{year}{month}{day}-` + a daily counter | #8 |
| Opening balances | later, before go-live; manual journal entries until then | follow-ups |
| Returns | a credit note against an invoice, the goods back into a warehouse | #6 |

## 2. Owned tables (migration `0026_finance`)

| Table | Holds | Guards |
|---|---|---|
| `gl_accounts` | the chart of accounts: `code` (Erkhet's style), `name`, `kind` ASSET / LIABILITY / EQUITY / INCOME / EXPENSE, `role` (one account per role: AR, SALES, SALES_DISCOUNT, SALES_RETURN, VAT_PAYABLE, CITY_TAX_PAYABLE, CUSTOMER_ADVANCE, CASH, BANK, OTHER_INCOME, OTHER_EXPENSE), `status` | code and role unique; `REVOKE DELETE, TRUNCATE`; seeded with the eleven `DEFAULT_GL_ACCOUNTS` |
| `money_accounts` | cash boxes and bank accounts: code, name, kind CASH / BANK, branch, bank name and number, the `gl_account_id` their vouchers hit, `show_to_customers` («Харилцагчид харуулах», BANK only: CHECK `money_accounts_show_to_customers`, migration 0031), status | code unique; `REVOKE DELETE, TRUNCATE`; one «Касс (branch)» per branch existing at migration time |
| `finance_settings` | the four number formats (pattern + digits), one row (`id = 1`); absent until saved → the shared `FINANCE_NUMBER_DEFAULTS` | pattern 1–24 chars not ending in a digit or `}`; digits 1–8; `REVOKE DELETE, TRUNCATE` |
| `journal_entries` | number, `entry_date`, description, `source` AUTO_INVOICE / AUTO_PAYMENT / AUTO_CREDIT_NOTE / AUTO_VOID / MANUAL / OPENING, the source document (`source_type`, `source_id`), `reverses_id`, `posted_by` | append-only (`REVOKE UPDATE, DELETE, TRUNCATE` + `forbid_update_delete` triggers); number unique |
| `journal_lines` | `line_no`, account, `debit` xor `credit` (> 0), optional customer and money account, description | append-only like the entries; deferred constraint trigger `journal_entry_balanced`: ≥ 2 lines and Σ debit = Σ credit at commit |
| `invoices` | number, status ISSUED / VOID, customer, order (unique) and its number, branch, `invoice_date`, `due_date`, payment method, `subtotal`, `discount_total`, `total`, `vat_total`, `city_tax_total`, `open_amount`, note, `journal_entry_id`, the void fields | `total = subtotal − discount_total`; `0 ≤ open_amount ≤ total`; `due_date ≥ invoice_date`; void fields together; `REVOKE DELETE, TRUNCATE` |
| `invoice_lines` | one per filled part (ADR-0048 #4): product and unit snapshots, `basis`, `qty`, `factor_snapshot`, `qty_base`, warehouse, list and unit price, subtotal, discount, total, `vat_type`, the two rates, `vat_amount`, `city_tax_amount`, `returned_base` | money and quantity signs; `returned_base ≤ qty_base`; `REVOKE DELETE, TRUNCATE` |
| `credit_notes` + `credit_note_lines` | number, invoice, customer, `note_date`, reason, the warehouse and bin the goods went to (both or neither), totals, `journal_entry_id`; lines per invoice line with the returned quantity and money | `total > 0`; lines immutable (`REVOKE UPDATE, DELETE, TRUNCATE`); header `REVOKE DELETE, TRUNCATE` |
| `payments` | number, status POSTED / VOID, `kind` CUSTOMER_PAYMENT / CUSTOMER_REFUND / OTHER_IN / OTHER_OUT, `direction`, money account, customer xor `gl_account_id` (by kind), amount > 0, `paid_on`, description, reference, counterparty, `collected_by`, `journal_entry_id`, the void fields | `REVOKE DELETE, TRUNCATE` |
| `allocations` | what a payment or a credit note settles of an invoice (`source_type`, `source_id`, `invoice_id`, `amount > 0`, `voided_at`) | `REVOKE DELETE, TRUNCATE`; voided with their source |
| `ar_entries` | the receivables ledger: customer, `entry_date`, `kind` INVOICE / PAYMENT / CREDIT_NOTE / REFUND / ADJUSTMENT / OPENING / VOID, the document, `debit` / `credit` | append-only (REVOKE + triggers) |
| `customer_balances` | the cache: `balance` = Σ debit − Σ credit, `open_invoices`, `overdue_amount`, `oldest_due_date`, `updated_at` | rewritten in the transaction of every entry; checked nightly |
| `finance_reconcile_runs` | every check of the cache: kind NIGHTLY / MANUAL, OK / DRIFT, counts, the first 200 drifts | `REVOKE UPDATE, DELETE, TRUNCATE` |

Schema `ai` gains `ai.invoices`, `ai.invoice_lines`, `ai.payments` and `ai.customer_balances` (docs/modules/ai.md §2).

## 3. Public API (`modules/finance/index.ts`)

| Export | Use |
|---|---|
| `FinanceModule` / `FinanceHttpModule` / `FinanceWorkerModule` | the services (+ the hook bindings `CREDIT_CHECKER` → `CreditControlService`, `SALE_SINK` → `InvoicingService`); the controllers (api); the nightly job (worker) |
| `CreditControlService.check(tx, { customer, orderId, amount, openOrders })` | the sales hook: HOLD → OVERDUE → LIMIT → ok, with the amounts for the 409 |
| `InvoicingService.onSold(tx, actor, snapshot)` / `void(ctx, id, reason)` | the sale hook (null when nothing was delivered); the void |
| `InvoiceQueryService.list(ctx, query)` / `get(id)` / `openOf(customerId)` | reads |
| `InvoiceQueryService.ofCustomer(customerId, id)` / `ofOrder(orderId)` / `openDueBetween(from, to)` | the customer app (ADR-0079 #7): one invoice of the store (404 for another's), a sold order's invoice, the open invoices the morning reminders look at |
| `PaymentsService.ofCustomer(customerId, { cursor, limit })` | the store's posted payments and refunds with the method (CASH / BANK) and the invoices each settled; nothing internal (accounts, journal, who collected it) |
| `MoneyAccountsService.shownToCustomers()` | the ACTIVE bank accounts marked «Харилцагчид харуулах» |
| `PAYMENT_LISTENER`, `PaymentListener`, `PaymentRecordedNotice` (`hooks.ts`) | the hook notifications binds (ADR-0082 #5): `recordInTx` tells it of every CUSTOMER_PAYMENT with a customer, after the ledger and the audit row, with the invoices `allocate` settled; never caught; finance resolves it through ModuleRef and does without it |
| `PaymentsService.record(ctx, input)` / `recordInTx(tx, ctx, input)` / `void` / `list(ctx, query)` / `get` / `book(moneyAccountId, query)` | the vouchers and the cash book; `recordInTx` lets another module’s transaction carry a voucher (the POS hand-over, ADR-0064 #3) and answers `{ id, number }` |
| `CreditNotesService.create(ctx, input)` / `list` / `get` | credit notes |
| `JournalService.post(tx, actor, input)` / `reverse(tx, actor, id, …)` / `postManual(ctx, …)` / `reverseManual` / `list` / `get` / `accountLedger(accountId, query)` | the journal; `post` throws 422 `JOURNAL_UNBALANCED` |
| `GlAccountsService.list` / `listWithBalances(asOf)` / `byRole(role)` / `create` / `update` / `setRole` | the chart; `byRole` throws 409 `ACCOUNT_ROLE_MISSING` |
| `MoneyAccountsService.list` / `get` / `lockActive(tx, id)` / `create` / `update` | cash boxes and bank accounts with their balances |
| `ArLedgerService.record(tx, entry)` / `balanceOf` / `overdueOf` / `rowOf` / `ledger` / `balances(ctx, query)` / `attention` / `reconcile(kind)`; `reconcileReceivables(db, kind)` | the ledger, the cache and its check (the plain function serves the CLI) |
| `FinanceSettingsService.numbering` / `setNumbering(ctx, input)` / `allocateNumber(tx, kind, day)` | the number formats and the counters (`INV_NO`, `PAY_NO`, `CN_NO`, `JE_NO`, period = the rendered prefix) |

## 4. REST surface (`/api/v1`, permissions in brackets)

| Route | Does |
|---|---|
| `GET /invoices`, `GET /invoices/:id` [`finance.read`] | the list (`q`, `customerId`, `orderId`, `branchId`, `settlement`, `status`, `overdue`, `from`, `to`; keyset by id; `total` on the first page) and one invoice with lines, allocations and credit notes |
| `POST /invoices/:id/void` [`finance.invoices.manage`, idempotent] | voids an issued invoice nothing is allocated to or credited against |
| `GET /credit-notes`, `GET /credit-notes/:id`, `POST /credit-notes` [read / `finance.invoices.manage`, idempotent] | credit notes; `warehouseId` null = no goods back, `binId` null = the RETURNS bin; the warehouse scope applies |
| `GET /payments`, `GET /payments/:id`, `POST /payments`, `POST /payments/:id/void` [read / `finance.payments.record`, idempotent] | vouchers; `allocations` omitted = oldest due first |
| `GET /money-accounts` [read], `POST`, `PUT /:id` [`finance.settings.manage`], `GET /money-accounts/:id/book` [read] | cash boxes and bank accounts with balances and `showToCustomers` (a CASH box with it → 422 `showToCustomers` `bankOnly`); the book newest first with `balanceAfter` and the `opening` before `from` |
| `GET /gl-accounts` [read], `POST`, `PUT /:id` [`finance.journal.manage`], `PUT /:id/role` [`finance.settings.manage`], `GET /:id/ledger` [read] | the chart with turnover and balances; the account ledger |
| `GET /journal-entries`, `GET /:id` [read], `POST` (manual), `POST /:id/reverse` [`finance.journal.manage`, idempotent] | the journal; only MANUAL / OPENING entries are reversed by hand |
| `GET /customer-balances`, `GET /customer-balances/:customerId`, `GET /customer-balances/:customerId/ledger` [read] | balances largest first (`q`, `overdue`) with aging; one customer; the ledger with `balanceAfter` and `opening` |
| `GET /finance/attention` [read] | overdue amount and customers, open amount and invoices (the home tile) |
| `GET /finance-settings/numbering` [read], `PUT` [`finance.settings.manage`] | the four formats |

Money is serialised with two decimals (`'10000.00'`), quantities as entered (`'10'`), instants in ISO 8601, business dates as `YYYY-MM-DD`.

## 5. Rules worth knowing

- **The invoice (ADR-0060 #3).** `InvoicingService.onSold` runs inside the sale's transaction, after the stock left STAGING. Each line's delivered base quantity fills the frozen parts (`invoicePartsFor`: packs first, a remainder no loose part covers priced per base unit from the smallest pack, discounts pro rata); every part is an invoice line with `taxSplit(total, vat %, city %)` (ADR-0010 #4). Rates come from `TaxService.companyRates(today)` and `ratesFor(product)`: a company that pays no city tax gets 0 % whatever the product says; VAT only for `VAT_ABLE` products of a VAT payer. `invoice_date` = today (Ulaanbaatar); `due_date` = today + the customer's term (`creditTerms`, default `credit.payment_term_days` = 30) **for every payment method** — a cash sale is not overdue until the term passes (owner to confirm a shorter cash term, STATUS pending). Nothing delivered on any line → no invoice, the order stays DELIVERED.
- **The entries.** Invoice: Dr AR `total` (customer on the line), Dr SALES_DISCOUNT `discount_total`, Cr SALES `subtotal − vat − city tax`, Cr VAT_PAYABLE, Cr CITY_TAX_PAYABLE (zero lines skipped; no entry for a zero subtotal). Payment: Dr cash/bank (money account on the line) / Cr AR; refund the reverse; OTHER_IN Dr cash / Cr the account; OTHER_OUT Dr the account / Cr cash. Credit note: Dr SALES_RETURN `total − taxes`, Dr the taxes payable / Cr AR. Void: the original entry reversed (`AUTO_VOID`, `reverses_id`). An unallocated payment is Cr AR too (the balance goes negative = an advance); `CUSTOMER_ADVANCE` is for reports, not for postings (ADR-0060 #7 ✱).
- **Descriptions** of automatic entries are `«number — customer name»` (data, not translation); the web labels the `source`.
- **Lock order** (architecture §5.3 for stock): stock rows first (the sale posts before calling the sink; a credit note posts `RETURN_IN` before locking anything of finance), then the customer row (`CustomersService.lockForUpdate`, FOR NO KEY UPDATE), then the invoice rows FOR UPDATE in id order, then the lines. Every ledger entry is written under the customer lock; `customer_balances` is rewritten right after it. Money accounts are locked FOR SHARE; the number counters last.
- **Credit check (ADR-0060 #2).** Sales sums the customer's other CONFIRMED … DELIVERED orders (`openOrders`) under the customer lock and calls the hook. HOLD when `credit_hold`; OVERDUE when any issued invoice with `open_amount > 0` has `due_date < today` (read live, not from the cache); LIMIT when `balance + openOrders + amount > credit_limit` (NULL = never). The refusal is 409 `CREDIT_BLOCKED` with `reason`, `exposure`, `limit`, `excess`, `overdueAmount`, `oldestDueDate` (whole MNT strings).
- **Allocations (ADR-0060 #5).** FIFO by `due_date, id` over the customer's open invoices, locked FOR UPDATE in that order; chosen allocations must name open invoices once each, within their open amount and together within the payment (422 `ALLOCATION_EXCEEDS`). A credit note allocates `min(total, open_amount)`; the rest is an advance. Voiding a payment adds the amounts back onto the invoices and marks the allocations `voided_at`.
- **Void rules.** An invoice is voided only when no live allocation and no credit note points at it (409 `INVOICE_STATE_INVALID`, `status: ALLOCATED`); the goods stay where the sale put them. A payment is voided only once (409 `PAYMENT_STATE_INVALID`). Reasons are 1–500 characters.
- **Credit notes (ADR-0060 #6).** Quantities per invoice line, never more than `qty_base − returned_base` (the CHECK guards races too); money at the invoiced unit price, discounts pro rata, taxes with the line's frozen rates; `warehouseId` null means a price correction without stock. The movement is `CN` / `RETURN_IN` into the chosen bin (RETURNS by default) at the warehouse's average cost; `pnpm inventory:reconcile` stays clean.
- **Dates.** Documents are dated today or earlier (`notFuture`); the number's day is the document's date, so a back-dated voucher takes that day's counter.
- **The cache.** `customer_balances` is rewritten from the ledger and the open invoices after every entry; `overdue_amount` / `oldest_due_date` are as of the last write, so the nightly `finance.reconcile` (03:15) and `pnpm finance:reconcile` rewrite every row (the calendar moves them) and record a drift of `balance` or `open_invoices` as the evidence of a bug. Lists read the cache; the credit check reads the overdue amount live.
- **The supermarket POS (ADR-0064).** Till sales get no invoice and no receivable. The pos module posts one `AUTO_POS_SHIFT` entry per closed shift (`source_type` POS_SHIFT) on the roles POS_CASH (100102), CARD_CLEARING (120301), POS_SALES (510102), CASH_VARIANCE (740101) plus SALES_RETURN and VAT_PAYABLE, and records the accountant’s hand-over as an OTHER_IN voucher against POS_CASH through `recordInTx`. `JOURNAL_SOURCE_DOC_TYPES` = the finance document kinds + POS_SHIFT.
- **Settings.** `credit.payment_term_days` defaults to 30 (ADR-0060 #2); `tax.vat_rate_pct`, `tax.city_tax_rate_pct`, `company.vat_payer`, `company.city_tax_payer` decide the split.

## 6. Error codes introduced

`INVOICE_STATE_INVALID` (409), `PAYMENT_STATE_INVALID` (409), `ALLOCATION_EXCEEDS` (422), `JOURNAL_UNBALANCED` (422), `ACCOUNT_ROLE_TAKEN` (409), `ACCOUNT_ROLE_MISSING` (409); `CREDIT_BLOCKED` (409, sales) now carries the finance parameters.

## 7. Commands

| Command | Does |
|---|---|
| `pnpm finance:reconcile` | checks `customer_balances` against the ledger and the invoices, rewrites every row, records a `finance_reconcile_runs` row; exit 2 on drift (find what wrote the cache wrong: every writer goes through `ArLedgerService.record` / `refresh`) |

## 8. Audit

`invoices` CREATE / VOID, `payments` CREATE / VOID, `credit_notes` CREATE, `journal_entries` POST (manual and manual reversals), `gl_accounts` CREATE / UPDATE (incl. roles), `money_accounts` CREATE / UPDATE, `finance_settings` UPDATE. Automatic entries are covered by their document's row.

## 9. Screens (`apps/web`)

`apps/web/src/features/finance/` (docs/ui.md «Finance records»), the «Санхүү» menu group behind `finance.read`:

| Route | Screen |
|---|---|
| `/finance/invoices` (+ `?invoice=`) | the list with search, settlement, overdue and date filters; the invoice panel (facts, totals, lines, allocations, credit notes; «Хэвлэх» A4 / 80 mm; «⋯» void with a reason, credit note by line quantities into a warehouse's RETURNS bin or none) |
| `/finance/invoices/:id/print`, `/finance/payments/:id/print` | the invoice and the voucher for paper, outside the shell, `?format=a4` / `80mm` (ADR-0058) |
| `/finance/payments` (+ `?new=1`, `?payment=`) | the vouchers with filters; «Төлбөр бүртгэх» (kind, money account, customer or journal account, amount, date, reference, the driver who handed it in; the open invoices oldest due first or allocated by hand, the rest shown as an advance); the voucher panel with its allocations, printing and voiding |
| `/finance/cash` (+ `?account=`) | the money accounts as cards with balances, the chosen one's book newest first with the balance after each voucher and the opening before `from` |
| `/finance/customers`, `/finance/customers/:id` (+ `?new=1`) | who owes what with aging and credit terms; one customer's balance card and ledger with «Төлбөр бүртгэх» for that customer; `CustomerBalanceCard` («Тооцоо») on `/partners/customers/:id` |
| `/finance/journal` (+ `?new=1`, `?entry=`), `/finance/accounts`, `/finance/accounts/:id` | the journal with «Гараар бичилт» (lines that must balance before sending) and the entry panel (a manual entry's «Эсрэг бичилт»); the chart with turnover and balances, account dialogs, the role dialog (`finance.settings.manage`), an account's ledger |
| `/finance/settings` (`finance.settings.manage`) | the four number formats with today's example; the money accounts, a bank account's «Харилцагчид харуулах» switch (the customer app lists it with the advice to name the invoice) and its «Апп-д харагдана» badge |

Also: the home tile «Хугацаа хэтэрсэн авлагатай харилцагч» (`GET /finance/attention`, opens the balances filtered to overdue), the order panel's «Нэхэмжлэх» fact with the settlement badge, and `ProblemAlert` rendering `CREDIT_BLOCKED` as one line per reason with the formatted amounts.

## 10. Tests

- `packages/shared/src/finance/finance.test.ts`: the tax split table (ADR-0010), part filling, FIFO, aging, settlement, numbers.
- Integration: `finance-invoicing` (the sale → invoice, taxes, entry, ledger; nothing delivered; void and its refusal), `finance-payments` (FIFO, advance, chosen allocations, void, cash book, other income / expense, refund), `finance-credit` (limit for cash too, own order not counted twice, no limit, overdue, hold), `finance-credit-notes` (RETURNS, allocation, over-return, settled invoice → advance, price correction), `finance-books` (seeded chart and roles, manual entries, unbalanced, reversals, money accounts, numbering); `ai-views` covers the four views; `customers` expects the 30-day default; `sales-boards` expects INVOICED.
- Integrity (`--runInBand`): `finance-guards` (REVOKEs for app, triggers for migrator, the balanced-entry trigger at commit), `finance-ledger` (reconcile OK → drift recorded and repaired → OK), `finance-races` (two confirmations vs one limit; two payments vs one invoice).
- Web (Vitest, `features/finance/*.test.tsx` on `finance-fixtures.ts`): the menu by role, the invoice list → panel → void, the payment dialog (FIFO preview, the request body, the voucher panel), the cash book, the balances → ledger, the home tile; the journal panel, the manual entry refused unbalanced then posted, the role refusal, the number formats and a new bank account; both print pages calling `window.print` once.

## 11. Open items

- e-Barimt receipts on invoices (ADR-0017): the next session; the invoice carries everything the receipt needs (lines with `vat_type`, rates and amounts, the customer's TIN through partners).
- Done 2026-10-19 (ADR-0082): no QPay (ADR-0080); the customer app reads the store's balance, open invoices and payments through finance's public services and lists the `money_accounts` flagged «Харилцагчид харуулах» (`docs/modules/customer.md`).
- Opening balances: an importer of customer balances (OPENING ledger entries + an OPENING journal entry) before go-live; manual journal entries meanwhile.
- A shorter due date for cash sales if the owner wants it (today every invoice takes the customer's term).
- Cost of goods sold postings (stock value out of inventory at the sale); CLOSED orders when their invoice is paid; customer statements; reminders; bank statement import and VAT reports (delivery 10); supplier bills (delivery 8).
- Lots on credit-note returns (returned goods go back without a lot).
