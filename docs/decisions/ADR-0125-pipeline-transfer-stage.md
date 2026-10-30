# ADR-0125: A sales pipeline's TRANSFER stage moves the picked goods into the pipeline's store

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner («/sales/boards?pipeline=4 болон ?pipeline=6 Үндсэн болон Заалны архи руу шилжүүлэг хийгддэх байх тохиргоо хий»), Claude (the direct-mode session) |
| Amends | ADR-0056 #1, #3 (the stage actions: TRANSFER joins NONE, CONFIRM, PICK, SALE, CANCEL), ADR-0057 #1 (a pipeline also names the store its TRANSFER stage fills) |
| Relates to | ADR-0035 (transfers), ADR-0116 (transfer requests), ADR-0123 (a till sells from its own STORE warehouse) |

## Context

The owner's erxes boards, copied to Bto on 2026-10-30, hold two «хөдөлгөөн» pipelines on the Khövsgöl board: «{Агуулах ---> Заал} хөдөлгөөн» (pipeline 6, ending in «Хөдөлгөөний баримт Хэвлэх» → «Зааланд орсон») and «{Агуулах --> Архины заал} хөдөлгөөн» (pipeline 4). In erxes these were the way goods reached the supermarket's two sales floors: an order is written for the floor, prepared in the warehouse like any order, and when the card reaches the last stage the goods are on the floor. In Bto the floors are the STORE warehouses «Үндсэн заал» (S1) and «Заалны архи» (S2), each with its own till (ADR-0123), so the floor's stock must actually move there when the card arrives.

Bto already has the transfers module (ADR-0035, ADR-0116): a push from a source to a destination, shipped from a shelf and received by the destination in one step. What was missing was the link from a pipeline's card to such a push.

## Decision

### 1. A pipeline names the store it transfers into

`sales_pipelines.transfer_warehouse_id` (nullable, migration `0060_sales_pipeline_transfer`): an active STORE warehouse, chosen under «Шилжүүлэх дэлгүүр» in the pipeline sheet's «Ерөнхий» tab (`PIPELINE_TRANSFER_WAREHOUSE_INVALID`, 422, otherwise). A pipeline may name a store without a TRANSFER stage; a TRANSFER stage without a store is refused when the pipeline is saved (`PIPELINE_TRANSFER_STAGE_NEEDS_STORE`, 422), and so is clearing the store while such a stage lives. The store is copied with the pipeline.

### 2. The stage action TRANSFER

`STAGE_ACTIONS` gains `TRANSFER` («Дэлгүүрт шилжүүлэх»). A card moved into such a stage must be PACKED (`ORDER_STATE_INVALID` otherwise, as for SALE). In the move's transaction the picked quantities leave each source warehouse's STAGING shelf for the pipeline's store as **one received push transfer per source warehouse** (`TransfersService.pushInTx`: created, shipped from STAGING and received on the store's SALESFLOOR in one step, numbered `TR-`, noted with the order's number). The order's lines get `qty_delivered = qty_picked`; the order becomes DELIVERED with the transfer numbers on its event. **No invoice, no receivable, no sale listener:** the goods changed warehouses inside the company. The ledger legs are ADR-0035 #4's (1–2 out to TRANSIT, 3–4 into the destination), so costs travel with the goods and the books see an ordinary transfer, not a sale.

### 3. Authorisation

As for a SALE stage, the stage's MOVE right is the authorisation: `pushInTx` makes no warehouse-scope check (the public `create`, `ship` and `receive` keep theirs). Moving a card into the stage is what an admin configured the stage for.

### 4. What stays

The transfer request flow of ADR-0116 (the seller asks from the app, the keeper ships, the store counts by scan, the keeper confirms) is untouched and remains the way for the floor to ask for goods itself. The TRANSFER stage is the board-driven way: the order is prepared in the warehouse and the arrival on the floor is one card move. The SALE stage, invoices and receivables are unchanged.

### 5. On `bto_main`

Pipeline 6 «{Агуулах ---> Заал} хөдөлгөөн» → store S1 «Үндсэн заал» (id 10), its stage «Зааланд орсон» set to TRANSFER. Pipeline 4 «{Агуулах --> Архины заал} хөдөлгөөн» → store S2 «Заалны архи» (id 149), a stage «Архины зааланд орсон» (TRANSFER) added before «Архивлах». Done through the API after the migration, not in the migration.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Posting the order's own `SO` document with TRANSFER legs | The books value each document by its type (F4); an `SO` that is not a sale would need a special case in finance. A real `TR` document keeps every rule. |
| Creating the push SHIPPED and letting the floor receive by scan (ADR-0116) | Doubles the floor's work for goods the warehouse just prepared under the order's own count; the erxes flow had no second count. The scan flow stays available through the app's «Шилжүүлэг». |
| A warehouse-scope check on the mover | The SALE stage has none either; the stage's MOVE right is what an admin grants for exactly this. |
| One transfer for the whole order | An order's lines may come from several home warehouses; a transfer is one source → one destination (ADR-0034's one-number, one-status rule). |

## Consequences

- `docs/modules/sales.md` (the stage actions, the pipeline's store), `docs/modules/inventory.md` (`pushInTx`), `docs/STATUS.md`.
- The integration suite `sales-boards` covers the two refusals, the move before picking, the push's legs and bins, the order's events and the refused removal of the store.
- Orders on a transfer pipeline still need a customer (the floor as a customer record) and a price: the order form is unchanged.
