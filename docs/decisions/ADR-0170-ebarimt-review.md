# ADR-0170: «Ebarimt» after its review: pending receipts, the orderer by date, one cell's two writers, what a file must hold

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-07 |
| Deciders | Claude (the direct-mode session), under the owner's goal for this menu («Надаас ямар ч зөвшөөрөл эсвэл асуулт асуухгүйгээр зорилгодоо бүрэн хүр», 2026-11-07); the owner checks it on the walk |
| Amends | ADR-0168 #1, #7, #9, #10 |
| Migrations | `0086_ebarimt_review` (`supplier_orderer_history`; two unused indexes dropped; the history kind `REMOVE`), `0087_ebarimt_history_guard` |

## Context

An independent review of the module, read against the code and the owner's request, found places where the page told the wrong figure or the wrong person without saying so. Some of the fixes change what ADR-0168 decided, so they stand here. None of them changes the books: the module still posts nothing.

## Decision

1. **A receipt before its price check counts at its delivery note's total, and says so** (amends #1). A receipt the accountant has not priced yet has no payable. Reading it as nothing made a month look as if the supplier had entered more than it sold. It now counts at the note's total, else what was typed less its discount, else nothing; the cell carries a mark with the number of such receipts, and the brief marks each. The price check settles it at the payable.
2. **The orderer is read by date** (amends #7). A month's employee, when none was chosen on this page, is the orderer the supplier had at that month's end, not whoever holds it today, so changing an orderer leaves the past alone. `SupplierOrderersService.set` writes `supplier_orderer_history` (procurement's table); the orderers standing at the migration are its first rows. For the months before a supplier's first orderer, that first orderer stands, because those months hold no other name. The carry-forward of an employee chosen here is unchanged.
3. **Who chases suppliers reads and writes here by default** (amends #9). PROCUREMENT holds `ebarimt.check.read` and `.edit`. ADR-0168 #9 already says so because commit `4f08e500` changed it in place, which an Accepted ADR's text should not be; the text stays as it now reads and this item is the record of the change.
4. **What the history notes** (amends #10). A month's first file is each supplier's first reading (`INIT`, not shown while it is alone). After it, a total rising from nothing is a change like any other, shown with its reason. Taking a file away is `REMOVE`. A link notes only the suppliers it can move. An employee's changes show in the months after them as well, since a choice carries forward. A register changed on the supplier's own record is noted only at the month's next file, because nothing here runs when that record is saved.
5. **The file is read in the API request**, an exception to the worker of ADR-0036. It is one file a month of at most 5 MiB and 20,000 lines (`EBARIMT_FILE_LIMIT`), read before any transaction opens, and the person is waiting for the answer. It moves to a pg-boss job if a stall is ever seen.
6. **A line that cannot be read refuses the file.** The required heads are «ТТД», «Огноо» and «Нийт дүн». A blank total, an error cell (a register's too), a formula Excel never worked out, a day that does not exist, an amount of 1,000,000,000,000 or more, or an amount written as text in anything but digits, commas grouping thousands and at most two decimals («1234,56», «1.234») refuses the file, naming the row, instead of counting as nothing, as another amount or in another month. e-Barimt's own export holds number cells throughout, the eleven files carried over included.
7. **An exempt amount is 0 or more**, up to 12 digits and 2 decimals. The old page took a negative number; nothing in the eleven months carried over holds one. A minus typed in the cell keeps it open and says so, since the money field would otherwise drop the sign and save the opposite amount.
8. **Two people at one cell never overwrite each other** (the owner's rule of 2026-10-30, the model of ADR-0118; extends ADR-0168 #6, which covered two cells). Every value written here names what its cell showed when typing began (`previousExemptAmount`, `previousNote`, `previousRegisters`, `previousPhone`, `previousRemark`, wanted with the value); under the row's lock a difference answers 409 `EBARIMT_CELL_CONFLICT` with the value there now, nothing is written, and the page reloads so the colleague's value shows. A receipt already linked is undone first, never taken over: a second link is counted in `skipped` and said. An employee chosen is not compared, since a choice is one click, the history keeps every one, and a bulk choice has no one previous value.
9. **Undoing a link from the list of links asks first**, naming the register, the amount and the supplier, as the old page did. On a supplier's own lines it stays one click with a toast.
10. **The logs only grow.** `supplier_orderer_history` is the only record of who held a supplier in a past month, and `ebarimt_check_history` of how a month moved, so role app holds no UPDATE, DELETE or TRUNCATE on them (migration `0087_ebarimt_history_guard`), as other logs (`0000_foundation`).

## Consequences

**Positive.** A month's figures and names stay put when something later changes. A figure not yet settled is visibly so. A bad file is refused rather than quietly counted.

**Negative.** The orderers' history starts on the migration day, so past months show the orderer of that day; the real past is unknown. A pending receipt's figure can move at the price check, by up to the note's own error. A file of 5 MiB holds one API request for its parse.

## Related

ADR-0036, ADR-0115, ADR-0168, `docs/modules/ebarimt-check.md`, `docs/modules/procurement.md`.
