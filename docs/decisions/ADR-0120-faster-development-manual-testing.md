# ADR-0120: Faster development: the owner tests by hand, automated tests stay where stock and money move

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-29 |
| Deciders | Owner («Илүү хурдтай хөгжүүлэлт хийж, гараар тест хийж шалгаад засдаг байхаар», 2026-10-29), Claude («Bto удирдлага») |
| Amends | `CLAUDE.md` (the session rules and the definition of done), ADR-0026 (unchanged: production is still deployed once; this ADR changes the pace of building, not the go-live) |

## Context

Three slices (purchase orders → receipts, transfers, issues) were built in one day, each with a full `pnpm check` several times (15–25 minutes a run), an ADR, a module document, a STATUS prompt and interview rounds, and none of them has been walked by the owner yet. The owner wants to build faster, try each change by hand on the development server, and have it fixed from what is seen. Later, many agents may hunt for bugs in parallel.

The cost of a missed defect is not the same everywhere: a layout fault is seen and fixed in minutes; a wrong ledger row, a double posting or a payable out of step with its receipt is expensive to find by hand and to unwind.

## Decision

1. **Two kinds of change.** A change is **guarded** when it touches stock, money or identity: the ledger and its caches, postings, receipts, issues, transfers, counts, invoices, vouchers, the Finance Core, the till's sales and tenders, permissions and scopes, migrations. Everything else (screens, menus, lists, filters, prints, texts, reports that only read) is **light**.
2. **Before a pull request**, a session runs `pnpm check:quick` (packages built, typecheck, lint, unit tests; a few minutes). The full `pnpm check` (integration, integrity, build) is CI's job on the pull request; the owner does not wait for it. A guarded change still runs its own integration and integrity suites locally once, and keeps them green.
3. **Tests.** A guarded change keeps the rule of CLAUDE.md: integration tests against real Postgres for every service that touches stock or money, and the integrity suite. A light change needs no new web test; existing tests must still pass.
4. **Documents.** An ADR is written only for a decision: a rule, a data structure, a flow or a right changes. A light change writes none; it adds up to three lines to `docs/STATUS.md` (what changed, what to click on dev) and keeps the module document current only where its contract changed. The interview rounds before a build are for new modules; a change to an existing screen starts from what the owner says after trying it on dev.
5. **The owner tests by hand.** Every session ends with a short list for the owner: five to ten things to click on the development server, in order, with the test logins. The owner's walk is the acceptance of a light change; a guarded change is accepted by its tests and the owner's walk.
6. **Parallel work.** Up to three worker sessions at once, each on its own slice or screen; shared files are edited additively and the second to merge merges main again.
7. **Bug hunts by agents.** Between slices, a multi-agent workflow (the Workflow tool) runs over main: finders exercise screens and routes against the development server, each finding is verified by a second agent, and confirmed findings become fix pull requests. This complements, never replaces, the owner's walk: agents find what is broken, the owner finds what does not fit the work.
8. **Unchanged:** CI green before a merge to main; the NEVER list of CLAUDE.md (migrations, `Number()` on NUMERIC, the ledger only through `StockPostingService`, idempotency keys, e-Barimt data, secrets); the ESLint guards; one slice walked before the next one that depends on it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Drop automated tests everywhere and rely on the owner's walk | A ledger or payable defect is not visible on a screen until the books disagree; unwinding it costs more than the tests. |
| Keep the full `pnpm check` before every PR | It is what slowed the day down most, and CI runs the same command anyway. |
| Keep an ADR per session | Most sessions now change screens, not decisions; the ADR index was filling with layout notes. |

## Consequences

**Positive.** A light change goes from the owner's remark to a pull request in hours; the owner sees it the same day; the ADR index holds decisions only.

**Negative.** Light changes may ship with defects that CI's full run catches only after the pull request is open; a red CI then costs a second round. The module documents may lag behind for light changes.

**Follow-ups.** `pnpm check:quick` in the root `package.json`; CLAUDE.md's session rules and definition of done rewritten; the coordinator's briefs shortened to the decisions and the owner's click list; the first bug-hunt workflow after the pull requests of ADR-0118 and ADR-0119 merge.

## Related

CLAUDE.md, ADR-0026, ADR-0115 … ADR-0119, `docs/workflows.md` §3.
