# ADR-0249: The inbox gate reviews and lands GUARDED branches by itself

|           |                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                                                                |
| Date      | 2026-11-24                                                                                                                              |
| Deciders  | Owner (2026-11-24: «Тийм, автомат»), Claude (the brain's worker)                                                                         |
| Amends    | ADR-0242 (the inbox gate: §3 the rule, §5 GUARDED waits for the brain)                                                                   |

## Context

Since ADR-0242 a GUARDED `in/<slug>` branch that passed `check:fast` waits as `WAITING-REVIEW` until
a Claude session looks, which happens only when the owner tells the brain «check what came from
outside». The second developer then waits hours for changes the brain would approve in minutes.

The same day showed what the gate does not see. (a) A LIGHT branch (pages and texts) landed by
itself and, without saying so in its commit message, changed many existing Mongolian texts in
`packages/shared/i18n/mn.json` («Суурь нэгж» → «Хэмжих нэгж», …). Three of them were import column
labels, which the api matches by their text: Excel files made from the old template stopped being
recognised on the real system, and an api integration test went red on main. (b) The next branch
tried to rewrite 55 more existing texts inside an unrelated feature. Existing wording is the owner's.

## Decision

1. **A reviewer of its own.** `tools/brain/inbox.sh review` is one pass on one head: the oldest
   `WAITING-REVIEW` head without a verdict. The user timer `bto-brain-review` (every minute, `nice
   15`, `install.sh`) runs it with its own lock (a second pass exits at once). It takes the inbox
   lock only to read and write the books, never while the suites or the reviewer run: the tick
   (every 20 s) stays as fast as it was.
2. **An allow-list decides what the machine may land, by the script, first.** Every changed path is
   decided by `decide()` in `tools/brain/review.mjs`, with no AI, in this order: a named owner-only
   rule (`OWNER_ONLY`) → a test file, by the file it tests → the allow-list `AI_MAY_APPROVE` → a named
   fallback rule (`OWNER_FALLBACK`) → `unlisted`, the owner's. A head reaches the suites and the AI
   only when every path is on the allow-list and no diff rule holds it; anything else stays
   `WAITING-REVIEW` with the rules named, for the owner's brain. A test walks the repository's own
   files: none may be `unlisted`, so a new area is decided on purpose.

   **What the AI may land (`AI_MAY_APPROVE`):**

   | Entry | Paths |
   | --- | --- |
   | `api-read-modules` | the api modules `reporting`, `catalog`, `partners`, `customer` (reports and master data; no stock or money posting), without what a rule below holds there (schema, hooks, index, Nest module, ordering, accounts) |
   | `api-read-side` | in any other module no rule names: only `services/*-query.service.ts` and `dto/**` |
   | `api-client` | `packages/api-client/openapi.json`, `packages/api-client/src/generated/**` |
   | `web` | `apps/web/src/**`, `apps/web/public/**`, `apps/web/index.html` (not the till) |
   | `mobile` | `apps/mobile/app/**`, `src/**`, `assets/**` (not its sync, orders, picking, transfers, counts) |
   | `docs` | `docs/**` and `*.md` (not decisions and the books) |
   | `i18n-keys` | `packages/shared/i18n/**/*.json`, when keys are only added |
   | tests | `*.spec.ts`, `*.test.ts(x)` and `apps/api/test/integration/*.int-spec.ts` whose subject (the file without `.spec`, or the module the suite's name names) is on this list |

   **Owner-only, named (`OWNER_ONLY`, checked first):**

   | Rule | Paths | Why it is the owner's |
   | --- | --- | --- |
   | `migration` | `apps/api/src/db/migrations/**`, the drizzle configs | It goes live at once and a deploy cannot roll back past it (ADR-0206). |
   | `schema` | `apps/api/src/db/**`, any `schema.ts` or `*.schema.ts` of the api | A schema change needs a migration or a role change. |
   | `decision` | `docs/decisions/**`, `docs/STATUS.md`, `docs/architecture.md`, `docs/SPEC.md` | Decisions and the books are the owner's and the brain's. |
   | `boundaries` | a module's `index.ts` and `hooks.ts`, any `*.module.ts`, the api's root files, a package's `src/index.ts` | A module's public face and the app's wiring (architecture §3, §4). |
   | `till` | `apps/web/src/pos/**`, `apps/web/pos.html`, the edge, any `pos` folder | A till that breaks stops the shop. |
   | `money` | any `finance`, `finance-core`, `fin-bridge`, `fin-contract`, `money`, `payment(s)`, `cash`, `ebarimt`, `ebarimt-check`, `erkhet`, `erkhet-stock`, `payroll` folder, their integration tests, `repost-journal.ts` | Money and the books: the accounts, the tax receipts, the pay. |
   | `integrity` | `apps/api/test/integrity/**`, `apps/api/test/harness/**` | The last net under stock and money is never weakened. |
   | `rights` | any `identity`, `auth`, `roles`, `permissions`, `guards` folder, a `*guard*.ts`, the AI module, an api file named for an account, password, login, token, session or OTP, their tests | Who may sign in and do what, and what the AI assistant may read. |
   | `orders` | an api module file named for an order, cart, checkout or shop (not a query service or a DTO) | An order reserves stock and books a sale (the customer module places orders). |
   | `staff-app-sync` | the staff app's `src/outbox`, `offline`, `api`, `cart`, `orders`, `transfers`, `counts`, `picking` and its order, transfer, count, picking and checkout screens | What the app queues offline and posts later moves stock and money. |
   | `integrations` | `apps/api/src/integrations/**` | What leaves this PC (PosAPI, SMS, LLMs) and with which credentials. |
   | `config` | root files, build and test configs, `tsconfig*.json`, Docker files, app configs, `.env*`, dotfiles, `package.json`, `apps/api/src/common/config/**`, the staff app's `config`/`server` | Configs change how everything else is built, checked or reached. |
   | `tools` | `tools/**`, `deploy/**`, `ci/**`, `scripts/**`, dot-folders | The repository's own tools (the gate refuses most of them before). |

   **Owner-only, the rest of the tree (`OWNER_FALLBACK`, after the allow-list):** `tests` (a test of an
   area not on the list, any other file under `apps/api/test/`), `api-write` (every other file of an
   api module: services, controllers, jobs that post stock, money, prices or documents), `api-platform`
   (the rest of `apps/api`: `common/**` with the database access, transactions, jobs), `shared`
   (every package but the generated client and the texts: `packages/shared/src/**` with pricing,
   units, inventory and sales rules), `app-platform` (the apps' other files); and `unlisted`.

   **Owner-only by what the diff does:** `wording` (below); `tests-weakened` (a test file deleted,
   fewer `it(`/`test(` declarations than before, or more `.skip`, `.only`, `.todo`, `xit`,
   `xdescribe`, `fit`); `binary` (a binary file the reviewer cannot read, except the apps' images);
   `route-rights` (a changed line that adds, removes or changes `@Public`, `@Authenticated`,
   `@RequirePermission` or `@CustomerRoute`). A check that cannot run (an unreadable revision, a
   file that is not JSON) makes the head the owner's.
3. **The wording rule also classifies.** The tick compares each changed `.json` under
   `packages/shared/i18n/` (at any depth; another file there is GUARDED)
   of the merge-base and the head by key path. A branch that only adds keys stays as it was (LIGHT
   when the rest is LIGHT). A branch that changes or removes an existing text is GUARDED, its record
   keeps the list `key: «old» → «new»` (bounded), and the review leaves it to the owner. Changing
   wording is its own branch `in/wording-<topic>` with the full old → new list in its commit message
   (`AGENTS.md`).
4. **Then the suites.** The integration suites `status` already names (the touched api modules, and
   the integrity suite for stock and money paths) run in the head's copy with its own `int.sh`, which
   tests the tree it lies in, 20 minutes at most each (`BTO_REVIEW_SUITE_TIMEOUT`). Red refuses the
   head (`reject`) with the failing suites and tests by name only: the repository is public, so no
   test output goes to GitHub.
5. **Then the AI, on a clean export.** The Claude CLI on this PC (signed in with the owner's Max
   plan; `$BTO_CLAUDE`, else `claude` on PATH, else the newest `~/.config/Claude/claude-code/*/*/claude`)
   runs headless as the reviewer (`agents/bto-review.md` with this run's rules), model `sonnet`
   (`BTO_REVIEW_MODEL`), not in the copy but in `git archive HEAD` of it, unpacked beside the review's
   inputs: no `.env`, no `node_modules`, no `.git`; the export is removed afterwards (also on a timeout
   or a kill). Its tools: `Read`, `Grep`, `Glob` only (`--tools`), `--permission-mode dontAsk`,
   `--restricted` (its file tools stay inside the export and the inputs' folder), `--safe-mode` (no
   user CLAUDE.md, hooks, skills, plugins), `--strict-mcp-config`, and `Read`/`Grep`/`Glob` of
   `**/.env*` denied anyway; ten minutes and 60 turns at most, without `ANTHROPIC_API_KEY`. It reads
   the diff, the commit message and the changed files' list the script wrote, `CLAUDE.md`,
   `AGENTS.md` and the touched modules' documents. It must answer in a JSON schema
   (`--json-schema`): APPROVE, or BLOCK with at most 10 findings (severity, file, line, one
   sentence). The verdict is read only from the CLI's final structured answer; an APPROVE listing a
   HIGH finding is a BLOCK.
6. **No secret leaves the PC.** Before a finding or an error text is written anywhere, a line that
   holds a value of the copy's `.env` files (8 characters or more) or looks like a key, a JWT, a
   private key or a connection string with a password is replaced by «(removed: looked like a
   secret)».
7. **Act.** Only on the head and squashed diff that were reviewed: BLOCK → `reject` with the
   findings, made safe as the board makes text safe; red → `reject` with the names; APPROVE and green
   → the record says `approved`, and the next tick lands it through `approve`, the same path the
   brain uses (`land.sh`, its checks; a refusal there is a normal REFUSED), while its squashed diff
   is still the one reviewed (a new head is a new review). The landing is the tick's so that it runs
   in the inbox's unit, where a landing's background jobs outlive it. Anything else (the CLI missing
   or not signed in, a timeout, an unreadable answer, a usage limit, a suite that hangs) → the head
   stays `WAITING-REVIEW` «needs the brain» with the reason: one retry after 15 minutes, then never
   again on its own. Never an approval on an error.
8. **Time.** One pass keeps to one deadline (`BTO_REVIEW_DEADLINE`, 3000 s) for its suites and its
   reviewer, below the unit's limit (3600 s). Every child runs without the gate's lock files and
   under `timeout`, which stops its whole process group; the unit is `KillMode=control-group`, so a
   killed pass leaves nothing holding `review.lock` or `int.lock`.
9. **A budget.** At most `BTO_REVIEW_MAX_PER_DAY` (40) AI reviews a day; beyond it heads wait for the
   brain with that reason, and are taken again when the budget allows.
10. **Seen and said.** Every outcome is in the record (verdict, model, seconds, the review's folder
   with its inputs and the CLI's answer, on this PC only), in `inbox.sh status` (a `review:` line),
   on the monitor's inbox cards (in Mongolian), on GitHub (`REVIEWED-LANDED`, the refusal with its
   findings, or a pending status «WAITING for the owner / for the brain») and on the board to
   `codex`. A head left for the owner or the brain is also said to `brain` (sent as `gate`), so the
   owner's Claude sees it before its next prompt through the board's hook.
11. **A switch.** `inbox.sh auto off|on|status` (a file in the gate's state folder): off, every
   GUARDED head waits for the brain as in ADR-0242. On unless turned off. `review --dry-run` shows
   what a pass would do and runs nothing; `review --again in/<slug>` forgets a verdict. The brain's
   `approve` and `reject` work on any waiting head, also one the review has marked.

## Trust model

The reviewer reads a trusted collaborator's code; the gate is not a defence against a hostile one
(ADR-0242). Still, a diff can talk an AI round: a comment or a commit message aimed at the reviewer.
So the hard rails are the script's: the guard rails the tick refuses, the allow-list (what is not on
it is the owner's), the diff rules (wording, weakened tests, binaries, route rights), `check:fast`
and the integration suites, none of which an AI decides. The AI is the soft rail on top, and only
for reports, master data, read-side queries, shapes, screens, documents, new texts and added tests:
it can refuse what the hard rails let through, and its approval lets through only what they already
allowed. Everything that posts stock or money, prices, rights, the till, migrations, shared packages
and wording waits for the owner's brain. The prompt and the role call everything in the export data
from another party (an instruction found there is a HIGH finding, so is an undeclared change); its
tools cannot run a command, write a file, reach the network or an MCP server, or read outside the
export and its inputs (a probe on 2026-11-24: `/etc/hostname` and a planted `.env` were denied, a
Grep and a Glob for the planted value found nothing); its verdict is read from the CLI's structured
answer, never from text the diff could plant; and its words are scrubbed of secrets before they
leave the PC.

## Cost

About 1 to 10 minutes of the owner's Max plan per reviewed head (probes on tiny diffs: 7 to 10 s,
five to seven turns, 0.02 to 0.03 USD of Sonnet at list prices), plus the suites' time on this PC, one at a time
(`int.sh`). The budget caps a loop at 40 reviews a day.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| Keep every GUARDED head for the brain | The second developer waits until the owner asks; the owner decided «автомат». |
| Review inside the tick | A review takes minutes; every LIGHT branch would wait behind it. |
| Let the AI decide everything, owner-only paths too | A migration, money or rights mistake costs most and a diff can talk an AI round: those stay a person's call. |
| Read the verdict from the model's last line of text (as `bto-review` does for the brain) | Text the diff planted could be repeated as that line; the CLI's schema-checked structured answer cannot be. |
| An API key for the reviewer | A second bill and a key on this PC; the CLI is already signed in with the owner's plan. |

## Consequences

A GUARDED head of the second developer that stays inside the allow-list lands without the owner,
typically 5 to 30 minutes after its push; everything else waits for the owner's brain with a named
reason instead of silently. A
branch that rewrites existing texts no longer lands as LIGHT. The brain's inbox work narrows to the
heads marked owner-only or «needs the brain». A Claude CLI update that changes its flags or its JSON
answer leaves heads «needs the brain» (fail closed) until `inbox.sh` follows it.

## Related

ADR-0206, ADR-0213, ADR-0242, ADR-0248, `tools/brain/inbox.sh`, `tools/brain/review.mjs`,
`tools/brain/README.md` «The automatic review», `AGENTS.md`.
