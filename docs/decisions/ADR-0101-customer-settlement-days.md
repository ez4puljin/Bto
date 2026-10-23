# ADR-0101: Customer settlement days by group («Мөрөн» on the 20th, «Орон нутаг» at month end), and an overdue debt that only reminds

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-23 |
| Deciders | Owner (the rule, 2026-10-21 in the «Bto300» chat; eight answers, 2026-10-23), Claude (Claude Code session started by «Bto удирдлага») |
| Supersedes | ADR-0060 #2 in part (the one payment term in days, `credit.payment_term_days`, and the OVERDUE refusal), ADR-0073 #5 (the overdue rule netted with open credits, `credit.overdue_nets_credits`), `docs/modules/finance-core.md` §10's OVERDUE default |
| Amends | ADR-0015 (the customer's `payment_term_days` is dropped), ADR-0036 (the CUSTOMERS import's column), ADR-0079 #7 and ADR-0096 #6 («Тооцоо»'s settlement fields), ADR-0082 (the cart's OVERDUE warning stays a warning) |

## Context

Until now an invoice fell due `invoice date + payment term`. The term was 30 days from `credit.payment_term_days` (ADR-0060 #2), and a customer could have its own term. An overdue invoice refused every new order (OVERDUE). From the Finance Core's exposure, ADR-0073 #5 softened that: the order was refused only when the overdue amount was larger than the customer's open credits.

The owner described how the business really settles (2026-10-21, in the «Bto300» chat):

- Mörön stores pay on the 20th for what they bought from the 21st of the last month to the 20th of this month.
- Countryside stores («Орон нутаг») pay at the end of the month for that month's purchases.
- An overdue debt only reminds and never blocks.
- The group is chosen on the customer card.

«Bto300»'s approved Account board (version 28) draws the result as a card under the debt: «Тооцоо хийх өдөр 10/31 · 10 хоног үлдлээ | Төлөх дүн 1,284,600₮ · 10-р сарын авалт» (ADR-0096 #6).

Answers of 2026-10-23 (two AskUserQuestion rounds):

1. The group is **required**: no default, neither on the card nor for a new customer in the import.
2. `payment_term_days` is **removed** for customers, and the company setting with it; suppliers keep theirs.
3. A Saturday, a Sunday or a holiday **moves nothing**: the 20th and the month's last day stand.
4. **Cash sales** follow the group rule like every invoice.
5. **Invoices already posted** keep their due dates. The development database has no customers or invoices yet.
6. The card's «Төлөх дүн» is **everything due by that day**, with the overdue part in red under it.
7. The red reminder shows:
   - at the confirmation;
   - on the order panel and the board card;
   - on the customer card and the lists;
   - in the rep app.
8. Only the credit right (`partners.credit.manage`) changes the group later; the office picks it when creating the customer.

## Decision

1. **Two settlement groups on the customer** (`customers.settlement_group`, NOT NULL, CHECK `IN ('DAY_20','MONTH_END')`, migration `0040_settlement_days`):

   | Code | Shown as | Rule | Due date |
   |---|---|---|---|
   | `DAY_20` | «Мөрөн» | purchases from the previous month's 21st to this month's 20th | the 20th |
   | `MONTH_END` | «Орон нутаг» | a calendar month's purchases | its last day (28th/29th Feb included) |

   The codes name the rule, not the place, so a third group later is a new code. A weekend or holiday moves nothing.

2. **One shared rule** in `@tugeel/shared/finance` (`settlement.ts`), used by the api, the web and the apps:
   - `settlementPeriodOf(group, date)` gives `{from, to, dueDate}`;
   - `settlementDueDate(group, invoiceDate)`;
   - `settlementSummary(group, today, {net, overdue})` gives the current period, its day, the days left, «Төлөх дүн» = max(0, net) and the overdue part, which is never above it.

   Dates are Ulaanbaatar business dates (`businessDate()`), handled as plain calendar dates with dayjs. An invoice's `due_date` is `settlementDueDate(customer.settlementGroup, invoice date)`, read under the customer lock in the sale's transaction. That holds for every payment method, cash included. The due date goes to the Finance Core's open item as before.

3. **An overdue debt never refuses an order.**
   - The credit check is HOLD → LIMIT; the OVERDUE refusal is gone.
   - `credit.overdue_nets_credits` and the param `creditsOpen` go with it.
   - The 409 `CREDIT_BLOCKED` keeps `overdueAmount` and `oldestDueDate` for the message.
   - The Finance Core's `exposureInTx` still reports `overdue` and `creditsOpen`: it is a reader, and the policy (Bto's, ADR-0073 #1) no longer refuses on them.
   - The limit and the manual hold still block, for every payment method.

4. **The days are gone.**
   - `customers.payment_term_days` and the setting `credit.payment_term_days` are dropped. Old setting rows stay as history; the settings list ignores keys it no longer knows.
   - `CreditTerms` and `LockedCustomer` carry `settlementGroup` instead of the term.
   - `PUT /customers/:id/credit` takes `{creditLimit, settlementGroup, creditHold, creditHoldReason}` (audit `CREDIT`).
   - `POST /customers` requires `settlementGroup`; PATCH never changes it.
   - Rows that existed before the migration become `DAY_20`; there were none in `tugeel`, only in test copies.
   - `ai.customers` is recreated with `settlement_group`.

5. **The reminder's data.** partners declares `CUSTOMER_DEBT_READER`; finance binds it with `CustomerDebtsService`, as fin-bridge binds `CUSTOMER_CHANGED_HOOK` (ADR-0084), and partners never imports finance. The reader sums the overdue open amounts for a page of customers in one statement, from the invoices' open amounts, which mirror the core's items. `CustomersService.overdueOf(ids)` returns an empty map while finance is not loaded. The data reaches:
   - `GET /customers` rows: `settlementGroup`, `overdue {amount, oldestDueDate} | null`, and the filter `settlementGroup`;
   - the order detail, list rows and board cards: `customerOverdue`;
   - the rep app's `GET /sales-rep/customers`, `/customers/:id` and `/map`: `overdue`;
   - `GET /customer-balances…`: `settlementGroup`;
   - `GET /customer-app/account`: `settlement {group, periodFrom, periodTo, dueDate, daysLeft, amountDue, overdueAmount}`;
   - `GET /customer-app/me`: `settlementGroup`, replacing `paymentTermDays`.

6. **Screens.**
   - **New customer form:** a required «Тооцооны бүлэг» select with no default.
   - **«Зээл» card:** shows the group with its rule and edits it with the credit right.
   - **Customer list:** the columns «Тооцооны бүлэг» (hidden by default) and «Хугацаа хэтэрсэн» (shown, in red), and a group filter (`?group=`).
   - **«Тооцоо» card:** a tile «Тооцоо хийх өдөр» with «Төлөх дүн» and the days left.
   - **`/finance/customers`:** a group column and the overdue amount in red.
   - **Order panel:** a red line «Хугацаа хэтэрсэн өр N₮ (date-с)».
   - **Board card:** a red mark beside the customer.
   - **Confirmation:** a move into a CONFIRM stage of a customer with an overdue debt confirms, then shows a red toast (a new `warning` tone of `lib/toast`).
   - **«Bto300»:** the cart and checkout text says the order is not held. «Тооцоо» and «Профайл» show the settlement day in place of the term in days.
   - **Left to the app chats** (the server fields exist): «Bto300»'s full card on the Account board, and the rep app's red mark.

7. **The CUSTOMERS import** loses «Төлбөрийн хугацаа» and gains «Тооцооны бүлэг» (`settlementGroup`).
   - It reads «Мөрөн» / «Орон нутаг» (also `DAY_20` / `MONTH_END`), ignoring case, spaces and hyphens.
   - The column is required for a new customer (`REQUIRED`); a word it cannot read is `FORMAT`.
   - A blank cell keeps an existing customer's group. A change goes through `setCreditInTx`, and the revert restores it like the limit.

## Consequences

- The due dates of a month's sales of one group coincide: the morning reminders (ADR-0082, 0–3 days ahead, 1–7 days overdue) fire for a store's whole period at once.
- Tests that relied on «today + 30» compute the due date with `settlementDueDate`. A test that needs an invoice far from the reminders moves its due date by hand.
- Aging and the overdue filters are unchanged; they read the new due dates.
- Drizzle numbering: main took `0042_receipt_discounts` before this branch merged, so the journal reads 0038, 0042, 0040. `drizzle-kit generate` takes the last snapshot by file name (0042), not the journal's last. A session that generates the next migration starts from `0040_snapshot.json` (or regenerates in two steps) so it does not repeat this one's changes. `drizzle-kit check` is clean.
- Kharkhorin is a separate installation (ADR-0084 #1); its groups, if any, are its own data.

## Rejected

- **Keeping `payment_term_days` as a per-customer exception** — the owner chose to remove it.
- **A default group** — the owner wants it chosen every time.
- **Moving a due date off a weekend or holiday** — the owner: no change; it would also need a holiday calendar.
- **A shorter term for cash sales** — the owner: the group rule for all.
- **Re-dating posted invoices** — they are immutable, and there were none.
