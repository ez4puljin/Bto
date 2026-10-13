# Tugeel (Түгээл) — agent contract

Tugeel is an in-house ERP for the wholesale distribution of Бүтэн-Оргил ХХК (the owner named the main branch «Оргил Бөөний төв» in Mörön, Khövsgöl, and the branch «Боломж бөөний төв» in Kharkhorin, Övörkhangai, on 2026-10-13; older documents assume one centre in Ulaanbaatar — STATUS pending #23): product catalog with multi-unit barcodes,
multi-warehouse stock with bins on an append-only ledger, customer orders (web, customer app, sales reps), picking,
zone-based delivery by company drivers (pre-packed orders only, no van sales), receivables with credit control, QPay
payments, mandatory e-Barimt receipts, one supermarket branch with a POS and a bank card terminal, procurement,
reporting, HR/payroll. One owner-developer builds it with Claude Code, one module per session, and maintains it alone. Development is local-only: every delivery is accepted on the owner's machine and production is deployed once, after the last delivery (ADR-0026).
Repo `tugeel`, packages `@tugeel/*`. On screen the system is called **Bto** (Бүтэн-Оргил ХХК's internal system, owner 2026-10-13, ADR-0042 #11); code names stay `tugeel`. UI is Mongolian only; code, schema, API and every document except `docs/SPEC.md` are English.

## Start of every session

1. Read `docs/STATUS.md`: current state, module table, pending decisions, the "Next session" prompt.
2. Read `docs/SPEC.md` §8 (definition of done + cut line; delivery 1 only — later deliveries use their §9.3 row, the §5 acceptance criteria and the STATUS row), §4 (glossary) and §6 (business rules).
3. Read `docs/architecture.md` §0 (decision summary, pins), §4 (module ownership) and §12 (conventions, ALWAYS/NEVER),
   plus the §5 subsection of the module being built.
4. Read the ADRs listed for the module in `docs/STATUS.md`; never re-argue an Accepted ADR, write a superseding one instead.
5. Work on ONE module per session; start every implementation session in plan mode.
6. On a `TODO-VERIFY` item: stop and ask the owner; never resolve a business unknown by guessing.
7. Before finishing: `pnpm check` green, `docs/modules/<module>.md` current, `docs/STATUS.md` updated with a fresh next-session prompt.

## Stack and pinned versions

Confirmed 2026-10-10 from the npm registry (exact pins in every `package.json`; only TypeScript uses the catalog range):

| Package | Version | Note |
|---|---|---|
| Node.js | 26 (`.nvmrc`, `engines ^26.7.0`); Docker `node:26-trixie-slim`; CI `ubuntu-24.04` | ADR-0023 |
| pnpm | 11.28.2 (`packageManager` + `devEngines`); `nodeLinker: hoisted`, `minimumReleaseAge: 1440`, `allowBuilds` | install with `npm i -g pnpm@11.28.2` (no corepack) |
| TypeScript | `~6.0.3` (6.0.3), ONE version workspace-wide via the pnpm `catalog:`; `pnpm ts:single-version` | never `typescript@7` (ADR-0001) |
| NestJS | core/common/platform-express/testing 12.1.2, cli 12.0.8, schematics 12.0.6, swagger 12.0.2, config 12.0.1 | ESM-only packages, CommonJS app (ADR-0025) |
| Drizzle ORM / drizzle-kit / pg | 0.45.4 / 0.31.11 / 8.23.1 | Drizzle 1.0 not adopted |
| pg-boss | 12.37.1 (+ `@opentelemetry/api` 1.9.1); docs https://pgboss.io | schema v45, installed by `db:migrate` (ADR-0024) |
| PostgreSQL | 18 (UTF-8, ICU `und`); local `postgres:18` on `127.0.0.1:15432` | |
| zod, decimal.js, dayjs | 4.6.5, 10.6.0, 1.11.23 | `Decimal` only from `@tugeel/shared/money` |
| nestjs-pino, pino, pino-http | 5.3.1, 10.4.0, 11.0.0 | |
| jest, ts-jest, supertest | 30.5.2, 29.4.14, 7.3.1 | Jest always via `apps/api/scripts/jest.cjs` (`--experimental-vm-modules`) |
| eslint, typescript-eslint, eslint-plugin-boundaries | 10.12.0, 8.71.1, 7.2.0 | |
| vite, @vitejs/plugin-react, vitest | 8.3.4, 6.1.2, 5.0.3 | |
| react, react-router, @tanstack/react-query | 19.3.0, 7.18.4, 5.104.1 | v8 of React Router exists; stay on 7 (docs: reactrouter.com/7.18.4) |
| tailwindcss, shadcn, radix-ui, cn, lucide-react | 4.3.3, 4.21.4 (`radix-nova`), 1.7.0, 0.4.0, 1.53.0 | never `shadcn init --defaults` |
| i18next, react-i18next, @fontsource-variable/inter | 26.4.2, 17.0.16, 5.3.0 | Inter is the web font (ADR-0042); PDFs embed Noto Sans (ADR-0011) |
| openapi-typescript, openapi-fetch | 7.13.0, 0.17.0 | |
| TanStack Table | not used in delivery 1 (decided 2026-10-11): plain shadcn tables, server-side filters, keyset "load more" | choose 8.21.3 (frozen since 2025-04) or 9.x when a screen first needs client-side sorting or grouping |
| Expo SDK | the stable SDK at delivery-4 kickoff; pinned then in `docs/modules/mobile.md` | |
| argon2, @nestjs/jwt | 0.45.1 (`allowBuilds: argon2: true`, prebuilt binaries), 12.0.2 | identity (ADR-0027); no passport |
| react-hook-form, @hookform/resolvers, @testing-library/user-event | 7.89.0, 5.9.1, 14.6.7 | web forms with zod from the catalog |
| barcode-detector, zxing-wasm | 3.2.2, 3.1.3 | web camera fallback; `zxing-wasm` = the exact version `barcode-detector` declares, `.wasm` served from our build (ADR-0031) |
| exceljs | 4.4.0 (api only) | imports (ADR-0036): the worker loads the whole workbook (`workbook.xlsx.load`, files ≤ 5 MiB); never the streaming reader, which loses shared strings and hyperlink targets |
| pdfmake, `@nestjs/throttler`, receipt-printer-encoder | `npm view <pkg> version` when first installed; pick a version older than 24 h | |

Majors change only in dedicated sessions between deliveries.
DB pool budget (env `DB_POOL_MAX` / `PGBOSS_POOL_MAX`): production api 6, worker 3, pg-boss 2 per process; staging 2 / 2 / 2 (architecture §10.2).

## Commands

| Command | What it does |
|---|---|
| `docker compose up -d --wait` | local `postgres:18` (ICU) on `127.0.0.1:15432`; needed by `pnpm check` and `pnpm dev` |
| `pnpm install` | install the workspace (Node 26, pnpm 11); a pnpm `EPERM rmdir` on Windows: rerun `pnpm install`; stop `pnpm dev` before adding a package |
| `pnpm db:provision` / `pnpm db:migrate` | roles + ICU database (admin URL in `apps/api/.env`) / drizzle migrations + pg-boss schema + queues as `migrator` |
| `pnpm db:generate --name=<module>` | generate SQL from `src/db/schema.ts`, then hand-edit CHECK / EXCLUDE / REVOKE / triggers (`--custom` for SQL-only) |
| `pnpm dev` | builds packages, then watches shared + api + worker + web (http://localhost:5173; the api listens on `API_PORT`, 3300 locally, and Vite proxies `/api` there) |
| `start.bat` / `stop.bat` | the owner's double-click start for testing from other PCs on the LAN: PostgreSQL, `pnpm db:migrate`, then `pnpm dev` in a «Bto dev» window with `DEV_LAN=1` (Vite on every interface; prints `http://<LAN address>:5173`) / stops that window, every node process of this repo and the tugeel PostgreSQL container — never other projects |
| `pnpm user:create-admin --username <name> --full-name "<name>"` | create (or recover) an ADMIN and print a 30-minute one-time code; the user sets the password at `/set-password` |
| `pnpm catalog:reindex-search [--all]` / `pnpm partners:reindex-search [--all]` | recompute product / customer and supplier search keys after `SEARCH_KEYS_VERSION` changes (`--all`: every row; ADR-0028) |
| `pnpm inventory:reconcile` / `pnpm inventory:rebuild-balances` | compare `bin_stock` / `warehouse_stock` with the ledger and record a run (exit 2 on drift) / recompute the cache quantities from the ledger, keeping averages, then reconcile (find the cause of a drift first; `docs/modules/inventory.md` §7) |
| `pnpm check` | ts:single-version → prettier → build packages → eslint → lint-guard self-test → typecheck → gen:api freshness → drizzle-kit check → unit (Jest + Vitest) → integration → integrity (`--runInBand`) → build |
| `pnpm gen:api` | export OpenAPI from the api build and regenerate `packages/api-client`; commit the result |
| `pnpm ci:rehearse` / `pnpm docker:build` | run the CI check job in Linux Docker against HEAD / build both images |

**`pnpm check` green is the definition of done.** CI runs the same command with a `postgres:18` service; nothing merges red. `apps/api/.env` comes from `apps/api/.env.example` (gitignored).

## Conventions (full text in `docs/architecture.md` §6 and §12)

- Money `NUMERIC(14,2)` MNT, quantities `NUMERIC(14,3)` base units, unit costs / `avg_cost` `NUMERIC(14,4)`, factors `NUMERIC(18,6)`; Drizzle custom types `money()` / `qty()` / `cost()` (`apps/api/src/common/db/types.ts`) return `Decimal`; arithmetic only through `@tugeel/shared/money` (decimal.js, HALF_UP); unit prices whole MNT, VAT and city tax 2 decimals per line, summed into the header.
- `timestamptz` (UTC) in the DB; business dates (`effective_date`, report periods, `billIdSuffix` day, `reportMonth`) in Asia/Ulaanbaatar via dayjs + timezone; `posapi_date` stored verbatim.
- English identifiers, enum values and error codes in the DB and API; Mongolian only in `packages/shared/i18n/mn.json` and user data; `search_text` normalised in app code.
- Rules the api, the web and the importer share live in `packages/shared` and are never re-implemented: search keys `@tugeel/shared/text`, barcodes `gtin`, unit factors `units`, phones `phone`, TIN / registration / consumer numbers `taxpayer`, GPS parsing `geo`, bin codes, document numbers, adjustment reasons and cost arithmetic `inventory`; the database checks only the generic shapes.
- `Idempotency-Key` header on every document-creating POST from every client; stored in `idempotency_keys`, response replayed on repeat.
- Audit rows via `AuditService.record(tx, …)` inside the service transaction; document numbers allocated at SUBMIT/POST inside that tx (drafts have no number); a POSTed document is immutable, corrections are reversing documents.
- Modules import only `modules/<other>/index.ts`; atomic cross-module writes pass the Drizzle `tx` explicitly; side effects are pg-boss jobs enqueued in the same tx; `src/integrations/**` is called only from `jobs/*.job.ts` or `*-flow.service.ts`, between transactions.
- Errors are RFC 9457 problem+json with a stable `code` and `params`; lists use keyset pagination `{ data, nextCursor }`.
- Every route carries exactly one of `@Public()`, `@Authenticated()` or `@RequirePermission(...)` (the global guard answers 403 otherwise); the caller is `@CurrentUser() ctx: AuthContext`, passed explicitly to services; warehouse writes call `ScopeService.assertCanWriteWarehouse` (ADR-0027, `docs/modules/identity.md`).
- ESLint guards (`eslint.config.mjs` G1–G6, proved by `tools/lint-guards/guards.test.mjs`) must never be removed or weakened: G1 `boundaries/dependencies` (module `index.ts` only, §4 direction, `src/integrations/**` only from `jobs/*.job.ts` / `*-flow.service.ts`, web imports only `@tugeel/api-client` / `@tugeel/shared`); G2 `stockLedger` import ban outside `stock-posting.service.ts`; G3 `Number(` / `parseFloat(` ban in `apps/api/src/modules/**`; G4 Cyrillic literal ban in `**/*.tsx`; G5 literal JSX text ban; G6 `noInlineConfig` (`eslint-disable` comments do nothing: exceptions go in the config). From delivery 3: no `fetch` / `axios` / `integrations/*` calls inside `db.transaction(...)`.
- Workspace packages are CommonJS with a `@tugeel/source` export condition (ADR-0025): the api uses their built `dist`, Vite/Vitest/Jest read the source; `pnpm check` builds them first.
- Web screens follow `docs/ui.md` (ADR-0042): `PageHeader` with the menu breadcrumb (no «Буцах» buttons), the list kit (filter bar, list card, rows that open their record), read-first `DetailCard`s, create dialogs on `?new=1`, toasts for confirmations, tokens instead of colour literals. `components/ui` keeps shadcn formatting: run prettier from the repo root only.

## ALWAYS

- Pass `tx` explicitly through service calls that must be atomic; enqueue side effects with pg-boss in the same tx.
- Re-run the price resolver at SUBMIT and freeze prices, rates and `factor_snapshot` on the lines.
- Lock the customer row before a credit check; lock stock rows in the order documented in architecture §5.3.
- Write integration tests against real Postgres for every service that touches stock or money; keep the integrity suite green.
- Keep `docs/modules/<module>.md` current; record every new decision as an ADR (next free number in `docs/decisions/README.md`).
- Keep `deploy/`, `deploy/.env.example` and architecture §10.2 in step with every runtime-config change (env, ports, volumes): nothing is deployed before the go-live phase, but the CI `images` and `deploy-config` jobs must stay green.

## NEVER

- Run `drizzle-kit push` (no `db:push` script exists); edit an applied migration.
- Call `Number()` / `parseFloat()` on a NUMERIC value, or use floats for money or quantity.
- Build a business date with `new Date().toISOString().slice(0, 10)` or any UTC date; use dayjs in Asia/Ulaanbaatar.
- Write literal Cyrillic in `.tsx` (i18n keys only); hard-code VAT or city-tax rates.
- Write `stock_ledger` outside `StockPostingService`, or write another module's tables.
- Make an HTTP call (PosAPI, QPay, SMS, push) while a DB transaction is open; blind-retry a timed-out PosAPI call.
- Persist or log e-Barimt `lottery` / `qrData` anywhere (DB, logs, Sentry, `ebarimt_submission_log`, fixtures) — the single exception is the rendered receipt bitmap in `print_jobs.payload`, nulled on ack and expired after 10 min (ADR-0022).
- Mark a payment paid from a callback body; only `payment/check`, a cash session or a statement match records a payment.
- Install `typescript@7` or a second TypeScript version; upgrade a major dependency inside a delivery session.
- Skip, weaken or retry the integrity suite; add `jest.retryTimes` or any retry to CI.
- Commit secrets or `.env*` files (only `.env.example`); paste credentials into docs or code.
- Expose PosAPI port 7080 beyond the Tailscale ACL; add Redis, mailpit or `@nestjs/event-emitter` to the stack.

## Docs map

| Document | Read when |
|---|---|
| `docs/STATUS.md` | every session start and end: progress, Week 0 checklist, pending decisions, next-session prompt |
| `docs/SPEC.md` (Mongolian) | scope (§2), roles (§3), glossary (§4), user stories + acceptance criteria per module (§5), business rules (§6), quality (§7), done + cut line (§8), roadmap (§9), out of scope (§10), open questions (§11) |
| `docs/architecture.md` | pins (§0), stack (§2), repo layout + boundaries (§3), module ownership (§4), domain model (§5), API (§6), auth (§7), mobile (§8), integrations (§9), deploy (§10), observability (§11), conventions (§12), assumptions + TODO-VERIFY (§13) |
| `docs/decisions/README.md` + `ADR-*.md` | why a decision stands; before starting a module and before proposing any stack change |
| `docs/modules/<module>.md` | the module's contract (owned tables, public services, invariants, status); created with the module |
| `docs/ui.md` | before building or changing a screen: tokens, building blocks, page patterns, do/don't, test notes (ADR-0042) |
| `deploy/runbook.md`, `deploy/ebarimt-box/`, `docs/runbooks/` | deploy, rollback, restore, secret rotation, Tailscale pattern, mini-PC setup, e-Barimt / QPay outages (written from delivery 1 on) |

`CLAUDE.local.md` is gitignored and holds personal settings (local paths, tailnet addresses, preferences); it never overrides the rules in this file.
