# Tugeel — STATUS

Updated: 2026-10-10 (delivery 1, week 1: scaffold). This file is the hand-over between Claude Code sessions: read it first, update it last. English, like `docs/architecture.md`; `docs/SPEC.md` is Mongolian.

## Current state

| | |
|---|---|
| Phase | Delivery 1, week 1: **monorepo scaffold done** (no business module yet). `pnpm check` green locally (Git Bash and PowerShell), in the Linux rehearsal and on GitHub Actions (first run 37983709359 on `ed43720`: check, images api/web, deploy-config all green, 100 s) |
| Documents | `docs/SPEC.md` (mn, v0.1), `docs/architecture.md` (v0.2), `docs/decisions/ADR-0001` … `ADR-0025` with index (next free: ADR-0026), `CLAUDE.md` (pins confirmed 2026-10-10), `README.md`, `deploy/runbook.md`, `deploy/ebarimt-box/README.md` |
| Repository | `github.com/ez4puljin/Bto`, **public** (owner decision 2026-10-10, knowing that docs and code are world-readable; never commit secrets). Commits use the GitHub noreply address `75930160+ez4puljin@users.noreply.github.com` |
| Infrastructure | nothing created yet: DigitalOcean, Cloudflare, Tailscale, office mini-PC, devices are all Week 0 items. `deploy/` (compose stacks, edge Caddyfile, Dockerfiles) is written and was verified locally (staging stack behind the edge Caddy: `/health` 200, SPA with security headers) |
| Next deliverable | Delivery 1 (SPEC §8 definition of done, §9.2 week plan): week 1 continues with the hello deploy (when the droplet and domain exist) and `identity`; Week 0 owner items still open (checklist below) |
| Decisions made on 2026-10-10 | Node 26 everywhere (ADR-0023); foundation migration `0000_foundation`, guards in the owning module's migration, pg-boss schema installed by `db:migrate` (ADR-0024); CommonJS packages with a `@tugeel/source` condition, Jest with `--experimental-vm-modules` (ADR-0025); `eslint-plugin-i18next` replaced by a JSX-text selector; React Router stays on 7.18.4 |
| e-Barimt certification gate | **2026-11-13** = end of delivery 1 (SPEC §9.1 #1, architecture §5.9, ADR-0017). Without written ITC confirmation by then, switch `EBARIMT_PROVIDER` to the fallback provider |
| Owner's answers already applied in the documents | PosAPI 3.0 on an office Ubuntu mini-PC over Tailscale (second instance at the supermarket in delivery 9); customers are a mix of companies and individuals (`customer.kind`: companies always `B2B_RECEIPT`, individuals B2B when a TIN is known else B2C with `consumer_no` when known — SPEC §6.10); no van sales; Khan Bank is the main bank; the supermarket has a card terminal (`PAYMENT_CARD` with terminal data); SPEC in Mongolian, everything else English; repo `tugeel`, packages `@tugeel/*` |

## Module status

Delivery numbers follow SPEC §9.2–§9.3 and the "Delivery" column of architecture §4. Durations already include the 25–30 % support and maintenance allowance. "Earliest start" counts from Week 0 = 2026-10-12 and assumes every earlier delivery lands on time; re-plan it at the end of each delivery. Status values: `not started` → `in progress (week N)` → `live (date)` → `maintenance`.

| # | Deliverable | Modules / scope | Duration (SPEC §9) | Earliest start | ADRs to read first | Status |
|---|---|---|---|---|---|---|
| 1 | Foundation + web admin | scaffold, CI/CD, staging + production over HTTPS, restore drill; `identity`, `catalog`, `partners` (minimal), `inventory` core (ledger guards, balances, receipts, put-away, adjustments, two-step transfers, stocktake backend (tables, `COUNTING` guard, integrity case; UI below the cut line per SPEC §8.2 #3), reconciliation SQL + cache rebuild script and snapshot tables (the nightly pg-boss schedule is cut-line item SPEC §8.2 #5); movement-history screen, label page, stocktake UI, low-stock report, nightly pg-boss schedule and other pg-boss jobs only if time allows — SPEC §8.2 cut line, in that order), `imports` (products, customers, opening stock with cost); web camera + HID scanning; Week 0/1 registrations and the PosAPI spike | Week 0 + 4 weeks (+ ~1 week reserve) | 2026-10-12 (Week 0) | 0001–0005, 0007, 0008, 0010, 0011, 0012, 0013, 0014, 0015, 0016, 0019, 0020, 0021 | in progress (week 1: scaffold done 2026-10-10) |
| 2 | Pricing + orders + picking | `pricing`, `sales` (office channel, approval with `AllowAllCreditChecker`, reservations with confirm-time backorder, picking waves, packing, pickup, office screen confirming `PACKED → DELIVERED` with delivered quantities until trips arrive in delivery 5 — SPEC §9.3 row 2), `partners` full, price-list Excel import | 4–5 weeks | week 6 | 0008, 0009, 0010, 0015, 0016 | not started |
| 3 | Finance I + e-Barimt B2B | `finance` (invoices, AR ledger, credit control replacing the stub, cash registers, cash/bank payments incl. manual `BANK_MANUAL` entry, aging), `ebarimt` (office PosAPI, B2B receipts plus B2C for individuals without a TIN, voids, `inactiveId`, sendData, monitor, `/health/ebarimt`). **Sales go-live only after 2 and 3 are both done.** Provider finalised by the gate result | 5–6 weeks | week 11 | 0010, 0013, 0017, 0018 | not started |
| 4 | Staff app v1 | Expo project created now, `APP_VARIANT=staff`, `useScanner`, warehouse scan flows, EAS development build + internal distribution + EAS Update; **Expo SDK pinned at kickoff** and recorded in `docs/modules/mobile.md` | 4–5 weeks | week 17 | 0006, 0020, 0021 | not started |
| 5 | Delivery + QPay + push | `delivery` (zones, vehicles as `VEHICLE` warehouses, trips, driver role, POD, partial/failed stops, cash sessions), QPay Merchant v2 (intents, callback-then-check, sweep), `notifications` push; driver raster receipt printing moves here from delivery 10 if the accountant wants the driver to print the receipt (SPEC §11 #2, §6.11 #8) | 5 weeks | week 22 | 0007, 0013, 0018, 0021 | not started |
| 6 | Customer app | `APP_VARIANT=customer`: SMS OTP login, catalog with own prices, cart with server quotes, idempotent orders, tracking, invoices/balance, QPay, push; store publishing; EAS Starter plan | 5–6 weeks | week 27 | 0005, 0006, 0018, 0020 | not started |
| 7 | Sales rep | rep role in the staff app: visit plan, customer card with receivables, order taking, manual-discount caps, payment collection, visit log | 3–4 weeks | week 33 | 0006, 0009 | not started |
| 8 | Procurement | `procurement`: purchase orders, receiving against PO, supplier price history, reorder suggestions, supplier bills to finance | 3–4 weeks | week 37 | 0007, 0008 | not started |
| 9 | Supermarket POS | POS screen inside the admin, print agent on the POS PC, Ethernet 80 mm printer, card-terminal data entry, **second PosAPI instance at the store**, B2C receipts with lottery, returns, shift close | 4–5 weeks | week 41 | 0017, 0021, 0022 (accept 0022 before starting) | not started |
| 10 | Finance II + reporting | bank statement import and matching, cash/bank books, reminders, VAT/city-tax reports; `reporting` dashboards, materialized views, Excel export; driver/rep raster printing (if not pulled into 5) | 4–5 weeks | week 46 | 0018, 0021 | not started |
| 11 | HR + payroll | `hr`: employees, attendance, leave, payroll runs from effective-dated НДШ/ХХОАТ tables, payslip PDFs, bank salary export; accountant reviews the tables first | 5 weeks | week 51 | 0010 | not started |

Later sessions, not scheduled: lot/expiry activation with FEFO (ADR-0019), driver-app offline queue (ADR-0020), Khan Bank corporate gateway puller, direct SocialPay/Byl provider, upgrade sessions (pnpm 12, Drizzle 1.0, TypeScript 7 once the Nest CLI supports it, NestJS ESM, Expo SDK, React Router 8, TanStack Table 9), ledger partitioning when it nears ~20 M rows.

## Week 0 checklist for the owner

Everything here is owner-driven (registrations, purchases, accounts, emails); a Claude Code session cannot do any of it. Sources: SPEC §9.1, architecture §8, §9, §10.2, §13. Tick items here and write dates next to them.

| # | Item | Detail | Done |
|---|---|---|---|
| 1 | Email `posapi@itc.gov.mn` | Ask the three questions of SPEC §11 #1: can a single-company in-house system be certified as "Хэрэглэгчийн систем нийлүүлэгч"; does PosAPI on an office box reached over Tailscale count as installed in the user system; may the exam demo run with the backend abroad; plus fees and lead time. **Decision gate 2026-11-13.** Record the send date and the reply here | [ ] |
| 2 | Director's digital signature | Non-Monpass provider (Гэрэгэ / Инфосерт / Тридум); required for the certification contract | [ ] |
| 3 | Office Ubuntu mini-PC for PosAPI | amd64, Ubuntu, official PosService 3.0.12 launcher (.deb, staging package first), joined to Tailscale, PosAPI bound to the `tailscale0` address on port 7080 only; budget 2–3 days; the step list lives in `deploy/ebarimt-box/` (written in delivery 1) | [ ] |
| 4 | Accounts, all with 2FA | DigitalOcean (SGP1 project), Cloudflare (DNS), Tailscale (tailnet with tags `tag:server`, `tag:posapi`, `tag:dev`; Starter plan budgeted), GitHub, Sentry | [ ] |
| 5 | Domain | `admin.<domain>`, `staging.<domain>`, `api.<domain>` on Cloudflare DNS | [ ] |
| 6 | QPay | Merchant contract at `business.qpay.mn`; then request vendor API credentials (`invoice_code`, client id/secret) from QPay (`info@qpay.mn` / `support@qpay.mn`) or Khan Bank (`merchant@khanbank.com`); ask about the `payment/list` sweep while at it (SPEC §11 #16) | [ ] |
| 7 | App-store organisations | D-U-N-S number → Apple Developer organisation → Google Play organisation → Expo organisation; lead time is measured in weeks, start now even though mobile begins in delivery 4 | [ ] |
| 8 | SMS provider | Choose an operator API or an aggregator, sign, get the sender name approved (OTP in delivery 6; SPEC §11 #8) | [ ] |
| 9 | Devices, ordered on day 1 | **2 Bluetooth HID barcode scanners** (must arrive before the delivery-1 go-live); 1 keyboard-wedge Android handheld; 1 Android POS-style device with built-in printer (Sunmi class); 1 dual-mode (Classic + BLE) 58 mm Bluetooth printer; 1 Ethernet label printer with documented TSPL/ZPL; 1 Ethernet 80 mm receipt printer. Models are finalised after the week-1 "Төв Үнэ ө ү" print test | [ ] |
| 10 | Accountant questions | SPEC §11 #2 (receipt timing for credit sales, needed before delivery 3), #3a (VAT and city-tax payer status and rate, needed before delivery 2), #3b (customer VAT-payer mix, before delivery 3), #19 (credit tolerance, before delivery 3); #13 (accounting software) when convenient. Decide #9 (backorder policy) and #18 (manual-discount caps) yourself before delivery 2 | [ ] |
| 11 | Latency measurement | One week of RTT from Ulaanbaatar to DigitalOcean SGP1; if it stays above ~150 ms, revisit the region before delivery 2 (SPEC §11 #14) | [ ] |
| 12 | GitHub repository | Done 2026-10-10: `github.com/ez4puljin/Bto` is **public** by the owner's decision (planned private); `origin` added, the GitHub "Initial commit" merged, not overwritten. Add Actions secrets once the droplet exists; decide then whether the GHCR packages are public or the droplet gets a `read:packages` token | [x] |

## Decisions pending

Open business questions from SPEC §11 (full wording and defaults there), mapped to architecture §13.2 by the T column: the two registers are numbered differently, so always quote both numbers. SPEC #14 is an assumption (architecture §13.1 A4), not a T item; SPEC #18 and #19 are settings defaults with no T item; T8 has no SPEC row because it concerns only the delivery-10 bank integration. The system is built on the default until the answer arrives. Items the owner has already answered (PosAPI location, customer mix, van sales, bank, card terminal) are not listed.

| SPEC §11 # | T (arch. §13.2) | Question (short) | Owner | Needed before | Default in force |
|---|---|---|---|---|---|
| 1 | T1 | ITC: certification of an in-house system; office box over Tailscale accepted; exam with the backend abroad | Owner → ITC | gate 2026-11-13 | proceed with the office box; fallback provider if no written confirmation |
| 2 | T2 | Receipt timing for credit sales: (a) invoice + `B2B_RECEIPT` at delivery, or (б) `B2B_INVOICE` at dispatch + payment receipts with `invoiceId` | Accountant | delivery 3 | (a) invoice at DELIVERED with delivered quantities (or at pickup handover) and `B2B_RECEIPT` issued then; whether the driver prints the receipt is the accountant's call — if yes, driver raster printing moves from delivery 10 to delivery 5 and driver printers are ordered in Week 0 (SPEC §6.11 #8, architecture §5.6) |
| 3a, 3b | T3 | Company VAT and city-tax payer status and rate (3a); customer VAT-payer mix, 2027 threshold effect (3b) | Accountant | delivery 2 (rates for pricing display), delivery 3 | company pays VAT and city tax (2 %); `vat_payer` from getInfo; rates effective-dated |
| 4 | T3 (shared) | How many individual customers without a TIN; how TINs or e-Barimt consumer numbers (`consumer_no`) are collected | Owner | delivery 3 | few; manual TIN or `consumer_no` entry, otherwise B2C receipt with lottery printed at the office and handed over with the next delivery (SPEC §6.10) |
| 5 | T13 | Current price structure: tiers, contract prices, break type, any VAT-exclusive prices | Owner | delivery 2 | 2–4 tiers; per-product breaks in base units; all prices VAT-inclusive |
| 6 | T11 | Supermarket's current POS, printer, scanner, e-Barimt system until delivery 9 | Owner | delivery 9 (devices ordered in 8) | keep the current system until 9; new Ethernet 80 mm printer + USB scanner |
| 7 | T12 | Must reps or drivers use iPhones? | Owner | delivery 4 | Android-first; iOS later with dual-mode printers |
| 8 | T4 | SMS gateway choice and contract date | Owner | Week 0 (used in delivery 6) | phone + password; a rep sets the initial password |
| 9 | T9 | Backorder policy at confirmation; per tier or global | Owner | delivery 2 | partial confirm + backorder, same for all tiers (SPEC §6.4 #4, #5) |
| 10 | T10 | Returns: at delivery only or later via reps/drivers; full credit for damaged goods | Owner | delivery 5 | both; full credit (SPEC §6.9 #2) |
| 11 | T14 | Growth within two years: branches, second supermarket, another city | Owner | after delivery 1 | no; one droplet, one schema |
| 12 | T15 | Payroll: commissions, allowances, non-standard contracts; accountant reviews НДШ/ХХОАТ tables | Accountant, owner | delivery 11 | no commissions; standard contracts; accountant reviews |
| 13 | T16 | Accountant's software; export needed soon? | Accountant | delivery 10 | no export; Excel exports suffice |
| 14 | A4 (§13.1) | Latency Ulaanbaatar → SGP1; move to Vultr Seoul/Tokyo if > ~150 ms | Owner | Week 0 | Singapore stays; measured in Week 0 |
| 15 | T7 | PosAPI: response to a duplicate `billIdSuffix`; local-DB lookup; forced timeout | Week 1 spike (staging) | week 1 | assume duplicates are created; `INDETERMINATE` = manual accountant queue |
| 16 | T5 | QPay: `payment/list` sweep acceptable; callback format; token lifetime | QPay support | delivery 5 | acceptable; callback answered `200 SUCCESS`; lifetime read from the token response |
| 17 | T6 | e-Barimt: DELETE time window, SocialPay payment code, allowed `measureUnit` values | ITC | delivery 3 | within the month; `BANK_TRANSFER_QPAY`; free text |
| 18 | — | Manual discount cap per role (rep 3 %, office 5 %, owner unlimited) | Owner | delivery 2 | per-role setting, over cap → `APPROVAL_PENDING` (SPEC §6.1 #9) |
| 19 | — | Credit-limit tolerance `credit_tolerance_pct`: how far over the limit goes to approval, above that blocked | Owner, accountant | delivery 3 | 10 %; above the tolerance `BLOCKED`; one setting for all customers (SPEC §6.2 #2) |
| — | T8 | Khan Bank: Corporate Gateway contract terms, IP whitelisting, statement API version; QPay credentials via the bank | Owner → Khan Bank | delivery 10 | statement import from downloaded files in delivery 10; the gateway puller stays a later, unscheduled session |

When an answer arrives: write the date and the answer in this table, update SPEC §11 and the affected §6 rule, and move the T item out of architecture §13.2 (or the A item out of §13.1) with a dated note.

## Next session

Continue delivery 1 with this prompt (plan mode):

> Read `CLAUDE.md`, `docs/STATUS.md`, `docs/SPEC.md` §4, §5.1, §6 and §8, `docs/architecture.md` §0, §4 (identity row), §6, §7 and §12, then ADR-0002, ADR-0004, ADR-0005, ADR-0011, ADR-0016 and ADR-0024. First confirm that the latest GitHub Actions run on `main` is green (`https://api.github.com/repos/ez4puljin/Bto/actions/runs?branch=main&per_page=3`); fix it before anything else if it is red. If the Week-0 items 4 and 5 (DigitalOcean droplet + Managed PostgreSQL, domain on Cloudflare) are done, start with the hello deploy: write `.github/workflows/deploy.yml` (build and push `bto-api`/`bto-web` to GHCR tagged `sha-<sha>`, SSH to the droplet, staging then production with manual approval) and follow `deploy/runbook.md` §2–§3. Then build the `identity` module (delivery 1, weeks 1–2): start with a short interview round on its business rules (staff roles and what each may do, branch/warehouse scoping, password policy, who creates users), then plan; tables users, roles, permissions, role_permissions, user_roles, user_scopes, auth_sessions, password_resets, branches, warehouses, settings, number_sequences, audit_log, idempotency_keys, files in migration `0001_identity` (`pnpm db:generate --name=identity`); argon2id login, 15-minute access JWT + rotating refresh tokens, `PermissionsGuard`/`@RequirePermission`, `AuditService.record(tx, …)`, `IdempotencyInterceptor`, `NumberingService.next(tx, scopeKey, period)`, admin login + users/roles/branches/warehouses screens in Mongolian; integration tests for every service; `docs/modules/identity.md`; `pnpm check` green. Pin argon2 with `npm view argon2 version` (older than 24 h) and add `argon2: true` to `allowBuilds`. Update `docs/STATUS.md` before finishing.

Week-1 spike (owner + session, needs the mini-PC on the tailnet): issue one staging receipt through PosAPI from the droplet; re-submit the same payload with the same `billIdSuffix` and record the response; test the local-DB lookup and a forced timeout; print "Төв Үнэ ө ү" on every candidate printer (SPEC §9.2 week 1, architecture §5.9, ADR-0017). Results go into architecture §5.9 and SPEC §11 #15.

### Session hand-over rule

Every session ends by updating this file: the "Current state" table, the row of the module worked on (status, week, blockers), the Week 0 checklist and "Decisions pending" if anything was answered, and a fresh "Next session" prompt. Pins confirmed on day 1 go into `CLAUDE.md`, not here. A session that changes a decision writes a new ADR and updates the index in `docs/decisions/README.md`.

### Session log

| Date | Session | Result |
|---|---|---|
| 2026-10-09 | Foundation documents | SPEC, architecture, ADR-0001 … ADR-0022, CLAUDE.md, STATUS.md, README.md, .gitignore written; no code |
| 2026-10-10 | Delivery 1 week 1: scaffold | pnpm 11.28.2 workspace (Node 26, TypeScript 6.0.3, ESLint 10 guards G1–G6 with a self-test), `packages/shared` (ErrorCode, Decimal), `packages/api-client` (generated from OpenAPI), `apps/api` (NestJS 12: env, logging, problem+json, Drizzle + NUMERIC types, `0000_foundation`, `db:provision`, `db:migrate` with pg-boss 12, `system.ping` job, `/health`, worker health), Jest unit 20 / integration 15 / integrity 13, `apps/web` (Vite 8, React 19, Router 7, shadcn radix-nova, Mongolian system-status page, 3 tests), Dockerfiles, `deploy/` stacks + edge Caddy (verified locally), CI workflow, `pnpm ci:rehearse`; ADR-0023/0024/0025. Pushed to `github.com/ez4puljin/Bto`; first CI run green |
