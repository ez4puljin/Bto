# The brain: many tasks at once, none in another's way (ADR-0213)

The owner tells one session, the brain, what to change. The brain writes no code. It gives each task
to a worker of the right model in the task's own copy of the code, lands the finished tasks through
one gate, and reports in Mongolian. The brain's own rules are the skill `tarhi`
(`skill/SKILL.md`); the workers are `agents/bto-ui.md` (Sonnet: screens and texts),
`agents/bto-core.md` (Opus: the api, stock, money, migrations) and `agents/bto-scout.md` (Haiku:
finds things, changes nothing). `bash tools/brain/install.sh` copies them to `~/.claude/` where
every session on this PC finds them; run it again after changing them.

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
```

`land.sh` exits 0 when landed, 3 on a conflict, 4 when the check is red, 5 when a task is not
committed; nothing is pushed unless it exits 0. After a push it fast-forwards `~/bto-dev` when
nothing there is in the way (the development server then shows the change), says whether the real
system takes a minute (pages only) or five, and names a landed migration.

The books are in `~/bto-work/.brain/`: `lanes/<slug>` (the paths a task holds), `numbers`, `log`
(every landing), `land-check.log` (the last check). The gate is `~/bto-work/_gate`, a worktree that
stands at `origin/main` between landings.

## The check a task runs: `pnpm check:fast`

`tools/fast-check/check-fast.mjs` checks only what the change can have broken, every step at once,
each compiler remembering its last run (`.fastcheck/`, gitignored):

| Changed | Steps |
|---|---|
| `apps/web/**` or `mn.json` | web types (`tsconfig.fast.json`), the key scan, eslint and the tests beside the changed files |
| `apps/mobile/**` or `mn.json` | staff app types, the key scan, eslint, tests beside |
| `apps/api/**` | api types (incremental), eslint, the specs beside |
| `packages/**` | the packages are rebuilt, then every step above |

Measured on this PC on 2026-11-17: a page edit 29 s, a page edit with a new translation key about
80 s (the helpers that type menu and form keys from `mn.json` are rechecked), nothing changed 18 s;
`pnpm typecheck && pnpm lint` took 204 s on average. The fast configs leave out i18next's typed
keys (15 million type instantiations); `i18n-keys.mjs` checks in a fifth of a second that every
key named in the code exists. CI's `pnpm check` still types every key and runs every suite. At most
three checks run on the PC at once; a fourth waits for a slot.

## Trying the tools without touching main

`BTO_BASE_REF=<branch>` makes `task.sh new` start from that branch and `land.sh` merge onto it; then
`land.sh` never pushes.
