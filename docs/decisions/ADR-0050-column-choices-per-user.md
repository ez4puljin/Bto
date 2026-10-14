# ADR-0050: A list's column choices are kept per user in each browser

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-14 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0037 #3 (column choices were kept per browser, shared by every user of that browser) |
| Amended by | ADR-0052 (#6: the product list's ticks are screen state too, kept in `sessionStorage` per user and tab) |

## Context

ADR-0037 #3 kept the hidden columns of a list in `localStorage` under one key per list, for example `tugeel.catalog.products.hiddenColumns.v1`. Every user signed in on the same Chrome therefore shared one choice.

On 2026-10-14 the owner asked that each user set the columns on their own Chrome and find the same choice later. Asked to choose, the owner picked "per user and per Chrome" over "per user on the server" and over keeping the current behaviour.

## Decision

1. **Key.** A list keeps a user's hidden columns under `tugeel.<list>.hiddenColumns.v1:<userId>`, following the per-user keys of ADR-0047 #3, for example `tugeel.catalog.products.hiddenColumns.v1:7`.
2. **The old shared key.** When a user has no key yet, the list reads the old shared key once and uses it as that user's starting choice. The old key is never written again.
3. **Showing every column** writes an empty list rather than removing the key. Otherwise the old shared choice would come back.
4. **Scope.** The rule covers the product, customer and supplier lists. `useHiddenColumns(list, keys, locked)` reads the signed-in user's id itself. A sign-out and a sign-in as someone else re-read the choice.
5. **Unchanged.**
   - Storage that refuses writes keeps the choice for the page's life.
   - Unknown and locked keys are ignored.
   - Business data never goes into `localStorage`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A per-user setting on the server | The owner chose per Chrome. It would also need a preferences table, routes and a migration for a display choice. |
| Keep one choice per browser | Users sharing a shop computer overwrite each other's columns, which is what the owner asked to change. |
| Drop the old shared key | Users would lose the columns they already chose. |

## Consequences

**Positive.**
- Each user's columns stay as they left them on that computer.
- No server work is needed.

**Negative.**
- A user moving to another computer sets the columns again there.
- Old shared keys stay in browsers until site data is cleared. They are small.

## Related

ADR-0037, ADR-0047, `docs/ui.md`.
