# ADR-0081: The goods issue «Зарлага»: one document for internal use, write-offs, supplier returns and transfers to other organizations, posted by the warehouse at the average cost, with a recipient, an expense type and a sheet import

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0036 (an eighth import kind `ISSUES`), architecture §4 (inventory owns `goods_issues`, `goods_issue_lines`, `issue_expense_types`), §5.3 (a ninth posted document type `GI`) |

## Context

The owner (2026-10-18): «Агуулах - Зарлага цонхийг эрхэт шиг болго». Erkhet's «хангамжийн зарлага» takes goods out of a warehouse at the average cost to a named recipient, against an expense account. Bto had no such document: goods left a warehouse only by a sale, a transfer, or a stock adjustment (ADR-0034), and an adjustment needs a reason and an approval.

Interview answers (2026-10-18):
- One document covers internal use, write-off and damage, returns to a supplier, and transfers to other organizations.
- It is a new menu item «Зарлага»; «Залруулга» stays as it is.
- The warehouse clerk posts it directly, with no approval.
- A recipient is required: a staff member, a customer or a supplier picked from a list, or a free-text name. An expense type is also required.
- An Excel import is wanted.
- A supplier return also leaves at the average cost; correcting the payable belongs to the books.
- Every warehouse can issue goods.
- The shelf is the product's fixed shelf, else the fullest one; scanning a shelf label overrides it.

## Decision

1. **A new posted document `GI` «Зарлага».**
   - `goods_issues` has: the warehouse; `issued_on`, the business date, never in the future; `expense_type_id`*; the recipient; a note; the status DRAFT / POSTED / CANCELLED; and the posting columns.
   - The recipient is `recipient_kind` USER / CUSTOMER / SUPPLIER / OTHER with the matching id. Its name is snapshotted into `recipient_name`, which is required for OTHER. A CHECK ties each kind to its column.
   - `goods_issue_lines` holds: the entered unit and quantity, the factor snapshot and the base quantity, `bin_id`, and `unit_cost`, which is written by the posting.
   - The number is `GI-<year>-<seq>`, allocated at posting. A draft has no number, and it holds at most 500 lines (`MAX_ISSUE_LINES`).
2. **The movement `GOODS_ISSUE`** has sign −1 and one leg. It is posted by `StockPostingService.post` without a unit cost, so the goods leave at the warehouse's average cost. A shelf short of stock refuses the posting with 409 `STOCK_INSUFFICIENT` (the shelf's code and what it holds), under the same bin lock order as every posting. The cost of each line comes from `result.unitCosts` and is kept on the line. The list and the detail show costs only to holders of `inventory.costs.manage`.
3. **Posted directly by the warehouse.**
   - A new permission `inventory.issues.manage` is given to the WAREHOUSE role; ADMIN has every permission.
   - Holders create, edit and post issues, and cancel drafts, in warehouses they write for.
   - Wholesale warehouses and the store may issue goods.
   - The first line creates the draft, as on the receipt window (ADR-0078 #6).
   - A posted issue is immutable; a correction is a receipt or an adjustment.
4. **The shelf.** A line names its shelf. When the shelf is omitted, the issue takes:
   1. the product's fixed shelf, while that shelf holds the product;
   2. else the fullest sellable shelf;
   3. else the fixed shelf;
   4. else the receiving area.

   Scanning a shelf label on the window switches the line to that shelf.
5. **Expense types** live in `issue_expense_types`: the name, a unique name key, an optional stable `code`, active, and the sort order.
   - Six defaults (codes): INTERNAL_USE, BONUS, MARKETING, WRITE_OFF, SUPPLIER_RETURN, TRANSFER_OUT.
   - The migration seeds them, and the api inserts any that are missing at boot, named from mn.json under an advisory lock.
   - Holders of `inventory.setup.manage` add, rename and retire types; a type is never deleted.
   - A retired type stays on its old issues; a draft naming it cannot post (409 `EXPENSE_TYPE_INACTIVE`).
   - Mapping each type to an account is for the Finance Core (ADR-0077, D8).
6. **Recipient lookups for the warehouse.** The clerk cannot read the user and customer lists, so there are two new routes, both `@Authenticated`:
   - `GET /users/lookup?q=` returns the id and full name of active users;
   - `GET /customers/lookup?q=` returns the id, code and name of active customers.

   Suppliers come from `GET /suppliers`, which is already open to the warehouse.
7. **Issues from a sheet**, an eighth import kind `ISSUES`.
   - Columns: date*, expense type* (by name), recipient*, product code or barcode (a box barcode counts boxes), unit, qty*, note.
   - The import's dialog names a warehouse or store that the user writes for, and stores it in `import_jobs.options`.
   - The recipient is matched in this order: a customer code, a supplier code or name, a customer's exact name, a staff member's full name. Failing all of those, it is an OTHER recipient with the name as written.
   - Rows with the same date, expense type and recipient make one DRAFT issue; nothing is posted.
   - The revert cancels the drafts while every one of them is still untouched; otherwise it fails with `IMPORT_REVERT_BLOCKED`.
8. **Migration `0029_goods_issues`** adds:
   - the three tables, with REVOKE DELETE / TRUNCATE;
   - `GI` and `GOODS_ISSUE` in the `stock_ledger` CHECKs;
   - the seed of the default types;
   - a `GI` branch in `ai.stock_movements` and `ai.stock_documents`, where the expense type goes in `adjustment_reason` and a supplier recipient in the supplier columns.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Widen the stock adjustment (ADR-0034) with recipients and expense types | The owner kept «Залруулга» as it is. Adjustments are counted differences that need an approval; an issue is a deliberate hand-over posted by the clerk. |
| Separate documents per purpose (write-off, supplier return, transfer out) | The owner named one window for all four. The expense type tells them apart, and the books map types to accounts later. |
| A supplier return at the receipt's cost, or as a reversal of the receipt | The owner chose the average cost. A per-receipt return would need lot costing, which Bto does not keep (ADR-0033). |
| A fixed list of expense types in code | The owner's purposes will grow; an admin list with stable codes for the defaults lets finance map them later. |
| Open the user and customer lists to the warehouse role | It would expose phones, credit and roles; the lookups return only ids, codes and names. |

## Consequences

**Positive.**
- Every way goods leave a warehouse is now a document with a recipient and a purpose.
- Write-offs and internal use stop going through adjustments.
- The cost of each issue is kept on its lines, for the books.
- The sheet import covers Erkhet's bulk issues.

**Negative.**
- The clerk posts without an approval, so a wrong issue is corrected by another document.
- A supplier return leaves at the average cost, not at the receipt's price; the payable is corrected in the books, not here.
- The expense types mean nothing to the books until the Finance Core maps them.

**Follow-ups.**
- The Finance Core books each posted issue: the expense account of its type against stock, and for SUPPLIER_RETURN a reduction of the payable (ADR-0077, D8).
- A printed issue document, if the owner asks.

## Related

ADR-0033, ADR-0034, ADR-0036, ADR-0045, ADR-0077, ADR-0078, `docs/modules/inventory.md`, `docs/modules/imports.md`, `docs/modules/identity.md`, `docs/modules/partners.md`, architecture §4, §5.3.
