# ADR-0119: The web layout on large screens: pages use the whole width, lists size their columns

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-29 |
| Deciders | Owner («дэлгэц ашиглалт маш буруу» on a 1920px PC, 2026-10-29; forms stay at the left, about 1400px wide), Claude (worker session) |
| Supersedes | ADR-0066 #2 (the page-width rule); the rest of ADR-0066 stays |
| Amends | ADR-0114 #6 (the home page's centred column), `docs/ui.md` §3, §4, §6 |

## Context

On an ordinary PC in Chrome at 1920 wide the content sat at the left and the right side was empty. The pictures of every route (`pnpm ui:shots`, 2026-10-29) showed why: a `wide` page stopped at 1600px (288px empty), a `reading` page at 1152px, the home page was a centred 976px column, and inside the lists the text columns were sized by their content — on «Бараа» the name took every spare pixel while «Ангилал» was capped at 160px and cut 48 of 50 rows; on «Журнал» «Тайлбар» took about 1,000px for a 30-character text. ADR-0066 #2 had chosen the 1600px cap and left-aligned pages because the office's screens were unknown.

## Decision

1. **Pages use the whole width.** `wide` and `full` pages have no cap (`PAGE_WIDTHS.wide = 'max-w-none'`); the shell's padding stays (`px-4 md:px-8`). `reading` pages (settings, `/new` forms, small tools, single-card records) stop at **1400px, at the left**: a two-column `FormRow` or a settings card past that width reads badly, and the left edge staying put keeps the title from jumping between a list and its record. Only the sign-in pages, outside the shell, are centred.
2. **The home page** runs the whole width: the greeting, «Анхаарах» | «Мэдэгдэл» side by side, then the module tiles — two, three, four or six to a row (`2xl:grid-cols-6`, the six business modules on one row at 1920px).
3. **Column sizing rules for lists.** Every list table is a `ListTable` (`components/list.tsx`) with a column spec (`lib/column-layout.ts`). Fixed kinds get a width in rem (`code` 7, `number` 10.5, `date` 7.25, `datetime` 10.75, `money` 8.5, `qty` 6, `count` 4.5, `percent` 6, `status` 8.5, `check` 2.5, `image` 3, `icon` 3, `chevron` 2.25, `actions` 1.5 + 1.75 per button; a column whose values are longer says its own `width`); text columns get their `min` (7rem; a name 12–14) and share what is left by `weight` (a name 3, a description, a category or a partner 2, short text 1, a unit or a kind 0.5); a `spacer` is a text column that may vanish. The table measures its box (a `ResizeObserver`; widths are written in rem into a `<colgroup>`, since Chrome ignores a `calc()` of percentages on a `<col>`) and runs `table-layout: fixed` when the box is at least as wide as the spec's minimum (every fixed column plus every text column at its `min`): a cell wider than its column is cut with «…» (`TruncateCell` inside a sized table has no cap of its own and `fill` does nothing), so at 1920px nothing that fits truncates and a short text no longer stretches its column. In a narrower box (a laptop showing a wide register) the table keeps the browser's own layout and scrolls sideways in its card, as before this rule — nothing gets worse at 1366. Per-cell `max-w-*`, `min-w-*` and `w-full max-w-0` hacks are gone from these tables.
   - **Default columns** (ADR-0050, ADR-0066): `useHiddenColumns(list, keys, locked, defaultHidden, wideDefaultHidden?)` — below 1600px a user who never chose sees the set that fits a 1366px laptop; from 1600px (`lib/use-media-query.ts`, `WIDE_SCREEN`) the list's wide set: products keep the multi-line columns hidden (units, barcodes, fixed bins, the price profile), customers keep the registration and tax flags, GPS, note and the app, suppliers keep the registration number, bank account and note; movements and the sales list show everything. A stored choice always wins; «Баганууд» is unchanged.
