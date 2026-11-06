# ADR-0158: Reading pages are one centred column

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner (of `/account`: «дэлгэц 2 тал руу наалдсан эвгүй layout, хоорондын зай, тэгш хэмгүй»; then «Бүх 27 хуудсыг», 2026-11-06), Claude |
| Amends | ADR-0119 #1 for `reading` pages and the change of 2026-10-30 that took away their cap. `wide` and `full` are unchanged |

## Context

ADR-0119 stopped `reading` pages at 1400px at the left. On 2026-10-30 the owner found that this left the right of a 1920 screen empty, so the cap was removed and short cards were laid side by side from `xl`. That solved the empty right and made a new problem: on `/account` at 1920 two cards of 920px hugged both edges of the window while their fields stayed 274px wide, with a 120px hole under the shorter card, and the owner found it awkward and uneven. Both complaints are about margins: content at the left leaves one side empty, and content stretched to both edges has nothing to balance it. Equal margins answer both.

## Decision

1. **`reading` is `mx-auto max-w-[60rem]`**: one centred column on all 27 pages. The rem grows with the window, so the column is 1020px at 1366, 1080px at 1600 and 1140px at 1920. `wide` and `full` keep the whole width.
2. **A title on a reading page starts at the column, not at the window's left.** This gives up «the title never jumps» between a list and a reading page. It still holds between pages of one width, and a list and its record (`wide`) are unchanged.
3. **Pages inside the column set no width of their own**: `max-w-3xl xl:max-w-none` is gone from every reading page, and `/system/status` loses its `max-w-xl xl:max-w-4xl`.
4. **Column counts follow the column, not the window, where a table needs room**:
   - `/pos/settings` stops at two columns.
   - `/hr/setup` gives the sites' table 5 parts of 8, because at half width it scrolled sideways.
   - `/finance/settings` stacks the money accounts over the numbering, because the accounts' seven columns need the whole column. At 1920 the first row stays at y=298 with 14 of 16 rows in view, as before. The numbering's rows run two to a line, through `FieldList columns={2}` (from 44rem, measured by the caller's `@container` box).
5. **`/account`** is two stacks instead of a grid of cards (the profile and «Бүх төхөөрөмжөөс гарах», then the password), so one card's height opens no hole beside the other, and its password fields fill their rows.
6. **The picture tool** lists the 11 reading pages it lacked, so `pnpm ui:shots` sees all of them.

## Consequences

- Checked with pictures of all 27 pages at 1366×633 and 1920×969: no page scrolls sideways, and no table is cut. A page with a scrollbar sits about 7px left of one without, since the scrollbar takes its width.
- The right of a 1920 window holds a margin again, now matched by the left. This is a deliberate reversal of the 2026-10-30 result, not a return to a column at the left.
- A later page with a wide table should use `wide`. `docs/ui.md` §4 says so.

## Alternatives

| Alternative | Why not |
|---|---|
| Keep the whole width and let each page fill it (fields and rows wider) | A short form stretched across 1,800px reads badly, and many pages have too little content to fill it |
| Only `/account` | The same rule gives the same result on the other pages; the owner chose all 27 |
| Move `/finance/settings` and `/hr/setup` to `wide` | The owner asked for all 27 in one rule, and both fit once their columns follow the column |

## Related

ADR-0066, ADR-0119, `docs/ui.md` §4, `apps/web/src/app/page-width.ts`.
