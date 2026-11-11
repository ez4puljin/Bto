# Module `ebarimt` — contract

| | |
|---|---|
| Status | Built 2026-11-11 (ADR-0185): the wholesale invoices' e-Barimt receipts, issued by the store PC's PosAPI through the store edge that pulls them. Off until `EBARIMT_WHOLESALE_RELAY` is on at the store edge **and** «e-Barimt гаргах» is ticked on a sales stage |
| ADRs | ADR-0185 (the relay), ADR-0074 (keyed by the source document, the request by value), ADR-0017 (never a blind retry, the lottery and QR never stored), ADR-0065 (the store PosAPI and `buildPosapiReceipt`) |
| Depends on | identity (audit, rights) (`MODULE_DEPS.ebarimt`); `@tugeel/shared/mn` for the rules and the wire shapes |
| Imported by | finance (prepares and cancels receipts, shows a receipt on its invoice), pos (lends the store edge's sync channel to the relay) |

Not to be confused with `ebarimt-check` («Ebarimt», ADR-0168): that module compares purchases with the tax office's file and issues nothing.

## 1. Owned table (migration `0100_ebarimt_receipts`)

| Table | Holds | Guards |
|---|---|---|
| `ebarimt_receipts` | a source document's receipt: the key `company_code`, `source_system`, `source_doc_type`, `source_doc_id` (text, no foreign key), `source_revision`; what the list shows (`doc_number`, `order_number`, `buyer_name`); the business request (`receipt_type` B2C / B2B, `customer_tin`, `consumer_no`, `lines` and `payments` jsonb as `RelayReceiptLine` / `RelayPayment`, `total`, `vat_total`, `city_tax_total`); the state (`status`, `error_code`, `message`, `attempt`, `claimed_at`, `claimed_node_id` + `claimed_node_code`, `next_attempt_at`); the facts PosAPI answered (`ddtd`, `posapi_date` verbatim, `issued_at`, `merchant_tin`, `merchant_name`); a person's decision (`resolved_by`, `resolved_at`); the cancellation (`cancel_status`, `cancel_reason`, `cancel_requested_at`, `cancel_attempt`, `cancel_claimed_at`, `cancel_node_id`, `cancel_next_attempt_at`, `cancel_message`, `cancelled_at`) | the source key unique; `status` and `cancel_status` lists; `total > 0`; CONFIRMED names its ДДТД and date; SENDING names its claim; the ДДТД is 20–40 digits; `REVOKE DELETE, TRUNCATE` from `app`. No column for a lottery or QR data |

The request never holds the merchant's TIN, `posNo`, district or branch number: the store edge adds them. `claimed_node_id` is a plain id (`pos_edge_nodes` belongs to pos, above this module).

## 2. States

| `status` | Meaning | Next |
|---|---|---|
| PENDING | waits for an edge (after `next_attempt_at`) | a claim → SENDING |
| SENDING | an edge holds it (`attempt`, `claimed_at`) | its result; no result for ten minutes reads INDETERMINATE |
| CONFIRMED | PosAPI issued it: ДДТД and date | print; a void queues its cancellation |
| ERROR | not issued: `TIN_PENDING`, a build error (`NO_LINES`, `TAX_PRODUCT_CODE_MISSING`, `CLASSIFICATION_CODE_INVALID`, `CUSTOMER_TIN_INVALID`, `PAYMENTS_MISMATCH`), `POSAPI_REFUSED`, `EDGE_BUILD` | a person prepares it again (`POST /invoices/:id/ebarimt`) |
| INDETERMINATE | the call may have reached PosAPI | the accountant, after ebarimt.mn: ISSUED → CONFIRMED, NOT_ISSUED → PENDING. Never automatic |
| CANCELLED | never issued and its document voided, or cancelled at PosAPI | — |

`cancel_status`: null (none asked), PENDING → SENDING → DONE, or ERROR / INDETERMINATE until the accountant sends it again or records it as cancelled.

## 3. Public API (`modules/ebarimt/index.ts`)

| Export | Use |
|---|---|
| `EbarimtModule` / `EbarimtHttpModule` | the services; the controller (api) |
| `EbarimtReceiptsService.prepareInTx(tx, actor, request)` | in the caller's transaction: writes the receipt PENDING, or ERROR with the reason (never throws for a data problem); a row in ERROR is prepared again in place, any other state refuses (409 `EBARIMT_RECEIPT_STATE_INVALID`) |
| `…requestCancelInTx(tx, actor, source, reason)` | the document was voided: cancelled at once when never issued, else a cancellation for the edge |
| `…bySourceInTx(executor, source, lock?)` / `stateOf(source)` | the receipt of a source document |
| `…list(query)` / `get(id)` / `attention()` / `printable(id)` | the accountant's reads; `printable` hands the secrets out once |
| `…resolve(ctx, id, { outcome, ddtd, posapiDate })` / `resolveCancel(ctx, id, outcome)` | the accountant's decisions |
| `EbarimtRelayService.claim(node, actor)` / `result(node, actor, wire)` / `lastSeen()` | the centre's half of the relay (called by pos's sync routes) |
| `ReceiptSecretsCache` | the api process's memory for the lottery and QR data: `put`, `take` (once), `has`, `forget`; 30 minutes, 500 receipts |
| `EbarimtReceiptDto`, `toReceiptDto`, `EbarimtRelayResultDto`, `EbarimtRelayResultResponseDto` | shapes other modules' routes answer or take |

