# ADR-0017: e-Barimt integration via PosAPI 3.0 on the office box, two-phase issue, certification gate

| | |
|---|---|
| Status | Deferred (principles accepted now; implementation in delivery 3, POS path in delivery 9) |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0026 (the week-1 spike runs from the owner's machine over Tailscale; production PosAPI comes with the go-live phase; the gate date is unchanged); ADR-0060 (the invoice an e-Barimt receipt will be built from exists; the receipt itself stays deferred); ADR-0074 ("Module": receipts are keyed by company and source document, with no `invoice_id` and no dependency on finance; the shared receipt rules live in `@tugeel/shared/mn`) |

## Context

Receipts are legally required for every sale. Facts (`docs/architecture.md` §9, §13): PosAPI 3.0 is the only integration path (2.0 shut down 2026-03-30); it is a standalone REST service on port 7080 with no authentication, reachable only from Mongolian networks and never to be exposed publicly; `lottery` and `qrData` may not be stored in any form other than printing; TIN is 11 digits (companies) or 12-14 digits (individuals), not the 7-digit registration number, and `customerTin` is validated as `[0-9]{11,14}`; items need a 7-digit classification code, `barCodeType`, `measureUnit`, and `taxProductCode` for VAT_FREE/VAT_ZERO; branches need `branchNo` and `districtCode`; `billIdSuffix` de-duplicates within a day; `POST /rest/receipt` can exceed 10 s and a client timeout does not mean failure, so blind retries create duplicate receipts; DELETE needs the exact `date` string PosAPI returned; one sub-receipt per tax type; header total = Σ sub-receipts = Σ payments; card payments carry `payments[].data` (terminalID, rrn, maskedCardNumber) with `easy = true`; `consumerNo` enables easy registration for B2C; vendor certification (non-Monpass digital signature, supplier-rights request, e-contract, ГТСМТТ exam) takes weeks and it is unconfirmed that an in-house system is certifiable. Customers are a mix of companies and individuals (ADR-0015). The supermarket has a Khan Bank card terminal.

## Decision

**Topology.** PosAPI runs on the office Ubuntu mini-PC over Tailscale (ADR-0012), bound to the `tailscale0` address with ACLs. A **second instance at the supermarket** is added in delivery 9; `ebarimt_config` has **one row per PosAPI instance** (`branch_id`, `base_url`, `pos_no`, `merchant_tin`, `branch_no`, `district_code`, `is_active`), and receipts are routed by branch. All `api.ebarimt.mn` lookups go through the office box.

**Module.** `ebarimt` is its own small module. Tables: `ebarimt_receipts` (`ddtd`, `type`, `status` PENDING/CONFIRMED/INDETERMINATE/ERROR/CANCELLED/UNCONFIRMED_RETURN, `bill_id_suffix`, `config_id`, `merchant_tin`, `customer_tin`, `consumer_no`, `district_code`, `branch_no`, `pos_no`, **`posapi_date` verbatim string + `issued_at timestamptz` derived**, `inactive_id`, `invoice_id`, `report_month`, `sub_receipt_ids` JSONB, `payments` JSONB incl. `data` for PAYMENT_CARD, `request_payload` JSONB, `response_summary` JSONB, `error_message`, `source_doc_type`, `source_doc_id`; canonical column list in `docs/architecture.md` §5.9), `ebarimt_submission_log` (request/response **without** `lottery`/`qrData`), `ebarimt_config`. **Never persisted anywhere: `lottery`, `qrData`** (the rasterised receipt bitmap in `print_jobs.payload`, nulled on ack and expired after 10 minutes, ADR-0022, is the only transit store). The HTTP client in `integrations/ebarimt` strips both fields from the parsed response before returning; they travel only in memory to the print path. Logs record `{id, status, message, date, receipts[].id}`; Sentry request/response body capture is disabled for this client; a test asserts neither key ever reaches the log, the submission log or Sentry breadcrumbs (ADR-0016). Reprints use the ДДТД only.

**Two-phase issue (no HTTP inside a transaction).** `EbarimtService.prepare(tx, snapshot)` then `issue(receiptId)`: tx1 (owned by the caller: POS checkout, invoicing) commits the sale/invoice/payment **and**, through `prepare`, an `ebarimt_receipts` row in `PENDING` with its `bill_id_suffix` already allocated from `number_sequences (scope_key = 'BILLID:<pos_no>', period = <UB date>)` and the `ebarimt.issue` job enqueued in the same tx; then the call to PosAPI happens **outside any transaction** with a 60-90 s timeout; tx2 updates the row to `CONFIRMED` (ddtd, posapi_date, sub-receipt ids) or `INDETERMINATE` (timeout/unknown) or `ERROR` (explicit rejection). POS awaits the `ebarimt.issue` job result synchronously; wholesale invoicing fires and forgets the same job (ADR-0013; singleton key `ebarimt.issue:<receiptId>`). **Never blind-retry**: an `INDETERMINATE` receipt is reconciled with the same `bill_id_suffix` (PosAPI local DB lookup, `/rest/info`, and after certification the ERP sales-list API) and until the week-1 spike settles the semantics, `INDETERMINATE` is a manual accountant queue, not an automatic re-issue.

**Receipt type per customer kind** (`docs/SPEC.md` §6.10). `COMPANY`: always `B2B_RECEIPT` with `customerTin`; a company whose TIN is still empty gets no receipt and fails with `TIN_PENDING` into the accountant's list, never a B2C receipt. `INDIVIDUAL`: `B2B_RECEIPT` when a TIN is present; otherwise `B2C_RECEIPT`, sent with `consumerNo` when the customer has a `consumer_no` (the receipt then lands in the citizen's ebarimt account and nothing needs printing), else with a lottery that must be printed or shown at the point of handover. POS sales are `B2C_RECEIPT` with optional `consumerNo` entry (8-digit or `11******` easy registration) on the POS screen. Payments map CASH, `PAYMENT_CARD` (terminal data in `data`, exactly one object with `easy = true`), `BANK_TRANSFER`, `BANK_TRANSFER_QPAY`. One sub-receipt per `taxType`; amounts per ADR-0010; a product missing e-Barimt attributes fails with `EBARIMT_ATTRIBUTES_MISSING` (ADR-0015).

