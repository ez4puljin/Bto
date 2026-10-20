# Module `finance-core` — contract (planned)

| | |
|---|---|
| Status | **F1 done 2026-10-20** — the ledger (§3.7, ADR-0089): the chart, money accounts, append-only posting rules, monthly periods and the journal in schema `fin` (migration `0033_fin_ledger`); Bto's journal writers post through the façade `FinJournalPosting`; `gl_accounts`, `money_accounts`, `journal_entries` / `journal_lines` dropped; the development re-post `pnpm finance:repost-journal`. Next F2 (intake and open items). **P1 built 2026-10-20** (the organisation half of F1, §3.6, ADR-0084): schema `fin` with the tenant, company BO, branches, source systems, posting keys, parties and the core's audit trail; `FinCallContext`, `FinOrgService`, `FinPartiesService`, `ensureDefaultCompany`; Bto's side in `modules/fin-bridge` (`docs/modules/fin-bridge.md`) and «Компани». No ledger yet. **Lean go-live plan 2026-10-20 (ADR-0083, §16.0):** six phases F1–F6, no copy of Finance I's history, fixed assets, the bank import, approvals, isolation, H1 and H2 after go-live. Next F1. P0b built 2026-10-18 (§3.5); P0a decisions 2026-10-18 (ADR-0069 … ADR-0077). Next: the rest of F1, the ledger (§16.0) |
| ADRs | ADR-0069 (the boundary), ADR-0070 (tenant, company, branch, source system), ADR-0071 (the intake contract), ADR-0072 (posting rules and open items), ADR-0073 (Bto's `billing` owns the commercial documents), ADR-0074 (the Mongolian localisation layer), ADR-0075 (periods, approvals, rights), ADR-0076 (company isolation), ADR-0077 (scope and roadmap), ADR-0083 (the lean go-live plan, which amends ADR-0071 #12, ADR-0073's H1 timing, ADR-0075 #2, #6–#8, ADR-0076 #2–#4, #10 and ADR-0077 #1–#5), ADR-0084 (the organisation, P1: the organisation half of F1), ADR-0088 (each system keeps its own books), ADR-0089 (the ledger, the rest of F1). Carved out of ADR-0060 (Finance I, `docs/modules/finance.md`); the replay precedent is ADR-0063, ADR-0064 and ADR-0067 |
| Owner's answers | §1 (interview of 2026-10-18, four rounds) |
| Code | `apps/api/src/finance-core/` (ESLint element `api-finance-core`): `index.ts`, `finance-core.module.ts`, `schema.ts` (schema `fin`), `db/fin-db.ts`, `errors.ts`, `context/` (call context, authorisation, the StaticCaller boot guard), `audit/`, `org/` (`ensureDefaultCompany`, `FinOrgService`), `parties/`, `ledger/` (`FinChartService`, `ensureDefaultChart`, periods), `posting/` (`FinJournalPosting`, `FinJournalReader`); migrations `0032_fin_foundation` and `0033_fin_ledger` in the existing stream; `packages/fin-contract` (`@tugeel/fin-contract`); `packages/shared/src/mn` (`@tugeel/shared/mn`); `tools/finance-core/` (the whitelist, `pnpm core:standalone`, the `fin.` SQL scan); the test StaticCaller `apps/api/test/harness/static-caller.ts` |
| Depends on | no module: an exact whitelist of `common/**` files, `@tugeel/shared/{money,time}` and `@tugeel/fin-contract` (§3) |
| Used by | Bto modules through `finance-core/index.ts` only (`billing`, `fin-bridge`, `pos`; later `delivery`, `procurement`, `hr`); the resort's PMS (its own repository, after Bto's go-live) through `@tugeel/fin-contract` over HTTP (A2) |

**Each system keeps its own books (ADR-0088, owner 2026-10-20).** This module is Bto's finance module and books only Бүтэн-Оргил ХХК. The resort's system will copy it (code, screens, principles) into its own project and keep its own books. Nothing posts between the two systems. Wherever this document plans a PMS posting to this core, an HTTP or asynchronous intake (A1, A2), the TESTPMS fixture, intercompany parties, consolidation or isolation between companies on one server, that plan is **cancelled**. §14.2 is kept only as an example of the rules' reach. The boundary (§3) and `pnpm core:standalone` stay, because they make the copy cheap.

Finance Core is one finance engine for every business system the owner builds. Bto (the wholesale centre's system) is its first source system. The resort's PMS follows after Bto's go-live, in its own repository and on its own site server. A group control system comes later and only reads. Bto keeps picking, delivery, warehouses, products, orders, tills and its credit policy; the PMS will keep bookings, rooms, guests and housekeeping. The core keeps parties, receivables and payables as open items, payments, the journal, account balances, periods and the financial reports. If using the core from another project ever needs Bto code, the boundary is wrong (the owner's requirement, 2026-10-18).

**How to read this document.**
- A fact from the code carries a citation `path:line`, checked at commit 3577787.
- "Seen in Erkhet" means Erkhet's UI or handbook. Erkhet was read through its UI only, and one posted sale was opened. An inference about Erkhet is called one, and is never adopted without the accountant.
- Everything else is the plan, accepted by the owner in ADR-0069 … ADR-0077 and cut to the go-live essentials by ADR-0083 (§16.0). Where a section describes something §16.0 moves after go-live, it describes the later state; the phase that builds it is named there.
- **TODO-VERIFY** marks an accounting or tax rule the accountant must confirm (§18). It is never resolved by guessing.

Path abbreviations: `F/` = `apps/api/src/modules/finance/`, `P/` = `apps/api/src/modules/pos/`, `S` = `packages/shared/src/finance/index.ts`, `M26` / `M27` = `apps/api/src/db/migrations/0026_finance.sql` / `0027_pos.sql`, `FC/` = the planned `apps/api/src/finance-core/`.

## 1. Owner's answers behind the design (2026-10-18)

| # | Topic | Answer | Consequence |
|---|---|---|---|
| D1 | Who uses the systems | only the owner's own group | one tenant (the group) with several companies; no pooled multi-tenant service, no row-level security now (ADR-0076) |
| D2 | The resort's legal entity | a separate ХХК | company `RES` beside `BO` in the same tenant, with its own TIN and VAT return; goods from Bto to the resort are intercompany (an INTERNAL party); consolidation with elimination is a later job of the control system (ADR-0070) |
| D3 | Resort internet | weak; the resort needs its own small server | the PMS, its outbox and its own PosAPI box run at the site; the books stay central (the store-edge pattern, ADR-0063 / ADR-0067) |
| D4 | PMS start | after Bto's go-live | A1 and A2 land at the PMS kickoff; the engine is proven earlier with the TESTPMS fixture (source system `TEST_PMS`, P3) |
| D5 | Erkhet at go-live | stops on the go-live day | the core's go-live scope is the full set of books (ADR-0077, §16.2) |
| Pace | When to carve | start now | P0a on 2026-10-18, before e-Barimt on invoices |
| D7 | Applying advances and overpayments | only by the accountant, by hand | no automatic application anywhere; a manual ALLOCATION document and its screen (§11) |
| D7b | An overdue invoice while an unapplied credit exists | no preference | default: the overdue amount blocks only when it exceeds the party's unapplied credits (§10); the owner may change it |
| D10 | A document dated in a closed month | it waits in the pending list | `intake.late_posting` = HOLD; never moved to another month automatically (§13) |
| D11 | Finance refuses a Bto sale | stop the sale, as today | `submitInTx` inside the sale's transaction; a refusal rolls the sale back |
| D16 | Account numbers | Erkhet's account codes | Erkhet's chart is imported; the accountant marks the control types (§5) |
| FA | Fixed assets and depreciation | in the new books | a fixed-asset sub-ledger in the core before go-live, reused by the PMS |
| D19 | Erkhet's "BTO" sub-system (API key, erkhet.bto.mn) | the company's previous system | today's sales and till program feeds Erkhet through it; Bto replaces both at go-live; no Erkhet bridge or export is planned |
| D21 | Payroll | in the new system, later | `hr` posts through the intake (source `HR`); the accountant posts payroll by hand until then |
| D22 | PMS repository | a separate project | HTTP intake (A2) and a versioned `@tugeel/fin-contract` (plus the `mn` rules the PMS needs) are required before the PMS; the PMS never imports core code |
| Bank | Daily bank statement import before go-live | yes | Khan Bank Excel first; go-live-critical |

Defaults kept because they were not asked (they change only with a new answer):
- **D13.** One party register per tenant and balances per company. The same real customer in two systems is linked by the accountant, never automatically by TIN: Bto has one customer per store, so TINs repeat (ADR-0032).
- **D14.** Credit limits, holds and terms stay in `partners` until a second system extends credit.
- **D18.** No maker ≠ checker rule (one accountant); the setting exists and is off.
- **D20.** MNT only. Currency columns exist and MNT is enforced.
- **D23.** A voided invoice is re-billed through a new order.

## 2. What the core owns, and what it does not

| Layer | Owns | Never holds |
|---|---|---|
| Finance Core (`FC/`, schema `fin`) | what is equally true for a wholesaler, a hotel and a third business: tenant, companies, branches, source systems and their grants, parties, document types, posting keys and rules, accounts, money accounts, tax codes and rates (as data), numbering, documents, journal entries and lines, open items, allocations, balances, periods, the intake log, audit, reconcile runs, drafts | products, units, packs, warehouses, bins, orders, routes, tills, rooms, folios, guests; Mongolian tax law in code |
| Bto | products, stock, orders, picking, delivery, tills; the commercial invoice with its product lines and the sales return that puts goods back (`billing`, ADR-0073); its credit policy; costing | core tables: Bto writes none, it sends commands |
| PMS (later, its own repository) | bookings, rooms, guests, folios, housekeeping, its own outbox | core code: it uses `@tugeel/fin-contract` over HTTP only |
| Mongolian layer (ADR-0074) | `@tugeel/shared/mn`: VAT and city-tax kinds and codes, the tax-inclusive split, the Erkhet-style chart template, number defaults, e-Barimt receipt shapes, statutory templates as data. `modules/ebarimt`: receipts keyed by the source document. No `paygate` module and no QPay (owner, 2026-10-18; ADR-0080): payments arrive as RECEIPT documents from the accountant's vouchers, the till's cash and card tenders and the bank statement import | reads no `fin.*` table; never hands `lottery`, `qrData` or a receipt request to the core |

The core never imports the Mongolian layer. Tax codes, rates and the chart reach it as data through `FinConfig` (§8).

### 2.1 Today's finance code and where it goes

| Today | Coupling to Bto | Destination |
|---|---|---|
| Invoice at the sale, `F/services/invoicing.service.ts:53-158` | sales hook types; FKs to sales orders, products, units, warehouses and branches; packs-first parts (`S:202-298`) | split: the invoice with product lines → Bto `billing`; the receivable and its entry → core `AR_INVOICE` |
| Invoice void, `invoicing.service.ts:164-242`, dated today (`:203-208`) | `invoices_order` has no WHERE clause (`F/schema.ts:259`) | core `REVERSE`, dated the correction day as today |
| Credit note with goods back, `F/services/credit-notes.service.ts:137-379` | `StockPostingService`, the RETURNS bin, `returned_base` | split: Bto's sales return owns stock and quantities; the core gets `AR_CREDIT` |
| Vouchers, allocation, payment void, `F/services/payments.service.ts:159-398,558-636` | `collected_by` is the driver (`:49`); a staff `AuthContext` is required (`:218`); a void marks allocations `voided_at` (`:344-354`) | core RECEIPT / PAYMENT; the driver becomes an attribute; allocations append-only |
| AR ledger, cache, reconcile, `F/services/ar-ledger.service.ts:131-139,432-487` | the cache is compared with `ar_entries` only, never with the GL | core open items plus a sub-ledger ↔ GL reconcile |
| Credit control, `F/services/credit-control.service.ts:18-39` | HOLD → OVERDUE → LIMIT over `partners` columns | Bto policy over the core's `exposureInTx` (§10) |
| Chart and roles, `S:91-109,327-349`; boot seed `F/reference-data.ts:16-30` | one account per role in the whole database (`F/schema.ts:79`); POS roles in a DB CHECK (`M27:321`) | a chart per company; roles become posting rules; the template goes to `mn` |
| Journal, `F/services/journal.service.ts:159-329`; balance trigger `M26:374-398` | `customer_id` on lines (`F/schema.ts:203`); "reversed once" is checked in code only (`journal.service.ts:243-253`) | core, with UNIQUE `(company_id, reverses_id)` |
| Numbering, `F/services/finance-settings.service.ts:33-108`; `S:15-44` | global scopes; borrows the sales number rules (`S:1-8`) | core, per company and document type; Bto keeps `Н-` / `К-` |
| Tax split, `S:176-200`; `apps/api/src/modules/catalog/services/tax.service.ts:50-97` | exactly two taxes from global settings (`packages/shared/src/settings/index.ts:6-22`) | `@tugeel/shared/mn` computes; the core stores and verifies tax lines |
| POS shift entry and hand-over, `P/services/pos-shifts.service.ts:148-283,337-377` | POS builds the Dr/Cr lines by role (`:346-363`) | Bto adapter: JOURNAL and RECEIPT commands by posting key (H2) |
| AI views, `M26:423-487` | no view filters rows (`apps/api/src/db/migrations/0017_ai.sql:79`) | core views filtered by company (§12), plus Bto views |
| Print header, `packages/shared/i18n/mn.json:2505` | one company name in i18n | the core's company register |
| Raw SQL into finance, `apps/api/src/modules/inventory/services/stock-posting.service.ts:717` | a boundary leak ESLint cannot see | fixed inside Bto (H1) |

No finance table has a tenant, company or currency column today.

## 3. Dependencies and the boundary (ADR-0069)

### 3.1 Graph (arrow = "depends on")

```
apps/web (Bto UI) ──> @tugeel/api-client ──HTTP──> apps/api (Bto controllers, incl. the legacy finance routes)
PMS (own repository, site server) ──> @tugeel/fin-contract ──HTTP /api/fin/v1 (A2)──> apps/api
control system (later) ──read only──> role fin_control over fin_ctl.* views, or the HTTP FinReader

apps/api, Bto side:
  sales ──hooks──> billing             (billing binds CREDIT_CHECKER and SALE_SINK)
  billing ──> identity, catalog, partners, inventory, sales, ebarimt, fin-bridge, finance-core/index
  pos ──> identity, catalog, pricing, inventory, ebarimt, fin-bridge, finance-core/index
  delivery, procurement, hr ──> fin-bridge, finance-core/index
  fin-bridge ──> identity, partners, finance-core/index   (contexts, party refs, the legacy routes after H1)
  ebarimt ──> common/**, @tugeel/shared/mn, src/integrations/ebarimt
  ai, reporting ──SQL views only──> ai.fin_* over fin.*
finance-core ──> an exact whitelist in common/**, @tugeel/shared/{money,time}, @tugeel/fin-contract
@tugeel/fin-contract ──> zod
@tugeel/shared/mn ──> @tugeel/shared/{money,time,taxpayer}
```

`MODULE_DEPS` changes (today `eslint.config.mjs:37-58`): `finance` becomes `billing` at H1 and `fin-bridge` is added; `ebarimt` becomes `[]` (today `['identity', 'catalog']`, `:47`); `pos`, `delivery` and `procurement` replace `finance` with `fin-bridge`; `sales` drops `ebarimt`.

### 3.2 Rules (since P0b, each proved by a fixture in `tools/lint-guards/guards.test.mjs`; as built in §3.5)

1. `api-finance-core` imports only the exact files of its whitelist: never `modules/**`, `edge/**`, `common/segments`, `common/attention.ts`, `common/config`, `db/schema.ts` or `@tugeel/shared/sales`.
2. Other elements import only `finance-core/index.ts`.
3. Only the core writes `fin.*` tables; inside the core only `FC/posting/**` writes the ledger tables (documents, journal, open items, allocations, intake log) and imports their table symbols (a G2-style rule). Configuration, periods, drafts, parties and settings are written by the core's other services. Every `fin` symbol is prefixed (`finBranches`, `finSettings`), so it never collides in the aggregated `db/schema.ts`.
4. `FinIntakeInTx` may be imported by `modules/finance` (until H1), `billing`, `pos` and `fin-bridge`; the list grows, by that session's ADR, when delivery, procurement or hr start posting.
5. The `FinCallContext` factory is used only inside `fin-bridge`. The test `StaticCaller` lives only under `test/**`, and production boot asserts that it is absent.
6. G3 (the `Number(` / `parseFloat(` ban) extends to `FC/**` by adding the `finance-core/**` glob to the `files` of the existing `guard/G3` block. Flat config replaces `no-restricted-syntax` per block, which is why `guard/G3` repeats TX_GUARD (`eslint.config.mjs:361-363`); a block of its own would drop TX_GUARD for those files. TX_GUARD already covers `apps/api/src/**` (`guard/TX`, `eslint.config.mjs:356-357`).
7. A grep test: no `fin.` table name in an SQL string outside `FC/**` and the migrations.

`app` gets DML on every new table through default privileges (`apps/api/src/db/migrations/0000_foundation.sql:44-46`). "Bto never writes core tables" therefore rests on these rules and tests, not on grants.

### 3.3 A Bto-free platform first (P0b; done, §3.5)

