# ADR-0230: «Асуудалтай бараа»: the products the system got wrong, per warehouse, with a morning sheet counted by «Барааны мэргэжилтэн»

|          |                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------- |
| Status   | Accepted                                                                                           |
| Date     | 2026-11-20                                                                                         |
| Deciders | Owner (2026-11-20, through the brain's brief), Claude (the brain's session; the worker `bto-core`) |
| Amends   | ADR-0027 #7 (a read filtered by the write scope, for this module only); ADR-0165 (an eleventh system role); architecture §3.1 rule 4 (one more reader of other modules' tables, one file) |

## Context

Bto never lets a balance go below zero: an order reserves what is available and the rest is backordered (SPEC §6.4 #4), and a till that sells what the system says the shelf lacks first adjusts the missing quantity in (`POS_SHORTFALL`, ADR-0063 #5). Both are the moments the system and the shelf disagreed, and until now nobody saw them in one place: the shortfalls sit on a supermarket page, the cut lines inside each order.

The owner asked for «Асуудалтай бараа» per warehouse: the products whose stock is wrong, why (which till sale, which order), the actions that put them right, and a sheet each morning that a new role counts on the phone and the office approves.

## Decision

1. **A module of its own**, `modules/stock-problems` (depends on identity, catalog, partners, inventory, pos; nobody imports it). It writes no stock: goods leave only through a goods issue (ADR-0117) and come in only through an adjustment, both inventory's own services.
2. **The two kinds of problem are read where they live, never copied.**
   - «Улайсан» (`POS_SHORTFALL`): the tills' shortfalls nobody has checked (`pos_shortfalls.resolved_at IS NULL`), through the pos module's own list.
   - «Дарагдсан»: an order line with `qty_backordered > 0` of an order that is not a draft (`BACKORDER`, dated the order's confirmation), and a picked line with `qty_picked < qty_approved` (`SHORT_PICK`, dated the part's `done_at`): the system had it, the shelf did not. A cancelled order's cut stays: it still says what the stock was.
   - The sales module has no reader for these lines, so one file (`services/problem-sources.service.ts`) reads `sales_order_lines`, `sales_orders` and `sales_order_picks` with plain read-only SQL, as the reports do. Nothing else in the module names another module's table.
   - Only the last `STOCK_PROBLEM_WINDOW_DAYS` = 30 days are read (Claude's default): an event nobody answered leaves by itself, and the first morning does not start with the whole history.
3. **The list is per (warehouse, product)**: the events after that product's last resolution in that warehouse, with the warehouse's on-hand now. A user sees only the warehouses of their write scope (`user_scopes`; no scope = every warehouse) — the owner's rule for this list, where ADR-0027 leaves reads unfiltered.
4. **Two decisions** (`stockProblems.manage`), each a row of `stock_problem_resolutions`:
   - «Зүй ёсны» (`LEGIT`, an optional note): the product leaves that warehouse's list at once; a later event brings it back. The till shortfalls it answers are marked checked through pos's own `resolveShortfall`.
   - «Үлдэгдэл тэглэх» (`ZERO_OUT`): a goods issue for the quantity (default: the warehouse's whole on-hand; never more) to the warehouse's fixed customer and expense type is created and sent; the keeper confirms it as any issue and the stock leaves then. The row is `PENDING` until the issue posts; a cancelled issue puts the product back. While a decision waits, no second one is taken (409).
   - A resolution answers the events **up to the moment it was decided** (`covers_until`; a sheet line: the moment it was counted), so an event that arrives while the document waits is not swallowed.
   - Inventory has no hook that tells a posted issue, so the waiting rows are brought up to their documents before every read and by the morning job (`StockProblemsService.sync`).
5. **Per-warehouse defaults** (`stock_problem_settings`): the fixed customer and the goods-issue expense type; each warehouse has its own keeper. Without both, a zero-out and an approval with a shortage answer 409 `SETTING_MISSING`.
6. **The morning sheet.** A cron job at 07:00 Ulaanbaatar (`stockproblems.morningSheets`, ADR-0040) builds, per warehouse with problem products, the day's sheet (`stock_problem_sheets`, one per warehouse and day) with the system's quantity at that moment; a manager's button builds the same. Building twice only adds the products that became a problem since. A product whose decision waits for its document is left off. An older open sheet nobody counted is closed; one with counts stays open for its approval and its counted products are left off the new sheet.
7. **The count** (`stockProblems.count`, the staff app): the counter sets a line's quantity, as often as needed until the approval; each entry stores the warehouse's on-hand at that moment and `difference = counted − on-hand` (as ADR-0176 #3: counting does not stop the warehouse).
8. **The approval** (`stockProblems.manage`, the web): every line counted, or only the counted ones on request. Shortages become ONE goods issue to the warehouse's customer and expense type (sent; the keeper confirms). Surpluses become ONE adjustment «Илүүдэл» (`SURPLUS`), submitted, and posted at once only when the approver also holds `inventory.adjustments.approve`; otherwise it waits for that approver, as every adjustment. Equal lines are resolved at once. A product leaves the list when its document posts.
9. **Rights and the role.** `stockProblems.read`, `stockProblems.count`, `stockProblems.manage`. A new system role `PRODUCT_SPECIALIST` «Барааны мэргэжилтэн» holds read and count. ACCOUNTANT (who owns goods issues, ADR-0117) gets read and manage; WAREHOUSE gets read (the keeper confirms the issue and must not approve their own shortage); ADMIN holds all.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Copying every event into a table of this module through hooks | sales' listeners bind one module each (notifications); a copy can drift from the order. Reading at the source cannot. |
| A reader service inside sales and pos | The cleaner boundary, and the natural next step; this task did not hold those modules. The read is isolated in one file so it can move. |
| Posting the zero-out directly (an adjustment `SHORTAGE`) | The owner wants the goods charged to the warehouse's party on its expense account, and the keeper to confirm: that is a goods issue (ADR-0117). |
| Posting the count's difference as `COUNT_CORRECTION` (ADR-0176) | The owner chose a goods issue to the fixed party for shortages and «Тохируулга — Илүүдэл» for surpluses. |
| Letting `stockProblems.manage` post the surplus adjustment | Posting an adjustment is `inventory.adjustments.approve` everywhere else; a second door to the stock was not asked for. |
| Resolving at the document's posting time | Events between the decision and the posting would vanish unseen. |

## Consequences

- Migration `0117_stock_problems`: four new tables, nothing changed (`REVOKE DELETE, TRUNCATE`).
- `eslint.config.mjs` `MODULE_DEPS` and architecture §4 gain `stock-problems`; `job-registry.ts` gains the job's name and queue; `worker.module.ts` the worker module.
- The web pages («Асуудалтай бараа», the sheets and their print, the settings) and the staff app's screen follow in their own tasks; the staff app needs a new APK then.
- A window of 30 days and the cancelled orders' cuts staying on the list are defaults the owner may change.

## Related

ADR-0063 #5, ADR-0117, ADR-0173, ADR-0176, ADR-0165, ADR-0040, ADR-0027, docs/modules/stock-problems.md, docs/modules/inventory.md §5 and §9, docs/modules/pos.md.
