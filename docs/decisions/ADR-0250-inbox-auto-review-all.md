# ADR-0250: The automatic review may also land the owner's areas («auto all»)

|           |                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                              |
| Date      | 2026-11-26                                                                                            |
| Deciders  | Owner (2026-11-26: «Надаас зөвшөөрөл авах хэрэггүй. Шууд хийж бай», then «тохируул»), Claude          |
| Amends    | ADR-0249 §2 (only the allow-list lands without the owner)                                             |

## Context

Since ADR-0249 a GUARDED `in/<slug>` head that touches a migration, the schema, money, rights,
tools or an ADR waits for the owner's brain. On 2026-11-25 and 2026-11-26 the second developer's
green heads (positions and salary, the salary overrides, the QA tooling, the launchers) waited
hours for the owner, and eleven more branches waited behind them. The owner asked that green heads
land without asking him.

## Decision

1. **A second scope.** `bash tools/brain/inbox.sh auto all` (a file `inbox/auto-review.all`) lets
   the automatic review take a head the owner-only rules hold: the integration suites for its
   modules run as before (a migration adds the integrity suite), then the reviewer reads it, and an
   APPROVE lands it through `land.sh` like any other. `auto allowlist` returns to ADR-0249;
   `auto status` names the scope. Without the file nothing changes.
2. **Stricter there.** Such a head is reviewed by `BTO_REVIEW_MODEL_GUARDED` (default `opus`) and
   its prompt names the owner's areas it touches and asks for a BLOCK on any doubt: a migration
   additive or safe for every existing row, stock and money posted only through their services, no
   right wider than the commit message declares, no tool or CI change that reaches the real system
   or weakens a check.
3. **Still the owner's, even in `all`:** a weakened test (`tests-weakened`) and an unsure answer of
   the rule test. The tick's guard rails (ADR-0242: `.github/`, `deploy/`, `tools/brain/`,
   `.claude/`, `CLAUDE.md`, `AGENTS.md`, the checks, the dependencies) are refused before the review
   as before. Red suites refuse by name; BLOCK refuses with the findings; the daily budget holds.
4. drizzle's generated `meta/*_snapshot.json` is left out of the reviewer's patch (it is tens of
   thousands of lines; CI's drizzle-kit check proves it), so a migration branch fits the diff limit.

## Consequences

A migration from the second developer can go live minutes after its push with no human reading it;
the owner accepted that. A bad one is fixed forward (ADR-0206). The owner or the brain can switch
back at any time with `inbox.sh auto allowlist` or stop the review with `inbox.sh auto off`.
