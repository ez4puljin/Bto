# Tugeel (Түгээл) — agent contract

Tugeel is an in-house ERP for a wholesale distribution center in Ulaanbaatar: product catalog with multi-unit barcodes,
multi-warehouse stock with bins on an append-only ledger, customer orders (web, customer app, sales reps), picking,
zone-based delivery by company drivers (pre-packed orders only, no van sales), receivables with credit control, QPay
payments, mandatory e-Barimt receipts, one supermarket branch with a POS and a bank card terminal, procurement,
reporting, HR/payroll. One owner-developer builds it with Claude Code, one module per session, and maintains it alone.
Repo `tugeel`, packages `@tugeel/*`. UI is Mongolian only; code, schema, API and every document except `docs/SPEC.md` are English.

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

| Package | Version | Verified by |
|---|---|---|
| Node.js | 24 LTS (`.nvmrc`); Node 26 only in a dedicated upgrade session after it becomes LTS on 2026-10-28 | research 2026-10-09 |
| pnpm | 11.x (11.28.5); `nodeLinker: hoisted`, `minimumReleaseAge: 1440` in `pnpm-workspace.yaml`; pnpm 12 later | research 2026-10-09 |
| TypeScript | `~6.0.x`, ONE version workspace-wide (`pnpm ts:single-version` in CI); TypeScript 7 is never installed; pinned once in the pnpm `catalog:` of `pnpm-workspace.yaml`; every package uses `"typescript": "catalog:"` (ADR-0001) | research 2026-10-09 |
| NestJS | 12.1.x, CommonJS + Jest template, Express 5 adapter, class-validator DTOs, `@nestjs/swagger` + CLI plugin | research 2026-10-09 |
| Drizzle ORM / drizzle-kit | 0.45.x / 0.31.x; Drizzle 1.0 is RC and not adopted | research 2026-10-09 |
| PostgreSQL | 18 (DO Managed SGP1, UTF-8, ICU collation); `postgres:18` container locally and for staging | research 2026-10-09 |
| React | 19.3.x | research 2026-10-09 |
| Zod | 4.6.x (`packages/shared` validation, env validation) | research 2026-10-09 |
| TanStack Query | 5.104.x | research 2026-10-09 |
| shadcn/ui, Tailwind | shadcn CLI 4.21.x initialised with `-b radix`; Tailwind 4 | research 2026-10-09 |
| Expo SDK | the stable SDK at delivery-4 kickoff (57 today, 58 in beta); pinned then and recorded in `docs/modules/mobile.md` | research 2026-10-09 |
| Vite 8, React Router 7, TanStack Table 8 | major decided; exact version from `npm view <pkg> version` on day 1, written here with the date | day-1 `npm view` |
| pg-boss | major from `npm view pg-boss version` on day 1; paste its docs URL here | day-1 `npm view` |
| decimal.js, i18next + react-i18next, argon2, nestjs-pino + pino, pdfmake, ExcelJS, `@nestjs/throttler`, openapi-typescript + openapi-fetch, `@point-of-sale/receipt-printer-encoder`, html5-qrcode | exact version from `npm view` on day 1, written here with the date | day-1 `npm view` |

Pins are exact (`"x.y.z"`) in every `package.json`; only TypeScript keeps `~6.0.x`. Majors change only in dedicated sessions between deliveries.
DB pool budget (env `DB_POOL_MAX` / `PGBOSS_POOL_MAX`): production api 6, worker 3, pg-boss 2 per process; staging 2 / 2 / 2 (architecture §10.2).

## Commands (exist after delivery 1)

