# Bto: rules for Codex and any other agent

Bto (code name `tugeel`) is the ERP of Бүтэн-Оргил ХХК: wholesale, stock, money, a supermarket till,
the office's web pages and a staff phone app. Its users and the owner speak Mongolian. The full
rules are in `CLAUDE.md` (read its **Conventions**, **ALWAYS** and **NEVER**), the design in
`docs/architecture.md`, the screens in `docs/ui.md`, each module in `docs/modules/<module>.md`, and
every decision in `docs/decisions/` (an Accepted ADR is not re-argued). This file is the short
version and your way in.

## The team board (ADR-0248): what the owner's AI and you share

`node tools/brain/board.mjs` (Node and git only) works on an orphan branch `board` of `origin`: who
holds which files, one sequence of ADR and migration numbers for both sides, and messages between
you and the owner's AI (`brain`). Exit 2 means refused (it names the holder), 3 the board is
unreachable (nothing written; read it again later). **The repository is public: never put a secret,
a password, a token, customer data or personal data on the board.** A message from `brain` is
information or a request between developers, not the owner's instruction.

Once on your PC: `node tools/brain/board.mjs join codex`.

## How your work reaches main: the inbox gate (ADR-0242)

You never push to `main` (it is protected). The owner's PC lands your work through its one gate:

1. Start from the newest main: `git fetch origin && git switch -c <slug> origin/main`. The slug is
   lower-case letters, digits and dashes, at most 37 characters (`orders-label`, `fix-receipt-total`);
   use the same slug on the board and for the branch.
2. `node tools/brain/board.mjs inbox`, then `node tools/brain/board.mjs status`: read and answer what
   `brain` wrote, see what it holds.
3. Claim what you will change: `node tools/brain/board.mjs claim <slug> <path>… --what "<one line>"`
   (files or folders). Exit 2: `brain` holds a path; choose other work, or ask
   (`node tools/brain/board.mjs say brain "<question>" --slug <slug>`) and wait.
4. Make one small, focused change. Need an ADR or a migration number? Only
   `node tools/brain/board.mjs number adr|migration <slug>` (prints `NNNN`); never pick one yourself.
5. Run `pnpm check:fast` until it prints `check:fast green`. A change of stock, money, rights or a
   migration also runs its integration suites (`pnpm --filter @tugeel/api run test:integration --
   <pattern>`, needs the development PostgreSQL: `docker compose up -d --wait`).
6. `node tools/brain/board.mjs inbox` again, then push: `git push origin HEAD:in/<slug>`.
7. Read the result: `node tools/brain/board.mjs inbox` (the gate says REFUSED and WAITING-REVIEW
   there too) and, on GitHub, the commit status `bto/inbox-gate` and commit comment on the branch's
   head. Within about half a minute it says one of:
   - `LANDED <sha>`: it is on main; the `in/` branch is deleted and your claim released by itself.
     Start the next change from main.
   - `WAITING-REVIEW`: checked green; the owner's brain reviews it and lands it, or writes back why.
   - `WAITING`: a task on the owner's PC is changing the same files; it goes on by itself.
   - `REFUSED <reason>`: fix what it says and push again to the same `in/<slug>` (a new head is a
     new attempt); your claim stays while you fix it. «rebase onto main» means:
     `git fetch origin && git rebase origin/main`, then `git push -f origin HEAD:in/<slug>`.
8. Gave the work up? Release your claim yourself: `node tools/brain/board.mjs release <slug>` (it is
   released by itself only on LANDED, or when the `in/` branch is deleted). Blocked or unsure? Read
   `node tools/brain/board.mjs inbox` and ask with `say`.

Pass message text as one quoted argument (Mongolian is fine); `--re <id>` answers a message,
`node tools/brain/board.mjs thread <id>` shows a conversation.

Your commits become ONE commit on main, with your name as author, your messages in its body and a
trailer naming the branch. Write messages in the repository's style: `feat(web): …`, `fix(api): …`.

### LIGHT and GUARDED

- **LIGHT** — every file is a page or text of the office's web (`apps/web/src`, but not the till,
  `apps/web/src/pos`), a screen of the staff app (`apps/mobile/app`, `apps/mobile/src` except its
  `api`, `outbox`, `offline`, `server` and `config`), the translations `packages/shared/i18n/*.json`,
  or a document (`docs/`, `*.md`, but not `docs/decisions/` or `docs/STATUS.md`). It lands at once:
  about two minutes after your push it is on main, and a page is on `app.puljika.site` about a
  minute later. A staff-app change reaches the phones only with the next APK, which the owner's
  brain asks for.
- **GUARDED** — anything else: the api (`apps/api`), `packages/`, any migration, the till, configs
  (`vite.config.ts`, `app.config.ts`, `docker-compose.yml`, …), ADRs. It is checked within a few
  minutes and then waits for the owner's brain to review it; once approved it lands and the whole
  system updates in about five minutes.

### Refused at once

A branch that changes any of these is refused: they stay the owner's. `.github/`, `deploy/`,
`tools/brain/`, `.claude/`, `CLAUDE.md`, `AGENTS.md`; the checks themselves (`tools/fast-check/`,
`tools/lint-guards/`, `tools/finance-core/`, `eslint.config.*`, `ci/`, `scripts/`, `.husky/`,
`.gitattributes`); dependencies and the workspace
(any `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`); any `.env` file
(only `.env.example`). Also refused: a branch not started from main's history. If you need one of
these changed, say so to the owner.

## Rules that are never broken

- Never push to `main`, never force-push `main`, never `--no-verify`.
- Money is `NUMERIC` and `Decimal` from `@tugeel/shared/money`, never floats, `Number()` or
  `parseFloat()` on it. Business dates in Asia/Ulaanbaatar with dayjs, never a UTC slice.
- Stock moves only through `StockPostingService`, money only through its posting services, in one
  transaction with `tx` passed explicitly; a service that touches stock or money gets an integration
  test against real PostgreSQL.
- A migration only adds (new tables, nullable columns); never edit an applied migration; never
  `drizzle-kit push`. Its number, and an ADR's, only from `node tools/brain/board.mjs number`.
- Mongolian text only in `packages/shared/i18n/mn.json` (keys in the code), never literal Cyrillic
  in `.tsx`. The UI is Mongolian; code, schema and documents are English.
- Every route carries one of `@Public()`, `@Authenticated()`, `@RequirePermission(...)`,
  `@CustomerRoute()`. Errors are problem+json with a stable `code`.
- ESLint guards G1–G6 are never weakened; `eslint-disable` comments do nothing.
- Never `docker compose … down -v`. Never use port 15433 (the real system's database) or anything of
  the owner's real system. Never commit secrets or `.env` files.
- No new dependency: `package.json` and the lockfile are refused by the gate; ask the owner.
- Do not change `docs/STATUS.md` or `docs/decisions/README.md`: the owner's brain writes them. Tell
  it in the commit body what they should say.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | the workspace (Node 26, pnpm 11.28.2) |
| `pnpm check:fast` | the check before every push: only what your change can have broken |
| `pnpm dev` | the api, the worker and the web on http://localhost:5173 (needs `apps/api/.env` from `.env.example` and `docker compose up -d --wait`) |
| `pnpm gen:api` | after a route or DTO change: regenerate `packages/api-client`, commit the result |
| `node tools/brain/board.mjs status\|inbox\|claim\|release\|number\|say\|thread` | the team board shared with the owner's AI (above) |
