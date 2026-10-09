# ADR-0004: REST + OpenAPI with a generated TypeScript client shared by web and mobile

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

Three front-ends (web admin incl. the POS screen, customer app, staff app), external webhooks (QPay) and future integrators (accountant exports, bank pullers) must stay in sync with one API. The AI agent needs contract drift to surface at typecheck time, not in production. Error messages must be shown in Mongolian while the backend stays English-only (ADR-0011).

## Decision

1. **REST/JSON under `/api/v1/<resource>`**, resource-oriented controllers, JSON only. OpenAPI 3 is produced from NestJS decorators plus the `@nestjs/swagger` CLI plugin.
2. **Generated client.** `pnpm gen:api` exports `openapi.json` and regenerates `packages/api-client` with `openapi-typescript` + `openapi-fetch`. Web and mobile import only `packages/api-client` and `packages/shared`; they never hand-write `fetch` calls against the API. CI fails when the committed client is stale.
3. **Pagination** is keyset (`cursor`, `limit`) on every list endpoint; the envelope is `{ data, nextCursor }`. Filtering and sorting are server-side.
4. **Errors** follow RFC 9457 `application/problem+json` with a **stable machine code** in `code` (for example `STOCK_INSUFFICIENT`, `PRICE_MISSING`, `CREDIT_BLOCKED`, `BIN_LOCKED_FOR_COUNT`, `IDEMPOTENCY_KEY_REQUIRED`). Codes are an enum in `packages/shared`; clients map them to Mongolian text through i18next. HTTP 409 for state-machine violations, 422 for validation, 400 for malformed requests. New codes are added to the enum in the same PR as the throwing code.
5. **Idempotency.** `Idempotency-Key` is mandatory on all document-creating POSTs from every client (ADR-0002). The key is a client-generated UUID; the server stores `(user_id, key, request_hash, response)` in `idempotency_keys` and replays the response on repeat; a repeat with a different body is 409 `IDEMPOTENCY_KEY_REUSED`.
6. **Dates.** Timestamps are ISO-8601 with offset; `effective_date` and report periods are plain dates in Asia/Ulaanbaatar.
7. **Webhooks** live under `/api/webhooks/*`, log the raw payload, return quickly and only enqueue pg-boss jobs; they never mutate business state directly (ADR-0018).
8. **Security on public endpoints**: `helmet`, `@nestjs/throttler`, and row scoping in `PermissionsGuard` (customers see their own orders and invoices; drivers their own trips; reps their own customers).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| tRPC | Awkward with webhooks, React Native and non-TypeScript integrators; no standard contract to hand to an accountant or a bank. |
| GraphQL | Second schema language, N+1 and caching complexity, no benefit for form-driven screens. |
| Hand-written fetch wrappers per app | The exact drift the generated client exists to prevent. |
| Offset pagination | Unstable under concurrent inserts at 500+ orders/day; keyset is cheap with bigint ids. |
| Free-text error messages from the API | Cannot be translated or asserted in tests; codes are the contract. |

## Consequences

**Positive.** API changes become compile errors in web and mobile that the agent can fix in the same session; integrators get a standard OpenAPI document; errors are testable by code.

**Negative.** `pnpm gen:api` must run in every session that touches a controller (CI enforces it). Keyset pagination needs a stable sort key on each list.

**Follow-ups.**
- Delivery 1: `packages/api-client` generation, problem+json filter, error-code enum, staleness check in CI.
- Playwright smoke on the admin once sales exists (ADR-0016).

## Related

ADR-0001, ADR-0002, ADR-0011, ADR-0018 (webhooks), ADR-0020 (idempotent mutations), `docs/architecture.md` §6, §7.
