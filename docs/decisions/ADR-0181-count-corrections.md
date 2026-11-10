# ADR-0181: A counted quantity typed in the count window («Засагдсан»)

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-11 |
| Deciders | Owner (2026-11-11: «Хагас баригдсан хэсгүүдийг надаас асуулт асуухгүйгээр өөрөө мэдэж хий»; the old count sheet's «Засагдсан» mark, left out of ADR-0177) |
| Amends | ADR-0176 #4 (a line's counted quantity came only from the counters' entries), ADR-0177 (its last consequence) |

## Context

ADR-0177 rebuilt the count window as the old system's sheet but left one thing out: the office could not change a counted number. A miscount found at the desk needed a counter to pick up a phone, start a session and send a second entry, and a number that was too high could not be lowered at all, because entries only add up.

## Decision

1. **The counted quantity is typed in the sheet.** With `inventory.stocktakes.approve` and the warehouse's write scope the «Тоолсон» cell is a box; leaving it with another number sends `PUT /stock-counts/:id/lines/:lineId/counted { qty }` (base units, zero allowed, COUNTING or REVIEW only; 409 `DOC_ALREADY_POSTED` afterwards).
2. **Nothing is deleted.** The product's entries of sent sessions are struck out (`voided_at`), and one correcting entry in base units (`stock_count_entries.correction = true`, migration `0097_count_corrections`) is written in a session of the corrector's own that is sent at once. The line's counted quantity is that entry. The product's entry list shows the struck entries and the correction with its author; the change is audited with the quantity before and after.
3. **A product nobody counted** gets its expected quantity at the correction, as at a first entry (ADR-0176 #3).
4. **What a counter sends afterwards is added** to the corrected quantity: the correction says what the count is at that moment, and a count in review takes no entries anyway.
5. **The sheet marks the line** «Засагдсан» while a correcting entry is in force.

## Consequences

- The approval, the tiles and the print read the same `counted_qty` as before; only its source differs.
- A correction cannot make a counted product uncounted again; zero is a count.

## Related

ADR-0176, ADR-0177, docs/modules/inventory.md.
