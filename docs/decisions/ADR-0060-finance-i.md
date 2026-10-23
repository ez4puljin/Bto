# ADR-0060: Finance I: invoices at the sale, an append-only receivables ledger, strict credit control, cash and bank books, credit notes and a small general journal

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-16 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0062 (#1: a third sales hook, `SALE_LISTENER`, told of every sale after the invoice); ADR-0064 (#5: `PaymentsService.recordInTx` joins `record`, so another module's transaction can carry a voucher; #7: the POS roles, the source `AUTO_POS_SHIFT` and the source document `POS_SHIFT`); ADR-0069 (#1: the direction is reversed, source systems depend on the Finance Core); ADR-0071 (#1: `SALE_SINK.onSold` posts an `AR_INVOICE` through `FinIntakeInTx.submitInTx` inside the sale's transaction); ADR-0072 (#4, #5, #7: open items and append-only allocations; roles become posting rules; an existing credit is applied by the accountant through an ALLOCATION document); ADR-0073 (#3 ownership and #6 superseded: Bto's `billing` owns the product invoice and the sales return; #2: exposure comes from the core and unapplied credits net the overdue amount); ADR-0075 (#9: seven new finance rights; manual and opening entries post only after approval); ADR-0077 (the scope sentence "balance sheet, income statement, payroll and fixed assets stay in Erkhet" is superseded: Erkhet stops on the go-live day); ADR-0079 (#7: the customer app reads the store's balance, invoices and payments; `money_accounts` gains «Харилцагчид харуулах»); ADR-0080 (QPay is dropped, not deferred); ADR-0101 (2026-10-23: #2 in part — the payment term in days and `credit.payment_term_days` give way to the settlement groups, and an overdue invoice no longer refuses an order) |
| Amends | ADR-0055 (the credit check: no tolerance, no approval state, every order, open orders summed by sales at check time), ADR-0056 (#3: the SALE stage also invoices the order, which ends INVOICED), ADR-0057 (#7: `CREDIT_BLOCKED` carries its reasons; the order panel shows the invoice), ADR-0017 and ADR-0018 (unchanged in principle; e-Barimt and QPay stay deferred, the invoice is their source), ADR-0010 (the tax split is applied on invoices, not on orders), architecture §4 (finance's dependencies and seams), §5.5 (`customer_balances` keeps no `open_orders`; the tolerance setting is dropped), §5.6 (INVOICED), §5.8 (no cash sessions in delivery 3; the cash book) |

## Context

The owner moved to finance («Санхүүгийн модуль руу орьё») while the sales-rep app is built elsewhere, and asked for the design to take its cues from Erkhet (erkhet.bto.mn), the accounting program the company uses today, whose technology «is dated and freezes a lot». Erkhet was read through the browser for its structure only: a chart of accounts (cash per branch, several bank accounts, receivables per branch, cashier sub-accounts per tender, VAT receivable and payable, sales, discounts, returns), receivable transactions that open and close a «тооцоо» with a due date, cash and bank vouchers (income or expense, the account's balance, a contra account, a VAT flag), sales documents with lines, and reports by customer, by due date and by cash account. Its settings show VAT 10 % and city tax 0 %.

Before this decision the system had the seams only: `AllowAllCreditChecker` bound privately inside `SalesModule`, customer credit columns under a row lock, the SALE stage issuing stock and ending at DELIVERED, order money frozen for the ordered quantity, no tax amounts anywhere, `CN` allowed as a ledger document type with a `RETURN_IN` movement and a `RETURNS` bin, and the documents describing invoices, `ar_entries`, `customer_balances`, cash sessions and QPay.

The owner's answers (2026-10-15 and 2026-10-16, four rounds):
- **Scope:** the sales side of finance plus a general journal (a chart of accounts and double-entry postings). Balance sheet, income statement, payroll and fixed assets stay in Erkhet for now.
- **Invoices** are created automatically when a card reaches the «Борлуулалт» stage, for the delivered quantities. e-Barimt is postponed to its own session.
- **Payments:** customers and drivers hand cash to the accountant, who records it and closes the receivables; bank transfers are recorded by hand from internet banking; QPay waits for delivery 5. There is no warehouse cashier.
- **Chart of accounts:** a small built-in one; the accountant adds accounts later. **Automatic postings:** sales, receivables, payments and VAT; manual entries allowed; cost of goods sold later.
- **Credit:** a 30-day term; no tolerance — an order whose customer is over the limit or has an overdue receivable is refused, whatever its payment method; a customer without a limit is unlimited; no approval state.
- **Cash:** a cash book with income and expense vouchers, no shifts; cash boxes and bank accounts per branch; money handed over by a driver is recorded under the driver's name.
- **Numbers:** configurable like order numbers; defaults `Н-20261016-0001` (invoice), `Т-…` (payment), `К-…` (credit note), `Ж-…` (journal entry), the counter restarting daily.
- **Opening balances** come before go-live (an importer later; manual journal entries now). **Returns:** a credit note against an invoice, the goods back into a warehouse.

## Decision

1. **A `finance` module behind sales hooks.**
   - `MODULE_DEPS.finance = ['identity', 'catalog', 'partners', 'inventory', 'sales', 'ebarimt']`. Finance imports `sales/index.ts` for its hook tokens and snapshot types only; it never reads a sales table. Sales never imports finance.
   - `sales/hooks.ts` declares two tokens resolved by `SalesOrdersService` through `ModuleRef` (`strict: false`, the partners pattern):
     - `CREDIT_CHECKER`: `check(tx, { customer, orderId, amount, openOrders })` returns `{ ok: true }` or `{ ok: false, reason: 'HOLD' | 'OVERDUE' | 'LIMIT', … }`. Unbound (the worker, tests without finance) every order passes. The abstract `CreditChecker` class and `AllowAllCreditChecker` are gone.
     - `SALE_SINK`: `onSold(tx, actor, snapshot)` returns the invoice created, or `null` when nothing was delivered. Unbound, the sale ends at DELIVERED as before.
   - `FinanceModule` binds both with `useExisting`.
2. **Credit control with no tolerance.** At submit and at the re-pricing of a confirmed order, after locking the customer row, sales sums the customer's other open orders (CONFIRMED, PICKING, PACKED, DELIVERED; the order being checked excluded) and asks the checker. The checker answers HOLD on `credit_hold`, OVERDUE when an open invoice is past its due date, LIMIT when `credit_limit` is set and `balance + openOrders + amount` exceeds it; otherwise OK. A refusal is 409 `CREDIT_BLOCKED` with the reason, the exposure, the limit, the excess and the overdue amount. The check applies to every payment method. `credit.payment_term_days` defaults to 30; there is no `credit_tolerance_pct` and `APPROVAL_PENDING` is never set.
3. **The invoice.** One invoice per sold order, numbered in its own transaction. Its lines are the order's frozen parts filled with the delivered base quantity, packs first; a remainder no loose part covers is priced at the pack's unit price divided by its factor (whole MNT); discounts follow the quantity (`invoicePartsFor` in `@tugeel/shared/finance`). Tax is split per line with ADR-0010's formula from the product's `vat_type` and `city_tax` and the settings `tax.vat_rate_pct` / `tax.city_tax_rate_pct`, each zero when `company.vat_payer` / `company.city_tax_payer` is false or unset; the company's flags, not the product's `city_tax`, decide whether a missing city-tax attribute matters (`TaxService.ratesOf`). The due date is the invoice date plus the customer's term. With a sink bound the order ends INVOICED (PACKED → DELIVERED → INVOICED in one transaction). An invoice is immutable; «Хүчингүй болгох» reverses it (ledger and journal) while nothing is allocated to it.
4. **The receivables ledger.** `ar_entries` is append-only (customer, date, kind, document, debit, credit); `customer_balances` caches `balance`, `open_invoices`, `overdue_amount` and `oldest_due_date`, rewritten in the same transaction as every entry under the customer's row lock, and compared with the ledger nightly (`finance.reconcile`, `pnpm finance:reconcile`, runs recorded like the stock reconciliation). Aging buckets: not due, 1–30, 31–60, 61–90 and over 90 days past due.
5. **Payments and the cash book.** `money_accounts` (cash boxes and bank accounts, each on a branch and mapped to a journal account; every branch gets a cash box). `payments` are vouchers: IN or OUT, a customer payment or refund, or another income or expense against a journal account; the driver who handed the money over is named. `allocations` tie payments and credit notes to invoices: never more than the source holds nor more than the invoice is open for; the default is oldest due first, editable in the dialog; an unallocated remainder is the customer's advance (a negative balance) to allocate later or refund. A voided payment is reversed, its allocations undone.
6. **Credit notes and returns.** A credit note names an invoice and the quantities returned per line, with the same prices and tax split; it credits the ledger, allocates itself to the invoice, posts the goods back with document type `CN` and movement `RETURN_IN` into the chosen warehouse (the `RETURNS` bin by default), and reverses revenue and VAT in the journal.
7. **The general journal.** `gl_accounts` carry a code (Erkhet's numbering style), a name, a kind and at most one role (AR, SALES, SALES_DISCOUNT, SALES_RETURN, VAT_PAYABLE, CITY_TAX_PAYABLE, CUSTOMER_ADVANCE, CASH, BANK, OTHER_INCOME, OTHER_EXPENSE); the migration seeds a small chart. `journal_entries` and `journal_lines` are append-only, balanced by a deferred constraint trigger, corrected only by reversing entries. Automatic entries: an invoice debits receivables (total) and sales discounts (discount) and credits sales (net of tax) and the tax payables; a payment debits the money account and credits receivables (an advance stays on receivables as a negative balance; the CUSTOMER_ADVANCE role is for reports); a credit note the reverse; other income and expenses against the chosen account. Manual entries and opening balances are typed in the journal.
8. **Numbering.** `finance_settings` holds four patterns and digit counts validated by the order-number rules; scopes `INV_NO`, `PAY_NO`, `CN_NO`, `JE_NO` with the rendered prefix as the period.
9. **Rights.** `finance.read` (ACCOUNTANT, OFFICE), `finance.payments.record`, `finance.invoices.manage`, `finance.journal.manage` (ACCOUNTANT), `finance.settings.manage` (ADMIN, assignable).
10. **Screens.** A «Санхүү» menu group: invoices (a list and a panel with lines, tax, allocations, credit notes, printing on A4 or 80 mm, voiding and crediting), payments (the list, the payment dialog with FIFO allocation, the expense dialog, the voucher print), cash and bank books, customer balances with aging and a per-customer ledger (and a «Тооцоо» card on the customer page), the journal with a manual-entry dialog, the accounts with their ledgers, settings. The home page gets an overdue-receivables tile; the order panel links to the order's invoice; a refused order shows why.
11. **AI.** Views `ai.invoices`, `ai.payments` and `ai.customer_balances`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Operational finance only, no journal | The owner wants the journal; Erkhet's accounts are what the accountant thinks in. |
| Importing Erkhet's chart of accounts | The owner chose a small built-in chart; its numbering keeps Erkhet's style so the two stay comparable. |
| Rebinding `CreditChecker` in `AppModule` (architecture §4) | Nest resolves the sales service's dependency inside `SalesModule`, where the stub was bound; the hook pattern already used by partners and catalog works and keeps the import direction. |
| An `open_orders` column in `customer_balances` | It would need confirm, cancel, re-price and sale hooks; sales sums its own open orders under the same customer lock instead. |
| A tolerance with an approval state (SPEC §6.2 as written) | The owner: no tolerance, refuse at once; the owner raises the limit or the payment is recorded. |
| Cash sessions with counted shifts | The accountant is the only cashier; a cash book with vouchers is what Erkhet gives them today. |
| Invoices for the ordered quantity | A short pick is invoiced for what left the warehouse; the frozen parts keep the confirmed prices. |
| e-Barimt in this session | Postponed by the owner; the invoice carries everything a receipt needs. |

## Consequences

**Positive.**
- A sale is invoiced the moment the goods leave, with its tax split and its journal entry.
- Credit is enforced where the owner wanted it, on every order.
- The accountant records money once, and the books, the ledger and the journal agree by construction.

**Negative.**
- Finance depends on five modules; the no-table-reads rule is a convention, not a lint.
- A customer with one overdue invoice cannot buy for cash until it is paid or the limit is raised.
- An invoice's quantity does not follow a later correction of the pick; corrections are credit notes.
- Opening balances are typed until the importer exists.
- Every invoice is due at the invoice date plus the customer's term, cash sales included: an unpaid cash sale blocks the customer only when the term passes (the owner may want a shorter cash term — STATUS pending).
- The automatic entries' descriptions are data (`«number — customer»`), the screens label the source; a changed chart of accounts (roles moved) changes only later entries.

**Follow-ups.**
- The `ebarimt` module (ADR-0017) on these invoices; QPay (ADR-0018) on payments.
- The opening-receivables importer before go-live; bank statement import and matching, VAT reports (delivery 10).
- Cost of goods sold postings; CLOSED orders when their invoice is paid; customer statements; reminders.

## Related

ADR-0010, ADR-0017, ADR-0018, ADR-0027, ADR-0055, ADR-0056, ADR-0057, ADR-0058, ADR-0059; SPEC §5.8, §6.2, §6.12, §6.13; architecture §4, §5.5, §5.6, §5.8, §5.13; `docs/modules/finance.md`; `docs/ui.md`.