Today `common/**` names Bto: `Db` and `Tx` are typed over the whole aggregated schema (`apps/api/src/common/db/db.types.ts:3-8`); error codes come from Bto's single catalog (`apps/api/src/common/errors/app-error.ts:1`); the job list hard-codes Bto's jobs (`apps/api/src/common/jobs/job-registry.ts:10-29`) and `jobs.service.ts:4` imports `Tx`; `canonicalJson` lives in identity (`apps/api/src/modules/identity/interceptors/idempotency.interceptor.ts:61`). A whitelist alone would pass lint while `tsc` still compiles every Bto schema file. The P0b work list:
1. **`common/db/any-tx.ts`:** `AnyTx = PgTransaction<NodePgQueryResultHKT, any, any>`. The core's `FinTx = AnyTx`, so `submitInTx(tx: FinTx, …)` accepts Bto's `Tx` (a type test proves it). The core builds its own Drizzle instance over the shared pool with its own schema object, as the edge does (`apps/api/src/edge/db/edge-db.ts:16-36`).
2. **Errors:** `common/errors` becomes code-agnostic with a status registry. Bto registers its catalog; the core registers `FIN_*` from `@tugeel/fin-contract` as `Record<FinErrorCode, number>`, so a missing status fails typecheck. `@tugeel/shared` re-exports the FIN codes for the web's i18n.
3. **Jobs:** `JobPayloads` is augmented by interface merging; `JOB_QUEUES` is merged from per-owner maps; `PG_BOSS` and `DB_POOL` move to token-only files.
4. **Helpers:** `canonicalJson` → `common/json/canonical.ts`; the gap-free counter upsert → `common/db/counters.ts`, called by identity and the core.
5. **Time:** `businessDateIn(tz, at)` in `@tugeel/shared/time`. The core uses `companies.timezone` and never the constant `BUSINESS_TZ` (`packages/shared/src/time/index.ts:9`).
6. **Mappings:** Jest (`apps/api/jest.config.js:11-15`), tsconfig, Vitest and the package `exports` learn `mn` and `@tugeel/fin-contract`.

**Build alone.** `pnpm core:standalone` runs `tsc --listFilesOnly -p apps/api/tsconfig.finance-core.json`; a script asserts that the list holds only `src/finance-core/**`, the whitelisted files and the allowed packages. It runs inside `pnpm check`. A boot test starts `FinanceCoreModule` with a `StaticCaller` and only the database and job providers, without any Bto module, and posts a document of the TESTPMS fixture (source system `TEST_PMS`).

**Same code everywhere.** Running the core on its own later is `ROLE=finance` from the same image (the edge precedent, ADR-0067), never a copy or a fork.

### 3.4 `@tugeel/fin-contract`

The package holds the types, the zod v1 schemas, the error codes, the permission codes and the contract fixtures. It depends only on zod and is CommonJS with the `@tugeel/source` condition, like every workspace package (ADR-0025). Its version follows the contract (`fin.intake/1.x` → package `1.x`) so another repository can consume it; how the PMS repository receives it (a private package registry or a git tag) is decided in the A2 session's ADR. A unit test asserts that Bto's permission catalog lists the same finance codes. Every v1 fixture must parse forever. The `mn` rules the PMS needs (the tax split, the e-Barimt shapes) are published the same way; the package cut (all of `@tugeel/shared`, or `mn` with a small money and time kernel) is chosen at the PMS kickoff (ADR-0074).

### 3.5 What P0b built (2026-10-18)

No migration, no route, no screen; today's tests unchanged. Every old import path still works.

**The whitelist** (`tools/finance-core/whitelist.mjs`, read by ESLint and by `pnpm core:standalone`): `src/common/db/any-tx.ts`, `src/common/db/counters.ts`, `src/common/db/db.tokens.ts` (`DB_POOL`, token only), `src/common/db/types.ts` (`money()` / `qty()` / `cost()`), `src/common/errors/coded-error.ts`, `src/common/json/canonical.ts`, `src/common/jobs/job-catalog.ts`, `src/common/jobs/jobs.service.ts`, `src/common/jobs/jobs.tokens.ts` (`PG_BOSS`, token only), `src/common/jobs/worker/job-handler.ts`; the packages `@tugeel/shared/money`, `@tugeel/shared/time`, `@tugeel/fin-contract`. A session that adds a file says why here; each file stays Bto-free (`core:standalone` follows the imports).