`PrepareRequest`: `source` (`companyCode`, `system`, `docType`, `docId`), `docNumber`, `orderNumber`, `buyerName`, `buyer` (`kind`, `tin`, `consumerNo`), `lines`, `payments`, `total`, `vatTotal`, `cityTaxTotal`. The module reads no business table.

## 4. REST surface (`/api/v1`)

| Route | Does |
|---|---|
| `GET /ebarimt/receipts` [`finance.read`] | the list, newest first: `status` (as a person sees it), `cancelOpen`, `type`, `q` (document or order number, buyer, TIN, ДДТД), keyset `{ data, nextCursor }` |
| `GET /ebarimt/receipts/attention` [`finance.read`] | `pending`, `error`, `indeterminate`, `cancelOpen`, and when an edge last asked (`relaySeenAt`, `relayNodeCode`; this process's memory) |
| `GET /ebarimt/receipts/:id` [`finance.read`] | one receipt with its lines, payments and the merchant |
| `POST /ebarimt/receipts/:id/print` [`finance.read`] | `{ receipt, secrets, copy }`: the lottery and QR data on the first call while the api holds them, a copy afterwards; `Cache-Control: no-store`; 409 unless CONFIRMED |
| `POST /ebarimt/receipts/:id/resolve` [`finance.invoices.manage`] | an INDETERMINATE receipt: `ISSUED` with `ddtd` (20–40 digits) and `posapiDate` (`yyyy-MM-dd HH:mm:ss`), or `NOT_ISSUED` |
| `POST /ebarimt/receipts/:id/cancel-resolve` [`finance.invoices.manage`] | a cancellation in ERROR or INDETERMINATE: `RETRY` or `CANCELLED` |
| `POST /invoices/:id/ebarimt` [`finance.invoices.manage`] (finance) | «Дахин бэлтгэх»: an ERROR receipt rebuilt from its invoice |
| `POST /pos/sync/ebarimt/claim`, `POST /pos/sync/ebarimt/result` [edge token] (pos) | the relay |

## 5. Rules worth knowing

- **Who gets a receipt.** A sale on a stage with `sales_stages.ebarimt`, paid `CASH` or `BANK_TRANSFER`, with a positive total. A `CREDIT` order gets none (TODO-VERIFY with the accountant, ADR-0185 #4).
- **The check at prepare.** `checkRelayReceipt` builds the request with placeholder merchant facts; a line without a classification code passes (the store's default fills it at the edge).
- **The claim.** In one transaction: stale claims become INDETERMINATE (audited as `ebarimt:sweep`); a row this node already holds is handed again with the same attempt; else the oldest due PENDING row without a cancellation, then the oldest due cancellation of a CONFIRMED row; `FOR UPDATE SKIP LOCKED`.
- **The result.** Under the row's lock. ISSUED applies to the attempt it answers unless the row is CONFIRMED or CANCELLED; every other outcome only while the row is SENDING, or INDETERMINATE with no decision yet. NOT_SENT waits 30 s doubling to 30 minutes. A document voided meanwhile: a not-issued outcome closes the row as CANCELLED.
- **Secrets.** `result` splits `lottery` and `qrData` off the wire before anything is written and `put`s them in the cache after the commit. Nothing else in the module ever sees them.
- **Lock order.** The invoice's own locks (customer, invoice) come first in finance; this module locks only its own row.

## 6. Audit

`ebarimt_receipts`: PREPARE, PREPARE_AGAIN, CLAIM (operation, attempt, node), RESULT and CANCEL_RESULT (outcome, ДДТД; `reason: STALE` from the sweep), UNEXPECTED_RECEIPT, RESOLVE, CANCEL_REQUEST, CANCEL_RESOLVE. The edge acts as `edge:<code>`. Never a lottery or QR data.

## 7. Screens

`/finance/ebarimt-receipts` «e-Barimt баримт» (menu «Санхүү», `finance.read`; refreshes every 15 s) and `/finance/ebarimt-receipts/:id/print`; the invoice's panel shows «e-Barimt» with the state and a link to the list; «e-Barimt гаргах» in the stage dialog (`sales.boards.ebarimt`).

## 8. Tests

`test/integration/ebarimt-wholesale.int-spec.ts` (a listening centre, the edge with the relay on, a fake PosAPI: the sale → PENDING → claim → issue → CONFIRMED with the store's facts; the lottery printed once; B2B with a transfer; a company without a TIN prepared again; a refusal; PosAPI away; an unanswered call resolved both ways; a restart in the middle of a call; a lost claim; a stale claim; a void's cancellation and a never-issued one; nothing without the switch or for a credit order; the routes' token; no secret in any table, audit row or log line). `test/integrity/ebarimt-guards.spec.ts` (the REVOKEs and CHECKs, one row per source key, the stage switch's column and CHECK, no secret column, eight edges claiming three receipts at once, one result repeated six times at once). `src/modules/ebarimt/services/receipt-secrets.cache.spec.ts`; `packages/shared/src/mn/relay.test.ts`; `apps/web/src/features/finance/ebarimt-receipts.test.tsx`. All against `test/harness/fake-posapi.ts`; never a real PosAPI.

## 9. Open items

- TODO-VERIFY with the accountant: the PosAPI payment code and tax point of a credit sale; whether the wholesale centre needs its own branch number at PosAPI; credit notes and partial returns through `inactiveId`.
- Not built: `ai` views, `ebarimt_config`, a submission log, `billIdSuffix`, the jobs of ADR-0017.
