# ADR-0046: A sent transfer request can be taken back for editing and keeps its number

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-14 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0035 #1 (a REQUESTED transfer may go back to DRAFT) and #3 (it keeps its number when sent again); `docs/SPEC.md` §6.13 #2 (one kind of draft carries a number); `docs/architecture.md` §5 (transfer lifecycle, numbering) |

## Context

The second UI session asked the owner on 2026-10-14 which transfer steps feel long. One answer: a request that was already sent cannot be changed. The clerk withdraws it and asks again, which re-enters every line, uses up a number and leaves a cancelled request in the sender's list.

ADR-0035 has `DRAFT → REQUESTED` one way only, and the CHECK `transfers_number` (migration 0007) forbids a draft with a number (SPEC §6.13 #2: numbers are allocated at SUBMIT/POST; drafts carry only their id).

## Decision

1. **Taking a request back.**
   - `POST /api/v1/transfers/:id/reopen` (200, `inventory.transfers.manage`) moves a REQUESTED transfer back to DRAFT.
   - Only the side that owns the draft may do it: the destination of a REQUEST (`ScopeService.assertCanWriteWarehouse` on the owner side, as for every draft edit).
   - `TransfersService.reopen` locks the header `FOR UPDATE`, the lock `ship` takes first, so a reopen and a shipment run one after the other and exactly one of them wins.
   - It clears `requested_at` and `requested_by`, keeps `number`, and writes the audit action `RETURN` («Буцаасан», as an adjustment sent back) with the header before and `{ status, number }` after.
   - Pressing it again on the returned draft answers the draft unchanged. Any other state answers `DOC_STATE_INVALID` (409): a draft never sent, a push, a shipped, received or cancelled transfer.
2. **The same number.** `request()` keeps a returned request's number (`number ?? allocate`), so the request is sent again under the number on the paper list and its year stays the year it was first sent. Numbers stay gapless.
3. **The database rule.** The CHECK `transfers_number` becomes: a DRAFT has no number unless it is a REQUEST that was sent before; REQUESTED, SHIPPED and RECEIVED always have one. Migration `0018_transfer_reopen` drops and adds it. A cancelled request keeps its number (ADR-0035 #3).
4. **The sender while it is a draft again.** The source cannot ship it (`DOC_STATE_INVALID`) or decline it (a draft belongs to its owner side, 403). The web tells the sender why, refreshes the transfer when the tab regains focus, and keeps the counts the sender typed on that device (ADR-0047 #6).
5. **On screen** the returned request reads «Ноорог» with an outline «Засварт буцсан» pill; its editor's send button reads «Дахин илгээх». The list shows its number like any request.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Edit the lines while REQUESTED | The sender may be counting the same lines; the shipment would need a version check, and the lines would change under the sender's eyes |
| Withdraw and ask again (today) | Every line is entered again, a number is used up, and cancelled requests pile up in the sender's list |
| Reopen with a new number on the next send | Two numbers for one request, a gap in the sequence, and the paper list no longer matches |
| Let the sender edit the request | The receiver decides what it asks for (ADR-0035 #2); the sender ships less and the receiver sees the difference |

## Consequences

**Positive.** One click takes a request back to its editor; nothing is entered twice; the number on the paper list stays valid.

**Negative.**
- One exception to "drafts have no number" (SPEC §6.13 #2), held by the CHECK.
- A list printed before the reopen carries the same number as the corrected request; the printout shows when the request was sent, so print it again after sending.
- A sender who started counting is refused until the request comes back.

**Follow-ups.** None.

## Related

ADR-0035, ADR-0047, `docs/modules/inventory.md` (transfers), `docs/SPEC.md` §5.4, §6.5, §6.13, `docs/architecture.md` §5.