**The Bto-free platform (§3.3, done).**
- `AnyTx = PgTransaction<NodePgQueryResultHKT, any, any>` (the one `no-explicit-any` exception, in `eslint.config.mjs`); the core's `FinTx = AnyTx`. `common/db/any-tx.spec.ts` proves Bto's `Tx` is assignable to both.
- Errors: `common/errors/coded-error.ts` holds `CodedError<C>` (code, status, detail, params, errors), `isCodedError` and `registerErrorStatuses(owner, table)`, which refuses a code that two owners register. Bto's `AppError` (same path, same constructor) extends `CodedError<ErrorCode>` over `ERROR_HTTP_STATUS`; the core's `FinError` extends `CodedError<FinErrorCode>` over `FIN_ERROR_HTTP_STATUS` (`satisfies Record<FinErrorCode, number>`, §7). `toProblem` renders any `CodedError` as problem+json; the `ProblemDetails` DTO and the OpenAPI enum are unchanged. A `FinError` is **not** an `AppError`: Bto code that catches `AppError` to park a refusal (the POS replay) must catch `CodedError` once it posts through the core (P4, H2).
- Jobs: `common/jobs/job-catalog.ts` holds the base `JobPayloads` (`system.ping` only), `ScheduledPayload`, `QueueOptions`, `scheduledQueue()`, `COMMON_JOB_QUEUES`, `PGBOSS_SCHEMA`, `JOB_NAME_PATTERN`. `job-registry.ts` (Bto's, its exports unchanged) adds Bto's jobs by interface merging and builds `JOB_QUEUES = { ...COMMON, ...BTO }`; the core adds its own augmentation and queue map at A1. `JobsService.enqueue(tx: AnyTx, …)`; `PG_BOSS` lives in `jobs.tokens.ts` (`pg-boss.provider.ts` re-exports it).
- `canonicalJson` → `common/json/canonical.ts` (the interceptor re-exports it); the gap-free upsert → `common/db/counters.ts` `nextCounterValue(tx, counterTable, key)`, which identity's `NumberingService` calls with the same SQL.
- `businessDateIn(timeZone, at)` in `@tugeel/shared/time`; `businessDate(at)` is `businessDateIn(BUSINESS_TZ, at)`.

**`@tugeel/shared/mn`** (ADR-0074 #2): `tax.ts` (`TAX_KINDS`, `VAT_TAX_CODES` `MN.VAT.STD|ZERO|EXEMPT`, `cityTaxCode(activityCode)` → `MN.CITY.<7 digits>`, `taxSplit` moved unchanged), `chart.ts` (`ACCOUNT_KINDS`, `CHART_ROLES`, `CHART_TEMPLATE`), `numbers.ts` (`NUMBER_DEFAULTS` Н/Т/К/Ж), `ebarimt.ts` (`RECEIPT_TYPES`, `EBARIMT_STATUSES`, `EBARIMT_PAYMENT_CODES` CASH, PAYMENT_CARD, BANK_TRANSFER; PosAPI's QPay code is not used, ADR-0080). `@tugeel/shared/finance` re-exports them as `taxSplit`, `GL_ACCOUNT_KINDS`, `GL_ROLES`, `DEFAULT_GL_ACCOUNTS`, `FINANCE_NUMBER_DEFAULTS`, and `@tugeel/shared/pos` the receipt shapes; `mn.test.ts` compares the split with the 3577787 formula on 1,000 seeded lines and checks that the re-exports are the same objects. The `vat_type` → tax code map stays TODO-VERIFY.

**`@tugeel/fin-contract` 1.0.0** (`private` until A2 chooses the registry): `src/v1/intake.ts` (the §6 types and strict schemas), `src/v1/config.ts` (the `fin.config/1` inputs: `AccountV1`, `DocumentTypeV1` with its declared `keys`, `PostingRuleV1`, `TaxCodeV1`, `TaxRateV1`, `CoverageReportV1`; the classes, controls and kinds), `src/v1/read.ts` (`ExposureV1`, `TaxPositionV1`, `PageV1`, `OpenItemV1`, `StatementV1`, `TbRowV1`, `LedgerLineV1`, `DocumentV1`, `SourceKeyStatusV1`, `IntakeV1`, `FreshnessV1`, `MoneyAccountV1`), `src/errors.ts` (the 32 codes of §7, `FIN_RETRYABLE_CODES`, `FIN_HELD_CODES`), `src/permissions.ts` (the 12 rights of §13), `fixtures/intake/1.0/*.json` (§14 E2, E3, E4, E6, E7, §14.2 rows 2–4, the deposit paid by bank transfer since QPay is dropped, a POSTED and a REJECTED result). The intake command and its fixtures are normative now; the read and config shapes are a draft that P3 may still reshape (no consumer outside this repository exists until A2 publishes the package). The port interfaces (`FinReader`, `FinConfig`, `FinCreditPortInTx`, `FinIntake`, `FinIntakeInTx`) take core types (`FinTx`, `FinCallContext`) and come with the core in P1 / P3. `@tugeel/shared/errors` re-exports `FIN_ERROR_CODES` for the web (not part of `ERROR_CODES`; their mn.json texts come with the first screen that shows one). `packages/shared/src/auth/finance-permissions.test.ts` checks Bto's `finance.*` rights against `FIN_PERMISSIONS` minus the seven still to be granted (`documents.approve`, `periods.close|reopen|override`, `intake.replay`, `config.manage`, `control.approve`).

**The core** (`apps/api/src/finance-core/`): `index.ts` (the only public file), `FinanceCoreModule` (imported by `AppModule`; provides `FIN_DB`, its own Drizzle over `DB_POOL` with an empty schema object, the `createEdgeDb` pattern), `db/fin-db.ts` (`FinDb`, `FinTx`), `errors.ts`; `finance-core.module.spec.ts` boots the module with nothing but a `DB_POOL` provider. The TESTPMS boot test that posts a document is P3's.

**Lint** (`eslint.config.mjs`, 39 new cases in `guards.test.mjs`):
- G1: element `api-finance-core` (`apps/api/src/finance-core`). The core → only itself, the whitelisted `apps/api` files (`fileInternalPath`), npm packages and exactly the three workspace specifiers (`dependency.source`, because `module.source` is the package name only); everything else is refused, type imports included. Bto's modules and the api's own files → only `finance-core/index.ts`; `db/schema.ts` and tests also → `finance-core/schema.ts` (P1's aggregation); client apps, packages and integration clients → never, not even the index.
- G2, composed per file group from named bans (`API_IMPORT_BANS`): `stockLedger` (as before), the fin ledger symbols `finDocuments`, `finJournalEntries`, `finJournalLines`, `finOpenItems`, `finAllocations`, `finIntakeRequests`, `finIntakeAttempts` (only `finance-core/posting/**`), `FinIntakeInTx` from the core (only `modules/{finance,billing,pos,fin-bridge}`), `createFinCallContext` (only `modules/fin-bridge`), and test code (`apps/api/src` never imports a `test/` path, so `StaticCaller` cannot reach production). The names are reserved for the phases that create them; the runtime "no StaticCaller at production boot" comes with the caller (P1 / P3). A block for `packages/shared/src/mn/**` allows only `../money`, `../time`, `../taxpayer`.
- G3 (and its TX_GUARD) covers `apps/api/src/finance-core/**`.
- Rule 7: `tools/finance-core/fin-sql.test.mjs` walks the TypeScript AST of `apps/api/src` outside the core and the migrations and fails on a string that reads as SQL and names a `fin.` relation (`fin.company_ids`, contract ids such as `fin.intake/1` and job names are not relations).

**`pnpm core:standalone`** (`tools/finance-core/standalone.mjs`, in `pnpm check` after `typecheck`): `tsc --noEmit -p apps/api/tsconfig.finance-core.json` (the core compiles without Bto's interface augmentations: it sees only `system.ping` and the FIN codes), then `--listFilesOnly`, refusing any file outside the core, the whitelist, `packages/shared/dist/{money,time}/**`, `packages/fin-contract/dist/**` and the npm list of `whitelist.mjs`, and any core file missing from the build. On 2026-10-18 the build held 7 core-side repository files (4 core files, `any-tx.ts`, `coded-error.ts`, `db.tokens.ts`) plus the contract's `dist`. A trial import of `modules/sales` from a core file failed both lint and the standalone check (518 files refused).

**What P1 inherits.** `finance-core/schema.ts` with `pgSchema('fin')` and prefixed symbols goes into `createFinDb`'s schema and the aggregated `db/schema.ts` (lint already allows that one import); `modules/fin-bridge` gets `createFinCallContext` (lint already restricts it); `StaticCaller` under `apps/api/test/**` plus the production boot assertion; new rights join Bto's catalog and leave `NOT_GRANTED_YET`.

### 3.6 What P1 built (2026-10-20, ADR-0084) — the organisation half of F1

No ledger table moved; today's finance screens and tests are unchanged.

**Schema `fin`** (`FC/schema.ts`, `pgSchema('fin')`, symbols `fin*`, listed by name in `createFinDb` and in the aggregated `db/schema.ts`; migration `0032_fin_foundation`): `tenants`, `companies`, `company_tax_registrations`, `branches`, `branch_refs`, `source_systems`, `source_grants`, `posting_keys`, `parties`, `party_refs`, `party_companies`, `audit_log` (§4).
- Scope as §4 says: `company_id` or `tenant_id` on every row; `UNIQUE (company_id, id)` (or `(tenant_id, id)`) as named constraints, not unique indexes, because drizzle-kit creates indexes after the foreign keys; every key between company-owned tables carries the company; tenant-level rows are reached from a company only through `source_grants` and `party_companies`; every unique key leads with its scope; no foreign key crosses `fin` / `public`. Shapes in CHECKs: codes `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`, names 1–200 after trimming, register number and TIN ≤ 32 characters without control characters, a party is INTERNAL exactly when it names an intercompany company.
- Grants: `REVOKE ALL ON SCHEMA fin FROM PUBLIC`, `GRANT USAGE … TO app`; `app` has no DELETE or TRUNCATE on any `fin` table and no UPDATE on `company_tax_registrations` and `audit_log`; `ai_reader` has nothing. `fin.forbid_update_delete()` (the core's own copy) makes those two append-only for every role (23001). The test harness truncates `fin` too.
- The data section (between `-- fin_foundation:data:begin` / `:end`): tenant `BUTEN_ORGIL`, company `BO` «Бүтэн-Оргил ХХК» with register number and TIN NULL (the owner types them on «Компани»; the repository is public), sources `BTO` and `FIN` granted to BO, tax registrations copied from the settings `company.vat_payer` / `company.city_tax_payer`, `LEGACY_UNASSIGNED` (kind OTHER, ref under FIN), one party per customer (`customer:<id>` under BTO, in BO), and `identity.user_company_roles` = `user_roles` in BO; a `DO` block raises on a count mismatch. `fin-bridge.int-spec.ts` replays it against today's rows.

**The core.**
- `context/call-context.ts`: `FinCallContext`, branded (a type that cannot be written by hand, and a run-time `WeakSet` check, so a spread copy is refused); principals `SOURCE {tenant, system}` and `USER {tenant, ref}`; the USER's rights per company code (only `finance.*` codes survive); the actor (attribution only). `context/static-caller-guard.ts`: a production process in which the test StaticCaller was loaded refuses to start (`FinBootGuard`).
- `context/authorize.ts` `resolveCompany`: the company inside the principal's tenant, ACTIVE, else `FIN_COMPANY_UNKNOWN`; a USER needs one of the port's rights there (`FIN_COMPANY_FORBIDDEN`); a SOURCE needs the port to accept sources and an ACTIVE source with an ACTIVE grant (`FIN_SOURCE_NOT_GRANTED`). Every port starts here.
- `audit/fin-audit.ts` `recordFinAudit(tx, ctx | {system}, entry)`: actor kind, ref and label, the principal (`SOURCE:<system>`, `USER:<ref>`, `SYSTEM`), action, entity, before / after, request id.
- `org/ensure-default-company.ts` `ensureDefaultCompany(tx, spec)` (advisory lock 72_026_130): insert-only tenant, company, sources, grants, posting keys and the legacy party; mapped branches follow the spec's code, name and status, an unmapped INACTIVE one is skipped (ADR-0084 #1, #8). `FinInstallationSpec` is what an installation books into; fin-bridge builds Bto's (`docs/modules/fin-bridge.md` §3), the StaticCaller a test one.
- `org/org.service.ts` `FinOrgService`: `company(ctx, {company})` (a granted source or a user with `finance.read` / `finance.settings.manage`) and `updateCompany(ctx, {company, legalName, registerNo, tin})` (a user with `finance.settings.manage` there; generic shapes only; audited when something changes).
- `parties/parties.service.ts` `FinPartiesService`: `upsertPartyInTx` (a SOURCE only; one writer per (source, ref) under advisory lock 72_026_131; creates the party, its ref and its `party_companies` row, or follows kind, name, TIN and register number; never matched by TIN) and `resolvePartyInTx`.

**Bto's side** (`modules/fin-bridge`, ADR-0084): contexts, the customers' parties through partners' `CUSTOMER_CHANGED_HOOK` (api and worker), «Компани» (`GET` / `PATCH /api/v1/company`), the boot step. Identity: `bto.company_code` (setting kind `code`, locked, default BO), `user_company_roles` mirrored on every role write, `AuthContext.companyPermissions`.

**Tests.** `src/finance-core/context/*.spec.ts` (the brand, a forged copy, the boot guard); `test/integration/fin-core.int-spec.ts` boots `FinanceCoreModule` over a bare pool with **no Bto module** (`createFinanceCoreOnly`) and the StaticCaller (tenant `TEST_T`, company `TST`, source `TEST_PMS`): the installation step is idempotent and follows branches, the company is read and edited only with the right rights, other tenants and ungranted sources are refused, parties follow their source and race safely, a forged context is refused; `test/integrity/fin-isolation.spec.ts` (the catalog: scope, keys, bridges, grants, cross-company and cross-tenant inserts refused with 23503); `test/integrity/fin-org-guards.spec.ts` (ten installations starting together make one of everything; the append-only and no-delete guards); `fin-bridge.int-spec.ts` and `company-roles.int-spec.ts` (Bto's side).

**What the rest of F1 and F2 inherit.** The organisation and its contexts; `FinPartiesBridge.resolveCustomerParty` for the invoices' party (F2); `LEGACY_UNASSIGNED` for control lines without a counterparty; the posting keys (rules come with the accounts); `fin.audit_log` for the ledger's configuration changes.

### 3.7 What F1's ledger built (2026-10-20, ADR-0089) — F1 done

Today's finance screens and HTTP answers are unchanged. The chart, the money accounts and the journal live in schema `fin`; Bto's `modules/finance` posts and reads them through `finance-core/index.ts`.

**Schema** (`FC/schema.ts`, migration `0033_fin_ledger`). Scope rules as §3.6.
- `accounts`: code, name, kind, `normal_side`, `control`, status.
- `money_accounts`: code, name, kind CASH / BANK / CLEARING, an optional branch, `account_id`, bank fields, `show_to_customers`, status.
- `posting_rules`: company, `posting_key`, `account_id` or NULL = unmapped, `effective_from`. Append-only. The newest rule in force on the date wins.
- `fiscal_periods`: `YYYY-MM`, OPEN / CLOSED.
- `journal_entries`: number, date, period, source system, source document type and id, `reverses_id`, description, actor by value. UNIQUE `(company_id, number)` and `(company_id, reverses_id)`.
- `journal_lines`: account, debit / credit, party (through `party_companies`), money account, branch, posting key and rule.
- Hand-written:
  - REVOKE DELETE / TRUNCATE on all six tables, and UPDATE on the rules and the journal;
  - `fin.forbid_update_delete` triggers on the rules and the journal;
  - `fin.journal_entry_balanced()`, deferred, at least 2 lines and Σ debit = Σ credit at commit;
  - `ai.payments` recreated over `fin.money_accounts` / `fin.accounts`.
- The data section:
  - the posting keys and the ACTIVE Bto branches, mapped as the boot step does;
  - `gl_accounts` → `fin.accounts` with ids kept: control from the role's key, contra 520101 / 520201 debit-normal;
  - each role → a company-default rule from 2000-01-01;
  - `money_accounts` → `fin.money_accounts` with ids kept;
  - the documents' journal ids cleared;
  - a `DO` check of the counts;
  - a RAISE when a MANUAL or OPENING entry exists (nothing could post it again).
  Then `gl_accounts`, `money_accounts`, `journal_entries`, `journal_lines`, their FKs and the public `journal_entry_balanced()` are dropped.

**The core.**
- `ledger/chart.service.ts` `FinChartService`:
  - accounts: list, by ids, `createAccountInTx`, `updateAccountInTx`; normal side from the kind, a contra account keeps its side;
  - `rules(on, lock)` and `setRuleInTx`, under a per-company advisory lock;
  - money accounts: list, `lockMoneyAccountInTx` FOR SHARE, create, update; the branch by a source's ref.
  - Read by a granted source or `finance.read`. Written by a user with `finance.config.manage`, or today's rights: `finance.journal.manage` for accounts, `finance.settings.manage` for rules and money accounts.
  - `ensureDefaultChart(tx, scope, template)` fills only an empty chart.
- `ledger/periods.ts`:
  - `monthOf` — calendar arithmetic only;
  - `openPeriodInTx` — the month is created OPEN on demand unless a later or equal month is CLOSED, then share-locked; otherwise `FIN_PERIOD_CLOSED`.
- `posting/journal-posting.service.ts` `FinJournalPosting` (the F1 façade; G2: `modules/finance` only):
  - `postEntryInTx` / `reverseEntryInTx`. A line's account is its id, else its money account's, else its key's rule.
  - Checks: `FIN_UNBALANCED`, `FIN_AMOUNT_PRECISION`, `FIN_MAPPING_MISSING`, `FIN_ACCOUNT_INACTIVE` and the period.
  - A SOURCE posts as itself; a USER with `finance.journal.manage` posts as source FIN.
  - The number is the caller's until F2.
- `posting/journal-reader.service.ts` `FinJournalReader`: entries (dates, origin = system / document type / reversal, account, party, keyset), an entry with lines, numbers, reversals, turnover per account, an account's ledger with a running balance and the opening. The reader lives beside the posting code because only `posting/**` names the journal tables.
- `FinPartiesService.refsOf` / `partiesOf` (party ↔ the source's ref); `FinOrgService.syncBranchInTx` (P1's branch sync for a branch added after boot).

**Bto's side.**
- `modules/finance` keeps its public API and DTOs:
  - `GlAccountsService`: roles = the rules in force today; the role dialog writes rules dated today and unmaps the account's previous role.
  - `MoneyAccountsService`: the balance is still Σ vouchers.
  - `JournalService`:
    - validates as before and allocates `Ж-` numbers;
    - posts by role (`JournalLineInput.role`) with the customer's party;
    - turns `FIN_MAPPING_MISSING` back into `ACCOUNT_ROLE_MISSING`;
    - derives `source` (FIN = MANUAL; a BTO reversal = AUTO_VOID; else the document type).
  - These go through `FinBooks`, with fin-bridge's `FinContexts` and `FinPartiesBridge.customerPartyInTx` / `partiesOfCustomers` / `customersOfParties`.
- The line builders are pure exported functions: `invoiceEntryLines`, `creditNoteEntryLines`, `paymentEntryLines`, and pos's `shiftCloseLines`.
- `JournalRepostService` and `PosShiftsService.repostCloseInTx` serve `pnpm finance:repost-journal` (`apps/api/src/repost-journal.ts`; development only, idempotent).
- Finance's own chart sync (`reference-data.ts`) is gone; `FinBridgeBootstrap` runs `ensureDefaultChart` with `btoChartTemplate()` after `ensureDefaultCompany`.
- `MODULE_DEPS.finance` gains `fin-bridge`.

**Tests.**
- `test/integration/fin-ledger.int-spec.ts` runs the ledger with no Bto module:
  - the seed runs once;
  - an entry posts by key and keeps its rule; the month opens;
  - the four refusals;
  - a rule follows its date; an unmapped key is refused;
  - closed and earlier months are refused, a later one opens;
  - an entry is reversed once, keeping its document;
  - a user posts as FIN.
- `test/integrity/finance-guards.spec.ts`, same scenarios and SQLSTATEs on `fin.*`; the unbalanced commit is now tried as app too.
- `test/integrity/fin-ledger-guards.spec.ts`: two racing manual reversals, exactly one commits; the reversal key by hand → 23505; the rules append-only for app (42501) and migrator (23001).
- `fin-isolation.spec.ts` covers the new tables through the catalog.
- Lint cases for `FinJournalPosting` and `ensureDefaultChart`.

**What F2 inherits.**
- The chart, the rules and their resolution.
- Party, money-account and branch columns on every line, ready for the controls.
- The period lock.
- The source key on every entry, which `fin.documents` / the intake log will carry.
- The FIN source for the core's own screens.
- The façade, to be replaced by `submitInTx` (H2 later moves pos).

## 4. Data model (schema `fin`, ADR-0070 / ADR-0072 / ADR-0076)

Conventions: money `NUMERIC(14,2)`, bigint identity ids, ids as strings in the contract.
- `CREATE SCHEMA fin` follows the `ai` precedent (`apps/api/src/db/migrations/0017_ai.sql:88`). The migration adds `REVOKE ALL ON SCHEMA fin FROM PUBLIC; GRANT USAGE ON SCHEMA fin TO app`, because `app` has USAGE only on `public` today (`apps/api/src/db/provisioning.ts:203`).
- The `fin` triggers use `fin`-owned copies of `forbid_update_delete()` and of the balance function, so `pg_dump -n fin` is self-contained.
- No FK runs from `fin` into a Bto table. Bto keeps plain ids plus the numbers the core returns. POS already stores the numbers beside its ids (`journal_number`, `handover_number`, `P/schema.ts:263-266`), but those ids are FKs today; they are dropped when their tables move (§4.1).

**Scope rules** (a catalog test asserts them):
1. Every company-owned table has `UNIQUE (company_id, id)`, and every FK between company-owned tables includes `company_id`.
2. Tenant-level rows (parties, source systems) are referenced only through per-company bridge rows that carry `tenant_id`, with composite FKs: `journal_lines (company_id, party_id)` → `party_companies (company_id, party_id)`, and `party_companies (tenant_id, party_id)` → `parties (tenant_id, id)`.
3. Every unique index leads with `company_id` or `tenant_id`.

| Table | Key columns | Notes |
|---|---|---|
| `tenants` | id, code, name, status | one row: the owner's group |
| `companies` | id, tenant_id, code, legal_name, register_no, tin, functional_currency char(3) `MNT`, timezone `Asia/Ulaanbaatar`, fiscal_year_start_month, control_approved, status | `BO` (Бүтэн-Оргил ХХК) in P1, its TIN and register number from the owner; `RES` when the PMS starts. No company record exists today; the name is a UI string (`mn.json:2505`) |
| `company_tax_registrations` | company_id, tax_kind, effective_from, registered, activity_code | effective-dated, never updated; replaces the settings `company.vat_payer` / `company.city_tax_payer` |
| `branches`, `branch_refs` | (company_id, code, name, status); (company_id, source_system_id, external_id) → branch_id | the Bto ref is `identity.branches.id`, because branch codes are editable (`apps/api/src/modules/identity/services/org.service.ts:15-22`); a branch on every line (Erkhet shows departments on every line) |
| `source_systems`, `source_grants` | (id, tenant_id, code `BTO` / `FIN` / `PMS` / `HR` / `TEST_*`, link_template, status); (tenant_id, company_id, source_system_id, status) | `FIN` is the core's own screens; a system posts only into a company it is granted |
| `parties`, `party_refs`, `party_companies` | (id, tenant_id, kind COMPANY / INDIVIDUAL / INTERNAL / TAX_AUTHORITY / EMPLOYEE / OTHER, name, tin, register_no, intercompany_company_id, merged_into_id, status); (tenant_id, source_system_id, external_id → party_id); PK (company_id, party_id) plus tenant_id | `party_companies` is **the lock row** of every balance-changing write; Bto refs are `customer:<id>` / `supplier:<id>`, never a TIN |
| `accounts` | id, company_id, code, name, parent_id, is_group, kind, normal_side, control NONE / RECEIVABLE / PAYABLE / ADVANCE_RECEIVED / ADVANCE_PAID / MONEY, drains, status, first_posted_at | a party control needs a party on every line, MONEY a money account; `kind`, `normal_side` and `control` are frozen once posted (a trigger); `code` stays editable with an audit row |
| `money_accounts` | id, company_id, branch_id, code, kind CASH / BANK / CLEARING, account_id, bank fields | `account_id` frozen after the first posting |
| `posting_keys` | company_id, code, required_control, requires_tax_code | per company |
| `posting_rules` | id, company_id, posting_key, document_type_id?, source_system_id?, branch_id?, account_id, effective_from, effective_to | append-only; a change is a new row from a date |
| `document_types` | id, company_id, source_system_id, code, class, number_mode SOURCE / CORE, number_series_id, unapplied_key, requires_approval, allowed_in_soft_close, status | ACTIVE only after the coverage check; `requires_approval` is refused on a type posted in-process |
| `number_series`, `number_counters` | pattern, digits; PK (company_id, scope, period) | gap-free; rolls back with the transaction |
| `tax_codes`, `tax_rates` | (company_id, code, kind, out_key, in_key); (company_id, code, effective_from, rate_pct) | loaded from `mn` data |
| `fiscal_periods`, `period_events` | (company_id, code `YYYY-MM`, starts_on, ends_on, status OPEN / SOFT_CLOSED / CLOSED); append-only action, reason, actor, at | a row is created OPEN on demand only for a month later than the company's latest SOFT_CLOSED or CLOSED month; a document dated in an earlier month that has no row is refused with `FIN_PERIOD_CLOSED` (it goes to the pending list like any closed-month document, §13); P2 creates every month from the first entry's month to the current one |
| `intake_requests` | id, tenant_id, company_id, source_system_id, source_doc_type, source_doc_id, revision, action POST / REVERSE, source_doc_no, contract, last_command_id, payload jsonb, payload_hash, status POSTED / HELD / REJECTED / CANCELLED, error_code, error_params, attempts, via INPROC / JOB / HTTP / UI / MIGRATION, document_id, result jsonb, first_at, last_at | **business key UNIQUE (tenant_id, source_system_id, source_doc_type, source_doc_id, revision, action)**; the company is in the hashed payload, so the same key for another company is a CONFLICT, never a second booking |
| `intake_attempts` | tenant_id, source_system_id, company_id?, request_id?, command_id, payload_hash, outcome, error_code, transport, at | append-only; an authorisation refusal lands here with no company |
| `documents` | id, company_id, branch_id, document_type_id, class, number, document_date, accounting_date, period_id, currency, party_id, due_date, amount, control_total, description, the source key columns, attributes jsonb, intake_request_id, reverses_document_id, actor_kind / actor_ref / actor_label, approved_by_label, posted_at | **append-only** (REVOKE plus trigger, as `M26:358-370`); UNIQUE (company_id, document_type_id, number), (company_id, intake_request_id), (company_id, reverses_document_id) |
| `journal_entries` | id, company_id, number `Ж-…`, entry_date, period_id, document_id, reverses_id, description, posted_at, actor | append-only; the deferred balance trigger as `M26:374-398`; a document has 0 or 1 entry (an ALLOCATION has none) |
| `journal_lines` | id, company_id, entry_id, line_no, account_id, debit, credit, party_id, money_account_id, branch_id, source_system_id, posting_key, posting_rule_id, tax_code, tax_base, tax_date, currency, amount_tx, analytic_ref, description | append-only; UNIQUE (company_id, id, party_id, account_id) is the target of the item FK |
| `open_items` | id, company_id, party_id, account_id, side, document_id, journal_line_id, source_system_id, group_ref, item_ref, item_date, due_date, amount, open_amount | FK (company_id, journal_line_id, party_id, account_id) → lines; CHECK 0 ≤ open_amount ≤ amount; only `open_amount` is updatable (a column grant) |
| `allocations` | id, company_id, party_id, account_id, debit_item_id, credit_item_id, amount, document_id, reverses_allocation_id, created_at | append-only; two composite FKs force both items onto one party and one account |
| `party_balances` | PK (company_id, party_id, account_id), open_debit, open_credit, oldest_due_date | rewritten under the party lock (the ADR-0060 #4 pattern) |
| `audit_log`, `reconcile_runs`, `settings`, `drafts` | company_id first | `reconcile_runs.kind` CACHE / ITEMS / SUBLEDGER_GL / DRAIN: DRAIN reports clearing balances older than a per-account age (set with the accountant, TODO-VERIFY); it is a report and never exits 2. CACHE, ITEMS and SUBLEDGER_GL drifts exit 2. `settings` effective-dated per company; `drafts` is the only mutable document store |

**The sub-ledger rule.** Every line on a party-control account creates exactly one open item (a deferred trigger and an integrity test check it), and an allocation lowers one debit item and one credit item by the same amount. Hence for every (company, party, account) Σ open debit − Σ open credit = Σ debit − Σ credit: the detailed ledgers equal the GL by construction, and the nightly reconcile proves it. Moving a balance to another account or party (advance → AR, guest ledger → city ledger, a party merge, a write-off) is a document with lines. This closes today's gaps: a manual entry can hit AR with no `ar_entries` row, and the cash book reads `payments` only (`F/services/payments.service.ts:499-511`).

**Intercompany** is derived, not tagged per line. A party of kind INTERNAL carries `intercompany_company_id` (a composite FK to `companies (tenant_id, id)`); every line of a document whose party is internal is intercompany. Eliminations are posted later, in a group book of the control system.

### 4.1 Today's tables and where they go

| Table today | Destination |
|---|---|
| `gl_accounts` | `fin.accounts` (**done in F1**, ids kept, ADR-0089 #1–#2); `role` becomes one company-default row per role in `posting_rules`; the contra-income accounts 520101 and 520201 (kind INCOME, `S:327-349`) get `normal_side = DEBIT` |
| `money_accounts` | `fin.money_accounts` (**done in F1**, ids kept); kind gains CLEARING |
| `finance_settings` (`id = 1`) | the PAY / JE patterns → `fin.document_types` + `number_series`; the INV / CN patterns → `billing_settings` (Bto, H1) |
| `journal_entries`, `journal_lines` | `fin.*` (**done in F1**, no copy: dropped and posted again by the development re-post, ADR-0089 #8); `customer_id` → `party_id`; `posted_by` → `actor_*` |
| `invoices`, `invoice_lines`, `credit_notes`, `credit_note_lines` | stay in `public`, owned by Bto `billing`; the FKs to journal entries are dropped in P2 (`F/schema.ts:249,255,360`); `fin_document_id` and `fin_journal_no` are added as new columns; `open_amount` is read from the core, then dropped (H1) |
| `payments`, `allocations`, `ar_entries` | backfilled into `fin.documents`, open items and `fin.allocations` (P4), frozen, dropped in H1; the payment FKs into moved tables are dropped in P2 (`F/schema.ts:432,434,441,447`); a voided allocation (`voided_at`, `F/schema.ts:484`) becomes an allocation plus its reversal |
| `customer_balances` | `fin.party_balances` (P4) |
| `finance_reconcile_runs` | `fin.reconcile_runs` with `company_id` and `kind` |
| settings `company.*_payer`, `tax.*_rate_pct` | `fin.company_tax_registrations`, `fin.tax_rates`; `credit.payment_term_days` stays a Bto setting |
| `number_sequences` | `INV_NO` and `CN_NO` stay in identity; `JE_NO` is copied in P2 and `PAY_NO` in P4, each in the migration that moves its writer |
| POS `handover_money_account_id`, `journal_entry_id`, `handover_payment_id` (`P/schema.ts:62,263,265`) | stay in Bto as plain ids plus the stored numbers; the FKs at `:62,263` are dropped in P2, the one at `:265` (→ `payments`) in P4, when payments are frozen |
| `goods_receipts.money_account_id` (ADR-0078, migration `0028_receipt_prices`) | a plain id with no FK already, chosen through inventory's `RECEIPT_MONEY_ACCOUNTS` hook that finance binds (`finance/services/receipt-money-accounts.service.ts`); P2 keeps the money-account ids when it copies the table, and `fin-bridge` binds the hook over `FinReader.moneyAccounts` from H1 |

## 5. Document classes and account determination (ADR-0072)

Classes are a small closed set in engine code. Document types, keys, rules, accounts and tax codes are rows.

| Class | What the engine checks |
|---|---|
| `AR_INVOICE` | party required; exactly one DEBIT line on a RECEIVABLE account that opens an item with `dueDate`, or none when the amount is 0 (today a zero total skips the AR line, `F/services/invoicing.service.ts:257-264`); tax lines allowed; never settles anything |
| `AR_CREDIT` | party required; one CREDIT line on a RECEIVABLE account that settles the item it names (the invoice it credits); a remainder stays an open credit item, or follows `unapplied_key` (§11) |
| `RECEIPT` / `PAYMENT` | one MONEY line with a money account; party lines settle the targets the sender names, or the oldest due first when it says `FIFO`; the remainder stays an open item, or follows `unapplied_key` |
| `ALLOCATION` | no lines and no entry; pairs **existing** open items of one party on one account, a debit item with a credit item; sent only from the core's screens (source `FIN`) by the accountant (§11) |
| `SETTLEMENT` | party-control lines that settle or open items, plus revenue, expense and tax keys: a credit held on a liability applied to an invoice, a deposit applied, a direct bill, a forfeit, a write-off, a netting (seen in Erkhet as an offset form; its rule comes from help text), a party transfer |
| `JOURNAL` | any balanced lines; source `FIN` may name `accountCode` with `finance.journal.manage` |
| `OPENING` | as JOURNAL; AR and AP lines open items with `itemRef`, `itemDate` and `dueDate`; the offset goes to an opening-balance account flagged `drains` |
| `AP_BILL` / `AP_CREDIT` | mirrors of the AR classes on PAYABLE accounts; built before procurement (§16.2) |
| action `REVERSE` | a mirror entry dated the command's `accountingDate`, or today, never earlier than the original (today's voids, `invoicing.service.ts:203-208`; the accountant's dating rule is TODO-VERIFY); a document's reversal first reverses the allocations it made itself; it is refused with `FIN_REVERSAL_BLOCKED` while other allocations on its items are live, so an ALLOCATION document is reversed first; in v1 only the owning source reverses its documents |

`settles` works only inside the posting that sends it: it pairs the document's own new item with items the sender names, or with the oldest due first. The sender decides what its own document settles: a receipt the invoices it pays, a refund the credit it pays back, a sales return the invoice it credits. No posting pairs an open credit with a new invoice on its own: an AR_INVOICE never settles, and applying an existing credit to an invoice is always an ALLOCATION (or a SETTLEMENT when the credit sits on a liability account), made by the accountant by hand (owner, 2026-10-18).

**How an account is chosen.**
- Among the rules effective on the accounting date, the most specific match wins: document type, then branch, then source system, then the company default.
- The chosen `posting_rule_id` is stored on the line.
- No match rejects with `FIN_MAPPING_MISSING {key, documentType, branch}`; nothing goes to a suspense account.
- A document type becomes ACTIVE only when every key it declares has a rule (the coverage check).
- Rules are data, so the PMS needs no engine change and no contract bump.

**Seeded rules equal today's roles** (`S:91-109`, codes `S:327-349`), so the carve posts the same accounts:

| Key | Today's role | Account | Control |
|---|---|---|---|
| `AR` | AR | 120101 | RECEIVABLE |
| `SALES` | SALES | 510101 | NONE |
| `SALES_DISCOUNT` | SALES_DISCOUNT | 520201 | NONE, normal side DEBIT |
| `SALES_RETURN` | SALES_RETURN | 520101 | NONE, normal side DEBIT |
| `VAT_OUTPUT` | VAT_PAYABLE | 311004 | NONE |
| `CITY_TAX_OUTPUT` | CITY_TAX_PAYABLE | 311005 | NONE |
| `CUSTOMER_ADVANCE` | CUSTOMER_ADVANCE | 320201 | ADVANCE_RECEIVED; no document type uses it until D6 is answered |
| `CASH` / `BANK` | CASH / BANK | 100101 / 110101 | MONEY |
| `OTHER_INCOME` / `OTHER_EXPENSE` | the same | 511020 / 730101 | NONE |
| `POS_CASH` | POS_CASH | 100102 | NONE, `drains` |
| `CARD_CLEARING` | CARD_CLEARING | 120301 | NONE, `drains` |
| `POS_SALES` / `CASH_VARIANCE` | the same | 510102 / 740101 | NONE |

POS_CASH and CARD_CLEARING («Картын төлбөрийн авлага», `mn.json:3255`) are neither MONEY nor RECEIVABLE, because POS lines carry neither a money account nor a party (`P/services/pos-shifts.service.ts:346-363`); `drains` puts them on the drain report.

**The chart at go-live (D16).** BO's chart is Erkhet's, imported with its codes, names and groups (§16.2). The accountant marks the control types, and the rules are re-pointed to the imported accounts. Today's seeded codes follow Erkhet's numbering style; whether each one is the same account in Erkhet is TODO-VERIFY (D16). Erkhet spreads the same mapping idea over seller profiles and per-category accounts (seen in its UI). A new company starts from the `mn` chart template only when its chart is empty: `ensureDefaultCompany` never re-adds accounts to a non-empty chart, unlike today's boot seed, which re-adds every missing default (`F/reference-data.ts:16-30`).

## 6. The intake contract v1 (ADR-0071)

```ts
// packages/fin-contract/src/v1/intake.ts (planned)
export type Dec = string;          // /^-?\d{1,12}(\.\d{1,2})?$/, never a JS number
export type IsoDate = string;      // YYYY-MM-DD in the company's timezone
export interface SourceKey { system: string; docType: string; docId: string; revision?: number } // default 1
export interface PartyIn {
  ref: string; name: string; kind: 'COMPANY' | 'INDIVIDUAL' | 'EMPLOYEE' | 'TAX_AUTHORITY' | 'OTHER';
  tin?: string; registerNo?: string;
}                                  // inserted on first sight; later names follow FinConfig.updateParty
                                   // INTERNAL parties are created only through FinConfig with their company link;
                                   // the accountant links a source's ref to one
export interface FinActor { kind: 'STAFF' | 'SOURCE' | 'SYSTEM'; ref: string; label: string } // attribution only

export interface IntakeCommandV1 {
  contract: `fin.intake/1.${number}`;
  commandId: string;               // uuid v7: the transport identity, echoed back
  tenant: string; company: string; // codes; part of the hash
  source: SourceKey & { docNo?: string }; // the business identity; for REVERSE, the target's key
  actor: FinActor;
  body: PostBody | ReverseBody;
}
export interface PostBody {
  action: 'POST'; documentType: string; documentDate: IsoDate; accountingDate?: IsoDate;
  currency: string;                // v1: must equal the company's functional currency
  branch?: string; party?: PartyIn; dueDate?: IsoDate; description: string;
  controlTotal: Dec;               // Σ debit = Σ credit = controlTotal; for ALLOCATION Σ pairs[].amount
  lines: LineV1[];                 // 2..500; empty for class ALLOCATION
  allocate?: AllocateV1;           // class ALLOCATION only, required there
  attributes?: Record<string, string>; // ≤ 20 keys (orderNumber, folio, handedInBy)
}
export interface LineV1 {
  lineNo: number; key: string; side: 'DEBIT' | 'CREDIT'; amount: Dec; // > 0
  accountCode?: string;            // source FIN only
  description?: string; sourceLineRef?: string;
  tax?: { code: string; base: Dec; lineCount?: number }; // lineCount ≤ 500; the base is the sender's responsibility
  moneyAccount?: string; party?: PartyIn; // the header party by default on party-control keys
  openItem?: { dueDate?: IsoDate; itemDate?: IsoDate; itemRef?: string; groupRef?: string };
  settles?: 'FIFO' | Array<{ target: SourceKey | { groupRef: string } | { itemId: string }; amount?: Dec }>;
  analyticRef?: string;
}
export interface AllocateV1 {      // pairs open items that already exist; posts no journal entry
  key: string;                     // the party-control key whose account holds both items (AR, AP)
  pairs: Array<{ debit: ItemRefV1; credit: ItemRefV1; amount: Dec }>; // 1..200, amount > 0
}
export type ItemRefV1 = { itemId: string } | { source: SourceKey; lineNo?: number };
export interface ReverseBody { action: 'REVERSE'; accountingDate?: IsoDate; reason: string }

export interface IntakeResultV1 {
  contract: 'fin.intake/1'; commandId: string; source: SourceKey; action: 'POST' | 'REVERSE';
  outcome: 'POSTED' | 'DUPLICATE' | 'CANCELLED' | 'HELD' | 'REJECTED' | 'CONFLICT';
  document?: {
    id: string; number: string; journalNo: string | null; amount: Dec; accountingDate: IsoDate;
    period: string; reversed: boolean;
    lines: { lineNo: number; account: string; ruleId: string | null; side: 'DEBIT' | 'CREDIT'; amount: Dec }[];
    openItems: { id: string; key: string; side: 'DEBIT' | 'CREDIT'; amount: Dec; openAmount: Dec }[];
    allocations: { debitItemId: string; creditItemId: string; amount: Dec }[];
  };
  errors?: { code: FinErrorCode; params: Record<string, string | number | null>; path?: string }[];
  retryable?: boolean;
}
```

**The v1.0 limits** (`V1_LIMITS` and the patterns in `packages/fin-contract/src/v1/primitives.ts`; within 1.x a limit may only be loosened):
- Codes (tenant, company, system, docType, documentType, key, branch, moneyAccount, accountCode, tax code, attribute keys): 1–64 characters of letters, digits, `_ . : -`, starting with a letter or digit.
- Refs (`docId`, party `ref`, `groupRef`, `itemRef`, `itemId`, `sourceLineRef`, `analyticRef`, actor `ref`): 1–128 characters; every text refuses control characters. `docNo` ≤ 60, names ≤ 200, actor labels ≤ 120, descriptions ≤ 300, reasons ≤ 500, `tin` / `registerNo` ≤ 32, attribute values ≤ 200.
- `Dec`: `^-?\d{1,12}(\.\d{1,2})?$`; line, pair and settle amounts above zero; `controlTotal` zero or more; a tax rate 0–100.
- `contract` `fin.intake/1.<0-9999>`; `commandId` a uuid v7; dates `z.iso.date()` (real calendar dates); `revision` 1–1,000,000; `lineNo` and `lineCount` 1–500; `settles` 1–200 targets.
- A POST has 2–500 lines with distinct `lineNo`, or an `allocate` (1–200 pairs) and no lines; at most 20 attributes. Results parse loosely (unknown fields are dropped) and an unknown error code parses as a string.

The hash covers the command as sent, after the defaults are applied. The stored result and the posting preview return the resolved lines, which may differ from the sent ones when the engine splits a remainder onto `unapplied_key`. For class ALLOCATION the header party must already exist, both items must belong to it and to the account of `allocate.key`, the debit item must be a DEBIT item and the credit item a CREDIT item, and no pair may exceed either item's open amount.

**Processing, in one transaction** (the caller's transaction when in-process):
1. **Parse and hash.** Parse with the zod schema of the major version. Apply the defaults (revision 1, `accountingDate = documentDate`, the header party on party-control lines). Normalise decimals to scale 2 and hash `sha256(canonicalJson(cmd))`.
2. **Authorise the principal (§12).** A SOURCE principal needs a `source_grants` row for the company; over HTTP, `tenant` and `source.system` must also equal the token's principal. A USER principal (source `FIN` only) needs the per-company right of the document type. A refusal writes no request row: in-process it is thrown; over HTTP it is answered 404 `FIN_COMPANY_UNKNOWN`, with one attempt row whose company is NULL.
3. **Set the scope:** `set_config('fin.company_ids', '{<id>}', true)`.
4. **Claim the key:** `INSERT … ON CONFLICT (business key) DO NOTHING`; if the row exists, `SELECT … FOR UPDATE`, so a concurrent twin waits here. Then:
   - another company → CONFLICT `FIN_SOURCE_COMPANY_MISMATCH`, with no stored result returned;
   - POSTED with the same hash, or a MIGRATION row → DUPLICATE with the stored result;
   - POSTED with another hash → CONFLICT `FIN_PAYLOAD_CONFLICT`, nothing booked, one attempt row;
   - HELD or REJECTED → take the new payload (attempts + 1);
   - revision n + 1 is accepted only if revision n is reversed or cancelled.
5. **REVERSE:** find the target `(…, POST)` in the same company. If the target is HELD or REJECTED, mark it CANCELLED and answer CANCELLED, with no entry.
6. **Class rules and period:** check the class rules; get the period row, or create it OPEN only when the month is later than the company's latest SOFT_CLOSED or CLOSED month (an earlier month without a row is refused with `FIN_PERIOD_CLOSED` and goes to the pending list like any closed-month document); take it `FOR SHARE` and check its status (§13).
7. **Lock parties:** resolve refs, inserting a party on first sight (never for ALLOCATION), then lock `party_companies` `FOR NO KEY UPDATE` in id order.
8. **Lock money accounts** `FOR SHARE`.
9. **Resolve and verify.** Resolve accounts through the rules, then verify and never recompute (the POS rule, `P/services/pos-accept.service.ts:499-543`): Σ debit = Σ credit = `controlTotal` at scale 2; every control line has its detail; |tax − round_half_up(base × rate, 2)| ≤ 0.01 × lineCount for each tax code.
10. **Settle or allocate:** lock the target items `FOR UPDATE` by (due_date, id), scoped to company, party and account; a `groupRef` is scoped to the sending source system.
11. **Number:** take the document number (CORE mode) and the journal number, last.
12. **Write:** the document, entry, lines, items, allocations, cache rows, audit row and attempt row; mark the request POSTED.

**Global lock order:** (1) the source's own rows (Bto: order → stock → `partners.customers`), (2) the intake row, (3) `fiscal_periods` (SHARE; a close takes UPDATE), (4) `party_companies`, (5) `money_accounts`, (6) `open_items`, (7) `number_counters`. Today the counters are not taken last (`docs/modules/finance.md` §5 lists the actual order); the core takes them last.

**Where a refusal goes.**
- **In-process (`submitInTx`).** POSTED and DUPLICATE return a result. Every other outcome throws an `AppError` with the same code and params as `errors[]`, and the caller's transaction rolls back, as today (D11).
- **Asynchronous or HTTP (A1 / A2).** The posting transaction rolls back, and a second short transaction records HELD or REJECTED with an attempt row. That row is the pending and failed list (§13): one row per key, the payload compared, the result pushed back. This closes three gaps of the POS precedent: its rejections have no unique key (`P/schema.ts:529-533`), its DUPLICATE is decided by the client id alone, and the edge never hears of a successful admin replay.

**Versioning.**
- `contract: 'fin.intake/1.x'`, plus the URL major `/api/fin/v1` with HTTP.
- Within 1.x, changes are additive only: fields, classes and codes are added on the server first, and a sender treats an unknown code as permanent.
- The core refuses unknown fields; clients ignore unknown response fields.
- v2 runs beside v1 for at least one delivery; both normalise to one internal command, and stored payloads replay with their own parser.
- Document types, keys and rules are data, so the PMS needs no contract change.
- Planned 1.x additions, kept out of 1.0 until a source needs them: `dependsOn` and HELD by dependency (A1); the `commandId`-reuse check, `contract_min/max` per source, heartbeats and source tokens (A2); `match` selectors on rules (a nullable column).

## 7. Error codes (`@tugeel/fin-contract`)

| Kind | Codes |
|---|---|
| Envelope and access | `FIN_PAYLOAD_INVALID {path}`, `FIN_CONTRACT_UNSUPPORTED {got, max}`, `FIN_COMPANY_UNKNOWN` (also the only HTTP answer to an unknown, forbidden or ungranted company), `FIN_COMPANY_FORBIDDEN`, `FIN_SOURCE_NOT_GRANTED`, `FIN_SOURCE_MISMATCH`, `FIN_DOCTYPE_UNKNOWN`, `FIN_CLASS_RULE {rule}` |
| Amounts | `FIN_CURRENCY_UNSUPPORTED`, `FIN_AMOUNT_PRECISION`, `FIN_TOTAL_MISMATCH {declared, debit, credit}`, `FIN_UNBALANCED {debit, credit}` |
| Mapping | `FIN_MAPPING_MISSING {key, documentType, branch}`, `FIN_ACCOUNT_INACTIVE`, `FIN_PARTY_REQUIRED`, `FIN_MONEY_ACCOUNT_REQUIRED`, `FIN_TAX_CODE_UNKNOWN`, `FIN_TAX_MISMATCH {code, expected, got}` |
| Items, allocations, reversals | `FIN_SETTLE_TARGET_NOT_FOUND` (also an unknown party or item in an ALLOCATION), `FIN_OVER_ALLOCATION`, `FIN_REVERSAL_BLOCKED {allocations}`, `FIN_REVISION_NOT_ALLOWED`, `FIN_FUTURE_DATE` |
| Identity | `FIN_PAYLOAD_CONFLICT`, `FIN_SOURCE_COMPANY_MISMATCH` (no stored result is returned) |
| Periods and approvals | `FIN_PERIOD_CLOSED {period, status}` (HELD when asynchronous, refused in-process; `status` is null for an earlier month that has no row, §13); from P5 `FIN_PERIOD_NOT_ENDED`, `FIN_PERIOD_ORDER`, `FIN_CHECKLIST_FAILED {items}`, `FIN_APPROVER_IS_SUBMITTER` (only with maker ≠ checker on) |
| Dependencies | from A1 `FIN_DEPENDENCY_MISSING` (HELD) |
| Retryable | `FIN_BUSY` (lock timeout, serialization failure) |

The HTTP status of each code is set in the error registry (`apps/api/src/finance-core/errors.ts`, P0b, provisional until the phase that first raises the code): 404 `FIN_COMPANY_UNKNOWN`; 403 `FIN_COMPANY_FORBIDDEN`, `FIN_SOURCE_NOT_GRANTED`, `FIN_SOURCE_MISMATCH`; 409 `FIN_ACCOUNT_INACTIVE`, `FIN_REVERSAL_BLOCKED`, `FIN_REVISION_NOT_ALLOWED`, `FIN_PAYLOAD_CONFLICT`, `FIN_SOURCE_COMPANY_MISMATCH`, the period and approval codes and `FIN_DEPENDENCY_MISSING`; 503 `FIN_BUSY`; 422 every other code. Over HTTP (A2) an unknown, forbidden or ungranted company is always answered 404 `FIN_COMPANY_UNKNOWN`. `FIN_CLASS_RULE` names the broken rule, for example `ALLOCATION_SIDES` (a pair whose debit item is a credit item) or `ALLOCATION_ACCOUNT` (an item on another account).

## 8. Read and configuration ports

```ts
export interface FinReader {  // in-process provider now; the same methods over HTTP from A2
  exposure(ctx: FinCallContext, q: { company: string; party: { system: string; ref: string } }): Promise<ExposureV1>;
  openItems(ctx, q: { company; party?; account?; sourceDoc?: SourceKey; groupRef?; status?: 'OPEN'; dueBefore?; cursor?; limit? }): Promise<Page<OpenItemV1>>;
  statement(ctx, q: { company; party; from: IsoDate; to: IsoDate }): Promise<StatementV1>;
  trialBalance(ctx, q: { company; asOf: IsoDate; from?; branch?; sourceSystem? }): Promise<TbRowV1[]>;
  ledger(ctx, q: { company; account: string; from; to; cursor? }): Promise<Page<LedgerLineV1>>;
  document(ctx, q: { company; source: SourceKey } | { company; number: string }): Promise<DocumentV1 | null>;
  sourceKeys(ctx, q: { company; system: string; docType: string; from: IsoDate; to: IsoDate }): Promise<SourceKeyStatusV1[]>; // completeness checks
  intake(ctx, q: { company; status: 'HELD' | 'REJECTED'; sourceSystem?; cursor? }): Promise<Page<IntakeV1>>;
  freshness(ctx, q: { company }): Promise<FreshnessV1>;
  taxPosition(ctx, q: { company; date: IsoDate }): Promise<{ registrations: { taxKind: string; registered: boolean; activityCode: string | null }[]; rates: { code: string; ratePct: Dec }[] }>;
  moneyAccounts(ctx, q: { company; kind?: 'CASH' | 'BANK' | 'CLEARING'; branch? }): Promise<MoneyAccountV1[]>;
}
export interface FinCreditPortInTx {
  exposureInTx(tx: FinTx, ctx: FinCallContext, q: { company: string; party: { system: string; ref: string } }): Promise<ExposureV1>;
}
// ExposureV1 = { receivableOpen; creditsOpen; net; overdue; oldestDueDate | null }, live in the company's timezone

export interface FinConfig {  // contract 'fin.config/1'; idempotent on natural keys; audited
  registerSource(ctx, s: { code; linkTemplate }): Promise<void>;
  grantSource(ctx, g: { company; system }): Promise<void>;
  upsertAccount(ctx, a: AccountV1): Promise<void>;
  upsertDocumentType(ctx, t: DocumentTypeV1): Promise<void>;
  addPostingRule(ctx, r: PostingRuleV1 & { effectiveFrom: IsoDate }): Promise<void>;
  loadTaxCodes(ctx, c: TaxCodeV1[]): Promise<void>;
  loadTaxRates(ctx, r: TaxRateV1[]): Promise<void>;
  activateDocumentType(ctx, q: { company; code }): Promise<CoverageReportV1>;
  updateParty(ctx, p: { system; ref; name; tin? }): Promise<void>;
  addInternalParty(ctx, p: { company; name }): Promise<void>;      // kind INTERNAL, intercompany_company_id = that company (ADR-0070)
  linkPartyRef(ctx, l: { system; ref; party: string }): Promise<void>; // the accountant links a source's ref (D13)
}
```

- **Exposure.** The accounts that count are the company setting `exposure.accounts` (default: the RECEIVABLE accounts; an account that `unapplied_key` points to is added when the accountant chooses one, §11). `receivableOpen` and `creditsOpen` are the open amounts of the party's debit and credit items on them, `net` their difference, `overdue` the open amount of the debit items due before today.
- **Drill-down.** `source_systems.link_template` links every document to its source (for a Bto invoice, today's page is `/finance/invoices?invoice={id}`). This fixes POS_SHIFT resolving to a null number (`F/services/journal.service.ts:566-571`) and the web linking only invoices and payments (`apps/web/src/features/finance/journal-page.tsx:291-296`).
- **The customer app reads Finance I today** (CA2, 2026-10-19, ADR-0082; `docs/modules/customer.md`): a store's balance and live overdue amount (`ArLedgerService`), its own open invoices and one invoice by id with an owner check (`InvoiceQueryService.ofCustomer`, `ofOrder`, `openDueBetween` for the reminders), its payments with the invoices they settled (`PaymentsService.ofCustomer`), the bank accounts flagged `money_accounts.show_to_customers`, and `PAYMENT_LISTENER` (`finance/hooks.ts`) telling notifications of every customer payment. The carve keeps these answers (through `FinReader.exposure` / `openItems` / `moneyAccounts` and an equivalent payment event), scoped to the customer's own party.
- **Party names** follow `partners` through a `CUSTOMER_CHANGED` hook that `fin-bridge` binds and that calls `updateParty` (the `ModuleRef` hook pattern of the sales hooks).

## 9. One interface, three transports (ADR-0071)

| Interface | In-process now | Later |
|---|---|---|
| `FinIntake.submit(ctx, cmd)` | core provider, own transaction (the core's screens, jobs) | `FinanceCoreHttpClient` in `@tugeel/fin-contract` |
| `FinIntakeInTx.submitInTx(tx, ctx, cmd)` | called inside Bto's transaction (the sale, the sales return, the POS close) | unbound when the core is remote; the type checker then lists every caller to move |
| `FinOutbox.enqueue(tx, cmd)` (A1) | pg-boss `fin.submit` enqueued in the source transaction, `standard` policy, no singleton key; a `null` from `enqueue` throws (`apps/api/src/common/jobs/jobs.service.ts:15-26` returns null when a policy drops a job) | a source in another repository keeps an outbox row in its own database, pushed in order with 2 s → 60 s backoff (the edge pattern, `apps/api/src/edge/services/outbox.service.ts:21-71`) |
| `FinReader`, `FinConfig` | core providers called by Bto's controllers | `GET/POST /api/fin/v1/companies/{c}/…` (A2) |

**Controllers.** The core has no HTTP controllers until A2. Today's web keeps its legacy routes (`/payments`, `/receivables/*`, `/invoices*`, `/journal-entries`, `/gl-accounts`, `/money-accounts`); Bto controllers serve them by calling the ports with a USER context and translate `customerId` into a party ref.

**HTTP intake (A2), required before the PMS** (owner, 2026-10-18: the PMS is a separate repository and the resort runs its own server with an outbox).
- `POST /api/fin/v1/intake` takes `{ commands ≤ 100 }`. It is `@Public` behind a `SourceTokenGuard`, with `fss_<id>_<secret>` tokens stored as sha-256 (the `EdgeTokenGuard` pattern, `P/controllers/pos-sync.controller.ts:29-31`).
- The principal comes from the token, never from the body (`FIN_SOURCE_MISMATCH` otherwise). The actor is recorded as SOURCE; a user the source names is kept only as an `on_behalf_of` label.
- Each command runs in order in its own transaction. The batch answers 200 with an outcome and a `retryable` flag per command, as `pos-sync` does; HTTP statuses are kept for envelope, authorisation and whole-batch failures.
- The site server's outbox resends until it gets POSTED, DUPLICATE, CANCELLED or a permanent refusal; HELD is a final answer for the outbox, and the later outcome reaches the source through the result feed.
- Heartbeats report each source's backlog, as the edge does; `freshness` shows the last posting per company × source.

**Two keys.** `commandId` is the transport identity; the source key is the permanent business identity. For documents typed in the core's screens (source `FIN`), the server takes `docId` from the `Idempotency-Key` header, so neither the web nor the api client changes, and deduplication outlives the 7-day transport key (`apps/api/src/modules/identity/services/housekeeping.service.ts:15`).

**Result feed (A1, served over HTTP from A2).** `fin.document.posted` / `fin.document.reversed` jobs drive a per-source `FIN_RESULT_SINK` in-process. POS uses it to learn that a hand-over voucher was voided. A remote source reads the same results from a per-source feed with a cursor (A2; the route is designed then).

## 10. Credit control (ADR-0073)

**Now (one database).**
1. Confirmation or re-price: `customers.lockForUpdate` (`apps/api/src/modules/partners/services/customers.service.ts:517-531`); sales sums the open orders (`apps/api/src/modules/sales/services/sales-orders.service.ts:679-711`); `billing`'s credit policy calls `exposureInTx`, which takes `party_companies` `FOR NO KEY UPDATE`; then HOLD → OVERDUE → LIMIT.
2. The sale: order → stock → customer → `submitInTx` (intake → period → party → items → counters). The order flips to INVOICED in the same transaction (`sales-orders.service.ts:808-817`), so it is never counted twice or not at all.
3. Who authorises: both calls run under the SOURCE principal `BTO`; the staff member is attribution only. The move route needs only `sales.orders.read` (`apps/api/src/modules/sales/controllers/sales-orders.controller.ts:266-270`), so warehouse staff run the SALE stage, and user-based authorisation would give every warehouse user finance rights.
4. What serialises: two confirmations on the customer row; a payment void, an ALLOCATION or a later PMS charge to a shared party on the party row; two settlements of one item on the item lock.
5. The gate: `apps/api/test/integrity/finance-races.spec.ts:50` passes after every phase, run with a sales rep who holds no finance grant.

**The policy** (Bto's, in `billing/credit-policy.ts` from H1; until then in `modules/finance`):

| Check | Rule |
|---|---|
| HOLD | `partners.customers.credit_hold` (`apps/api/src/modules/partners/schema.ts:71-75`) |
| OVERDUE | **default (owner D7b: no preference):** refused when `exposure.overdue > exposure.creditsOpen`, so an unapplied credit at least as large as the overdue amount does not block. Today any overdue amount blocks (`F/services/credit-control.service.ts:34`); the default takes effect in P4, when `exposureInTx` replaces the ledger reads. The Bto setting `credit.overdue_nets_credits` (default on, ADR-0073 #5) returns to today's rule when switched off |
| LIMIT | `credit_limit` set and `exposure.net + openOrders + amount > credit_limit` (`net` is today's `balance`) |

Example: an overdue 50,000 and an unapplied payment of 60,000 → the order passes; the same with 40,000 → OVERDUE (50,000 > 40,000). The refusal stays 409 `CREDIT_BLOCKED` with its reason and amounts, and gains `creditsOpen`. The policy only keeps an open credit from blocking the customer; the accountant still applies it by hand (§11).

**A remote core, or a second system extending credit to the same company and party.** The core then offers credit reservations (the TigerBeetle pattern): `POST /credit/reservations {party, source, amount}` runs before Bto's confirmation transaction and is evaluated under the party lock against a core-held limit (`fin.party_credit`) and the active reservations; an `AR_INVOICE` consumes it and a cancel releases it. That would supersede ADR-0060 #2's "sales sums open orders". Not built now (D14). The resort is company RES, so its balances never enter BO's exposure: exposure is per company.

## 11. Advances, overpayments and the manual allocation (ADR-0072)

**Today (facts).**
- An unallocated remainder stays Cr AR, a negative balance (ADR-0060 #5 and #7).
- The `CUSTOMER_ADVANCE` role (320201 «Урьдчилж авсан тооцоо») is seeded but never posted (`F/services/payments.service.ts:226-249`).
- No route or service applies an existing remainder: allocation happens only when a payment is recorded (`payments.service.ts:223-225`, `558-636`) and when a credit note is created (`F/services/credit-notes.service.ts:294-306`).
- An invoice issued while the customer is in credit therefore stays open and, once due, blocks credit as OVERDUE (`F/services/credit-control.service.ts:34`).

**Where the remainder sits.** The RECEIPT and AR_CREDIT document types carry `unapplied_key`:
- NULL (the default, today's rule) keeps the remainder as an open credit item on AR.
- A key makes the engine split the party line, for example Cr AR 28,000 plus Cr `<key>` 12,000.
- Switching is one configuration row plus a reclass document for the credit items already open.

The accountant chooses among three options (TODO-VERIFY D6, with whether VAT is due on Bto customer advances):
1. Keep the remainder on AR, as today, and reclassify customers' net credit balances in the statements.
2. Split at posting to one liability account (we do not recommend it).
3. Split by cause: `CUSTOMER_ADVANCE` for orders paid before delivery (a contract liability under IFRS 15 ¶106), and `CUSTOMER_REFUNDABLE` for overpayments and credit-note remainders on invoices already paid, which are owed back, not advances.

**Applying a credit: only by the accountant, by hand (owner D7).** Nothing in the core or in Bto applies a credit on its own: no posting, job or reconcile pairs an open credit with an invoice.
- **The document.** An ALLOCATION (source `FIN`, type `FIN.ALLOCATION`, `docId` from the `Idempotency-Key`) pairs a credit item with one or more debit items of the same party on the same account. It posts no journal entry: the GL already shows the net. It has a CORE number from its own series (pattern chosen with the accountant). When the credit sits on a liability account (D6 options 2 and 3), the same screen sends a SETTLEMENT (`FIN.CREDIT_APPLY`: Dr the liability item / Cr the AR item), which does post an entry.
- **The screen** (P4). On the customer's ledger page `/finance/customers/:id`, a dialog on `?allocate=1` beside «Төлбөр бүртгэх» lists the party's open credit items (payment and credit-note remainders, advances) and open debit items (invoices, refunds), with dates, due dates and open amounts. The accountant picks the pairs and amounts; the dialog may start from the oldest due first, as today's payment dialog does, but nothing is applied until the accountant sends it. The invoice and voucher panels list their allocations, each with «⋯» → reverse (an ALLOCATION REVERSE adds reversing allocations and restores both open amounts). The same dialog serves suppliers once AP exists.
- **The right:** `finance.payments.record`, the right that allocates in the payment dialog today (`docs/modules/finance.md` §4).
- **The route** (a Bto controller until A2): `POST /finance/allocations` and `POST /finance/allocations/:id/reverse`, `@Idempotent`.

**PMS deposits** always post to an ADVANCE_RECEIVED key, never to revenue. A PMS checkout that applies the booking's deposit sends its own SETTLEMENT naming the deposit item: that is the source's business event at the front desk, not an automatic application by the core. Erkhet shows advance accounts and groups by name only; their handling is unknown.

## 12. Company isolation (ADR-0076)

**Constraints (facts).** One `app` pool per process; about 185 reads on `this.db` outside transactions; scheduled jobs carry null payloads; AI views run as their owner `migrator`, and none filters rows (`0017_ai.sql:79`); provisioning refuses BYPASSRLS; roles are global, `user_roles(user_id, role_id)` (`apps/api/src/modules/identity/schema.ts:100-114`).

**What the core does:**
1. The scope rules of §4: every FK includes the company; the tenant seam runs through bridge rows.
2. **Principals.** A branded `FinCallContext`, built only by `fin-bridge`, holds either `{principal: {kind: 'SOURCE', tenant, system}, actor}` (authorised by `source_grants`) or `{principal: {kind: 'USER', ref}, permissions: Map<CompanyCode, Set<Permission>>, actor}`.
3. **Per-company rights.** `identity.user_company_roles(user_id, company_code, role_id)`: no row, no access. P1 backfills BO from `user_roles`, with explicit rows for ADMIN too. Every core check is `(company, permission)`. At extraction the table moves to the core, keyed by `principal_ref`.
4. **One Bto installation books into one company:** the setting `bto.company_code` (BO), which cannot change once anything has posted. Bto has no per-branch company column, so its own unscoped data cannot mix companies; a multi-company Bto would need its own ADR.
5. **The company at the HTTP edge.** Legacy routes resolve it from `bto.company_code`. `/api/fin/v1` routes carry it in the path, so the Idempotency-Key hash, which covers `originalUrl` (`apps/api/src/modules/identity/interceptors/idempotency.interceptor.ts:101-103`), covers the company too.
6. **The scope setting.** Every core read runs in `finRead(ctx, work)`: a READ ONLY transaction whose first statement is `set_config('fin.company_ids', …, true)`; `submitInTx` and `exposureInTx` set it too. It is transaction-local and cannot leak through the pool.
7. **A pinned expression.** Views use exactly `current_setting('fin.company_ids')::bigint[]`. On a reused pooled connection an unset placeholder may read `''` rather than raise; the cast makes `''` fail loudly (to verify on PostgreSQL 18; the test lands in P2).
8. **Jobs** loop per company, one transaction each. A lookup in another company answers 404.

**Row-level security is not enabled.** With one tenant, the owner's group (D1), it protects nothing, and the AI path needs a filter anyway. The trigger to revisit it: outside tenants pooled in one database. That also needs multi-tenant identity (usernames, roles, settings and `number_sequences` are global today), so it is an ADR plus identity work.

**The AI reader.** `AiReaderService` adds `set_config('fin.company_ids', …, true)` beside its `SET LOCAL`s (`apps/api/src/modules/ai/sql/ai-reader.service.ts:166-176`), listing the companies where the user holds `finance.read`. Every row-filtering `ai.fin_*` view is `WITH (security_barrier = true)`: the guard allows `/` (`apps/api/src/modules/ai/sql/sql-guard.ts:116-131`) and returns database error text, so on a plain view a predicate such as `1/0`, evaluated before the company filter, would work as an oracle. Model SQL cannot change the setting: the guard blocks `set_config` and `current_setting` (`sql-guard.ts:147-151`).

**The control system (later).** Role `fin_control` with SELECT on `fin_ctl.*` only, hardened like `ai_reader` (CONNECTION LIMIT, `default_transaction_read_only`, `search_path`; `apps/api/src/db/provisioning.ts:96-99`), re-granted by a migrate step like `grantAiSchema`. A company is shown only after approval with `finance.control.approve` and an audit row. The views expose aggregates, not party names or TINs; `fin_ctl.freshness` gives the last `posted_at` per company × source. The HTTP `FinReader` is preferred over a database login from outside. It never writes. Consolidated statements with intercompany elimination are a separate later requirement.

## 13. Periods, approvals and rights (ADR-0075)

**Periods** are monthly per company: OPEN → SOFT_CLOSED → CLOSED.
- **Rows.** A period row is created on demand only for a month later than the company's latest SOFT_CLOSED or CLOSED month; a document dated in an earlier month that has no row is refused with `FIN_PERIOD_CLOSED` (it goes to the pending list like any closed-month document), so a back-dated posting never opens a month older than a closed one. P2 creates every month from the first entry's month to the current one.
- **Close.** The period's end date has passed in the company's timezone (`FIN_PERIOD_NOT_ENDED` otherwise), and a checklist passes: `freshness`, the reconcile runs, the pending list, the drain report and each source's completeness check (Bto: every POS close accepted, no edge backlog). Which items block and which only warn is agreed with the accountant before P5 (TODO-VERIFY). A blocking item refuses with `FIN_CHECKLIST_FAILED {items}` unless the user holds `finance.periods.override`; the failed items are kept in the event row. Months move in order (`FIN_PERIOD_ORDER`). A close takes the period row `FOR UPDATE` and every posting takes it `FOR SHARE`, so the two never interleave.
- **SOFT_CLOSED.** Only document types with `allowed_in_soft_close` (the COGS batch, re-costing variances) and the core's own documents with override post. Everything else is treated as closed.
- **CLOSED.** Nobody posts.
- **Reopen.** `finance.periods.reopen`, a reason, an event row and an audit row; only the company's latest month that is not OPEN; it releases the month's HELD documents for a retry. Erkhet's month lock is a checkbox grid with no reason or history (seen in its UI; that a tick locks the month comes from help text).

**A document dated in a closed month waits in the pending list (owner D10).** It is never moved to another month on its own; `intake.late_posting` = HOLD per company.
- In-process: the core refuses with `FIN_PERIOD_CLOSED` and the source parks the document. A POS close is dated the Ulaanbaatar day of the close (`P/services/pos-shifts.service.ts:179`) and posted when the centre accepts it, which may be the next day (ADR-0064), so a late close lands in `pos_sync_rejections` and is replayed after a reopen. A back-dated voucher typed by the accountant is refused on the screen. A Bto sale is dated today and a month closes only after it ends, so a sale never meets a closed month.
- Asynchronous or HTTP (A1 / A2): the request is HELD in the core's pending list and is retried after the accountant reopens the month, or is cancelled by its source (a REVERSE of a HELD request answers CANCELLED).
- `intake.late_posting` has one value now, `HOLD`. Moving a late document's accounting date into the first open month is not built; it would need a new owner answer and an ADR (ADR-0075).

**The pending list** (P5): a page of the core's HELD and REJECTED requests per company (source, key, number, date, error and params, attempts), with «retry» after a fix and «cancel», and a link to the source's own parked list (POS rejections), plus a home attention tile. Both actions need `finance.intake.replay`.

**Approvals.** The core's manual and opening entries go DRAFT → SUBMITTED → POSTED in `fin.drafts` and are numbered at POST, following inventory adjustments (`apps/api/src/modules/inventory/schema.ts:52`). Maker ≠ checker is the per-company setting `approval.maker_checker`, off (D18); when on, an approver who submitted the draft is refused (`FIN_APPROVER_IS_SUBMITTER`).

**Rights.** The codes are declared in `@tugeel/fin-contract`, and a unit test asserts that Bto's catalog lists the same strings. Every check is per company (§12).

| Code | Allows |
|---|---|
| `finance.read` | viewing documents, ledgers, balances and reports |
| `finance.payments.record` | vouchers; manual ALLOCATION documents and their reversal |
| `finance.invoices.manage` | Bto `billing`: invoice void, sales return |
| `finance.journal.manage` | manual and opening entries (create, submit) |
| `finance.settings.manage` | number formats, money accounts |
| `finance.documents.approve` (new) | approving a submitted draft |
| `finance.periods.close` / `.reopen` / `.override` (new) | closing a month; reopening the latest; closing over a failed checklist |
| `finance.intake.replay` (new) | retrying or cancelling an item on the pending list |
| `finance.config.manage` (new) | accounts, posting rules, document types, sources and grants |
| `finance.control.approve` (new) | showing a company to the control system |

Erkhet has about 258 menu rights plus per-account levels and no approve right (seen in its UI).

## 14. Worked examples

Basis (facts): the seeded accounts 100101 cash, 120101 AR, 311004 VAT payable, 320201 customer advance, 510101 sales, 520101 sales returns, 520201 sales discount (`S:327-349`). Today's templates, which the seeded rules reproduce: invoice Dr AR total, Dr discount / Cr sales (subtotal − taxes), Cr taxes (`F/services/invoicing.service.ts:250-292`); credit note Dr returns (net), Dr VAT / Cr AR (`F/services/credit-notes.service.ts:307-336`). VAT 10 % and city tax 0 % are this company's settings (ADR-0060; Erkhet shows the same).

### 14.1 Bto: sale on credit → invoice → partial payment → return → overpayment → manual allocation

**E1. Confirm order 20261020_0007** for «Мөрөн-Од ХХК» (customer 412, limit 500,000). The credit check of §10: nothing open, nothing overdue → OK. No intake.

**E2. The SALE stage, 2026-10-20.** 10 sacks × 12,000 = 120,000; discount 10,000; total 110,000, VAT included 10,000.00. In one Bto transaction: the stock issue; the `billing` invoice `Н-20261020-0004` with its product lines; `submitInTx` under the SOURCE principal BTO; the order → INVOICED; `ebarimt.prepare(tx, …)`.

```json
{"contract":"fin.intake/1.0","commandId":"0192f3a1-…","tenant":"BUTEN_ORGIL","company":"BO",
 "source":{"system":"BTO","docType":"SALES_INVOICE","docId":"812","revision":1,"docNo":"Н-20261020-0004"},
 "actor":{"kind":"STAFF","ref":"bto:user:7","label":"Нярав Б."},
 "body":{"action":"POST","documentType":"BTO.SALES_INVOICE","documentDate":"2026-10-20","currency":"MNT",
  "branch":"3","party":{"ref":"customer:412","name":"Мөрөн-Од ХХК","kind":"COMPANY","tin":"…"},
  "dueDate":"2026-11-19","description":"Н-20261020-0004 — Мөрөн-Од ХХК","controlTotal":"120000.00",
  "attributes":{"orderNumber":"20261020_0007"},
  "lines":[
   {"lineNo":1,"key":"AR","side":"DEBIT","amount":"110000.00","openItem":{"dueDate":"2026-11-19"}},
   {"lineNo":2,"key":"SALES_DISCOUNT","side":"DEBIT","amount":"10000.00"},
   {"lineNo":3,"key":"SALES","side":"CREDIT","amount":"110000.00"},
   {"lineNo":4,"key":"VAT_OUTPUT","side":"CREDIT","amount":"10000.00","tax":{"code":"MN.VAT.STD","base":"100000.00","lineCount":1}}]}}
```

| Journal `Ж-20261020-0011` | Dr | Cr |
|---|---|---|
| 120101 AR (party P412, item OI-1 due 2026-11-19) | 110,000.00 | |
| 520201 Sales discount | 10,000.00 | |
| 510101 Sales | | 110,000.00 |
| 311004 VAT payable | | 10,000.00 |

- OI-1 is open at 110,000; `party_balances(BO, P412, 120101)` rises by 110,000.
- Bto gets back POSTED, the document `Н-20261020-0004`, the journal number, the resolved lines and OI-1; billing stores `fin_document_id` and `fin_journal_no`.
- Today the sale is shown with VAT inside the gross (sales 110,000, discount 10,000); the alternative without VAT is sales 109,090.91, discount 9,090.91 (TODO-VERIFY D9).
- e-Barimt: `prepare` runs in Bto's transaction, keyed `BTO/SALES_INVOICE/812/1`, B2B with the TIN; the receipt is issued after commit and never retried blindly (ADR-0017); the core never sees `lottery` or `qrData`. Receipt timing follows SPEC §11 #2 (answered 2026-10-16: the receipt is issued for the invoice made at the SALE stage); the VAT tax point (D25) and the revenue point (D24) are TODO-VERIFY.
- COGS (D8, TODO-VERIFY): the core never computes cost. Inventory knows it (`stock_ledger.unit_cost`, `apps/api/src/db/migrations/0006_inventory_ledger.sql:15`); the proposal is one `BTO.COGS_DAILY` JOURNAL per (warehouse, business date) after the day ends, with a Bto-side reconcile through `FinReader.ledger` and variances as their own `allowed_in_soft_close` documents (re-costing runs until the end of the following month, ADR-0033 #7). The one Erkhet posting seen generated COGS at once.

**E3. Partial payment, 2026-10-25.** The driver hands 60,000 in cash to the accountant, who records it in the payment dialog (`POST /payments`, a Bto controller). The controller builds `FIN/RECEIPT/<Idempotency-Key>` of type `FIN.CUSTOMER_RECEIPT` under the USER principal: `CASH` DEBIT 60,000 with `moneyAccount: MRN-CASH`; `AR` CREDIT 60,000 for P412 with `settles: "FIFO"` (the accountant's choice in the dialog, as today); attribute `handedInBy`. Journal: Dr 100101 60,000 / Cr 120101 60,000 (credit item OI-2). Allocation OI-2 → OI-1 of 60,000; OI-1 open 50,000. A resend with the same key after 8 days answers DUPLICATE.

**E4. Return of 2 sacks, 2026-10-27.** Bto `billing` creates the sales return `К-20261027-0001` (RETURN_IN within the `returned_base` limit) and in the same transaction submits `BTO/SALES_RETURN/77`, class AR_CREDIT. The pro-rata discount is 10,000 × 2/10 = 2,000, so the gross 22,000 splits into net 20,000 and VAT 2,000. Journal: Dr 520101 20,000, Dr 311004 2,000 (base 20,000) / Cr 120101 22,000 (item OI-3, settles `BTO/SALES_INVOICE/812`). OI-1 is open at 28,000; the exposure is 28,000 plus Bto's open orders. The e-Barimt return receipt is keyed `BTO/SALES_RETURN/77` with the `inactiveId` chain (ADR-0017; TODO-VERIFY with the PosAPI spike). Whether the next COGS batch takes the goods back at the original cost or the current average is TODO-VERIFY (D8).

**E5. Overpayment, 2026-11-01.** A RECEIPT of 40,000 credits AR FIFO: OI-1 → 0, and 12,000 is left as an open credit item OI-5 on 120101 (D6 option 1, today's rule; options 2 and 3 change only the account it sits on). Nothing applies it on its own. On 2026-11-02 the next sale invoices 30,000 (invoice 905, item OI-6, due 2026-12-02).

**E6. The accountant applies the credit, 2026-11-03.** On the customer's page the accountant opens the allocation dialog and pairs OI-5 with OI-6 for 12,000:

```json
{"contract":"fin.intake/1.0","commandId":"0192f9c4-…","tenant":"BUTEN_ORGIL","company":"BO",
 "source":{"system":"FIN","docType":"ALLOCATION","docId":"<Idempotency-Key>"},
 "actor":{"kind":"STAFF","ref":"bto:user:3","label":"Нягтлан Д."},
 "body":{"action":"POST","documentType":"FIN.ALLOCATION","documentDate":"2026-11-03","currency":"MNT",
  "party":{"ref":"customer:412","name":"Мөрөн-Од ХХК","kind":"COMPANY"},
  "description":"Илүү төлөлтийг нэхэмжлэхэд тулгав","controlTotal":"12000.00","lines":[],
  "allocate":{"key":"AR","pairs":[
   {"debit":{"source":{"system":"BTO","docType":"SALES_INVOICE","docId":"905"}},"credit":{"itemId":"5"},"amount":"12000.00"}]}}}
```

- POSTED with a CORE number and no journal entry; OI-5 is closed, OI-6 is open at 18,000. The trial balance does not change.
- Had the accountant left the credit open and OI-6 fallen due unpaid, the default policy would compare the overdue 30,000 with the open credit 12,000 → OVERDUE; an overdue 10,000 against the same credit would pass (§10).
- Under D6 option 3 the 12,000 would sit on `CUSTOMER_REFUNDABLE`, and the dialog would send a SETTLEMENT `FIN.CREDIT_APPLY` instead: Dr `CUSTOMER_REFUNDABLE` 12,000 / Cr 120101 12,000.

**E7. Void instead of a return** (invoice 813). Bto sends `REVERSE` with `source = BTO/SALES_INVOICE/813/1`; the business key is that key plus `action = REVERSE`. The mirror entry is dated today, its AR item is allocated against the original, and the reversal document gets its `Ж-` number. A resend after a lost acknowledgement answers DUPLICATE. The reversal is refused with `FIN_REVERSAL_BLOCKED` while another allocation (a receipt's, or an ALLOCATION document) is live on the invoice's item.

### 14.2 A future PMS: deposit → stay → checkout to a company account → forfeited deposit (cancelled as a Bto posting by ADR-0088: the resort keeps its own copy of this module; kept as an example of what the rules express)

All PMS behaviour is the plan; every tax point is TODO-VERIFY (D12, D25). The resort is company RES (D2). The PMS runs on the resort's server and pushes its outbox to `POST /api/fin/v1/intake` (A2); the core holds a document dated in a closed month or sent before the one it depends on (A1), so a checkout is never refused at the desk.

**Configuration only, through `FinConfig`:** source `PMS` and its grant to RES; accounts (placeholders for the accountant) `<GUEST_DEPOSITS>` (ADVANCE_RECEIVED), `<GUEST_LEDGER>` (RECEIVABLE), `<CITY_LEDGER>` (RECEIVABLE), `<ROOM_REVENUE>`, `<CANCEL_FEE_INCOME>`, `<RESORT_BANK>` (a BANK money account); keys GUEST_DEPOSIT, GUEST_LEDGER, CITY_LEDGER, ROOM_REVENUE, CANCEL_FEE, VAT_OUTPUT, BANK; types PMS.DEPOSIT_RECEIVED (RECEIPT), PMS.ROOM_CHARGE (AR_INVOICE on GUEST_LEDGER), PMS.DEPOSIT_APPLIED / DIRECT_BILL / DEPOSIT_FORFEITED (SETTLEMENT), PMS.DEPOSIT_REFUND (PAYMENT); tax codes `MN.VAT.STD`, plus `MN.CITY.6331000` if city tax applies (Erkhet lists hotel 6331000 and resort 6313000 among its city-tax activity codes).

| # | Event | Intake | Postings | Sub-ledger |
|---|---|---|---|---|
| 1 | Reservation R-1001: 2 nights from 2026-12-20 at 220,000 incl. VAT; payer «Монгол Шуудан ХК» (P7) | none: a booking is not a financial event | — | — |
| 2 | Deposit 132,000 by bank transfer into the resort's bank account, 2026-11-30 | the desk records the transfer and the PMS sends RECEIPT `PMS/DEPOSIT/R-1001-1`: `BANK` DEBIT; `GUEST_DEPOSIT` CREDIT, party P7, `groupRef reservation:R-1001` | Dr `<RESORT_BANK>` 132,000 / Cr `<GUEST_DEPOSITS>` 132,000 | credit item D-1, 132,000: a liability, never revenue |
| 3 | Night audit, 20 and 21 Dec | AR_INVOICE `PMS/ROOM_CHARGE/F-5531:2026-12-20` (and `:21`): `GUEST_LEDGER` DEBIT 220,000 (`groupRef folio:F-5531`); `ROOM_REVENUE` CREDIT 200,000; `VAT_OUTPUT` CREDIT 20,000 (base 200,000) | each night Dr `<GUEST_LEDGER>` 220,000 / Cr revenue 200,000, Cr VAT 20,000 | items G-1, G-2 |
| 4 | Checkout 2026-12-22, folio 440,000: the desk applies the deposit | SETTLEMENT `PMS/DEPOSIT_APPLIED/F-5531`: `GUEST_DEPOSIT` DEBIT 132,000 settles D-1; `GUEST_LEDGER` CREDIT 132,000 settles the folio group, oldest first | Dr `<GUEST_DEPOSITS>` 132,000 / Cr `<GUEST_LEDGER>` 132,000 | D-1 at 0; G-1 open 88,000 |
| 5 | The rest to P7's account | SETTLEMENT `PMS/DIRECT_BILL/F-5531`: `CITY_LEDGER` DEBIT 308,000 (due 2027-01-21); `GUEST_LEDGER` CREDIT 308,000 settles the folio group | Dr `<CITY_LEDGER>` 308,000 / Cr `<GUEST_LEDGER>` 308,000 | G-1, G-2 at 0 (the folio drains); C-1 open 308,000 |
| 5e | e-Barimt at checkout | the PMS prepares the receipt in its own transaction, keyed `PMS/CHECKOUT/F-5531`, B2B to P7, and issues it through the resort's own PosAPI box (D3) | — | — |
| 6 | R-1002 cancelled; its 100,000 bank deposit D-2 is forfeited | SETTLEMENT `PMS/DEPOSIT_FORFEITED/R-1002`: `GUEST_DEPOSIT` DEBIT 100,000 settles D-2; `CANCEL_FEE` CREDIT 90,909.09; `VAT_OUTPUT` CREDIT 9,090.91 (base 90,909.09) only if a forfeit is taxable, otherwise `CANCEL_FEE` 100,000 | Dr deposits 100,000 / Cr fee income 90,909.09, Cr VAT 9,090.91 | D-2 at 0 |
| 6a | Variant: half refunded | PAYMENT `PMS/DEPOSIT_REFUND/R-1002`: `GUEST_DEPOSIT` DEBIT 50,000; `BANK` CREDIT 50,000; then a 50,000 forfeit with base 45,454.55 and VAT 4,545.45, exactly on the 0.01 tolerance (round(4,545.455) = 4,545.46): a test case | Dr deposits 50,000 / Cr bank 50,000 | D-2 50,000, then 0 |

Each POSTED answer carries the core's number and the open items; the outbox marks the row sent.

**Tax-point variants (for the accountant).**
- VAT due at the deposit: row 2 becomes Cr deposits 120,000 + Cr VAT 12,000 with a receipt then; row 4 becomes Dr `<GUEST_DEPOSITS>` 120,000 + Dr VAT_OUTPUT 12,000 / Cr `<GUEST_LEDGER>` 132,000, so the total VAT stays 40,000 on 440,000. The same reversal applies to forfeits.
- Nightly VAT against a checkout receipt: row 3 books VAT in December for a receipt that may be dated January; an option is a "VAT not yet receipted" clearing account moved to VAT payable at the receipt (Erkhet's VAT block shows a deferred-VAT-to-clearing option).
- Recognition nightly (a correct month-end cut-off) or as one charge at checkout is chosen by which events the PMS sends (D12). A night's charge is final after the night audit; corrections are AR_CREDIT, never edits.

**Afterwards.** P7's bank transfer is an ordinary RECEIPT settling C-1. If P7 is also a Bto customer, the accountant links the two refs to one party (D13); its balances stay per company, so its RES debt is not in BO's credit check (D14). Goods Bto sells to the resort go to an INTERNAL party in BO and are a supplier bill from an INTERNAL party in RES.

**Open for the PMS kickoff.** `modules/ebarimt` lives in Bto's api, while the PMS is another repository on its own server with its own PosAPI box. It uses the published `mn` rules; whether it issues receipts through a published issuer package or its own module over the same rules (never a copy of Bto's modules) is decided then (ADR-0074). Either way its receipts are keyed by the source document and the core never sees them. There is no QPay (ADR-0080); a later QR rail for the resort would be a new ADR, keyed by the source document like the rest.

## 15. Screens (planned, Bto web)

- **«Компани»** (P1): the company record (name, TIN, register number, tax registrations); the print header reads it.
- **Posting rules** (P2): read-only; editing comes with `finance.config.manage` in P3.
- **The allocation dialog** (P4, §11) and the allocation lists on the invoice and voucher panels.
- **Periods** (P5): the months of a year with status, the close checklist, close / reopen with a reason, the events.
- **The pending list** (P5, §13) and its attention tile; **drafts** to approve (P5).
- Today's «Санхүү» pages (`docs/modules/finance.md` §9) keep their routes through every phase; the labels come from `mn.json` in the session that builds each screen (`docs/ui.md`).

## 16. Phase plan (ADR-0077, cut by ADR-0083)

### 16.0 The lean go-live plan (ADR-0083, 2026-10-20) — this is the plan now

The owner: «Хамгийн чухал нь санхүүгийн цөмийг хурдан хийж дуусгах… Хойшлуулж болох зүйлсийг хойшлуул.»

Two facts drive the cut:
- **There is no production database (ADR-0026).** The books start on the go-live day from Erkhet's opening trial balance.
- **The PMS starts after go-live.** Bto books into one company until then.

Consequences:
- The `fin` tables start empty, and no copy of Finance I's history is made.
- Each phase that replaces a Finance I table switches its writers to the core and drops that table in the same phase. No frozen copy is kept.
- The development database's finance documents are posted again through the new path by a one-off development script, run once and checked by `pnpm finance:reconcile`.
- The copy-migration rules, the backfill, the migration-path test and the golden trial balance below no longer apply.
- The test gate still applies: today's HTTP scenarios stay unchanged, and the raw-SQL guards and race tests move to `fin.*` with the same scenario and SQLSTATE.

| Phase | Content (drawn from §16.1 and §16.2) | Sessions | Waits on |
|---|---|---|---|
| F1 Foundation and ledger | P1 without `identity.user_company_roles` and without `finRead`/scope machinery: schema `fin`, grants, harness truncation of `fin`, tenant, company BO (`company_id` in every key and FK), branches, sources BTO and FIN, parties from customers, `bto.company_code`, `fin-bridge`, `ensureDefaultCompany`; P2's ledger: accounts, money accounts, rules seeded from today's roles, monthly periods (OPEN / CLOSED only), journal entries and lines with the balance guards and UNIQUE `(company_id, reverses_id)`, `fin.audit_log`; Bto's journal writers (invoice, voucher, credit note, POS close and hand-over) post to `fin`; `journal_entries` / `journal_lines` dropped; AI views recreated; the development re-post | 2–3 | — |
| F2 Intake and open items | P3 without the TESTPMS fixture and P4 without the backfill: the synchronous intake (`submitInTx`) with every class (AR_INVOICE, AR_CREDIT, RECEIPT, PAYMENT, AP_BILL, AP_CREDIT, JOURNAL, ALLOCATION, REVERSE), documents, open items, allocations, party balances, rule resolution, `FinReader` / `FinConfig`; Bto's receivables on the engine (`ar_entries`, `customer_balances`, `payments`, `allocations` dropped); `exposureInTx` and the default overdue rule (§10); the manual allocation dialog (§11); the core reconcile | 2–3 | — |
| F3 Payables | §16.2 Payables: goods receipts (ADR-0078) as AP_BILLs, or bills settled at once for CASH / BANK; supplier payments; supplier returns as AP_CREDIT; the accountant's screens | 2 | — |
| F4 Stock and cost | §16.2 COGS and inventory: receipts (stock, input VAT), goods issues by expense type (ADR-0081), adjustments, stocktakes, transfers, returns and the cost of goods sold as JOURNAL documents | 1–2 | D8 |
| F5 Close and opening | P5 reduced: close and reopen of the latest month with a reason and an event row, a closed month refusing postings in-process, `periods.close` / `periods.reopen`; §16.2 Chart and opening import | 2 | D16, D27 |
| F6 Reports | §16.2 Statements, VAT return, closing | 2–3 | D17, D25 |

**F1 progress.** P1 (2026-10-20, ADR-0084, §3.6) built F1's organisation half: schema `fin`, grants, the guard function, the harness truncation, tenant `BUTEN_ORGIL`, company BO with its tax registrations, branches, the sources BTO and FIN with grants, the 15 posting keys, parties from customers plus `LEGACY_UNASSIGNED`, `fin.audit_log`, `bto.company_code`, `modules/fin-bridge` and `ensureDefaultCompany`. It also built two items this plan defers, which the owner kept (2026-10-20) because they are built, tested and grant exactly today's permissions: `identity.user_company_roles` (mirrored from `user_roles`, read into `AuthContext.companyPermissions`) and the per-company checks of `resolveCompany` with the test StaticCaller. The ledger half was built the same day (§3.7, ADR-0089): accounts and money accounts moved with their ids, roles became append-only rules, monthly periods, the journal with its balance guards and the reversal key, Bto's journal writers switched, the old chart, money-account and journal tables dropped, the development re-post. **F1 is done**; next F2.

**Order.**
- F1 → F2 → F3 and F4 in either order → F5 → F6. About 11–15 sessions, re-planned in STATUS after each phase.
- e-Barimt keeps its own track (ADR-0074).
- Payables (F3) still precede procurement (delivery 8).
- H1 no longer precedes delivery 5: the drivers' cash sessions record vouchers through the core from F2.

**After go-live, with the interim practice:**

| Waits | Until then | Then |
|---|---|---|
| Fixed-asset register and depreciation runs (§16.2) | the register in a spreadsheet, depreciation as a monthly manual entry, balances in the opening trial balance | after go-live |
| Bank-statement import (§16.2) | cash and bank vouchers typed by hand | after go-live |
| Drafts with approval, soft close, override, the pending list, HELD (ADR-0071 #12, ADR-0075 #2, #6) | manual entries post at once and are audited; a closed month refuses | after go-live |
| The rights beyond `periods.close` / `periods.reopen`, a per-company grant screen (ADR-0075 #7, #8) | today's finance permissions: `identity.user_company_roles` exists since P1 as a mirror of `user_roles` (ADR-0084 #2), so it grants exactly them | with the PMS |
| ~~`finRead`, the scope setting, scoped services, the isolation tests (ADR-0076 #2–#4, #10), the TESTPMS fixture, A1, A2~~ **cancelled by ADR-0088** (each system its own books) | one company per installation | never (was: at the PMS kickoff), before the PMS posts |
| H1 (`billing` split, ADR-0073), H2 (POS through the intake) | `modules/finance` and `pos` call the core directly; same behaviour | after go-live |

**Superseded by §16.0.** The rest of §16 is ADR-0077's plan. It is kept for the content each F phase takes. Its sessions, its order constraints and its copy-migration, backfill, migration-path and golden-balance rules are replaced by the above.

**Rules for every phase.**
- It ends with `pnpm check` green, today's routes and screens working, the development database migrated forward (no applied migration edited), and `docs/modules/*.md` and STATUS updated.
- **The test gate.** The HTTP scenarios stay unchanged, `finance-races.spec.ts:50` included. The raw-SQL guards and race assertions (`apps/api/test/integrity/finance-guards.spec.ts:42-115`, `finance-races.spec.ts:93`, `finance-ledger.spec.ts:4,69`) move to `fin.*` in the phase that moves their table, with the same scenario and SQLSTATE, never weakened; the old files go only in H1.
- **Copy migrations.** Drizzle applies all pending migrations in one transaction (`node_modules/drizzle-orm/pg-core/dialect.js:60-71`, installed in the main checkout), so a copy migration creates its constraints and triggers before copying, or runs `SET CONSTRAINTS ALL IMMEDIATE` after it. A `DO` block raises on any mismatch of row counts, Σ debit, Σ credit, balances per account and party, or counters. Tables move in two steps: (A) create, copy with ids kept (`OVERRIDING SYSTEM VALUE`, `setval`) and freeze the old table with `REVOKE INSERT`; (B) drop it later. Renamed columns are added and dropped in separate generates.
- **A migration-path test** per copy phase builds a database at migration N−1, runs a scripted flow (sale, partial payment, payment void, credit note, invoice void, manual AR entry, POS close and hand-over), applies N and asserts the golden figures; it is also tried on a dev copy owned by the migrator. Copy migrations do nothing on the empty databases `pnpm check` builds, so this test is their only automatic proof.

### 16.1 The carve

| Phase | Goal | Migration | Exit (beyond check green) | Sessions |
|---|---|---|---|---|
| R | merge the rep-app branch before P1: done 2026-10-19 (PR #3); it brought `0030_notifications.sql` (renumbered from its `0028_notifications.sql`) and a `SALE_LISTENER` that reads the invoice number, so later phases keep `SaleSink` returning `{invoiceId, number}` | `0030_notifications` (the rep-app's) | merged (done) | 0.5 |
| P0a | the decisions: ADR-0069 … ADR-0077, SPEC, architecture, this document (2026-10-18) | none | documents amended | 1 |
| P0b | `packages/fin-contract`; an empty `FC/` module; the §3.3 work list; `@tugeel/shared/mn` (the split and the chart moved, the old paths re-export); lint elements and fixtures; `core:standalone`; `pnpm install` with dev stopped | none | a `finance-core → modules/sales` fixture fails lint; the standalone list is exact. **Done 2026-10-18 (§3.5)** | 1 |
| P1 | organisation: `CREATE SCHEMA fin`, grants, harness truncation of `fin` (the harness empties `public` only today, `apps/api/test/harness/after-env.ts:13-21`), fin-owned trigger functions; tenant, company BO, tax registrations from the settings, branches with refs by id, sources BTO and FIN, grants, posting keys; parties, refs and `party_companies` from customers, plus `LEGACY_UNASSIGNED`; `bto.company_code`; `identity.user_company_roles`; `fin-bridge` (contexts, `resolveParty`, `CUSTOMER_CHANGED`); `ensureDefaultCompany` at boot under an advisory lock | `fin_foundation` | scope and no-cross-FK catalog tests. **Done 2026-10-20 (§3.6)**: `fin.audit_log` came in from P2, the balance function moved to P2 and `tax_rates` to P3 (ADR-0084 #5) | 1 |
| P2 | the ledger: accounts (flags, contra sides), money accounts (plus a LEGACY box), rules seeded from the roles, periods (every month from the first entry's month to the current one, OPEN), journal entries and lines (control lines without detail → the LEGACY party or box); UNIQUE `(company_id, reverses_id)`; `JE_NO` copied; the balance trigger function (moved from P1); the nine FKs into moved tables dropped (`F/schema.ts:249,255,360,432,434,441,447`; `P/schema.ts:62,263`); a `postEntryInTx` façade (lint: `modules/finance`, `pos`); journal, account and money reads through `finRead`; AI views over moved tables recreated (`security_barrier`, filter); the reused-connection test | `fin_ledger` | a golden trial balance by account × party on the dev copy; the full HTTP flow on the migrated copy | 3 |
| P3 | the engine, proven by a second source: intake requests and attempts, `IntakeService` (§6), every class including ALLOCATION, documents, open items, allocations, party balances, the one-item trigger, rule resolution and coverage, tax codes and rates from `mn` data, `FinReader`, `FinConfig`, the posting preview; the TESTPMS fixture (source system `TEST_PMS`) runs §14.2 in-process; Bto untouched | `fin_engine` | dedupe, conflict and concurrency tests; §14.2 by configuration only; GL = sub-ledger | 2–3 |
| P4 | Bto's receivables onto the engine: the backfill (below); `PAY_NO` copied; vouchers through the intake (`docId` from the header); invoicing, void and credit note switched to `submitInTx` (still in `modules/finance`); `exposureInTx` and the default overdue rule (§10); the allocation dialog and routes (§11); the callers of `TaxService.companyRates` (finance's invoicing, `billing` from H1, and pos: `F/services/invoicing.service.ts:59`, `P/services/pos-accept.service.ts:505`, `pos-snapshot.service.ts:44`, `pos-dev.service.ts:165`) read `FinReader.taxPosition` through `fin-bridge`, while catalog keeps the product's `vat_type` only and gets no dependency on the core; the core reconcile (cache, items, sub-ledger ↔ GL; the drain report); Bto's completeness check through `sourceKeys`; `ar_entries`, `customer_balances`, `payments`, `allocations` frozen, and the POS FK `handover_payment_id` → `payments` (`P/schema.ts:265`) dropped; AI views recreated | `fin_receivables` | the same balances and aging; a POS shift's entry drills down to its source; the races test passes with a rep who has no finance grant | 2–3 |
| P5 | control: close (end date, checklist, override), soft close, reopen, events; the new rights; `fin.drafts` and approve; the pending list and its tile; the OPENING path (an offset account that drains, `itemRef` / `itemDate`, the opening entry dated the day before go-live (default; TODO-VERIFY D27) in a period closed after the import) | `fin_periods` | close October, try a back-dated voucher, reopen with a reason | 2 |
| H1 | the billing split, before delivery 5: `modules/finance` → `billing` + `fin-bridge` legacy routes; `billing_settings`; `open_amount` dropped; the inventory raw SQL replaced; step B drops; `MODULE_DEPS` | `billing`, `fin_drop_old` | no FK across `fin`; nothing imports `finance` | 2 |
| H2 | POS through the intake, after POS S3 merges and before S4: `BTO.POS_SHIFT_CLOSE` (JOURNAL, key = the shift's `client_id`) and `BTO.POS_HANDOVER` (RECEIPT); the façade removed; ADR-0064 #2–#4 amended in mechanism only | small | a test-till shift as before; pos and edge tests green | 1 |
| A1 | asynchronous intake, at the PMS kickoff: HELD, `dependsOn`, the wake job, `FinOutbox`, the result feed | small | out-of-order and lost-job tests | 1 |
| A2 | HTTP, **required before the PMS**: `/api/fin/v1`, source tokens, batches, heartbeats, `freshness`, the result feed over HTTP, the published `@tugeel/fin-contract` and `mn` packages | small | the HTTP isolation and transport tests | 1–2 |

**P4 backfill.** Every entry gets a document with a MIGRATION intake row: invoices `BTO/SALES_INVOICE/<id>`, credit notes `BTO/SALES_RETURN/<id>`, payments `FIN/LEGACY_PAYMENT/<id>`, manual entries `FIN/LEGACY_JOURNAL/<id>`, POS closes `BTO/POS_SHIFT_CLOSE/<client_id>`; AUTO_VOID entries become reversal documents. Every party-control line gets an item; every live allocation becomes an allocation and every voided one a pair; every historical reversal's item is allocated against the original's (a voided invoice set `open_amount = 0` without an allocation, `F/services/invoicing.service.ts:212-222`); a refund's debit item is allocated against the credit items it paid back, oldest first (a refund voucher is the accountant's own act of paying a credit back). The `DO` block asserts: open = amount − Σ allocations for every item; invoice items' open = `invoices.open_amount`; no open item on a reversed document; Σ items = the GL per party and account; the cache = the old `customer_balances`. These pairings rebuild what the books already say; none applies an open credit to an invoice.

### 16.2 Go-live additions (Erkhet stops on the go-live day, D5)

| Work | What (the plan) | Order | Sessions | Waits on |
|---|---|---|---|---|
| Payables | `AP_BILL` / `AP_CREDIT` and supplier PAYMENTs as open items, with the accountant's screens; supplier parties `supplier:<id>`; the source facts are Bto's goods receipts as the main session's ADR-0078 keeps them: the payment method (CREDIT, CASH or BANK), the money account, a VAT rate frozen from the supplier's `vat_payer` flag and the company's rate, and the delivery-note line prices with VAT included. The receipt itself posts no payables and no journal entry. The VAT split is decided there (ADR-0078 #3, #4): a line's VAT is `receiptLineVat` = amount × rate / (100 + rate), 2 decimals, half up, per line; its cost is the delivery-note amount less that VAT (`receiptLineCost`); the valuation row keeps both, `amount` (ex-VAT cost, so ADR-0033 holds) and `doc_amount` (with VAT); `vat_rate_pct` is frozen at posting and is 0 unless both the company and the supplier are VAT payers. Per receipt, from its latest valuation version: the payable is Σ `doc_amount`, the input VAT Σ `receiptLineVat`, the stock Σ `amount`; a re-costing writes a new version and the payable follows it. A CREDIT receipt becomes an `AP_BILL` of the supplier; a CASH or BANK receipt a bill settled at once by a PAYMENT from its money account (the accounts: TODO-VERIFY D8). Procurement later sends `AP_BILL` commands the same way; the manual allocation serves payables too | after P3, before delivery 8 | 2 | — |
| Bank import | the daily statement import, Khan Bank Excel first: lines normalised with a dedupe hash, matches proposed (invoice number in the text → party → amount and date) and confirmed by the accountant, each posting a RECEIPT or PAYMENT keyed by the statement line; the rest by hand | after P4 | 1–2 | a sample Khan Bank statement file |
| Fixed assets | asset classes (asset and depreciation accounts, rate, life), the asset register, acquisition from a supplier bill or a voucher, a depreciation run per company × period as a JOURNAL through the intake, disposals; reused by the PMS | after P3 | 2 | the method (Erkhet shows straight line by days at a class rate in its forms and handbook; the run was not opened) — TODO-VERIFY |
| COGS and inventory | Bto posts the daily cost of goods sold and the inventory postings (receipts, adjustments, stocktakes, transfers, returns) as JOURNAL documents; a receipt's posting reads the same ADR-0078 receipt fields as the payables row. The main session's goods issue (ADR-0081: document `GI`, movement `GOODS_ISSUE`, migration `0029_goods_issues`) takes stock out at the average cost with an admin-managed expense type (`issue_expense_types`) and a recipient (USER, CUSTOMER, SUPPLIER or free text), and books no entry: mapping each expense type to its GL account is part of this work (D8). A supplier return also leaves at the average cost; its payable correction (`AP_CREDIT` against the supplier's bill) is the core's, with the payables row | after P5 | 1–2 | D8 |
| Statements, VAT return, closing | statement and VAT-return templates as data in `mn`; the reports over the journal; the closing entry as an idempotent period-end command keyed (company, period, step) | after P5 | 3–4 | D17, D25, the income-tax method |
| Chart and opening import | Erkhet's chart (codes, names, groups) with the control types marked; then the opening trial balance as an OPENING document: AR and AP per party as open items with due dates, fixed assets with accumulated depreciation, dated the day before go-live (default; TODO-VERIFY D27) in a month closed after the sign-off against Erkhet's closing TB per account and per party | after P5 and the fixed assets; run at the cut-over | 1–2 | D16, D27 |
| Payroll postings | `hr` (source HR) posts through the intake; the accountant posts payroll by hand until then (D21) | delivery 11 | — | the `hr` module |
| Control-system reader | role `fin_control` over `fin_ctl.*` | with the control system | about 1 | — |

**Totals (estimates, ADR-0077).** R to P5: about 13–15 sessions; from then on the PMS can be added without rewriting the engine. With H1, H2 and the rebase overhead: about 17–20. The go-live additions: about 10–14 (the bank import 1–2). So about 27–34 core sessions before go-live. A1 and A2 (about 2–3 sessions) come at the PMS kickoff, after go-live. These are estimates, re-planned in `docs/STATUS.md` after every phase.

**Order constraints.**
- P0a before e-Barimt on invoices: `ebarimt_receipts` is created source-keyed from its first migration and is never bound to a finance-owned invoice (ADR-0074). That session waits for the PosAPI spike and the mini-PC and can run any time after P0a; it calls from wherever invoicing lives, and the table never changes.
- H1 before delivery 5; payables before procurement (delivery 8); A1 and A2 before the PMS.
- POS S3 (ADR-0065, reserved) runs in parallel on the edge; P0b's `mn` subpath lands before S3 starts, and H2 waits until S3 merges.
- The 2026-11-13 e-Barimt certification gate is the owner's deadline for the tax office's written answer (ADR-0017), not a build date.
- Checks run one at a time: parallel checks on one PostgreSQL container time out.

## 17. Test plan

**Under the lean plan (ADR-0083, §16.0)**, some cases wait:
- the interrupted-transmission cases wait for A1 and A2;
- the isolation cases of `fin-isolation.spec.ts` wait for the PMS kickoff, except the catalog test (scope columns, composite FKs, no FK across `fin`), which runs from F1;
- extraction cases (3), (4) and (6) wait for the TESTPMS fixture and A2;
- closed-period cases on SOFT_CLOSED, override and HELD wait with those features;
- the golden trial balance and the N−1 → N migration tests are dropped.

Everything else runs in the F phase that builds its subject.

All tests run on real PostgreSQL (ADR-0016). Race cases go in the integrity suite, `--runInBand`, never retried. Files: `apps/api/test/integrity/fin-*.spec.ts` and `apps/api/test/fin/*.int-spec.ts`.

| Area (file) | Cases |
|---|---|
| Duplicates (`fin-intake-dedupe.spec.ts`) | (1) same key, same payload → POSTED, then DUPLICATE with the same numbers, row counts unchanged and the counter not advanced; (2) key order, `"100"` against `"100.00"` and an explicit `revision: 1` give the same hash; (3) same key, another amount → CONFLICT, nothing booked, one attempt row; (4) same key, another company → `FIN_SOURCE_COMPANY_MISMATCH` with no result body, while two source systems with the same id stay independent; (5) ten concurrent identical submits released by an advisory-lock barrier → one POSTED, nine DUPLICATE, one entry; two concurrent different payloads → one POSTED, one CONFLICT; (6) REJECTED (`FIN_MAPPING_MISSING`), the rule added, the command resent → POSTED, one request row, two attempts; (7) revision 2 while revision 1 is live → `FIN_REVISION_NOT_ALLOWED`, after the REVERSE → POSTED; (8) a REVERSE whose acknowledgement is lost → DUPLICATE on resend, a second REVERSE with another reason → CONFLICT, a REVERSE of a REJECTED target → CANCELLED with no entry; (9) a payment resent through the dialog after 8 days with the same key, or a migrated key → DUPLICATE |
| Interrupted transmission (`fin-intake-transport.spec.ts`; a fault-injecting fake transport for jobs from A1 and HTTP from A2) | (1) the source commits with `fin.submit` enqueued and the worker stopped → no intake row, POSTED once after the restart; (2) acknowledgement lost → DUPLICATE with the original numbers; (3) `FIN_BUSY` retried with backoff, a permanent error not retried and listed as failed; (4) DEPOSIT_APPLIED before DEPOSIT_RECEIVED → HELD, then the wake job posts it and the end state equals the in-order run; (5) a batch with item 2 rejected → 1 and 3 post, and on resend 1 and 3 are DUPLICATE and 2 is rejected on the same row with attempts + 1; (6) a corrected payload enqueued while the first job still retries is not lost; (7) a lost job is caught by the source's completeness check through `sourceKeys`; (8) in-process now: a core error inside the sale rolls back the stock issue and the order status; (9) HTTP: a dropped connection after the commit → the outbox resends and gets DUPLICATE, a HELD answer stops the resends, and the result feed later reports POSTED |
| Unbalanced and atomic (`fin-balance-guards.spec.ts`) | (1) off by 0.01 → `FIN_UNBALANCED`; a raw unbalanced insert as `app` and as `migrator` → refused at COMMIT (extends `finance-guards.spec.ts:71`); (2) company B's account, party or period on a company A entry → composite-FK violation; (3) a `controlTotal` mismatch, scale 3, a zero line, a party-control line without its party or its item → refused; (4) a failure injected after the journal insert → nothing persists and the number is reused; (5) UPDATE or DELETE on documents, entries, lines or allocations → 23001, the migrator included; UPDATE of an item's `amount` → 42501; (6) two concurrent reversals → exactly one; (7) the tax tolerance at 0.01 and 0.02 per line (row 6a of §14.2 included), `lineCount` above the cap → refused |
| Manual allocation (`fin-allocation.spec.ts`) | (1) an ALLOCATION of a credit item against a debit item → both open amounts drop, no journal entry, the trial balance unchanged, `party_balances` rewritten; (2) a pair above either open amount → `FIN_OVER_ALLOCATION`; items of another party or account → refused (the class rule, and the composite FK underneath); two debit items paired → `FIN_CLASS_RULE {ALLOCATION_SIDES}`; (3) two concurrent allocations of one credit item that together exceed it → exactly one commits; (4) a REVERSE of the ALLOCATION restores both items, a resend → DUPLICATE; (5) a receipt's REVERSE while an ALLOCATION of its credit item is live → `FIN_REVERSAL_BLOCKED`, and after the ALLOCATION is reversed the receipt reverses; (6) no path applies a credit on its own: after an AR_INVOICE for a party with an open credit item, both items stay open (a guard for the owner's rule) |
| Closed period (`fin-periods.spec.ts`) | (1) posting into CLOSED → refused in-process, HELD asynchronously; a POS close dated in a closed month lands in `pos_sync_rejections` and replays after a reopen; (2) SOFT_CLOSED: an `allowed_in_soft_close` type posts, others are refused or HELD, the core's screens post only with override; (3) closing before the end date → `FIN_PERIOD_NOT_ENDED`; a failed checklist → refused, or logged with override; (4) reopen without the right → 403, without a reason → 422, of a non-latest period → refused; success writes events and audit rows and releases HELD documents; (5) a close racing a post, in both orders → no entry dated in the period commits after the close; (6) with the default HOLD nothing moves to another month on its own; (7) a month with no row before the latest closed one (August, with September and October CLOSED): a voucher dated in August → `FIN_PERIOD_CLOSED`, no August row is created and the voucher waits in the pending list; a document dated in a month after the latest closed one creates its row OPEN; after P2's migration every month from the first entry's month to the current one has a row |
| Another company's data (`fin-isolation.spec.ts`) | (1) API: a user with rights only in A asks for B's document, items, statement or exposure → 404; a viewer in RES cannot reopen RES while being a manager in BO; (2) service: every `FinReader`, `FinConfig` and intake method for company B with an A-only context → `FIN_COMPANY_FORBIDDEN` (one parameterised test); a context built outside `fin-bridge` fails lint; (3) source principals: a WAREHOUSE user's SALE posts through the source grant alone; over HTTP a `source.system` or tenant that differs from the token → `FIN_SOURCE_MISMATCH`; an ungranted company → 404 with no request row; (4) database: cross-company and cross-tenant references → FK violations, plus the catalog test (scope columns, unique indexes led by scope, every FK between company-owned tables includes `company_id`, no FK crosses `fin`, every row-filtering view is `security_barrier`); (5) AI reader: a user with A gets only A rows, a user without `finance.read` none; an unset setting or a reused pooled connection → an error, not an empty result; `set_config` in model SQL → refused; an error-oracle query (`1/0` on another company's rows) reveals nothing; (6) `groupRef` values of two sources do not collide; (7) later, the control system: approved companies only, 42501 on DML, freshness populated |
| Credit | (1) `finance-races.spec.ts:50`: exactly one of two confirmations passes, and two payments never settle one invoice twice; (2) a payment void or an ALLOCATION racing a confirmation serialises on the party row; (3) a charge of the TESTPMS fixture (source system `TEST_PMS`) to a shared party racing a Bto confirmation is serialised, and visible if it committed first; (4) the default overdue rule: overdue 50,000 with an open credit of 60,000 → passes, with 40,000 or none → OVERDUE |
| Extraction (cases 1, 2 and 5 since P0b: `guards.test.mjs`, `pnpm core:standalone`, `tools/finance-core/fin-sql.test.mjs`) | (1) lint fixtures: the core importing `modules/*`, `edge/*`, `common/segments`, `db/schema.ts` or `@tugeel/shared/sales` fails; a module importing `FC/posting/*` or a `fin` table symbol fails; `FinIntakeInTx` outside the allowed set fails; (2) `pnpm core:standalone` lists only the whitelisted files; (3) `FinanceCoreModule` boots without any Bto module and posts a document of the TESTPMS fixture (source system `TEST_PMS`); (4) the TESTPMS fixture configures everything through `FinConfig`, runs §14.2 and asserts GL = sub-ledger, the folio drain and a clean reconcile; (5) no `fin.` table name in SQL strings outside `FC/**` and migrations; (6) from A2, a client built only from the published `@tugeel/fin-contract` posts the TESTPMS run over HTTP |
| Reconcile (golden and migration path dropped by ADR-0083: no copy migrations) | induced drifts are each detected and exit 2 (a cache, an item or a control account edited by raw SQL); a clearing balance older than its account's age appears on the DRAIN report and does not exit 2; the N−1 → N test of every copy phase; a golden trial balance by account × party before and after P2 and P4 on the dev copy; the tax split identical on 1,000 random lines after the `mn` move |

## 18. Questions for the accountant (TODO-VERIFY)

| # | Question | What it blocks |
|---|---|---|
| D6 | How is an unallocated customer payment presented: on AR as a credit, as a customer-advance liability, or split into advances and refundable overpayments (§11)? Is VAT due on Bto customer advances? | `unapplied_key` on RECEIPT and AR_CREDIT; the statements |
| D8 | COGS and the inventory postings: per sale or daily; perpetual or periodic; the accounts for receipts, adjustments, stocktakes, transfers and returns; original or current cost on returns; the period of a re-costing variance. The receipt's VAT split is no longer open: ADR-0078 #3, #4 (the main session) fixes it per line, see §16.2 Payables. Also: the GL account of each goods-issue expense type (`issue_expense_types`, ADR-0081) and how a supplier return at average cost corrects the payable | the COGS and inventory work (§16.2) |
| D9 | Discounts gross with VAT inside (today) or net of VAT? | the revenue and discount lines of every invoice |
| D12 | Hotel: revenue nightly or at checkout; VAT on a deposit, a forfeit and a refund; city tax at the resort (6331000 / 6313000); nightly VAT through a clearing account? | the PMS posting rules and RES's tax returns |
| D15 | Are Bto's daily `Н-` numbers acceptable as legal invoice numbers? What applies to the hotel? | numbering before go-live |
| D16 | Erkhet's chart as it is? Which accounts are receivable, payable, advance, money or clearing (the POS cash and card-clearing accounts included)? Are today's seeded codes the same accounts in Erkhet? After how many days is a clearing balance reported on the DRAIN report, per account? | the chart import; which detail each line must carry; the drain report |
| D17 | Which statements does the company file (the business СТ1–СТ4, or the NGO forms Erkhet is set up with)? The VAT-return row set? | the statement and VAT-return templates |
| D24 | Is wholesale revenue earned at the SALE stage or on delivery? | month-end cut-off for goods on the road |
| D25 | The VAT tax point per document type; how GL VAT is reconciled with e-Barimt each month | tax dates on lines; the monthly compare |
| D26 | Receivables per branch? Inter-branch lines on cross-branch payments? | balance sheets per branch |
| D27 | Opening balances: the full trial balance (the owner's default) at which date, and how it is signed off against Erkhet's closing TB per account and per customer | the go-live import |
| — | Reversal dating: the correction day (today's rule) or the original's date when that month is open? | the REVERSE date rule |
| — | Write-offs: bad-debt and small-balance policy; an expected-credit-loss allowance? | write-off document types |
| — | Fixed assets: the depreciation method and rates; the closing entry and income-tax method | the fixed-asset run; the closing entry |

## 19. Not built now, and rejected

| Not built now | Why | Why it is no rewrite later |
|---|---|---|
| Row-level security, pooled tenants | one tenant, the owner's group (D1) | reads already go through `finRead`; pooling also needs identity work |
| FX | MNT only (D20) | `currency` and `amount_tx` columns exist |
| `match` rule selectors | Bto's variants differ by document type | a nullable column and an optional field |
| Credit reservations | no remote core, no second credit-granting source (D14) | the same party lock; a table and two routes |
| `ROLE=finance` host, a finance web split, a kernel package outside `@tugeel/shared` | no outside tenant | the exact whitelist keeps them mechanical |
| Party merge documents | no shared parties yet | a SETTLEMENT type per company × account |
| `fin.document_lines`, consolidation and eliminations, per-source period locks beyond `allowed_in_soft_close`, a permanent close, hash chains, bank feeds | no current need | additive tables and statuses |
| An Erkhet bridge or export | Erkhet stops on the go-live day and its "BTO" link is the previous system (D5, D19) | — |

**Rejected:**
- Automatic application of advances and overpayments (it was proposed as "auto-apply"): the owner wants the accountant to apply every credit by hand (D7). The default credit rule (§10) keeps an open credit from blocking orders instead.
- Erkhet's one-sided documents and its "incomplete documents" working state, edit-in-place corrections, deleting an import together with its documents, and the unguarded month toggle (seen in Erkhet's UI): they break balance, immutability and audit. Corrections are reversals; our "incomplete" list is the pending list. That Erkhet's closing can be rerun without a guard is a handbook warning, not something tried.
- A suspense account for unmapped keys: a missing rule rejects the document.
- Copying the core into the PMS, or a fork per system: one source, configured per company (ADR-0069).
