# Tugeel (Түгээл)

In-house ERP for a wholesale distribution center in Ulaanbaatar: product catalog with multi-unit barcodes, multi-warehouse stock on an append-only ledger, customer ordering (web admin, customer app, sales reps), picking and zone-based delivery, receivables with credit control (cash and bank transfers, no QPay), mandatory e-Barimt receipts, a supermarket POS, procurement, reporting and HR/payroll. Built and maintained by one owner-developer with Claude Code, one module per session. The UI is Mongolian only; code, schema and all documents except `docs/SPEC.md` are English.

## Documentation

| Document | Content |
|---|---|
| `docs/SPEC.md` (Mongolian) | scope, roles, glossary, user stories and acceptance criteria per module, business rules, first-deliverable cut line, roadmap, open questions |
| `docs/architecture.md` | stack and version pins, repo layout, module boundaries, domain model, integrations (e-Barimt, scanners, printers), deploy, conventions for the agent |
| `docs/decisions/` | ADR-0001 … ADR-0027; index, rules and template in `docs/decisions/README.md` |
| `docs/STATUS.md` | progress per delivery, Week 0 checklist for the owner, pending decisions, the next-session prompt |
| `CLAUDE.md` | the contract every Claude Code session reads first: pins, commands, ALWAYS / NEVER, docs map |

## Working on it with Claude Code

1. Open the repository in Claude Code; `CLAUDE.md` is read automatically.
2. Paste the "Next session" prompt from `docs/STATUS.md` and start in plan mode.
3. One module per session; `pnpm check` green is the definition of done; update `docs/STATUS.md` before the session ends.

## Local development (Windows 11 or Linux)

1. Install Node.js 26, Docker Desktop and pnpm 11 (`npm i -g pnpm@11.28.2`).
2. `pnpm install`, then copy `apps/api/.env.example` to `apps/api/.env`.
3. `docker compose up -d --wait` (PostgreSQL 18 on `127.0.0.1:15432`), `pnpm db:provision`, `pnpm db:migrate`.
4. `pnpm dev` (http://localhost:5173) or `pnpm check` (everything CI runs).
5. To test from another PC on the same network, double-click `start.bat` (it prints `http://<this PC>:5173`) and `stop.bat` afterwards. Windows Firewall must allow Node.js on private networks.

Stack: TypeScript end-to-end, Node 26, pnpm 11, NestJS 12, PostgreSQL 18 + Drizzle, pg-boss 12, Vite 8 + React 19, one Expo codebase for two apps (from delivery 4); developed and accepted locally until one go-live after the last delivery (ADR-0026), then hosted on DigitalOcean SGP1; e-Barimt PosAPI 3.0 on an office mini-PC reached over Tailscale. Source: github.com/ez4puljin/Bto (public).

License: Proprietary — internal use.
