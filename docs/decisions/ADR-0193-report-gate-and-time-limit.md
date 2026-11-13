# ADR-0193: Reports take turns: a gate on how many run at once, and a time limit on their statements

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «Хүнд тайланг зэрэг авах хязгаар, хугацааны дээд хязгаарыг одоо хий», after «тайлан олон зэрэг авахад server яахаар байна?» and «Тэдгээрийн туршлагыг нэвтрүүл»), Claude (the direct-mode session) |
| Amends | ADR-0191 #4 (its follow-up, built), ADR-0192 (one more thing a process keeps for itself: the gate; the report replica's pool 12 → 16) |

## Context

A heavy report holds database connections for its whole run, and a pool is not a queue (ADR-0191 #4): past what the pool carries, whoever asks next waits five seconds for a connection and is answered «Internal error», the report's own user and everyone else on that process alike. ADR-0192 moved the reports to their own process, so the apps and the office no longer feel it, but on the report replica the wall is where it was: enough reports at once and they fail each other, with a text that tells the user nothing. Nothing ends a report that never finishes, either: a year of lines asked by mistake holds its connection until it is done.

One «Борлуулалт /Бараагаар/» over six weeks of the scratch copy (about 23 000 orders) takes about 10 s alone and asks up to two questions at once; the dashboard and the filter lists ask up to six.

## Decision

1. **A gate per process** (`apps/api/src/common/reports/`, `ReportGate`): at most `REPORTS_MAX_RUNNING` reports run at once, at most `REPORTS_MAX_PER_USER` of them for one user, and up to `REPORTS_MAX_WAITING` more wait their turn in the order they came, each for at most `REPORTS_WAIT_MS`. A user over their share waits while the next user passes: one person's ten tabs cannot take every place.
2. **A report that cannot start is told so.** With the line full it is refused at once, after its wait it is refused then: `REPORTS_BUSY`, HTTP 429 with `Retry-After: 15`, shown as «Одоо олон тайлан зэрэг авагдаж байна…». The line is short on purpose: a refusal at once is better than one after a long wait. A waiting report whose browser has gone leaves the line.
3. **What stands behind the gate**: every route ADR-0192 sends to the report replicas. The controllers that are all reports carry `@UseInterceptors(ReportGateInterceptor)` on the class (`/reports/*`, `/finance/reports/ledger/*`), and a new route of theirs is gated unless marked; the report routes of mixed controllers carry `@GatedReport()` on the method (the Finance Core's trial balance, opening check, VAT report and statements under `/finance/reports/*`, HR's `/hr/reports/days`). The light routes are marked `@UngatedReport()` and never wait: `/reports/refresh-state`, `/reports/book-options`, `/finance/reports/ledger/accounts`, the lists a report's filters are filled from.
4. **A time limit on the statement** (`DB_STATEMENT_TIMEOUT_MS`, the app pool's `statement_timeout`; unset = none): PostgreSQL ends a statement that outlives it, and the caller is answered `QUERY_TIMEOUT`, HTTP 503, «Хүсэлт хэт удаан үргэлжилсэн тул зогсоолоо. Хугацаа эсвэл шүүлтүүрээ багасгаад…». It is set only on the report replicas (60 s by default there): the primary and the app replicas keep none, so no order move, import or migration can meet it. Where the reports run on the primary (no replicas) the gate holds and the time limit does not.
5. **A pool with no connection left answers «not now» too**: node-postgres' «timeout exceeded when trying to connect» is `SERVICE_UNAVAILABLE` 503 instead of «Internal error» 500, on every route.
6. **The web does not ask again at once** after a 429 or a 503 (`retryRead` in `apps/web/src/lib/query-client.ts`): the automatic second try would only join the same line; the screen's «Дахин оролдох» is the user's.
7. **Sizes.** Defaults: 3 running, 2 for one user, 6 waiting, 40 s (a pool of 6). On the PC of ADR-0187 the report replica gets a pool of 16, 8 running, 3 for one user, 8 waiting, and the 60 s statement limit; the pools now need 96 of PostgreSQL's 200 connections. The rule of thumb: running at about half the pool, because one report asks several questions at once. The longest a caller waits, 40 s in line and a statement of 60 s, stays at Cloudflare's 100 s for the outside name.
8. **What it does not do.** A report already running is not stopped when its browser goes; the time limit bounds it. The gate is per process: two report replicas are two gates. Other heavy reads outside these routes (the lists' Excel exports, the product export) are neither gated nor on replicas yet. Reports are still made while the user waits; a stored report made in the background is a decision of its own.

## Rehearsal, 2026-11-13

One api process on the scratch copy, pool 16, 8 places, 8 in line, heavy «Борлуулалт /Бараагаар/» reports asked at once:

| | Result |
|---|---|
| 12 at once | all 12 answered, 17–28 s; filter lists 0.04 s and the product list 0.02 s meanwhile |
| 20 at once | 16 answered (11–30 s), 4 refused in 0.1 s with `REPORTS_BUSY` and `Retry-After`; no pool wait expired; lists unchanged |
| 8 at once from one user, share 3 | all answered, three at a time (10–28 s) |
| 12 at once from two users, share 3 | all answered, six running, six waiting |
| A statement limit of 3 s | both reports answered `QUERY_TIMEOUT` after 3.3 s; the process and its connections went on |

Before the gate the same process answered «Internal error» to reports and lists alike once the pool was full (ADR-0191's context).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Reports as background jobs with a stored result the user opens later | The larger practice and worth having for the heaviest ones, but a new flow, table and screen; the gate protects the system now and stays under it. |
| A limit in PostgreSQL (the role's connection limit, a second role for reports) | The api's processes share the role `app`; a second role means grants on every table and a second pool, and a refused connection is still an error text, not a turn. |
| `SET LOCAL statement_timeout` per report request | Every report would have to run in one transaction on one connection; today they ask several questions at once. |
| A rate limit (`@nestjs/throttler`) | It counts requests per time, not reports running at once: ten quick reports are fine, two slow ones may not be. |
| A long line with a long wait | The user waits a minute and is refused anyway, and Cloudflare ends the request at 100 s. |

## Consequences

**Positive.** Past the limit a report waits its turn instead of failing; past the line it is refused in a tenth of a second with a text that says why; one user cannot take every place; a runaway report is ended; the lists a report page opens with are never held up; a busy database is «not now», not «Internal error».

**Negative.** A report can now be refused while the PC has room: the numbers are a guess to be tuned from the log (`ReportGate` warns at every refusal). The share per user makes one person's fourth tab wait even when the gate is free. The time limit can end an honest report over a very long period: the user is told to narrow it, and the limit is one number in `deploy/store/.env`. One more per-process state to remember when routes move between processes.

**Follow-ups.**
- The gate's numbers (running, waiting, refused) and the deadlock retries on the server panel.
- The heaviest reports made in the background and kept: asked once, opened by everyone who needs it.
- The same answer kept for a minute for equal questions (two managers opening the same dashboard).
- The lists' Excel exports behind the gate and on the report replicas, after their routes are checked for in-process state (ADR-0192 #2).

## Related

ADR-0191, ADR-0192, `apps/api/src/common/reports/`, `apps/api/src/common/errors/problem-details.ts`, `apps/api/src/common/db/db.module.ts`, `deploy/store/docker-compose.store.yml`, `deploy/store/.env.example`, `docs/modules/reporting.md` §5, `docs/architecture.md` §10.2, §10.8.
