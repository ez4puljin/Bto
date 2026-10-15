# ADR-0053: Recently opened pages are kept per user in each browser

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0042 (#3: the search's and the home page's recently opened pages, `tugeel.recent.v1`, were kept per browser) |

## Context

On 2026-10-15 the owner agreed to two custom roles, «Бараа бүртгэгч» (`catalog.products.register`) and «Үнэ оруулагч» (`pricing.prices.manage`). They were tried in the development database with one test user each, signed in on the same browser after the admin.

The new registrar's home page listed under «Сүүлд нээсэн» the pages the admin had just opened: «Сегментүүд», «Бараа», «Орлого», «Бага үлдэгдэл». The list keeps menu paths only, never record names (ADR-0037 #3), and the home page and the search show only the pages the user may open. Even so, one person's history should not greet the next person at a shared office computer.

The column choices had the same flaw, fixed by ADR-0050: they are kept per user in each browser.

## Decision

1. **Per user.** The recently opened menu pages are kept per user in each browser, under `tugeel.recent.v1:<userId>` in `localStorage` (`apps/web/src/lib/recent-pages.ts`). This follows the pattern of ADR-0050.
2. **Fresh start.** A user's list starts empty. The old shared key `tugeel.recent.v1` is no longer read, because its pages belong to whoever used the browser before.
3. **Unchanged.** Everything else of ADR-0042 #3 stands:
   - paths only;
   - at most five, newest first;
   - shown only when the user may open them;
   - a blocked or full storage loses the list, never the page.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep one list per browser | A colleague sees another person's recent pages at a shared computer. |
| Start each user from the old shared list (as ADR-0050 did for columns) | The old list is someone else's history, not a preference worth carrying over. |
| Keep the list on the server | It is a screen convenience, not business data (ADR-0037 #3, architecture §6). |

## Consequences

**Positive.**
- Each person's «Сүүлд нээсэн» and the search's recent pages are their own.

**Negative.**
- Everyone starts with an empty list once.
- The old key stays in the browser, unread.

## Related

ADR-0037, ADR-0042, ADR-0050, `docs/ui.md`, architecture §6.
