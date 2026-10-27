# ADR-0064: POS money: no invoices, one journal entry per closed shift, the cash handed to the accountant as a voucher

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-16 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0060 (#5: `PaymentsService.recordInTx` joins `record`, so another module's transaction can carry a voucher; #7: the roles `POS_CASH`, `CARD_CLEARING`, `POS_SALES`, `CASH_VARIANCE`, the source `AUTO_POS_SHIFT` and the source document `POS_SHIFT`), architecture §5.8 and §5.13 |
| Amended by | ADR-0071 (#2 to #4, mechanism only: the shift entry and the hand-over post through the intake contract in phase H2; the postings are unchanged); ADR-0072 (#4: the four POS roles become seeded posting rules; their accounts are control NONE with `drains`); ADR-0109 (#1, #2: a sale with a CREDIT tender is invoiced to its customer and its return credited, both left out of the shift's entry) |

## Context

Finance I (ADR-0060) books wholesale sales as invoices with a customer, a due date and a receivable, settled by vouchers. A supermarket till sells to walk-in customers for cash or by card, hundreds of times a day on eight tills, and is paid at once. The owner's words (2026-10-16): the cashier opens a shift with a float, closes it by counting the cash and recording the variance with a note, and the shift's cash is handed to the accountant and booked as the supermarket's cash income; card money lands in the bank account.

Three ways were weighed: an invoice per sale through `InvoicingService.onSold` (needs a `sales_orders` row and a customer, writes a receivable and a settlement per sale — thousands of `Н-` and `Т-` numbers a day for a receivable that never exists), a journal entry per sale (no receivable, but the journal fills with noise and the `JE_NO` counter is hammered on every replay), or one entry per closed shift plus the accountant's existing voucher for the hand-over.

## Decision

1. **No invoices and no receivables for POS sales.** A till sale is final when it is paid; its lines keep the VAT split per line (`taxSplit`, ADR-0010 #4) for the VAT report; nothing is written to `invoices`, `ar_entries` or `customer_balances`. A B2B receipt with the buyer's TIN is still a cash or card sale.
2. **One journal entry per closed shift** (`source = AUTO_POS_SHIFT`, `source_type = POS_SHIFT`, dated the Ulaanbaatar day of the close), posted inside the transaction that accepts the shift's close, from the shift's own documents:
   - Dr `POS_CASH` (counted cash − opening float): what the shift added to the cash in the tills;
   - Dr `CARD_CLEARING` (card sales − card refunds): what the bank owes until it settles;
   - Cr `POS_SALES` (sales − their VAT) and Cr `VAT_PAYABLE` (the sales' VAT);
   - Dr `SALES_RETURN` (returns − their VAT) and Dr `VAT_PAYABLE` (the returns' VAT);
   - the variance (counted − expected, expected = float + cash sales − cash refunds) on `CASH_VARIANCE`: Cr when the drawer holds more, Dr when it holds less.
   Zero lines are skipped; a shift that sold nothing and counted its float posts nothing. A negative movement swaps sides, so the entry always balances. The float itself is never booked: it stays in the drawer, and is the standing balance of `POS_CASH` between shifts (the first float is a one-time `OTHER_OUT` from the office cash box against `POS_CASH`).
3. **The hand-over is a voucher.** When the accountant receives the shift's cash («Бэлэн мөнгө хүлээн авах», permission `finance.payments.record`), the centre records an `OTHER_IN` voucher on the chosen cash box (the settings' default box) against the `POS_CASH` account, for the counted cash less the float kept by default, with the cashier as the one who handed it in and the shift's number as the reference, in the same transaction that marks the shift `HANDED_OVER`. `PaymentsService.recordInTx(tx, ctx, input)` exists for that; `record` wraps it. Card money is booked when the bank settles it: an `OTHER_IN` on the bank account against `CARD_CLEARING`, by hand now, by the statement matcher in delivery 10.
4. **Four default accounts** join the chart (`DEFAULT_GL_ACCOUNTS`, seeded at boot like the others; the accountant may renumber or move the roles): `100102` ASSET `POS_CASH` «Супермаркетын касс», `120301` ASSET `CARD_CLEARING` «Картын төлбөрийн авлага», `510102` INCOME `POS_SALES` «Супермаркетын борлуулалт», `740101` EXPENSE `CASH_VARIANCE` «Кассын зөрүү».
5. **What the shift records.** Opened with a float; closed with the counted cash, the float kept for the next shift, a note, the totals of its documents (counts, cash and card sales and refunds, sales and returns with their VAT), the expected cash, the variance and the entry's id and number; handed over with the voucher's id and number, when and by whom. A shift's totals are computed from its accepted documents at the close, never kept by the till.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| An invoice per sale with a walk-in customer | A receivable that is settled the same second, thousands of invoice and voucher numbers a day, the customer ledger filled with a customer that is nobody. |
| A journal entry per sale | No receivable, but the journal becomes a till log and every replay hits the journal counter; the per-line detail already lives in `pos_sale_lines`. |
| Tills as money accounts with transfer vouchers between accounts | Needs a new kind of voucher with two accounts and a book that shows both sides; the clearing account and the existing `OTHER_IN` do the same with no new finance concept. |
| Booking cost of goods sold at the close | Finance I deferred COGS postings for every sale (ADR-0060); the POS follows when they come. |

## Consequences

**Positive.** The journal shows one readable line per shift; the accountant's hand-over is the voucher they already know; the cash boxes, the bank and the chart need nothing new but four accounts; a variance is visible per shift and per account.

**Negative.** The books know the day's takings only when the shift closes (the open shift's live totals are shown in the admin, not booked); a shift closed offline is booked on the day the centre accepts it, which may be the next day; card settlements are matched by hand until delivery 10.

**Follow-ups.** The receipt-level e-Barimt facts (ADR-0065) and the VAT report by month read `pos_sale_lines`. COGS postings when Finance II adds them. The owner tells the accountant about the four accounts before the first hand-over.

## Related

ADR-0010, ADR-0060, ADR-0063, `docs/architecture.md` §5.8, §5.13, `docs/modules/finance.md`, `docs/modules/pos.md`.
