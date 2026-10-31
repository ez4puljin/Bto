# ADR-0130: One «Бараа» tab with the picking inside; short picks as deductions; a save over a newer change is refused

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner (the request of 2026-10-31: «Бараа болон бэлтгэх нэгтгэж нэг болго. Бараа дууссан бол хасалт хийдэг байх … захиалганаас бараа нь харагддаг, манай дээр хасалт хийдэг байх. Зэрэг бүх агуулахынхан апп болон утсаараа өөрчлөлт хийхэд аль нэгний нь өөрчлөлт хадгалагдаагүй үлдэх ёсгүй»), Claude (the direct-mode session) |
| Amends | ADR-0059 (the order panel's tabs), ADR-0126 #2 (the pick form as its own tab) |

## Context

The order panel had «Бараа» (the lines with prices, the admin's edits) and «Бэлтгэх» (each warehouse's part with its picker and the count form) as two tabs; the keeper went back and forth between them. When a product is out of stock the keeper picks fewer than ordered: the order must keep what the customer asked for while the sale invoices what left the warehouse (ADR-0060 #3 already does so). The order is saved as a whole by `PUT /sales-orders/:id`; a save from a stale view would overwrite what a keeper or another office user changed meanwhile, and the owner asked that no one's change be lost when every warehouse works on the same order at once.

## Decision

1. **One tab.** «Бэлтгэх» is gone; `?tab=pick` lands in «Бараа». When the order has parts (CONFIRMED, PICKING, PACKED), «Бараа» shows each warehouse's part as its own card: a header in the part's tone (grey not started, orange being picked, green picked) with the status, the picker, the line count and the actions (take, hand over, open again, confirm), and under it that warehouse's lines with their prices, reserved and backordered counts. The warehouse column goes; the filters stay.
2. **Short picks are deductions.** The keeper confirming a part types the picked count beside each line (default the reserved count), «Бараа дууссан» sets it to 0; a «Хасалт» column shows «−n unit» live while typing and after the confirmation; the footer counts the lines with a deduction. The ordered quantity stays on the line and on every document; the sale invoices the picked one (ADR-0060 #3). No new state: `qty_picked` already held the short count.
3. **A save over a newer change is refused.** `PUT /sales-orders/:id` takes `expectedUpdatedAt`, the `updatedAt` the client read; when the order changed since, the server answers `ORDER_CHANGED` (409, `params.updatedAt` the current one) and the client re-reads the order, keeping what was typed, before saving again. Every change of a part (take, hand over, confirm, open again) moves the order's `updated_at`, so an office save from before it is caught. The web always sends the value it read.
4. **Parts stay independent.** A part is confirmed with its own `POST …/picks/:warehouseId/pick` under the order row's lock and the part row's lock: two keepers confirming different warehouses at once both land; the same part confirmed twice at once answers the second with `PICK_STATE_INVALID`. The open panel re-reads the order every 15 s and on focus, so every keeper sees the others' progress; the counts being typed are kept by line id across those reads and never replaced.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A separate «Хасалт» document per shortage | The deduction is already the picked count; a document would double the fact and the keeper's work. |
| Merging a stale save line by line | The whole-order save is how the admin edits; a refused save with a fresh read is explicit and the typed lines survive it. |
| Locking the order while someone edits it | Phones and tabs are abandoned; a lock would block the warehouse. |

## Consequences

- `sales-picking` integration suite: two keepers pick at once and both counts stand (one short); a save with the stale `expectedUpdatedAt` is refused and the fresh one accepted; the same part confirmed twice at once gives one 200 and one 409.
- No migration: `expectedUpdatedAt` is a request field, `ORDER_CHANGED` a code.
- `docs/modules/sales.md` §4, §6 and §8 updated.
