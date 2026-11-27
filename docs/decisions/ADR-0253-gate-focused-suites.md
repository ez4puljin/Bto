# ADR-0253: The inbox gate runs only the integrity suites a change calls for

|           |                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                              |
| Date      | 2026-11-27                                                                                            |
| Deciders  | Owner (2026-11-27: «шалгалт яагаад удаж байна вэ? Маш хурдтай…», «20 мянган барааны тест хэрэггүй»), Claude |
| Amends    | ADR-0249 §3 (the suites of a reviewed head)                                                           |

## Context

A GUARDED head that touched a migration or a module of stock and money ran the whole integrity
project in the gate: about fifty suites one after another (`--runInBand`), 12 to 13 minutes, before
the reviewer's own minutes. Two of them build a 20,000-product catalogue to time the segments and
the imports; on 2026-11-27 that seed hit the statement timeout on the gate PC and refused a change
that never touched the catalogue. The owner wants the second developer's work live much faster and
said the 20,000-product test is not needed there.

## Decision

1. `suite_args_of` in `tools/brain/inbox.sh` names, for `--integrity`, only the suites of the
   modules the head touches (by file-name prefix, `integrity_prefixes_of`), the integrity suites the
   head itself changes, and the platform's guards (`append-only-guard`, `app-role`,
   `audit-log-guard`, `deadlock-retry`, `idempotency`, `numbering`). The patterns are anchored at
   `integrity/` so the copy's own folder name never selects everything.
2. `segments` and `imports-scale` (the 20,000-product timings) never run in the gate.
3. `tools/brain/int.sh --integrity <pattern>…` runs only the matching integrity suites; without a
   pattern it runs them all as before.
4. CI's full `pnpm check` still runs every integration and integrity suite after landing.
5. The suites keep running on their own test databases, never on the real system's: they create
   and delete products, documents and money, which would change the real books.

## Consequences

A typical stock or payroll head runs about a dozen integrity suites instead of fifty. A fault only
another module's integrity suite would catch is found by CI after landing; past a migration it is
fixed forward (ADR-0206).
