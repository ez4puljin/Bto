# ADR-0047: Shorter document flows on the web, counts kept on the device, and attention counts on the home page

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-14 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0037 #3 (a device keeps unsent transfer counts and the last chosen warehouse); ADR-0042 #5 (the home page reads the attention counts) and #8 (receipts are created in a dialog too); ADR-0043 #3 (a confirmation's main button takes the focus) |

## Context

The second UI session asked the owner on 2026-10-14 which steps of the receipt, transfer, adjustment and stocktake flows feel long (structured questions).

- **Receipts, all four answers:** one product is scanned once per box; the separate «Шинэ орлого» page is a detour; the delivery note's header cannot be corrected; the accountant opens every receipt's separate costing page.
- **Transfers, all four answers:** incoming requests are hard to find; counts typed while shipping or receiving vanish on a reload; a sent request cannot be edited (ADR-0046); there are too many «Итгэлтэй юу?» dialogs.
- **Adjustments and stocktakes:** no step should go.
- **Ship and receive:** ask only when a count differs from the request.
- **Home tiles, the owner chose seven:** transfers to ship, transfers to receive, adjustments to approve, stocktakes to review, receipts waiting for their costs, products waiting for prices, and low stock.

Two rules stood in the way: ADR-0037 #3 kept drafts out of `localStorage`, and the home page read nothing (ADR-0042 #5, docs/ui.md §6).

## Decision

1. **Receipts.**
   - **Creating.** A receipt is created in a dialog on the list (`?new=1`): warehouse (preselected), supplier, delivery note number and date, note. It lands in the editor with the scan box focused. `/inventory/receipts/new` redirects there.
   - **Header.** The draft's header is edited in its read-first card (`PATCH /receipts/:id`, drafts only; the warehouse stays).
   - **Costs** are entered on the receipt page itself, for holders of `inventory.costs.manage`:
     - each line takes a unit price or a line amount (the one typed last is sent), then a «Бонус» switch;
     - «Хадгалаад дараагийнх» saves and opens the next receipt waiting for its costs, in the list's order, among the warehouses the accountant may write;
     - `/inventory/receipts/:id/costing` redirects to the receipt.
2. **Scan quantity.**
   - «Тоо» beside the scan box multiplies the scanned unit (a box of 24 with «Тоо» 24 is 576 pieces) and returns to 1 after each scan.
   - A scanned unit that already has a line (on the same shelf) adds to that line.
   - Scans run one after another, never in parallel.
3. **Confirmations.**
   - A confirmation of the `default` kind gives its main button the focus, so Enter confirms. A destructive one (cancel, delete) keeps «Болих» focused. The visual order stays «Болих», then the main button.
   - Transfers:
     - sending or taking back a request asks nothing;
     - shipping and receiving ask only when a count differs from the request (or from what was shipped), listing the differences;
     - declining is one dialog with the required reason;
     - cancelling a draft and withdrawing a request still ask.
   - Receipts, adjustments and stocktakes keep their confirmations.
4. **Scanning under dialogs.** The keyboard-wedge scanner delivers nothing while a dialog that does not contain its box is open. A scan's Enter is always swallowed, so it never presses a focused button.
5. **The step's buttons stay in reach.** Long editors end with a sticky action bar (`StickyActions`) holding the step's buttons and a short summary.
6. **On the device** (amends ADR-0037 #3).
   - **Transfer counts.** Counts typed while shipping or receiving, and not yet sent, are kept in `localStorage`:
     - key: `tugeel.inventory.stepCounts.v1:<userId>:<transferId>:<ship|receive>`;
     - only lines that differ from their default, each with the line's basis (product, unit and quantity asked for, or shipped);
     - a line whose basis changed is dropped when the editor restores the rest;
     - cleared when the step is done or the transfer moves on; entries older than 7 days are swept.
   - **Last warehouse.** The last warehouse chosen in a create dialog is kept per user and kind (`tugeel.inventory.lastWarehouse.v1`).
   - **Leaving.** Leaving an editor with unsent counts asks first («Илгээгээгүй тоо байна»).
   - Every read and write is wrapped so blocked or full storage only loses the convenience. Nothing another user or device must see goes there.
7. **Attention counts** (amends ADR-0042 #5).
   - **Endpoints.** A module with work waiting for someone answers `GET /<module>/attention`:
     - counts capped at 100 (shown as «99+»);
     - scoped by the caller's permissions (0 without them) and write scope.
   - **`GET /inventory/attention`:**
     - transfers to ship (REQUESTED, source in scope) and to receive (SHIPPED, destination in scope), with `inventory.transfers.manage`;
     - adjustments to approve (SUBMITTED), with `inventory.adjustments.approve`;
     - stocktakes to review (REVIEW), with `inventory.stocktakes.approve`;
     - posted receipts waiting for their costs, with `inventory.costs.manage`;
     - low stock (the low-stock list's rule, counted per warehouse, with the warehouse that has the most), with `inventory.transfers.manage`.
   - **`GET /pricing/attention`:** active products waiting for prices, with `pricing.prices.manage`.
   - **The home page** shows one tile per count above zero, linking to its list already filtered. It shows nothing while loading or after an error. It refreshes every 60 s while visible, when the window regains focus, and after the steps that change a count.
   - The transfer list's direction filter works without a warehouse: it then means the warehouses the caller writes for (all of them for an unscoped user).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep step counts on the server | A table, an endpoint and cleanup inside four transactions, for something only the counting clerk needs; warehouse work is on one PC (SPEC §5.4) |
| One attention endpoint for every module | It would read other modules' tables; each module counts its own work and the home page asks those the user may act on |
| Ask before every irreversible transfer step | The owner named these dialogs as the slow part; a step without differences is exactly what was asked |
| A separate costing page with a next button | The owner wanted the costs on the receipt itself |
| «Тоо» kept between scans | A forgotten 24 multiplies the next product too; returning to 1 is the safe default |

## Consequences

**Positive.**
- A receipt starts in one dialog, a box of 24 is one scan, and the accountant moves from receipt to receipt.
- A reload or a stray click no longer loses a count.
- Each person sees the work waiting for them on the home page.

**Negative.**
- Counts kept on a device do not follow the clerk to another one.
- The home page now calls the API (small capped counts, cached).
- An admin can see seven tiles at once.
- Enter now confirms; the scan guard (#4) keeps a scanner from confirming a dialog.

**Follow-ups.**
- Moves, imports re-upload and the discount form's units: the next UI pass.
- Costing a receipt with more than 500 lines, and merging counts when two devices scan one draft: when needed.

## Related

ADR-0033, ADR-0035, ADR-0037, ADR-0038, ADR-0039, ADR-0042, ADR-0043, ADR-0044, ADR-0046, `docs/ui.md`, `docs/modules/inventory.md`, `docs/modules/pricing.md`.
