# ADR-0076: Company data is isolated on the server by scoped keys, scoped services and filtered views; row-level security is prepared, not enabled

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0083 (2026-10-20: #2–#4 and the isolation tests of #10 wait for the PMS kickoff; #1 and #5 hold from F1) |
| Amends | ADR-0027 (#7: Finance Core reads are scoped by company; Bto's own reads stay unscoped); ADR-0045 (#2: finance views filter by company and are `security_barrier`; #5 and #9: the AI reader sets, on every query, the companies where the user holds `finance.read`) |

## Context

The owner's corrected goal (2026-10-18) requires isolation between organisations' data, enforced on the server, and a later control system that reads only the companies approved in the core, never changes a source entry and shows when its data was last refreshed. The owner's answers (2026-10-18): the systems serve only the owner's own group, so there is one tenant (D1); the resort is a separate ХХК, company RES beside BO (D2, ADR-0070). One database will therefore hold the books of two companies.

Facts that constrain the design:
- No table has a company column, and reads are never filtered: scopes limit writes only (ADR-0027 #7). Roles are global (`apps/api/src/modules/identity/schema.ts:100-114`).
- Each process has one `app` pool. `inTransaction` runs its callback on one pooled client (`apps/api/src/common/db/transaction.ts:9-16`), and clients are reused (idle timeout 30 s, `apps/api/src/common/db/db.module.ts:60`). A session-level `SET` would leak to the next caller; `set_config(name, value, true)` lasts only until the transaction ends.
- Bto services also read through `this.db` outside transactions (about 185 statements in a grep of 2026-10-18).
- Scheduled jobs carry no payload (`apps/api/src/common/jobs/job-registry.ts:31-32`).
- `migrator` owns every table and `app` gets DML on every new table through default privileges (`apps/api/src/db/migrations/0000_foundation.sql:44-46`). Provisioning refuses roles with BYPASSRLS (`apps/api/src/db/provisioning.ts:147-156`).
- The AI views read as their owner (`apps/api/src/db/migrations/0017_ai.sql:79-80`), and `ai.ask` alone opens every dataset (ADR-0045 #9). The guard allows `/` (`apps/api/src/modules/ai/sql/sql-guard.ts:116-133`), a query mistake goes back to the model for a repair (`apps/api/src/modules/ai/sql/ai-reader.service.ts:36-39`), and model SQL cannot call `set_config` or `current_setting` (`sql-guard.ts:147-153`).
- Composite foreign keys already exist: `bin_stock (warehouse_id, bin_id)` → `bins (warehouse_id, id)` (`apps/api/src/db/migrations/0005_inventory.sql:297`).

## Decision

1. **Scope in the keys.** Every company-owned table in schema `fin` has `company_id` and `UNIQUE (company_id, id)`, and every FK between company-owned tables includes `company_id`, so a company A entry cannot name company B's account, party, period or open item. Tenant-level rows (parties, source systems) carry `tenant_id` and are reached only through per-company bridge rows with composite FKs: `journal_lines (company_id, party_id)` → `party_companies (company_id, party_id)`, and `party_companies (tenant_id, party_id)` → `parties (tenant_id, id)`. Every unique index leads with `company_id` or `tenant_id`; document numbers are unique per company and document type.
2. **The caller.** A branded `FinCallContext` is built only by `fin-bridge`; a lint rule forbids its factory elsewhere (ADR-0069). It holds either a SOURCE principal `{tenant, system}`, authorised per company by `fin.source_grants` (ADR-0070, ADR-0071 #7), or a USER principal with `permissions: ReadonlyMap<CompanyCode, ReadonlySet<Permission>>` from `identity.user_company_roles` (ADR-0075 #8). A `StaticCaller` exists only under `test/**`; production boot asserts that it is absent.
3. **Scoped services.** Every port method takes the context and a company code, and checks the company right or the source grant before it reads or writes; every query still filters by `company_id`. A refusal is `FIN_COMPANY_FORBIDDEN` in-process. Over HTTP (phase A2) an unknown, forbidden or ungranted company answers 404 `FIN_COMPANY_UNKNOWN`, so a caller cannot learn which companies exist, and a lookup by id of another company's row answers 404 as well.
4. **The scope setting.** Every core read runs in `finRead(ctx, work)`: a READ ONLY transaction whose first statement is `SELECT set_config('fin.company_ids', '{<ids>}', true)`. `submitInTx` and `exposureInTx` set it inside the caller's transaction. Views use exactly `current_setting('fin.company_ids')::bigint[]`, without `missing_ok`, so that an unset value fails loudly instead of returning no rows. Whether an unset value on a reused pooled connection reads as an empty string (and so fails the cast) in PostgreSQL 18 is not yet verified; a test proves it in phase P2 before any view relies on it.
5. **The company at the edge.** Bto's finance routes take the company from `bto.company_code` (ADR-0070 #10: one Bto installation books into one company), so Bto's own unscoped tables cannot mix companies. The routes under `/api/fin/v1/companies/{company}/…` (phase A2) carry it in the path, so the Idempotency-Key hash, which covers `originalUrl` (`apps/api/src/modules/identity/interceptors/idempotency.interceptor.ts:101-103`), covers the company.
6. **Jobs** loop over the companies, one transaction and one scope setting per company.
7. **The AI reader.** `AiReaderService` adds `set_config('fin.company_ids', …, true)` beside its `SET LOCAL` statements (`apps/api/src/modules/ai/sql/ai-reader.service.ts:166-177`), listing the companies where the user holds `finance.read`; with none, the list is empty and the finance views return no rows. Every `ai.fin_*` view filters on the setting and is `WITH (security_barrier = true)`, so a predicate such as `1/0` cannot run on another company's rows before the filter and turn the repair message into an oracle. Bto's own AI views are unchanged.
8. **The control system (later).** A role `fin_control` with SELECT on `fin_ctl.*` views only, hardened like `ai_reader` (connection limit, `default_transaction_read_only`, `search_path`; `apps/api/src/db/provisioning.ts:93-100`) and re-granted by a migrate step like `grantAiSchema` (`apps/api/src/db/migrate.ts:65`).
   - The views cover only companies with `fin.companies.control_approved` (ADR-0070), set with `finance.control.approve` (ADR-0075) and an audit row.
   - They show aggregates, never party names or TINs. `fin_ctl.freshness` gives the last `posted_at` per company and source system.
   - The role writes nothing, so the control system can never change a source entry. A control system on another server prefers the HTTP `FinReader` (phase A2) to a database login.
   - Consolidated statements that eliminate intercompany balances (INTERNAL parties, ADR-0070) are a separate, later requirement of that system.
9. **Row-level security is prepared, not enabled.** The scoped keys, the setting on every core transaction and the scope-led indexes are what a policy `USING (company_id = ANY (current_setting('fin.company_ids')::bigint[]))` would need. It stays off: there is one tenant, the owner's group (owner, 2026-10-18), and the AI path needs the explicit view filter anyway, because its views read as their owner. The trigger to revisit it is outside tenants pooled in one database. That also needs multi-tenant identity (usernames are unique in the whole database, `apps/api/src/modules/identity/schema.ts:49`; roles, settings and `number_sequences` are global), so it is a new ADR plus identity work. An outside customer would first get a deployment of its own (ADR-0069 #9).
10. **Tests** (`apps/api/test/integrity/fin-isolation.spec.ts`):
    - a user with rights only in A gets 404 for B's documents, items, statement and exposure; a viewer in RES cannot reopen a RES month while being a manager in BO;
    - every reader, configuration and intake method called for B with an A-only context is refused (one parameterised test); a context built outside `fin-bridge` fails lint;
    - cross-company and cross-tenant references fail on the composite FKs;
    - a catalog test: scope columns present, unique indexes led by scope, `company_id` in every FK between company-owned tables, no FK between `fin` and Bto's tables, `security_barrier` on every filtering view;
    - the AI reader returns only the user's companies, none without `finance.read`, an error when the setting is unset or the connection reused, a refusal for `set_config` in model SQL, and nothing through an error oracle.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Row-level security now on every `fin` table | With one tenant and, until RES, one company it protects nothing yet. The AI views read as their owner and skip it unless the tables are FORCEd, and FORCE also binds `migrator` in migrations and backfills. |
| Service filters only, no scope setting | The AI views need a filter that model SQL cannot skip, and the setting is what row-level security would use later. |
| `security_invoker` AI views over row-level security | `ai_reader` holds no table privilege by design (ADR-0045 #2, #4). |
| A schema per company | Generated FKs name `"public"` (for example `0005_inventory.sql:297`), there is one migration history per database, and consolidation becomes a UNION over schemas. |
| A database per company | The pool budget is already split between api, worker, pg-boss and the AI reader (architecture §10.2); migrations would loop over databases; a shared login would need its own identity store. |
| The company in a session `SET` or in `AsyncLocalStorage` | A session setting leaks through the reused pool; `AsyncLocalStorage` was rejected for the actor (ADR-0027 #10, alternatives). |
| The control system reading `fin.*` with the `app` role | It could write; it would see names and TINs; it would see unapproved companies. |

## Consequences

**Positive.**
- A reference across companies is impossible in the database, and a lookup across companies answers 404.
- The AI assistant cannot read or probe another company's books.
- Company RES needs no new isolation work, and row-level security, if ever needed, lands on reads that are already scoped.
- The control system gets a read-only, aggregated view with its freshness.

**Negative.**
- Every core read pays a transaction and a `set_config`.
- Inside one database, isolation of core code rests on the scoped services and the tests: a missing `WHERE` in the core is caught by tests, not by the database.
- `app` can still write every `fin` table through its default privileges, so "sources never write core tables" rests on lint and a grep test (ADR-0069).
- The assistant's finance answers now need `finance.read` in a company; an ADMIN sees finance data only through its backfilled company rows.

**Follow-ups.**
- P1: `identity.user_company_roles`, `FinCallContext`, `fin-bridge`. P2: `finRead`, the reused-connection test on PostgreSQL 18, the finance AI views recreated with the filter and `security_barrier`, the catalog test. P3 and P4: the isolation tests. A2: the HTTP isolation tests.
- The `fin_control` role and views (about one session) when the control system starts.
- A new ADR if the owner's answer D1 ever changes to outside tenants in one database.

## Related

ADR-0024, ADR-0027, ADR-0045, ADR-0067, ADR-0069, ADR-0070, ADR-0071, ADR-0075, ADR-0077; `docs/modules/finance-core.md`; `docs/modules/ai.md`; `docs/architecture.md` §3.1, §7, §10.2.
