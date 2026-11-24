# ADR-0242: The inbox gate: a second developer lands through the one gate

|           |                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                                                                |
| Date      | 2026-11-24                                                                                                                              |
| Deciders  | Owner (2026-11-24: «2 өөр AI ашиглаж буй 2 хүн нэг тархитай, алдаагүй хамгийн хурднаар main push хийгдэж app.puljika.site гардаг байх»), Claude (the brain's worker) |
| Amends    | ADR-0213 (the brain and its one gate)                                                                                                    |

## Context

A second developer now works on Bto from another PC with OpenAI Codex. Codex reads `AGENTS.md`, not
`CLAUDE.md`, and knows nothing of the brain's books. Everything that reaches `main` is live on
`app.puljika.site` within one to five minutes (ADR-0204 … 0206, ADR-0215), and the one gate
(`land.sh`, ADR-0213) is what keeps two pieces of work off each other's files and checks each landing
once. A second pusher outside that gate would land beside running tasks without their claims, skip
`check:fast`, and race `land.sh` for `main`. GitHub already protects `main` (a pull request with one
review; the owner's account, an admin, is not held to it), so the second developer cannot push there.

## Decision

1. **The way in is a branch `in/<slug>`** on GitHub, from main's history (`<slug>`: lower-case
   letters, digits, dashes, at most 37). `AGENTS.md` at the repository's root tells Codex the
   essential rules of `CLAUDE.md` and this workflow.
2. **A timer takes it:** `tools/brain/inbox.sh tick`, the user timer `bto-brain-inbox.timer` every
   20 seconds at low priority (installed by `tools/brain/install.sh`). It fetches `in/*` into
   `refs/inbox/*` and takes each head it has not handled; one lock, so two ticks never run at once;
   a new push to the same branch is a new attempt and replaces one still waiting.
3. **The rule.**
   - **Refused at once**, never opened: a head not on top of a commit of main's history, and any
     change of the guard rails, which stay the owner's: `.github/`, `deploy/`, `tools/brain/`,
     `.claude/`, `CLAUDE.md`, `AGENTS.md`; the checks themselves (`tools/fast-check/`,
     `tools/lint-guards/`, `tools/finance-core/`, `eslint.config.*`, `ci/`, `scripts/`, `.husky/`,
     `.gitattributes`), because a branch that changes the check would be judged by its own check;
     the dependencies and the workspace (any `package.json`, `pnpm-lock.yaml`,
     `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`), because a new package is installed on this PC and
     workers may not add one either; any `.env` file but `.env.example`; and a file name with a
     quote, a backslash or a control character. Names are read unquoted (`git diff -z`), so a
     non-ASCII name under a guard rail is still under it.
   - **LIGHT**: every file is a page or text of the office's web (`apps/web/src` without the till's
     `apps/web/src/pos`, `apps/web/index.html`, `apps/web/public`), a screen of the staff app
     (`apps/mobile/app`, `apps/mobile/assets`, `apps/mobile/src` without `api`, `outbox`, `offline`,
     `server`, `config`), the translations (`packages/shared/i18n/*.json`), or a document (`docs/`,
     `*.md`, without `docs/decisions/` and `docs/STATUS.md`). Every LIGHT path is one auto-deploy
     builds as «pages only» or not at all (ADR-0205, ADR-0215): LIGHT never makes a whole update,
     never pauses the tills.
   - **GUARDED**: everything else: the api, `packages/`, any migration, the till, every config, ADRs.
4. **Through the brain's own books.** An attempt opens a task `in-<slug>` with `task.sh new` and
   every changed file, so it cannot collide with a running task: while one holds a path the attempt
   is `WAITING` and the next ticks retry. The branch's commits become ONE commit in the task's copy
   on top of `origin/main` (squash): the author, email and date of the branch's head stay, the body
   carries every commit's message, and the trailers `Inbox-Branch:` and `Inbox-Head:` name it.
   `land.sh` keeps that author on `main`. A conflict drops the task and asks for a rebase. The task
   names `in-*` are the gate's: `task.sh` opens one only for the gate and records it (`owners/`), and
   the gate drops only what it opened.
   An attempt carries a phase until it reaches a state; a tick that finds one left by a killed tick
   finishes it as `LANDED` when its head's trailer is on `origin/main`, or drops the gate's task and
   tries the head again.
5. **LIGHT lands at once** through `land.sh` (its `check:fast`, its push). **GUARDED is checked**
   (`check:fast` in the copy) and waits as `WAITING-REVIEW` for the brain, which reviews it as it
   reviews a `bto-core` task and runs `inbox.sh approve` (then `land.sh`) or `inbox.sh reject`. A
   red check drops the task. Nothing but `land.sh` pushes `main`; the gate only deletes a landed
   `in/` branch, and only while it still points at the landed head.
6. **Written back on GitHub** with `gh` as the owner: a commit status `bto/inbox-gate` and a commit
   comment on the head, `LANDED <sha>`, `WAITING-REVIEW`, `WAITING` or `REFUSED <reason>`, in English
   with one line in Mongolian, once per result (retried while GitHub is unreachable). The repository
   is public: a red check is named by its failing step, never by its output or a local path; the
   output stays in the gate's logs on this PC.
7. **Seen** in `inbox.sh status`, on the monitor (`/api/state`'s `inbox`, its own section) and in
   `~/bto-work/.brain/inbox/` (records, a log, each attempt's log).

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| The second developer pushes to `main` | Outside the books and the one gate: no claims, no single check, a race with `land.sh`; a mistake is live in minutes. |
| Pull requests merged on GitHub | A merge on GitHub skips the books and `check:fast` on this PC, and CI's full check takes far longer than the owner's «as fast as is safe». |
| Every change waits for the brain's review | A text or a page would wait for a Claude session to look; LIGHT changes reach only pages and documents, which the check and the owner's eyes already cover for the brain's own `bto-ui` tasks. |
| Every change lands without review | The api, migrations and money are where a mistake costs; ADR-0120 keeps them guarded for the brain's own work too. |
| Run the integration suites in the tick | Ten minutes and more, one at a time on this PC (`int.sh`): the tick would hold back every LIGHT branch. `status` names the suites and the brain runs them while reviewing. |

## Consequences

A page or a text from the second developer is on `main` about two minutes after the push and on
`app.puljika.site` about a minute later; a GUARDED change waits for the brain, which a Claude session
only sees when it looks (`status`, the monitor, GitHub's pending status): nothing wakes it. A
staff-app change reaches phones only with the next APK, which the brain requests (ADR-0229); an
`in-*` task holding app paths holds the APK like any task. The second developer's tests run on this
PC during `check:fast`, as a worker's do: the gate keeps mistakes off `main`, it is not a defence
against a hostile collaborator. Their migration takes the next free number on their own; the review
checks it, and the copy's file keeps `task.sh number` from handing it out again. A change the gate
refuses (a dependency, a check, a deploy script) goes through the owner's brain. The task names
`in-*` belong to the gate; `task.sh` refuses them to anyone else.

## Related

ADR-0120, ADR-0204, ADR-0205, ADR-0206, ADR-0213, ADR-0215, ADR-0229, `tools/brain/inbox.sh`,
`tools/brain/README.md` «The inbox gate», `AGENTS.md`.
