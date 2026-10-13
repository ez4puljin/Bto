# ADR-0002: NestJS 12 modular monolith with two entrypoints

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0027 (#5: the actor reaches `AuditService.record` as an explicit `AuthContext`, not through an async context), ADR-0045 (#8 in practice: the first integration, `integrations/llm`, is called only from `ai`'s `ask-flow.service.ts`; ESLint now also refuses `fetch` and LLM calls inside transaction callbacks) |

## Context

Fourteen business modules (identity, catalog, partners, inventory, imports, pricing, sales, finance, ebarimt, delivery, procurement, notifications, hr, reporting) are delivered one per session by a single developer and an AI agent. They need strong conventions and enforced boundaries without the operational cost of distributed systems. The load (10,000+ products, 500+ orders/day, a few hundred staff and a few thousand customer accounts) fits one Node process for years.

Facts (see `docs/architecture.md` §0): NestJS 12.1.x was released 2026-08-27; `nest new` still offers the CommonJS + Jest template; NestJS 12 runs on Express 5 / Fastify 5; the Nest CLI requires TypeScript ~6.0.x (ADR-0001). The ESM + Vitest + oxlint defaults of NestJS 12 are newer and less represented in documentation and training data.

## Decision

1. **One NestJS 12.1.x application** (`apps/api`) scaffolded with the **CommonJS + Jest** template and the **Express 5** adapter. DTOs use class-validator/class-transformer with the `@nestjs/swagger` CLI plugin. Logging via `nestjs-pino`; configuration via `@nestjs/config` with a Zod-validated env schema; `helmet` and `@nestjs/throttler` on public customer endpoints. Zod otherwise lives in `packages/shared` for pure validation and mobile forms, not in controllers.
2. **Two entrypoints, one image.** `src/main.ts` serves HTTP; `src/worker.ts` runs the pg-boss worker (ADR-0013). The same Docker image starts either by `ROLE=api|worker`. Both exist from day one.
3. **One module per business domain** under `src/modules/<module>/` with `schema.ts`, `services/`, `controllers/`, `dto/`, `jobs/`, `__tests__/` and an `index.ts` that is the module's only public API (no README inside the module: `docs/modules/<module>.md` is the per-module contract). ESLint boundary rules (`eslint-plugin-boundaries`, `no-restricted-imports`) enforce: a module imports another module only through its `index.ts`; `schema.ts` may import another module's `schema.ts` solely for `references()` in the allowed dependency direction; `reporting` reads everything and is imported by nobody. `src/integrations/{ebarimt,qpay,sms,push}` are thin typed HTTP clients with no business rules.
4. **Cross-module atomic writes are direct service calls inside one explicit Drizzle `tx`** passed as the first argument. External side effects are pg-boss jobs enqueued in the same `tx`. No `@nestjs/event-emitter` for state changes.
5. **Audit is written by services inside the transaction**: `AuditService.record(tx, { actor, table, rowId, before, after })` stores before/after JSONB in `audit_log`. The HTTP interceptor only captures actor and request id into the request context; it never writes audit rows itself, because only the service knows the before/after state.
6. **`Idempotency-Key` is mandatory on every document-creating POST from every client** (web admin, customer app, staff app, scripts), not only mobile. `IdempotencyInterceptor` stores `(user_id, key)` with a unique constraint in `idempotency_keys` and replays the stored response on repeat. Missing key on such an endpoint is a 400 `IDEMPOTENCY_KEY_REQUIRED`.
7. **Document numbers are assigned at SUBMIT/POST inside the posting transaction** by `NumberingService.next(tx, scopeKey, period)`, so drafts carry only their bigint id and rolled-back transactions create no gaps (ADR-0007 for `number_sequences`).
8. **No HTTP call while a Drizzle transaction is open.** Integration calls (PosAPI, QPay, SMS) happen before or after a transaction, never inside one (ADR-0017 defines the two-phase pattern). Enforced from delivery 1 by the `src/integrations/**` import restriction (only `jobs/*.job.ts` and `*-flow.service.ts` may import integration clients; `docs/architecture.md` §3.1 rule 6) and, from delivery 3, by a `no-restricted-syntax` rule that flags `fetch`/`axios`/integration-client calls lexically inside `db.transaction(...)` callbacks; both are in the lint-guard list in `docs/architecture.md` §12.
9. No mail service (and no mailpit container) until an email feature exists.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| NestJS 11 with an upgrade session later | Accumulates ESM/v12 migration debt on a brand-new codebase. |
| NestJS 12 ESM + Vitest + oxlint template | Newer defaults, thinner documentation and training data, decorator-metadata tooling less proven; the project gains nothing from ESM today. |
| Hono or Fastify with a hand-rolled structure | Hono 5 is an RC; neither gives DI, module and guard conventions for a 14-module ERP. |
| Next.js route handlers as the API | No module system, no DI, SSR not needed for an internal admin. |
| Microservices per domain | Operational cost unaffordable for one person; the load does not need it. |
| HTTP-level audit interceptor | Cannot know the before/after row state; produces an audit log without content. |

## Consequences

**Positive.** The most AI-canonical NestJS shape; `nest upgrade` tooling remains available. Boundary lint turns architectural drift into CI failures the agent can fix itself. Idempotency and audit are uniform across clients.

**Negative.** Decorator metadata ties the API to TypeScript 6 until Nest supports the TS 7.1 native API; NestJS 12 Standard Schema pipes stay unused for now. The two-entrypoint rule costs a few lines of bootstrap code in delivery 1.

**Follow-ups.**
- Delivery 1 (identity): `AuditService`, `IdempotencyInterceptor`, `NumberingService`, problem+json filter, boundary lint config including the `src/integrations/**` import restriction.
- Delivery 3: the lexical "no HTTP inside `db.transaction(...)`" lint rule must exist before the ebarimt module is written.

## Related

ADR-0001, ADR-0003, ADR-0004, ADR-0007 (`number_sequences`), ADR-0013, ADR-0017, `docs/architecture.md` §2, §3, §4, §6, §12.
