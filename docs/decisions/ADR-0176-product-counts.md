# ADR-0176: A count by product: many counters with phones, a count window, differences approved to an account and a party

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Deciders | Owner (the old system's `/inventory-count` page described on 2026-11-10; answers: «Үргэлжилнэ, тоолсон мөчийн үлдэгдэлтэй тулгана», «Батлагч сонгоно», «Илүүдэл, дутагдалд тус бүр нэг, мөрөөр өөрчилж болно», «Зарах үнээр») |
| Amends | ADR-0038 (a stocktake was by shelf only, blind, with frozen expected quantities and one adjustment account) |

## Context

The owner counts the way the old system did: a count is opened on a location for all products, only what is scanned, a segment, a supplier or a category; every staff member counts with a phone; the office watches one window with who counted what; the differences are approved against an account and a partner chosen for each. ADR-0038's stocktake is by shelf, hides the stock from everyone and freezes it when the count starts, so the warehouse would have to stop.

## Decision

1. **A second kind of stocktake.** `stocktakes.kind` is `SHELF` (ADR-0038, unchanged) or `PRODUCT`. A product count keeps the `ST-` number, the states and the ledger document type; the shelf screens and services never see it.
2. **What is counted.** `scope_mode` `ALL` / `SCANNED` / `SEGMENT` / `SUPPLIER` / `CATEGORY` with `scope_ids`; the products are listed at creation as `stock_count_lines` (`listed`). `SCANNED` starts empty. A product outside the list that a counter scans joins as an unlisted line.
3. **Counting does not stop the warehouse.** A line's `expected_qty` is the warehouse's on-hand at the moment of its first entry (`first_counted_at`). Movements after that moment and before the approval are shown as «moved during»; the approval posts the difference against the expected quantity, so those movements stay in the stock.
4. **Counters.** Any signed-in staff member counts (`@Authenticated()`). A counter starts a session (`stock_count_sessions`, one open per person and count), adds entries (`stock_count_entries`: product, unit, typed quantity, factor, base quantity) and sends it. A repeat scan is a new entry; the entries are never merged or deleted, a wrong one is voided. A line's counted quantity is the sum of the entries of **sent** sessions. Whoever starts must send, with nothing scanned too; a count with an open session cannot be closed (409 `COUNT_SESSIONS_OPEN`), and a manager may send for someone.
5. **Shown stock is a choice** (`show_stock`) made at creation: the counter then sees the expected quantity and is told when the count differs.
6. **Approval.** `inventory.stocktakes.approve`. The approver chooses `uncounted`: `ZERO` (a listed line nobody counted is counted as 0) or `LEAVE`. One default account and party for surpluses and one for shortages, changeable per line. The differences post as `COUNT_CORRECTION` in one ledger document; the warehouse's stock becomes the counted quantity plus what moved during the count.
7. **Accounts.** The finance settings keep the list of accounts a count may use (posting key `COUNT_<code>`, `finance.settings.manage`); a control account (money, receivable, payable …) is refused. Without a choice the difference goes where ADR-0038's went.
8. **A shortage charged to a person** leaves the stock at cost and makes a receivable at the selling price on that party (a `DAMAGE_CHARGE` document, as ADR-0117's «Хүнд тооцох»); a product without a sale price refuses the approval (422 `PRICE_MISSING`).
9. **Later changes.** A posting dated on or before the count's day that reaches the ledger after the approval is «moved after»: the count window marks the line and lists the documents that caused it.
10. **Variance report** by date, warehouse and product from the approved counts, each row with its account, party and charge.

## Consequences

- Migration `0093_stock_counts`: `stocktakes` gains `kind`, the scope, `show_stock`, the two defaults and `uncounted`; new `stock_count_lines`, `stock_count_sessions`, `stock_count_entries` (`REVOKE DELETE, TRUNCATE`).
- Unit cost in the window and the report is shown only with `inventory.costs.manage`. The window's reads need `inventory.stocktakes.manage`; a counter reads only the open counts and their own session.
- A count is not blind any more when the owner says so; the shelf stocktake stays blind.
- The web screens and the staff app's «Тооллого» follow in their own commits.

## Related

ADR-0038, ADR-0117, ADR-0097, docs/modules/inventory.md, docs/modules/finance.md.
