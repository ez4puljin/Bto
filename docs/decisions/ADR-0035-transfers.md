# ADR-0035: Transfers are requested by the receiver; differences go back to the sender

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Revised | 2026-10-11, same session, before the code: #4 takes TRANSIT out at the cost each line entered it instead of TRANSIT's pooled average, which made "zero per line in value" untrue for transfers in flight together |
| Amends | ADR-0007 (transfer receive: shortfall booked as an adjustment at the destination), ADR-0034 #3 (transfer legs), `docs/SPEC.md` §6.5 #1–2, `docs/architecture.md` §5.3 |

## Context

Delivery 1 week 4 builds two-step transfers through the TRANSIT warehouse (SPEC §8.1 #5). The owner interview of 2026-10-11 describes them as they happen today:

- goods move from the wholesale warehouses to the supermarket, between wholesale warehouses, and back from the supermarket;
- the receiving side asks for goods and the sending side fulfils the request; the supermarket sends its returns on its own;
- the destination's staff count what arrives (the supermarket's sales clerks at the store), in the unit that was shipped; the supermarket puts the goods straight onto the sales floor;
- when fewer arrive than were shipped, the difference goes back to the sender (the sender miscounted); when more arrive, the extra is taken from the sender's stock;
- a product with a home wholesale warehouse may not be sent to another wholesale warehouse; the supermarket may always receive it;
- one shelf per product per transfer is enough; the list travels with the goods on paper.

ADR-0007 booked a shortfall as an adjustment at the destination, and ADR-0034 gave the receive legs 3 and 4 only. Neither follows the owner's rule.

## Decision

1. **Document.** `transfers` (`TR-`) with `origin` REQUEST (the receiver asked) or PUSH (the sender sends on its own, e.g. supermarket returns) and states `DRAFT → REQUESTED → SHIPPED → RECEIVED` (REQUEST) or `DRAFT → SHIPPED → RECEIVED` (PUSH); `DRAFT`/`REQUESTED` → `CANCELLED`. A shipped transfer is never cancelled: receiving nothing returns everything to the sender. Only WHOLESALE and STORE warehouses take part. Lines: one per product (and lot), with the unit and quantity asked for, and the shipped and received quantities in base units.
2. **Write scope per step** (ADR-0027): the side that created a draft edits it; the destination sends the request, withdraws it and receives; the source ships, declines a request and creates pushes. Permission `inventory.transfers.manage` (ADMIN, WAREHOUSE, POS_CASHIER, assignable); the supermarket's clerks get it with the supermarket as their only write scope.
3. **Numbers.** `TR-` is allocated when the request is sent, or at shipping for a push; a cancelled request keeps its number.
4. **Ledger legs, all in base units** (`UnitConversionService.baseUnits`, factor 1; the request unit is for display and entry only, and a received count in that unit must be exact in base units):
   - ship: `TRANSFER_OUT` from the source bin (leg 1), `TRANSFER_IN` into the TRANSIT bin (leg 2);
   - receive, with s shipped and r received: `TRANSFER_OUT` TRANSIT (leg 3, −s); `TRANSFER_IN` destination (leg 4, +min(r, s)); a shortfall `TRANSFER_IN` back into the source bin (leg 6, +(s − r)); a surplus `TRANSFER_OUT` from the source bin (leg 5, −(r − s)) and `TRANSFER_IN` destination (leg 6, +(r − s)).
   `TRANSFER_OUT` takes legs 1, 3, 5 and `TRANSFER_IN` 2, 4, 6 (the `stock_ledger_leg` CHECK follows). Every inbound leg carries the cost of the outbound leg before it on the same line (`StockPostingService` processes a line's legs in order), and leg 3 takes the line out of TRANSIT at the cost leg 2 put it in (not at TRANSIT's average, which stays the value of what is still in flight), so TRANSIT returns to zero per line in quantity and value even when transfers of one product are in flight together.
5. **Bins.** Source: the line's shelf (scanned; default the product's fixed shelf, the sales floor at the supermarket). Destination: the supermarket's SALESFLOOR; a wholesale warehouse's fixed shelf, else RECEIVING; scanning a shelf changes it. A shortfall returns to the line's source bin (its RECEIVING bin if that shelf was archived; a counted shelf refuses with `BIN_LOCKED_FOR_COUNT`); a surplus leaves the line's source bin, else the source shelf holding the most, else `STOCK_INSUFFICIENT`.
6. **Home rule.** Lines added and shipments into a WHOLESALE warehouse obey `PRODUCT_NOT_IN_WAREHOUSE`; a receive never checks it for lines already shipped, so goods never stay stuck in TRANSIT.
7. **Posting.** `StockPostingService.post` learns the `TR` document (status guard, columns written per next status) and `PostingDoc.allocateNumber`; transfers number themselves. Multi-row statements in `post()` run in chunks of 1,000 in key order, and more than 15,000 movements in one call are refused; a transfer holds at most 3,000 lines, so a receive with a surplus on every line (4 legs each) still fits one posting.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Book differences as adjustments at the destination (ADR-0007) | The owner holds the sender responsible: the difference belongs to the sender's stock. |
| One correction leg at the source for both cases | A surplus would leave the destination valued at TRANSIT's cost for goods that came from the source shelf; value would leak between warehouses. |
| Post in the request unit | Partial boxes cannot satisfy the ledger's quantity check, and a unit superseded between request and shipping would break the posting. |
| Check the home rule at receive | Shipped goods would be stuck in TRANSIT with no way out. |

## Consequences

**Positive.** The supermarket's stock is sellable the moment it is received; a sender's miscount corrects the sender; TRANSIT never accumulates phantom stock.

**Negative.** A surplus can fail at receive when the sender's shelf no longer holds the extra (the receiver must ask the sender to fix its stock first).

## Related

ADR-0007, ADR-0027, ADR-0033, ADR-0034, `docs/modules/inventory.md`, `docs/SPEC.md` §5.4, §6.5.
