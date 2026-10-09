# ADR-0018: Payments: QPay Merchant v2 as the single QR rail, callback-then-check, Khan Bank statements

| | |
|---|---|
| Status | Deferred (principles accepted now; implementation in delivery 5, reused in delivery 6, bank reconciliation in delivery 10) |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

Facts (`docs/architecture.md` §9, §13): a QPay QR is payable from all Mongolian bank apps and wallets, including SocialPay; the sandbox (`merchant-sandbox.qpay.mn`) needs no contract; the fee is about 1 % with no setup fee; `sender_invoice_no` must be unique and never reused; the callback contract is undocumented and must not be trusted; QPay forbids cron-polling `POST /v2/payment/check` ("check only after receiving the callback"); `POST /v2/payment/list` exists with a date filter; invoices return bank-app deep links in `urls[]`; SocialPay wallets cap invoices at 1,000,000 MNT and have a 1,000,000 MNT daily limit; Golomt E-Merchant needs an SSL website and a 6-month account; bank corporate gateways are contract-gated with per-bank specifications. The company's main bank is **Khan Bank**; its Corporate Gateway is delivered through ERP developers with keys issued by email, test rights first.

## Decision

1. **Provider interface** in finance: `PaymentProvider { createInvoice, cancelInvoice, checkPayment, parseCallback, listPayments }` with QPay Merchant v2 as the first and only launch implementation; sandbox/production hosts by configuration; the access token's `expires_in` is read from the live token response.
2. **`payment_intents`**: `id` is the `sender_invoice_no` (globally unique, never reused), `invoice_id`, `provider`, `provider_invoice_id`, `qr_text`, `short_url`, `deeplinks` JSONB (`urls[]`), `amount`, `allow_partial`, `status` NEW/PAID/PARTIAL/CANCELLED/EXPIRED, `payment_id`, `payment_wallet`, `payment_fee`, `paid_at`. Gross and fee are stored separately for reconciliation.
3. **Callback-then-check.** `/api/webhooks/qpay` logs the raw callback verbatim, returns HTTP 200 `SUCCESS` immediately and enqueues `qpay.check` (ADR-0013). The job calls `POST /v2/payment/check` (`object_type INVOICE`) and marks the intent paid **only** when a row with `payment_status = PAID` and amount >= due exists; duplicate callbacks are harmless. A payment row is then recorded by `PaymentsService.record` and allocated.
4. **No cron polling of `payment/check`.** The user-triggered "check status" button on the checkout and driver screens calls `checkPayment` with bounded backoff. The **stale-intent sweep (`qpay.sweep`) runs 1-2 times a day through `POST /v2/payment/list`** over the last 48 hours (a different endpoint, defensible as reconciliation); the owner confirms acceptability with `support@qpay.mn` at contract time (TODO-VERIFY).
5. **Large invoices.** Intents above the wallet cap are created with `allow_partial = true`; the customer app shows the bank-app deep links from `urls[]` first (bank-app limits apply instead of the wallet cap). For invoices beyond what a shop can pay by QR in a day, the documented path is **plain bank transfer to the Khan Bank account with the invoice number in the description**, matched by statement import.
6. **Bank reconciliation** starts with **manual Excel/CSV statement import** (delivery 10) normalised to `{bank, account, record_no, posted_date, amount, dr_cr, description, counterparty_account, counterparty_name}`, de-duplicated by `(bank, account, record_no)`, matched by invoice number in the description, then counterparty account mapped to customer, then exact amount, then manually. A **Khan Bank Corporate Gateway puller** (statement by "after record number" cursor, up to 100 rows per call) is added later behind the same statement-source interface; the CGW contract is requested in Week 0 because credentials are issued manually and test-first.
7. Cash collection by drivers goes through cash sessions in finance; QPay collection at the door uses the same intents shown on the driver phone.
8. SocialPay direct (Golomt Instore) and the Byl aggregator remain optional second providers behind the interface; neither is a launch requirement.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Per-bank QR integrations | QPay already covers every bank app and wallet. |
| SocialPay-first | Wallet caps; Golomt E-Merchant eligibility rules; SocialPay already pays QPay QRs. |
| Byl as the only rail | Dependence on a small vendor for a 500-orders/day business. |
| Trusting the callback body | Undocumented contract; marking paid from it is forbidden by our own rule. |
| Scheduled `payment/check` polling | Explicitly prohibited by QPay. |
| QPay `ebarimt_v3` for all receipts | Only covers QPay-paid sales (ADR-0017 fallback only). |

## Consequences

**Positive.** One integration covers all wallets; contract tests against recorded sandbox responses; large invoices have a documented non-QR path; reconciliation works from day one of delivery 10 with no bank API.

**Negative.** Onboarding lead time (QPay contract, vendor credentials, Khan CGW keys) is outside the owner's control; manual statement import is owner work until the puller exists.

**Follow-ups.** Week 0: QPay contract at `business.qpay.mn`, vendor credentials request, Khan Bank CGW contract. Delivery 5: provider, intents, webhook, check job, sweep, driver collection. Delivery 6: customer-app payment screen with deep links. Delivery 10: statement import, matching, Khan puller.

## Related

ADR-0004, ADR-0010, ADR-0013, ADR-0016, ADR-0017, `docs/architecture.md` §5.8, §9, §13, `docs/SPEC.md` §6, §11.
