# Bto: rules for Codex and any other agent

Bto (code name `tugeel`) is the ERP of Бүтэн-Оргил ХХК: wholesale, stock, money, a supermarket till,
the office's web pages and a staff phone app. Its users and the owner speak Mongolian. The full
rules are in `CLAUDE.md` (read its **Conventions**, **ALWAYS** and **NEVER**), the design in
`docs/architecture.md`, the screens in `docs/ui.md`, each module in `docs/modules/<module>.md`, and
every decision in `docs/decisions/` (an Accepted ADR is not re-argued). This file is the short
version and your way in.

## How your work reaches main: the inbox gate (ADR-0242)

You never push to `main` (it is protected). The owner's PC lands your work through its one gate:

1. Start from the newest main: `git fetch origin && git switch -c <short-slug> origin/main`.
2. Make one small, focused change.
3. Run `pnpm check:fast` until it prints `check:fast green`. A change of stock, money, rights or a
   migration also runs its integration suites (`pnpm --filter @tugeel/api run test:integration --
   <pattern>`, needs the development PostgreSQL: `docker compose up -d --wait`).
4. Push to an inbox branch: `git push origin HEAD:in/<short-slug>`. The slug is lower-case letters,
   digits and dashes, at most 37 characters (`in/orders-label`, `in/fix-receipt-total`).
5. Read the result on the branch's head commit on GitHub: a commit status `bto/inbox-gate` and a
   commit comment (English, with one line in Mongolian). Within about half a minute it says one of:
   - `LANDED <sha>`: it is on main; the `in/` branch is deleted. Start the next change from main.
   - `WAITING-REVIEW`: checked green; the owner's brain reviews it and lands it, or writes back why.
   - `WAITING`: a task on the owner's PC is changing the same files; it goes on by itself.
   - `REFUSED <reason>`: fix what it says and push again to the same `in/<slug>` (a new head is a
     new attempt). «rebase onto main» means: `git fetch origin && git rebase origin/main`, then
     `git push -f origin HEAD:in/<slug>`.

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
  `drizzle-kit push`. Take the next free number and say so in the commit; the review checks it.
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
