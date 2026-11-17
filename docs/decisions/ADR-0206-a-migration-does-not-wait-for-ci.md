# ADR-0206: A migration does not wait for CI either

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «уул нь ci хүлээхгүй шууд app.puljika.site дээр шинэчлэл орох ёстой биз дээ?», then «Огт хүлээхгүй тавь»), Claude (the direct-mode session) |
| Amends | ADR-0204 (#1, the exception for a new migration) |

## Context

ADR-0204 put every push on the real system at once, except a push with a new migration: it waited for CI green, because `rollback.sh` cannot undo a migration. CI on `main` takes 28–44 minutes, so the first push with a new table (c8c2caf0, «Ажиллах пос») sat for over half an hour while the owner expected it on `app.puljika.site` in minutes. Offered a middle way (try the migration on a copy of the real schema first), the owner chose not to wait at all.

## Decision

1. **A push with a new migration is put on at once**, like any other code: `plan_update` no longer answers `wait`. `setup.sh` runs the migration as part of the update.
2. **Only a CI answer already red holds a push back** (`refuse`), as before.
3. **A CI that turns red after such an update** cannot be rolled back: `rollback.sh` refuses when a migration stands between the versions. The timer writes «БУЦААЖ ЧАДСАНГҮЙ … засвар push хийтэл энэ хувилбар ажиллана» in `auto-deploy.log`, and the red version stays until a fix is pushed.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep waiting for CI green (ADR-0204) | 30–45 minutes for every new table; the owner wants it in minutes. |
| Try the migration on a throwaway copy of the real schema first (1–2 min), then put it on | Offered; the owner chose not to wait at all. Still the next step if a bad migration ever reaches the real system. |

## Consequences

- A new table is live in about five minutes, like any other code.
- A migration that breaks is found on the real system, not by CI. PostgreSQL runs each migration in a transaction, so a failing one stops `setup.sh` and leaves the running version as it was; a migration that succeeds but is wrong stays until a fix (a new migration) is pushed.
- Sessions write migrations that only add (new tables, new nullable columns) where they can, so the previous version keeps working beside them.
