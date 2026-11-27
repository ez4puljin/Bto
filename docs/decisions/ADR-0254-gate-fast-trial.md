# ADR-0254: While staff only try Bto, the gate checks a head in minutes («auto fast»)

|           |                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                              |
| Date      | 2026-11-27                                                                                            |
| Deciders  | Owner (2026-11-27: the organisation does not use app.puljika.site for real yet; staff try it and report; «codex сайжруулалт хүртэл маш хурдтай app.puljika.site дээр гардаг болго»), Claude |
| Amends    | ADR-0250, ADR-0253                                                                                    |

## Context

app.puljika.site runs on the real server, but the company has not started working in it: staff
try it and say what to improve, and the owner wants each fix, the second developer's included,
on the site within minutes. Its data is still test data. Even the focused suites of ADR-0253 and
the stricter model keep a stock or money head in the gate for ten minutes or more.

## Decision

1. `inbox.sh auto fast` (a file `inbox/auto-review.fast`), or the file `tools/brain/inbox/review-fast`
   in the repository so that a push alone sets it on the gate PC: the automatic review runs the
   integration and integrity suites only for a head that adds or changes a migration, and uses the
   stricter model (`opus`) only there; every other head is checked by `check:fast` at the tick and
   by the reviewer (`sonnet`), and lands. CI's full `pnpm check` runs every suite after landing.
2. A migration still runs its suites and the stricter review first: a migration cannot be rolled
   back (ADR-0206), and one that fails stops every later deploy.
3. `inbox.sh auto all` or `auto allowlist` switches the state file off; the repository file is
   removed by a commit.

## Consequences

A head without a migration reaches app.puljika.site about five to ten minutes after its push
(tick, check:fast, review, landing, the auto deploy). A bug the suites would have caught shows on
CI and on the site, and is fixed forward with another push. Before the company starts using the
system for real, delete `tools/brain/inbox/review-fast` to bring the suites back.
