# ADR-0071: Source systems post through one versioned intake contract with a durable source key

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0027 (#1: a SOURCE principal beside STAFF; the staff token itself is unchanged); ADR-0060 (#1: `SALE_SINK.onSold` posts an `AR_INVOICE` through `FinIntakeInTx.submitInTx` inside the sale's transaction); ADR-0063 (the rejected alternative "service accounts … until a second kind of machine caller appears": source systems are that second kind, authorised per company; #4: the replay outcomes are the model for the intake's); ADR-0064 (#2 to #4, mechanism only: the shift entry and the hand-over post through the intake in phase H2; the postings are unchanged) |

## Context

The Finance Core (ADR-0069) serves Bto now and a PMS later, and neither may write its tables. The owner's goal (2026-10-18): every request names the tenant, the company, the source system, the source document's unique id, the date, the currency, the amounts and the lines; the core answers with its number, a status and errors; a document sent twice is booked once; a broken transmission can be resent, is recognised as a duplicate, and shows as pending or failed.

What the code has today (HEAD 3577787; `F/` is `apps/api/src/modules/finance/`):
- Callers reach finance internals in-process, with no business key. The sale calls `SALE_SINK.onSold` inside its transaction (`apps/api/src/modules/sales/services/sales-orders.service.ts:808-816`). POS builds journal lines by role and calls `JournalService.post` and `PaymentsService.recordInTx` itself (`apps/api/src/modules/pos/services/pos-shifts.service.ts:346-363`; ADR-0064 #2, #3).
- The only source-document uniqueness is `invoices_order` (`F/schema.ts:259`); `journal_entries_source_idx` is not unique (`F/schema.ts:172`).
- The `Idempotency-Key` interceptor is a transport shield, not a business key. It hard-codes `actorKind: 'STAFF'` (`apps/api/src/modules/identity/interceptors/idempotency.interceptor.ts:107`), needs a staff route (`:96`), hashes method, URL and body (`:101-103`), runs outside the handler's transaction (`:74-77`), and its rows are deleted after 7 days (`apps/api/src/modules/identity/services/housekeeping.service.ts:15`). In-process calls never pass through it.
- The POS replay is a working precedent: APPLIED, DUPLICATE or REJECTED per document (`apps/api/src/modules/pos/services/pos-accept.service.ts:93-131`), refusals parked in `pos_sync_rejections`, an edge outbox pushed in order with backoff (`apps/api/src/edge/services/outbox.service.ts:21-26`, `apps/api/src/edge/services/sync.runner.ts:56-59`). Its gaps: DUPLICATE is decided by `client_id` alone and the payload is never compared; `pos_sync_rejections` has no unique key, so every resent refusal adds a row (`apps/api/src/modules/pos/schema.ts:513-533`); the edge never hears of a successful admin replay.
- ADR-0063 rejected identity service accounts "until a second kind of machine caller appears". ADR-0027 #1 knows only STAFF tokens; the audit `Actor` is STAFF or SYSTEM (`apps/api/src/modules/identity/auth-context.ts:25-27`).

The owner's answers (2026-10-18): a finance refusal stops the Bto sale, as today (D11); a document dated in a closed month waits in a pending list (D10); the PMS is a separate repository (D22), starts after Bto's go-live (D4), and the resort runs its own small server because its internet is weak (D3). The PMS therefore reaches the core only over the network, from its own outbox.

## Decision

1. **One command shape, `fin.intake/1.x`.** Every source sends a command defined in `@tugeel/fin-contract` (ADR-0069). The TypeScript types and zod schemas live in `docs/modules/finance-core.md`; this ADR fixes the fields and the rules.
   - **Envelope:** `contract` (`fin.intake/1.<minor>`); `commandId` (uuid v7, the transmission's identity, echoed back); `tenant` and `company` (codes, ADR-0070); `source` (`system`, `docType`, `docId`, `revision` defaulting to 1, an optional `docNo` to show; for a REVERSE, the target's key); `actor` (kind STAFF, SOURCE or SYSTEM, a ref and a label: attribution only, never authorisation).
   - **POST body:** `documentType`, `documentDate`, optional `accountingDate`, `currency`, optional `branch`, `party` and `dueDate`, `description`, `controlTotal`, 2 to 500 `lines` (none for class ALLOCATION, which carries `allocate` instead: a party-control `key` and 1 to 200 `pairs` of existing debit and credit items, each with an amount; `controlTotal` = Σ pair amounts; ADR-0072 #7), at most 20 `attributes`. **REVERSE body:** optional `accountingDate` and a `reason`.
   - **Line:** `lineNo`, a posting `key`, `side`, `amount`, and as needed `tax` (`code`, `base`, `lineCount`), `moneyAccount`, `party`, `openItem`, `settles`, `analyticRef`. Only source `FIN` may name an `accountCode` (ADR-0072).
   - Amounts are decimal strings with at most two decimals, never JS numbers. Dates are `YYYY-MM-DD` in the company's timezone. In v1 `currency` must equal the company's functional currency, MNT (ADR-0070).
   - **Result:** the `outcome`; the core's document (id, number, `Ж-` journal number, amount, accounting date, period, the resolved lines with their accounts and rules, the open items and the allocations); `errors[]`, each with a stable `code`, `params` and a `path`; and `retryable`.
2. **The durable business key.** `fin.intake_requests` is UNIQUE on `(tenant_id, source_system_id, source_doc_type, source_doc_id, revision, action)`.
   - The company is not in the key but in the hashed payload, so the same key sent for another company answers CONFLICT `FIN_SOURCE_COMPANY_MISMATCH`, with no stored result, and is never a second booking.
   - The hash is SHA-256 over the canonical JSON (`canonicalJson`, `idempotency.interceptor.ts:61`) of the payload, taken after the defaults are applied (revision 1, `accountingDate = documentDate`, the header party on party-control lines) and the decimals are set to scale 2. `commandId` and `actor` are not hashed, so a resend under a new transmission id is still a DUPLICATE.
   - Two source systems with the same `docId` are independent.
3. **Six outcomes.**
   - **POSTED:** booked now.
   - **DUPLICATE:** the key is POSTED with the same hash, or was written by a migration; the stored result is returned, nothing is booked and no counter moves.
   - **CONFLICT:** the key is POSTED with another hash (`FIN_PAYLOAD_CONFLICT`) or belongs to another company; nothing is booked.
   - **REJECTED:** a permanent refusal, for example `FIN_PAYLOAD_INVALID`, `FIN_UNBALANCED`, `FIN_TOTAL_MISMATCH`, `FIN_MAPPING_MISSING`, `FIN_TAX_MISMATCH`.
   - **HELD:** a refusal that time or the accountant cures: `FIN_PERIOD_CLOSED` (ADR-0075), and from phase A1 `FIN_DEPENDENCY_MISSING`.
   - **CANCELLED:** a REVERSE whose target is HELD or REJECTED; no entry is written.
   - Only `FIN_BUSY` (a lock timeout or a serialization failure) is `retryable`. A sender treats any code it does not know as permanent. The full code list is in `docs/modules/finance-core.md`.
4. **A failure never consumes the key.** A HELD or REJECTED row takes the next payload sent under its key (attempts + 1); only POSTED fixes the hash. Revision n + 1 is accepted only once revision n is reversed or cancelled (`FIN_REVISION_NOT_ALLOWED`). A REVERSE has its own key (the target's key with action REVERSE): a resend after a lost acknowledgement is a DUPLICATE, a second REVERSE with another reason a CONFLICT. In v1 only the owning source reverses its documents; how a reversal posts is ADR-0072.
5. **The intake log.** One `fin.intake_requests` row per key holds the payload, its hash, the contract, the last `commandId`, the status, the error code and params, the attempts, the transport (`via`: INPROC, JOB, HTTP, UI, MIGRATION), the document and the stored result. `fin.intake_attempts` is append-only, one row per try with its outcome; authorisation refusals land there with no company and no request.
6. **One transaction, one lock order.** A command is processed in one transaction, the caller's when in-process: parse and hash; authorise (#7); set `fin.company_ids` for the transaction (ADR-0076); claim the key with `INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`, so a concurrent twin waits and then answers DUPLICATE; check the class rules and the period; lock the parties and the money accounts; resolve the accounts (ADR-0072); verify the money and never recompute it (Σ debit = Σ credit = `controlTotal`; each tax code within 0.01 × `lineCount` of `round_half_up(base × rate, 2)`, the POS rule of `pos-accept.service.ts:498-543`); lock and settle the target items; take the numbers last; write. The global lock order: the source's own rows (Bto: order, stock, `partners.customers`), the intake row, `fiscal_periods` (SHARE; a close takes UPDATE), `party_companies`, `money_accounts`, `open_items`, `number_counters`.
7. **Principals, not actors, are authorised.** Only `fin-bridge` builds a caller context (ADR-0076).
   - **SOURCE** `{tenant, system}` may post for a company only with a `fin.source_grants` row (ADR-0070). Bto posts sales, returns, POS closes and hand-overs as SOURCE `BTO`, whoever moved the card: the move route needs only `sales.orders.read` (`apps/api/src/modules/sales/controllers/sales-orders.controller.ts:267-269`), and warehouse staff must not need finance rights. The staff member is the actor.
   - **USER** is for the core's own screens (source `FIN`: vouchers, manual and opening entries, allocations), checked per company and document type against the rights of ADR-0075.
   - A refusal writes no request row. In-process it throws (`FIN_SOURCE_NOT_GRANTED`, `FIN_COMPANY_FORBIDDEN`); over HTTP it answers 404 `FIN_COMPANY_UNKNOWN`, the same as for an unknown company, with one attempt row.
   - Source systems are the second kind of machine caller ADR-0063 waited for. They still get no identity service account: the staff JWT of ADR-0027 #1 is unchanged, and the network transport (#9) uses its own token on `@Public()` routes, as the edge does.
8. **In-process now.** `FinIntakeInTx.submitInTx(tx, ctx, cmd)` runs inside the source's transaction; `FinIntake.submit(ctx, cmd)` opens its own (the core's screens, jobs). POSTED and DUPLICATE return the result; every other outcome throws an `AppError` with the same code and params, and the caller's transaction rolls back.
   - A refused Bto sale is not sold, as today (owner, D11). A refused POS close is parked by POS in `pos_sync_rejections` and replayed after the fix.
   - `SALE_SINK.onSold` (bound by `modules/finance` until phase H1, by `billing` after it, ADR-0073) builds the `AR_INVOICE` command and calls `submitInTx`; the order still turns INVOICED in the same transaction.
   - In phase H2, POS posts its shift close as `BTO.POS_SHIFT_CLOSE` (class JOURNAL) and its hand-over as `BTO.POS_HANDOVER` (class RECEIPT), both keyed by the shift's `client_id`. The accounts are those of ADR-0064 #2 to #4, now chosen by rules.
   - Lint lets only `modules/finance` (until H1), `billing`, `pos` and `fin-bridge` import `FinIntakeInTx`; the list grows, by that session's ADR, when delivery, procurement or hr start posting.
9. **The outbox and HTTP, required before the PMS.**
   - **A1, the outbox** (at the PMS kickoff): `FinOutbox.enqueue(tx, cmd)` enqueues a pg-boss `fin.submit` job in the source's transaction (standard policy, no singleton key); a `null` from `JobsService.enqueue` (`apps/api/src/common/jobs/jobs.service.ts:20-25`) throws. A failed posting rolls back, and a second short transaction records HELD or REJECTED with an attempt row: that is the pending list. `dependsOn` and the wake job come with it.
   - **A2, HTTP** (before the PMS; owner D3, D4, D22): `POST /api/fin/v1/intake` takes up to 100 commands, `@Public()` behind a `SourceTokenGuard`. Tokens `fss_<id>_<secret>` are kept as SHA-256 hashes, like the edge token (ADR-0063 #6; `apps/api/src/modules/pos/controllers/pos-sync.controller.ts:30-31`). The principal comes from the token: a body whose `tenant` or `source.system` differs answers `FIN_SOURCE_MISMATCH`, and a claimed user is kept only as an `on_behalf_of` label. Commands run in order, each in its own transaction; the batch answers 200 with an outcome and `retryable` per command, as `pos-sync` does. HTTP statuses are kept for envelope, authorisation and whole-batch failures. A2 also serves the read and configuration ports under `/api/fin/v1/companies/{c}/…`, with heartbeats and `freshness`.
   - The resort's server keeps its own outbox and pushes it in order with a 2-second to 60-second backoff, the edge pattern.
10. **Two keys.** `commandId` identifies a transmission; the source key identifies the document forever. The `Idempotency-Key` interceptor stays the HTTP shield of staff routes. For the core's own screens the server takes `docId` from the `Idempotency-Key` header, so neither the web nor the api client changes, and the deduplication outlives the 7-day key.
11. **Versioning.** Within 1.x changes are additive only and reach the server first. The core parses strictly and refuses unknown fields; clients ignore unknown response fields. A v2 runs beside v1 for at least one delivery; both normalise to one internal command, and stored payloads replay with their own parser. Every v1 contract fixture must parse forever. Document types, posting keys and rules are data, so a new source or document type needs no contract change. Planned 1.x additions: `dependsOn` (A1); the `commandId`-reuse check, `contract_min` / `contract_max` per source, heartbeats and tokens (A2); `match` selectors on rules.
12. **Results back, and the pending and failed list.** From A1, `fin.document.posted` and `fin.document.reversed` jobs drive a `FIN_RESULT_SINK` per source; POS learns from it that a hand-over voucher was voided, which `PaymentsService.void` never tells it today (`F/services/payments.service.ts:290`). A source checks its own completeness with `FinReader.sourceKeys`. `FinReader.intake` lists the HELD and REJECTED rows; their page, the attention tile and the replay right `finance.intake.replay` come in phase P5 (ADR-0075).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Sources keep calling finance services directly (today) | Every source carries the core's internals and chooses accounts in code; a PMS in another repository cannot; nothing deduplicates. |
| The `Idempotency-Key` as the duplicate guard | Per staff user, deleted after 7 days, one key per attempt, outside the posting transaction, and bypassed in-process. |
| A business key that includes the company | The same document sent for two companies would book twice; with the company in the hash it is a CONFLICT. |
| A failure consumes the key (TigerBeetle's `id_already_failed`) | Bto and the PMS need "fix and resend" under the same id. |
| Asynchronous posting for Bto now (the sale commits, finance follows) | The owner wants a refusal to stop the sale (D11); Bto would need an "awaiting finance" order state and credit reservations (ADR-0073). |
| Identity service accounts with a new `AuthContext.kind` | Touches the global guard, the idempotency interceptor and every `AuthContext` consumer for callers that only post to the core; a route-local token guard is the edge's proven pattern. |
| HTTP intake only when a caller in this repository asks | The PMS lives in another repository on the resort's own server (owner); it can only use the network. |

## Consequences

**Positive.**
- One door for every system: Bto, the core's screens, POS and the PMS post the same command shape.
- A document is never booked twice, a changed payload is never silently taken, and a fixed document is resent under its own id.
- An asynchronous source gets a pending and failed list; the POS precedent's gaps (one row per key, payload compared, result returned) are closed.
- The PMS can be built in its own repository against a published, versioned contract.

**Negative.**
- Every source maps its documents to commands: one adapter per document type.
- While in-process, Bto's sale stays bound to the core's transaction. Going remote needs an "awaiting finance" order state; the unbound `FinIntakeInTx` then lists every caller to move.
- A command refused in-process leaves no row in the core: the source shows the error (the sale) or parks it (POS).
- The intake log keeps every payload as jsonb; two keys (transmission and document) must be explained to every source.

**Follow-ups.**
- P0b: `@tugeel/fin-contract` with the v1 types, schemas, error codes and fixtures.
- P3: `IntakeService` with the key, the hash and the outcomes; `apps/api/test/integrity/fin-intake-dedupe.spec.ts` (ten concurrent identical submits give one POSTED and nine DUPLICATE; a changed payload gives CONFLICT; a resend after a rejection gives POSTED on the same row).
- P4: Bto's vouchers, invoices, voids and returns through `submitInTx`. H2: POS. P5: the pending page.
- A1 at the PMS kickoff and A2 before the PMS, with `fin-intake-transport.spec.ts` (lost acknowledgement, out of order, batch with one refusal).

## Related

ADR-0013, ADR-0016, ADR-0027, ADR-0060, ADR-0063, ADR-0064, ADR-0067, ADR-0069, ADR-0070, ADR-0072, ADR-0073, ADR-0075, ADR-0076, ADR-0077; `docs/modules/finance-core.md`; `docs/architecture.md` §3, §4, §6; `docs/SPEC.md` §6.
