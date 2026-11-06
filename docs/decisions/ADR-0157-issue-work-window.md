# ADR-0157: The issue's work window, the same frame as the receipt

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («Зарлага» цонхонд ижил загвар хийх үү? → «Тийм, хий», 2026-11-06), Claude |
| Amends | ADR-0155 #1 and #3 for the issue. With ADR-0156 for the receipt, «both windows match» holds again |

## Context

ADR-0156 moved the receipt to one strip and one work card and left the issue on `DocumentWorkspace` (the document on the left, the entry on the right, the lines below), so the two windows no longer matched. The owner asked for the same design on the issue.

## Decision

No rule, right, API or posting changes.

1. **The same frame**: `DocumentWindow`, the dense title, one strip of the document's fields, one card whose head holds the entry, whose body holds the lines and whose foot holds the count, the totals and the steps. `DocumentWorkspace` is gone. A posted, cancelled or read-only issue stays the read-first page of cards with the dense title, like the receipt.
2. **The strip's order**: the date, the warehouse, the expense type, the recipient, the note. The cursor does not start in it; a scan works from anywhere.
3. **The recipient's kind is a select joined to the name**: the four-part switch does not fit one strip cell. A kind with a choice kept from before is that choice again, as before.
4. **Two boxes stay in the entry**: the barcode box and the product search stand side by side under the columns, and «Тоо» under its column. They are not merged like the receipt's single search: a barcode typed by hand must add its own unit (a box), while the search adds the base unit, and the receipt's flow chooses the unit in a field the issue does not have. `ScanBox compact` drops «Шалгах» (Enter checks) and makes the camera an icon; it also drops the https note, since without https there is no camera button either.
5. **What moved so the strip keeps its height**: the warehouse's hint is a hover hint; the type's account stands beside the title; the confirmations stand in the title's meta.
6. **A row under the entry is never empty**: F2's hint at its end, and on its left what was added, what was refused and what «Тоо» will do.
7. **Lines stay editable in the row** (the warehouse select and the quantity box), lower than the entry's fields so the rows keep one height. The code has its own column, the whole name on hover. A line added scrolls into view and flashes once; a line being removed dims.
8. **Keys**: F2 returns to the product search; Ctrl+Enter sends, or on a new issue saves. A scanner's burst never forms these keys.
9. **Shared parts** moved so both windows use one copy: `LINES_SCROLLER`, `ENTRY_ROW`, `ENTRY_CELL`, `ENTRY_SLOT`, `ENTRY_SLOT_CELL` and `WINDOW_FOOT` in `components/document-layout.tsx`, `SaveState` in `inventory/shared.tsx`, `modalOpen` in `inventory/helpers.ts`. The line number's column grows to 3.5rem in both, because a two-digit number was cut.

## Consequences

- Measured at 1366×633 with 12 lines: the first line at y=297, 7 rows in view, no page scroll. At 1920×969: y=332, 12 rows in view. The development database holds no issue, so these came from a made-up draft served only to the page; nothing was saved.
- The strip's card lets its content overflow, so the recipient's matches float over the lines.
- Not exercised by hand when this was written: a real scanner, the camera, and a real send.

## Related

ADR-0156, ADR-0155, ADR-0117, ADR-0081, `docs/ui.md` §4.
