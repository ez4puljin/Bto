# ADR-0085: The store's statement on «Тооцоо» — Дебит and Кредит, opening and closing balances, any days, the last month first

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-20 |
| Deciders | Owner (asked 2026-10-20: «Тооцоо цэс дээр Кредит болон Дебит багануудтай болгож харуул … Эхний болон эцсийн үлдэгдэлтэй. Date_range тайлангаа харах боломжтой. Default нь сүүлийн нэг сарынх»), Claude (Claude Code session, CA3) |
| Amends | ADR-0079 #7 and #13 («Тооцоо» gains a statement before the open invoices and the payments) |
| Related | ADR-0060 (the receivables ledger), ADR-0082 (the customer routes), ADR-0084 (the app's build) |

## Context

«Тооцоо» in «Bto300» (ADR-0079 #7, the Account board) showed the balance, the open invoices and the payments as two lists. After seeing the app the owner asked for the account as a statement: the purchases and the payments side by side in two columns, Дебит and Кредит, with the balance at the start and at the end, for any days, the last month by default — the way accountants read a customer's settlement.

Finance already keeps every receivable movement in the append-only ledger `ar_entries` (ADR-0060): invoices and refunds as debits, payments, credit notes and voids as credits, each with its business date and document number.

## Decision

1. **Finance owns the read.** `ArLedgerService.statement(customerId, from, to)` returns the balance before `from` («Эхний үлдэгдэл»), every entry dated `from` … `to` oldest first (by date, then as recorded) with its debit, credit and the balance after it, the two totals and the balance after `to` («Эцсийн үлдэгдэл» = opening + Σ debit − Σ credit). It is exported from finance's `index.ts`; the office's own statement can use it later.
2. **One customer route.** `GET /customer-app/statement?from&to` (the token's own store, as every customer route): business dates of Ulaanbaatar, `to` today at the latest, `from` ≤ `to`, at most 366 days (422 `VALIDATION_FAILED` otherwise). Each entry carries its kind (`INVOICE`, `PAYMENT`, `CREDIT_NOTE`, `REFUND`, `ADJUSTMENT`, `OPENING`, `VOID`), its number and, for an invoice's entry, the invoice to open. Amounts in two decimals; a negative balance is an advance.
3. **The app.** «Тооцоо» keeps its debt card; under it three parts: **«Хуулга»** (first and chosen), «Нэхэмжлэх (n)», «Төлбөр (n)». «Хуулга» shows the days as a chip (the last month at first: the day after the same date a month ago … today; the calendar sheet of «Захиалга» for any range), then one card: the columns «Огноо, баримт · Дебит · Кредит», «Эхний үлдэгдэл», one row per entry (the number, the day and the kind in the store's words — «Худалдан авалт», «Төлбөр», «Бараа буцаалт», «Буцаан олгосон», «Залруулга», «Хүчингүй болсон» — and «Үлдэгдэл …» after it; a purchase opens its invoice), «Нийт» with both totals, «Эцсийн үлдэгдэл». A zero is left out of its column. A sent order refreshes it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Building the statement in the customer module from the ledger page | The ledger is finance's; its paging is newest first by id, a statement is by date. Finance computing it once keeps the rule in one place. |
| Replacing the invoice and payment lists | The open invoices with their due days and the bank advice are still what a store pays from; the statement sits first beside them. |
| A running-balance column | Five columns do not fit a phone; the balance after each entry is a line under it. |
| Paging the statement | A store's month holds a few dozen entries; a year at most a few hundred. The 366-day limit bounds it. |

## Consequences

- Positive: the store sees its account as the accountant does, for any period, from the same ledger the credit check uses.
- Negative: a period of many hundred entries arrives in one answer (bounded by a year).
- Follow-ups: the same statement on the office's customer page and as a printable or Excel file if the owner asks; the Finance Core's open items replace the ledger at go-live (ADR-0077), and the route keeps its shape.

## Related

ADR-0060, ADR-0079, ADR-0082, ADR-0084, `docs/modules/customer.md`, `docs/modules/finance.md`, `docs/modules/mobile.md` §1a.
