# ADR-0020: Offline mode deferred; idempotent, document-based mutations now

| | |
|---|---|
| Status | Deferred (idempotency and document-based mutations in delivery 1; an offline queue is a later session if ever) |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

Offline operation is out of scope (`docs/SPEC.md` §2); mobile connectivity in Ulaanbaatar is generally good; a true offline POS or driver app (local store, sync engine, conflict resolution) is a large project with its own failure modes. Flaky mobile networks still cause retries, and a retried order submission or pick confirmation must not create duplicates. The supermarket POS additionally depends on the office box for e-Barimt until delivery 9 (ADR-0017).

## Decision

1. **No offline sync** in any client. An internet outage stops checkout, scanning and order submission; the supermarket and the warehouse get an LTE backup router (availability requirement in `docs/SPEC.md` §7).
2. **Every mutation that creates a document carries a client-generated `Idempotency-Key`** (UUID) stored server-side with the response (ADR-0002, ADR-0004). A retry over a flaky network is safe; the client keeps the key until it receives a response.
3. **Mutations are whole documents, not clicks.** A pick confirmation sends the complete list of picked lines; an order submission sends the complete cart; a proof of delivery sends all delivered quantities, photo keys and signature in one request. This keeps retries atomic and makes a future replay queue trivial.
4. **Client caching.** TanStack Query with optimistic UI for status changes, short-lived catalog and price-quote caches (minutes), and a per-session product/price cache in the POS screen so scanning stays fast between requests.
5. **Bigint ids stay server-generated.** Clients never invent document ids; the `Idempotency-Key` is the client-side identity until the server returns the id.
6. **Future offline queue**, if ever needed, is a staff-app session that persists the same idempotent document requests locally and replays them in order; nothing in the API has to change.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Offline-first with a sync engine or CRDTs now | Months of work and a new class of conflicts for a requirement the owner declined. |
| UUID primary keys everywhere for client-side generation | Not needed for replay safety; bigint ids index better and read better in SQL. |
| Click-level mutations with server-side aggregation | Partial state after a dropped connection; impossible to replay safely. |

## Consequences

**Positive.** Retries are safe from day one; the design does not preclude an offline queue; no sync bugs to debug.

**Negative.** Outages stop work (accepted); the POS depends on three networks until the supermarket PosAPI instance exists (ADR-0017 documents the runbook).

**Follow-ups.** Delivery 1: idempotency table and interceptor. Delivery 4: whole-document pick and count submissions. Delivery 9: POS session cache and LTE router.

## Related

ADR-0002, ADR-0004, ADR-0006, ADR-0017, `docs/architecture.md` §6, §8, `docs/SPEC.md` §2, §10.
