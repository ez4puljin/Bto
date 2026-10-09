# ADR-0023: Node.js 26 everywhere from day one

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-10 |
| Deciders | Owner, Claude (Claude Code session) |
| Supersedes | ADR-0001 decision 2 (Node.js 24 LTS now, Node 26 in a later upgrade session) |

## Context

ADR-0001 chose Node.js 24 LTS and scheduled a dedicated session to move to Node 26 after it became LTS. On the first implementation day (2026-10-10) the facts were:

- The owner's development machine already runs Node 26.7.0 (system installer). Staying on 24 would mean downgrading it or running two runtimes.
- Node 24 leaves Active LTS on 2026-10-20 (maintenance until 2028-04-30). Node 26 becomes Active LTS on 2026-10-28 (EOL 2029-04-30), which is before the delivery-1 production go-live (decision gate 2026-11-13, `docs/STATUS.md`).
- Every dependency resolved for the week-1 scaffold accepts Node 26: `@nestjs/schematics` 12.0.6 (`^22.22.3 || ^24.15.0 || >=26.0.0`), `jsdom` 30.1.2 (`>=26.0.0`), `vitest` 5.0.3 (`>=26.0.0`), `pg-boss` 12.37.1 and `nestjs-pino` 5.3.1 (`>=22.12.0`), Jest 30 (`>=24.0.0`).
- Node 25+ no longer bundles corepack, so pnpm must be installed explicitly in Docker and CI either way.
- Debian bookworm left regular security support on 2026-07-12; the official `node:26-slim` tag already points to Debian trixie. GitHub's `ubuntu-latest` label moves to Ubuntu 26 from 2026-10-19, in the middle of delivery 1.

## Decision

1. **Node.js 26 is the only runtime**: local development, CI and production. `.nvmrc` contains `26`; the root `package.json` declares `"engines": { "node": "^26.7.0", "pnpm": ">=11.28.2 <12" }`, so pnpm 9/10 and older Node fail loudly instead of installing with wrong settings.
2. **Docker base image `node:26-trixie-slim`** for the api build and runtime stages (ADR-0012 hosting stays unchanged).
3. **CI runs on `ubuntu-24.04`**, pinned, not `ubuntu-latest`; `actions/setup-node` reads `.nvmrc`.
4. **pnpm is installed without corepack**: `npm install --global pnpm@11.28.2` in Docker and the local rehearsal, `pnpm/action-setup` in GitHub Actions (it reads `packageManager` / `devEngines.packageManager`).
5. `@types/node` follows the runtime major (26.x).
6. No Node upgrade session is scheduled any more. The next Node major is adopted in a dedicated session between deliveries, after it becomes LTS (the ADR-0001 rule for later majors still applies).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Node 24 everywhere (ADR-0001 as written) | Downgrades the owner's machine, enters maintenance in ten days, and still requires the 26 upgrade session later. |
| Node 26 locally, Node 24 in CI and Docker | Two runtimes: a failure seen in one place may not reproduce in the other, which a non-engineer owner cannot diagnose. |
| pnpm-managed runtime (`devEngines.runtime` with download) | Newer pnpm feature that writes a runtime entry into the lockfile; unnecessary once the machine already has the chosen major. |
| `node:26-bookworm-slim` | Bookworm is past regular security support. |

## Consequences

**Positive.** One runtime everywhere; no Node upgrade session in the roadmap; three years of support (to 2029-04-30); a smaller gap between development and production.

**Negative.** For the first 18 days (until 2026-10-28) Node 26 is a "Current" release. If a dependency breaks on 26, the fallback is a superseding ADR back to Node 24; the probability is low because every week-1 dependency already declares Node 26 support.

**Follow-ups.**
- `CLAUDE.md` pin table and `docs/architecture.md` §0, §0.1, §2, §12 updated in the same session.
- ADR-0001 gets an "Amended by" line pointing here; ADR-0022 (still `Proposed`) pins the print agent to Node 26.

## Related

ADR-0001 (TypeScript monorepo; decision 2 superseded), ADR-0012 (hosting), ADR-0016 (CI), ADR-0022 (print agent runtime), `docs/architecture.md` §0, §2, §10.4.
