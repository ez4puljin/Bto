# ADR-0213: A brain directs the work, workers do it in their own copies, a fast check gates it

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «Claude code дээр жижиг хөгжүүлэлт хэлэхэд бэлэн болох гэж маш удаж байна … Системийг хөгжүүлэлтийг удирддаг тархи надад хэрэгтэй байна. Тархинд хөгжүүлэлтийг хэлэхэд тэр тохирох Model-д яг хийх ажлыг нь хүлээнгэн өгч, дуусахад нь мэдээлэл авдаг, шаардлагатай бол дахин command өгдөг. Гэхдээ бүх ажил зэрэг явагдаж байхад ямар ч мөргөлдөөн болон дараалал үүсэх ёсгүй», then «Тийм, байгуул»), Claude (the direct-mode session) |
| Amends | ADR-0120 (the check before a push), the direct mode of `CLAUDE.md` |

## Context

The ten sessions of 2026-11-12 … 17 were measured from their transcripts: 163 requests, 1,412 minutes of work. Claude thinking and writing took 38%, the checks 30% (typecheck 231 min, lint 83, unit tests 94, builds 18), watching CI 12% (ended by ADR-0204), updates of the real system 6%. A small change spent two to seven minutes on the change and six to thirty on checks: «Дүнгийн ард ₮ нэм» took 23.7 minutes, 2 of them Claude's; «Кассуудын профайл зураг» 47 minutes, 7 of them Claude's.

One round of `pnpm typecheck && pnpm lint` took 204 s on average and ran two to five times per task. The web's type check alone is 160 s: i18next's typed keys make 15.5 million type instantiations over 11,600 keys, and a new key rechecks every file. Every session used the strongest model, whatever the task. Sessions shared `~/bto-dev`: one session's unfinished work made another's check red, and one `git add -A` committed another session's files (1b51eb57).

## Decision

1. **A fast check, `pnpm check:fast`** (`tools/fast-check/`), is the check before a push. It runs only the steps the changed paths call for, all at once, at low priority, each compiler incremental (`.fastcheck/`). The web and the staff app are compiled without i18next's typed keys (`tsconfig.fast.json`); `i18n-keys.mjs` checks that every key named in the code exists. ESLint runs on the changed files, and the unit tests that sit beside them run. At most three checks run on the PC at once. CI still runs the whole `pnpm check`; `pnpm typecheck` and `pnpm lint` are unchanged.
2. **A brain directs.** The session the owner talks to follows the skill `tarhi`: it writes no code, splits a request into tasks, starts a worker for each and stays free for the next request. It lands finished tasks and reports in Mongolian.
3. **Workers by task.** `bto-ui` (Sonnet) for a screen, a list, a print, a text; `bto-core` (Opus) for the api, stock, money, rights, migrations and shared packages; `bto-scout` (Haiku), read-only, to find the files. The definitions live in `tools/brain/agents/` and are installed to `~/.claude/agents/`.
4. **Each task has its own copy**: a git worktree `~/bto-work/<slug>` on branch `task/<slug>` from `origin/main`, with `node_modules` hard-linked from `~/bto-dev` (four seconds, no disk).
5. **Books keep tasks apart** (`tools/brain/task.sh`): a task holds the paths it may change, and a path is held by one task at a time; ADR and migration numbers are handed out once; `mn.json` is merged by key (`merge-json.mjs`); only the brain writes `docs/STATUS.md` and the ADR index; integration suites run one at a time (`int.sh`).
6. **One gate lands** (`tools/brain/land.sh`): each finished task becomes one commit on top of `origin/main`, the whole is checked once, pushed, and `~/bto-dev` follows when nothing there is in the way. The push goes onto the real system by itself (ADR-0204 … 0206).
7. **The direct mode stays** for a session that is not a brain; it runs `pnpm check:fast` before its push.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Drop the typed keys everywhere | CI's full check keeps them: a key built from a variable is only caught by the types. |
| `assumeChangesOnlyAffectDirectDependencies` for the fast check | It misses an error two imports away; a red CI after the push rolls the real system back. |
| TypeScript 7 (the native compiler) | ADR-0001 pins one TypeScript 6 for the workspace; a change of compiler is its own decision. |
| Run the unit tests that import a changed file (`vitest related`) | One dialog reaches 67 test files through the routes: 5.5 minutes, and timeouts under load. |
| A worker per task in the shared checkout | One sees the other's half-done work; this is what failed. |
| `pnpm install` in every copy | The offline store lacks packages; hard links take three seconds and no disk. |
| A separate visible session per task | Heavier to start and the brain cannot send it back as simply; a subagent reports into the brain's own turn. |

## Consequences

- A screen change is checked in half a minute to a minute and a half instead of three and a half minutes per round, and several changes run at once.
- Two tasks that must change the same file run one after the other; the brain arranges it.
- A type error in a file the change did not touch through a typed key built from a variable is found by CI, not by the fast check.
- `~/bto-work/` holds the copies; a task that is dropped or landed leaves nothing behind.
- A new package is still added in `~/bto-dev` (`pnpm install`); the copies are linked again from it.
