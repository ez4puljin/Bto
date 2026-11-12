# ADR-0192: More api processes: replicas for the apps' routes and for the reports, the primary for everything that keeps state

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «API-г олон урсгал дээр ажиллуулах ажлыг эхлүүл», «bto300 болон ажилчдын апп дээр ямарч гацалтгүй хоцрогдол байх ёсгүй», «32gb ram болон 24 урсгал тус бүрийг уян хатан зохицуулж ажиллах»), Claude (the direct-mode session) |
| Amends | architecture §10.2 and §10.7 (one api process serves all requests), ADR-0027 #9 and ADR-0185 #6 (their «one api process» now reads «the primary») |

## Context

The api is one Node process, and Node runs JavaScript on one thread. The load test of 2026-11-13 measured what that means on the PC of ADR-0187 (24 threads, 30 GB): the app's shop page costs about 25 ms of that one thread, so the whole centre answers about 40 of them a second however large the database pool is; fifty phones at once wait 1.3 s and a hundred and fifty 3.8 s. Twenty-three threads stand idle meanwhile. A heavy report runs on the same thread and holds the same pool: eight at once left the lists and the apps with errors (ADR-0191 moved that wall, it did not remove it).

The owner's order of importance: the two apps, «Bto300» and the staff app, must never lag; the PC's threads and memory are to be used.

A second process is not free. The api keeps a few things in its own memory, found by reading every field and module-level value of `apps/api/src` that outlives a request:

| What | Where | Why it matters with more processes |
|---|---|---|
| Failed sign-ins per address and login | `LoginLimiter`, `CustomerLoginLimiter` | split over processes the limit would be several times looser; an admin's unlock clears it in the process that got the request |
| A wholesale e-Barimt's lottery and QR for its one print | `ReceiptSecretsCache` (ADR-0185 #6: memory only, never stored) | the edge's result call and the office's print must reach the same process |
| The server panel's hour of history | `ServerMetricsService` | each process has its own hour |
| Live stock subscribers | `LiveStockHub` | each process listens on its own connection and serves its own subscribers: correct as it is |
| A product set per discount programme, one minute | `ProgramTargetsService` | each process is at most a minute behind, as one process already is |
| How many product exports run | `ProductExportService` | a limit per process |

## Decision

1. **Three kinds of api process from the one image**, in `deploy/store/docker-compose.store.yml`:
   - **`api`, the primary** (one): everything not named below, and with it every route that touches the state above: sign-in and passwords (`/api/v1/auth/*`), users and accounts, the e-Barimt receipts and the edge's sync, the server panel, the office's screens.
   - **`api-apps`** (`STORE_APPS_REPLICAS`, default 0): the two apps' own routes, `/api/v1/sales-rep/*` and `/api/v1/customer-app/*`.
   - **`api-reports`** (`STORE_REPORTS_REPLICAS`, default 0): `/api/v1/reports/*`, `/api/v1/finance/reports/*`, `/api/v1/hr/reports/*`.
2. **The routes are chosen by what they keep, not by how busy they are.** A group is sent to replicas only when none of its routes reads or writes the state in the table. The apps' sign-in stays on the primary (`/api/v1/auth/customer/*`, `/api/v1/auth/mobile/*`), so the sign-in limits stay exact. A route that later needs a process's memory belongs on the primary; a new group needs this check first.
3. **The web's Caddy routes** (`Caddyfile.store`): with `STORE_API_REPLICA_ROUTES=true` the two groups go to the replicas Docker's DNS lists under the service's name (`dynamic a`, looked up every 5 s), the least busy one first; a replica that fails is passed over for 10 s and the request is tried on another; with none left the primary answers. Switched off (the default) the matchers never match and the primary answers everything, exactly as before this decision.
4. **Only the primary migrates** and holds the migrator's password; the replicas start after it is healthy with `RUN_MIGRATIONS=false`.
5. **Reports are isolated, not only multiplied.** A heavy report takes a report replica's thread, pool and memory; the apps' replicas and the primary do not see it. More report replicas are for more reports at once, not for a faster report.
6. **Sizes on the PC of ADR-0187** (`deploy/store/.env`): four app replicas with a pool of 6 and 1 GB each, one report replica with a pool of 12 and 3 GB, the primary as in ADR-0191 (pool 20, 3 GB), PostgreSQL's connections raised to 200: the pools need 25 + 4 × 11 + 17 + 6 = 92. The counts are numbers in one file: a busier day gets more app replicas without a code change.
7. **What it does not do.** Order moves are bound by row locks in the database (about 6 a second with nine processes against 4.5 with one): more processes do not sell faster, and do not need to. The office's lists still run on the primary's one thread.

## Rehearsal, 2026-11-13

The real images against the scratch database of the load test (about 23 000 orders), behind the real Caddyfile:

| | One process | Primary + 4 app replicas + 1 report replica |
|---|---|---|
| Shop page, requests a second | 38–40 | 108–117 |
| 50 phones at once, median | 1.23 s | 0.42 s |
| 150 phones at once, median | 3.66 s | 1.23 s |
| 12 heavy reports at once | errors for other users from 8 on (pool of 6) | all 12 finish; shop page 0.16 → 0.24 s, office list unchanged |
| An app replica killed under 50 clients | — | 300 of 300 answered, complete |

The requests were spread evenly over the four replicas (313 to 317 each) and none of the apps' requests reached the primary; with the switch off all of them did. The same request answered by the primary, by a replica and through the routing was identical byte for byte.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Node's cluster or several copies of the whole api behind the proxy | Every route would meet every process: the sign-in limits, the e-Barimt print and the server panel would need a shared store first, and Redis is ruled out (CLAUDE.md NEVER). |
| Sticky routing by the caller's address | The edge's result and the office's print of one receipt come from different addresses. |
| The limits and the print's secrets in the database | The lottery and QR may not be stored (ADR-0022); the limits would work but are not what bounds the apps. |
| Only make the shop query cheaper | Worth doing and still open (a third of its cost is the query builder), but it raises one thread's ceiling by a part, not by a multiple, and leaves reports on the same thread. |
| A bigger pool | Measured: no gain for ordinary requests, more deadlocks between order moves. |

## Consequences

**Positive.** The apps get their own processes and nearly three times the room with four of them; a report can no longer slow the apps or the office; the PC's idle threads and memory do work; a failed replica is passed over; off by default, so the small box and CI are as before, and going back is one line.

**Negative.** More moving parts on one PC: six api containers instead of one, about 7 GB more in limits and up to 92 database connections. The split is a rule to keep: a state-keeping route sent to replicas would fail quietly and only sometimes. The server panel shows the primary alone. The replicas each warm up after a start (the first requests are slower), and an update restarts them together with the primary.

**Follow-ups.**
- The server panel: the replicas' count, memory and requests.
- The shop page's own cost (prepared statements or a cached query for the hot path).
- A limit on heavy reports at once and a `statement_timeout`, now on the report replicas' side (ADR-0191's follow-up).
- The office's hottest lists on replicas, after the same check of state.

## Related

ADR-0027, ADR-0185, ADR-0187, ADR-0190, ADR-0191, `deploy/store/docker-compose.store.yml`, `deploy/store/Caddyfile.store`, `deploy/store/.env.example`, `docs/architecture.md` §10.7, §10.8, `docs/STATUS.md` (the load test of 2026-11-13).