4. **Document windows.** A document's header cards sit in a `DocumentHeader({ main, side })` (`components/document-layout.tsx`): from 1600px «Падааны мэдээлэл» left and «Падааны нийт» right; the «Бараа нэмэх» row and the lines table (a `ListTable` under the rules of #3) take the whole width. The issue and transfer pages have one header card and keep it across the width. The purchase order's page is being rebuilt (ADR-0118) and takes the same pieces.
   **Record pages** (product, customer, supplier): the side column is 26rem and the main column takes the rest; a `FieldList` in a box of 80rem or more (the main column on a screen of about 1800px and up) runs two label/value pairs per row (`columns={1}` keeps one).
5. **Dialogs, sheets and the record panel** keep ADR-0066 #4 (sizes sm … xl, `min(80rem, 94vw)`).

## Before and after

`pnpm ui:shots` of every route at 1366×633 and 1920×969 from this branch's own dev server (the test data of `bto_main` copied), before and after:

| Page | Empty right margin at 1920 (px) | Rows in view at 1366 | Truncated cells at 1920 |
|---|---|---|---|
| «Бараа» | 288 → 32 | 9 of 50 → 9 of 50 | 48 → 73 |
| «Харилцагчид» | 288 → 32 | 9 of 50 → 9 of 50 | 1 → 4 |
| «Журнал» | 288 → 32 | 2 of 2 → 2 of 2 | 0 → 0 |
| Receipt №4 | 288 → 47 | 0 of 3 → 0 of 3 | 0 → 2 |
| «Нүүр» | 32 → 32 | — | — |

Over all 204 pictures (110 routes at two sizes): no page lost rows or gained a sideways scroll at 1366 (0 worse by rows or page overflow, 0 by a new sideways scroll inside a card); every `wide` and `full` page now ends 32px from the window's edge at 1920 (the shell's padding), a `reading` page at 488px (1400px wide). The truncation column counts cells cut with «…» on the first 50 rows; a sized table counts a cell and its text once each, and the product list cuts the parents of a category path on purpose (ADR-0050).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Centre every page (symmetric margins) | The owner's complaint was the empty space, not its place; a centred list still leaves two margins, and the title would jump between a list and its record. Only the sign-in pages are centred. |
| Keep `reading` at 1152px, or make it fluid too | 1152px leaves 700px empty on a form at 1920; a fluid form stretches a `FormRow` across 1,800px. 1400px at the left is where a two-column form still reads as one. |
| Keep auto table layout and add `max-w` per column | That is what produced the cut category and the 1,000px note: auto layout gives width by content, not by meaning. A fixed layout with a spec is deterministic and testable. |
| `calc()` or percentage widths on the `<col>`s, no script | Chrome treats a `calc()` of percentages on a `<col>` as auto (every text column then gets an equal share, which the first pictures showed); plain percentages cannot follow hidden columns. The box is measured instead and the widths written in rem. |
| A fixed layout at every width, with a `min-width` | A register with many columns is then wider than a 1366px laptop by its fixed widths alone, where the browser's own layout fitted it before; below the minimum the old layout stays. |
| Show every column from 1600px | Twenty customer columns overflow even at 1920; the wide set is a second, larger default, and the user's choice still wins. |

## Consequences

**Positive.** Every list and document uses the whole screen; column widths mean something (a date is a date wide, a name gets the room); the laptop layout is unchanged (the same minimum widths, the card scrolls sideways below them); the home page's six modules sit on one row.

**Negative.** A table's spec must match its cells one to one (a wrong count misplaces every column; the tests guard it); a value longer than its fixed column is cut with «…» rather than widening the column (the page then says a `width`); a sized table re-measures its box on every resize (one state update per table).

**Verification.** Vitest: `app/page-widths.test.ts` (no cap on `wide`), `lib/column-layout.test.ts`, `components/list.test.tsx`, `lib/use-hidden-columns.test.ts`; the existing page tests (the 1366px default sets, the column chooser). The pictures above; `pnpm check:quick` before the pull request, CI's full `pnpm check` on it (ADR-0120).

## Related

ADR-0042, ADR-0050, ADR-0066, ADR-0113, ADR-0114, ADR-0118, ADR-0120, `docs/ui.md`
