# ADR-0109: The till's payment step — explicit tenders and receipt type, credit sales to a registered customer invoiced at the centre

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-27 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

The owner asked on 2026-10-27: «касс дээр төлбөрийн хэлбэр, нөат хувь эсвэл байгууллага, мөн зээлээр заавал харилцагч сонгож гаргадаг болго.»

Until now:
- The till's payment dialog (S2, S3) inferred the payment from the cash and card amounts.
- It made a company receipt only when a buyer was looked up.
- A POS sale was always final and paid (ADR-0064 #1: no invoices and no receivables at the POS).

The supermarket also sells to registered wholesale customers who pay later. Wholesale orders run under the no-tolerance credit check, with the customer row locked before it (ADR-0060 #2, ADR-0101 #3, SPEC §6.2). The store edge must keep selling when the internet is down (ADR-0063, ADR-0067).

The owner's answers, in three rounds on 2026-10-27:
1. Credit sales work **offline too**, from the customer data the till pulled last.
2. **Partial credit** is allowed: part paid now, in cash or by card, the rest on credit.
3. **No supervisor PIN** for credit.
4. A sale that contains any credit gets **no e-Barimt**, and none is ever issued for it later. This covers mixed sales: the whole sale goes without a receipt.
5. The **books still carry its VAT**, like any sale. Only the printed slip shows none.
6. A **return** of a credit sale reduces the customer's debt first, then pays back in cash.
7. **Every ACTIVE customer** may buy on credit. Offline, a passed limit **warns, then sells** if the cashier goes on.
8. The credit slip prints **twice**, with a signature line and no due date.

## Decision

1. **Explicit choices at the till.**
   - The payment dialog asks first for «Төлбөрийн хэлбэр»: Бэлэн, Карт, Хольсон (cash + card) or Зээл.
   - It then asks for «e-Баримт»: Хувь хүн (B2C) or Байгууллага (B2B). B2B needs the company found by the online lookup (ADR-0065); otherwise the edge answers 422 `POS_BUYER_REQUIRED`.
   - `EdgeSaleRequest` gains `receiptType`, `customerId` and `acceptOverLimit`. An older kiosk without `receiptType` keeps today's rule: B2B when a buyer is given.
2. **A CREDIT tender.**
   - `TENDER_KINDS` = CASH, CARD, CREDIT. `pos_tenders_kind` widens in migration `0048_pos_credit`.
   - A sale has at most one CREDIT tender. CREDIT has no `tendered`, and it names its customer: `SaleDocWire.customerId`, required exactly when there is credit.
   - A sale with credit is B2C with no TIN and no consumer number, and its e-Barimt status is NONE. The edge queues no receipt for it.
   - CHECKs `pos_sales_credit` and `pos_sales_credit_docs` guard this.
3. **The customer feed.**
   - The edge pulls `GET /api/v1/pos/sync/customers?since=` beside the snapshot, on every pull (60 s). It carries every ACTIVE customer: id, code, name, TIN, registration number, phone, hold, limit, and exposure when built. Exposure = the Finance Core's net receivable + confirmed wholesale orders not yet invoiced.
   - The feed has its own content-hash version, so a moving balance never resends the catalog.
   - The edge keeps it in `edge_state.customers` (edge migration `0003_credit`) and serves the till's search: `GET /edge/v1/customers?q=` by code, name, phone, TIN or registration number, and `GET /edge/v1/customers/:id`. It shows the limit left after this edge's own credit not yet counted by the centre.
4. **The credit check before a credit sale** (`CreditGate`, with no edge transaction open).
   - **Online:** the edge asks `POST /api/v1/pos/sync/credit-check` within `EDGE_CREDIT_CHECK_TIMEOUT_MS` (3 000 ms). It sends the amount and `pendingOnEdge`, the credit of its documents not replayed yet.
     - The centre locks the customer row, then its party (lock order of SPEC §6.2 #6), and applies finance's `CreditControlService.check` with the customer's open orders (`SalesOrderQueryService.openExposureInTx`). The rule is the wholesale one: no tolerance, refused on hold or past the limit.
     - It writes nothing.
     - A refusal is 409 `CREDIT_BLOCKED` with `reason` (HOLD / LIMIT / INACTIVE), `exposure`, `limit` and `excess`.
   - **Offline** (no answer in time, or a 5xx): the edge decides from the feed, as `available = limit − exposure − this edge's credit the feed does not count`.
     - A hold is refused (`CREDIT_BLOCKED` HOLD).
     - A passed limit answers 409 `POS_CREDIT_OFFLINE_OVER_LIMIT` with `available` and `excess`. The kiosk shows the warning and sells only when the cashier sends the same sale again with `acceptOverLimit`.
     - A 4xx answer, meaning the customer is gone, is refused as INACTIVE.
5. **The centre accepts every credit sale; it never refuses one** (ADR-0063 #5: the till has sold it).
   - In `PosAcceptService.acceptSale` the lock order becomes: the shift → a return's sale and lines → **the customer row → its party** → SALESFLOOR → posting locks → counters.
   - The credit check is run again on the credit part. A HOLD, an inactive customer or a passed limit is stored as `pos_sales.credit_excess`: the excess, or the whole credit on a hold or an inactive customer. It is audited and counted in `GET /pos/attention` as `creditToCheck`.
   - The office marks it «Шалгасан» with `POST /pos/sales/:id/credit-review` [`pos.manage`].
   - An unknown customer is a permanent rejection (`NOT_FOUND`).
6. **The invoice** (`PosCreditService.invoiceSaleInTx`, finance; amends ADR-0064 #1). In the transaction that accepts a sale with credit:
   - **The invoice row.** One `invoices` row for the whole sale: Н- number, `order_id` null, `order_number` = the till's number, `payment_method` CREDIT, the store's branch. It is due on the customer's settlement day (`settlementDueDate`, ADR-0101).
   - **The lines.** One line per till line, with its VAT inside. The supermarket charges no city tax.
   - **The posting.** It is posted as `BTO.SALES_INVOICE` (class AR_INVOICE):
     - Dr AR for the credit part only, opening the item;
     - Dr POS_CASH and CARD_CLEARING for what the till took;
     - Cr **POS_SALES** net of VAT, so the supermarket's revenue stays in one account;
     - Cr VAT_PAYABLE.
   - The invoice's `open_amount` is the credit part. `pos_sales.invoice_id` and `credit_doc_number` link the two.
   - Sales without credit keep ADR-0064 #1 unchanged.
7. **Its return** (`PosCreditService.creditReturnInTx`).
   - The edge splits the refund with `refundSplit`: off the debt first, up to the sale's credit not yet taken back, then the rest in cash. The centre checks the split.
   - A return with a credit part is a money-only credit note, since the till's return moved the goods. It is posted as `BTO.SALES_RETURN`:
     - Dr SALES_RETURN and VAT_PAYABLE;
     - Cr AR for the credit part, settling the invoice up to what is open;
     - Cr POS_CASH for the cash paid back.
   - A return with no credit part left is an ordinary cash return, booked by the shift's close.
   - There is no e-Barimt either way.
8. **The shift's close** (`shiftCloseLines`, amends ADR-0064 #2).
   - Sales with an invoice and returns with a credit note are left out of POS_SALES, SALES_RETURN and VAT. Their cash and card come off POS_CASH and CARD_CLEARING (`PosShiftsService.booked`).
   - The counted cash, the expected cash (float + cash sales − cash refunds) and the variance remain the drawer's.
   - `pos_shifts.credit_sales` and `credit_refunds` keep the CREDIT tenders for the Z, which the till and the admin show.
9. **Modules.**
   - `MODULE_DEPS.pos` adds `partners` (the customer lock and list) and `sales` (the open-order sums; `assertCredit` now uses the same `openExposureInTx`).
   - `CreditCheckInput.orderId` may be null, for a till's credit part.
   - The management reports count a credit sale once, as POS with its customer: `reporting.sales_lines` leaves out the invoices and credit notes that a `pos_sales` row names (0048).
10. **The slip.**
    - A sale with credit prints «ЗЭЭЛИЙН ТАСАЛБАР · e-Баримт биш» in two copies, «Харилцагчийн хувь» and «Дэлгүүрийн хувь», one sheet each.
    - It shows the customer's name and code, the lines, the total, the cash, card and credit parts, and a line for the signature.
    - It has no VAT line, QR, lottery or due date.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Credit only while the centre answers | The owner wants credit sales offline too (answer 1). |
| A credit reservation at the centre between the check and the replay | More state (expiry, release) for a window of seconds; an accepted sale is never refused anyway, and the excess is flagged. |
| Customers inside the snapshot | Every balance change would resend 20 000 products; a separate feed has its own version. |
| An invoice only for the credit part, VAT pro-rated | Pro-rated VAT per line is guesswork; one invoice for the sale with the paid part booked on it keeps the lines exact. |
| A receipt-type choice for credit sales too | The owner: no e-Barimt for credit (answers 4, 5). |

## Consequences

**Positive.**
- The cashier states the payment and the receipt.
- Credit sales reach the customer's receivable, statement, aging and «Bto300» at once, under the same limit as wholesale orders.
- The till keeps selling offline, and the office sees every excess.

**Negative.**
- **e-Barimt.** A credit sale has no e-Barimt by the owner's choice (answers 4, 5), although SPEC §6 makes a receipt mandatory for every sale. The ledger keeps its VAT, so the VAT report and the e-Barimt totals will differ by these sales.
- **Offline limit.** Offline credit can pass the limit, even across two tills, until the centre notes it.
- **Invoices.** Invoices now exist without an order.

**Follow-ups.**
- `TODO-VERIFY` (accountant): whether credit sales without e-Barimt are acceptable, and how they appear in the VAT report; the owner's answer stands until then.
- The card terminal's data on a credit sale's card part, as for any card tender (ADR-0065 open item).
- The `ai.pos_*` views (S4) show the credit fields.

## Related

ADR-0060, ADR-0063, ADR-0064 (amended: #1 and #2 for sales with credit), ADR-0065, ADR-0067, ADR-0073, ADR-0090, ADR-0101, ADR-0104, ADR-0108; `docs/modules/pos.md`; SPEC §5.7, §6.2.
