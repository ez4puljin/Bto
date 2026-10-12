# ADR-0038: Blind stocktakes, counted shelf by shelf

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | — (adds to SPEC §6.8 and ADR-0034; the stocktake service of week 4) |

## Context

The stocktake service (SPEC §6.8) existed since 2026-10-11 without REST or screens (cut line §8.2 #3). Asked on 2026-10-13 how much the counters should see, the owner chose a **blind count**: the warehouse workers see only what they count themselves — not the system quantities, not the differences, and (second question) not even the list of products expected on a shelf; only the approver (`inventory.stocktakes.approve`, the admin) sees those. Asked whether the stock pages, which show every user the quantities of every shelf, must hide the shelves being counted, the owner kept them as they are. SPEC §5.4 asks for counts entered from a phone browser.

A fully blind count changes the service's model: it cannot ask the counter to confirm each expected line (they never see them), so something must say when a shelf is done, and the lines nobody counted must become 0 without ever being shown.

## Decision

1. **Blind by the server.** Counters (no `inventory.stocktakes.approve`) receive only the lines a person counted (`stocktake_lines.counted_at IS NOT NULL`). Frozen quantities, differences, line and difference totals are left out of every response (one mapper, `StocktakeView`), not sent as null; values go only to approvers who also hold `inventory.costs.manage`. A counter asking for the differences gets their own lines. Blindness is enforced in the stocktake API and screens only: the stock pages and the movement history stay readable by every user (owner, 2026-10-13); the control is the approver's review.
2. **Counting by scan.** A scan names the active shelf and a product unit: it adds `qty` × factor in one statement (`COALESCE(counted_qty, 0) + qty`), so counters scanning the same goods never lose an increment; a box barcode adds its factor. Each scan carries an `Idempotency-Key`, so a request retried after a lost answer counts once. A negative quantity takes a mistaken scan back (an `UPDATE`, because PostgreSQL checks an upsert's proposed row against `CHECK` before its conflict); a count below zero is refused (422). A typed count replaces the line's count and carries the count it replaces (`previousQty`): a different stored count answers `CONFLICT`.
3. **Shelves are finished.** «Тавиур дууссан» sets every uncounted line of the shelf to 0 with `counted_at` left NULL («not found», shown to approvers only) and marks the shelf (`stocktake_bins.finished_at/by`); an empty shelf is finished too, so «nobody reached it» differs from «nothing there». Scans may still add to a finished shelf. Review (`COUNTING → REVIEW`) needs every shelf finished (`STOCKTAKE_BINS_UNFINISHED`, 409, with the number left).
4. **Recount.** In review the approver may send chosen shelves back (`REVIEW → COUNTING`): their found lines are deleted, their frozen lines uncounted, their finish cleared, and the old counts kept in the audit row (`RETURN`). The shelves stay locked and frozen throughout, from start to approval or cancellation.
5. **Who ends it.** Counters create, start, count, finish shelves and send for review; approvers recount and approve (surplus costs for cost holders, ADR-0033 #8). A stocktake in review is cancelled only by an approver: its differences are known by then.
6. **Choosing shelves.** A draft names its shelves once: given ids (any non-archived bin of the warehouse, system areas by name), a code prefix (`normalizeBinCode` + `LIKE prefix%`, storage and picking shelves) or «every shelf» (storage, picking and the sales floor; never receiving, staging, shipping, damaged or returns, whose locking would stop other documents). A preview (`GET /stocktakes/bin-preview`) shows how many shelves a choice takes and how many another count holds.
7. **Size.** At most `MAX_STOCKTAKE_BINS` = 2,000 shelves and `MAX_STOCKTAKE_LINES` = 10,000 lines (`@tugeel/shared/inventory`), well under one posting's `MAX_MOVEMENTS_PER_POST`; starting freezes the lines with one `INSERT … SELECT`. Scans and counts answer with the line and its shelf only, never the whole stocktake.
8. **Lots wait.** Counts are per bin and product with `lot_id` NULL; when ADR-0019 is activated, scans and counts must capture the lot.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Counters see the expected products without quantities (the usual «blind count» of WMS packages) | The owner chose to show nothing (2026-10-13). |
| Hide the counted shelves' stock from non-approvers on the stock pages | The owner kept the stock pages as they are; it would hide stock from sales too and supersede ADR-0027's read rules. |
| «Finish the stocktake» sets every uncounted line to 0 | Shelves nobody reached would turn into shortages in review. |
| Treat NULL counts as 0 at review without marking lines | A counter's own lines could not be told from «not found», which counters must never see. |
| Scans as client-side sums sent as typed counts | Two counters on one shelf would overwrite each other; a retried request would count twice. |

## Consequences

**Positive.** Counting works from a phone with a scanner or the camera, one shelf at a time; nothing on the counter's screen tells them what to find; concurrent scans and retries are safe; the approver sees the differences with their value and can send single shelves back.

**Negative.** A counter who opens the stock pages still sees the shelf quantities (accepted by the owner). A forgotten product on a finished shelf becomes a shortage until the approver sends the shelf back. Every scan is a request and an idempotency row.

**Follow-ups.** Activating ADR-0019 adds lots to scans and counts. A stocktake of the go-live (SPEC §9.4) may need more than 10,000 lines: split it by shelf ranges or raise the limit with the posting cap in mind.

## Related

SPEC §5.4, §6.8, §8.2 #3; ADR-0004, ADR-0019, ADR-0027, ADR-0033, ADR-0034; `docs/modules/inventory.md`.
