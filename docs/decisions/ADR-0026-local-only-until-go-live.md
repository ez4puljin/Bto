# ADR-0026: Local-only development; one production deployment after the last delivery

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-10 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0006 (store listings), ADR-0012 (when hosting is created), ADR-0014 (when the Spaces driver is built), ADR-0015 (go-live import), ADR-0017 (where the week-1 spike runs) |
| Amended by | ADR-0077 (#3 and its delivery-3 follow-up: the cut-over imports Erkhet's chart and the opening full trial balance instead of opening receivables per customer, and the delivery-3 opening-receivables importer becomes the chart and opening import) |

## Context

The foundation documents planned an incremental go-live: staging and production over HTTPS in delivery 1 (SPEC §8.1 #1, a "hello" deploy in week 1), every later delivery going live when done, sales live after deliveries 2 and 3, and the hosting accounts, domain and RTT measurement in Week 0. On 2026-10-10, after the week-1 scaffold, no droplet or domain existed. The owner decided to develop only on the local machine and to deploy to an external server at the very end. Asked to choose between "at the end of each delivery", "once sales can go live (after delivery 3)" and "after all deliveries", the owner chose **after all deliveries**.

Facts: the scaffold already builds both images and validates the production and staging compose files and the edge Caddyfile in CI (`images` and `deploy-config` jobs), and the staging stack ran behind the edge Caddy on the owner's machine (`http://staging.localhost:8080`). Later deliveries depend on things outside that machine: PosAPI on the office mini-PC (Mongolian IP addresses and the tailnet only), QPay (callbacks need a public URL), an SMS provider, Expo builds on real devices, the POS print agent (it polls the API), and store review of the customer app (it needs a reachable backend).

## Decision

1. **The owner's machine is the only environment until go-live.** Deliveries 1–11 are built, tested and accepted locally: `docker compose up -d --wait` (PostgreSQL 18), `pnpm dev`, `pnpm check` (also run by GitHub Actions on every push). No droplet, managed database, domain, Spaces bucket, Sentry or UptimeRobot is created, and no `deploy.yml` is written, before the go-live phase.
2. **Local acceptance replaces per-delivery go-live.** A delivery is done when its must-have list passes on the local environment, `pnpm check` is green and the owner has walked through its screens with real data imported locally. Status values in `docs/STATUS.md`: `not started` → `in progress (week N)` → `accepted locally (date)` → `live (go-live date)` → `maintenance`.
3. **Go-live phase** (row 12 in `docs/STATUS.md`, SPEC §9.4) after delivery 11, estimated at 4–6 weeks plus hypercare:
   - re-verify the hosting facts (prices, DigitalOcean plan limits, RTT Ulaanbaatar → SGP1); ADR-0012 stays the target, and a different target needs a new ADR;
   - create the accounts and the infrastructure in the order of `docs/architecture.md` §10.2, write `.github/workflows/deploy.yml`, hello deploy of staging and production over HTTPS (`deploy/runbook.md`);
   - the Spaces storage driver, the weekly `backup.pgdump` job, Sentry, UptimeRobot, the restore drill on staging;
   - production PosAPI on the office box and the supermarket box, the server's tailnet node, QPay production credentials and callback URL, the SMS sender;
   - data migration from fresh exports at cut-over, staging first: products, customers, price lists, opening stock counted at go-live (with cost), opening receivables per customer;
   - staff training per role, staff and customer app releases pointing at the production API (store listings), the cut-over, then hypercare (the support allowance moves here).
4. **Deploy readiness is tested continuously.** The CI `images` and `deploy-config` jobs stay. A change to runtime configuration (environment variables, ports, volumes, entrypoint) updates `deploy/`, `deploy/.env.example` and `docs/architecture.md` §10.2 in the same commit. Rehearsing with `pnpm docker:build` and the local staging stack at the end of a delivery is recommended, not a gate.
5. **Integrations during development run from the owner's machine.** The PosAPI staging package on the office mini-PC is reached over Tailscale (`tag:dev`, staging instance only, `docs/architecture.md` §9.1) for the week-1 spike and delivery 3. QPay uses its sandbox with `payment/check` and the sweep: a callback cannot reach a local machine, and the design never depends on one (ADR-0018). Expo development builds and the POS print agent reach the API at the machine's LAN address. The customer app gets no store listing before the go-live phase.
6. **Business continuity.** Until go-live the company keeps its Excel and manual processes, and the supermarket its current POS and e-Barimt arrangement (SPEC §11 #6). Real Excel files are imported locally in delivery 1 to prove the importers. Data cleanup happens in the owner's source files, because go-live imports fresh exports.
7. **Unchanged.** The target hosting (ADR-0012). Spaces as the store, with `STORAGE_DRIVER=local` for development (ADR-0014). The e-Barimt certification gate on 2026-11-13 (ADR-0017): it decides the provider before delivery 3 regardless of hosting, and the exam itself may take place any time before go-live. The Week-0 registrations with long lead times, the delivery order and the durations. Until go-live, the 25–30 % support allowance in each delivery is a reserve for rework and local acceptance. Bridge features that served production between deliveries stay as development stubs and manual fallbacks unless the owner drops one at its delivery's kickoff: the office delivery-confirmation screen (delivery 2), `AllowAllCreditChecker` (until delivery 3), `BANK_MANUAL` entries (until delivery 10) and rep-set customer passwords.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Deploy at the end of each delivery (the previous plan without the week-1 hello deploy) | Recommended in the session for early feedback from real use; the owner chose a single go-live. |
| First deploy once sales can go live (after delivery 3), then per delivery | Not chosen by the owner. |
| Keep the week-1 hello deploy | No droplet or domain exists; the owner wants the time spent on the system itself. |

## Consequences

**Positive.** No hosting cost (about $45–60 per month) and no server administration for roughly a year. Every session works against one environment. The deploy files stay valid through CI, so the go-live phase starts from a tested baseline.

**Negative.** Feedback from real use arrives only at go-live, and staff keep working in Excel for about a year. The cut-over is large: every module, every role and all data at once, so it needs its own plan, training and possibly a short parallel run. The production paths (SGP1 → tailnet → office box, QPay callbacks, store review) are exercised for the first time in the go-live phase. Hosting prices and plans may change in the meantime.

**Follow-ups.**
- 2026-10-10: SPEC §1, §4.1, §5.7, §6.11, §7, §8, §9 (new §9.4), §11; `docs/architecture.md` §0, §1, §2, §4, §8, §10, §11, §12, §13.1; `docs/STATUS.md` (row 12, Week 0 checklist); `CLAUDE.md`; `deploy/runbook.md`; `deploy/ebarimt-box/README.md`.
- Delivery 3: an opening-receivables importer (customer balances as of cut-over) on the import pipeline (ADR-0015), posting into `finance`; the go-live data migration needs it.
- Go-live phase kickoff: write the cut-over plan with the owner (freeze dates, go-live stocktake, parallel run or not).

## Related

ADR-0006, ADR-0012, ADR-0014, ADR-0015, ADR-0017, ADR-0018, ADR-0023, `docs/SPEC.md` §8, §9, `docs/architecture.md` §10, §11.
