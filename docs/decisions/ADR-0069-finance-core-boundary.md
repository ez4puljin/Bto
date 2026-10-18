# ADR-0069: Finance Core: one shared finance engine that business systems use and never reach into

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0002 (#3: a third element type beside modules and integrations, `apps/api/src/finance-core/`, which imports no module and is reached only through its `index.ts`); ADR-0060 (#1: the direction is reversed; source systems depend on the Finance Core, and the core depends on none of them); ADR-0063 (#2: from phase H1 `MODULE_DEPS.pos` lists `fin-bridge` instead of `finance`); architecture §3 (repo layout, boundary rules) and §4 (the module graph) |

## Context

On 2026-10-18 the owner corrected the finance goal. The company will build separate systems for several kinds of business: Bto first, a resort and hotel PMS next, more later. Each system has its own screens and work, but all of them must use one Finance Core. Finance is therefore not "a part of Bto": it is a shared core, and Bto is its first user. The owner's rules:
- The core never depends on any system's code, tables or business concepts. If another project needs Bto's sales or warehouse code to use the core, the boundary is wrong.
- One source with a versioned interface; never a copy that evolves apart. Differences (chart, document types, account mapping, report dimensions) are configuration.
- A modular monolith is fine, as long as the core could later run on its own.
- Erkhet is a reference for what finance must do. Its screens are not copied, and what the study only inferred about Erkhet is never treated as fact.

Facts from the code (HEAD 3577787):
- Finance is a Bto module. `MODULE_DEPS.finance` lists identity, catalog, partners, inventory, sales and ebarimt (`eslint.config.mjs:46`). Its schema imports products, units, branches, users, warehouses, bins, customers and sales orders for foreign keys (`apps/api/src/modules/finance/schema.ts:32-36`).
- Bto code reaches into finance. pos imports `FinanceModule` (`apps/api/src/modules/pos/pos.module.ts:3`) and holds foreign keys to `money_accounts`, `journal_entries` and `payments` (`apps/api/src/modules/pos/schema.ts:29,62,263,265`). inventory reads `credit_notes` in raw SQL (`apps/api/src/modules/inventory/services/stock-posting.service.ts:717`), which ESLint cannot see.
- The platform code is not Bto-free. `Db` and `Tx` are typed over the aggregated Bto schema (`apps/api/src/common/db/db.types.ts:3-8`). `AppError` takes Bto's single `ErrorCode` catalog (`apps/api/src/common/errors/app-error.ts:1`). The job registry lists Bto's jobs (`apps/api/src/common/jobs/job-registry.ts:10-29`). `canonicalJson` lives in identity (`apps/api/src/modules/identity/interceptors/idempotency.interceptor.ts:61`).
- ESLint G1 knows only `modules/*`, `integrations/*`, `apps/*` and `packages/*` (`eslint.config.mjs:293-307`). The edge's "no `modules/**`" rule (ADR-0067 #1) is a convention that no lint enforces.
- The edge already shows the extractable shape: the same image under `ROLE=edge` (`apps/api/src/common/config/env.schema.ts:4`), only `common/**` and shared packages, its own Drizzle instance and database (`apps/api/src/edge/db/edge-db.ts:34-36`).
- The api consumes workspace packages as their built CommonJS `dist` (ADR-0025 #3), so code kept in a package must be rebuilt after every edit during `pnpm dev`.

The owner's interview answers that bear on the boundary (owner, 2026-10-18): the PMS is a separate repository, starts after Bto's go-live and runs on its own site server; a finance refusal stops a Bto sale, as today.

## Decision

1. **Placement.** Each piece of work has one home:

   | Home | What belongs there |
   |---|---|
   | Finance Core | What is equally true for a wholesaler, a hotel and a third business: the financial identity of parties, financial documents, open items and allocations, the journal, accounts and posting rules, money accounts, periods, and the core's own numbering, audit, settings and intake log |
   | Bto | Products, units, packs, warehouses, bins, orders, picking, delivery, tills, the commercial invoice and the sales return (ADR-0073), the credit policy and limits, costing |
   | The PMS (later, its own repository) | Bookings, rooms, guests, folios, housekeeping |
   | Mongolian localisation (ADR-0074) | VAT and city-tax codes and the tax-inclusive split, e-Barimt, QPay, statutory forms, the Erkhet-style chart template |

   The core never imports Mongolian code: tax codes, rates and the chart reach it as data, through its configuration port.
2. **The code.** The core lives in `apps/api/src/finance-core/`, a third element type beside `modules/*` and `integrations/*` (ESLint element `api-finance-core`). Its only public API is `finance-core/index.ts`. It may import an exact list of files in `common/**` (after #7), `@tugeel/shared/money`, `@tugeel/shared/time` and `@tugeel/fin-contract`. It never imports `modules/**`, `edge/**`, `db/schema.ts`, `common/config`, `common/segments`, `common/attention.ts` or any other shared subpath. Every other element imports only `finance-core/index.ts`.
3. **Direction.** Source systems depend on the core; the core depends on none of them. Bto reaches the core through a bridge module, `fin-bridge` (call contexts, the caller, party refs; ADR-0071, ADR-0076). `modules/finance` becomes `billing` plus `fin-bridge` in phase H1 (ADR-0073). `pos`, `delivery` and `procurement` then list `fin-bridge` instead of `finance`, and `ebarimt` lists no module (ADR-0074).

   ```
   billing, pos, delivery, procurement ──> fin-bridge, finance-core/index.ts
   fin-bridge ──> identity, partners, finance-core/index.ts
   finance-core ──> whitelisted common/** files, @tugeel/shared/{money,time}, @tugeel/fin-contract
   @tugeel/fin-contract ──> zod
   the PMS (another repository) ──> @tugeel/fin-contract ──HTTP──> the core (ADR-0071)
   ```

4. **The contract package.** `packages/fin-contract` (`@tugeel/fin-contract`) holds the TypeScript types and zod schemas of every contract version (`fin.intake/1.x`, ADR-0071), the `FIN_*` error codes, the finance permission codes and the contract fixtures. It depends only on zod (the catalog version). It is CommonJS with the `@tugeel/source` condition (ADR-0025) and carries its own semver version, so another repository can install a fixed version. Every released fixture must parse forever. The PMS uses only this package and the Mongolian rules it needs (ADR-0074); it never imports core code (owner, 2026-10-18).
5. **Schema `fin`.** The core's tables live in their own PostgreSQL schema, `fin`, created in the existing migration stream (ADR-0024 #3 kept; the precedent is `CREATE SCHEMA ai`, `apps/api/src/db/migrations/0017_ai.sql:88`).
   - `app` has USAGE only on `public` today (`apps/api/src/db/provisioning.ts:203`). The first `fin` migration therefore revokes the schema from PUBLIC and grants USAGE to `app`; DML comes from the default privileges (`apps/api/src/db/migrations/0000_foundation.sql:44-46`).
   - The `fin` triggers use `fin`-owned copies of `forbid_update_delete()` and of the balance function, so `pg_dump -n fin` stands alone.
   - The table symbols are prefixed (`finBranches`, `finSettings`), so they never collide in the aggregated `db/schema.ts`.
   - No foreign key crosses the `fin` boundary, in either direction. Bto keeps the core's ids as plain columns beside the stored numbers, as POS already stores `journal_number` and `handover_number` beside its ids (`apps/api/src/modules/pos/schema.ts:263-266`; those ids are foreign keys today); the core keeps source refs (ADR-0070, ADR-0071). The foreign keys that point into finance tables today are dropped in the phase that moves each table (ADR-0077).
6. **Lint rules**, each proved by a fixture in `tools/lint-guards/guards.test.mjs`:
   - the element whitelist of #2, and "other elements import only `finance-core/index.ts`";
   - only the core writes `fin.*` tables; inside the core only `finance-core/posting/**` writes the ledger tables (documents, journal, open items, allocations, intake log) and imports their table symbols (a G2-style rule);
   - the in-transaction intake port only from `finance` (until H1), `billing`, `pos` and `fin-bridge`; the list grows, by that session's ADR, when delivery, procurement or hr start posting; the call-context factory only inside `fin-bridge` (ADR-0076);
   - G3 (the `Number(` / `parseFloat(` ban) extends to `finance-core/**` by adding that glob to the `files` of the `guard/G3` block, which repeats TX_GUARD (`eslint.config.mjs:360-364`). A block of its own would replace `no-restricted-syntax` for those files and drop TX_GUARD there; TX_GUARD itself covers `apps/api/src/**` (`eslint.config.mjs:355-359`).

   Because `app` can write every `fin` table, the grants do not hold the boundary. A grep test (no `fin.` table name in an SQL string outside `finance-core/**` and the migrations) and a catalog test (no foreign key crosses `fin`) do.
7. **A Bto-free platform first (phase P0b).** Before any core code is written:
   - `common/db/any-tx.ts` (`AnyTx`), so the core's in-transaction calls accept Bto's `Tx`, while the core builds its own Drizzle instance over the shared pool (the `createEdgeDb` pattern);
   - `common/errors` becomes code-agnostic with a status registry: Bto registers its catalog, the core its `FIN_*` codes from the contract;
   - job payloads become augmentable, and queue maps are kept per owner;
   - `canonicalJson` moves to `common/json/canonical.ts`, the gap-free counter upsert to `common/db/counters.ts`;
   - `businessDateIn(tz, at)` joins `@tugeel/shared/time`, so the core uses the company's timezone (ADR-0070) and never reads `BUSINESS_TZ` (`packages/shared/src/time/index.ts:9`);
   - the Jest, tsconfig, Vitest and `exports` maps learn the new paths (`apps/api/jest.config.js:11-15` lists the shared subpaths one by one).
8. **Build-alone and boot checks.** `pnpm core:standalone` runs `tsc --listFilesOnly -p apps/api/tsconfig.finance-core.json`, and a script asserts that the list holds only `src/finance-core/**`, the whitelisted files and the allowed packages. It runs inside `pnpm check`. A boot test starts `FinanceCoreModule` with only the database and job providers and a test caller, no Bto module, and posts a document from a `TEST_` source system.
9. **One source everywhere.** The core's logic exists once. Running it apart later is a process role of the same image, `ROLE=finance` (the edge precedent, ADR-0067 #1), never a copy or a fork. One central service or the same core installed per environment is a deployment decision, taken when it is needed; the recommended topology is one central core in which every company has exactly one home instance. A system the core does not fit gets an ADR and a new document class, never a branch of the code.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A workspace package (`packages/finance-core`) now | The api would have to rebuild it after every edit (ADR-0025 #3), and it needs its own build and Jest setup before a second user exists. The exact whitelist keeps a later move a mechanical `git mv`. |
| A separate service now | Microservices were rejected for one maintainer (ADR-0002). Credit control and the sale need one transaction, and the owner wants a finance refusal to stop the sale. The contract and `ROLE=finance` keep the option open. |
| A module `modules/finance-core` | It would sit inside Bto's module graph and `MODULE_DEPS`, and the `common/**` whitelist needs its own element anyway. A folder outside `modules/` makes "imports no module" structural. |
| Keep finance as a Bto module | It depends on five Bto modules; a PMS would have to carry Bto's sales and warehouse code, which is the failure the owner named. |
| Copy finance into the PMS | Two versions that drift apart; the owner forbade copy-and-fork. |
| Core tables in `public` with a `fin_` prefix | It works, but a schema gives grants, `pg_dump -n fin` and a later extraction one name to act on, for the cost of one REVOKE / GRANT pair. |

## Consequences

**Positive.**
- A new system is connected through the contract and configuration rows, not by changing the engine.
- The boundary is proved by lint fixtures, the standalone file list, the boot test and the catalog test, not by convention.
- Another repository can use the contract without any Bto code.
- Extraction is a process role and a move of files, not a rewrite.

**Negative.**
- P0b changes platform code that every module uses. Type-only changes go first, and the whole suite is the gate.
- The `app` role can still write `fin` tables; the boundary rests on lint plus the grep and catalog tests.
- Two error registries and two Drizzle instances over one pool; the core's tables appear in the aggregated schema under prefixed names.
- The carve costs sessions before new finance features; the phases and estimates are in ADR-0077.
- Until H1, `modules/finance` keeps its Bto dependencies and pos still imports it.

**Follow-ups.**
- P0b (the next finance session): `packages/fin-contract`, an empty `finance-core` folder and module, #6 to #8, `pnpm install` with `pnpm dev` stopped.
- P1 creates schema `fin` with the organisation model (ADR-0070).
- H1: `modules/finance` becomes `billing` plus `fin-bridge` (ADR-0073).
- A2, before the PMS starts: the PMS repository installs `@tugeel/fin-contract` from a private package registry or a git tag, decided in the A2 session's ADR.
- `CLAUDE.md` gets the convention from P0b on; architecture §3, §3.1 and §4 are updated in this session.

## Related

ADR-0002, ADR-0024, ADR-0025, ADR-0060, ADR-0063, ADR-0067, ADR-0070, ADR-0071, ADR-0072, ADR-0073, ADR-0074, ADR-0075, ADR-0076, ADR-0077; architecture §3, §3.1, §4; `docs/modules/finance-core.md`; `docs/modules/finance.md`.
