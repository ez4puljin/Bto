# The brain: many tasks at once, none in another's way (ADR-0213)

The owner tells one session, the brain, what to change. The brain writes no code. It gives each task
to a worker of the right model in the task's own copy of the code, lands the finished tasks through
one gate, and reports in Mongolian. The brain's own rules are the skill `tarhi`
(`skill/SKILL.md`); the workers are `agents/bto-ui.md` (Sonnet: screens and texts),
`agents/bto-core.md` (Opus: the api, stock, money, migrations), `agents/bto-scout.md` (Haiku:
finds things, changes nothing) and `agents/bto-review.md` (Sonnet: reviews a finished task, changes
nothing). `bash tools/brain/install.sh` copies them to `~/.claude/` where every session on this PC
finds them, and registers the guard; run it again after changing them.

## Why two tasks never collide

| What could collide | What prevents it |
|---|---|
| One sees the other's half-done work (a red check that is not its own) | Each task has its own copy: `~/bto-work/<slug>`, a git worktree on branch `task/<slug>` from `origin/main`. Made in four seconds: `node_modules` is hard-linked from `~/bto-dev`, the compilers' memory is copied from the gate. |
| Two change the same file | The books: `task.sh new <slug> <path>…` records what a task may change and refuses (exit 2) a path another task holds. The brain then gives that work to the holder or starts it after the holder has landed. |
| Two add translation keys | `packages/shared/i18n/mn.json` is merged by key, not by line (`merge-json.mjs`, `.gitattributes`). Only the same key given two texts is a conflict. |
| Two take the same ADR or migration number | `task.sh number adr\|migration <slug>` hands each number out once. It looks at `origin/main`, at `~/bto-dev` (uncommitted files too) and at every copy. |
| Two write `docs/STATUS.md` or the ADR index | Workers never touch them; the brain writes those lines in a small task of its own. |
| Two integration runs use the same test databases | `int.sh` runs one at a time on this PC. |
| Two push at the same moment | `land.sh` is the only thing that pushes for tasks, one landing at a time; a push that loses the race starts again on the new main. |

What is left: two tasks that must change the same file run one after the other. The brain arranges
that; the owner does not see a queue, only that the second result comes after the first.

## The tools

```
bash tools/brain/task.sh new <slug> <path>…        a task's copy and its claims
bash tools/brain/task.sh claim <slug> <path>…      more paths for a running task
bash tools/brain/task.sh list                      the running tasks
bash tools/brain/task.sh drop <slug>               throw a task away
bash tools/brain/task.sh number adr|migration <slug>
bash tools/brain/land.sh <slug>…                   land finished tasks: one commit each on main, one check, one push
bash tools/brain/land.sh --no-push <slug>…         merge and check only
bash tools/brain/int.sh <pattern>… | --integrity   the api's suites from a copy, one run at a time
bash tools/brain/graph.sh explain|affected|path …  the code graph of origin/main (below)
bash tools/brain/job.sh request|want|done|status|tick|run …   the job desk: an APK once for all (below)
bash tools/brain/inbox.sh tick|status|approve|reject|retry …   the inbox gate: a second developer's in/* branches (below)
node tools/brain/board.mjs status|claim|release|number|say|inbox …   the team board shared with the other AI (below)
node tools/brain/monitor/serve.mjs                  the monitor page on :3310 (a user service; below)
```

`land.sh` exits 0 when landed, 3 on a conflict, 4 when the check is red, 5 when a task is not
committed; nothing is pushed unless it exits 0. After a push it fast-forwards `~/bto-dev` when
nothing there is in the way (the development server then shows the change), says whether the real
system takes a minute (pages only) or five, names a landed migration, starts the job desk's
`tick` in the background and names the jobs (APKs) the landing is part of.

The books are in `~/bto-work/.brain/`: `lanes/<slug>` (the paths a task holds), `numbers`, `log`
(every landing), `land-check.log` (the last check), `jobs/` (the job desk, below). The gate is
`~/bto-work/_gate`, a worktree that stands at `origin/main` between landings.

## The reviewer and the guard

Two ideas borrowed from the open-source Claude Code toolkit ECC (github.com/affaan-m/ECC, MIT),
rewritten for Bto; no file or dependency of it is used.

- **`bto-review`** reads a finished task's diff (`git diff origin/main...HEAD` in its copy) and the
  code around it before the brain lands it: every guarded (`bto-core`) task and any diff over about
  300 lines. It looks for Bto's own faults (money not through `Decimal`, the ledger or the books
  written outside one transaction or not append-only, a migration that does more than add, a route
  without its right, a swallowed error, a guard loosened to pass a check, port 15433 or `~/bto`
  named, a text outside `mn.json`) and reports only what it is more than 80% sure of, each finding
  with its line and the failure it causes; zero findings is a normal answer. Its last line is
  `APPROVE` or `BLOCK: <n> finding(s)`; the brain sends a block back to the task's worker.
- **`guard.mjs`** is a PreToolUse hook on every Bash command of every session on this PC. It
  blocks, with one line naming the rule: `--no-verify` on commit, push, merge or rebase (and
  `commit -n`); `git add -A`, `--all`, `.` or `:/`; `docker compose … down -v`; a force push to
  `main`; and any command naming 15433 run from `~/bto-dev` or `~/bto-work`. In `~/bto` only
  `down -v` is blocked. Only clear cases: quoted text, heredocs and comments are not commands, and
  any input it cannot read lets the command run. A blocked command is fixed, never worked around.
  While the job desk builds an APK it also stops `./gradlew` under `~/Android` and
  `expo run:android` (ADR-0229).
  The tests are in `brain.test.mjs`.

