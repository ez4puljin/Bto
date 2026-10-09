# ADR-0001: TypeScript everywhere in a pnpm-workspaces monorepo, one TypeScript version

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

One non-engineer owner builds and maintains an API, a web admin and two mobile apps with an AI agent across many sessions. Shared types, validators, the unit-conversion function and the pricing resolver must not drift between three clients. The toolchain must be boring: every tool has to be well represented in documentation and in the agent's training data, and version churn has to be contained to scheduled sessions.

Facts that constrain the choice (see `docs/architecture.md` §0 and §13):

- Node.js 24 is Active LTS; Node.js 26 is scheduled to become LTS on 2026-10-28. Node 22 is maintenance-only (EOL 2027-04).
- TypeScript 7.0 (the Go compiler) ships no programmatic API; `@nestjs/cli` 12 depends on `typescript ~6.0.2` and its `tsc` builder refuses to run without that API. Mixing TypeScript 7.0.x and 6.0.x inside one pnpm monorepo broke the Nest swagger CLI plugin (nest-cli #3549).
- pnpm 10 reached end of life in June 2026. pnpm 11 (pure ESM, `minimumReleaseAge` 1440 min by default, settings in `pnpm-workspace.yaml`) is maintained; pnpm 12 is a Rust rewrite with the same commands and lockfile, but winget/Scoop had not shipped it at launch and the owner develops on Windows 11.
- `nodeLinker: hoisted` is needed for Expo/Metro, which hoists a single `typescript` to the workspace root; whichever version wins silently breaks either `nest build` or typescript-eslint/ts-jest.

## Decision

1. **TypeScript for every deliverable**: `apps/api`, `apps/web`, `apps/mobile`, `packages/*`, `scripts/*`. No second language.
2. **Node.js 24 LTS** now (`engines`, `.nvmrc`, Docker base image). Node 26 is adopted in a dedicated upgrade session after it becomes LTS, never inside a delivery session.
3. **Exactly one TypeScript version workspace-wide: `~6.0.x`.** It is pinned through the pnpm catalog (`catalog: { typescript: ~6.0.x }`) and every package references `catalog:`. A CI step runs `pnpm ls typescript -r --depth 0` and fails if more than one resolved version appears. `typescript@7` must not be added to any package until the dedicated TypeScript 7.1 / Nest CLI session (CLAUDE.md NEVER list).
4. **`tsconfig.base.json` is written TS-7-ready today**: `strict: true`, no `baseUrl`, `moduleResolution: bundler` (web, mobile, packages) or `nodenext` (api), explicit `rootDir` and `types`, no ES5 target, `esModuleInterop: true`.
5. **pnpm 11.x** with `devEngines.packageManager`, settings in `pnpm-workspace.yaml`: `nodeLinker: hoisted`, `minimumReleaseAge: 1440` (24 h supply-chain delay). pnpm 12 is adopted later in a dedicated session once Windows package managers ship it; the lockfile format is unchanged.
6. **No Turborepo/Nx.** One root `pnpm check` script (typecheck, lint, prettier check, unit + integration tests, `drizzle-kit check`, OpenAPI staleness, web build) is the definition of done for every session.
7. `CLAUDE.md` is the agent contract: pinned versions with dates, the commands, and the NEVER list.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Python/Django or Go backend plus a JS front-end | Two languages, two test styles, no shared pricing resolver or validators; doubles what the owner must read. |
| Flutter for mobile | A second language and toolchain; cannot share the API client or `packages/shared`. |
| Turborepo or Nx | Build caching is not a bottleneck for one developer; another config surface to maintain. |
| pnpm 10 | End of life June 2026. |
| pnpm 12 now | Rust rewrite six weeks old at decision time; Windows package managers had not shipped it. Same lockfile, so switching later is cheap. |
| TypeScript 7.0 now, or 6.x for api and 7.x for web/mobile | 7.0 has no programmatic API (Nest CLI, typescript-eslint, ts-jest break); mixed versions in a hoisted workspace are the documented failure mode. |
| Node 22 | Maintenance-only; EOL April 2027. |

## Consequences

**Positive.** One toolchain, one test style, one lint config. The generated API client compiles against shared types, so API drift is a compile error. A single TypeScript version removes a whole class of "works on one package, fails on another" errors that a non-engineer cannot diagnose.

**Negative.** No 10x compile speed from TypeScript 7 for a year; no build cache. Two scheduled upgrade sessions (Node 26; TypeScript 7.1 + Nest CLI) must be planned between deliveries.

**Follow-ups.**
- Day 1: run `npm view <pkg> version` for every package not covered by the research-verified pin list (`docs/architecture.md` §0) and record the results with the date in `CLAUDE.md`.
- CI: `pnpm ls typescript -r` single-version check from the first pipeline.
- Upgrade sessions only between deliveries (ADR-0016 and `docs/STATUS.md` roadmap rule).

## Related

ADR-0002 (NestJS 12, CommonJS template), ADR-0004 (generated client), ADR-0006 (Expo, hoisted linker), ADR-0016 (`pnpm check`), `docs/architecture.md` §0, §2, §3, §12.
