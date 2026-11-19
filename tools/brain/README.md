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
node tools/brain/monitor/serve.mjs                  the monitor page on :3310 (a user service; below)
```

`land.sh` exits 0 when landed, 3 on a conflict, 4 when the check is red, 5 when a task is not
committed; nothing is pushed unless it exits 0. After a push it fast-forwards `~/bto-dev` when
nothing there is in the way (the development server then shows the change), says whether the real
system takes a minute (pages only) or five, and names a landed migration.

The books are in `~/bto-work/.brain/`: `lanes/<slug>` (the paths a task holds), `numbers`, `log`
(every landing), `land-check.log` (the last check). The gate is `~/bto-work/_gate`, a worktree that
stands at `origin/main` between landings.

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
  The tests are in `brain.test.mjs`.

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
