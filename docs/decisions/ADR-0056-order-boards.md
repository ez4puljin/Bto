# ADR-0056: Order boards and stages: a free workflow over the order states, picking confirmed by counts, two kinds of sale

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0055 (#1: a reserved order may be edited; the submit is one stage action among others), ADR-0034 (#5: `post()` takes external documents and consumes reservations), architecture §5.3 (`reservationConsume` as built), §5.6 (stages instead of picking waves and packing; the interim confirm-delivery screen becomes the SALE stage), §4 (no `pickings` / `packages` tables) |

## Context

The owner runs orders on an erxes Deals board today: one board per branch («Мөрөн Борлуулалт», «Орон нутаг борлуулалт», …), each a row of stages («Захиалга Устгах/Хадгалах», «ХТ Захиалга», «Нярав Хяналт», «Бэлдэх Захиалга», …) with cards dragged from stage to stage. ADR-0055 built the office order with a fixed state machine and a submit that confirms. The owner asked for boards and stages that staff configure themselves, with rights per board and per stage, a document printed when a card arrives at a stage, and «borlutuulalt bolgokh» (make it a sale) as a stage setting.

The owner's answers (2026-10-15):
- **Stages are free; the order states follow a setting.** A stage may carry a system action; a stage without one only moves cards.
- **Two kinds of sale.** (1) An *incomplete sale* («бүрэн бус борлуулалт»): a sales rep's order reaching the chosen stage has its stock reserved so it is promised to nobody else; no receivable yet. (2) The *main sale* («үндсэн борлуулалт»): stock leaves each warehouse and the customer owes the amount (the receivable comes with finance in delivery 3; the sale is recorded now).
- **Stock leaves after the picker confirms the counts.** A warehouse worker enters the prepared quantity of each line and confirms.
- **New orders land where a setting says**, per order channel (the office today; the sales-rep and customer apps later).
- **Rights by role.**
- **Documents:** the delivery note («падаан», with prices) and the pick list («бэлтгэх хуудас», without); each stage chooses which to print; the browser opens a PDF.
- **A reserved order may be edited**: prices and reservations are worked out again; the number stays.
- **Cards** show the number, customer, total, delivery date, who entered it and the channel; a stage's header its total. No forecast percentage.

## Decision

1. **Boards and stages.** `sales_boards` (name, an optional branch, position, archived) hold `sales_stages` (name, position, `action` NONE | CONFIRM | PICK | SALE | CANCEL, `print_pick_list`, `print_delivery_note`, archived). Rights are roles: `sales_board_roles (board, role, right VIEW | MANAGE)` and `sales_stage_roles (stage, role, right VIEW | EDIT | MOVE)`, dropped with the role. ADMIN always may. No role chosen means everyone holding `sales.orders.read` (for EDIT and MOVE, `sales.orders.manage`). Boards are configured under `sales.boards.manage` (ADMIN, assignable).
2. **Where an order sits.** `sales_orders.board_id`, `stage_id`, `stage_entered_at`; every move in `sales_stage_moves`. `sales_channel_defaults (channel, board, stage)` says where a new order of a channel lands (ADMIN = the office; SALES_REP and CUSTOMER_APP set ahead). The office may choose another visible board; the stage is that board's channel default, else its first stage. Without a configured default the order has no board and shows on the list only.
3. **Moving a card** (`POST /sales-orders/:id/move`): the mover needs MOVE on the target stage, within one board. The stage's action runs in the same transaction:
   - **CONFIRM:** a draft is submitted as ADR-0055 says (number, prices frozen, reservations); a confirmed order is left alone.
   - **PICK:** CONFIRMED → PICKING; the counts are confirmed later (#5).
   - **SALE:** needs PACKED; posts `DELIVERY_ISSUE` out of STAGING for the picked quantity of every line (document `SO`, #6), DELIVERED with `delivered_at`; the rest stays backordered. Any other state refuses the move (`ORDER_STATE_INVALID`: confirm the picked counts first).
   - **CANCEL:** asks a reason and cancels as ADR-0055 says (reservations released). A PACKED order is not cancelled this way (returning picked goods to shelves comes later).
   - Moving a card back undoes nothing: a reserved order stays reserved.
   The response names the documents the stage prints; the screen offers them as buttons (a popup opened after the request would be blocked).
4. **Editing a reserved order** (amends ADR-0055 #1): `PUT` works for DRAFT and CONFIRMED. For CONFIRMED, one transaction replaces the lines, quotes today's prices, writes the parts again and calls `ReservationService.replaceInTx`, which locks the union of the old and the new (warehouse, product) keys **once** in key order, releases the old reservations and reserves the new lines (two separate passes would take rows out of the global order and could deadlock against a submit). The number, board and stage stay. From PICKING on, no edit.
5. **Picking** (`POST /sales-orders/:id/pick`, right `sales.orders.pick`: WAREHOUSE and ADMIN; the write scope of every line's warehouse): CONFIRMED or PICKING → PACKED. Each line gets `qty_picked` (0 ≤ q ≤ `qty_base`; it may exceed the reserved quantity when the shelf holds more, which takes stock promised to other orders — allowed by D2, those orders show on the short list) and `pick_bin_id` (the fixed shelf proposed, else a shelf holding the product). One `post()` call writes, per line with a quantity, PICK_OUT from the shelf and PICK_IN into the warehouse's STAGING bin under document `SO` and the line's id, and consumes the order's reservations (#6). One pick per line: the ledger's idempotency key `(SO, line, PICK_OUT, 1)` refuses a second.
6. **`post()` for documents inventory does not own** (amends ADR-0034 #5). An `ExternalPostingDoc { docType: 'SO' | 'PK', docId, external: true }` is accepted beside the inventory documents: `post()` neither locks nor finishes nor numbers it (an `SO-` number is never drawn by `post()`); the caller locks its own header row `FOR UPDATE` and guards its state in the same transaction. That lock is also what makes the next read correct: `reservationConsume: { docType, docLineIds }` reads the lines' ACTIVE reservations without locking (only the order's own writers touch them, and they all hold the order row), unions their `(warehouse, product, lot)` keys with the movements' keys and locks all `warehouse_stock` rows once in key order; a pick with no movement at all (every line short to zero) still runs the steps. After `bin_stock`, one `UPDATE stock_reservations … RETURNING` marks the lines' reservations CONSUMED (a line with a PICK_OUT) or RELEASED (picked at zero) and sums them per row; the `warehouse_stock` statement then subtracts the movement's quantity from `sellable_on_hand` and the reservation's from `reserved` in one UPDATE (D2) — a short pick leaves the difference free (D4, per quantity: the row cannot be split). No clamping: `reserved` below zero is drift and fails on the CHECK. The movement history and `ai.stock_movements` show the `SO-` number.
7. **Documents.** PDFs by `pdfmake` with Noto Sans embedded (ADR-0011 #5, ADR-0021 #8; the TTFs from the Noto project under the OFL, kept in `apps/api/assets/fonts/`), `common/pdf/`, served inline by `GET /sales-orders/:id/pdf?kind=PICK_LIST | DELIVERY_NOTE` (`sales.orders.read`). The pick list: number, customer, delivery date, lines per warehouse with shelf, quantities, no prices. The delivery note: the company, number, date, customer, address, contact, lines with their price parts and totals, signature lines. Not an e-Barimt receipt (delivery 3).
8. **Screens.** «Борлуулалт» → «Самбар»: a board chosen among the visible ones (grouped by branch), one column per visible stage (name, count, total), cards dragged (HTML5 drag and drop) or moved through a «Зөөх» menu (phones, keyboards), a card opening a side panel with the order, the pick form for pickers, the print buttons and the stage history. «Самбарын тохиргоо» (`sales.boards.manage`): boards (name, branch, roles, archive), their stages (add, rename, reorder, archive) with each stage's dialog (action, documents, VIEW / EDIT / MOVE roles) and the channel defaults. The order list and page stay.
9. **AI.** `ai.sales_orders` gains the board, stage, `picked_at`, `delivered_at`; `ai.sales_order_lines` `qty_picked`, `qty_delivered`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Each stage bound to exactly one order state | The owner's boards have review stages («Нярав Хяналт») that change no state; a free workflow with optional actions fits. |
| Picking waves and packing documents (architecture §5.6 as planned) | The owner picks order by order and confirms counts; one pick per order on the order's own lines needs no `pickings` tables. |
| A separate `PK-` document for the pick movements | Without pick-line rows the idempotency key would still be the order line; nothing gained. One pick per line is written down instead. |
| Rights per user | The owner chose roles. |
| A forecast percentage per stage | Not wanted. |
| Opening the PDF automatically on arrival | The browser blocks a popup opened after an asynchronous request; buttons are reliable. |

## Consequences

**Positive.**
- The owner shapes the workflow per branch without code; the system actions stay where the ledger and reservations are safe.
- Stock leaves only on confirmed counts, through the one posting path.

**Negative.**
- One pick per order covers every warehouse of the order; a picker needs the write scope of each (a per-warehouse pick is a follow-up).
- A PACKED order cannot be cancelled until picked goods can go back to shelves.
- Moving a card backwards never undoes a system action; people must know which stages act.

## Related

SPEC §5.7, §6.4; architecture §5.3, §5.6; ADR-0007, ADR-0011, ADR-0021, ADR-0034, ADR-0055; `docs/modules/sales.md`, `docs/modules/inventory.md`.
