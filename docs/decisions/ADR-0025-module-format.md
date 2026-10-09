# ADR-0025: Module format: CommonJS app and workspace packages, ESM-only dependencies through `require(esm)`

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-10 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0001 decision 4 (`moduleResolution: bundler` for packages) |

## Context

ADR-0002 chose the NestJS 12 CommonJS + Jest template. On day 1 three facts about module formats surfaced:

- **NestJS 12 and pg-boss 12 publish ESM only** (`"type": "module"` in `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/testing`, `@nestjs/swagger`, `@nestjs/config`, `pg-boss`). The official CommonJS template works because Node loads ESM from `require()` (`require(esm)`, no longer experimental since Node 25.4; it still rejects modules with top-level await).
- **Jest 30 supports `require(esm)` only when `node:vm` exposes `SourceTextModule`**, which on Node 26 requires `node --experimental-vm-modules`. The NestJS 12 template starts Jest with that flag for the same reason.
- **`decimal.js` and `zod` ship separate `import` and `require` builds.** If `packages/shared` were ESM while the api is CommonJS, production would load two copies of each (two `Decimal` classes with independent `Decimal.set({ rounding })`), while Jest, which compiles everything to CommonJS, would load one. A money-rounding bug would then exist only in production.

Workspace packages are consumed by the CommonJS api (built by `nest build`, run by Node 26, tested by Jest + ts-jest), by the Vite 8 web admin and Vitest 5, and from delivery 4 by Expo/Metro.

## Decision

1. **The api is CommonJS** (`"type": "commonjs"`, TypeScript `module`/`moduleResolution` `nodenext`) and loads ESM-only dependencies through Node 26 `require(esm)`. No ESM migration of the api is planned; it is a separate, dedicated session if NestJS ever drops the CommonJS template.
2. **Jest always runs as `node --experimental-vm-modules --disable-warning=ExperimentalWarning <jest>`** through `apps/api/scripts/jest.cjs`; Jest stays pinned exactly (30.5.2) and is upgraded only in a dependency session.
3. **Workspace packages that Node loads at runtime (`packages/shared`) are CommonJS**, compiled by `tsc -p tsconfig.build.json` to `dist/` with declarations. Their `exports` map has three conditions per entry point: `"@tugeel/source"` → `./src/*.ts`, `"types"` → `./dist/*.d.ts`, `"default"` → `./dist/*.js`; JSON catalogs are exported as files (`./i18n/*.json`). `files` lists `dist` and the JSON folders so `pnpm deploy` copies them.
4. **Bundlers and tests read the source**: Vite and Vitest set `resolve.conditions` to start with `@tugeel/source`; the web `tsconfig` sets `customConditions: ["@tugeel/source"]`; Metro will add the condition to `resolver.unstable_conditionNames` in delivery 4; Jest maps `@tugeel/shared` to `packages/shared/src` with `moduleNameMapper`. The api's own `tsc` resolves `types` (built `.d.ts`), so `pnpm check` builds the packages before linting and typechecking.
5. **`packages/api-client` is source-only TypeScript** (no build step): only bundled clients (web, mobile) import it, never the api.
6. **Money arithmetic in the api imports `Decimal` from `@tugeel/shared/money`**, never from `decimal.js` directly, so one configured clone (HALF_UP) is used everywhere.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| ESM `packages/shared` loaded by the CommonJS api through `require(esm)` | Dual-package hazard: two `decimal.js`/`zod` instances in production but one in tests. |
| NestJS 12 ESM + Vitest template for the api | Less documented, decorator metadata under ESM is less proven; contradicts ADR-0002 without a functional gain today. |
| Source-only TypeScript packages executed by Node type stripping | Node refuses to strip types under `node_modules`, and emitted declarations are still needed by the api's `tsc`. |
| Dual (ESM + CJS) builds of `packages/shared` | Two outputs to keep consistent for no consumer that needs ESM at runtime. |

## Consequences

**Positive.** One `decimal.js` and one `zod` instance per runtime; tests exercise the same code paths as production; web, Vitest and Metro never wait for a package build.

**Negative.** Jest depends on a Node flag marked experimental; packages must be built before the api is linted, typechecked or started (`pnpm check` and `pnpm dev` do this). If Jest's `require(esm)` support regresses, the fallback is the NestJS 12 ESM + Vitest template through a new ADR.

**Follow-ups.** `docs/architecture.md` §0.1, §2, §3 and §10.4 record the module format; `CLAUDE.md` lists the Jest wrapper and the build order.

## Related

ADR-0001 (decision 4 amended), ADR-0002 (CommonJS template), ADR-0010 (Decimal), ADR-0016 (Jest), `docs/architecture.md` §2, §3, §10.4.
