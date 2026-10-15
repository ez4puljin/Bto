# Tugeel (Түгээл) — Architecture

Version 0.18 — 2026-10-15 (office orders: submit confirms at once while credit checks allow all, each line reserved in its product's home warehouse, `ReservationService` as built, ADR-0055; 0.17 — 2026-10-15, the price sheet import: a sixth import kind `PRICES` whose template lists every active product with its terms in force, `product_prices` locked `SHARE ROW EXCLUSIVE` for the commit, products priced from today completed by the import, a forward revert, ADR-0054; 0.16 — 2026-10-14, hand-picked product segments: `segments.kind` LIST with members in `segment_products`, `POST /segments/lists` and the routes adding and removing members, `POST /products/query/ids` for every product the list's filters keep (≤ 20,000), the product list's ticks kept across searches in `sessionStorage`, ADR-0052; 0.15 — 2026-10-14, a new `segments` module: saved AND/OR conditions over products, customers and suppliers evaluated by the data owners, lists narrowed through owner-declared resolver hooks, `POST /products/query` with a total, the product Excel export, ADR-0049; column choices per user in each browser, ADR-0050; bulk product edits in the owning modules, ADR-0051; 0.14 — 2026-10-14, one warehouse price per product, central price profiles with dated versions and whole-pack splits, quote lines in parts, `/price-profiles` and `/product-prices` instead of `/unit-prices`, ADR-0048; 0.13 — 2026-10-14, shorter document flows: a sent transfer request can be taken back for editing and keeps its number, ADR-0046; the attention counts `GET /<module>/attention` behind the home tiles, ADR-0047; 0.12 — 2026-10-13, the AI assistant: questions in Mongolian answered with read-only SQL over curated views in schema `ai`, the first integration `integrations/llm`, a third database role `ai_reader`, ADR-0045; 0.11 — 2026-10-13, product registration in one step, category code ranges, products waiting for their prices, no brands, the table order of product writers, ADR-0044; 0.10 — 2026-10-13, pricing as built: one price per list, dated unit prices, stacked discount programs, ADR-0041; 0.9 — 2026-10-13, nightly jobs and retention, ADR-0040; blind stocktakes ADR-0038 and the low-stock list ADR-0039; 0.8 — 2026-10-12, batch reads for wide lists and per-browser column choices, ADR-0037; 0.7 — 2026-10-11, transfers and imports: ADR-0035 transfers requested by the receiver with differences back to the sender, ADR-0036 import pipeline; 0.6 — 2026-10-11, inventory core: ADR-0033 receipts on their shelf and costing after posting, ADR-0034 posting protocol; 0.5 — 2026-10-11, partners: ADR-0032 product ↔ supplier link, credit fields, GPS addresses; 0.4 — 2026-10-11, catalog: ADR-0028 search keys, ADR-0029 barcode model, ADR-0030 local file storage, ADR-0031 camera scanning; 0.3 — 2026-10-10: week-1 scaffold ADR-0023 … ADR-0025, local-only development until one go-live ADR-0026) — English. Companion to `docs/SPEC.md` (Mongolian scope and business rules), `docs/decisions/` (ADRs) and `CLAUDE.md` (agent contract).

**Read §0, §4 and §12 before every session; read the module's §5 subsection before implementing it.** `TODO-VERIFY` marks business or external unknowns only (register in §13); every tooling choice in this document is decided.

Terminology: *module* = one of the 16 code modules in §4 (`identity`, `catalog`, …); *delivery* = one of the 11 roadmap steps (SPEC §9, `STATUS.md`). A delivery may build several modules, and a module may grow across several deliveries.

---

## 0. Decision summary

Tugeel is an in-house ERP for a wholesale distribution center in Ulaanbaatar: catalog, multi-warehouse stock with bins and units, customer ordering, picking, zone-based delivery with company drivers (pre-packed orders only, no van sales), receivables with credit control, QPay payments, mandatory e-Barimt receipts, one supermarket branch with a POS and a bank card terminal, procurement, reporting, an AI assistant that answers questions in Mongolian from the company's own data (ADR-0045), HR/payroll. One owner-developer builds it with Claude Code, delivery by delivery, and maintains it alone.

**The stack in one paragraph.** TypeScript end-to-end on Node.js 26 (LTS from 2026-10-28; ADR-0023), pnpm 11.x workspaces with `nodeLinker: hoisted` (no Turborepo), **one TypeScript version `~6.0.x` pinned workspace-wide** (Nest CLI 12 requires it; TypeScript 7 is never mixed in), one NestJS 12 modular-monolith API on the CommonJS + Jest template (NestJS 12 and pg-boss 12 are ESM-only packages loaded through Node `require(esm)`; workspace packages are CommonJS with a `@tugeel/source` export condition, ADR-0025) on Express 5 with class-validator DTOs + `@nestjs/swagger`, Drizzle ORM 0.45.x with hand-edited SQL migrations on PostgreSQL 18 (DigitalOcean Managed, Singapore), pg-boss for jobs and cron with transactional enqueue (no Redis), decimal.js for all money and quantity arithmetic; a Vite 8 + React 19 single-page admin (React Router 7 data mode, TanStack Query, shadcn/ui on Radix, Tailwind 4, i18next with `mn` as the only locale) that also hosts the supermarket POS screen; ONE Expo codebase built into two store apps via `APP_VARIANT` (`customer`; `staff` with warehouse / sales-rep / driver roles, Android-first, EAS internal distribution + EAS Update) on whichever Expo SDK is stable at delivery-4 kickoff; REST + OpenAPI with a generated openapi-typescript/openapi-fetch client shared by web and mobile; self-hosted JWT auth (argon2id, rotating refresh tokens, permission strings); one DigitalOcean SGP1 droplet running Docker Compose (Caddy, api, worker, plus a staging stack with its own local Postgres container), DO Spaces for files, GitHub Actions CI/CD; the mandatory e-Barimt **PosAPI 3.0 runs on a small Ubuntu mini-PC in the Ulaanbaatar office, reached only over Tailscale** (a second instance at the supermarket in delivery 9); QPay Merchant v2 as the single QR-payment rail (SocialPay is a QPay payer wallet), Khan Bank as the main bank (statement import first, corporate gateway later); keyboard-wedge barcode scanners with camera fallback; browser-printed labels first, raster ESC/POS for every receipt printer because Mongolian Cyrillic is not covered by PC866/CP1251; an AI assistant that calls OpenAI (or Anthropic, or a local Ollama) over plain `fetch` and runs the model's SQL only after the PostgreSQL 18 parser (`libpg-query`) has checked it, as the read-only role `ai_reader` over curated views (ADR-0045).

**Environments (ADR-0026).** Until the single go-live after delivery 11, the owner's machine is the only environment: `docker compose` PostgreSQL 18 + `pnpm dev`, with GitHub Actions running `pnpm check` and building both images without pushing them. The DigitalOcean hosting above is the go-live target; it is created in the go-live phase (SPEC §9.4).

### 0.1 Version pins

Left column: verified against primary sources on 2026-10-09. Right column: pinned by decision; exact versions were confirmed on 2026-10-10 and are recorded in the `CLAUDE.md` pin table (Vite 8.3.4, React Router 7.18.4, pg-boss 12.37.1, decimal.js 10.6.0, i18next 26.4.2, nestjs-pino 5.3.1, openapi-typescript 7.13.0 / openapi-fetch 0.17.0; argon2 0.45.1 was pinned with identity; pdfmake, ExcelJS, throttler and receipt-printer-encoder are pinned when first installed; TanStack Table is not used in delivery 1 (§2); the web camera fallback is `barcode-detector` 3.2.2 with `zxing-wasm` 3.1.3, ADR-0031; the AI assistant's SQL guard uses `libpg-query` 18.1.5, whose `@pgsql/types` resolves to 18.0.0, ADR-0045). Never upgrade a major inside a delivery session (§12).

| Verified pins (source-backed) | Pins to confirm on day 1 (`npm view`) |
|---|---|
| **Node.js 26** everywhere from day one (ADR-0023, superseding the Node 24 plan of ADR-0001): Active LTS from 2026-10-28, EOL 2029-04-30. Node 24 enters maintenance on 2026-10-20; Node 22 is maintenance-only (EOL 2027-04-30). | **Vite 8** (Rolldown-based; confirm vitest compatibility) |
| **TypeScript `~6.0.x`** workspace-wide. TS 7.0.2 (2026-07-08, Go compiler) ships no programmatic API; `@nestjs/cli` 12.0.8 depends on `typescript ~6.0.2` and its tsc builder fails fast without the 6.x API. Mixing 7.0.2 and 6.0.3 in one pnpm monorepo broke the swagger plugin (nest-cli #3549). Revisit only when Nest CLI ships native TS 7.1 support. | **React Router 7** (data mode) |
| **NestJS 12.1.x** (12.0.0 on 2026-08-27; 12.1.2 on 2026-09-28; Express 5.2.1 pinned by `@nestjs/platform-express`). CJS + Jest template; Standard Schema support exists but we keep class-validator DTOs for the swagger CLI plugin. | **TanStack Table**: not used in delivery 1 (decided 2026-10-11, §2); 8 or 9 is chosen when a screen first needs client-side sorting or grouping |
| **Drizzle ORM 0.45.x** (`latest` = 0.45.4, 2026-10-08) + **drizzle-kit 0.31.x** (0.31.11). Drizzle 1.0 is still RC (rc.4, 2026-06-27; rc.1 removed RQB v1 and changed the casing API) — do not adopt until `latest` points to 1.0. | **pg-boss** — pin the major that `npm view pg-boss version` reports on day 1; paste its docs URL into `CLAUDE.md` |
| **Prisma rejected**: `prisma@latest` is 8.0.0-rc.22 (re-architecture: contracts, new query API, ops.json migrations, RCs still renaming APIs); 7.10.0 is the last stable. Not a fit for a hand-tuned SQL ledger. | **decimal.js** |
| **PostgreSQL 18** (18.6 current minor; supported to 2030-11-14; `uuidv7()`, virtual generated columns, temporal constraints). PG 19 is beta; irrelevant here. | **i18next** + `react-i18next` |
| **Expo SDK**: 57 is current stable (expo 57.0.27, RN 0.86, React 19.2.3); **SDK 58** is in beta since 2026-09-15 (RN 0.88, Expo Router core rework, Strict TypeScript API). Decision: pin the stable SDK at delivery-4 kickoff, not now. | **argon2** |
| **pnpm 11.28.2** (`latest-11` dist-tag; 11.28.5 is `next-11`; requires Node 22+; installed with `npm i -g`, no corepack since Node 25; `minimumReleaseAge` 1440 min default; settings in `pnpm-workspace.yaml`). pnpm 12 (Rust rewrite, same lockfile) exists but winget/Scoop lagged at launch; adopt 12 in a later upgrade session. pnpm 10 is EOL (last release June 2026). | **nestjs-pino** + `pino` |
| **React 19.3.0** (2026-09-09; `latest`, no breaking changes). | **pdfmake** (confirm Noto Sans Cyrillic embedding) |
| **Zod 4.6.x** (4.6.5, 2026-09-13; Standard Schema). Used in `packages/shared` and for env validation. | **ExcelJS** |
| **TanStack Query 5.104.x** (5.104.1, 2026-10-02; no React v6). | **@nestjs/throttler** |
| **shadcn/ui CLI 4.21.x**; Base UI became the default base in July 2026, Radix remains supported: `npx shadcn init -b radix` (decided; no revisit). Tailwind 4 baseline. | **openapi-typescript** + **openapi-fetch** |
| **DO Managed PostgreSQL**: Standard 1 GiB $15.15, 2 GiB $30.45, 4 GiB $60.90; from 2026-10-15 (new accounts) / 2026-11-30 (all) Standard clusters cap at 4 GiB and cannot add standby nodes. Droplet 4 GiB / 2 vCPU $24. | **@point-of-sale/receipt-printer-encoder** (raster path) |
| **libpg-query 18.1.5** (2026-09-17): the PostgreSQL 18 parser compiled to WebAssembly, no install scripts; parse-tree types are imported from it (its `@pgsql/types` dependency resolves to 18.0.0, the only 18.x). The AI assistant parses every model-written query with it (ADR-0045). | **LLM providers**: no SDK; the model names live in env (`LLM_MODEL`), never in code |
| **EAS**: Free = 15+15 builds/month, EAS Update 1,000 MAU hard cap; Starter $19/mo (3,000 MAU, $0.005 per extra MAU). Budget Starter from the customer-app launch. | **barcode-detector** 3.2.2 with self-hosted `zxing-wasm` 3.1.3 (web camera fallback when `BarcodeDetector` is absent; ADR-0031) |

---

## 1. Overview, actors, diagram

One company, one database, one deployable API. The web admin and the two mobile apps are thin clients of the same REST API; no business rule lives in a client.

| Actor | Client | What they do |
|---|---|---|
| Admin / office | web admin | master data, orders, approvals, settings, reports |
| Procurement | web admin | purchase orders, receiving (delivery 8) |
| Warehouse worker | staff app (Android handheld); phone browser in delivery 1 | scan-driven receiving, put-away, picking, transfers, stocktake |
| Sales rep | staff app | visits, order taking, receivables view, payment collection (delivery 7) |
| Driver | staff app | ordered stop list, proof of delivery, cash / QR collection, returns (delivery 5). Delivers pre-packed orders only. |
| POS cashier | web admin POS screen on the supermarket PC | checkout, card/cash/QPay tender, B2C e-Barimt receipt with lottery, shift close (delivery 9) |
| Accountant | web admin | AR, payments, bank statements, e-Barimt, VAT reports |
| HR | web admin | employees, attendance, payroll (delivery 11) |
| Customer (shop or individual) | customer app | catalog with own prices, cart, orders, QR payment, tracking, balance (delivery 6) |
| External systems | — | e-Barimt PosAPI 3.0 (office mini-PC over Tailscale), QPay Merchant v2, Khan Bank statements (Excel/CSV, corporate gateway later), SMS gateway (`TODO-VERIFY` provider), Expo push |

```
 [customer app]   [staff app]   [web admin + POS screen]      TypeScript clients,
        \              |               /                       generated API client
         \             |              /   HTTPS (Caddy, Let's Encrypt)
          +------------+-------------+
                       |
        +--------------v---------------+      +------------------------+
        |  api container (NestJS 12)   |      | worker container       |
        |  HTTP, /api/v1, /health      |      | pg-boss jobs + cron    |
        +--------------+---------------+      +-----------+------------+
                       |   pool 6                          |  pool 3 (+2 pg-boss each)
            +----------v------------------------------------v-----------+
            |  DigitalOcean Managed PostgreSQL 18 (SGP1)  |  DO Spaces  |
            +----------------------------------------------------------+
                       |
   droplet host tailscaled ---- Tailscale tailnet ----> [office mini-PC, Ubuntu]
                                                         PosAPI 3.0 :7080 on tailscale0
                                                         --> api.ebarimt.mn (MN network)
                                                         (delivery 9: 2nd instance at the store)
   HTTPS --> merchant.qpay.mn ;  <-- QPay callback (/api/webhooks/qpay)
   POS PC: print agent (packages/printing) polls API over HTTPS --> Ethernet 80 mm printer :9100
```

Staging runs on the same droplet as a second Compose stack with its own local `postgres:18` container; it never touches the managed cluster. Both stacks are created in the go-live phase (ADR-0026); until then everything runs on the owner's machine (§10.1).

---

## 2. Stack with rationale

| Layer | Choice (pinned per §0.1) | Why |
|---|---|---|
| Language | TypeScript everywhere | One mental model; shared enums, validators and the pricing resolver across API, web and mobile; the largest AI training footprint. |
| Runtime | Node 26 (ADR-0023); Docker `node:26-trixie-slim`; CI `ubuntu-24.04` | LTS to 2029-04; already on the owner's machine; no upgrade session needed. |
| TypeScript | `~6.0.x` for every package, pinned once in the pnpm `catalog:` of `pnpm-workspace.yaml` (every package declares `"typescript": "catalog:"`), enforced in CI | Nest CLI 12 needs the 6.x programmatic API; one hoisted `typescript` cannot serve two majors. tsconfig written TS-7-ready: `strict`, no `baseUrl`, `moduleResolution: bundler` (web/mobile) / `nodenext` (api), explicit `rootDir`, `types`. |
| Package manager | pnpm 11.x, `devEngines.packageManager`, settings in `pnpm-workspace.yaml`, `nodeLinker: hoisted`, `minimumReleaseAge: 1440` | Hoisted linker for Expo/Metro; 24-hour release age as supply-chain protection. |
| Monorepo | pnpm workspaces only; one root `pnpm check` | No Turborepo/Nx until build time hurts. |
| Backend | NestJS 12.1.x, CJS + Jest template, Express 5 adapter, class-validator/class-transformer DTOs, `@nestjs/swagger` + CLI plugin, nestjs-pino, `@nestjs/config` with Zod-validated env, helmet, `@nestjs/throttler` | The most convention-heavy, best-documented shape; OpenAPI comes from the DTOs for free. Zod stays in `packages/shared` for pure validation and mobile forms. |
| ORM | Drizzle 0.45.x + drizzle-kit 0.31.x, `pg` driver, SQL migration files committed and hand-edited | SQL-shaped domain (`FOR UPDATE`, upserts with arithmetic, CTEs, `EXCLUDE` constraints, triggers). `drizzle-kit generate` + `migrate` only; `push` is banned (§10.5). |
| Database | PostgreSQL 18, UTF-8 with ICU collation | One datastore: also queue (pg-boss) and search (pg_trgm). `uuidv7()` where UUIDs are needed. |
| Jobs | pg-boss 12.37.1, transactional enqueue in the business tx through pg-boss's `fromDrizzle(tx, sql)` adapter (outbox), `worker.ts` entrypoint; schema installed by `db:migrate` (ADR-0024) | No Redis; jobs commit with the data that triggered them. |
| Money / quantity | `NUMERIC(14,2)` MNT, `NUMERIC(14,3)` base-unit quantities, `NUMERIC(14,4)` unit costs and `avg_cost`, `NUMERIC(18,6)` factors; Drizzle custom column types `money()`, `qty()`, `cost()` returning `Decimal` (decimal.js), HALF_UP | `Number()` never sees a NUMERIC string because the column type never yields one. |
| Web admin | Vite 8 + React 19.3, React Router 7 (data mode: `createBrowserRouter`), TanStack Query 5, shadcn/ui (`-b radix`) tables, Tailwind 4, Inter Variable and the design system of ADR-0042 (`docs/ui.md`), react-hook-form + zod, i18next (`mn`), bwip-js, dayjs + timezone, `barcode-detector` camera fallback (ADR-0031) | Internal SPA behind login; no SSR. The supermarket POS is a screen in this app. Delivery-1 lists are plain tables filtered and paged on the server (keyset, "load more"); TanStack Table (8.21.3 frozen since 2025-04, 9.x young) waits for a screen that needs client-side sorting or grouping. |
| Mobile | One Expo project, `APP_VARIANT=customer|staff`, Expo Router, EAS Build/Update, development builds only (never Expo Go), expo-camera, expo-notifications, expo-secure-store, expo-location; SDK chosen at delivery-4 kickoff | Two store listings, one auth/API/scanner/printing codebase; avoids one SDK upgrade by starting late. |
| API contract | REST/JSON `/api/v1`, OpenAPI 3 exported by script, `packages/api-client` generated with openapi-typescript + openapi-fetch; CI fails when stale | API drift becomes a compile error the agent can fix. |
| Auth | `@nestjs/jwt` behind one global fail-closed guard (ADR-0027; passport is not used), argon2id, 15-min access JWT with `sub`/`sid`/`kind` only, rotating refresh tokens hashed per device with a fixed session lifetime (setting, 12 h for staff), permission strings and write-only branch/warehouse scopes resolved per request | No vendor; immediate revocation; dormant passport packages avoided. |
| Hosting | Go-live target, created in the go-live phase (ADR-0026). DO SGP1: Basic droplet 4 GiB/2 vCPU ($24) with Docker Compose (caddy, api, worker, staging stack), Managed PostgreSQL 1 GiB ($15.15; 2 GiB $30.45 when needed), Spaces ($5), Cloudflare DNS, Tailscale (Starter plan budgeted), Sentry + UptimeRobot free tiers | Flat pricing, managed backups + PITR, ~100–150 ms from UB (measured in Week 0). App Platform rejected: cannot reach the tailnet cleanly. |
| e-Barimt host | Ubuntu amd64 mini-PC in the Ulaanbaatar office running the official PosService 3.0.12 launcher (.deb), bound to the `tailscale0` address, Tailscale ACL-restricted | PosAPI and api.ebarimt.mn are Mongolia-IP-only; PosAPI has no auth and must never be public. |
| Payments | QPay Merchant v2 behind a `PaymentProvider` interface; bank transfer + statement matching for large invoices; Khan Bank corporate gateway later | One QR covers every bank app and wallet; fee ~1%, no setup fee. |
| Printing | Browser `@page` labels + bwip-js first; raster ESC/POS everywhere Mongolian text is printed; POS receipts through a tiny print agent on the POS PC | Cyrillic code pages PC866/CP1251 lack Ө/Ү; the API in Singapore cannot open port 9100 on the store LAN. |

---

## 3. Repo layout and module boundary rules

```
tugeel/                       (repo root; packages are @tugeel/*)
  CLAUDE.md                   agent contract (<150 lines): commands, pins, ALWAYS/NEVER, pointers to docs
  README.md                   what this is, where the docs are
  package.json                scripts: check, typecheck, lint, test, test:integration, test:integrity,
                              gen:api, db:provision, db:generate, db:migrate, db:seed, ts:single-version
  pnpm-workspace.yaml         workspaces + pnpm settings (nodeLinker: hoisted, minimumReleaseAge: 1440)
                              + catalog: (typescript ~6.0.x pinned once; packages use "typescript": "catalog:")
  tsconfig.base.json  eslint.config.mjs (guards G1-G6)  .prettierrc  .editorconfig  .gitattributes (* text=auto eol=lf)
  .nvmrc (26)  .gitignore  .dockerignore
  docker-compose.yml          local: postgres:18 only on 127.0.0.1:15432 (no mailpit until an email feature exists)
  tools/lint-guards/          node:test self-test proving every ESLint guard fires (+ fixtures/)
  ci/                         compose.ci.yml + rehearse.sh: the CI check job in Linux Docker (`pnpm ci:rehearse`)
  deploy/
    docker-compose.prod.yml   caddy, api, worker
    docker-compose.staging.yml  api-staging, worker-staging, postgres-staging (local container)
    Caddyfile  .env.example  runbook.md (deploy, rollback, restore drill, rotate secrets, Tailscale pattern)
    ebarimt-box/              mini-PC checklist: Ubuntu, PosService .deb, posapi.ini, tailscale, ACL, health
    pos-agent/                install script + runbook for the POS print agent (delivery 9, ADR-0022)
  .github/workflows/          ci.yml (pnpm check + postgres:18 service); deploy.yml (GHCR -> SSH compose up) in the go-live phase
  docs/
    SPEC.md (mn)  architecture.md  STATUS.md
    decisions/README.md + ADR-0001..0022
    modules/<module>.md       per-module contract (the only per-module document): owned tables,
                              public services, invariants, status
    runbooks/                 ebarimt-outage, qpay-callback-outage, month-end, add-warehouse
  apps/
    api/                      NestJS 12 (CJS, Jest)
      src/main.ts (HTTP)   src/worker.ts (pg-boss worker; same image, ROLE=worker)
      src/common/           db/ (drizzle client, tx helper, custom types), config/, errors/ (problem+json),
                            money/ (decimal.js helpers), idempotency/, audit/, pagination/, excel/, storage/, pdf/,
                            jobs/ (pg-boss enqueue(tx, name, payload) helper, ADR-0013)
      src/db/schema.ts (aggregated Drizzle schema)  migrate.ts  provisioning.ts  provision.ts
      src/db/migrations/0000_foundation.sql …   src/db/seed/
      src/health/ (/health, worker loopback health)  src/openapi/ (document + export)
      scripts/jest.cjs (Jest with --experimental-vm-modules)  docker/ (entrypoint.sh, healthcheck.mjs)
      src/modules/<module>/ <module>.module.ts  index.ts (PUBLIC API)  schema.ts  controllers/  services/
                            dto/  jobs/  __tests__/   (no README: docs/modules/<module>.md is the contract)
      src/integrations/     llm/ (ADR-0045)  ebarimt/  qpay/  sms/  push/   (thin typed HTTP clients, no business rules)
      test/harness/         per-worker databases cloned from a migrated template (ADR-0024)
      test/integration/     *.int-spec.ts        test/integrity/   integrity suite (runInBand)
    web/                    Vite 8 + React 19 SPA: src/app, src/features/<module>, src/components/ui,
                            src/lib/{api,i18n,print,scan}
    mobile/                 Expo (created at delivery 4); app.config.ts reads APP_VARIANT;
                            app/(auth) app/(customer) app/(staff)/(warehouse|sales|driver)
  packages/
    shared/                 CommonJS build + @tugeel/source condition (ADR-0025): error codes, Decimal (money),
                            enums + state machines, unit conversion,
                            pricing resolver (pure), zod schemas, i18n/mn.json, gtin normalisation
    api-client/             generated openapi.json + types + openapi-fetch wrapper
    printing/               (delivery 5/9) raster ESC/POS pipeline, transports, agent/ (POS print agent)
  scripts/                  repo tooling: ts-single-version, gen-api-check, ci-rehearse; later one-off scripts
                            (real Excel import, rebuild-balances, backup verification)
```

### 3.1 Boundary rules (ESLint `eslint-plugin-boundaries` + `no-restricted-imports`, enforced in CI)

1. `modules/A/**` may import `modules/B/index.ts` only; never `modules/B/schema.ts` from services or controllers. Exception: `modules/A/schema.ts` may import `modules/B/schema.ts` solely for `references()`, and only in the allowed dependency direction (§4).
2. `stockLedger` (the Drizzle table symbol) may be imported only by `modules/inventory/services/stock-posting.service.ts` and the inventory test files (`no-restricted-imports` with `importNames: ['stockLedger']`); the DB `REVOKE` is the second line of defence.
3. `apps/web` and `apps/mobile` import only `@tugeel/api-client` and `@tugeel/shared`.
4. `reporting` may `SELECT` from any table; it never writes and nobody imports it. `ai` (ADR-0045) reads other modules' data only through its own views in schema `ai`, connected as the read-only role `ai_reader`; it writes only its own tables and nobody imports it.
5. Cross-module writes that must be atomic are direct service calls inside one Drizzle `tx` passed explicitly; external side effects go through pg-boss jobs enqueued in the same tx. No in-process event emitter.
6. `src/integrations/**` clients are never called with an open `tx` in scope: they are called only from `jobs/*.job.ts` or from `*-flow.service.ts` orchestrators that run between transactions (§5.9, §12); a composition root (`apps/api/src/*.module.ts`) may import an integration's Nest module to provide its client. ESLint refuses `fetch(...)` and LLM client calls inside `inTransaction(...)` / `.transaction(...)` callbacks (ADR-0045).
7. One TypeScript version: `pnpm ts:single-version` (first step of `pnpm check`) reads `pnpm-lock.yaml` at every depth and fails unless exactly one `6.0.x` resolves and every manifest uses `"typescript": "catalog:"`.

---

## 4. Modules: owns / exposes / depends on

Dependency graph (acyclic; build order follows it). Each module owns its tables, exposes an `index.ts` public API and a REST surface, and is documented in `docs/modules/<module>.md`.

```
                 identity
                /   |    \
          catalog  partners  (ebarimt)----(finance)
             \      |   \                  /   |
              inventory  pricing          /    |
                 |   \      \            /     |
              imports  \     sales -----+      |
                        \      |  \            |
                         \  delivery  procurement
                          \    |
                        notifications        hr        reporting (SELECT on all)
                                                       ai (views in schema ai, read as ai_reader)

 Arrows point from the dependency to the dependant (identity is the root).
 sales -> finance only through the CreditChecker interface (optional binding).
 finance -> sales/delivery only through snapshots passed by value, never table reads.
 ebarimt -> catalog (TaxService, attribute check) exists but is omitted from the drawing.
 partners -> catalog (product_suppliers, ADR-0032) exists but is omitted from the drawing.
 ai -> identity only in code; its views read catalog, inventory, partners and pricing (ADR-0045).
 segments -> identity, catalog, partners, inventory, pricing (ADR-0049), drawn beside imports; nobody imports it.
   It binds catalog's PRODUCT_SET_RESOLVER and partners' PARTNER_SET_RESOLVER, so lists (and later pricing,
   notifications, sales) reach segments through hooks their own module declares.
```

| Module | Owns (tables) | Exposes (`index.ts` / REST) | Depends on | Delivery |
|---|---|---|---|---|
| identity | users, roles, permissions, role_permissions, user_roles, user_scopes, auth_sessions, password_resets, branches (branch_no, district_code), warehouses (kind WHOLESALE/STORE/VEHICLE/TRANSIT, branch_id), settings (effective-dated VAT / city-tax rates), number_sequences (scope_key, period), audit_log, idempotency_keys, files, print_jobs, print_stations (delivery 9, ADR-0022) | AuthGuard (global, fail-closed) with `@Public`/`@Authenticated`/`@RequirePermission`, `@CurrentUser` → `AuthContext`, ScopeService.assertCanWriteWarehouse, UsersService, RolesService, OrgService (branches, warehouses, getTransitWarehouse, optional `WAREHOUSE_CREATED_HOOK` bound by inventory), NumberingService.next(tx, scopeKey, period), AuditService.record(tx, actor, …), IdempotencyInterceptor/`@Idempotent`, SettingsService.get(key, onDate), StorageService (createPending/verifyUploaded/confirm(tx)/markDeleted/publicUrl over `files`, migration `0002_identity_files`; local driver until go-live, ADR-0030; abandonPending/purgeDeleted for the housekeeping, `files.purged_at` in `0012_nightly_jobs`); jobs identity.housekeeping (nightly 04:30: old sessions, one-time codes and idempotency keys, abandoned uploads, the bytes of deleted files; ADR-0040), backup.pgdump (weekly, from the go-live phase: ADR-0026). REST /auth/*, /users, /roles, /branches, /warehouses, /settings, /audit, /files | — | 1 |
| catalog | categories (tree, default_classification_code, code range sku_from / sku_to; ADR-0044), uoms (system PCS/BLOCK/BOX/KG synced at boot, fractional, default measure_unit), products (sku numeric, name, search_text, search_phonetic, search_version, category_id, vat_type, city_tax NULL = undecided, classification_code NULL, tax_product_code NULL, status, sale_ready_at NULL = waiting for its prices, tracks_lots, weight_kg; brands dropped by ADR-0044), product_units (factor_to_base, is_base, is_default_sales/purchase, measure_unit NULL, superseded_by, superseded_at), product_barcodes (code, gtin14, lookup_key unique, barcode_type, is_primary, is_internal), product_images | CatalogService.get/getMany/search, UnitConversionService.toBase(unitId, qty) (returns the factor snapshot), UnitsService.supersedeInTx(tx, actor, unitId, factor) with the optional `UNIT_SUPERSEDED_HOOK` (bound by pricing), BarcodeService.lookup(code) (current units only), TaxService.rates(productId, date), CatalogRegistrationService.verifyImages/registerInTx (the catalog part of a registration), ProductLifecycleService.lockForSaleReadyInTx/markSaleReadyInTx (for pricing's completion). REST /uoms, /categories, /products (+ /products/next-sku?categoryId, /products/:id/ebarimt), /product-units, /product-barcodes, /product-images, /barcodes/:code, /catalog/ebarimt-readiness. Contract: `docs/modules/catalog.md` | identity | 1 |
| partners | customers (kind COMPANY/INDIVIDUAL, code, name + search keys, reg_no text, tin NULL, tin_source, consumer_no NULL, phone, vat_payer, city_payer, tax_status_source, credit_limit NULL = not decided, payment_term_days NULL = the setting `credit.payment_term_days`, credit_hold + reason, status), customer_addresses (address, lat/lng, gps_source, zone_id NULL — the FK to delivery_zones is added by the delivery module's migration in delivery 5, is_default, archived_at), customer_contacts, suppliers, supplier_contacts, product_suppliers (ADR-0032); customer_tiers (delivery 2, if pricing needs tiers) and customer_users (delivery 6) come later | CustomersService.get/getMany/search/assertActive/creditTerms(id, date)/lockForUpdate(tx, id) (FOR NO KEY UPDATE)/createInTx/updateInTx/setCreditInTx, CustomerAddressesService.defaultAddress/setLocationInTx, SuppliersService.get/getMany/assertActive, ProductSuppliersService.mainSupplierOf(productIds). REST /customers, /customer-addresses, /customer-contacts, /suppliers, /supplier-contacts, /product-suppliers (/auth/customer/* in delivery 6). Contract: `docs/modules/partners.md` | identity, catalog (ADR-0032) | 1 (minimal), 2 |
| inventory | bins (code = shelf label, type, sellable, pick_sequence, status ACTIVE/COUNTING, archived_at), product_locations (home warehouse, fixed bin, min/max), stock_ledger, stock_valuation_adjustments, bin_stock, warehouse_stock, stock_reservations, goods_receipts(+lines, costing status/version), bin_moves(+lines), transfers(+lines), adjustments(+lines), stocktakes(+bins, +lines), stock_snapshot_daily, stock_snapshot_bin_monthly, reconciliation_runs, lots (empty) | StockPostingService.post(tx, actor, { docs, movements }) (ONLY ledger and cache writer; ADR-0034, §5.3), StockPostingService.revalue/reconcile/rebuildBalances, SystemBinsService (bound to `WAREHOUSE_CREATED_HOOK`), BinsService, ProductLocationsService.assertMayReceive (home rule), ProductRegistrationService.register (a new product with its home, shelf and supplier in one transaction, ADR-0044), StockQueryService, ReceiptsService (+ costing, ADR-0033), BinMovesService, AdjustmentsService (+ postSystemInTx/reverseInTx for imports), TransfersService (ADR-0035), StocktakesService (blind counting per shelf, ADR-0038); later ReservationService.reserve/release/consume, AvailabilityService, ShortListQuery; jobs (ADR-0040) inventory.reconcile (nightly 03:00, REPEATABLE READ, writes stock_snapshot_daily), inventory.snapshotMonthly (03:30 on the 1st: the snapshot partitions through the migrator-owned `maintain_stock_snapshot_partitions()`, then the bin snapshot from the ledger); later inventory.staleReservations. REST /bins, /product-locations, /product-registrations, /stock, /receipts, /receipt-lines, /bin-moves, /adjustments, /adjustment-lines, /transfers, /transfer-lines, /stocktakes, /stock/low (the low-stock list, ADR-0039), /inventory/attention (the home tiles' counts, ADR-0047); later /labels, /stock/short-list. Contract: `docs/modules/inventory.md` | identity, catalog, partners (active supplier, supplier links) | 1 |
| imports | import_jobs, import_rows, import_documents | REST /imports (templates for products, customers, suppliers, opening stock and low-stock levels, create from an uploaded `.xlsx`, status, rows, commit, revert); jobs imports.validate (parse + check), imports.commit (one transaction, all or nothing), imports.revert (ADR-0036), imports.housekeeping (nightly 04:00: the rows of old refused, failed or reverted imports, sheets after a year; ADR-0040). No in-process API; calls other modules' `*InTx` services inside its own transaction. Contract: `docs/modules/imports.md` | identity (files, audit), catalog, partners, inventory; pricing later | 1 |
| pricing | price_profiles + price_profile_versions (loose, retail and retail-bulk markups, bulk threshold, rounding; dated), product_prices (per product: warehouse price per base unit, whole MNT, profile, whole unit of measure; dated) — both dated tables with EXCLUDE no overlap, a trigger that lets only `valid_to` move earlier and no DELETE (ADR-0048, migration `0019_price_profiles`, which dropped ADR-0041's `unit_prices`); discount_programs (channel WHOLESALE / RETAIL, scope PRODUCT / CATEGORY / ORDER, measure QTY / AMOUNT, effect PRICE / PERCENT / AMOUNT, dates; one PRICE program per unit and day) + discount_steps (ADR-0041, migration `0013_pricing`); customer, contract and tier lists are not used (owner 2026-10-13) | PriceProfilesService.list/get/create/rename/setVersion/archive/versionsInForce, ProductPricesService.view/currentOf/inForce/set, DiscountProgramsService.list/get/create/update/stop/remove/inForce, PriceQuoteService.quote({ list, date, lines }, executor?) → lines in parts with basis, listPrice, unitPrice, subtotal, discountAmount, total, applied programs; SaleReadinessService.complete; the pure functions `resolveQuote`, `perBasePrices`, `roundPrice`, `splitWholesale` in `@tugeel/shared/pricing`; `PricingUnitsHook` bound to catalog's `UNIT_SUPERSEDED_HOOK`. REST /price-profiles, /product-prices, /product-prices/current, /discount-programs, /pricing/quote, /pricing/sale-ready, /pricing/attention (products waiting for prices, ADR-0047). Contract: `docs/modules/pricing.md` | identity, catalog (partners not needed while every customer pays one price) | 2 |
| sales | sales_orders, sales_order_lines (frozen prices + factor snapshot, qty_base, qty_approved, qty_backordered, qty_picked, qty_delivered), order_status_events, order_approvals, pickings(+lines), packages, pos_sessions, pos_sales(+lines), sales_returns(+lines), rep_visits | OrdersService.create/submit/approve/confirm/cancel/markDispatched/markDelivered/markDeliveryFailed, PickingService.createWave/confirmPick/pack, PosService.openSession/checkout/closeSession, OrderQueries.forDelivery; defines `CreditChecker` interface with `AllowAllCreditChecker` default. REST /orders, /pickings, /pos/*, /me/orders, /rep/* | identity, catalog, partners, pricing, inventory; finance via CreditChecker (optional); ebarimt (POS path) | 2 (POS: 9) |
| finance | invoices(+lines, open_amount), credit_notes, ar_entries (append-only), customer_balances (cache), payments (tender_data jsonb), payment_allocations, payment_intents, cash_registers, cash_sessions, bank_accounts, bank_statements(+lines), recon_matches, credit_holds, tax_periods, supplier_bills, supplier_payments | ArService.checkCredit(tx, customerId, amount) (implements sales.CreditChecker), InvoicingService.createFromSnapshot(tx, snapshot), PaymentsService.record/allocate, QrPaymentService.createIntent/verify/sweep, BankReconService, CustomerBalanceService; jobs qpay.check, qpay.sweep. REST /invoices, /payments, /customers/:id/ledger, /payment-intents, /webhooks/qpay, /bank/*, /reports/finance/* | identity, partners, ebarimt; receives snapshots from sales/delivery, never reads their tables | 3 (QPay 5, bank recon 10) |
| ebarimt | ebarimt_receipts, ebarimt_submission_log, ebarimt_config (one row per PosAPI instance, encrypted) | EbarimtService.prepare(tx, snapshot) → receiptId (PENDING row), issue(receiptId) (HTTP, outside tx), void(receiptId), status(receiptId), lookupTin(regNo), lookupInfo(tin); `ReceiptProvider` interface (PosApiProvider default; fallback provider by config); jobs ebarimt.issue, ebarimt.sendData (nightly), ebarimt.monitor (5 min), ebarimt.refreshReference (nightly). REST /ebarimt/* | identity, catalog (TaxService, attribute check); integrations/ebarimt over Tailscale | 3 (spike in Week 0/1) |
| delivery | delivery_zones (an address carries its zone in partners `customer_addresses.zone_id`; delivery adds the FK by hand in its migration and assigns zones through a partners service), vehicles (→ VEHICLE warehouse), trips, trip_stops, proof_of_delivery, delivery_exceptions, delivery_returns(+lines) | TripsService.plan/load/close, DriverService.myTrip/deliver/fail/collect, ZoneService.zoneForAddress. Calls inventory (STAGING→CARGO, CARGO→customer, CARGO→RETURNS), sales.markDispatched/markDelivered/markDeliveryFailed, finance.PaymentsService.record. REST /zones, /trips, /driver/* | identity, partners, sales, inventory, finance, notifications | 5 |
| procurement | purchase_orders(+lines), supplier_prices, reorder_rules | PurchaseOrdersService.create/approve/receive (→ inventory.ReceiptsService with PO ref), ReorderService.suggest. REST /purchase-orders | identity, partners, catalog, inventory, finance (bills) | 8 |
| notifications | push_tokens, templates, notification_log, sms_log | NotificationsService.push/sms/registerToken; jobs notifications.push, notifications.sms. REST /me/devices, /me/notifications | identity, partners | 5–6 |
| hr | employees, departments, positions, employee_contracts, attendance, leave_requests, payroll_periods, payroll_runs, payslips(+lines), ndsh_rate_tables, pit_bracket_tables (effective-dated) | EmployeesService.byUser, AttendanceService, PayrollService.run/getPayslip. REST /employees, /attendance, /payroll-runs, /payslips | identity (read-only views of sales/delivery for commissions) | 11 |
| reporting | SQL views + materialized views only (v_stock_valuation, v_short_reservations, mv_sales_daily, mv_ar_aging, …), report_definitions | ReportService.run(code, filters) with Excel export; job reporting.refresh. REST /reports/* | SELECT on all; never writes; never imported | grows per delivery; hardened in 10 |
| segments | segments (entity PRODUCT / CUSTOMER / SUPPLIER, kind RULES / LIST, name + name_key unique among live ones per entity, description, definition jsonb: AND/OR groups of conditions (NULL for a LIST), definition_version, archived_at; no DELETE; ADR-0049, ADR-0052), segment_products (the members of a LIST segment: segment, product, added_at; inserted and deleted, no UPDATE; ADR-0052) | No in-process API (nobody imports it). `SegmentEvaluator` (each leaf condition answered by its data owner's `index.ts` as an id set, combined by set algebra) bound to catalog's `PRODUCT_SET_RESOLVER` and partners' `PARTNER_SET_RESOLVER`; `ProductExportService`. REST /segments (list, counts, get, preview, create, update, archive; `lists`, `:id/products`, `:id/products/remove` for LIST segments), /exports/products. Contract: `docs/modules/segments.md` | identity, catalog, partners, inventory, pricing | 2 |
| ai | ai_conversations, ai_questions (append-only: who, when, question, SQL, status, counts, tokens; never result rows), ai_reports (soft delete); schema `ai` with read-only views over other modules' tables (§5.11, ADR-0045) | No in-process API (nobody imports it). AskFlowService (the question flow, between transactions), AiReaderService (the read-only executor on its own pool as `ai_reader`), `sqlGuard` (libpg-query), `AI_DATASETS` (the semantic catalog). REST /ai/status, /ai/questions (+ /:id/run, /:id/export), /ai/conversations, /ai/reports (+ /:id/run, /:id/export). Contract: `docs/modules/ai.md` | identity; `integrations/llm`; reads catalog, inventory, partners and pricing through its views only (sales and finance add views when built) | 2 (foundation, grows per delivery) |

**Infrastructure outside the 16 modules** (delivery 1, week 1): `src/common/{config,db,errors,jobs,logging}`, `src/health` (`GET /health` for the api, a loopback-only `127.0.0.1:${WORKER_HEALTH_PORT}/health` in the worker for the container healthcheck), `src/openapi`, `src/db` (schema aggregator, `migrate.ts`, `provisioning.ts`, `provision.ts`), and the infrastructure job `system.ping` (proves api enqueue → worker handling).

**Job registry.** The `jobs <module>.<verb>` entries in the "Exposes" column are the canonical pg-boss job registry (ADR-0013 #4): a new job name is added to its owning row before the handler is written in `src/modules/<module>/jobs/`.

**CreditChecker stub pattern.** `sales` declares `interface CreditChecker { check(tx, customerId, exposureDeltaMnt): Promise<'OK'|'NEEDS_APPROVAL'|'BLOCKED'> }` and binds `AllowAllCreditChecker` by default. Delivery 3 rebinds the token to `finance.ArService` in `AppModule`; `sales` never imports `finance`. The same pattern applies to `ReceiptProvider` in ebarimt (§5.9) and `PaymentProvider` in finance (§5.8).

---

## 5. Domain model

### 5.1 Organisation, warehouses, bins

- `branches` (wholesale HQ, supermarket) carry e-Barimt `branch_no` (3 digits) and `district_code` (4 digits). Each POS instance carries `pos_no` (PosAPI-assigned, 8 digits) in `ebarimt_config`; each warehouse references its branch.
- `warehouses.kind`: WHOLESALE, STORE (supermarket), VEHICLE (one per delivery vehicle), TRANSIT (exactly one system warehouse).
- Bin types and the `sellable` flag:

| Bin type | Sellable | Created automatically for | Purpose |
|---|---|---|---|
| RECEIVING | no | every warehouse | receipt lines without a fixed shelf land here (ADR-0033) |
| STORAGE | yes | — (user-created) | shelf locations |
| PICKING | yes | — (user-created) | forward pick faces |
| STAGING | no | every warehouse | picked/packed orders awaiting load |
| SHIP | no | every warehouse | loading dock |
| DAMAGED | no | every warehouse | quarantined stock |
| RETURNS | no | every warehouse | returned goods awaiting inspection |
| SALESFLOOR | yes | STORE warehouses | supermarket shelf; POS sales issue from here |
| CARGO | no | VEHICLE warehouses | goods loaded on the truck (D14) |
| TRANSIT | no | the TRANSIT warehouse | in-transit stock between warehouses |

- `bins.status`: ACTIVE or COUNTING. A stocktake sets the counted bins to COUNTING at freeze time; `StockPostingService` rejects any movement touching a COUNTING bin with `BIN_LOCKED_FOR_COUNT` (409); approval or cancellation of the stocktake returns them to ACTIVE in the same tx (D3). The integrity suite covers "posting into a COUNTING bin fails".
- `bins.code` is the text of the shelf label (`A-01-03`: row letter, rack, level), unique per warehouse and normalised before every lookup (NFKC, no spaces, upper case, dash variants and Cyrillic look-alikes → Latin). System bins are created in the warehouse's creating transaction through identity's `WAREHOUSE_CREATED_HOOK` (and backfilled at boot); shelves are created one at a time or as a range with a preview; a used bin is archived, an unused one may be deleted.
- `product_locations` (warehouse, product, home flag, fixed bin, min/max level): one home warehouse per product — the only WHOLESALE warehouse it is received into (ADR-0033) — and the fixed shelf that receipt lines default to; min/max drive the low-stock list (with the empty balances of a warehouse, ADR-0039) and come from the product page or the `LEVELS` import.

### 5.2 Catalog and units

- Exactly one base unit per product (usually piece, "ш"; kilogram for goods sold by weight, with up to 3 decimals). `product_units` rows (block = 6, box = 24) carry `factor_to_base NUMERIC(18,6)`, their own barcodes, `is_default_sales` / `is_default_purchase` and e-Barimt `measure_unit` (NULL = the unit of measure's default). Factors are never edited; a change supersedes the row, and a unit no longer used is retired (`superseded_at` without a successor). Contract: `docs/modules/catalog.md`.
- **Supersede is one service** (D7): `UnitsService.supersedeInTx(tx, actor, unitId, newFactor)` sets `superseded_at` on the old row and clears its flags, inserts the new unit row, sets `superseded_by`, re-points the barcodes, moves the `is_default_*` flags and calls the optional `UNIT_SUPERSEDED_HOOK`, which pricing binds to stop the old unit's discount programs (ADR-0041 #6; a product's whole unit is a unit of measure and follows the new unit by itself, ADR-0048) — all in one tx (catalog never imports pricing). Barcode lookups ignore superseded units. Integrity test: "supersede keeps barcodes and default flags" (the price part joins in delivery 2).
- **e-Barimt attributes are nullable in delivery 1** (M1): `classification_code` (7-digit БҮНА), `tax_product_code` (3-digit, required for VAT_FREE/VAT_ZERO), `measure_unit`, and `city_tax` (NULL until the accountant answers SPEC §11 #3a). They are required only when a receipt line is built (§5.9), never by the catalog import. `/catalog/ebarimt-readiness` counts and lists products missing them and assigns values by category subtree, filling only empty ones (count first, then apply); a per-barcode lookup through the mini-PC joins in delivery 3. The cleanup is budgeted into delivery 3, not delivery 1.
- `vat_type` (VAT_ABLE/VAT_FREE/VAT_ZERO/NO_VAT) and the `city_tax` flag live on the product; the rates come from effective-dated settings through `TaxService.rates(productId, date)`, which refuses an undecided city tax (`TAX_ATTRIBUTES_MISSING`).
- **Barcode normalisation** (M11, ADR-0029): `@tugeel/shared/gtin` expands UPC-E to UPC-A, pads UPC-A/EAN-8/EAN-13 to a canonical 14-digit `gtin14`, validates the check digit, and leaves non-GTIN codes (Code 128 internal labels) untouched. `product_barcodes` stores `code` as printed, `gtin14`, `barcode_type` (GS1/ISBN/UNDEFINED) and `lookup_key = coalesce(gtin14, upper(code))`, unique across the table; a scanned 8-digit code may be EAN-8 or UPC-E, and one matching two products answers `BARCODE_AMBIGUOUS`. Products without a barcode get an internal EAN-13 starting with 20.
- `search_text` (NFKC + lower + Latin look-alikes mapped to Cyrillic) and `search_phonetic` (romanised, so "Coca" finds "Кока") are built in app code (`@tugeel/shared/text`, ADR-0028) and indexed with pg_trgm; search never depends on DB collation alone (M17).
- Every document line stores `entered_qty`, `product_unit_id`, `factor_snapshot` and derived `qty_base NUMERIC(14,3)`. Ledger and balances are base units only.
- **Registration and code ranges** (ADR-0044). A category may own a range of codes (`sku_from` / `sku_to`, `NUMERIC(20,0)`); ranges nest only down the tree, a category without one uses its nearest ancestor's, and a code belongs to the innermost range around it (`@tugeel/shared/catalog`). `GET /products/next-sku?categoryId` suggests past the largest code of the range, skipping subcategories' blocks; typed codes outside the range are refused except in imports. A product is registered in one transaction by inventory's `ProductRegistrationService` (catalog part, home and shelf, supplier link) and waits for its prices (`sale_ready_at` NULL) until pricing completes it with a warehouse price and a price profile in force today (ADR-0048); orders take only complete products. The e-Barimt fields are the accountant's card (`PATCH /products/:id/ebarimt`). Brands do not exist.

### 5.3 Stock ledger and posting rules

`stock_ledger` (bigint identity, posted_at timestamptz, effective_date date, warehouse_id, bin_id, product_id, lot_id bigint NULL, qty_base signed `CHECK (qty_base <> 0)`, unit_cost NUMERIC(14,4) NOT NULL (custom type `cost()`), movement_type, doc_type NOT NULL, doc_id NOT NULL, doc_line_id NOT NULL, leg smallint, entered_qty, product_unit_id, factor_snapshot, created_by).

**Movement types and legs.** Every pair-movement is posted as two ledger rows with `leg` 1 (out) and 2 (in) under the same `doc_line_id`; single movements use `leg` 1.

| Movement type | Document | Legs | Sign | Typical bins |
|---|---|---|---|---|
| RECEIPT | GR- | 1 | + | the line's bin: the fixed shelf, else RECEIVING (ADR-0033) |
| PUTAWAY_OUT / PUTAWAY_IN | BM- | 1 / 2 | − / + | RECEIVING → STORAGE/PICKING |
| BIN_MOVE_OUT / BIN_MOVE_IN | BM- | 1 / 2 | − / + | any → any within one warehouse (incl. → DAMAGED) |
| PICK_OUT / PICK_IN | PK- | 1 / 2 | − / + | STORAGE/PICKING → STAGING (reservation consumed) |
| DISPATCH_OUT / DISPATCH_IN | TRIP- | 1 / 2 | − / + | STAGING/SHIP → CARGO (vehicle warehouse) |
| DELIVERY_ISSUE | TRIP- (stop) or SO- (pickup) | 1 | − | CARGO or STAGING |
| POS_SALE | POS- | 1 | − | SALESFLOOR |
| TRANSFER_OUT / TRANSFER_IN | TR- | ship 1 / 2, receive 3 / 4, corrections 5 / 6 | − / + | source → TRANSIT; TRANSIT → destination (SALESFLOOR at the store, else the fixed shelf or RECEIVING); a shortfall back into the source bin, a surplus out of it (ADR-0035) |
| RETURN_IN | TRIP- (return) or CN- | 1 | + | CARGO or RETURNS |
| ADJUSTMENT | ADJ- | 1 | ± | any (reason code required; opening stock) |
| COUNT_CORRECTION | ST- | 1 | ± | counted bins |

**Guards.**
- Append-only: `REVOKE UPDATE, DELETE ON stock_ledger FROM app;` plus a `BEFORE UPDATE OR DELETE` trigger that raises. Two DB roles: `app` (runtime) and `migrator` (migrations only). A guard test in the integrity suite performs an `UPDATE stock_ledger` as role `app` and asserts it fails (F9); if the trigger or REVOKE is ever lost, CI goes red.
- Idempotency: `UNIQUE (doc_type, doc_line_id, movement_type, leg)`; `doc_type` + `doc_line_id` are NOT NULL, so no movement exists without a document (D5).
- Every stock movement belongs to a document with a status machine; put-away and storage↔storage moves use `bin_moves` (code `BM-`), so a web double-submit or a mobile retry cannot post a move twice.

Roles `app` and `migrator` are created once per environment by `pnpm db:provision` (`apps/api/src/db/provision.ts`; `node dist/db/provision.js` in the image), run with the admin connection (DigitalOcean `doadmin`; local and staging `postgres`) and documented in `deploy/runbook.md`; migrations run as `migrator`, and a migration cannot create the role it runs as (on Managed PostgreSQL only the admin user may create roles). The foundation migration `0000_foundation.sql` (ADR-0024) creates the extensions, `assert_unicode_casefold()`, the generic trigger function `forbid_update_delete()` (SQLSTATE 23001) and `ALTER DEFAULT PRIVILEGES FOR ROLE migrator … TO app` (DML on tables, USAGE/SELECT on sequences); it never creates a role or a business table. As built (week 3): `0005_inventory` holds the generated tables with hand-added CHECKs, the `bins_fixed_columns` trigger and the REVOKEs; the ledger, the valuation history and the snapshot tables are hand-written in `0006_inventory_ledger` (`--custom`, ADR-0034 #6), whose essence is:

```sql
-- privileges: default privileges already give app DML on every table migrator creates
REVOKE UPDATE, DELETE ON stock_ledger FROM app;

-- append-only triggers (second line of defence, also protect the migrator; function from 0000_foundation)
CREATE TRIGGER stock_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER stock_ledger_no_truncate
  BEFORE TRUNCATE ON stock_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();

-- idempotency and document linkage
ALTER TABLE stock_ledger
  ALTER COLUMN doc_type SET NOT NULL,
  ALTER COLUMN doc_line_id SET NOT NULL,
  ADD CONSTRAINT stock_ledger_qty_nonzero CHECK (qty_base <> 0);
CREATE UNIQUE INDEX stock_ledger_idem
  ON stock_ledger (doc_type, doc_line_id, movement_type, leg);

-- balance caches
ALTER TABLE bin_stock ADD CONSTRAINT bin_stock_nonneg CHECK (on_hand >= 0);
ALTER TABLE warehouse_stock ADD CONSTRAINT warehouse_stock_nonneg
  CHECK (on_hand >= 0 AND reserved >= 0);          -- no reserved <= sellable here (D2)
CREATE UNIQUE INDEX bin_stock_key
  ON bin_stock (warehouse_id, bin_id, product_id, lot_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX warehouse_stock_key
  ON warehouse_stock (warehouse_id, product_id, lot_id) NULLS NOT DISTINCT;

-- snapshots partitioned by month from day one (D9)
CREATE TABLE stock_snapshot_daily (
  snapshot_date date NOT NULL, warehouse_id bigint NOT NULL, product_id bigint NOT NULL,
  lot_id bigint, on_hand numeric(14,3) NOT NULL, sellable_on_hand numeric(14,3) NOT NULL,
  reserved numeric(14,3) NOT NULL, avg_cost numeric(14,4) NOT NULL
) PARTITION BY RANGE (snapshot_date);
```

**Document status machines.** All stock documents share one shape; `post()` is the only transition that writes the ledger.

| Document | States | Notes |
|---|---|---|
| goods_receipts (GR-) | DRAFT → POSTED; DRAFT → CANCELLED | number allocated at POST; then `costing_status` PENDING → COSTED by the accountant, re-costed with a new `costing_version` (ADR-0033) |
| bin_moves (BM-) | DRAFT → POSTED | created and posted in one request from the scanner flow |
| transfers (TR-) | REQUEST: DRAFT → REQUESTED → SHIPPED → RECEIVED; PUSH: DRAFT → SHIPPED → RECEIVED; DRAFT/REQUESTED → CANCELLED; REQUESTED → DRAFT when the destination takes the request back (ADR-0046) | numbered at REQUESTED (PUSH: at SHIPPED); a request taken back keeps its number and is sent again under it; SHIPPED posts legs 1/2; RECEIVED posts legs 3/4 and the corrections 5/6, all in base units (ADR-0035) |
| adjustments (ADJ-) | DRAFT → SUBMITTED → POSTED; SUBMITTED → DRAFT (returned); DRAFT/SUBMITTED → CANCELLED | warehouse staff submit, an approver posts (owner, 2026-10-11); the reason fixes the sign; unit_cost on inbound lines; the system reasons OPENING and OPENING_REVERSAL post DRAFT → POSTED inside an import (ADR-0036) |
| stocktakes (ST-) | DRAFT → COUNTING ⇄ REVIEW → APPROVED; → CANCELLED | COUNTING sets `bins.status`; counters count blind and finish each shelf, an approver may send shelves back to COUNTING (ADR-0038); APPROVED posts COUNT_CORRECTION and restores ACTIVE |
| pickings (PK-) | DRAFT → IN_PROGRESS → CONFIRMED | CONFIRMED posts PICK pairs with reservation consume |

**Balance caches** (updated in the same tx as the ledger rows):
- `bin_stock` (warehouse, bin, product, lot) with `on_hand CHECK (on_hand >= 0)`.
- `warehouse_stock` (warehouse, product, lot) with `on_hand`, `sellable_on_hand`, `reserved`, `avg_cost NUMERIC(14,4)`; `CHECK (on_hand >= 0 AND reserved >= 0)` **only** (D2). `reserved <= sellable_on_hand` is enforced by `ReservationService.reserve` under the row lock, not by a table constraint, so a shortage posting never fails on a constraint. `available = sellable_on_hand - reserved`. Unique indexes use `NULLS NOT DISTINCT` on `lot_id`.

**`StockPostingService.post(tx, actor, { docs: [{ docType, docId, expectedStatus, nextStatus }], movements })`** (ADR-0034; `options.reservationConsume` joins with pickings in delivery 2) is the only code path that inserts ledger rows or touches the caches; every stock document uses it. Any number of documents per call (a transfer receive and its shortfall adjustment), zero movements allowed (a count without differences). Its steps, in order, as built in week 3:

```
post(tx, actor, { docs, movements }):
  1. validate: every movement belongs to one of the docs; qty_base <> 0; entered_qty > 0,
     product_unit_id and factor_snapshot present; the movement type's sign and leg
  2. headers (sorted by doc type, id): SELECT status ... FOR UPDATE (callers already hold it);
     status = next -> 409 DOC_ALREADY_POSTED, other than expected -> 409 DOC_STATE_INVALID
  3. bins: SELECT ... WHERE id IN (...) ORDER BY id FOR SHARE
     -- COUNTING -> 409 BIN_LOCKED_FOR_COUNT, archived -> 409 BIN_ARCHIVED
  4. missing cache rows, inbound keys only: one sorted INSERT ... ON CONFLICT DO NOTHING
  5. lock: warehouse_stock then bin_stock FOR UPDATE, keys joined from a VALUES list with
     IS NOT DISTINCT FROM (NULL lots), ordered by the key
  6. deltas summed per key; any bin below zero -> 409 STOCK_INSUFFICIENT
     (params binCode, available, requested; a missing outbound row counts as zero)
  7. cost rules (table below) movement by movement, outbound legs first within a line
  8. INSERT stock_ledger rows (stock_ledger_idem rejects a re-post -> 409 ALREADY_POSTED)
  9. UPDATE warehouse_stock / bin_stock, one statement per row
 10. per document: number (NumberingService, last), status, posted_at, effective_date, posted_by
     -- one now() per posting gives posted_at, the Ulaanbaatar effective date and the number's year
```

READ COMMITTED, deterministic lock order, no retries. No negative stock, no exceptions: shortages are explicit adjustment documents.

**Product writers** (ADR-0044 #5): a registration, the product import and its revert take products first (several by id: `CatalogImportService.lockManyInTx`, pricing's completion likewise), then `product_locations`, then `product_suppliers`; the bulk paths lock those two tables (`SHARE ROW EXCLUSIVE`) in that order, single changes take per-product advisory locks. Integrity test `registration-races` holds a registration between its location and its supplier link while a revert runs. A list segment's members (`segment_products`, ADR-0052) reference products, so inserting them takes `FOR KEY SHARE` on each product: they are inserted in one statement in ascending id order, after the segment row's `FOR UPDATE`, and never wait on a product writer out of order.

**Reservations** (`stock_reservations`, warehouse-level; doc_type/doc_line_id, qty_base, status ACTIVE/CONSUMED/RELEASED; partial UNIQUE on active):
- **As built (ADR-0055):** `ReservationService.reserveInTx(tx, actor, { docType, docId, lines })` locks the lines' `warehouse_stock` rows (lot NULL) in (warehouse, product) order, reserves per line in line order and returns the reserved and backordered quantity of each; `releaseInTx(tx, actor, docType, docId)` releases a document's ACTIVE reservations; `availableOf(productIds)` reads available stock per warehouse.
- Created at order CONFIRM: `reserve()` locks the `warehouse_stock` row and never reserves more than `sellable_on_hand - reserved`. Backorder policy is `TODO-VERIFY` (§13 T9); default until decided (SPEC §11 #9, §6.4 #4): confirm the available quantity (`qty_approved`), write the shortfall to the line's `qty_backordered`, same rule for every tier. A line with nothing available is fully backordered and the order still confirms; the response lists the backordered lines so the office and the customer see them at once.
- After a shortage posting (negative COUNT_CORRECTION, STORAGE → DAMAGED move, store transfer-out) `reserved` may exceed `sellable_on_hand`. The posting succeeds; the affected CONFIRMED orders appear in `/stock/short-list` (view `v_short_reservations`) and are flagged for re-planning.
- **Pick posting is a single UPDATE** (D2): `post()` accepts `options.reservationConsume`, which applies to the PICK_OUT movements, and runs `sellable_on_hand = sellable_on_hand - q, reserved = reserved - q` in one statement, so no intermediate state exists. Short-pick: `qty_picked < qty_base` consumes `qty_picked` and RELEASES the remainder in the same tx (D4).
- Nightly job `inventory.staleReservations`: ACTIVE reservations whose order is not in CONFIRMED/PICKING are released and reported.
- Integrity test: "`reserve()` never oversells under concurrency" (two concurrent confirmations for the last 10 boxes: one gets them, the other is backordered), replacing any static `reserved <= sellable` assertion.

**Cost rules per inbound movement type** (D8):

| Movement (positive leg) | unit_cost on the ledger row | avg_cost effect |
|---|---|---|
| RECEIPT (goods receipt, with or without PO) | the warehouse's current `avg_cost` (provisional, ADR-0033); the accountant's costing later records the supplier amount ex-VAT per line (bonus goods 0) in `stock_valuation_adjustments` | none at posting; the costing moves the average by the share still on hand: absorbed = Δ × min(Q, on_hand) / Q, `avg += absorbed / on_hand`, the rest is a variance |
| TRANSFER_IN, DISPATCH_IN, RETURN_IN, PICK_IN, PUTAWAY_IN, BIN_MOVE_IN | the source row's `avg_cost` at posting time | none at warehouse level for intra-warehouse moves; destination warehouse re-averages with the carried cost on TRANSFER_IN / RETURN_IN |
| ADJUSTMENT (+), COUNT_CORRECTION (+) | explicit `unit_cost` required (default = current `avg_cost`; opening-stock Excel has a mandatory cost column) | re-averages |
| any negative leg | current `avg_cost` | none |

The supermarket (STORE) therefore carries real cost from day one even though it only receives transfers, and opening stock is valued from the import.

**Snapshots** (D9): `stock_snapshot_daily` at warehouse level (non-zero rows only, written by the nightly reconciliation in the same tx) and `stock_snapshot_bin_monthly` at bin level, both `PARTITION BY RANGE (snapshot_date)` by month from the inventory module's first migration. The monthly job `inventory.snapshotMonthly` (ADR-0040) keeps the partitions from this month to 24 months ahead through `maintain_stock_snapshot_partitions()` (SECURITY DEFINER, owned by `migrator`, executable by `app` alone; `app` cannot create tables), drops those more than 13 months back, then writes the month's bin snapshot: every bin's ledger sum of the movements dated before the 1st, exact however late it runs (a rerun rewrites the month, an emptied bin as 0). As-of bin stock = last monthly snapshot + ledger delta.

**Reconciliation** (D10): `StockPostingService.reconcile` compares the ledger sums with both caches (bin, warehouse, sellable) and writes the day's snapshot inside one `REPEATABLE READ` transaction, so both sides see the same snapshot; every run writes `reconciliation_runs` (OK or DRIFT with the first 100 differences) and a drift shows a red admin banner (Sentry with the nightly job). `pnpm inventory:reconcile` runs it by hand (exit 2 on drift); `pnpm inventory:rebuild-balances` recomputes the cache quantities from the ledger under `LOCK TABLE … IN EXCLUSIVE MODE`, keeping the averages. The pg-boss job `inventory.reconcile` runs it every night at 03:00 Ulaanbaatar time (`NIGHTLY`; a night the worker was down is made up once when it starts, ADR-0040).

**Flows.** Receipt → the line's bin (GR-; the fixed shelf, else RECEIVING); put-away = `bin_moves` BM- with PUTAWAY_OUT/IN; storage↔storage = BM- with BIN_MOVE_OUT/IN; transfer (TR-) = TRANSFER_OUT source + TRANSFER_IN TRANSIT on ship, then TRANSFER_OUT TRANSIT for the **full shipped qty** + TRANSFER_IN destination for what arrived; a shortfall goes back into the source bin and a surplus leaves it for the destination (legs 5/6), so TRANSIT returns to zero per line (D14, ADR-0035); pick (PK-) = PICK_OUT storage + PICK_IN STAGING with reservation consume; trip load = DISPATCH_OUT STAGING/SHIP + DISPATCH_IN CARGO of the VEHICLE warehouse; delivery confirm = DELIVERY_ISSUE from CARGO; failed stop stays on CARGO; trip close moves leftovers CARGO → RETURNS of the home warehouse; pickup handover = DELIVERY_ISSUE from STAGING; POS checkout = POS_SALE from SALESFLOOR; stocktake (ST-) freezes expected qty per (bin, product), sets bins COUNTING, counts, posts COUNT_CORRECTION, returns bins to ACTIVE. Opening stock = Excel import → one OPENING adjustment (ADJ-) per warehouse, cost optional (0 when empty), unshelved goods onto the warehouse's NOSHELF storage bin (ADR-0036); a revert posts OPENING_REVERSAL.

**Document numbering** (D11, D14, F11): `number_sequences (scope_key, period, last_value)` with a row lock; `NumberingService.next(tx, scopeKey, period)` returns the next value. Document codes: `SO-2026-000123` (scope `SO`, period `2026`), `GR-`, `BM-`, `TR-`, `ADJ-`, `ST-`, `PK-`, `PO-`, `INV-`, `CN-`, `PAY-`, `TRIP-`. Numbers are allocated at SUBMIT (orders) or POST (stock documents, invoices) inside the posting tx; DRAFTs carry only their bigint id, so abandoned drafts never create gaps; the one exception is a transfer request taken back for editing, which keeps its number (ADR-0046). e-Barimt `billIdSuffix` uses scope `BILLID:<pos_no>` with period = the Ulaanbaatar calendar date (§5.9).

**Lots**: `lots` table and nullable `lot_id` on ledger, balances, reservations and lines exist from the inventory module's first migration; enabling = `product.tracks_lots`, require lot on receipt, FEFO bin choice. No backfill.

### 5.4 Pricing

As built in delivery 2 (ADR-0041, after the owner's interview of 2026-10-13; it replaces the list precedence and the single-discount rule of ADR-0009), with the warehouse price and price profiles of ADR-0048 (owner 2026-10-14). Contract: `docs/modules/pricing.md`.

- **Two channels, one price for everyone.** Prices live only in pricing (no price columns on products). The channel of a quote and of a discount program:
  - `WHOLESALE`: every channel but the supermarket;
  - `RETAIL`: the supermarket; the POS uses it from delivery 9.

  Every customer pays the same price: there are no customer, contract or tier lists.
- **Warehouse price and price profile** (ADR-0048).
  - **Product price terms.** `product_prices` holds dated rows of `warehouse_price`, `profile_id` and `whole_uom_id`:
    - the warehouse price is per base unit, whole MNT, VAT included (SPEC §6.1 #1 until the accountant answers);
    - the whole unit is a unit of measure, resolved to the product's current unit of it; it is null for a product without packs.
  - **Price profiles.** `price_profiles` + dated `price_profile_versions` hold:
    - `loose_markup_pct` and `retail_markup_pct`;
    - an optional `retail_bulk_min_qty` with `retail_bulk_markup_pct`;
    - `rounding` (`WHOLE` HALF_UP, `UP_10`, `UP_50`, `UP_100`).
  - **Derived per-base prices** (`@tugeel/shared/pricing`): loose, retail and retail bulk, each W × (1 + %) rounded as the profile says. A unit's price is the per-base price × factor, HALF_UP to whole MNT.
  - **A change from day D** (today or later), for terms and profile versions alike: the service closes the row in force on D (`valid_to = D`) and inserts the new one up to that row's old end, or up to the next planned row (`planChange`). A row replaced on its first day is voided (`valid_to = valid_from`).
  - **Database guards:**
    - `EXCLUDE USING gist (product_id | profile_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&)`;
    - trigger `pricing_dated_row_guard`: only `valid_to` changes, only earlier (23001, even for the migrator);
    - `REVOKE DELETE, TRUNCATE` from app on the three tables;
    - serialisation: the advisory lock `(72_030_002, product)` for a product's terms, then its profile row `FOR SHARE`; a profile's own changes and its archive lock that row `FOR UPDATE`;
    - the price sheet import (ADR-0054, `setManyInTx`) takes no advisory locks: it locks `product_prices` `SHARE ROW EXCLUSIVE`, then its profiles `FOR SHARE`, so single and bulk changes wait for it or it for them, never both.
- **Discount programs.** `discount_programs` + `discount_steps`, every program in force applies. Each program has:
  - a name, a list and dates;
  - a scope: `PRODUCT` (the product's quantity in the whole cart, base units), `CATEGORY` (its subtree; boxes counted — every box is one, pieces as boxes, a product without that unit counts nothing — or the amount) or `ORDER` (the amount);
  - an effect: `PRICE` (a product unit's new price, never above the price so far; one per unit and list on a day, partial EXCLUDE `discount_programs_one_price`), `PERCENT`, or `AMOUNT` (per unit for a product, off the subtotal otherwise);
  - ascending steps "from threshold → value", the highest step reached applying.

  A promotion is a program with an end date. A program is edited or deleted only before it starts and stopped after. The shape rules live in `discountShapeIssue` (shared) and the CHECK `discount_programs_shape`.
- **Resolution order** (`resolveQuote`, pure, table-tested):
  1. the line's parts and their list prices:
     - `WHOLESALE`: the line's base quantity splits into whole packs of the whole unit at the warehouse price and a loose rest at the loose price (a line already in whole packs has no loose part; without a whole unit everything is at the warehouse price);
     - `RETAIL`: one part, at the retail price, or at the retail bulk price once the product's quantity in the cart reaches the profile's threshold;
  2. the product's programs on each part: PRICE, PERCENT, then AMOUNT per unit (a program for a unit reaches only parts in that unit, a percentage without a unit every part), on exact values, then the unit price rounded HALF_UP to whole MNT and the part subtotal = unit price × quantity in whole MNT;
  3. category programs, measured on the amounts after step 2;
  4. order programs, measured on the amount after step 3.

  In steps 3–4:
  - a stage's programs are measured on the stage's starting amounts;
  - PERCENT programs then AMOUNT programs apply, each by id;
  - a percentage comes off each part in whole MNT;
  - an amount is split over the parts in proportion to their amounts (largest remainder), never more than they are worth.

  Each part carries its unit, quantity, basis (`WAREHOUSE`, `LOOSE`, `RETAIL`, `RETAIL_BULK`), `listPrice`, `unitPrice`, `subtotal`, `discountAmount`, `total` and the applied programs (name, step, and for steps 3–4 the tugriks taken); a line sums its parts. Lines without price terms are `PRICE_MISSING` and left out of the amounts, but their quantities count.
- **Quote and freeze.**
  - `PriceQuoteService.quote` fetches the price terms, profile versions and programs in force on a date (category subtrees through catalog's `CategoriesService.subtreeIds`) and runs the resolver. `/pricing/quote` and the «Үнэ тооцоолох» screen call it; a 50-line cart is far below 500 ms.
  - `OrdersService.submit` (D11) re-runs it in its transaction and freezes per line its parts (unit, `factor_snapshot`, basis, list price, unit price, discount amount, applied programs) and the tax rates. CONFIRM re-runs it if the submit is older than 24 hours. Each part becomes its own e-Barimt item (delivery 3).
  - The quote carries no tax; the per-line tax split comes with invoices (delivery 3).
- **Rounding** (D13):
  - unit prices are whole MNT;
  - `line_total = subtotal − discount_amount` in whole MNT (a line's total is not always unit price × quantity once category or order discounts apply; how e-Barimt lines carry the discount is a delivery-3 decision);
  - per-line `vat_amount = round2(line_total × r / (1 + r + c))` and `city_tax_amount = round2(line_total × c / (1 + r + c))` keep 2 decimals and are summed into the header, never recomputed from it;
  - table-driven test: Σ payments (integer MNT) = document total = Σ e-Barimt sub-receipt `totalAmount`.
- **Superseded units.** `PricingUnitsHook` runs in the supersede transaction and stops the old unit's programs; nothing is copied (replaces ADR-0008 #4). Prices need nothing: the whole unit is a unit of measure, so a box whose count changes stays the whole unit. A retired whole unit leaves the product priced at the warehouse price until the clerk chooses again; completion refuses it meanwhile.
- **Completion** (ADR-0044, ADR-0048): `SaleReadinessService` requires price terms and a profile version in force today and a whole unit that resolves.
- **No manual discounts** (owner 2026-10-13, SPEC §11 #18). Clients never compute prices; they call `/pricing/quote` with the whole cart.

### 5.5 Partners and credit

- **Customer kind** (M4): `kind` COMPANY or INDIVIDUAL. `reg_no` is free text (7-digit company регистр or 10-character citizen ID), stored normalised (no spaces, upper case, Latin look-alikes → Cyrillic); a number that does not fit the kind only gets a hint. `tin` is nullable, 11–14 digits when present (the database checks this; the kind rule — company 11 digits, citizen 12–14 — lives in `@tugeel/shared/taxpayer` for the API, the web and the importer), with `tin_source` LOOKUP (getTinInfo through the mini-PC; company lookups only — citizen-registry lookups were scheduled to be disabled 2026-06-15) or MANUAL (typed or imported). The Excel importer accepts a TIN column directly and flags rows "TIN pending" instead of failing when the box is unreachable. INDIVIDUAL customers additionally carry an optional e-Barimt consumer number `consumer_no` (8 digits or the `11******` form), asked for at registration and import. Receipt type per customer kind (SPEC §6.10): COMPANY → always B2B_RECEIPT with `customerTin`; a COMPANY without a TIN gets no receipt — the invoice is flagged `TIN_PENDING` on the accountant's list until the TIN is looked up or typed, and a company never receives a lottery B2C receipt. INDIVIDUAL → B2B_RECEIPT when `tin` is present, otherwise B2C_RECEIPT sent with `consumerNo` when `consumer_no` is known (the receipt lands in the citizen's ebarimt account, `easy = true`, nothing to print) and with a printed lottery when it is not (§5.9).
- `vat_payer`, `city_payer` with `tax_status_source` / `tax_status_checked_at` (MANUAL from the office, LOOKUP from getInfo in delivery 3; unchecked = both flags false); `credit_limit` (NULL = not decided yet, not 0; what an order does then is SPEC §11 #21), `payment_term_days` (NULL = the setting `credit.payment_term_days`, one term for everybody whose number the accountant gives, SPEC §11 #20; `CustomersService.creditTerms` reports the source CUSTOMER / DEFAULT / UNSET), `credit_hold` + reason, `status`. No `tier_id` in delivery 1 (owner 2026-10-11: no price tiers today).
- **Addresses** (owner 2026-10-11: the GPS point matters most): text and/or a point (`lat`/`lng NUMERIC(9,6)`, inside Mongolia) read from a pasted Google Maps link or "lat, lng" (`@tugeel/shared/geo`); `gps_source` OFFICE when set in the office, FIELD when a driver or rep corrects it on site (`CustomerAddressesService.setLocationInTx`, deliveries 4–5); one default per customer; archived, never deleted — an order copies `defaultAddress()` onto itself. `zone_id` has no FK until delivery 5 (how zones are drawn is SPEC §11 #22).
- **Suppliers** (ADR-0032): numeric codes, unique names (the product sheet's supplier column is matched by code, then name); `product_suppliers` gives a product one main supplier and optional others, serialised per product by an advisory lock; `ProductSuppliersService.mainSupplierOf` feeds goods receipts (week 3) and procurement (delivery 8).
- **Credit check under a row lock** (D6): `OrdersService.confirm` calls `CustomersService.lockForUpdate(tx, customerId)` (`SELECT … FROM customers WHERE id = $1 FOR NO KEY UPDATE`, returning status, limit, own term and hold) before calling `CreditChecker.check(tx, …)`, so two concurrent confirmations cannot both pass. `FOR NO KEY UPDATE` still lets other transactions insert rows that reference the customer (addresses, orders) — proved by the integrity suite. Exposure = `customer_balances.open_ar + open_orders`; result OK / NEEDS_APPROVAL (over limit but within the tolerance setting `credit_tolerance_pct`, default 10 %, SPEC §11 #19; or overdue beyond terms) / BLOCKED (over limit beyond the tolerance, or `credit_hold`; the order is not confirmed and the response carries exposure, limit and excess). `AllowAllCreditChecker` until delivery 3.
- `customer_balances` (customer_id, open_ar, open_orders, oldest_due_date, updated_at) is a cache updated in the same tx as `ar_entries` and order confirm/cancel/invoice; `invoices.open_amount` is maintained by `payment_allocations`. A nightly job runs `SUM(ar_entries) EXCEPT customer_balances` in `REPEATABLE READ`, mirroring the stock reconciliation.

### 5.6 Orders and the state machine

```
DRAFT -> SUBMITTED -> [APPROVAL_PENDING ->] CONFIRMED -> PICKING -> PACKED -> DISPATCHED -> DELIVERED -> INVOICED -> CLOSED
                                                   |                              |
                                                   |                              +-> DELIVERY_FAILED -> DISPATCHED (re-dispatch)
                                                   |                                                 -> CANCELLED (after return put-away)
                                                   +-> CANCELLED (allowed up to PACKED; releases reservations)
Pickup orders:  PACKED -> DELIVERED (handover) -> INVOICED -> CLOSED
Interim path:   PACKED -> DELIVERED (office "confirm delivery" screen) until trips exist in delivery 5
POS sales:      pos_sales go straight to INVOICED in one tx (then the two-phase receipt, §5.9)
Returns:        after DELIVERED via sales_returns + credit note (CN-) and an inactiveId receipt
```

| Transition | Who | Side effects (all in one tx) |
|---|---|---|
| DRAFT → SUBMITTED | customer app, rep, office | re-run resolver, freeze prices, allocate `SO-` number, audit |
| SUBMITTED → APPROVAL_PENDING | system | CreditChecker NEEDS_APPROVAL (no manual discounts, ADR-0041) |
| SUBMITTED / APPROVAL_PENDING → CONFIRMED | system / approver (`sales.approve`, `sales.approve_over_credit`) | lock customer row, CreditChecker, `reserve()` per line (shortfall → `qty_backordered`, §5.3), `customer_balances.open_orders += total`, push "confirmed" |
| CONFIRMED → PICKING | warehouse (wave) | picking document created |
| PICKING → PACKED | warehouse | PICK pairs posted, reservations consumed, remainder released, packages recorded |
| PACKED → DELIVERED | office (pickup handover; and, until delivery 5, the office "confirm delivery" screen for truck deliveries — SPEC §5.7, §9.3 row 2) | DELIVERY_ISSUE from STAGING for the delivered qty per line, undelivered remainder recorded as backorder, invoice snapshot to finance; replaced by the DISPATCHED path when trips arrive in delivery 5 |
| PACKED → DISPATCHED | dispatcher (trip load) | DISPATCH pairs to CARGO, push "out for delivery" |
| DISPATCHED → DELIVERED | driver (stop) | DELIVERY_ISSUE for delivered qty, POD stored, invoice snapshot to finance |
| DISPATCHED → DELIVERY_FAILED | driver (stop) | exception recorded; goods stay on CARGO |
| DELIVERY_FAILED → DISPATCHED | dispatcher | re-planned on a later trip |
| DELIVERY_FAILED → CANCELLED | office | only after CARGO → RETURNS put-away |
| DELIVERED → INVOICED | finance | `INV-` number inside the invoice tx, `ar_entries`, `customer_balances`, e-Barimt prepare |
| INVOICED → CLOSED | system | fully paid or terms closed |
| ≤ PACKED → CANCELLED | office / customer (own, ≤ CONFIRMED) | reservations released, `open_orders` reduced |

- **Office orders (ADR-0055):** while the credit check allows all (delivery 2), the office's submit is DRAFT → CONFIRMED in one transaction (events SUBMITTED and CONFIRMED). Lock order: the order row, the customer row, then the quote, then `warehouse_stock` in key order, the `SO-` number last. Each line reserves in its product's home warehouse (a product without one cannot be ordered), so one order may reserve in several warehouses. Fulfilment PICKUP or DELIVERY, a delivery date, an address snapshot, a contact and a payment method (CASH, BANK_TRANSFER, CREDIT) are on the header.
- Edits only before CONFIRMED. Every transition writes `order_status_events` (actor, time, reason).
- **Short pick** consumes `qty_picked` and releases the remainder (D4); `qty_approved`/`qty_picked` are visible to the customer as "partially fulfilled".
- **Partial delivery**: `markDelivered(orderId, deliveredQtyPerLine)` sets `qty_delivered`; the invoice snapshot sent to finance contains delivered quantities only; the undelivered remainder returns to RETURNS at trip close and the order closes with `qty_undelivered` recorded (no credit note needed because nothing was invoiced for it).
- **DELIVERY_FAILED** (D4): a failed stop moves the order to DELIVERY_FAILED; dispatch can re-plan it onto a later trip (→ DISPATCHED) or cancel it after the goods are put away from RETURNS (→ CANCELLED, reservations already consumed so nothing to release).
- Invoice timing: by default the invoice is created at DELIVERED (delivered quantities) or at pickup handover. If the accountant requires the fiscal document at dispatch (B2B_INVOICE then payment receipts with `invoiceId`), finance issues it at DISPATCHED instead — `TODO-VERIFY` before delivery 3 (§13, M5).
- Channels: ADMIN, CUSTOMER_APP, SALES_REP, POS. Bigint identity PKs; UUIDs (`uuidv7()`) only for tokens, idempotency keys and payment-intent ids.

### 5.7 Delivery

- Zones (district/khoroo list or polygon; SPEC §11 #22) → `customer_addresses.zone_id` per address (partners owns the column, delivery adds the FK and assigns zones through a partners service). Trip (TRIP-) = driver + vehicle + date + zone + ordered stops from PACKED orders. Drivers deliver pre-packed orders only; there is no on-truck selling, pricing or order creation.
- Load = DISPATCH postings STAGING/SHIP → CARGO of the vehicle's VEHICLE warehouse. Stop outcomes: DELIVERED (POD photo, signature, recipient, GPS, delivered qty per line; partial allowed), FAILED (reason code). Returns at the door post RETURN_IN to CARGO and later CARGO → RETURNS.
- Collection: cash → the driver's `cash_session` (opened at load, closed and counted at trip close); QPay → a payment intent whose QR is shown on the driver's phone; both recorded by finance, never by delivery. Trip close reconciles vehicle stock to RETURNS and the cash session to collected payments.
- Driver receipt printing (raster, Bluetooth 58 mm) is built in delivery 5 if the accountant chooses receipts at delivery, otherwise in delivery 10 (M5).

### 5.8 Payments

- `PaymentProvider` interface (`createInvoice`, `cancelInvoice`, `checkPayment`, `parseCallback`, `listPayments`) with `QPayProvider` first; sandbox/production hosts by config (`merchant-sandbox.qpay.mn` / `merchant.qpay.mn`). Token: `POST /v2/auth/token` with Basic auth, refresh via `/v2/auth/refresh`; `expires_in` read from the live response and cached.
- `payment_intents` (id = `sender_invoice_no`, uuidv7, never reused; invoice_id or order_id; amount; qr_text, short_url, `urls[]` deep links; status NEW/PAID/PARTIAL/CANCELLED/EXPIRED; provider_invoice_id; allow_partial). `POST /v2/invoice` with `invoice_code`, `invoice_receiver_code` = customer code, `callback_url`, `allow_partial` + `minimum_amount` for invoices above SocialPay's 1,000,000 MNT per-invoice cap.
- **Callback-then-check**: `/api/webhooks/qpay` logs the callback verbatim, returns HTTP 200 `SUCCESS` immediately, and enqueues `qpay.check` → `POST /v2/payment/check` (`object_type` INVOICE). A payment is recorded only when a row has `payment_status = PAID`; `paid_amount >= amount` marks the intent PAID, less marks PARTIAL. Callback contents are never trusted; duplicate callbacks are expected. A user-triggered "check status" button with bounded backoff exists on checkout screens; no cron polling of `payment/check`.

```
 customer/driver app        api (finance)                 worker                QPay
      |  POST /payment-intents  |                            |                     |
      |------------------------>| tx: insert intent NEW      |                     |
      |                         |------- POST /v2/invoice ---------------------------->|  (no tx open)
      |<-- qr_text, urls[] -----| tx: store invoice_id, qr   |                     |
      |   (pays in bank app)    |                            |                     |
      |                         |<--------------- callback (untrusted) ----------------|
      |                         | log verbatim, 200 SUCCESS, enqueue qpay.check       |
      |                         |                            |-- POST /v2/payment/check -->|
      |                         |                            |<-- rows[PAID, amount] ------|
      |                         |                            | tx: PaymentsService.record, |
      |                         |                            |     allocate, intent PAID,  |
      |                         |                            |     push "payment received" |
      |<-- status PAID (poll / push) ------------------------|                     |
```
- **Sweep** (M16): `qpay.sweep` runs once or twice a day with `POST /v2/payment/list` over the last 48 hours and reconciles intents the callback missed. This is a different endpoint from `payment/check`; confirm acceptability with support@qpay.mn (`TODO-VERIFY`).
- **Large invoices**: show bank-app deep links from `urls[]` first (bank apps are not subject to the SocialPay wallet cap); plain bank transfer to the Khan Bank account with the invoice number in the description, matched by the statement importer, is the documented path for amounts above wallet limits.
- Bank statements: manual Excel/CSV export from Khan Bank internet banking normalised to {bank, account, record_no, posted_date, amount, dr/cr, description, counterparty account/name}, de-duplicated by (bank, account, record_no); matching order: invoice number in description → counterparty account mapped to customer → exact amount → manual. The Khan Bank Corporate Gateway puller (OAuth2, statement service with a record-number cursor returning ≤100 rows) is added behind the same importer in a later session; contract terms `TODO-VERIFY`.
- Tender codes map to e-Barimt `payments[].code`: CASH, PAYMENT_CARD (supermarket terminal; `tender_data` jsonb holds terminalID, rrn, maskedCardNumber and the receipt builder sets `easy = true` on exactly one object), BANK_TRANSFER, BANK_TRANSFER_QPAY. SocialPay payments arrive through QPay and are coded BANK_TRANSFER_QPAY (`TODO-VERIFY` with ITC).
- A payment is recorded only from verified sources (cash session, statement match, `payment/check`, card-terminal data); a callback never marks anything paid. Until the statement importer arrives in delivery 10, the accountant records bank transfers by hand from internet banking (date, amount, description) with source `BANK_MANUAL` under `finance.payments.record`; from delivery 10 the statement matcher reconciles these manual rows against statement lines and reports duplicates (SPEC §6.12 #1).

### 5.9 e-Barimt receipts

**Topology.** PosAPI 3.0 (PosService 3.0.12 launcher, Linux amd64 .deb) runs on the office Ubuntu mini-PC, listens on port 7080 on the `tailscale0` address only, and is reached from the api/worker containers at `POSAPI_URL` over the tailnet. All `api.ebarimt.mn` lookups (getTinInfo, getInfo, getBranchInfo, barcode, getProductTaxCode) are proxied through the same box because they are Mongolia-IP-only. `ebarimt_config` holds one row per PosAPI instance (branch_id, base_url, pos_no, merchant_tin, district_code, branch_no, is_active); receipts are routed by the branch of the selling warehouse, which is how the second instance at the supermarket joins in delivery 9 (M7).

**Two-phase issue, never inside a DB transaction** (D1):

1. `tx1`: the business flow posts the sale (POS_SALE / invoice / payment) and calls `EbarimtService.prepare(tx, snapshot)`, which validates the catalog attributes (§5.2 — `EBARIMT_ATTRIBUTES_MISSING` lists the products), builds the request payload, allocates `bill_id_suffix` from `NumberingService.next(tx, 'BILLID:<pos_no>', <UB date>)`, inserts an `ebarimt_receipts` row in status PENDING and enqueues `ebarimt.issue` (POS path: `PosFlowService` awaits the `ebarimt.issue` job result, ≤ 90 s, after tx1 commits; wholesale invoicing: fire and forget). COMMIT.
2. HTTP: `issue(receiptId)` loads the row, calls `POST /rest/receipt` with a 90 s timeout, and parses the response. **No transaction is open during the call.**
3. `tx2`: update the row to CONFIRMED (ddtd, posapi_date, sub-receipt ids), ERROR (message), or INDETERMINATE (timeout / network / 5xx). ERROR with a validation message may be corrected and re-prepared as a new row; INDETERMINATE is never blind-retried.

```
 POS screen            api: PosFlowService            db                 worker          PosAPI (tailnet)
    | checkout ------------>|                           |                   |                 |
    |                       | tx1: POS_SALE, invoice,   |                   |                 |
    |                       |      payment, ebarimt     |                   |                 |
    |                       |      PENDING + billIdSuffix, enqueue ebarimt.issue              |
    |                       |----------- COMMIT ------->|                   |                 |
    |                       | await job result (<= 90 s)|                   |                 |
    |                       |                           |   issue(receiptId)|                 |
    |                       |                           |                   |-- POST /rest/receipt -->|
    |                       |                           |                   |<-- id, lottery, qrData -|
    |                       |                           |<-- tx2: CONFIRMED |                 |
    |<-- {ddtd, print payload incl. lottery/qrData in memory only} ---------|                 |
    | print (raster)        |                           |                   |                 |
```

The POS checkout screen awaits step 3 (budget 60–90 s with a progress state); if the result is INDETERMINATE the sale stands, the receipt row goes to the accountant's INDETERMINATE queue, and the cashier prints a provisional slip without lottery.

| Receipt status | Meaning | Next step |
|---|---|---|
| PENDING | row committed, HTTP not yet attempted | `ebarimt.issue` job picks it up |
| CONFIRMED | PosAPI returned `SUCCESS` with ДДТД | print; included in nightly sendData monitoring |
| ERROR | PosAPI returned `ERROR`/`PAYMENT` with a message | fix data, prepare a new row (same source doc, new billIdSuffix) |
| INDETERMINATE | timeout, network error or 5xx — the receipt may or may not exist | accountant queue; resolver per the spike results; never auto-retry |
| CANCELLED | DELETE accepted immediately | — |
| UNCONFIRMED_RETURN | DELETE on a citizen-confirmed receipt | becomes inactive after the citizen approves in the app |

**Never persist or log lottery/qrData** (M3): `integrations/ebarimt/client.ts` returns `{ ddtd, status, message, posapiDate, easy, receipts[].id, bankAccountId }` as the stored summary and hands `{ lottery, qrData }` back **only** as an in-memory value to the print renderer. `ebarimt_submission_log` stores the request payload and that summary only; the pino serializer for the client omits response bodies; Sentry request/response capture is disabled for this client. A unit test asserts that the submission log, the logger output and the Sentry event never contain the keys `lottery` or `qrData`. The single exception is the server-rendered receipt bitmap in `print_jobs.payload` (§9.4, ADR-0022): lottery and QR exist there only as pixels, the payload is nulled on ack and the job expires after 10 minutes. Reprints carry ДДТД, totals and buyer data only; QR regeneration policy `TODO-VERIFY` with ITC.

**Row model** (`ebarimt_receipts`): id, config_id, source_doc_type/id, type (B2B_RECEIPT/B2C_RECEIPT/B2B_INVOICE/B2C_INVOICE), status (PENDING/CONFIRMED/INDETERMINATE/ERROR/CANCELLED/UNCONFIRMED_RETURN), bill_id_suffix, ddtd (33 chars), `posapi_date` text verbatim (`yyyy-MM-dd HH:mm:ss`) + `issued_at timestamptz` derived in Asia/Ulaanbaatar (M12), merchant_tin, customer_tin, consumer_no (copied from `customers.consumer_no` or typed at the POS), district_code, branch_no, pos_no, inactive_id, invoice_id, report_month, payments jsonb (the `payments[]` sent, incl. `data` for PAYMENT_CARD), request_payload jsonb, response_summary jsonb, sub_receipt_ids, error_message. DELETE /rest/receipt sends `{ id, date }` with the verbatim string.

**Receipt building rules.** One sub-receipt per `taxType`; header `totalAmount = Σ sub-receipts = Σ payments` asserted before sending; item `unitPrice`/`totalAmount` tax-inclusive, `totalVAT`/`totalCityTax` from the 2-decimal line split (§5.4); `classificationCode`, `barCode`+`barCodeType`, `measureUnit`, `taxProductCode` (VAT_FREE/VAT_ZERO) per item; city tax only when the merchant is `cityPayer`. Type by customer kind (§5.5, SPEC §6.10): COMPANY → B2B_RECEIPT with `customerTin` (no lottery), and `TIN_PENDING` instead of a receipt while the TIN is missing; INDIVIDUAL → B2B_RECEIPT when a TIN is present, otherwise B2C_RECEIPT (lottery; `consumerNo` 8-digit or `11******` easy registration when `consumer_no` is known); supermarket walk-in → B2C_RECEIPT. Card payments carry `payments[].data` from `tender_data` (M8). Corrections and partial refunds chain through `inactiveId`; full cancellation via DELETE (immediate only while the citizen has not confirmed; otherwise UNCONFIRMED_RETURN); backdating via `reportMonth` only for B2B types and only on the 1st–7th, computed in Asia/Ulaanbaatar.

**Jobs.** `ebarimt.sendData` nightly (`GET /rest/sendData`) and after outages; `ebarimt.monitor` every 5 minutes (`GET /rest/info` → `lastSentDate`, `leftLotteries`, version) feeding `/health/ebarimt` and alerting when lotteries run low or `lastSentDate` is older than 24 h; `ebarimt.refreshReference` nightly (district codes, tax product codes, classification list with the date filter).

**INDETERMINATE resolver** (M6): designed after the Week 0/1 staging spike, which records (a) the exact response to re-submitting the same payload with the same `billIdSuffix`, (b) whether PosAPI's local database on the box can be queried by billIdSuffix/posNo/date, (c) behaviour under a forced timeout. Until then INDETERMINATE rows are a manual accountant queue, never an automatic re-issue. After certification the ERP sales-list API (`getSaleListERP`, bearer + X-API-KEY) becomes the authoritative lookup.

**Certification gate** (F2): the owner emails posapi@itc.gov.mn in Week 0 asking (1) whether a single-company in-house system can be certified as "Хэрэглэгчийн систем нийлүүлэгч", (2) whether PosAPI on an office box reached over Tailscale counts as "installed as a module in the user system", (3) whether the exam demo may run with the backend abroad. Staging: `st-operator.ebarimt.mn` (AA10010110 / Test@123, TEST OPERATOR1, test merchant TIN 37900846788). **Gate date: end of delivery 1 (target 2026-11-13; `STATUS.md` holds the live date).** Without written confirmation by then, the fallback is selected: a certified relay/operator vendor hosting PosAPI, or QPay `ebarimt_v3` for QPay-paid sales plus a vendor for cash. The `ReceiptProvider` interface (`prepare`, `issue`, `void`, `status`, `lookupTin`, `lookupInfo`) makes the switch a config change (`EBARIMT_PROVIDER=posapi|relay|qpay`), not a rewrite.

### 5.10 HR sketch (delivery 11)

`employees` (linked to users; drivers and reps resolved by `EmployeesService.byUser`), departments, positions, `employee_contracts` (salary components), attendance (manual + staff-app clock-in), leave, `payroll_runs` per period: gross → НДШ employee/employer parts and ХХОАТ brackets from effective-dated tables by year → net; payslip PDF (pdfmake, Noto Sans embedded); bank salary export for Khan Bank. Approved runs are immutable. Rate tables reviewed by the accountant before go-live.

### 5.11 AI assistant (ADR-0045)

A question in Mongolian becomes one checked, read-only `SELECT` over curated views; the answer is a table, a short summary and the SQL. Contract: `docs/modules/ai.md`.

- **Semantic layer.** Migration `0017_ai` creates schema `ai` with views owned by `migrator`: `categories` (with a precomputed path), `products`, `product_units`, `warehouses`, `stock`, `low_stock`, `stock_movements`, `stock_documents`, `receipt_lines`, `customers`, `customer_addresses`, `suppliers`, `product_suppliers`, `discount_programs`, and since `0019_price_profiles` (ADR-0048) `price_profiles`, `product_prices_today`, `product_price_history` in place of `prices_today` and `price_history`. Explicit column lists, built-in functions only, no `security_invoker`; "today" is `(now() AT TIME ZONE 'Asia/Ulaanbaatar')::date`. They never read `auth_sessions`, `password_resets`, `idempotency_keys`, `files`, `audit_log` or `import_rows`, and from `users` only `id` and `full_name` (contract test over `information_schema.view_column_usage`). `AI_DATASETS` (`modules/ai/semantic/datasets.ts`) describes every view and column in English for the prompt, the guard and the tests; Mongolian names, the glossary and example questions are in `mn.json`. A view that repeats a service rule (a unit's derived price, the low-stock status, a discount program's status) is tested against that service.
- **Tables.** `ai_conversations` (owner, title, timestamps); `ai_questions` (append-only like `audit_log`: conversation, asker, question, kind, SQL, status, row count, duration, provider, model, token counts, error code; never rows); `ai_reports` (name, SQL copied on the server from an answered question, creator, soft delete, audited).
- **The guard** (`modules/ai/sql/sql-guard.ts`): one `SELECT` (CTEs are `SELECT`s, never recursive), every parse-tree node of an allowed type, relations only `AI_DATASETS` views or CTEs in lexical scope, functions, casts and operators from allow-lists, no locking clause, `INTO` or parameter, limits on depth, nodes, concatenations and length.
- **The executor** (`AiReaderService`, pool `AI_POOL_MAX` over `AI_DATABASE_URL`, created lazily): `BEGIN READ ONLY`, `SET LOCAL` timeouts (statement 15 s, lock 2 s), time zone, search path, `work_mem`, `jit = off`, no parallel workers; `DECLARE ai_c NO SCROLL CURSOR FOR <sql>` (parsed again: exactly one `DeclareCursorStmt`); `FETCH 501` with array rows and raw strings; `ROLLBACK`; the connection is destroyed. 500 rows are shown; an Excel export reads up to 20,000 rows within 30 s.
- **The flow** (`AskFlowService`, between transactions): instructions + the last five steps of the conversation as a delimited data block → the model returns `{ kind: query | clarify | unsupported, sql, explanation }` → guard and executor → one repair after a guard refusal or a database error (never after a timeout or a resource error) → a summary from at most 50 rows → the question is logged. Statuses `ANSWERED`, `CLARIFY`, `UNSUPPORTED`, `REFUSED`, `FAILED`; errors `AI_NOT_CONFIGURED` (503), `AI_PROVIDER_FAILED` (502), `AI_QUERY_FAILED` (422, a stored query run again).
- **Permissions.** `ai.ask` (ask, own conversations, see, run and save reports; it shows costs, credit and personal data that screens hide without `inventory.costs.manage` or `partners.customers.read`) and `ai.reports.manage` (rename and delete anyone's report); both ADMIN's and assignable.

### 5.12 Segments and filtered lists (ADR-0049)

A segment is a saved condition tree over one entity; a list filter is the same tree, unsaved. Contract: `docs/modules/segments.md`.

- **Model** (`@tugeel/shared/segments`): a definition is a match (`ALL` / `ANY`) over at most 10 groups, each a match over at most 10 flat conditions `{ field, op, ids?, values?, from?, to?, days?, min?, max?, warehouseId?, text? }`; a registry names each entity's fields, the module owning each field and its operators; `segmentIssue()` validates for the api and the web.
- **Evaluation.** Each leaf is answered by its owner's public service as ascending ids (catalog: search, category subtree, stage, dates, missing data; partners: supplier links; inventory: home warehouse, stock state; pricing: profile, warehouse price, today in Ulaanbaatar); AND intersects, OR unites, a negation subtracts from the universe (all products including inactive ones; the customers the caller may see; all suppliers). Leaves run one after another and are memoized per request.
- **Hooks.** catalog declares `PRODUCT_SET_RESOLVER` and partners `PARTNER_SET_RESOLVER` (`hooks.ts`); `SegmentsModule` binds both to the evaluator; the owner resolves them with `ModuleRef` (`strict: false`) and answers 503 `SERVICE_UNAVAILABLE` to a filtered request when unbound. `POST /products/query` pages catalog's own rows within the resolved ids (`id = ANY($ids)`, one array parameter) and returns `total` on the first page.
- **Export.** `POST /exports/products` (`catalog.products.export`) reads the ticked ids or the filtered ids in the list's order, at most 20,000 (`EXPORT_TOO_LARGE`), in one REPEATABLE READ transaction, 1,000 at a time, and writes the visible columns with `common/excel/table-workbook.ts`; at most two exports run at once per process.
- **List segments** (ADR-0052): a product segment of `kind` LIST has no definition; its members are exactly the products put in (`segment_products`), never new ones by themselves. `POST /segments/lists` creates one from ticked products, `POST /segments/:id/products` and `…/products/remove` change it (≤ 20,000 ids per request and per segment, `SEGMENT_TOO_LARGE`; one array parameter; one audit row per action: `CREATE` with the ids, `ADD_PRODUCTS` / `REMOVE_PRODUCTS` with the ids changed). The evaluator reads the members for `ofSegment` and counts, so every `segmentId` consumer takes both kinds. `POST /products/query/ids` (catalog) returns every id the list's filters keep, in the list's order, at most 20,000 (`SELECTION_TOO_LARGE`): the web's «Таарсан бүх N-ийг сонгох».
- **Bulk edits** (ADR-0051) stay in the owning modules: `POST /products/bulk/status|category`, `POST /product-suppliers/bulk/main`, `POST /product-prices/bulk/profile`, `POST /product-locations/bulk/home` (with `dryRun`); 1–500 ids, idempotent, audited per product, locks in id order and in the table order of product writers (§5.3).

---

## 6. API conventions

- Base `/api/v1/<resource>`; resource-oriented controllers; JSON only. OpenAPI from DTO decorators + swagger CLI plugin; `pnpm gen:api` regenerates `packages/api-client`; CI fails if stale.
- **`Idempotency-Key` is mandatory on every document-creating POST from every client** (web, mobile, scripts) (F11): stored in `idempotency_keys` (unique (actor_kind, actor_id, key), ADR-0027) with the response replayed on repeat; missing header → 400 `IDEMPOTENCY_KEY_REQUIRED`.
- Errors: RFC 9457 problem+json with a stable `code` that clients map to Mongolian text; 409 for state-machine violations, 422 for validation, 400 for malformed requests, 403 `FORBIDDEN` for permission or scope failures.

```json
{
  "type": "https://tugeel.local/errors/STOCK_INSUFFICIENT",
  "title": "Stock insufficient",
  "status": 409,
  "code": "STOCK_INSUFFICIENT",
  "detail": "bin A-01-03, product 10234: requested 30.000, available 12.000",
  "instance": "/api/v1/bin-moves/4412",
  "requestId": "01J9...",
  "params": { "binCode": "A-01-03", "sku": "10234", "requested": "30.000", "available": "12.000" }
}
```

  Stable codes used across modules: `IDEMPOTENCY_KEY_REQUIRED`, `DOC_ALREADY_POSTED`, `ALREADY_POSTED`, `STOCK_INSUFFICIENT`, `BIN_LOCKED_FOR_COUNT`, `UNIT_SUPERSEDED`, `PRICE_MISSING`, `DISCOUNT_OVER_CAP`, `CREDIT_BLOCKED`, `CREDIT_NEEDS_APPROVAL`, `ORDER_STATE_INVALID`, `EBARIMT_ATTRIBUTES_MISSING`, `TIN_PENDING`, `EBARIMT_INDETERMINATE`, `PAYMENT_NOT_VERIFIED`, plus the generic HTTP codes (`BAD_REQUEST`, `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `IDEMPOTENCY_KEY_REUSED`, …). The enum is `ErrorCode` in `packages/shared/src/errors/error-codes.ts`; `apps/api/src/common/errors/error-status.ts` maps every code to its HTTP status (a code without a status fails typecheck). The `params` object carries values for the i18n message; `detail` is English for logs; `VALIDATION_FAILED` carries `errors[]` (`path`, `constraint`, `message`); a 500 never exposes the error message.
- Pagination: keyset (`cursor`, `limit`) on all lists; envelope `{ data, nextCursor }`. Server-side filtering/sorting.
- Batch reads (ADR-0037): a list showing another module's data asks that module once per loaded page with a repeated id parameter (`productIds=1&productIds=2`, at most 200); the answer uses the module's usual item shape. Screen preferences (hidden columns) may live in `localStorage`, per user in each browser (`…v1:<userId>`, ADR-0050), and the product list's ticks in `sessionStorage`, per user and tab (ADR-0052); business data never does.
- Filtered lists (ADR-0049): a list whose filters reach other modules' data takes a condition tree (`where`) or a `segmentId`; the owner asks its resolver hook for the matching ids, then pages its own rows. A read that needs a body is a POST (`POST /products/query`, like `POST /pricing/quote`). A capped set read (`POST /products/query/ids`, the export) returns at most 20,000 ids or rows and refuses more with a code naming the count and the limit; it is not paged.
- Membership changes of a list segment (ADR-0052) take up to 20,000 ids and write one audit row per action on the segment.
- Bulk actions (ADR-0051): `POST /<resource>/bulk/<what>` in the owning module, 1–500 ids, `Idempotency-Key`, one audit row per record, an answer saying what changed, what was already so and what was skipped.
- Dates: ISO-8601 with offset; `effective_date` and report periods are plain dates in Asia/Ulaanbaatar.
- Webhooks live under `/api/webhooks/*`, log verbatim, and only enqueue jobs.
- `@nestjs/throttler` + helmet on public customer endpoints; row scoping: customers see own orders/invoices, drivers own trips, reps own customers.
- `/health` (public, cheap) and `/health/ebarimt` (§11).

---

## 7. Auth and roles

- Staff: username + password (argon2id). Customers: phone (E.164, `+976` + 8 digits) + password at first (accounts provisioned from the Excel import; a sales rep or admin sets the initial password when SMS is unavailable), SMS OTP login/reset added with the customer app once the SMS provider is contracted (`TODO-VERIFY`, M13).
- Tokens (ADR-0027): 15-min HS256 access JWT with `sub`, `sid`, `kind`, `iss`, `aud` only; the global `AuthGuard` resolves session validity, user status, permissions and scopes from the database on every request, so revocation and role changes are immediate. Rotating refresh tokens are hashed in `auth_sessions` per device; a staff session ends a fixed `auth.staff_session_hours` (default 12) after login and a refresh never extends it; a rotated token replayed within 20 s gets a fresh access token, later it revokes the session. The web keeps the refresh token in an httpOnly `SameSite=Strict` cookie on `/api/v1/auth` (refresh and logout also check `Origin` against `Host`; request bodies are JSON only); mobile keeps it in expo-secure-store (delivery 4).
- Passwords: argon2id over NFC text, at least 8 characters, never the username, no expiry. Admins never know passwords: they issue a one-time code (30 min, 5 attempts, HMAC with `AUTH_PEPPER`) and the user sets the password. Failed logins and code redemptions are counted per IP + username (5 failures in a rolling 15 min, 30 per IP; in-process limiter, successes never count); 20 consecutive failures lock the account for 15 min (admin unlock).
- RBAC: every route is `@Public`, `@Authenticated` or `@RequirePermission(...)`; anything else answers 403. System roles ADMIN, OFFICE, PROCUREMENT, WAREHOUSE, ACCOUNTANT, HR, POS_CASHIER, SALES_REP, DRIVER (customers are a separate kind) expand to permission codes from `@tugeel/shared/auth` (`identity.users.manage`, `catalog.products.register`, `pricing.prices.manage`, `inventory.receipts.manage`, `ai.ask`, later `sales.approve`, …), synced into the database at api boot. Admins may build custom roles from the catalog except the admin-only codes `identity.users.manage` and `identity.roles.manage`; the last active ADMIN cannot be disabled or demoted; nobody edits their own roles, scopes or status. A user's warehouse/branch scope limits writes only (reads stay global; TRANSIT is always writable).
- Audit: `AuditService.record(tx, actor, entry)` is called by services inside the business tx with before/after JSONB (keys matching password/hash/token/secret are dropped); the actor is the `AuthContext` passed explicitly from the controller, or a system actor in jobs and CLIs (ADR-0027).

---

## 8. Mobile strategy

- One Expo project (created at delivery 4); `app.config.ts` reads `APP_VARIANT` → bundle ids, names, icons. `customer` (public listing, iOS + Android) and `staff` (Android-first, EAS internal distribution APK + Play internal track; iOS later). Staff route groups are gated by role at runtime and hidden in the customer variant; API permissions are the real boundary, so bundling both groups is acceptable and build-time exclusion is an optimisation evaluated at delivery-4 kickoff.
- **SDK**: the current stable Expo SDK at delivery-4 kickoff (expected 58 or 59), recorded in `docs/modules/mobile.md` with the date; any earlier Expo scaffold is disposable (M9, F8). Development builds only, never Expo Go.
- **`useScanner` hook** (M11): hidden always-focused `TextInput` (`showSoftInputOnFocus={false}`) for keyboard-wedge scanners (Bluetooth HID guns, Android handhelds in keyboard mode; standardise US layout + Enter suffix) with `expo-camera` `CameraView` fallback limited to `ean13, ean8, code128, qr, itf14, upc_a, upc_e`, cooldown after a hit and double-read confirmation; results pass through `packages/shared/gtin.ts` before lookup. Vendor SDKs (DataWedge, Sunmi broadcast) can be added behind the same hook.
- **Delivery-1 web scanning** (M15): the admin's receiving/stocktake/picking screens have a visible scan box fed by a global keydown burst detector (onScan.js defaults: Enter suffix, min length 4) for USB/Bluetooth HID scanners, plus a browser camera scanner using the `BarcodeDetector` API on Chrome Android with the `barcode-detector` ponyfill (ZXing WebAssembly served from our own build, ADR-0031) as fallback. Number-row keys are read from `event.code`, so scans stay digits when the PC uses the Mongolian keyboard layout. Two Bluetooth HID scanners are ordered on day 1 so they arrive for the delivery-1 acceptance.
- TanStack Query with optimistic UI; `Idempotency-Key` on all mutations; short-lived catalog cache. True offline is out of scope (ADR-0020).
- EAS Build (owner is on Windows; no Xcode), EAS Update for JS-only fixes. Budget EAS Starter ($19/mo) from the customer-app launch. Org accounts (D-U-N-S, Apple $99/yr, Google $25) and the Expo org start in Week 0.

---

## 9. Integrations

### 9.1 e-Barimt (PosAPI 3.0)

- Only supported path; PosAPI 2.0 was shut down 2026-03-30. Official package: `PosService_3.0.12-Prod.zip` / `ST_PosService_3.0.12-Staging.zip` from share.itc.gov.mn, containing `PosAPI.deb` (Linux amd64): a launcher that reads `posapi.ini`, downloads the current runtime (3.2.4x–3.2.50 observed) and **self-updates hourly** (skipHours 11–14 and 18–21). The mini-PC runs the official .deb directly (no Docker) with `/opt/posapi` persisted and the self-update accepted as a fact of life; `deploy/ebarimt-box/` holds the Ubuntu checklist.
- Network: `posapi.ini` `webServiceHost` = the box's `tailscale0` address (100.x.y.z), `webServicePort` 7080; Tailscale ACL allows `tag:server` (droplet) and `tag:dev` (owner's PC, staging instance only) → `tag:posapi:7080`; nothing else reaches the box. Outbound whitelist on the box: api.ebarimt.mn (103.17.108.216/217), auth.itc.gov.mn (103.87.69.75/76); staging st-api.ebarimt.mn / st.auth.itc.gov.mn. PosAPI backend: PostgreSQL (`QPSQL`) on the box for durability over SQLite. Limits: ≤1,000 merchants and ≤100,000 receipts per day per instance, never public.
- Activation: operator login at `http://<box>:7080/web`, merchant linked via operator.ebarimt.mn and approved in e-invoice.ebarimt.mn (or the Ebarimt-Mobile app). Endpoints used: `POST/DELETE /rest/receipt`, `GET /rest/info`, `GET /rest/sendData`, `GET /rest/bankAccounts?tin=`. We write our own small typed client; third-party SDKs have had correctness bugs.
- Vendor obligations baked into the design: printed receipt for every transaction (seller name + TIN, ДДТД, date, totals, VAT and НХАТ separately, lottery after the word "сугалаа", sharp QR; B2B shows buyer TIN and name, no lottery); auto-send at least daily plus a manual send button; monitor `leftLotteries` and the 3-day sending window; card easy-registration when a bank terminal is connected; `QR код хадгалахгүй`.
- The 2027 VAT-threshold change (mandatory registration from MNT 400 million) may move shop customers between VAT-payer and non-payer; `vat_payer` is data, rates are effective-dated settings, so nothing is hard-coded.

### 9.2 QPay Merchant v2

Prod `merchant.qpay.mn`, sandbox `merchant-sandbox.qpay.mn` (shared sandbox credentials TEST_MERCHANT / 123456 / TEST_INVOICE from community docs — `TODO-VERIFY` on day 1). Flow and endpoints as in §5.8. Merchant contract at business.qpay.mn, then an explicit request to QPay (info@qpay.mn / support@qpay.mn) or Khan Bank (merchant@khanbank.com) for vendor API credentials (`invoice_code`, client id/secret); fee ~1%, no setup fee. Bank-app deep links come back in `urls[]`. Byl is an optional second provider behind the same interface; direct SocialPay/Golomt integrations are not planned (Golomt E-Merchant needs an SSL website and a 6-month Golomt account).

### 9.3 Scanners

Keyboard-wedge first everywhere (web global keydown detector; mobile hidden TextInput), camera fallback (web `BarcodeDetector` / `barcode-detector` ponyfill, ADR-0031; mobile expo-camera). Standardise US layout + Enter suffix. Week 0/1 purchases: two Bluetooth HID scanners (day 1), one keyboard-wedge Android handheld, one Android POS-style device with built-in printer, one dual-mode (Classic + BLE) 58 mm Bluetooth printer, one Ethernet label printer with documented TSPL/ZPL, one Ethernet 80 mm receipt printer. Specific models are chosen after the week-1 hardware test, not in this document (M14).

### 9.4 Printers

- **Raster is the default for anything containing Mongolian text** (M2): PC866 and CP1251 are Russian Cyrillic code pages and do not contain Ө/ө and Ү/ү, so `codepage('auto')` would substitute glyphs. Every receipt pipeline renders the receipt to a 1-bit bitmap (384 dots for 58 mm, 576 for 80 mm) and sends `GS v 0` raster via `@point-of-sale/receipt-printer-encoder` `image()`; text mode is used only for ASCII/digits. The week-1 printer checklist prints "Төв Үнэ ө ү" and an e-Barimt-style QR on every candidate printer; a code-page path is allowed only for a printer that documents a Mongolian code page, verified on the device.
- **Labels, phase 1 (delivery 1)**: HTML/CSS `@page { size: <w>mm <h>mm; margin: 0 }` templates with bwip-js SVG barcodes (product/unit and bin labels), printed through the browser with the printer's Windows driver; Chrome `--kiosk-printing` shortcut on the label PC. Phase 2: server-generated TSPL/ZPL to port 9100 on a LAN printer, sent by the print agent.
- **POS receipts (delivery 9, F13, ADR-0022)**: an Ethernet 80 mm ESC/POS printer on the store LAN, driven by a ~100-line Node **print agent** in `packages/printing/agent` that long-polls `GET /api/v1/print-jobs/next?station=<id>` over HTTPS (up to 20 s per request) with a station token, writes the rendered bytes (raster receipt + QR + cash-drawer pulse) to `tcp://<printer_host>:9100`, and acknowledges with `POST /api/v1/print-jobs/:id/ack` (`status` PRINTED/FAILED + error string). It runs on the POS PC as a Windows service under `nssm` with a pinned Node; no inbound port, no Tailscale on the POS PC, same repo and CI. QZ Tray is not used.

  Print job model (`print_stations` + `print_jobs`, owned by identity because every module enqueues jobs): `print_stations` (id, branch_id, name, token_hash, printer_host, printer_port, last_seen_at) — one row per POS PC, token issued by the admin and stored hashed, `last_seen_at` refreshed on every poll and shown as station health; `print_jobs` (id, station_id, kind RECEIPT/LABEL/DRAWER, payload bytea rendered server-side — lottery/qrData are rasterised into the bitmap and the payload is nulled on ack —, status QUEUED/PRINTING/PRINTED/FAILED, attempts, created_at, acked_at). A job older than 10 minutes expires. A FAILED job is retried (at most 3 attempts) only on the cashier's explicit request, never automatically, so a receipt is never double-printed; the POS screen offers a reprint regenerated from the ДДТД without the lottery.
- **Driver/rep receipts**: `packages/printing` raster pipeline (receipt view → PNG → ESC/POS raster), Sunmi built-in and Bluetooth SPP transports, Android-first; prototype on the exact printer before buying a fleet.
- Server PDFs (pick lists, invoices, delivery notes, payslips): pdfmake with embedded Noto Sans.

### 9.5 LLM providers (ADR-0045)

- `apps/api/src/integrations/llm/`: one `LlmClient` interface (`complete({ instructions, messages, schema?, maxOutputTokens })` → text, model, token counts) and three adapters over Node's `fetch` with `AbortSignal.timeout(LLM_TIMEOUT_MS)`; no SDK dependency.
  - **OpenAI** (default): `POST {LLM_BASE_URL or https://api.openai.com}/v1/responses`, `Authorization: Bearer`, `text.format` = JSON schema with `strict: true`, `store: false`; a refusal or an `incomplete` status is an error.
  - **Anthropic**: `POST /v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, `output_config.format` = JSON schema.
  - **Ollama** (local): `POST {LLM_BASE_URL or http://127.0.0.1:11434}/api/chat`, `format` = JSON schema, `stream: false`, no key.
- Errors are `LlmError` with a reason (`TIMEOUT`, `NETWORK`, `HTTP` with the status and the provider's short error code such as `invalid_api_key`, `REFUSED`, `INCOMPLETE`, `INVALID_RESPONSE`); no automatic retry — the person asks again. Only the reason and the HTTP status are logged, never a request or response body.
- `LlmModule` (global) provides `LLM_CLIENT`, or `null` when `LLM_PROVIDER` is empty; `app.module.ts` imports it, `AskFlowService` injects it. Tests replace it with a scripted fake; the harness removes every `LLM_*` variable, so a real key is never used by a test.
- Data that leaves the company: the question, the dataset descriptions, earlier steps of the conversation and up to 50 result rows (names, phones, TINs, addresses and amounts included, by the owner's decision; SPEC §6.14, §11 #24). Credentials, sessions, files and audit data never do.

---

## 10. Environments and deploy

### 10.1 Local (Windows 11): the only environment until go-live (ADR-0026)

Docker Desktop (WSL2) runs `postgres:18` only (`docker-compose.yml`, `127.0.0.1:15432`); `pnpm dev` runs api, worker, web. Expo development builds on a real Android device (delivery 4+) and the POS print agent (delivery 9) reach the API at the machine's LAN address. Every delivery is accepted here with real data imported locally. The staging PosAPI on the office box is reached over Tailscale (the dev machine joins the tailnet as `tag:dev`); QPay runs against its sandbox without callbacks (`payment/check` and the sweep); files use `STORAGE_DRIVER=local` (`.data/storage/`, ADR-0014, ADR-0030). `pnpm docker:build` plus the staging stack behind the edge Caddy (`http://staging.localhost:8080`) rehearses the deploy. No mailpit and no email feature until a feature needs one (F11). The AI assistant stays off until the owner puts `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` in `apps/api/.env`; `AI_DATABASE_URL` and `AI_POOL_MAX` come from `.env.example`, and `pnpm db:provision` creates `ai_reader` (ADR-0045).

### 10.2 Droplet layout and pool budget (F3): the go-live target

| Stack | Services | Database | Pool sizes |
|---|---|---|---|
| production (`deploy/docker-compose.prod.yml`) | caddy, api, worker | DO Managed PostgreSQL 18, database `tugeel` | api `max: 6`; worker `max: 3`; pg-boss `max: 2` per process; the AI reader `max: 2` (api only, role `ai_reader`, ADR-0045) → 15 of the 1 GiB plan's ~22 backend connections, leaving room for migrations and `psql` |
| staging (`deploy/docker-compose.staging.yml`) | api-staging, worker-staging, postgres-staging (`postgres:18` container with a volume) | local container, never the managed cluster | api 2, worker 2, pg-boss 2, AI reader 2 |

In both stacks the api and the worker mount one named volume at `/data/storage` (`storage`, `storage_staging`; the image creates the directory owned by `node`), so uploaded files survive restarts and the worker reads the import sheets the api received (ADR-0036 #1). Pool sizes are env-driven (`DB_POOL_MAX`, `PGBOSS_POOL_MAX`) and recorded in `CLAUDE.md`; the deploy runbook states the plan's connection limit as read from the DO console at cluster creation (the ~22 figure is a planning estimate until then). One **edge Caddy** (in the production compose file, joined to the external networks `tugeel_edge_prod` and `tugeel_edge_staging`) terminates TLS for all three hosts and proxies `/api/*` and `/health` to the api of each stack and everything else to that stack's `web` container (`ghcr.io/ez4puljin/bto-web`, a Caddy file server for the built SPA on port 8080); the stacks cannot reach each other. Secrets live in `/opt/tugeel/.env` and `.env.staging` (never in git; the repository is public); 2FA on DO/GitHub/Cloudflare/Tailscale.

Environment variables every process reads (validated by Zod at boot; the process refuses to start on a missing or malformed value):

| Variable | api | worker | Notes |
|---|---|---|---|
| `NODE_ENV`, `LOG_LEVEL`, `APP_VERSION` | yes | yes | `APP_VERSION` = image git sha, reported by `/health` |
| `API_PORT` | yes | — | HTTP port, default 3000 (container); local development uses 3300 from `apps/api/.env`, which the Vite proxy also reads. Not `PORT`: dev launchers export `PORT` for the web dev server |
| `DATABASE_URL` | yes | yes | role `app` |
| `MIGRATOR_DATABASE_URL` | entrypoint only | — | role `migrator`; used by `node dist/db/migrate.js`, removed from the environment of the main process |
| `WORKER_HEALTH_PORT` | — | yes | loopback health endpoint (default 3001) |
| `DB_POOL_MAX`, `PGBOSS_POOL_MAX` | yes | yes | §10.2 budget |
| `ROLE` | `api` | `worker` | same image, selects `main.ts` or `worker.ts` |
| `JWT_SECRET`, `AUTH_PEPPER` | yes | — | at least 32 characters; `dev-` values are refused in production; rotated per runbook (ADR-0027) |
| `COOKIE_SECURE` | yes | — | `Secure` flag of the refresh cookie; defaults to true only when `NODE_ENV=production` |
| `POSAPI_URL` | yes | yes | tailnet address of the office box; per-branch overrides live in `ebarimt_config` |
| `EBARIMT_PROVIDER` | yes | yes | `posapi` (default), `relay` or `qpay` (§5.9) |
| `QPAY_BASE_URL`, `QPAY_CLIENT_ID`, `QPAY_CLIENT_SECRET`, `QPAY_INVOICE_CODE` | yes | yes | sandbox vs production by value |
| `SPACES_*` | yes | yes | presigned uploads, pg_dump target |
| `STORAGE_DRIVER` | yes | yes | `spaces` (default; refuses to start until the go-live phase builds it) or `local` (ADR-0030) |
| `STORAGE_LOCAL_DIR` | yes | yes | root of the local driver: `../../.data/storage` from `apps/api` locally; `/data/storage` in the stacks, a named volume (`storage`, `storage_staging`) shared by api and worker so the worker reads uploaded import sheets (ADR-0036) |
| `SENTRY_DSN` | yes | yes | — |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT_MS` | yes | — | the AI assistant (ADR-0045): provider `openai`, `anthropic` or `ollama`; empty = assistant off; the key is a secret like `JWT_SECRET`; the entrypoint removes `LLM_API_KEY` from the worker |
| `AI_DATABASE_URL`, `AI_POOL_MAX` | yes | — | role `ai_reader` (read-only, schema `ai` only); required when `LLM_PROVIDER` is set; the entrypoint removes `AI_DATABASE_URL` from the worker |
| `ADMIN_DATABASE_URL` | one-off | — | only for `provision.js`; production: typed at the prompt, never stored |
| `TEST_ADMIN_DATABASE_URL` | tests | — | Jest harness; local hosts only |

Print-station tokens are not environment variables: each POS PC's token is issued in the admin and stored hashed in `print_stations` (§9.4, ADR-0022, delivery 9); the agent keeps its own copy in its local config file.

Infrastructure is created in the go-live phase (ADR-0026, SPEC §9.4) in this order: RTT measurement from Ulaanbaatar and a fresh price check → domain + Cloudflare DNS → DO project, SGP1 droplet, Managed PostgreSQL 18 (ICU locale; `pnpm db:provision` as `doadmin` creates roles `app`, `migrator` and `ai_reader`), Spaces → Tailscale `tag:server` node and ACL (the tailnet, the office box and `tag:dev` exist since delivery 1) → droplet bootstrap (Docker, tailscaled, Caddy) → GitHub Actions secrets + `deploy.yml` → hello deploy of the staging and production stacks over HTTPS → production PosService on the office box and the store box.

### 10.3 Tailscale from containers (F7)

Primary pattern: `tailscaled` runs on the droplet host; api and worker receive `POSAPI_URL=http://100.x.y.z:7080` (the box's stable tailnet IP; MagicDNS is not relied on inside containers) and reach it through the host's routing. Verified with `docker compose exec api node -e "fetch(process.env.POSAPI_URL + '/rest/info').then((r) => r.text()).then(console.log)"` (the slim image has no wget). If the route is not reachable from the bridge network, the documented fallback is a `tailscale` sidecar container with `network_mode: service:tailscale` for api and worker. Both patterns are written in `deploy/runbook.md`; the ACL tags are `tag:server` (droplet), `tag:posapi` (boxes), `tag:dev` (owner's PC).

### 10.4 CI and test isolation (F4, F5, M17)

`pnpm check` on every PR: `tsc --noEmit` (all packages), eslint (boundaries + the rules in §12), prettier check, `ts:single-version`, jest unit + integration (postgres:18 service, full migrations), vitest (web, shared), `drizzle-kit check` (schema vs migrations), `gen:api` staleness, web build.

- **One database per Jest worker** (ADR-0024): `globalSetup` provisions the roles, migrates a template `tugeel_test_<project>_tpl` once and clones `_w1 … _wN` (N = `maxWorkers`); a setup file points each worker at `_w${JEST_WORKER_ID}`; every test file starts by truncating `public` tables and `pgboss.job`. Jest always runs as `node --experimental-vm-modules` (`apps/api/scripts/jest.cjs`) because NestJS 12 and pg-boss 12 are ESM-only (ADR-0025).
- **Jobs** in `.github/workflows/ci.yml` (runner `ubuntu-24.04`): `check` (`pnpm check` + generated files committed), `images` (both Dockerfiles build), `deploy-config` (`docker compose config` + `caddy validate`). `pnpm ci:rehearse` runs the `check` job in Linux Docker against HEAD before a push.
- **AI assistant** (ADR-0045): `globalSetup` creates `ai_reader` before migrating the template, every worker gets an `AI_DATABASE_URL` for its own database, and the harness deletes every `LLM_*` variable; the question flow is tested with a scripted fake `LLM_CLIENT`.
- **Integrity suite** (`test/integrity/*`) is its own Jest project run with `--runInBand` and `statement_timeout = 5s` so deadlocks fail fast and loudly: concurrent postings over the same stock, overdraw rejection, idempotent re-post, bin-move net-zero, COUNTING bin rejection, concurrent `reserve()` never oversells, concurrent credit confirmations, supersede keeps barcode/price/default, ledger REVOKE/trigger guard, lottery/qrData never logged, Σ payments = total = Σ sub-receipts. **No `jest.retryTimes`, no retries anywhere in CI.**
- **Locale assertion**: the managed cluster and the local containers are created with UTF-8 and the ICU collation `und-x-icu`; the harness runs `SELECT lower('ӨҮЁ') = 'өүё'` at startup and fails if false; search still uses the app-maintained `search_text` column.
- From the go-live phase (ADR-0026), on merge to main: build api + web images → GHCR → SSH `docker compose pull && up -d` on staging → manual approval → production. Migrations run by the api container entrypoint with the `migrator` role. Until then the `images` job builds both images without pushing them.

### 10.5 Migrations (F9)

`pnpm db:generate --name=<module>[_<change>]` produces the SQL (`--custom` for SQL-only files; migrations are numbered from `0000_foundation`); the developer hand-edits it for CHECKs, EXCLUDE, REVOKE, triggers, partitions. `pnpm db:migrate` (`apps/api/src/db/migrate.ts`; `node dist/db/migrate.js` in the api entrypoint) applies it as role `migrator` under one advisory lock: drizzle `migrate()`, the pg-boss CLI `migrate`, `app`'s grants on schema `pgboss`, the grants of schema `ai` (`ai_reader` reads its views, `app` loses its default privileges on them; ADR-0045), then the queues of the job registry (ADR-0024). `drizzle-kit migrate` is not used. Pending migrations run in one transaction, so `CREATE INDEX CONCURRENTLY` cannot be used in them. Roles are never created by a migration: `pnpm db:provision` creates `app`, `migrator` and `ai_reader` once per environment with the admin connection (§5.3) and takes `CONNECT`, `TEMPORARY` and schema `public` away from `PUBLIC`. **`drizzle-kit push` is banned** (no `db:push` script exists) because it diffs `schema.ts` against the live database and silently drops hand-written guards; the integrity suite's guard test would catch the loss, but the rule prevents it. Applied migrations are never edited.

### 10.6 Scaling path and cost

No code change: resize the droplet; a second `worker` container; Managed PG to 2–4 GiB (Standard caps at 4 GiB with no standby from 2026-10/11; Advanced from $130 if HA is ever needed). Launch ≈ $45–60/mo (droplet $24, PG $15.15, Spaces $5, domain) + Tailscale Starter (budgeted, §13) + EAS Starter $19 from the customer-app launch + one-off mini-PC. Full rollout ≈ $90–130/mo; verify prices at creation.

---

## 11. Observability and backups

- Sentry on api, worker, web, mobile with `sendDefaultPii: false`; request/response body capture disabled globally and breadcrumbs for the ebarimt client suppressed (M3). pg-boss job failures → Sentry.
- Scheduled jobs (ADR-0040): the worker writes their cron schedules (Ulaanbaatar time, one catch-up run after a gap) at every start; each run logs its counts and keeps its output in `pgboss.job` for 30 days; a stock drift is logged as an error and raises the admin banner. Until go-live and Sentry, the logs and the banner are where a failure shows.
- pino JSON logs (docker logs, 7-day rotation); the ebarimt client logger serializes only the stored summary.
- The AI assistant logs no prompt, answer, result row or provider body; `ai_questions` is its record (who, when, question, SQL, status, counts, tokens), and a provider failure logs its reason and HTTP status only (ADR-0045).
- `/health` returns `{ status: ok|degraded, db: up|down, pgboss: up|down, version }` (HTTP 503 when degraded) from delivery 1; delivery 3 adds `ebarimt: { status, lastSentDate, leftLotteries, version, checkedAt }`; the `ebarimt.monitor` job refreshes the ebarimt block every 5 minutes from `GET /rest/info`, so the public health endpoint reflects the private box without exposing it (F7). `/health/ebarimt` returns the same block with detail for the admin banner.
- UptimeRobot probes only public endpoints: `https://api.<domain>/health` and the admin; it cannot see the tailnet. DO alerts on CPU, disk and DB connections.
- Backups: DO daily backups + PITR; weekly `pg_dump` to Spaces (independent of DO's backups) by a worker cron job with a verification script; Spaces versioning on POD photos; quarterly restore drill per `deploy/runbook.md`, performed once on staging in the go-live phase before production data is imported (ADR-0026).
- Runbooks: deploy/rollback, restore, rotate secrets, add warehouse/vehicle, e-Barimt outage (sendData backlog, leftLotteries, three-network dependency until the store has its own PosAPI), QPay callback outage, month-end checklist.

---

## 12. Conventions for the AI agent

**Session rules.**
- One code module per session (a delivery spans several sessions); `docs/modules/<module>.md` is read at the start and updated at the end. Start every implementation session in plan mode with the module's §5 subsection open.
- Definition of done: `pnpm check` green, migration + schema in the module, integration tests for every service that touches stock or money, OpenAPI on controllers, admin/mobile screens, module doc and `docs/STATUS.md` updated.
- Each delivery carries a **25–30% support and maintenance allowance** (bug fixes, data cleanup, staff questions); the roadmap durations in `SPEC.md` already include it. Until the single go-live (ADR-0026) it is a reserve for rework and the owner's local acceptance; after go-live it covers support.
- Major upgrades (pnpm 12, Drizzle 1.0, Expo SDK, TypeScript 7, NestJS ESM, the next Node LTS) happen only in dedicated sessions **between** deliveries, never inside one (F8); a quarterly dependency day handles minors.
- When the agent hits a `TODO-VERIFY` item it stops and asks; it never resolves a business unknown by guessing.

**Naming.** snake_case tables/columns, singular module folders, plural table names, `*_id` FKs, `created_at/updated_at timestamptz`; English identifiers and enum values in the DB; Mongolian only in i18n catalogs and user data.

**Money and quantity (F12).** `NUMERIC(14,2)` MNT, `NUMERIC(14,3)` base-unit quantities, `NUMERIC(14,4)` unit costs and `avg_cost`, `NUMERIC(18,6)` factors; the Drizzle custom types `money()`, `qty()` and `cost()` in `apps/api/src/common/db/types.ts` return `Decimal`; all arithmetic via `@tugeel/shared/money` (decimal.js, HALF_UP); unit prices whole MNT, VAT/city tax 2 decimals per line. ESLint `no-restricted-syntax` bans `Number(` and `parseFloat(` in `apps/api/src/modules/**`. VAT and city-tax rates are effective-dated settings, not constants.

**Time.** `timestamptz` (UTC) in the DB; business dates (`effective_date`, report periods, billIdSuffix day, reportMonth windows) in Asia/Ulaanbaatar (UTC+8, no DST) via dayjs + timezone; never `new Date().toISOString().slice(0, 10)` for a business date; `posapi_date` kept verbatim.

**Mongolian Cyrillic.** UI strings are i18next keys in `packages/shared/i18n/mn.json`; ESLint `no-restricted-syntax` rejects string and template literals containing any character of the Cyrillic Unicode block (U+0400–U+04FF) in `**/*.tsx` (test files excluded) and any JSX text containing a letter (Latin or Cyrillic); this selector replaced `eslint-plugin-i18next/no-literal-string`, which skips concise arrow bodies; `search_text` normalisation on import and search; Noto Sans embedded in every PDF; raster printing for receipts.

**Web screens.** Built as `docs/ui.md` says (ADR-0042): the sidebar shell with Ctrl/⌘+K search, `PageHeader` with the menu breadcrumb, the list kit (filter bar, list card, rows that open their record), read-first `DetailCard`s, create dialogs on `?new=1`, toasts for confirmations and `ProblemAlert` for errors; colours and sizes only through the tokens in `apps/web/src/index.css`.

**AI views (ADR-0045).** The assistant reads only schema `ai`. A migration that changes a column an `ai.*` view uses recreates that view in the same migration; a module that opens its data to the assistant adds views and `AI_DATASETS` entries (with the contract test) in its own migration. Views never read credential, session, idempotency, file, audit or import-row tables and expose no column named like a password, hash, token or secret. Model-written SQL runs only through `AiReaderService` after `sqlGuard`.

**Lint guards that exist and must not be deleted (F12)**, `eslint.config.mjs` G1–G6, each proved by `tools/lint-guards/guards.test.mjs` (`pnpm lint:guards`): G1 boundaries plugin (§3.1, including the `src/integrations/**` import restriction to `jobs/` and `*-flow.service.ts` files), G2 `stockLedger` import restriction, G3 `Number(`/`parseFloat(` ban, G4 Cyrillic-literal ban, G5 literal-JSX-text ban, G6 `linterOptions.noInlineConfig` (an `eslint-disable` comment has no effect; exceptions live in the config), and TX_GUARD (`no-restricted-syntax`, added with the AI assistant, ADR-0045) rejecting `fetch(...)`, `axios` and LLM client calls lexically inside `inTransaction(...)` and `.transaction(...)` callbacks in `apps/api/src/**`.

**Testing.**
- Integration tests against real Postgres for every service that touches money or stock; pure unit tests for unit conversion, GTIN normalisation, the pricing resolver (table-driven), state machines and the tax split.
- The integrity suite (§10.4) is mandatory, runs `--runInBand`, and is never skipped, weakened or retried; a failing integrity test is fixed in the service, not in the test.
- Contract tests against recorded sandbox responses for QPay and PosAPI (fixtures under `test/fixtures/<provider>/`), so provider code can be verified without live credentials; recordings are scrubbed of `lottery` and `qrData` before being committed.
- Playwright smoke on the admin once sales exists; mobile flows are tested on a real Android device before each EAS internal release.
- A test that needs the tailnet (`POSAPI_URL` reachable) is tagged `@tailnet` and skipped in CI; it runs from the owner's machine before delivery 3 is accepted.

**ALWAYS**
- Pass the Drizzle `tx` explicitly through service calls that must be atomic; enqueue side effects with pg-boss in the same tx.
- Write audit rows from services inside the tx via `AuditService.record(tx, …)`.
- Allocate document numbers at SUBMIT/POST inside the posting tx.
- Require `Idempotency-Key` on document-creating POSTs and store it.
- Re-run the price resolver at SUBMIT; freeze prices on lines.
- Lock the customer row before a credit check; lock stock rows in the documented order.
- Run `pnpm check` before declaring work done; keep `docs/modules/<module>.md` current.

**NEVER**
- Run `drizzle-kit push`; edit an applied migration.
- Write `stock_ledger` outside `StockPostingService`; write another module's tables.
- Call `Number()`/`parseFloat()` on a NUMERIC value; use floats for money or quantity.
- Make an HTTP call (PosAPI, QPay, SMS, push) while a DB transaction is open.
- Persist or log e-Barimt `lottery` or `qrData` anywhere (DB, logs, Sentry, submission log) — the single exception is the rendered receipt bitmap in `print_jobs.payload`, nulled on ack and expired after 10 min (ADR-0022).
- Mark a payment paid from a callback body; blind-retry a timed-out PosAPI call.
- Write literal Cyrillic in `.tsx`; hard-code VAT or city-tax rates.
- Add `typescript@7` to any package; mix TypeScript versions; upgrade a major inside a delivery session.
- Use `@nestjs/event-emitter` for state changes; add Redis, mailpit or an email dependency before a feature needs it.
- Add `jest.retryTimes` or any retry to CI; skip the integrity suite.
- Expose PosAPI port 7080 beyond the tailnet ACL.
- Send a credential to an LLM provider; log a prompt, an answer or result rows; run model-written SQL outside `AiReaderService`, or as any role but `ai_reader`.

---

## 13. Assumptions and TODO-VERIFY register

Business and external unknowns only; tooling is decided. Owner = the person who must answer; "before" = the delivery that cannot start until answered. The "SPEC §11 #" column maps each item to the owner-facing register in `docs/SPEC.md` §11 (numbered differently; `docs/STATUS.md` quotes both numbers). SPEC §11 #14 (latency) is assumption A4 above, not a T item; T8 has no SPEC row.

### 13.1 Assumptions (stated, not verified)

| ID | Assumption | Consequence if wrong |
|---|---|---|
| A1 | Tailscale commercial use requires the paid Starter plan (budgeted per user/month); the personal plan is not relied on. | Cost line only. |
| A2 | The official PosService .deb launcher self-updates hourly and runtime versions change under us (3.2.48 → 3.2.50 observed); the client tolerates additive response changes and `ebarimt.monitor` records the running version. | A breaking runtime change surfaces as ERROR rows and a health alert. Downgrading the runtime is not possible, which is one more reason the fallback provider exists. |
| A3 | Scanner, handheld and printer models are chosen after the week-1 hardware test; the printing pipeline is raster so the printer brand does not matter (M14). | Only purchasing timing changes. |
| A4 | RTT Ulaanbaatar → DO SGP1 is 100–150 ms (measured in the go-live phase before the droplet is created, ADR-0026); if it exceeds ~150 ms sustained, the region decision is revisited then. | Hosting region change before anything is deployed. |
| A5 | Company lookups via getTinInfo still work; citizen-registry lookups are treated as unavailable. | Individuals' TINs are always typed or imported manually. |
| A6 | On DO Managed PostgreSQL `doadmin` is not a superuser, so `ALTER ROLE ai_reader SET temp_file_limit` is refused there; provisioning skips it with a notice (ADR-0045), checked when the cluster is created. | A large AI query may spill temporary files until the statement timeout (15 s) stops it. |

### 13.2 TODO-VERIFY register

| ID | SPEC §11 # | Question | Owner | Needed before | Where it lands |
|---|---|---|---|---|---|
| T1 | 1 | Can a single-company in-house system be certified as "Хэрэглэгчийн систем нийлүүлэгч"? Does PosAPI on an office box over Tailscale count as "installed in the user system"? Can the exam demo run with the backend abroad? Fees and lead time? (F2) | Owner → posapi@itc.gov.mn, Week 0 | delivery 3; gate 2026-11-13 | §5.9 certification gate; fallback provider switch |
| T2 | 2 | Receipt timing for credit sales: B2B_INVOICE at dispatch + payment receipts with `invoiceId`, or B2B_RECEIPT at delivery? (M5) Default in force: (a) invoice at DELIVERED with delivered quantities (or at pickup handover) and B2B_RECEIPT issued then, per SPEC §6.11 #8 | Accountant | delivery 3 | §5.6 invoice step; §5.7 driver printing moves to delivery 5 if the driver prints the receipt |
| T3 | 3a, 3b, 4 | Is the company a city-tax (НХАТ) payer and a VAT payer today; how many customer shops are VAT payers; how many customers are individuals without a TIN? (#4 answered 2026-10-11: many individuals, consumer numbers mostly unobtainable → many printed lottery receipts, sized with T2) | Accountant / owner | delivery 2 (pricing display), delivery 3 | §5.4 tax split, §5.5 receipt type mix |
| T4 | 8 | SMS provider (operator API or aggregator), sender-name approval, lead time (M13) | Owner, Week 0 registration | delivery 6 | §7 OTP; fallback = rep sets initial password |
| T5 | 16 | QPay: sandbox credentials still valid; vendor API credential issuance after the business.qpay.mn contract; acceptability of the `/v2/payment/list` sweep; callback method/payload/retry policy; token lifetime | Owner → support@qpay.mn, Week 0 | delivery 5 | §5.8 |
| T6 | 17 | e-Barimt payment code for SocialPay-via-QPay (assumed BANK_TRANSFER_QPAY); allowed `measureUnit` values; DELETE /rest/receipt time window; reprint/QR-regeneration policy | Owner → ITC | delivery 3 | §5.9 |
| T7 | 15 | PosAPI behaviour on duplicate `billIdSuffix`, local-DB lookup by billIdSuffix/posNo/date, forced-timeout behaviour (M6 spike) | Owner + agent, Week 0/1 staging spike | delivery 3 | §5.9 INDETERMINATE resolver |
| T8 | — | Khan Bank: QPay merchant credentials via the bank; Corporate Gateway contract terms, IP whitelisting, statement API version | Owner → Khan Bank | delivery 10 | §5.8 statement puller |
| T9 | 9 | Backorder policy at confirmation: reject, partial-approve with backorder, or hold; per tier or global. Default in force until answered: partial confirm + `qty_backordered`, same for every tier (§5.3) | Owner | delivery 2 | §5.3 reservation rule, §5.6 |
| T10 | 10 | Returns policy: at delivery only or later via reps/drivers; credit for damaged goods | Owner | delivery 5 | §5.6 returns, §5.7 |
| T11 | 6 | Supermarket today: POS hardware, printer, scanner, card terminal model (terminal data entry manual vs integrated); does it issue e-Barimt through another system that must keep running until delivery 9? | Owner | delivery 9 | §5.8 PAYMENT_CARD, §9.4 agent |
| T12 | 7 | Staff devices: will reps/drivers require iPhones? (Bluetooth Classic printers and most rugged scanners are Android-only) | Owner | delivery 4 | §8, §9.4 |
| T13 | 5 | Current pricing structure: number of tiers, contract-price volume, per-product vs per-category vs per-order breaks, any VAT-exclusive prices (answered 2026-10-13, ADR-0041: one price for everyone, stacked discounts; 2026-10-14, ADR-0048: one warehouse price per product and central price profiles; still open: VAT-exclusive prices, for the accountant) | Owner; VAT: accountant | delivery 2 | §5.4 import format |
| T14 | 11 | Growth: more branches, a second supermarket or city within two years | Owner | after delivery 1 (re-asked before delivery 9) | §10.6 scaling, Managed PG edition |
| T15 | 12 | Payroll: commission schemes, allowances, non-standard contracts; accountant review of НДШ/ХХОАТ tables | Accountant | delivery 11 | §5.10 |
| T16 | 13 | Accounting software in use and whether an export is needed soon | Accountant | delivery 10 | out of scope today |
| T17 | 20 | Number of days of the one payment term (`credit.payment_term_days`) | Accountant | delivery 3 | §5.5; the setting has no value until then |
| T18 | 21 | Credit decision for a customer whose limit is not decided (NULL): approval, block, or no limit. Default in force: NEEDS_APPROVAL | Owner, accountant | delivery 3 | §5.5 credit check |
| T19 | 22 | How sales-rep and delivery zones are drawn (districts, map polygons, streets, customer lists) and whether they are the same zones | Owner | delivery 5 | §4 delivery row, §5.7; `customer_addresses.zone_id` |
| T20 | 24 | Does sending customers' personal data (names, phones, registration numbers / TINs, addresses, GPS) to a foreign AI provider need consent or a contract under Mongolia's personal data law? Default in force: sent, by the owner's decision of 2026-10-13 | Owner → lawyer | daily use of the AI assistant | §5.11, §9.5; SPEC §6.14 #3 |
| T21 | 25 | The provider's data retention and training terms for API traffic; the monthly budget limit set in the provider's console | Owner | go-live phase | §9.5 (`store: false` already sent) |

Resolved answers are moved from this register into the relevant section with a dated note; the register in `docs/STATUS.md` tracks who is chasing each item.
