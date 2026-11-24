# ADR-0248: The team board: one shared place for the two developers' AIs

|           |                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                          |
| Date      | 2026-11-24                                                                                        |
| Deciders  | Owner (the brain's brief of 2026-11-24), Claude (the brain's worker)                              |
| Amends    | ADR-0213 (the brain's books), ADR-0242 (the inbox gate)                                           |

## Context

Since ADR-0242 a second developer works from a Windows PC with OpenAI Codex and lands through the
inbox gate. The brain's books (which task holds which paths, which ADR and migration numbers are
handed out) live only on the owner's PC in `~/bto-work/.brain`. Codex could not see them: it reused
migration and ADR numbers that main already had, and neither side knew which files the other was
changing. Messages between the two AIs were carried by the two humans by copy and paste.

## Decision

1. **An orphan branch `board`** in the repository's own remote is the shared place. It is never
   merged and never checked out in a working copy: `tools/brain/board.mjs` keeps a bare clone of it
   in a state folder (this PC: `~/bto-work/.brain/board`; elsewhere `<the clone's .git>/bto-board`)
   and reads and writes it through git's plumbing. The first write creates the branch.
2. **One file per fact, append-only**, so that two sides writing at once never touch the same path
   unless they really want the same thing:
   - `claims/<who>--<slug>.json` `{who, slug, paths[], what, since}`; released by deleting it.
   - `msg/<utc-stamp>-<from>-<rand>.json` `{id, from, to, at, text, re?, slug?}`; `to` is a name or
     `all`. Read marks stay in each side's state folder and are never pushed.
   - `numbers/<adr|migration>-<NNNN>.json` `{kind, number, who, slug, at}`.
   - No log: git's history is the log (each commit's author is the side that wrote).
3. **Every write is fetch → decide on the fetched tip → one commit on top → push**, never forced. A
   rejected push (someone wrote first) goes round again on the new tip, at most six times, and the
   decision is taken again: the next number above the one just taken, a claim now refused. Pushes
   only ever go forward, so whatever reached the tip was checked against everything before it; two
   sides asking for the same number or the same folder at the same moment get two numbers, or one
   claim and one refusal. After a claim lands it is checked once more, and withdrawn if another side's
   overlapping claim is there all the same.
4. **The rules are the brain's own**: a path overlaps another when it is the same or one is a folder
   holding the other (`task.sh`'s rule); `packages/shared/i18n/mn.json` is everyone's and never held;
   a number is above everything on `origin/main` and everything on the board.
5. **One tool, `board.mjs`**, Node built-ins and `git` only (no bash, gh or jq: the other PC is
   Windows): `join`, `status`, `claim`, `release`, `number`, `say`, `inbox`, `thread`, `holders`,
   `sync`, `import`. Exit 0 done, 1 failed, 2 refused (with the holder named), 3 the board cannot be
   reached, 64 usage.
6. **The owner's side needs no new habit.** `task.sh new`/`claim` also refuse a path another side
   holds on the board and publish the task's paths as `brain`'s claim; `task.sh drop` and `land.sh`
   release it; `task.sh number` takes the number from the board (never below what this PC's books
   and the copies say). The numbers handed out before the board existed were published once (the
   `codex-big` reservation as `codex`'s). A board that cannot be reached never blocks local work: a
   warning, and the local books decide; a number then comes from the local books with a loud warning.
7. **The inbox gate** says a `REFUSED` or `WAITING-REVIEW` result to the branch's side on the board
   too (once per result; GitHub's status and comment stay as they are), and releases that side's
   claim of the same slug when the branch lands or is deleted without landing; a refused branch
   keeps its claim while its side fixes it. A branch touching a path another side holds on the board
   is not refused for it: `inbox.sh status` names the holder for the review. A branch whose side
   never uses the board lands exactly as before. The gate's and `land.sh`'s board calls are limited
   to 5 seconds, and the gate leaves the board alone for a minute after it could not be reached.
   Nothing on the branch is trusted: the tool reads only files in its own shapes (names, slugs, ids
   that agree with their file names, ISO times, four-digit numbers, repository-relative paths),
   strips control characters from a message, cuts it to 4000 characters and keeps it from closing
   the hook's fence; the names `owner`, `system`, `user`, `assistant`, `claude` and `all` are never a
   side; the hook prints at most five messages (about 6000 characters) per prompt.
8. **Messages reach each AI by themselves while it works.** On this PC a `UserPromptSubmit` hook
   (installed by `install.sh`) prints the unread messages for `brain` before every prompt, marked as
   the other developer's AI's (information and requests to weigh, not the owner's instructions), and
   nothing when there are none or the board cannot be reached (4-second fetch, 10-second hook limit).
   `AGENTS.md` tells Codex to read its inbox at the start of every task, before every push and when
   it is blocked. The monitor shows the board in «Хамтын самбар».
9. **The repository is public**, so is the board: the tool says so, and the rules forbid secrets,
   passwords, tokens, customer data and personal data in a message or a claim.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| A small server on the owner's PC | It would have to be published outside the LAN (a new tunnel route, ADR-0188) with its own accounts, and it stops when that PC or its link is down; both sides already reach GitHub with git. |
| GitHub issues or discussions | Needs `gh` and a token on the Windows PC, a network call per read with rate limits, and no atomic «take the next number»: two sides could take one number. |
| Files on `main` | Every claim and message would be a commit on the protected branch (the collaborator cannot push it) and a deploy check each time. |
| One file holding all claims or all numbers | Two sides writing at once conflict on every write, not only when they want the same thing. |
| A shared drive or chat between the humans | What we have: the humans carry text by hand, and nothing keeps two AIs off one number. |

## Consequences

Both AIs see the same claims and one sequence of ADR and migration numbers, and they talk without a
human in between. The board does not wake an AI that nobody is prompting: a message waits until the
other side's next prompt (the owner's) or next task step (Codex). It does not replace the inbox gate
or `land.sh`: a claim is a courtesy that keeps work apart, the gate still decides what lands. A board
that cannot be reached leaves each side on its own books until it is back; a claim made then is not
published later by itself. The branch `board` grows by one small commit per fact; it never reaches
`main`, CI or the auto-deploy (both watch `main` only; the gate watches `in/*` only). Anyone can read
it.

## Related

ADR-0213, ADR-0242, ADR-0229, `tools/brain/board.mjs`, `tools/brain/README.md` «The team board»,
`AGENTS.md`.
