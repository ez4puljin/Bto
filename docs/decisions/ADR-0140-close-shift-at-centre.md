# ADR-0140: an admin closes from the centre a shift its POS server can no longer close

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («A хувилбараар хий», 2026-11-04, after К1's shift of 2026-10-26 stayed open when the old edge was removed and blocked the new edge's shift and sale), Claude (the direct-mode session) |
| Amends | ADR-0064 #2 (a shift closes only by its edge's SHIFT_CLOSED) |

## Context

A shift closes when its edge replays SHIFT_CLOSED with the counted cash. When an edge is replaced or lost with a shift open, nothing can close it, and the till's next shift is refused (`POS_TILL_BUSY`), then its sales (`POS_SHIFT_STATE_INVALID`).

## Decision

1. **«Төвөөс хаах».** `POST /pos/shifts/:id/close` (`pos.manage`, idempotent) closes an OPEN shift through the same close as the edge's: the counted cash is the cash expected (opening float + cash sales − cash refunds, no variance), nothing is kept in the drawer, the note says it was closed at the centre (or the admin's), and the journal entry books as ADR-0064 #2 describes. The audit records `CLOSE` and `CLOSE_AT_CENTRE`. The shift's panel offers it to a manager with the expected cash in the confirmation.
2. **What it blocked goes in by replay.** «Ээлж» lists the documents the centre refused and nobody replayed («Төв хүлээж аваагүй баримт», oldest first) with «Дахин оруулах» (`POST /pos/sync-rejections/:id/replay`, existing).
3. Used only for a shift whose edge cannot close it: a live edge closes its own shift from the POS («Ээлж хаах»); its later documents on a shift closed here are refused and wait in the same list.

## Consequences

- Cash missing from a shift closed here is not seen as a variance: it shows when the accountant receives less at the hand-over.
- The edge that owned such a shift keeps its own copy of the documents the centre refused; they count as replayed at the centre only.
