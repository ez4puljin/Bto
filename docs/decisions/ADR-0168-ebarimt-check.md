# ADR-0168: «Ebarimt»: a month's purchases against e-Barimt

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-07 |
| Deciders | Owner («https://bto.puljika.site/ebarimt энэ цэсийг судалж bto системд шинэ цэс болгон оруул», 2026-11-07, without further questions), Claude (the direct-mode session) |
| Migration | `0084_ebarimt_check` (new module `ebarimt-check`) |

## Context

The old system's «Ebarimt» page shows, per supplier and month, what was bought against what the supplier entered into e-Barimt, so staff can chase what is missing. It worked from monthly Excel files: `Data` (the supplier list with registers and each one's employee), an income file and an e-Barimt export, each for the two branches.

Bto has the suppliers and the receipts. Kharkhorin runs its own Bto (ADR-0084).

## Decision

1. **Purchases are never imported.** A month's figure is the sum of the supplier's posted goods receipts, read on every request, with the same payable the receipts list shows (`ReceiptsService.postedBetween`). A receipt falls in the month of its delivery note's date, else its posting's, as the receipts list files it. Clicking the figure lists those receipts in brief; each opens the receipt itself.
2. **One e-Barimt file a month, nothing else.** No `Data` file and no second branch. The month comes from the file's own dates, so a file cannot land in the wrong month; a file with two months, or a line that cannot be read, is refused with the reason. A new file replaces the month's, the old one stays with its rows (`REPLACED`), and taking a file away (`REMOVED`) deletes nothing.
3. **The list is the supplier list.** Every active supplier has a row whether or not anything happened, and an inactive one while it has figures. Nobody prepares it.
4. **Which accounts count is a setting of this page** (`ebarimt_check_accounts`, codes in the chart). None chosen means the key AP's account, the old rule (the income file's lines were all кт:310101). The choices are the accounts a receipt may name (ADR-0154). A receipt on another account stays in the brief, marked as not counted, so the figure can be explained.
5. **Registers match by the same rule as the old page**: «7100001;7100002», «7100003 .7100004»; `normalizeTaxId` and `splitRegisters` in `@tugeel/shared/ebarimt-check`. A supplier's registers are its `reg_no` and `tin`, unless typed on this page. A register on two suppliers shows on both, as it always did, and is flagged on each; a receipt linked to a supplier counts there only.
6. **What people write here stays here.** A register, phone or remark typed on this page goes to `ebarimt_check_supplier_profiles`; the supplier's record is untouched. The exempt amount and note are per supplier and month. Every cell saves alone, so two people at two cells do not overwrite each other.
7. **An employee chosen here leaves the supplier's orderer alone** (owner: «системийн нийлүүлэгчийн хариуцсан ажилтанг өөрчилдөггүй байна»). A row in `ebarimt_check_assignments` holds from its month on, until the next one; the months before keep theirs. NULL returns to the orderer. It carries forward because there is no longer a monthly `Data` file to carry it, and nobody should have to choose again every month. The old page kept a free-text list of names; here it is the staff list.
8. **A consolidated view adds months**: the months with a file by default, chosen one by one or by year and quarter, last December among them. It shows who held a supplier how many months and each month's figures in the drill-downs. Amounts and notes are written month by month, as before.
9. **The rights are their own** (`ebarimt.check.read`, `.edit`, `.assign`, `.settings`), since the page shows cost data to whoever reads it. ADMIN holds all; ACCOUNTANT reads, writes and sets the accounts; choosing an employee stays with ADMIN, as on the old page, until a role is given it.
10. **Nothing here moves money or stock.** It posts nothing. Its history (`ebarimt_check_history`) keeps e-Barimt's total as it changes and the changes made by hand. Purchases have no history: they are the receipts, which are immutable once posted.

## Consequences

**Positive.** No file to prepare but e-Barimt's. A figure leads to its document. The old page's figures were matched: on the 2026-11-07 carry-over, every supplier both systems hold showed the same e-Barimt, exempt amount and note in all eleven months.

**Negative.** Until receipts are entered in Bto, past months have no purchases, so they read as over-entered. A register shared by two suppliers counts on both rows, so the foot of a list holding both can exceed the file's total, as on the old page; the flag says where. A retired account chosen earlier stays on the settings list by its code alone.

## Related

ADR-0084, ADR-0115, ADR-0154, `docs/modules/ebarimt-check.md`.
