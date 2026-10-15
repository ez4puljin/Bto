# ADR-0057: Boards hold pipelines; the warehouse sales page, own-orders-only pipelines and the company order number format

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0056 (#1: boards become groups of pipelines with a visibility, an own-orders-only switch and a third role right; a stage's VIEW now hides its orders everywhere; #2: placement in a pipeline, a stage chosen through «+»; #8: the screens), ADR-0055 (an order is numbered when created, in the company format), architecture §12 (sales orders are numbered at creation) |
| Amended by | ADR-0058 (#7: the list view gains a payment column; a stage's printout is on A4 or an 80 mm roll); ADR-0059 (#7: a card and a list row open the order panel; «+» and «Шинэ захиалга» open the create dialog) |

## Context

The owner showed erxes Deals again: boards («Хархорин», «Хөвсгөл») folding out into pipelines («Бөөний Борлуулалт», «Хархорин хөдөлгөөн»), each pipeline a row of stages; a stage's «⋯» menu; the settings page «Боардууд & Дамжлагууд» with its «Дамжлага нэмэх» sheet. The request: the sales menu holds «Агуулах» and «Пос», the warehouse page looks exactly like erxes with a display switch between board and list, and the board settings look like erxes's. erxes (github.com/erxes/erxes, AGPL) was read for its behaviour only; no code was taken.

The owner's answers (2026-10-15, three rounds):
- **Three levels:** board → pipeline → stage; today's board becomes a pipeline inside a board of the same name.
- **The menu:** one sales page now, the POS page joins with the POS (delivery 9). Its name was left to Claude: «Агуулахын борлуулалт», because «Агуулах» already names the inventory group.
- **A stage's «⋯»:** sort, print the documents of its cards, archive the finished cards, archive the stage. No favourites.
- **A pipeline:** name, board, visibility (public, or private by roles), manage roles, stages, plus «own orders only».
- **Order numbers:** today's erxes numbers read `20261005_0001`, then `…_0002`, «whatever board the order lands on»; numbered when created, as in erxes.
- **«+»** on a stage header only on stages without an action.

## Decision

1. **Boards, pipelines, stages.**
   - `sales_boards` becomes a group: name, an optional branch, position, archived.
   - `sales_pipelines` hold the stages: board, name, position, `visibility` PUBLIC | PRIVATE, `own_orders_only`, archived, creator.
   - `sales_pipeline_roles (pipeline, role, VIEW | MANAGE | ALL_ORDERS)` replace `sales_board_roles`.
   - Stages, orders and channel defaults point at a pipeline; `(pipeline_id, stage_id)` foreign keys keep every stage reference on its pipeline.
   - Migration 0025 turns each existing board into a board of the same name holding one pipeline of that name, with the board's roles, stages, orders and defaults.
   - Under `sales.boards.manage`, boards and pipelines are created, copied (stages and roles, never orders) and archived; a MANAGE role edits its pipeline.
   - A pipeline is saved whole: its settings and its ordered stages. A stage left out is archived, refused with `STAGE_IN_USE` while an unfinished order sits there or a channel lands there.
   - A board holding a live pipeline is not archived (`BOARD_NOT_EMPTY`); a pipeline holding an unfinished order is not archived either (`PIPELINE_IN_USE`).
2. **Who sees what.**
   - A PUBLIC pipeline is seen by every holder of `sales.orders.read`, a PRIVATE one by its VIEW roles. MANAGE and ALL_ORDERS imply VIEW; `sales.boards.manage` sees everything. A board shows when one of its pipelines does.
   - Stages keep VIEW / EDIT / MOVE.
   - **Own orders only:** a user who is not a manager and holds neither MANAGE nor ALL_ORDERS on the pipeline sees only the orders they entered. ALL_ORDERS is cleared when the switch goes off; pickers need it on such pipelines.
   - One predicate (`SalesAccessService`) decides every read and every action: cards, counts and totals, the list and its search, the order page, printing, pick information, picking, submitting, cancelling, moving, editing, archiving. An order on a stage the user may not view is therefore hidden on the list and on its page too (ADR-0056 hid it from the board only).
   - The answer to a write is not filtered: a mover may move a card into a stage they cannot view.
   - The AI assistant's views carry no row rights: `ai.ask` holders see every order.
3. **Order numbers.**
   - One company format in `sales_settings` (a single row; without it the shared defaults hold): literal characters and `{year}`, `{month}`, `{day}` (default `{year}{month}{day}_`), and the counter's digits (1–8, default 4).
   - An order is numbered **when it is created** (amends ADR-0055, where a draft had none). The pattern rendered with the business date of that day (Asia/Ulaanbaatar) is the prefix; `NumberingService.next(tx, 'SO_NO', prefix)` gives the counter, gap-free, last in the creating transaction. One counter serves every board and pipeline and starts again at 1 with each new prefix (each day with `{day}`).
   - The pattern must end with a character that is not a digit, so a number splits into exactly one prefix and its counter and two numbers never collide. A pattern starting with `SO-` is refused, so the older `SO-YYYY-NNNNNN` numbers cannot come back; a collision all the same answers 409 `ORDER_NUMBER_TAKEN`.
   - A draft created before this change takes a number when submitted.
   - The format is changed under `sales.boards.manage`, with a preview of the next number.
4. **Placement and locks.**
   - A new order lands in the chosen pipeline, else its channel's default.
   - From «+», it lands in the given stage, which must be live, have no action and be open to the user's MOVE. Otherwise it lands in the channel default stage of that pipeline, else its first live stage.
   - Nothing configured: no pipeline, as before.
   - Creating and moving lock the order, then the pipeline and the stage FOR SHARE; saving and archiving lock the pipeline FOR UPDATE. An order never lands in a stage being archived.
5. **Archiving finished orders.**
   - `sales_orders.archived_at/by` may be set only on DELIVERED, INVOICED, CLOSED or CANCELLED orders (CHECK).
   - An archived order leaves the board, its counts and totals. It stays in the list under «Архивласан» and is restored from its side panel.
   - A stage's «⋯» archives every finished card of the stage (stage EDIT).
6. **Sorting** a stage is shared by everyone: `card_sort` NEWEST | OLDEST | DELIVERY | TOTAL | WAITING (longest in the stage), set by the stage's EDIT holders. The board reads the first 200 cards of each stage in that order in one query.
7. **Screens.**
   - **Menu:** «Борлуулалт» → «Агуулахын борлуулалт» (`/sales/boards`); `/sales/orders` opens its list view.
   - **The page:**
     - a folding left panel of boards and their pipelines, a select on phones;
     - the header with the pipeline, «Тохиргоо» and «Шинэ захиалга»;
     - a bar with «Захиалга хайх» (number, customer), «Шүүлтүүр» (customer, delivery date, mine, channel, fulfilment, payment), the count, and «Харуулах» (Самбараар / Жагсаалтаар).
   - **Board view:** ADR-0056's columns and cards, plus «+» and the stage menu: sort; print the documents of chosen cards, up to 100 on one printable page; archive finished cards; archive the stage.
   - **List view:** the pipeline's orders (or all, or those without a pipeline), with stage, status and archive filters and the column chooser; a row opens the side panel.
   - **Kept per user in the browser** (as ADR-0050): the last pipeline, the view and the panel.
   - **Settings «Самбар ба дамжлага»:**
     - boards on the left;
     - the pipelines table on the right, whose row menu edits, copies, archives / restores, opens;
     - the buttons «Дугаарлалт», «Сувгийн тохиргоо» and «+ Дамжлага нэмэх». The last opens a side sheet with the tabs «Ерөнхий» and «Шатууд», saved at once.
8. **AI.** `ai.sales_orders` names the board, pipeline and stage and carries `archived_at`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Two levels, boards grouped by branch | The owner chose erxes's three levels; one place holds several flows. |
| A number format per pipeline (erxes) | The owner wants one numbering whatever the board. |
| Numbers at submit (ADR-0055) | The owner: numbered when created; drafts waiting in a stage are referred to by number. |
| The card order per user in the browser | erxes sorts a column for everyone; the office and the warehouse see the same order. |
| Archiving any card | An unfinished order holds reservations or work in progress. |
| Favourite pipelines in the menu, the page named «Агуулах» | Not wanted; the name is taken by the inventory group (ui.md: accessible names stay unique). |

## Consequences

**Positive.**
- Each place has its own flows.
- Staff see only what they should, lists included.
- The numbers are the ones the owner knows.

**Negative.**
- Roles need care: pickers need ALL_ORDERS on own-orders-only pipelines.
- A format starting with `SO-` is refused.
- An order cannot move between pipelines yet.
- The AI assistant still sees every order.

**Follow-ups.**
- The POS page (delivery 9).
- Moving an order between pipelines.
- Archiving old finished cards automatically if columns grow.

## Related

ADR-0050, ADR-0053, ADR-0055, ADR-0056; SPEC §5.7; architecture §5.6, §12; `docs/modules/sales.md`; `docs/ui.md`.