**Timing of credit-sale receipts** is decided with the accountant **before delivery 3 starts** (TODO-VERIFY, `docs/SPEC.md` §11 #2). Default (a) per `docs/SPEC.md` §6.11 #8: the invoice is created at `DELIVERED` with the delivered quantities (or at pickup handover) and the `B2B_RECEIPT` is issued at that moment; option (b) is `B2B_INVOICE` at `DISPATCHED` with the receipt data on the office-printed delivery note and a receipt with `invoiceId` when payment arrives. Whether the driver prints the receipt is the accountant's call: if yes, driver raster printing (ADR-0021) moves from delivery 10 into delivery 5 and driver printers are bought in Week 0.

**Corrections.** `DELETE /rest/receipt {id, date}` with the verbatim `posapi_date`; corrections and partial refunds as new receipts with `inactiveId` chains; `reportMonth` backdating only for B2B types on the 1st-7th, computed in Asia/Ulaanbaatar. Nightly `ebarimt.sendData`; `ebarimt.monitor` refreshes `/health/ebarimt` (`leftLotteries`, `lastSentDate`).

**Week-1 spike** (staging PosAPI on the mini-PC, TEST OPERATOR1, merchant 37900846788): issue a test receipt from the droplet over the tailnet; **submit the same payload twice with the same `billIdSuffix` and record the response**; inspect PosAPI's local DB for lookup by suffix/posNo/date; force a timeout; print "Төв Үнэ ө ү" on the test printer.

**Certification gate (dated).** Email `posapi@itc.gov.mn` in Week 0 (`docs/STATUS.md` checklist #1) asking (a) whether an in-house single-company system can be certified, (b) whether a Tailscale-connected office box counts as "a module in the user system", (c) whether the exam demo may run with the backend abroad. **Hard decision date: end of delivery 1.** Without written confirmation by then, the pre-selected fallback is activated: a certified relay/operator vendor hosting PosAPI for the company (cash and transfer sales) plus QPay `ebarimt_v3` for QPay-paid sales. The `ReceiptProvider` interface (`prepare`, `issue`, `void`, `status`, `lookupTin`, `lookupInfo`; `PosApiProvider` is the default implementation) makes the fallback a configuration switch (`EBARIMT_PROVIDER=posapi|relay|qpay`), not a rewrite.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| PosAPI sidecar in Singapore | Mongolia-IP-only. |
| Calling PosAPI inside the sale transaction | Holds row locks and a pooled connection for up to 90 s; a crash after PosAPI answered leaves an orphan ДДТД with no sale. |
| Storing lottery/qrData "just in the log" | Forbidden by the official rule; logs are storage. |
| Treating every wholesale customer as B2B | Individuals without TIN cannot receive B2B receipts. |
| Automatic re-issue after timeout | Duplicate receipts and lotteries until duplicate-suffix semantics are verified. |
| One PosAPI for both sites | Supermarket checkout would depend on office connectivity forever. |
| Third-party SDKs | Known correctness bugs; a small typed client is written in-house. |

## Consequences

**Positive.** Legally compliant receipts for both customer kinds; no orphan receipts; a dated exit if certification stalls; the second instance isolates the supermarket.

**Negative.** A second box to monitor (and a third in delivery 9); sales cannot go live before deliveries 2 and 3 are both done; the accountant's timing answer gates delivery 3 planning.

**Follow-ups.** Week 0: ITC email, digital signature, staging access. Week 1: spike. End of delivery 1: certification decision. Delivery 3: the `ebarimt` module, `ebarimt.issue` job, B2B/B2C logic, leak test. Delivery 9: POS sync path, card data, second instance.

## Related

ADR-0002, ADR-0010, ADR-0012, ADR-0013, ADR-0015, ADR-0016, ADR-0018, ADR-0021, ADR-0022, `docs/architecture.md` §5.9, §9, §13, `docs/SPEC.md` §11.
