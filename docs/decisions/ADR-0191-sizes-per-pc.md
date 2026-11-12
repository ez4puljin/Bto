# ADR-0191: The centre's memory and connection sizes are set per PC

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «холболтын тоо болон санах ой нэмэх боломжтой юу?», after «Тийм, хий» to a larger pool and a load test), Claude (the direct-mode session) |
| Amends | ADR-0186 #5 (sizing for 7 GB: now the default, not the only size), ADR-0187 #7 (the sizes are no longer kept as they were on the 30 GB PC) |

## Context

`deploy/store/docker-compose.store.yml` fixed the centre's sizes for the store box of ADR-0186 (7 GB shared with the edge): PostgreSQL with 512 MB of shared buffers, 40 connections and a 1.5 GB limit; the api with a pool of 6 and a 1 GB limit (Node then takes about 536 MB as its heap); the worker with a pool of 2 and 768 MB. ADR-0187 moved the centre to a PC with 30 GB and kept the numbers.

The load test of 2026-11-13, on a scratch copy with about 22 000 orders, showed what the numbers mean in use:

- Ordinary requests and order moves are bound by the api's one thread, not by the pool: pools of 6, 16, 20 and 32 gave the same rates.
- A long report holds a connection for its whole run. With the pool of 6, eight «Борлуулалт /Бараагаар/» downloads at once (15 s each, about 8 MB) left nothing for anyone else: two of the reports and seven of thirty list requests waited 5 s and were answered «Internal error» (`timeout exceeded when trying to connect`). With a pool of 20 and a 1.5 GB heap, sixteen at once all finished and the lists stayed under 0.1 s; at twenty-four the same wall was met.
- The api's memory rose to 0.8 GB with the small pool and 1.3 GB with sixteen such reports, above what a 1 GB limit leaves the heap.
- More connections mean more transactions at once and, between order moves, more deadlocks; ADR-0190 makes those harmless, which is what allows a larger pool.

## Decision

1. **The sizes are variables of `deploy/store/.env`**, read by the compose file, with the 7 GB numbers as their defaults: `STORE_PG_SHARED_BUFFERS`, `STORE_PG_EFFECTIVE_CACHE`, `STORE_PG_MAX_CONNECTIONS`, `STORE_PG_MEMORY`, `STORE_API_DB_POOL_MAX`, `STORE_API_MEMORY`, `STORE_WORKER_DB_POOL_MAX`, `STORE_WORKER_MEMORY`. An env file without them is the box of ADR-0186, unchanged; CI validates the file with the defaults.
2. **The 30 GB PC of ADR-0187 gets**: PostgreSQL 2 GB shared buffers, 8 GB effective cache, 100 connections, a 4 GB limit; the api a pool of 20 and a 3 GB limit; the worker a pool of 4 and 1 GB. The budget: api 20 + 1 live stock listener + pg-boss 2 + the AI reader 2, worker 4 + pg-boss 2 = 31 of 100, the rest for the migrator, the nightly dump and `psql`. About 8 GB of limits in all, on a PC that also carries the edge, development and the old ERP.
3. **`max_connections` stays well above the sum of the pools**, and the sizes are changed together: a pool raised alone past PostgreSQL's connections fails at the api's start.
4. **A pool is not a queue for reports.** The larger pool moves the wall from about six heavy reports at once to about twenty; it does not remove it. A limit on how many heavy reports run at once, with the rest waiting their turn, and a statement timeout are the follow-up that makes a report unable to starve ordinary work.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| New fixed numbers in the compose file | The small box, a future bigger server and CI would again share one size. |
| Only the pool, without PostgreSQL's connections and memory | The api would ask for more connections than the server gives; twenty parallel sorts need the work memory. |
| Several api processes instead | It raises what one thread limits (lists, order moves), but the api keeps state in memory (sign-in limits, the e-Barimt print's secrets, the server panel's history): a design change of its own. |
| Leave it and tell people not to take reports together | The failure hits whoever is working, not the one who asked for the report. |

## Consequences

**Positive.** On the 30 GB PC sixteen heavy reports at once no longer disturb anyone and big downloads fit the api's memory; the 7 GB box and CI are untouched; the next machine sets its own numbers without a code change.

**Negative.** The PC gives the centre up to about 8 GB instead of 3.3 GB; with development, the edge and the old ERP on the same 30 GB that is still comfortable, but an APK build or a full check during opening hours has less room. More concurrent transactions mean more deadlocks met and retried (ADR-0190 counts them). Changing PostgreSQL's settings restarts its container: the centre is away for about a minute at the update.

**Follow-ups.**
- A limit on heavy reports running at once and a `statement_timeout` for the app's pool.
- The product-sales download growing with the lines (ADR-0135): a period limit or a server-side summary when a year is too much.

## Related

ADR-0186, ADR-0187, ADR-0190, `deploy/store/docker-compose.store.yml`, `deploy/store/.env.example`, `docs/architecture.md` §10.7, `docs/STATUS.md` (the load test of 2026-11-13).