## Jobs that run once: the job desk (ADR-0229)

Some work must run once after several sessions' changes, not once per session: first of all the
APKs of the staff app and of «Bto300» (ten minutes each, one at a time on this PC, since both use
`~/Android/m` and Gradle). Owner, 2026-11-20: a session that wants an APK asks first; if nobody is
about to change the app it builds at once, otherwise it waits and ONE build carries everything.
`job.sh` is that desk.

```
bash tools/brain/job.sh request <kind> [--publish] [--by <who>] [--commit <sha>]
bash tools/brain/job.sh want <kind> --by <who> [--note <text>]
bash tools/brain/job.sh done <kind> --by <who>
bash tools/brain/job.sh status [<kind>]
bash tools/brain/job.sh tick
bash tools/brain/job.sh run <kind> [--publish] [--by <who>]
bash tools/brain/job.sh kinds-of <path>…
```

- **`request`** is called once the change is on `origin/main`. The answer's first word says what
  happened: `STARTED` (nobody holds it: it runs now, in the background at `nice 15`; the line says
  where the log and the APK will be), `JOINED` (a job of that kind is running and its commit already
  carries the change: it is in that APK), `ALREADY` (the last finished job carries it; with
  `--publish` an unpublished one is published now) — all exit 0 — or `QUEUED`, exit 3, with one
  `waits for:` line per reason. A queued request starts by itself. Exit 1: the publish of an earlier
  build failed; 64: usage. «Carries the change» means the job's commit contains the requested commit
  (`origin/main` after a fetch, or `--commit`), or nothing between the two is part of the kind (a
  document pushed in between does not need a new APK).
- **Who holds a job (contributors):** a brain task whose held paths (books: `lanes/<slug>`) are part
  of the kind, until it lands or is dropped; `~/bto-dev`'s own uncommitted files or unpushed commits
  on such paths (a session working directly there); a `want` declared by such a session (`done`
  lets go; the request of the same `--by` too). For the APKs a path is part of the kind when it is
  under `apps/mobile/` (not a test or `.md` file), or under a folder `packages/shared/src/<x>` the
  app uses: what `apps/mobile/app` and `apps/mobile/src` import as `@tugeel/shared/<x>` on
  `origin/main` (read each time the desk runs; a bare `@tugeel/shared` would bring the index's
  re-exports), and what those folders import of each other in turn (`sales` → `pos` → `finance`).
  `packages/api-client` does not count: a regenerated schema needs no new APK, and a change of the
  app's use of it is a change under `apps/mobile`. So an api task never holds an APK. `status` and
  every `waits for:` line give each contributor's reason: the matching paths and why each is part
  of the kind. A contributor with no sign of work (a file written, a commit, the claim, the want)
  for the kind's idle limit (2 hours) stops holding; `status` still shows it as `idle`. A build
  started by hand (`build-apk.mjs`, Gradle's wrapper) also keeps the desk waiting.
- **`run`** is the owner's override: now, whoever holds it. Still one job of a group at a time.
- **`tick`** starts every job that is due (a request waits, nobody holds it, nothing of its group
  runs). `land.sh` runs it in the background after every landing, `done` runs it, a finished job runs
  it, and the user timer `bto-brain-jobs.timer` runs it every minute (so a direct session's push
  also lets a waiting job start). Every command that changes the books takes `jobs/desk.lock`, so
  two ticks at once start one job.
- **Other sessions' checkouts are only read:** every git command of the desk runs with
  `GIT_OPTIONAL_LOCKS=0`, so its `git status` of `~/bto-dev` or a task's copy never takes their
  `index.lock` (which would make their own `git add` fail at that moment).
- **Where it runs:** never in `~/bto-dev`. Its own worktree `~/bto-work/_jobs/<group>`
  (`_jobs/android` for the APKs), set to the `origin/main` fetched just before the start, so one job
  carries everything landed so far; `node_modules` hard-linked and `apps/api/.env` copied as for a
  task. The command runs with `BTO_JOB_DESK=1` and the kind's `JOB_ENV`. The newest file matching the
  kind's `ARTIFACT` is copied to the same place in `~/bto-dev` (`apps/mobile/build/apk/`,
  gitignored); its path and the commit go into the books.
