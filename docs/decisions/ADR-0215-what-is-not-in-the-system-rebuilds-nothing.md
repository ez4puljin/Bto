# ADR-0215: What is not in the system rebuilds nothing

|           |                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                                                                |
| Date      | 2026-11-17                                                                                                                              |
| Deciders  | Owner (2026-11-17: asked «Тест, хэрэгслийн өөрчлөлтөд бодит системийг дахин бүтээхгүй болгох уу?», answered «Тийм, болго»), Claude |
| Amends    | ADR-0205 (#1 and #2, what an update builds and when the till server is rebuilt)                                                         |

## Context

Under ADR-0204 and ADR-0205 only documents (`docs/`, `*.md`, `.claude/`, `.github/`) moved the checkout without a build; every other path was code. On 2026-11-17 a push of one integration test file ran a whole update: about five minutes, and the tills paused about forty seconds while the till server was rebuilt, for a file no image holds.

What was checked, file by file, before counting a path as outside the system:

- `.dockerignore` leaves `tools`, `ci`, `docs`, `deploy`, `.github` and `.claude` out of the build context. No deploy script runs anything under `tools/` or `ci/`.
- The api: `apps/api/tsconfig.build.json` compiles `src/**/*.ts` except `src/**/*.spec.ts`, and its image holds only `dist` (`"files": ["dist"]`, `pnpm deploy --prod`). So `apps/api/test/` and `apps/api/src/**/*.spec.ts` are never in it. A `.test.ts` or an `.int-spec.ts` under `apps/api/src` **would** be compiled (the exclude names `.spec.ts` only), so those stay code. No source file imports from `test/`.
- The packages: `shared` and `fin-contract` build with `exclude: src/**/*.test.ts`; `api-client` has no build and is read from source. No source file imports a test file. A `.spec.ts` there would be compiled, so it stays code.
- The web: `vite build` bundles only what `index.html` and `pos.html` import, and no page imports a `.test.ts(x)` file (the one `import.meta.glob` is itself in a test). `apps/web/src/test/setup.ts` is not a test file by name and stays a page file.
- `deploy/**/*.test.sh`: no deploy script runs one; `watch.sh` is only sourced by its test.
- The staff app (`apps/mobile`) is built on the owner's PC (ADR-0061). No other workspace depends on `@tugeel/mobile`, and no Dockerfile, compose file, build config or source of the api, the web or the packages reads a file there. `app-releases.service.ts` only names `apps/mobile/variants.json` in a comment: its list of apps is written in the code, and the releases are read at run time from `STORAGE_LOCAL_DIR/releases`. Its `package.json` is read by `pnpm install --frozen-lockfile` in every image.

`.test.mjs` files exist only under `tools/` and `apps/mobile/scripts/`, both covered by their folders; a `.test.mjs` or `.int-spec.ts` elsewhere was not proven unused and is not counted.

## Decision

1. **These paths count like documents** (`outside_system` in `deploy/store/auto-deploy.sh`): a push of nothing else moves `~/bto`'s checkout and builds nothing; the tills are left alone.
   - `tools/`, `ci/`;
   - `apps/api/test/`, and `apps/api/src/**/*.spec.ts`;
   - `packages/shared/src`, `packages/fin-contract/src` and `packages/api-client/src`: `**/*.test.ts`;
   - `apps/web/src/**/*.test.ts` and `**/*.test.tsx`;
   - `deploy/**/*.test.sh`;
   - `apps/mobile/`, except its `package.json` and `tsconfig*.json`.
2. **Every `package.json`, `tsconfig*.json` and `Dockerfile` stays code**, wherever it is (a test or staff-app folder included), as do `pnpm-lock.yaml`, `pnpm-workspace.yaml`, every other `deploy/` file and all other code. When in doubt a path is code: one wrongly counted as outside would silently not reach the real system.
3. **The same rule decides the till server** (`needs_edge`) and what a pages-only update leaves behind after a rollback (`left_behind`): a kiosk test (`apps/web/src/pos/x.test.tsx`) does not pause the tills, and a web test alone is not a pages update.
4. **The gate's sentence after a push** (`tools/brain/land.sh`: about five minutes, about a minute, documents only) asks the same `plan_update` from the pushed `auto-deploy.sh`, so it can never disagree with what the real system will do.

## Alternatives considered

| Alternative                                                           | Why rejected                                                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any path ending `.spec.ts`, `.test.ts`, `.int-spec.ts` counts as a test | The api's build compiles `.test.ts` and `.int-spec.ts` under `src`, and the packages' builds compile `.spec.ts`: such a file is in the image. The rule names only what each build leaves out. |
| Compare the built images instead of the paths                          | Needs a build to know whether to build: the five minutes this saves.                                                                                                             |
| Keep land.sh's own patterns                                            | They had already fallen behind once; two lists of the same rule drift.                                                                                                           |

## Consequences

A push of only tests, tools, CI files or the staff app's sources is on `~/bto`'s checkout within about 20 seconds, with no build and no pause of the tills. CI still runs on every push, and its red is still seen; it rolls nothing back, as nothing was built. The running images may then be older than the checkout's tests and tools, which is harmless: they hold none of them. A test pushed with the code it tests is part of that code's update. A new kind of test file or a new place for one is code until this rule and its test (`deploy/store/auto-deploy.test.sh`) name it.

## Related

ADR-0061, ADR-0204, ADR-0205, ADR-0206, `deploy/store/auto-deploy.sh`, `deploy/store/auto-deploy.test.sh`, `tools/brain/land.sh`, `.dockerignore`.
