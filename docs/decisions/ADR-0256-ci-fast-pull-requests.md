# ADR-0256: A pull request without a schema, dependency or check change merges on the fast check

|           |                                                                                   |
| --------- | --------------------------------------------------------------------------------- |
| Status    | Accepted                                                                          |
| Date      | 2026-11-27                                                                        |
| Deciders  | Owner (2026-11-27: staff report, the fix shows on app.puljika.site in minutes), Claude |
| Amends    | ADR-0120 (definition of done: CI's full check before the merge)                   |

## Context

After ADR-0255 an update reaches the real system minutes after it is on `main`, but a Claude
thread's pull request still waited about 24 minutes for CI's `check` job (`pnpm check`, integration
and integrity suites included) before its merge: pull requests 68, 70, 71, 72 and 74 on
2026-11-27. While staff only try Bto (ADR-0254), a screen fix took half an hour end to end.

## Decision

1. CI's `check` job on a pull request looks at what the pull request changes against its base. When
   nothing is under `apps/api/src/db/` (schema, migrations) and no `package.json`, lockfile,
   workspace file, tsconfig, `.github/`, `ci/`, `tools/fast-check/` or eslint config changes, it runs
   `pnpm build:packages && pnpm check:fast --base origin/<base>` (types, the translation keys, eslint
   and Prettier on the changed files, the tests beside them; about two minutes) instead of
   `pnpm check`. The job keeps its name, so a required check stays satisfied.
2. Every other pull request, every push to `main` and a manual run still run the full `pnpm check`.
   The full check on `main` after the merge is the safety net: auto-deploy rolls a red `main` back
   (ADR-0204), or it is fixed forward past a migration (ADR-0206).
3. A thread merges such a pull request as soon as its fast check is green and does not wait for or
   ask for the full check (CLAUDE.md, «Start of every session» 4).

## Consequences

A screen or text fix goes from pull request to app.puljika.site in about five to eight minutes. An
integration test that a fast-checked pull request breaks is found on `main` minutes after the merge
instead of before it. When the company starts real use, this ADR is reviewed with ADR-0254.
