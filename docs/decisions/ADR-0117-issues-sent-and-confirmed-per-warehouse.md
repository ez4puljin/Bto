# ADR-0117: Goods issues sent by the accountant and confirmed warehouse by warehouse, with the account and the party on every booking, damage charged to a person at the sale price, and corrections as changes the keeper confirms (slice 3)

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-29 |
| Deciders | Owner (scope in `docs/workflows.md` §6, one question round, 2026-10-29), Claude (Claude Code session started by «Bto удирдлага») |
| Amends | ADR-0081 #1 (statuses, the warehouse per line, the shelf picked at the confirmation), #3 (the accountant creates and sends, the keeper confirms; `inventory.issues.manage` moves to ACCOUNTANT and `inventory.issues.confirm` is the keeper's; a posted issue is corrected by a change, not by a receipt or an adjustment), #5 (a seventh seeded type); ADR-0097 / ADR-0106 #3 (the stock journal of an issue carries the party; the seeded type `DAMAGE_CHARGE` books to COGS); ADR-0091 #3 (a supplier return's credit per confirmed warehouse); ADR-0034 (a goods issue posts in parts under one number) |

## Context

The owner froze new features on 2026-10-28 and approved an order of work that fits the real flow (`docs/workflows.md` §3). Slice 3 is the goods issue «Зарлага». Today (ADR-0081) the warehouse clerk builds and posts a one-warehouse issue alone; finance books the type's account with no party; a wrong posted issue is corrected with a receipt or an adjustment.