- **Publishing:** only when at least one request the job carries asked `--publish` (`status` says
  `publish: yes|no`, and `now publishing` while it does; the last job's `published` is `yes`, `no`
  or `failed`). The job publishes before it lets go of its record, so nothing else of its group
  starts (and resets the copy the publish runs from) until the publish is over; a request that
  joins meanwhile is published too. For the APKs
  this is `publish-apk.mjs --storage /var/lib/docker/volumes/bto-store_storage/_data` through
  `sudo -n` (the volume is root's), then `chown -R 1000:1000` of `releases/<variant>`, as the
  releases since 0.19.0 were published. The APKs are built with
  `BTO_SERVER=https://app.puljika.site`, as those releases were.
- **A failed job** (the command exited non-zero, made no artifact, or ran past the kind's time
  limit, 45 minutes for an APK: then all its processes are stopped and `status` says so) is
  recorded with its log and is not tried again by itself: its requests are spent. A new `request`
  or `run` tries again. A request that joins a running job adds only itself to it; requests
  waiting for a later commit stay for the next job.
- **A job that died** (its process is gone without an exit: the PC restarted, it was killed) is not
  a failed one: the next `tick` puts its requests, `--publish` included, back in the queue ahead of
  newer ones, once (books: `died`), and starts it again when nobody holds it. A second death in a
  row is recorded as failed and stops. Any job that ends by itself clears the mark.
- **Versions are not bumped by the desk.** `apps/mobile/package.json` and `variants.json` change
  only in a task (their push is a whole update of the real system); every build's `versionCode`
  (minutes since 2026-01-01) is higher than the last, so phones are offered it anyway.
- **By hand:** `pnpm mobile:apk` and `pnpm mobile:publish` refuse in `~/bto-dev` and in a task's copy
  (`jobs/desk.mjs`) and print the `job.sh request` line; `-- --here` builds or publishes from that
  checkout on purpose (an emulator test), outside the desk, and is refused while the desk builds.
  The guard also stops `./gradlew` under `~/Android` and `expo run:android` while the desk builds.
  Another PC (the Windows laptop) is not affected.

The books are in `~/bto-work/.brain/jobs/`: per kind `requests` (waiting), `running` and `carried`
(the running job and the requests it carries), `died` (the last job died once), `last` (status, reason, commit, artifact, published,
for whom, log), `wants/<who>`, `logs/<id>.log` (the last 20); and `log`, one line per finished job.

**A new kind** is one file, `tools/brain/jobs/<kind>.job` (bash, sourced by `job.sh`;
`apk-staff.job` explains every name): `TITLE`, `GROUP` (one job of a group at a time),
`CONTRIBUTORS` (repository paths), `SHARED_IMPORTED_BY` (optional: folders whose
`@tugeel/shared/<x>` imports also count) and `EXCLUDE` (patterns of files under them that do not count),
`COMMAND` (run in the desk's copy), `JOB_ENV`, `ARTIFACT` (optional), `PUBLISH` (optional; gets
`$ARTIFACT`), `IDLE_HOURS`, `TIME_LIMIT_MINUTES` (default 45), `BUSY_PATTERN` (optional: processes that mean the same work runs by
hand). A design-system artifact or a rebuild of the development database would be such a file. Its
test goes into `brain.test.mjs` (the tests replace the command with `BTO_JOB_COMMAND`, the publish
with `BTO_JOB_PUBLISH`, and run against a scratch repository and scratch books).

## The inbox gate: a second developer's work (ADR-0242)

Owner, 2026-11-24: two people with two different AIs, one brain; main and app.puljika.site as fast
as is safe, without mistakes. The second developer works on another PC with OpenAI Codex, which reads
`AGENTS.md` (the repository's root), not `CLAUDE.md`. They never push to `main` (GitHub protects it);
they push a branch `in/<slug>`, and `inbox.sh` here puts it through the same one gate as the brain's
tasks.

```
bash tools/brain/inbox.sh tick [--dry-run]        take every new head of an in/* branch (the timer)
bash tools/brain/inbox.sh status                  what waits, what waits for review, the last results
bash tools/brain/inbox.sh approve <branch>        the brain reviewed a GUARDED change: land it
bash tools/brain/inbox.sh reject <branch> <why>   refuse it: the task is dropped, the reason sent back
bash tools/brain/inbox.sh retry <branch>          forget the result for its head; the next tick tries again
bash tools/brain/inbox.sh classify <path>…        the rule alone, per path
bash tools/brain/inbox.sh review [--dry-run]      one automatic review (the timer bto-brain-review, ADR-0249)
bash tools/brain/inbox.sh review --again <branch> forget the automatic review's result; the next pass reviews it
bash tools/brain/inbox.sh auto on|off|status      the automatic review's switch (on unless turned off)
bash tools/brain/inbox.sh auto all|allowlist      all: it also lands the owner's areas (ADR-0250); allowlist: back to ADR-0249
```

- **`tick`** (the user timer `bto-brain-inbox.timer`, every 20 seconds, `nice 15`, installed by
  `install.sh`) fetches the remote's `in/*` branches into `refs/inbox/*` (pruned) and takes each
  head it has not handled, oldest first. A head is handled once; a new push to the same branch is a
  new attempt and replaces one that waited (its task is dropped). A branch deleted on GitHub
  withdraws its waiting attempt. One lock (`inbox/lock`): a second tick at once exits at once;
  `approve`, `reject` and `retry` wait for it.
- **Refused at once:** a bad name (`in/<slug>`: lower-case letters, digits, dashes, at most 37), a
  head not on top of a commit of main's history, a head already on main, and any change of the guard
  rails: `.github/`, `deploy/`, `tools/brain/`, `.claude/`, `CLAUDE.md`, `AGENTS.md` (anywhere); the
  checks (`tools/fast-check/`, `tools/lint-guards/`, `tools/finance-core/`, `eslint.config.*`, `ci/`,
  `scripts/`, `.husky/`, `.gitattributes`); dependencies (any `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`); any `.env` file but `.env.example`. Renames count with
  both names. Names are read as they are (`git diff -z`, `core.quotePath=false`), so `deploy/é.sh` is
  `deploy/`; a name with a quote, a backslash or a control character (a tab, a newline) is refused.
- **A task, through `task.sh`:** `task.sh new in-<slug> <every changed file>`; when a running task
  holds one of them, the attempt is `WAITING` and the next ticks try again. The `in-` task names are
  the gate's: `task.sh new in-…` refuses unless the gate calls it (`BTO_TASK_OWNER=inbox`, which
  `task.sh` records in `owners/<slug>`), and the gate drops only a task the books say it opened, so a
  copy named `in-…` that someone else made is never touched. The brain never lands or drops one by
  hand.
- **A killed tick** (a timeout, a restart): every attempt has a `phase` until it reaches a state.
  The next tick, holding the lock, finds a phase left over and first waits for any `land.sh` still
  running; if a commit with the head's `Inbox-Head:` trailer is on `origin/main`, the attempt
  finishes as `LANDED` (report, branch deleted); otherwise the gate's task is dropped and the head
  is tried again. `status` shows such an attempt as `INTERRUPTED` (or `IN PROGRESS` while a tick
  runs).
- **One commit:** the branch is squash-merged into the task's copy on top of `origin/main`; the
  commit keeps the author (name, email, date) of the branch's head, its subject is the first commit's
  subject, the body carries every commit's message, and two trailers name the branch and its head
  (`Inbox-Branch:`, `Inbox-Head:`). A conflict drops the task and writes back «rebase onto main».
  `land.sh` keeps the task's first commit's author on main (for a worker's task that is this PC's
  own name, as before).
- **Existing wording is the owner's** (ADR-0249): when a branch touches a `.json` under
  `packages/shared/i18n/` (any depth; another file there is GUARDED),
  the tick compares the files of the merge-base and the head by key path (`review.mjs i18n`): an
  added key is fine; a changed or removed value makes the branch GUARDED and owner-only, and the
  record keeps the list (`wording=`, `key: «old» → «new»`, at most 40). `classify` sees paths only
  and cannot tell.
- **LIGHT or GUARDED** (`classify`): LIGHT when every file is a page or text of the office's web
  (`apps/web/src`, `apps/web/index.html`, `apps/web/public`; not the till: `apps/web/src/pos`,
  `apps/web/pos.html`), a screen of the staff app (`apps/mobile/app`, `apps/mobile/src`, `assets`;
  not `src/api`, `src/outbox`, `src/offline`, `src/server`, `src/config`), the translations
  (`packages/shared/i18n/*.json`) or a document (`docs/`, `*.md`; not `docs/decisions/` or
  `docs/STATUS.md`). Everything else is GUARDED: the api, `packages/`, migrations, the till, every
  config. So LIGHT is a subset of what auto-deploy builds as «pages only» or «nothing» (ADR-0205,
  ADR-0215), never a whole update.
- **LIGHT lands at once:** `land.sh in-<slug>` (its `check:fast`, its push; the real system takes
  it by itself). Landed: `LANDED <sha>`, and the remote branch is deleted (only while it still
  points at that head). Red (exit 4), a conflict (3) or anything else: the task is dropped and the
  reason goes back (red: with the check's digest, below).
- **GUARDED waits for review:** `check:fast` runs in the copy; green leaves the task open as
  `WAITING-REVIEW` (in `status`, on the monitor and as a pending status on GitHub). The automatic
  review (below) takes it; what it leaves, the brain reviews like a `bto-core` task (`bto-review` on
  `git -C ~/bto-work/in-<slug> show`, the suites `status` suggests through `int.sh`), then
  `inbox.sh approve in/<slug>` (land.sh; refused if the branch was pushed again meanwhile) or
  `inbox.sh reject in/<slug> "<why>"`, on any waiting head. Red: dropped and written back.
- **Written back** with `gh` as the owner: a commit status `bto/inbox-gate` (success, pending,
  failure) and a commit comment on the branch's head, in English with one Mongolian line, once per
  result. If GitHub cannot be reached the next ticks try again (five times). The repository is
  public: never `land.sh`'s output or a local path. A red check's status names the failing step
  (`web types`) and says «what failed is in the commit comment and on the team board».
- **A red check is named, not shown** (2026-11-25: the other AI waited an hour and a half for
  a screenshot): `check_digest` reads the check's output (colour codes stripped) and makes a short
  digest per red step: vitest's failing test (`FAIL <file> > <suite> > <test>`), the first frame
  inside the repository as `file:line:col` with at most the three numbered source lines before the
  `^`, the error's first line and the totals; jest's `● <suite> › <test>`, its message and first
  frame; tsc's and eslint's first five errors (`file:line:col`, then «+N more»); the files Prettier
  names; i18n's missing keys; otherwise the step's last lines, never a runner's footer or a DOM dump.
  Paths become repository-relative and a line with U+FFFD (binary garbage) is dropped. A line that
  carries a secret is dropped: a key naming one (`pass`, `pwd`, `secret`, `token`, `key`,
  `credential`, `auth`, `cookie`, `session`, with any prefix or suffix, `SMTP_PASS`) followed by
  `=` or, quoted or not, by `:` (a path's `file.ts:12:5` is not); any `Authorization:` or
  `Cookie:` line; `Bearer …`; a URL with a password or of a database; `ghp_`/`github_pat_`; a
  JWT-shaped value; and any ALL_CAPS `NAME=value` of six or more characters (the known cost: a
  test's text that looks like that is dropped too). A test that only names a token stays. Then the
  values themselves go: `review.mjs scrub --env-from` with the check's copy (GUARDED: the task's
  copy; LIGHT: `land.sh`'s gate copy `~/bto-work/_gate`) and with `~/bto-dev`, where every copy's
  `.env` comes from; if anything fails, the digest is «unavailable», never unscrubbed. The digest is cut at a line with «… (+N more)» at
  1200 characters. Both red paths (LIGHT through `land.sh` exit 4, GUARDED in the copy) put it into
  the commit comment («What failed in `pnpm check:fast`»), the board message to the branch's side
  and to the brain, and the reason in `status`; it is kept as `logs/<slug>-<head>.digest`, the whole
  output stays in the attempt's log. check-fast.mjs keeps what it needs: a red step's section is its
  last 80 lines with, before them, the heads of the failures above that tail (vitest's `FAIL … > …`
  and the error's first lines, jest's `● … › …` and its message; never a DOM dump), at most 120.
- **The books** are in `~/bto-work/.brain/inbox/`: `items/<slug>` (the attempt: branch, head, state,
  class, files, task, reason, landed), `log` (one line a result), `logs/<slug>-<head>.log` (the
  task, the merge, the check, the landing; the last 50), `gh.log`. `BTO_INBOX_REMOTE` (default
  `origin`), `BTO_INBOX_GH` and `BTO_INBOX_REPO` exist for the tests and a dry run against a local
  fake remote.
- **Trust:** the second developer's tests run on this PC in `check:fast`, as a worker's do. The
  gate keeps mistakes off main; it is not a defence against a hostile collaborator.

### The automatic review (ADR-0249)

Owner, 2026-11-24, «Тийм, автомат»: a GUARDED head is reviewed and landed or refused without waiting
for a Claude session, except what stays the owner's. `inbox.sh review` is one pass on one head; the
user timer `bto-brain-review` (`inbox/bto-brain-review.{service,timer}`, every minute, `nice 15`,
installed by `install.sh`) runs it. It has its own lock (`inbox/review.lock`: a second pass exits at
once) and takes the inbox lock only to read and write the books, never while suites or the reviewer
run, so the 20-second tick is as fast as before.

1. **Which head:** the oldest `WAITING-REVIEW` head without a verdict (or whose retry time or the
   day's budget now allows it). Its copy must still be the squash of that head (`Inbox-Head:`).
2. **The allow-list, by the script** (`review.mjs owner-only` on the copy's squashed commit, no AI;
   `review.mjs decide <path>…` shows the decision of single paths). Each path is decided in this
   order: a named rule of `OWNER_ONLY` (`migration`, `schema`, `decision`, `boundaries`, `till`,
   `money`, `integrity`, `rights`, `orders`, `staff-app-sync`, `integrations`, `config`, `tools`) →
   a test file, by its subject → `AI_MAY_APPROVE` (`api-read-modules`: the api modules reporting,
   catalog, partners, customer; `api-read-side`: any other module's `services/*-query.service.ts`
   and `dto/**`; `api-client`: the generated client; `web`, `mobile`: the screens; `docs`;
   `i18n-keys`) → a named fallback of `OWNER_FALLBACK` (`tests`, `api-write`, `api-platform`,
   `shared`, `app-platform`) → `unlisted`. Diff rules hold a head too: `wording`, `tests-weakened`
   (a test file deleted, fewer `it(`/`test(`, more skip/only/todo), `binary` (but the apps'
   images), `route-rights` (a changed `@Public`/`@Authenticated`/`@RequirePermission`/
   `@CustomerRoute` line). Only a head that is all on the allow-list goes on; any other stays
   `WAITING-REVIEW` with `review=owner` and the rules printed. A check that cannot run counts as
   owner-only. `brain.test.mjs` walks `git ls-files`: no file of the repository may be `unlisted`.
3. **The day's budget:** at most `BTO_REVIEW_MAX_PER_DAY` (40) AI reviews a day (`inbox/review-budget`,
   one line each, a failed call counts). Beyond it: `review=budget`, taken again when the budget
   allows; the brain may approve it by hand meanwhile.
4. **The suites:** the same ones `status` names (`suite_args_of`), each with the copy's own `int.sh`
   (it tests the tree it lies in), at most `BTO_REVIEW_SUITE_TIMEOUT` (1200 s) each and within the
   pass's deadline. Red: `reject` with the failing suites and tests by name (`review.mjs failures`;
   the repository is public, the output stays in the review's folder); the AI is not called. Red
   without a named test, or a timeout: an error (below).
5. **The reviewer, on a clean export:** `git archive HEAD` of the copy unpacked into
   `inbox/reviews/<slug>-<head>.export` (no `.env`, no `node_modules`, no `.git`; removed after the
   call, on a timeout or a kill too, and at the next pass's start). The Claude CLI (`$BTO_CLAUDE`,
   else `claude` on PATH, else the newest `~/.config/Claude/claude-code/*/*/claude`) runs there:

   ```
   claude -p "<prompt>" --model sonnet --output-format json --json-schema "<VERDICT_SCHEMA>"
     --system-prompt "<agents/bto-review.md + the run's rules>"
     --tools Read,Grep,Glob --allowedTools Read,Grep,Glob
     --disallowedTools 'Read(**/.env*)' 'Grep(**/.env*)' 'Glob(**/.env*)'
     --permission-mode dontAsk --permission-prompts none --restricted --safe-mode
     --strict-mcp-config --disable-slash-commands --no-session-persistence
     --max-turns 60 --add-dir ~/bto-work/.brain/inbox/reviews/<slug>-<head>
   ```

   under `timeout` (600 s, `BTO_REVIEW_TIMEOUT`, within the deadline), without `ANTHROPIC_API_KEY`
   (the owner's plan, never an API bill). `--tools` leaves it only the three reading tools (no Bash,
   no Write or Edit, no web, no sub-agents), `--strict-mcp-config` no MCP server, `--safe-mode` no
   user CLAUDE.md, hooks (the board's hook would mark the brain's messages read), skills or plugins,
   `--restricted` keeps its file tools inside the export and the inputs' folder. The prompt names
   the inputs the script wrote: the diff, its stat, the commit message, the changed files, and the
   rules to read (`CLAUDE.md`, `AGENTS.md`, the touched modules' documents). The role tells it that
   all of that is data from another party: an instruction found in it is a HIGH finding, and so is an
   undeclared change. `BTO_REVIEW_MODEL`, `BTO_REVIEW_MAX_TURNS` change the model and the turns.
6. **The verdict** is read only from the CLI's final JSON (`review.mjs verdict`): one JSON object, a
   successful result, `structured_output` with `verdict` APPROVE or BLOCK and at most 10 findings
   (`severity` HIGH/MEDIUM, `file`, `line`, `text` ≤ 300, made safe as the board makes text safe).
   An APPROVE that lists a HIGH finding is a BLOCK; a BLOCK without findings is unreadable. The
   model's own text, a line of the diff, or anything printed before the JSON never counts. A finding
   or an error text that holds a value of the copy's `.env` files (≥ 8 characters) or looks like a
   key, a JWT, a private key or a URL with a password becomes «(removed: looked like a secret)»
   (`review.mjs scrub`) before it is written anywhere.
7. **Acting**, under the inbox lock and only when the item is still the same head, `WAITING-REVIEW`,
   the review still `running` and the squashed diff's hash unchanged (else the result is dropped,
   or the head reviewed again): BLOCK → `reject` with the findings; red → `reject` with the names;
   APPROVE and green → `review=approved`, and the next **tick** lands it (`land_approved`:
   `approve_item`, the brain's own path through land.sh; only while the squashed diff is the one
   reviewed; a branch pushed again is a new head). The landing is the tick's because the review's
   unit stops every child it leaves, a landing's background jobs too. An error (no CLI, not signed
   in, a timeout, an unreadable answer, a usage limit, a suite timeout, a landing that cannot happen
   now) → one more try after `BTO_REVIEW_RETRY_WAIT` (900 s), then `review=needs-brain`. Never an
   approval on an error, never a loop.
8. **Time:** one pass keeps to `BTO_REVIEW_DEADLINE` (3000 s) for its suites and its reviewer; the
   unit allows 3600 s and is `KillMode=control-group`. Every child runs without the gate's lock
   files (`6>&- 7>&-`) under `timeout`, which signals its whole process group, so a hung suite or
   reviewer leaves no process and no lock behind.
9. **Said:** `status` shows a `review:` line per waiting head (and `wording:`); the monitor's inbox
   cards a pill (Mongolian) with the model and seconds; GitHub gets `REVIEWED-LANDED`, the refusal
   with its findings, or a pending status and comment «WAITING for the owner / for the brain»; the
   board tells `codex`, and a head left waiting is also said to `brain` by the sender `gate` (the
   board takes no message to oneself), so the owner's Claude sees it before its next prompt. The
   record keeps `review`, `review_why`, `review_model`, `review_secs`, `review_dir`; the folder
   `inbox/reviews/<slug>-<head>/` (the last 50) keeps the inputs, `suites.log`, `answer.json`.
10. **Off:** `inbox.sh auto off` (a file `inbox/auto-review.off`): every GUARDED head waits for the
   brain as before; `auto on` again. `review --dry-run` prints, per waiting head, the owner-only
   rules, the suites and whether it would review, and runs neither. `review --again in/<slug>`
   forgets a verdict so the next pass reviews the head again.
11. **All (ADR-0250, owner 2026-11-26):** `inbox.sh auto all` (a file `inbox/auto-review.all`) lets
   the pass take a head the owner-only rules hold (migrations, schema, money, rights, tools, ADRs):
   its suites run as usual (a migration adds `--integrity`), then the reviewer runs with
   `BTO_REVIEW_MODEL_GUARDED` (default `opus`) and a prompt that names those areas and asks for a
   BLOCK on any doubt. A weakened test and an unsure rule test still wait for the brain; the tick's
   guard rails are refused as before. drizzle's `meta/*_snapshot.json` is left out of the patch.
   `inbox.sh auto allowlist` goes back.

**Trust:** the reviewer reads a trusted collaborator's code, but a diff could still talk an AI round.
The hard rails are the script's: the guard rails, the allow-list and the diff rules, `check:fast` and
the suites; the AI is the soft rail on top, only for what the allow-list names, and it can only
refuse more or let through what those already let through. Tests: `brain.test.mjs` «review: …», with a fake CLI (`BTO_CLAUDE`) and a fake `int.sh`.

## The team board: the two developers' AIs share one set of facts (ADR-0248)

The brain (Claude, this PC) and the second developer's Codex (a Windows PC) see the same claims, take
ADR and migration numbers from one sequence, and send each other messages through an orphan branch
`board` of the repository's remote. It is never merged or checked out; `board.mjs` keeps a bare clone
of it in `~/bto-work/.brain/board` here (`<clone>/.git/bto-board` on another PC) and writes one file
per fact: `claims/<who>--<slug>.json`, `msg/<stamp>-<from>-<rand>.json`, `numbers/<kind>-<NNNN>.json`.
Every write fetches, decides on the fetched tip, commits on top and pushes without force; a rejected
push goes round again on the new tip, so two sides at once get two numbers, or one claim and one
refusal. **The repository is public: no secret, password, customer data or personal data on the
board.**

```
node tools/brain/board.mjs join <name>                       once per PC (this PC: brain, by install.sh)
node tools/brain/board.mjs status [--json]                   claims, numbers not yet on main, unread, last on main
node tools/brain/board.mjs claim <slug> <path>… [--what ""]  exit 2 names the holder
node tools/brain/board.mjs release <slug> [--of <name>]
node tools/brain/board.mjs number adr|migration <slug> [--floor <n>]
node tools/brain/board.mjs say <to|all> "<text>" [--re <id>] [--slug <slug>]
node tools/brain/board.mjs inbox [--peek] [--json]           unread to me or all; marks read
node tools/brain/board.mjs thread <id> · holders <path>… [--except <name>] · sync
```

- **Numbers not yet on main** (`status`): every number handed out on the board whose file
  (`ADR-NNNN-*.md`, `NNNN_*.sql`) is not on origin/main, however high main's last number is, except
  this side's numbers whose task `task.sh drop` threw away (`board/dropped`, one slug a line; a slug
  that takes a number again leaves it). A number is never handed out twice either way.
- **The brain needs no new habit.** `task.sh new`/`claim` refuse (exit 2) a path another side holds
  on the board and publish the task's paths as `brain`'s claim (`--what "brain task <slug>"`);
  `task.sh drop` and `land.sh` release it; `task.sh number` takes the number from the board, never
  below what the books here and the copies say. The first board call published `numbers` once
  (`codex-big` as `codex`'s; the marker is `board/imported`). The gate's `in-*` tasks publish nothing:
  their paths are the other side's.
- **A board that cannot be reached never blocks** (GitHub down): `task.sh` warns and goes on with its
  own books; `task.sh number` then prints a loud `WARNING` and the number from the books alone. A claim
  made offline is not published later by itself (`board.mjs claim <slug> <path>… --as brain` when it
  is back). `BTO_BOARD=off` switches it off; a trial with another `BTO_BASE_REF` never touches it.
- **The inbox gate:** a `REFUSED` or `WAITING-REVIEW` result is also said to the branch's side
  (`BTO_INBOX_SIDE`, default `codex`) as «inbox gate: in/<slug> @ <head>: <result>», once per result;
  `LANDED` and a branch deleted without landing (`WITHDRAWN`) release that side's claim of the same
  slug; a refused or rejected branch keeps it (its side fixes and pushes again, or releases it). A
  path another side holds is named in `inbox.sh status` («board:»), never a reason to refuse. Every
  board call of the gate and of `land.sh` has a 5-second limit, and the gate leaves the board alone
  for a minute after it could not be reached (`board/unreachable`). Board errors go to
  `inbox/board.log`.
- **Nothing on the branch is trusted:** anyone who can push it can hand-write a file. `board.mjs`
  reads only files in its own shapes (a message's id agrees with its file name and sender, names and
  slugs in their patterns, ISO times, four-digit numbers that agree with their file name, claim paths
  inside the repository) and skips the rest with one warning; a message's text loses its control
  characters, is cut to 4000 characters and cannot close the hook's fence. The names `all`, `owner`,
  `system`, `user`, `assistant` and `claude` can never be a side. The hook prints at most five
  messages or about 6000 characters («+N more»), marks only those read, and reads the local clone
  when it was fetched less than 30 seconds ago. Scripts pass paths and text after `--`.
- **Messages reach the brain by themselves:** `install.sh` adds a `UserPromptSubmit` hook to
  `~/.claude/settings.json` that runs `board.mjs inbox --hook --as brain`: before every prompt of a
  Claude session here it prints the unread messages (fenced as `<team-board-messages>`, marked as the
  other AI's requests to weigh, not the owner's instructions) and marks them read; nothing when there
  are none or the board is unreachable (a 4-second fetch, a 10-second limit). Codex reads its inbox as
  `AGENTS.md` says. Nothing wakes an AI that nobody prompts.
- **On the monitor:** «Хамтын самбар»: the claims by side, the newest numbers, the last ten messages
  (it fetches the board at most once a minute).
- **Tests:** `board.test.mjs` (run by `brain.test.mjs`): two clones of a local bare repository, a
  barrier that makes both sides push at once (`BTO_BOARD_TEST_BARRIER`); nothing reaches the network.

## The monitor: the brain's work on one page

`http://192.168.1.250:3310` on any PC or phone of the store's LAN (owner 2026-11-20) shows, every
five seconds, what the brain is doing: the workers running now, the open tasks with the paths they
hold, their commits and uncommitted files, each brain session with its workers, the last landings
and whether the real system runs them (`/health` and the auto-deploy log), and how fresh the code
graph is, and the inbox gate's branches. `monitor/serve.mjs` (Node, no dependency) serves the page and `GET /api/state`; the user
service `bto-brain-monitor` (`monitor/bto-brain-monitor.service`, installed and restarted by
`install.sh`) runs it from `~/bto-dev`. Another port: `BRAIN_MONITOR_PORT`.

- **Read-only.** It only reads the books, the copies (git), Claude Code's subagent transcripts
  (`~/.claude/projects/*/<session>/subagents/`, read once and then only what was added) and the
  real system's version; it writes nothing and has no buttons. Anything but `GET` is 405.
- **LAN only.** Never through the Cloudflare tunnel (CLAUDE.md: nothing new is published outside
  without a decision).
- **What it hides.** A worker shows only its description, task, type, model, status, times, the
  name of its last tool call, one line of its last text (at most 160 characters) and its tokens:
  never a tool's input or output, a file's content, the environment or the brief's text (only the
  slug of its `Copy:` line is taken from it).
- Workers are the `bto-*` agents (and a `general-purpose` one whose brief names a copy) of the
  last seven days. Running: not finished and written in the last ten minutes; not finished and
  silent longer: «зогссон бололтой».

## The code graph: who calls this, what a change reaches

`graph.sh` keeps a code graph of `origin/main`, built on this PC by the open-source Graphify
(github.com/Graphify-Labs/graphify, Apache-2.0; the CLI `graphify`, installed once with
`uv tool install graphifyy`). It answers «who calls this, what breaks if this changes, how are these
two connected» in a few hundred tokens instead of a grep and a read of every hit.

```
bash tools/brain/graph.sh explain "<symbol>"     the node, its file:line, callers and callees with file:line
bash tools/brain/graph.sh affected "<symbol>"    what depends on it (reverse impact), with file:line
bash tools/brain/graph.sh path "<A>" "<B>"       how two symbols connect
bash tools/brain/graph.sh status                 the graph's commit, age, how far behind origin/main, size
bash tools/brain/graph.sh update [--if-idle]     rebuild it now
```

- **Where it lives:** `~/bto-work/.brain/graph/`: `src/` is a snapshot of `origin/main`
  (`git archive`, rsynced so that unchanged files keep their times and graphify's cache knows them),
  `src/graphify-out/graph.json` the graph, `commit` the commit it was built from, `update.log`. No
  checkout ever gets a `graphify-out` folder. The paths it prints are the repository's
  (`apps/api/src/…`), so they hold in any copy.
- **How it stays current:** `land.sh` starts `graph.sh update --if-idle` in the background after
  every push (one update at a time; a landing never waits for it). When the graph is older than
  `origin/main`, every answer begins with one line on stderr, `graph of <sha> (<n> commits behind
  origin/main)`: the newest code may be missing, so read the current file. The graph never knows a
  task's own new code.
- **Ambiguous names:** exit 3 lists the candidate ids and their `path::symbol` forms; retry with
  one (`graph.sh explain "apps/api/src/modules/finance/services/fin-posting.ts::.submitInTx()"`).
  Exit 4: no such node.
- **No `query`:** graphify's free-text `query` answers noisily (fixtures and the web's test data
  first), so `graph.sh` does not offer it. Grep stays right for texts, translation keys, config
  values and SQL.
- **Nothing leaves the PC:** `graph.sh` always sets `GRAPHIFY_BACKEND=none` (code only,
  tree-sitter, never an LLM backend) and `GRAPHIFY_QUERY_LOG_DISABLE=1` (no log of the questions).
- **Measured 2026-11-19** on `origin/main`: 32 972 nodes, 132 079 edges, `graph.json` 57 MB and
  the whole folder 65 MB; a full build 167 s, a rebuild after one changed file still about 150 s,
  about 570 MB of memory. An answer of `explain` is about 3 KB.

## The check a task runs: `pnpm check:fast`

`tools/fast-check/check-fast.mjs` checks only what the change can have broken, every step at once,
each compiler remembering its last run (`.fastcheck/`, gitignored):

| Changed | Steps |
|---|---|
| `apps/web/**` or `mn.json` | web types (`tsconfig.fast.json`), the key scan, eslint and the tests beside the changed files |
| `apps/mobile/**` or `mn.json` | staff app types, the key scan, eslint, tests beside |
| `apps/api/**` | api types (incremental), eslint, the specs beside |
| `packages/**` | the packages are rebuilt, then every step above |
| any file | Prettier checks every changed file of a kind it knows (`.prettierignore` applies), as CI's `prettier --check .` does |

Measured on this PC on 2026-11-17: a page edit 29 s, a page edit with a new translation key about
80 s (the helpers that type menu and form keys from `mn.json` are rechecked), nothing changed 18 s;
`pnpm typecheck && pnpm lint` took 204 s on average. The fast configs leave out i18next's typed
keys (15 million type instantiations); `i18n-keys.mjs` checks in a fifth of a second that every
key named in the code exists. CI's `pnpm check` still types every key and runs every suite. At most
three checks run on the PC at once; a fourth waits for a slot.

## Trying the tools without touching main

`BTO_BASE_REF=<branch>` makes `task.sh new` start from that branch and `land.sh` merge onto it; then
`land.sh` never pushes.
