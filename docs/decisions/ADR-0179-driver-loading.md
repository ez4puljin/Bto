# ADR-0179: Drivers mark the picked orders they loaded, in the staff app

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Deciders | Owner («Жолооч өөрийн Ажилтны аппаар Бэлтгэсэн захиалга сонгож түгээлт хийдэг байх. Машиндаа ачсан дэлгүүрүүдийг сонгож ачдаг байх. Жолоочийн дэлгүүр ачсан цаг бүртгэгддэг байх.»); the open points decided by the recommended defaults below, as the owner's working rule for spawned sessions allows (2026-10-31) |
| Amends | ADR-0056 (stage actions), ADR-0174 (the staff app's «Цэс») |

## Context

The company delivers pre-packed orders with its own trucks (no van sales). Keepers pick an order in «Бэлтгэл» (ADR-0126, ADR-0132) until it is PACKED; the office moves its card through the board, and on the company's boards the sale («Баримт хэвлэх», action SALE) usually comes *before* the column «Ачигдсан…» that the old system used for a loaded truck. Nobody recorded which driver took which store's goods, or when. The `DRIVER` system role existed with no rights, and the order status `DISPATCHED` was never used.

## Decision

1. **What a driver sees.** The right `sales.orders.load` (the `DRIVER` role's only right) opens the staff app's «Ачилт» and `GET /sales-loading`: the picked orders (`picked_at` set; status PACKED, or already sold — DELIVERED, INVOICED, CLOSED) that are not archived, sit in a SALES pipeline or none, have no live loading and were picked within the last 14 days (`LOADING_WINDOW_DAYS`); then the caller's own loadings of today (Ulaanbaatar day). Every driver sees every such order: the boards' role visibility does not apply, since a driver holds no board right. The fulfilment is not a filter, because the office's orders default to PICKUP. The list carries the store, the address and phone, the order number, line count, delivery date, payment method and total, and marks an order whose receipt is not yet printed (PACKED) «Баримт хэвлээгүй».
2. **Loading.** The app groups the orders by store; the driver ticks the stores whose goods went onto the truck and presses «Ачсан» (confirmed once). `POST /sales-loading { orderIds }` (Idempotency-Key, at most 100) loads every named order in one transaction: orders locked FOR UPDATE by id, each must still be loadable (`ORDER_NOT_LOADABLE`) and not loaded by anyone (`ORDER_ALREADY_LOADED`, naming the driver); nothing is kept when one fails. Each loading is a row of `sales_order_loads` (order, driver, `loaded_at`, the stage move if any) with an audit row `LOAD`. A loading changes **no order status and no stock**: `DISPATCHED` stays unused, the sale stays the board's SALE stage, and credit exposure, the customer's words and the rep's states are unchanged.
3. **The card goes out for delivery.** A SALES pipeline may name a **loaded stage** (`sales_pipelines.loaded_stage_id`, a live stage of that pipeline running no action, set on the pipeline's sheet as «Ачсан захиалга орох шат»). On loading, the card moves forward into it when every stage it would pass over leaves the order as it is: NONE, CONFIRM and PICK stages always, a SALE stage only when the order is sold, never a TRANSFER or CANCEL stage. So a sold order lands in «Ачигдсан», and a packed order waits before its sale where it is (the office moves it on; its loading stays recorded). The move is recorded in `sales_stage_moves` by the driver; the one-stage rule (ADR-0129) does not apply to it. Migration `0096_sales_loading` sets, on each SALES pipeline, its first live no-action stage whose name starts with «Ачигдсан».
4. **Taking a loading back.** A wrong tick is taken back (`POST /sales-loading/:orderId/undo`) by the driver who loaded it on the same Ulaanbaatar day, or by the holder of `sales.boards.manage` at any time (`LOAD_UNDO_FORBIDDEN` otherwise). The row stays with `undone_at` / `undone_by` (the `app` role cannot DELETE or TRUNCATE it); the card goes back to the stage it came from when the loading moved it and it still sits there. At most one live loading per order (a partial unique index).
5. **What the web shows.** The board's card shows «Ачсан HH:mm · <driver>» with a truck; the order panel's «Ерөнхий» shows «Ачсан: <driver> · YYYY-MM-DD HH:mm». Both read the live loading.
6. **Left for later.** No trucks or trips as records (one driver may use any truck; the loading names the driver only), no delivery confirmation at the store, no returns or failed deliveries from the app (`DELIVERY_FAILED` stays unused; a return is the office's credit note as before), no route order. These wait until the owner asks after trying «Ачилт».

## Consequences

- A driver needs only the `DRIVER` role; the role's ticks on «Дүрүүд» (ADR-0165) can widen or narrow it.
- The staff app 0.17.0 shows «Ачилт» in «Цэс» and among a driver's first favourites; older apps keep working without it.
- The sale and the loading are independent: a packed order may be loaded before its receipt is printed, and the card waits for the office's sale.
- `sales_order_loads` is the history of who loaded what and when, including the ones taken back.

## Related

ADR-0056 (stages and their actions), ADR-0126 / ADR-0132 (picking), ADR-0129 (one stage at a time), ADR-0165 (editable system roles), ADR-0174 (the staff app's menu), `docs/modules/sales.md`, `docs/modules/mobile.md`.
