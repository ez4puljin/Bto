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

## The monitor: the brain's work on one page

`http://192.168.1.250:3310` on any PC or phone of the store's LAN (owner 2026-11-20) shows, every
five seconds, what the brain is doing: the workers running now, the open tasks with the paths they
hold, their commits and uncommitted files, each brain session with its workers, the last landings
and whether the real system runs them (`/health` and the auto-deploy log), and how fresh the code
graph is. `monitor/serve.mjs` (Node, no dependency) serves the page and `GET /api/state`; the user
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
