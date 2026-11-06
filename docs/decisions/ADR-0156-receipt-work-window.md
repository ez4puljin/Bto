# ADR-0156: The receipt's work window: one strip, one card, the entry under its columns

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («/inventory/receipts/new layout дээр анхаарч харагдах байдлыг илүү мэргэжлийн харагдуул», «Бүүр өөрөөр илүү дээр design байвал шууд өөрчилж болно», «Систем дүрэмд баригдахгүй байж болно», 2026-11-06), a design judge (subagent), Claude |
| Amends | ADR-0155 #1 and #3 and ADR-0153's layout, for the receipt only; `DocumentWorkspace` stays for the issue |

## Context

The window of ADR-0153 and ADR-0155 was three cards: the document on the left, the line editor on the right, the lines below. On a 1366×633 laptop even a tightened form started its first line at y=437 and showed 3 rows. Each card had its own grid: product, unit, quantity, price and amount were typed in one geometry and landed in another. The fields moved under the hand on every line (the scope switch and the facts came and went), and the page's scrollbar appeared at the first save. A judge asked to look only at the layout and the React in use recommended replacing the layout over tightening it; the owner allowed a different design and lifted the house design rules for this window.

## Decision

No rule, right, API or posting changes.

1. **`DocumentWindow`** (`components/document-layout.tsx`): from `lg` the title, the strip and the card fill the window and only the lines scroll, so the page has no scrollbar to appear. Below `lg` it flows. The shell narrows its padding for it, by `data-slot`.
2. **The strip**: the document's fields in one row, the supplier first, where the cursor starts. No card title; the region keeps its name for screen readers. Its height does not change with the first save: the confirmations moved to the title row's meta.
3. **The entry row stands inside the lines table's head**, each field under its column and its text on the column's vertical. The head stays in view while the lines scroll. What the product says (location, a single unit, weight) is plain text, not a disabled box. The weight column shows the line's total, like the rows below it; the product's own weight is among the facts.
4. **A row under it is never empty and keeps its height**, so nothing below moves: the keys while idle, what was added, the product's facts once chosen (on one line; the last receipt gives way, whole on hover), what was refused. The search's switch stands at the head of the list it changes, which always opens with a supplier chosen; F4 flips it.
5. **The steps close the card's foot**, as one row with the count and the delivery note's totals: «Хөнгөлөлт» opens a sheet (the discounts and free goods, whose form stays a form), «Хэвлэх» is one menu, the count opens the totals in a popover.
6. **The draft's table drops «Бонус»** (free goods are listed apart) and gets columns that fit 1366 with the ordered quantity shown; its rows keep one height, the whole name on hover.
7. **Feedback**: a line added scrolls into view and flashes once; the header says «Хадгалж байна» / «Хадгалсан»; a line being removed dims; a hover hint names the note's icon buttons (`components/ui/tooltip.tsx`, `Hint`).
8. **The search is a combobox**: the list keeps the last answer, dimmed, until the next comes, instead of closing on every letter; a skeleton shows the first wait; the arrows keep the active row in sight (`SearchSelect` too). Enter still takes only the row of the text now typed.
9. **Keys**: F2 returns to the product, Ctrl+Enter takes the step, Esc ends an edit and the cursor returns to the search; the supplier chosen on an empty receipt moves the cursor to the search. Hints show them (`components/ui/kbd.tsx`). A scanner's burst never forms these keys.

The window's radius is smaller (`--radius: 0.625rem`), and the entry row's «Хадгалах» takes the field's corners; the steps at the foot stay capsules.

## Consequences

- Measured at 1366×633 on a draft with lines: the first line at y=297 instead of 437, the same when idle, with a product chosen and while editing; about 7 rows fit instead of 3; no page scroll. At 1920×969: the first line at y=332 and about 13 rows.
- A posted receipt is still the read-first page of cards, with the dense title.
- The issue window keeps `DocumentWorkspace` until the owner decides, so ADR-0155's «both windows match» does not hold meanwhile. The judge found the same frame fits it; that is a separate change.
- Discounts and the totals are one click away instead of always on the page. A discount above its lines marks the foot's button red.

## Related

ADR-0153, ADR-0155, ADR-0119, ADR-0113, `docs/ui.md` §4.