The real flow (`docs/workflows.md` §2, §6, the owner's answers of 2026-10-29):

1. The **accountant creates** the issue and **sends** it; **each warehouse's keeper confirms** their own lines and the goods leave at that moment. A keeper who cannot confirm sends it back with a note.
2. An issue often holds goods of several warehouses; each warehouse's part leaves on its own when its keeper confirms (unlike a receipt, which waits for the last confirmation, ADR-0115 #6).
3. Scanning at the confirmation is optional: the keeper ticks each line, a scan jumps to the line.
4. An issue names an **account** (through its type) **and a party**; the party is mandatory. The account report filters by account, and by account and party.
5. **Damage charged to a person** («Хүнд тооцох»): priced at the sale price, a receivable on the staff member or customer.
6. Supplier returns follow the same flow.
7. A posted issue is corrected by a **change** the accountant sends; when the keeper confirms it, the reversal and the new content are booked in one step (architecture §12: a posted document is immutable, a correction is a reversing document).
8. Out of scope: Kharkhorin (a customer, ADR-0084), a redesign of write-offs, the app.

## Decision

### 1. The document (migration `0054_issues_confirmed`)

- `goods_issues.status` is `DRAFT → SENT → (RETURNED → SENT)* → POSTED`, plus `CANCELLED`. New columns: `sent_at`, `sent_by`, `return_note`, `returned_at`, `returned_by` (RETURNED ⇒ a note; the next send clears them), `corrects_issue_id` (the posted issue a correction changes).
- `goods_issues.warehouse_id` is the **default warehouse**: a line whose product has no home leaves from it.
- `goods_issue_lines` gain `warehouse_id` (the product's home, else the default; the accountant may move an unconfirmed line), `checked_at` (the keeper's tick; a changed quantity clears it), `sale_unit_price` / `sale_amount` (whole MNT, «Хүнд тооцох» only); `bin_id` is nullable until the confirmation picks the shelf by ADR-0081 #4 (the keeper may name one by scanning a label). A posted line (it has its `unit_cost`) always has its bin (CHECK).
- `goods_issue_confirmations (issue_id, warehouse_id)`: who confirmed the warehouse's part and when; `unchanged` marks a correction's warehouse whose lines equal the parent's (nothing to confirm). A confirmation that posted is never withdrawn (the goods are gone); only `unchanged` marks are rewritten at the next send. `REVOKE TRUNCATE`.
- The seventh seeded expense type `DAMAGE_CHARGE` «Хүнд тооцох» (sort 70); `DEFAULT_ISSUE_EXPENSE_TYPES` carries it and `ensureDefaults` inserts it on an existing database.
- A new ledger movement `GOODS_ISSUE_REVERSAL` (sign +1, one leg): a correction brings the corrected part back at the cost it left at. The `stock_ledger` CHECKs are recreated.

### 2. Who does what

| Right | Role | Allows |
|---|---|---|
| `inventory.issues.manage` | ACCOUNTANT (no longer WAREHOUSE) | create, edit, send, cancel, open a correction |
| `inventory.issues.confirm` | WAREHOUSE | tick lines, name a shelf, confirm, send back — in the write scope |

- **Send** (`POST /issues/:id/send`, idempotent): DRAFT or RETURNED → SENT; at least one line, an active type, every unit still current; the party is required (the header always has one). «Хүнд тооцох» needs a USER or CUSTOMER party (422 `ISSUE_RECIPIENT_KIND`) and every line takes its sale price now (422 `PRICE_MISSING` names the product).
- **Edit.** The accountant edits the header and the lines in DRAFT, SENT and RETURNED, but never a line of a warehouse whose part left (409 `ISSUE_WAREHOUSE_CONFIRMED`); once a part left, the type and the party are fixed too. **Cancel** is refused once a part left (409 `ISSUE_PARTLY_POSTED`): the accountant removes the remaining lines instead, and a sent document whose every remaining warehouse has left completes to POSTED.
- **Confirm** (`POST /issues/:id/confirm`, idempotent): the warehouses of the issue in the caller's write scope that have no confirmation yet (none → 403 `WAREHOUSE_SCOPE`); every line of each must be ticked (409 `ISSUE_LINES_UNCHECKED {warehouseId, count}`); bins are picked where none was named; **that warehouse's part posts at once** (`StockPostingService.post` with `partial: true`: the document keeps its status, the first part takes the one `GI-` number and the effective date, later parts reuse them); the costs are written on the lines; the confirmation row is inserted; the books get the part (§3). When every warehouse of the issue has its row, the issue is POSTED (`posted_at`, `posted_by`). Two keepers confirming at once post both parts under the one number (proved by `issues-races.spec.ts`).
- **Return** (`POST /issues/:id/return {note}`): a keeper of a warehouse still waiting sends the document back (RETURNED, the note kept, audit `RETURN`); the posted parts stay.
- The keepers' list: `GET /issues?pending=1` lists the sent issues with a line of the caller's warehouses still to confirm.
- A new line of a sent issue, a quantity change and a shelf scan are the same routes as before plus `PATCH /issue-lines/:id/check` and `PATCH /issue-lines/:id/bin` for the keeper.
- The ISSUES import's warehouse option is the default warehouse; its lines take their homes; the revert cancels untouched drafts as before.

### 3. The books (finance)

- **The party on every issue booking (#4).** `StockPostedFacts` carries the issue's party; `StockBooksService` names it on the stock journal (`BTO.STOCK_VALUE`) as the document's party and on the expense line: a customer's or a supplier's own party, a staff member as `user:<id>` (kind EMPLOYEE), a typed name as `other:<search key>` (kind OTHER; equal names are one party, the stored name follows the latest spelling). The account report `GET /gl-accounts/:id/ledger` takes `partyId` (the lines, the running balance and the opening of that party), `GET /gl-accounts/:id/parties` lists the parties with lines on the account, and every ledger row names its party whatever its kind. An index `fin_journal_lines_account_party_idx` serves both.
- **Damage charged to a person (#5).** The type `DAMAGE_CHARGE` books the goods out at cost to **COGS** (610101, the seeded role; TODO-VERIFY D8). Each confirmed part also posts `BTO/DAMAGE_CHARGE/<issue>:<warehouse>`, a new document type `BTO.DAMAGE_CHARGE` (class AR_INVOICE, numbered by Bto as `GI-…/<warehouse code>`): Dr AR (an open item on the party, due on the posting day) / Cr `OTHER_INCOME` (511020) at the sale price, **no VAT** (TODO-VERIFY with the accountant). The margin is the difference between the two documents. The sale price is the warehouse price per base unit in force at the send (whole MNT, VAT included, no discount programs), read through the new inventory hook `SALE_PRICE_READER` that pricing binds (inventory never imports pricing). A customer's charge sits on the customer's balance and in the credit check; a staff member's receivable is read on the account report by account and party (the customer screens stay customer-only).
- **Supplier returns (#6).** The AP credit is booked per confirmed part, `BTO/SUPPLIER_RETURN/<issue>:<warehouse>` numbered `GI-…/<warehouse code>`; an issue posted in one step before this decision keeps its plain id (the development re-post knows both).
- **Dates.** A part's finance documents are dated the **posting's business day**, like the stock journal, so a keeper never meets a closed period through an old `issued_on`.

### 4. Corrections (#7)

- `POST /issues/:id/corrections` (manage, idempotent) opens a **child** issue of a POSTED parent: `corrects_issue_id`, the parent's header (today's date) and a copy of its lines. One correction per issue (409 `ISSUE_CORRECTION_OPEN`); a corrected issue is corrected again through its correction.
- The accountant changes quantities, removes lines or adds some, and sends. At every send the warehouses whose lines equal the parent's (same product units and quantities) are marked `unchanged` — nothing to confirm there — and a correction that changes nothing is refused (422).
- When the keeper confirms a changed warehouse, **one posting** writes the parent's lines of that warehouse back (`GOODS_ISSUE_REVERSAL`, the parent line as `doc_line_id`, at the parent line's `unit_cost`) and the child's lines out (`GOODS_ISSUE`, at the average), in one lock pass; the books receive the reversal as a stock document of its own (the parent's type and party) beside the new content; a damage charge or a supplier credit of the parent's part is reversed (intake REVERSE, dated today) and the child's booked. A charge a payment was already allocated to refuses the reversal with the core's `FIN_REVERSAL_BLOCKED`: the accountant frees the allocation first.
- The parent shows «Залруулсан: GI-…», the child «Залруулга: GI-…»; the parent stays immutable.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One issue per warehouse (the accountant splits the document) | The owner wants one document for one purpose and party; the keepers confirm their own parts (§6 #1–#2). |
| The whole issue posting at the last confirmation (as receipts do, ADR-0115) | The owner chose parts leaving as each keeper confirms: issued goods leave separately. |
| A number per part | One number per document, as every Bto document; the books' part documents carry `GI-…/<warehouse code>`. |
| Editing a posted issue in place | Architecture §12: a posted document is immutable; the ledger and the books are append-only. The change is a child document whose confirmation reverses and re-posts. |
| Two postings per correction (the reversal, then the new content) | Two lock passes on one transaction can deadlock a concurrent posting (the posting locks bins and balances in key order); one posting with both movement sets keeps the order. |
| Pricing «Хүнд тооцох» with the quote (profiles, loose pieces, discounts) | A charge for damage is the plain sale price; the warehouse price per base unit is deterministic and read by every client the same way. |
| VAT on the damage charge | No e-Barimt receipt is issued for it today; the accountant decides (TODO-VERIFY). |
| A party column of its own on the stock journal | The core's lines already carry `party_id`; the intake stores a non-control line's party. |

## Consequences

**Positive.**
- The flow is the real one: the accountant decides and sends, the keepers hand the goods over and confirm, part by part, and nobody posts another warehouse's stock.
- Every issue booking names its party: the account report answers «all meals», «one driver's meals» and «what was charged to that cook».
- Damage charged to a person is a receivable the books carry, at the sale price, with the margin visible.
- A correction is a document of its own, confirmed by the keeper who holds the goods, booked in one step.

**Negative.**
- A keeper now waits for the accountant's send; a quick warehouse-only issue needs the accountant (ADMIN holds both rights).
- A staff member's receivable is not on the customer screens; it is settled by a manual entry once the manual entry takes a staff party (follow-up).
- A document spanning warehouses is in flight until the last keeper confirms; its parts carry different posting days.

**Follow-ups.**
- Settling a staff member's receivable (a voucher or a manual entry naming a staff party).
- The accountant's answers: the COGS account of «Хүнд тооцох», the income account and the VAT question (D8, TODO-VERIFY).
- The keepers' pending issues on the staff app, only on the owner's word.
- A home tile for the keepers' pending confirmations.

## Related

ADR-0027, ADR-0034, ADR-0081, ADR-0084, ADR-0091, ADR-0097, ADR-0099, ADR-0106, ADR-0115, `docs/workflows.md` §2, §3, §6, `docs/modules/inventory.md`, `docs/modules/finance.md`, `docs/modules/finance-core.md`, architecture §4, §5.3, §12.
