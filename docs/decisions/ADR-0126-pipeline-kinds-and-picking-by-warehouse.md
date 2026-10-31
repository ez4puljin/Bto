# ADR-0126: Sales and transfer pipelines, picking by warehouse with a lead, keepers see their own lines, the admin changes an order until the sale

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner (the request of 2026-10-31 and one question round: «Захиалгын борлуулалт» only reserves; a person moves the card and a missing warehouse refuses the move; keepers take their own part, the lead sees and hands over; then «B хийхгүй»: the store's seller sends their orders from the rep app into the transfer pipeline's first stage), Claude (the direct-mode session) |
| Amends | ADR-0056 #3 and #5 (picking is per warehouse; the sale needs every warehouse), ADR-0057 #1 (a pipeline has a kind), ADR-0125 #1 (a TRANSFER stage lives in a TRANSFER pipeline), ADR-0027 #7 (reads are filtered for one thing: a keeper sees only their warehouses' order lines), ADR-0055 / ADR-0056 #4 (an admin changes the lines of a picking or packed order) |

## Context

The owner's orders ship from several Mörön warehouses at once. Each warehouse's keeper prepares their own goods, and the main sale (or the transfer to a store) may happen only when every warehouse is done. Until now an order was picked once, by one person writing every warehouse, and nobody could see who was preparing which part. The owner also wants two kinds of pipelines (sales and transfers), keepers who see only their own goods, and an admin who can still change an order after it was picked.

## Decision

### 1. Pipeline kinds

- `sales_pipelines.kind`: SALES or TRANSFER (migration `0061_sales_picks`; the pipelines that named a store under ADR-0125 became TRANSFER). A CHECK ties the kind to the store: a TRANSFER pipeline names its store, a SALES pipeline names none.
- The stage actions follow the kind (`KIND_STAGE_ACTIONS`):
  - a SALES pipeline offers NONE, CONFIRM, PICK, SALE and CANCEL;
  - a TRANSFER pipeline offers NONE, CONFIRM, PICK, TRANSFER and CANCEL.
  - Any other action is refused with `PIPELINE_KIND_STAGE`.
- The customer app lands only in SALES pipelines:
  - the channel settings refuse a TRANSFER pipeline for it;
  - a pipeline it lands in cannot become TRANSFER (`PIPELINE_KIND_CHANNEL`).
- **The store's seller orders from the rep app** (owner, 2026-10-31): a seller holding `sales.orders.rep` places their orders on a transfer pipeline's first stage, as any rep places on a stage whose MOVE right their role holds (ADR-0061 #6). The store is the order's customer. Nothing new is built for it: the app's «Шилжүүлэг» request (ADR-0116) stays for the keepers' own transfers.
- On screen the actions read:
  - «Захиалгын борлуулалт (нөөцлөх)», which is CONFIRM: only a reservation, as the owner answered;
  - «Бэлтгэх»;
  - «Үндсэн борлуулалт (нэхэмжлэх, авлага)»;
  - «Дэлгүүрт шилжүүлэх»;
  - «Цуцлах».

### 2. Picking by warehouse

- `sales_order_picks` holds one row per order and warehouse its lines ship from. Each row has:
  - a status: OPEN, PICKING or DONE;
  - the picker;
  - the started and done times.
- The rows are made when the order is confirmed and kept in step when it is changed. The migration filled them for the open orders.
- **Taking a part.** A keeper takes their warehouse's part, which needs the pick right and the warehouse in their write scope. The order becomes PICKING.
- **Confirming a part.** The keeper confirms the part's counts: its lines move into that warehouse's STAGING and their reservations are consumed. When the last part is done the order is PACKED.
- The old whole-order pick stays for a keeper who writes every warehouse; it picks part by part.
- **The lead** holds the new right `sales.orders.pickLead`; an admin always holds it. The lead:
  - sees every warehouse's part with its picker;
  - hands a part to another picker, who must hold the pick right in that warehouse (`PICKER_INVALID` otherwise);
  - opens a done part again: its goods go back from STAGING onto the shelves they left, and its lines are reserved again.
- On `bto_main` a custom role «Агуулахын ахлах» carries the lead's right.
- **The gate.** Moving a card into a SALE or TRANSFER stage while a part is not done is refused with `PICK_INCOMPLETE` (409). Its `params.warehouses` names the missing warehouses.
- **Ledger keys.** The stock ledger keys a movement per document line, movement and leg (`stock_ledger_idem`). So:
  - the way back from STAGING posts BIN_MOVE_OUT and BIN_MOVE_IN;
  - a reopened warehouse's lines are written again under new ids before they are picked again.
- **On the board.** The card of a confirmed, picking or packed order shows each warehouse's part the caller sees as a small label in the part's colour (waiting grey, being picked blue, picked green) with the picker's name. The board's filter «Агуулах» keeps the orders with a line in one warehouse, so a keeper narrows the board to their own goods. The order opens on its «Бэлтгэх» tab, one card per warehouse. (The first build added a separate «Бэлтгэл» page; the owner had not asked for a menu and refused it the same day, so it was removed.)

### 3. Keepers see their own lines

A user who writes only some warehouses and does not hold `sales.orders.manage` sees, in an order:
- only the lines of those warehouses;
- only those warehouses' picking parts.

The order panel, the pick form and the printouts use the same detail. The office and the admin see everything. This is the one exception to "reads are never filtered" (ADR-0027 #7).

### 4. The admin changes an order until the sale

- A holder of `sales.boards.manage` (the admin) may change the lines of a CONFIRMED, PICKING or PACKED order, without the stage's EDIT right.
- A warehouse whose lines change is opened again: its picked goods go back to their shelves and its part is OPEN. The other warehouses keep their picked counts.
- The order is priced again today. The reservations are replaced for every line not in STAGING.
- Others keep the old rule: draft or confirmed only, with the stage's EDIT right.
- After the main sale a correction stays a return or a credit note.

### 5. Prices on the order

The products tab shows each line's list price, its discount and its amount. The footer and the overview show the amount at list prices, the discount and the total. The data was already on the lines (ADR-0048 #4).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A picker per order instead of per warehouse | The owner's warehouses prepare their own goods in parallel; one picker cannot write every warehouse. |
| The lead assigns every part | The owner chose self-service: keepers take their own part, the lead only hands over or reopens. |
| Moving the card automatically when the last warehouse finishes | The owner chose a person's move, refused while a warehouse is missing. |
| Posting the way back with PICK_IN / PICK_OUT reversed | The ledger keys a line's movement and leg once; a second pick of the same line would collide. A shelf move back and new line ids keep every posting unique. |
| Hiding other warehouses' lines on the screen only | The API would still give them away; the filter belongs to the detail every screen reads. |

## Consequences

- No part B: the seller uses the rep app (above). A picking screen in the staff app is not planned.
- The integration suite `sales-picking` covers:
  - the two parts;
  - a keeper's own part and lines;
  - the refused sale naming the warehouse;
  - the lead's hand-over and reopen, with the stock back and reserved again;
  - the admin's edit of a packed order, opening only the changed warehouse;
  - the sale;
  - the reconcile.
- `sales-boards` expects `PICK_INCOMPLETE` where it expected `ORDER_STATE_INVALID`.
- `docs/modules/sales.md` describes the kinds, the parts and the lead.
