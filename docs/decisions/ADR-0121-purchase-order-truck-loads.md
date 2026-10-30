# ADR-0121: The purchase order's front page and its truck loads: suppliers alone carry a status, trucks are named on the order and whole suppliers ride on them

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-30 |
| Deciders | Owner («Захиалга өөрөө төлөв байх ёсгүй», «Машин нэмэх, нийлүүлэгчийг машинд хуваарлах дутуу байна», 2026-10-30, after reading Butenorgil's order window with Claude), Claude (the direct-mode session) |
| Amends | ADR-0115 #1 and ADR-0118 #1 (the order's own status leaves the screens: it stays in the table as the lowest supplier status, for the list's filter only), ADR-0118 #2 (the detail table moves to `/procurement/orders/:id/detail`; the order opens on a front page) |

## Context

The owner compared Bto's order page with Butenorgil's «Захиалга → Нэгтгэл» window: one page per order that opens as a dashboard (brand, box, weight and estimated tiles; the suppliers per status; the suppliers grouped by their orderer, each as a card that unfolds its ordered lines), with the company's trucks beside it («Машины ачилт»: a truck is added to the order, every supplier is put on a truck or stays under «Машинд хуваарилаагүй»). Two things were wrong in Bto: the order carried a status of its own on screen, and nothing said which truck brings which supplier's goods.

## Decision

1. **The order has no status of its own on screen.** Only a supplier inside an order has one (ADR-0118's seven). The front page, the detail page and the list show the suppliers' statuses as counts («Бэлдэж 380 · Илгээсэн 20»); the list's status filter means "an order with a supplier in that status". The column `purchase_orders.status` stays as the lowest supplier status (ADR-0115), used by nothing visible.
2. **The front page** `/procurement/orders/:id` is the order's dashboard: tiles (suppliers, boxes, pieces, kg, the estimated and final amounts for price readers), the status counts as filters, and the suppliers grouped by orderer. A supplier is a card: name, status, its orderer changed in place by a manager (the supplier's setting of ADR-0115, not the order's), the truck it rides on, lines · boxes · kg, the shipped share, «→ next status» and «back» where the rights of ADR-0118 allow (with «Ирсэн» asking first as on the table), «Бараа харах» unfolding its ordered lines (code, name, ordered, shipped, remaining), and «Дэлгэрэнгүй» opening the table filtered to it. The table of every product stays at `/procurement/orders/:id/detail`.
3. **Trucks** (`trucks`): a name, an optional plate, an optional capacity in kg, active or not; kept by managers (`procurement.orders.manage`) from the order's «Шинэ машин…» dialog (`POST /procurement/trucks`, `PATCH /procurement/trucks/:id`), listed to order readers.
4. **Loads** (`purchase_order_loads`): a truck named on an order (`POST /purchase-orders/:id/loads`, idempotent), one load per truck per order, with a note; removing it (`DELETE …/loads/:loadId`) frees its suppliers. A supplier rides whole on one load or none (`purchase_order_suppliers.load_id`, `PUT …/suppliers/:supplierId/load {loadId | null}`); nothing splits a supplier across trucks. Loads are the dispatcher's plan: they move no stock, no money and no status.
5. **The panel**: «Машины ачилт» beside the supplier groups (a 26rem column from 1280px): «+ Машин нэмэх» names an active truck not yet on the order, or opens the new-truck dialog; each load shows its truck, plate, suppliers · boxes · kg, the fill against its capacity and its suppliers with «×»; «Машинд хуваарилаагүй» lists the ordered suppliers off any truck, by name and boxes, each with a truck select. Each orderer's group header says «машинд N / хуваарилаагүй M».
6. **Audit**: `LOAD_ADD` and `LOAD_REMOVE` on the order, `LOAD_ASSIGN` on the supplier row, `CREATE` / `UPDATE` on `trucks`; the order's history view (ADR-0118 #5) does not list them yet.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Splitting a supplier's boxes over several trucks | Butenorgil assigns whole suppliers; the owner asked for that; a split needs per-line loads and a second count. |
| The truck as a free-text note on the supplier row | No list of trucks, no totals per truck, no capacity check. |
| Moving the supplier to «Ачигдаж байна» when it is put on a truck | A truck is planned before the supplier ships; the status stays the orderer's call. |

## Consequences

**Positive.** One screen answers "what is this order, who orders what, where does each stand, which truck brings it"; the status buttons stand where the owner looks.

**Negative.** The order's history does not yet show the loads; trucks have no page of their own (edited from the dialog only; deactivation by API).

**Follow-ups.** The loads in the history view; a trucks page under settings when the list grows; the staff app's receiving by truck, on the owner's word.

## Related

ADR-0115, ADR-0118, ADR-0120, `docs/modules/procurement.md`.