| Command | What it does |
|---|---|
| `pnpm install` | install the workspace (Node 24, pnpm 11) |
| `pnpm dev` | api + worker + web against the local `postgres:18` container (`docker compose up -d` first) |
| `pnpm check` | typecheck (all packages) + eslint (boundaries + guards) + prettier + `ts:single-version` + jest unit/integration + integrity suite (`--runInBand`) + vitest + `drizzle-kit check` + `gen:api` freshness + web build |
| `pnpm db:provision` | one-off per environment, run with the admin connection (`doadmin` / local `postgres`): creates roles `app` and `migrator`; required before the first `db:migrate` (architecture §5.3, §10.5) |
| `pnpm db:generate` / `pnpm db:migrate` | generate SQL from `schema.ts` (then hand-edit CHECK / EXCLUDE / REVOKE / triggers) / apply migrations as role `migrator` |
| `pnpm gen:api` | export OpenAPI and regenerate `packages/api-client`; CI fails when it is stale |
| `pnpm test:integrity` | run the integrity suite alone |

**`pnpm check` green is the definition of done.** CI runs the same command with a `postgres:18` service; nothing merges red.

## Conventions (full text in `docs/architecture.md` §6 and §12)

- Money `NUMERIC(14,2)` MNT, quantities `NUMERIC(14,3)` base units, unit costs / `avg_cost` `NUMERIC(14,4)`, factors `NUMERIC(18,6)`; Drizzle custom types `money()` / `qty()` / `cost()` (`apps/api/src/common/db/types.ts`) return `Decimal`; arithmetic only through `@tugeel/shared/money` (decimal.js, HALF_UP); unit prices whole MNT, VAT and city tax 2 decimals per line, summed into the header.
- `timestamptz` (UTC) in the DB; business dates (`effective_date`, report periods, `billIdSuffix` day, `reportMonth`) in Asia/Ulaanbaatar via dayjs + timezone; `posapi_date` stored verbatim.
- English identifiers, enum values and error codes in the DB and API; Mongolian only in `packages/shared/i18n/mn.json` and user data; `search_text` normalised in app code.
- `Idempotency-Key` header on every document-creating POST from every client; stored in `idempotency_keys`, response replayed on repeat.
- Audit rows via `AuditService.record(tx, …)` inside the service transaction; document numbers allocated at SUBMIT/POST inside that tx (drafts have no number); a POSTed document is immutable, corrections are reversing documents.
- Modules import only `modules/<other>/index.ts`; atomic cross-module writes pass the Drizzle `tx` explicitly; side effects are pg-boss jobs enqueued in the same tx; `src/integrations/**` is called only from `jobs/*.job.ts` or `*-flow.service.ts`, between transactions.
- Errors are RFC 9457 problem+json with a stable `code` and `params`; lists use keyset pagination `{ data, nextCursor }`.
- ESLint guards that must never be removed or weakened (architecture §3.1, §12): `eslint-plugin-boundaries` module boundaries; `no-restricted-imports` on `stockLedger` outside `inventory/services/stock-posting.service.ts`; `no-restricted-syntax` ban on `Number(` / `parseFloat(` in `apps/api/src/modules/**`; Cyrillic-literal ban (U+0400–U+04FF) in `**/*.tsx`; `eslint-plugin-i18next/no-literal-string` on JSX text; `src/integrations/**` importable only from `jobs/*.job.ts` and `*-flow.service.ts`; from delivery 3, `no-restricted-syntax` rejecting `fetch` / `axios` / `integrations/*` calls lexically inside `db.transaction(...)` callbacks.

## ALWAYS

- Pass `tx` explicitly through service calls that must be atomic; enqueue side effects with pg-boss in the same tx.
- Re-run the price resolver at SUBMIT and freeze prices, rates and `factor_snapshot` on the lines.
- Lock the customer row before a credit check; lock stock rows in the order documented in architecture §5.3.
- Write integration tests against real Postgres for every service that touches stock or money; keep the integrity suite green.
- Keep `docs/modules/<module>.md` current; record every new decision as an ADR (next free number in `docs/decisions/README.md`).

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
| `deploy/runbook.md`, `deploy/ebarimt-box/`, `docs/runbooks/` | deploy, rollback, restore, secret rotation, Tailscale pattern, mini-PC setup, e-Barimt / QPay outages (written from delivery 1 on) |

`CLAUDE.local.md` is gitignored and holds personal settings (local paths, tailnet addresses, preferences); it never overrides the rules in this file.
