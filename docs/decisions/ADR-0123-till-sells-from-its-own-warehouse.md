# ADR-0123: A till sells from its own STORE warehouse — one Edge, several sales floors with their own stock

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner («нэг Edge, нэг компьютер, гэхдээ пос бүр өөр агуулахаас хасдаг»; a supermarket's two places each selling with their own stock and their own till; one PC runs one Edge), Claude (the direct-mode session) |
| Amends | ADR-0063 #2 and #5 (the goods of a sale left the *edge's* STORE warehouse; now the *till's*), ADR-0064 #2 (the close's entry carries the till's warehouse) |

## Context

ADR-0063 bound every till to its edge's one STORE warehouse: a supermarket was one sales floor. The owner's store has two places that sell separately and must keep separate stock, and one PC may run one Edge (two Edges on one PC would double the containers, the snapshots, the backups and the e-Barimt wiring for nothing). The till, not the edge, must therefore say which sales floor its goods leave.

## Decision

1. **`pos_tills.warehouse_id`** (NOT NULL → `warehouses`, index): the STORE warehouse the till sells from and takes returns onto. A new till takes its edge's warehouse unless the admin picks another STORE warehouse of the same branch (`WAREHOUSE_KIND_NOT_ALLOWED` otherwise); the admin may move a till later (its past sales keep their movements). Migration `0058_pos_till_warehouse` gives every existing till its edge's warehouse.
2. **The edge keeps its warehouse** (`pos_edge_nodes.warehouse_id`): the default for its tills, the name on the admin's edge list, the snapshot's `node`. Nothing else reads it for stock any more.
3. **Accepting a sale** (ADR-0063 #4, #5) takes the till's warehouse: the SALESFLOOR and DAMAGED bins the movements use, the `POS_SHORTFALL` adjustment and its `pos_shortfalls` rows, the credit sale's invoice (`warehouseId`, its branch) and the vouchers' branch. A return at till B of a sale made at till A puts the goods onto B's floor, where they are handed back.
4. **The close** (ADR-0064 #2) books the shift's entry on the till's warehouse.
5. **The snapshot** names each till's `warehouseId` / `warehouseName` (optional fields: an older edge ignores them); the kiosk needs nothing from them today.
6. **The admin**: the tills page shows the warehouse and lets a manager pick it (the STORE warehouses, the edge's first); «Байгууллагын бүтэц» shows it on each till under its Edge.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Two Edges on one PC, one per sales floor | Two PostgreSQLs, two snapshots, two tokens, two kiosk ports, two backups on one machine, with no independence gained (the PC is the single point). |
| A warehouse per sale chosen by the cashier | The floor is a property of the place the till stands, not of each sale; a wrong pick moves stock between floors silently. |
| A bin per floor inside one STORE warehouse | The shelves (bins) are on hold (2026-10-30); the owner wants plain warehouse balances per place, transfers between them, and the keepers' counts per place. |

## Consequences

**Positive.** One Edge per supermarket, any number of sales floors with their own stock; transfers (ADR-0116) move goods between floors; the reports by warehouse show each floor.

**Negative.** A till moved to another warehouse changes where its future shortfalls and returns land; the shift's journal entry names one warehouse (the till's) even when a cashier returns goods of another floor's sale.

**Follow-ups.** The kiosk could show the till's floor on its sign-in screen; the shortfalls page could filter by warehouse.

## Related

ADR-0063, ADR-0064, ADR-0067, ADR-0116, `docs/modules/pos.md`.
