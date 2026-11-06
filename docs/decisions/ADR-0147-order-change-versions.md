# ADR-0147: An order's change versions

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («Захиалгын өөрчлөлтийн хувилбар», after the study of Medusa's order changes, 2026-11-05), Claude (the session) |

## Context

An order is edited until the sale (ADR-0126 #4), and each save replaces its lines. The audit said only that it was saved, so nobody could tell what had changed, or why the total moved.

## Decision

1. Each save that changed something writes one row of `sales_order_changes` (migration `0071`) in the save's transaction, under the order's lock: the next version, the order's status, the changed header fields, the lines added, removed or changed (kept by product unit and warehouse), the total before and after, who and when. A save that changed nothing writes none.
2. The rows are append-only, and names are copied so that a renamed product does not rewrite history.
3. The order's activity shows them. A warehouse-scoped keeper sees the lines of their warehouses and no totals (ADR-0126 #3); header changes stay visible to them.
4. There is no approval: a save takes effect as before. Medusa's request-and-confirm step is left out until the owner asks for it.
5. Editing is unchanged, and orders edited earlier have no versions: their history starts now.

## Consequences

A dispute over an order can be answered from its own page. One more read of the order per save.

## Related

ADR-0059, ADR-0126, ADR-0130.
