# ADR-0106: The accountant questionnaire's suggested answers adopted as the owner's decisions

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-24 |
| Deciders | Owner («Нягтлангийн асуулгын санал болгосноор бүгдийн шууд хий», 2026-10-24, and two rounds of questions the same day), Claude (Claude Code worker session started by «Bto удирдлага») |
| Decides (open to the accountant's correction) | `docs/modules/finance-core.md` §18 D6, D8, D9, D15, D16 (codes), D24, D25 (tax point), D26, D27, the reversal date, write-offs, the closing entry and income tax; SPEC §11 #32–#34, #36, #37, #39–#44, #46 |
| Leaves open | D17 (statements, VAT-return rows), the e-Barimt compare (D25's second half), Erkhet's export facts (questionnaire 2.8), fixed assets (5.5–5.6), D12 (the hotel) |
| Amends | ADR-0097 (an admin-added expense type gets its own account), ADR-0102 (the opening is dated a month's last day) |

## Context

The accountant questionnaire («Нягтлан бодогчид: Bto санхүүгийн асуулга», a Claude Doc written 2026-10-20) asks the accountant 1.1 … 5.6 in six sections. Each question that had one carries «Манай санал», the rule Bto follows until the accountant answers. The accountant has not answered yet.

On 2026-10-24 the owner decided to adopt every suggestion now as the owner's own decision. The accountant may still correct any of them; a correction becomes a superseding ADR.

Several suggestions were written before F3, F4 and F6 were built. In those phases the owner made explicit, later decisions on the same points. **A later explicit decision of the owner wins over a questionnaire default**: the code keeps it, and the conflict is listed below for the owner.

Questions without a suggestion (1.4, 1.6, 3.1, 3.2, 3.5, 3.6, 5.5, 5.6) were put to the owner in two rounds on 2026-10-24.

## Decision

1. **Every suggestion is adopted** as the table below says. Each listed D item is now *decided by the owner, open to the accountant's correction* (`finance-core.md` §18, SPEC §11).

   | Q | Suggestion adopted | D / SPEC §11 | Bto today | Result |
   |---|---|---|---|---|
   | 1.1 | COGS once a day per warehouse | D8 / #33 | per document, at once (ADR-0097, owner 2026-10-22) | **conflict: F4 kept** |
   | 1.2 | perpetual inventory | D8 | perpetual | as built |
   | 1.3 | Dr goods, Dr input VAT / Cr payable; a cash or bank receipt Cr cash or bank | D8 | goods received 310201 clears with the bill (ADR-0097); a CASH or BANK receipt books the bill only and the payment is a manual entry (ADR-0091, owner 2026-10-20) | **conflict: F3/F4 kept** |
   | 1.5 | a supplier return lowers the payable by the return document's amount | D8 | at the average cost plus the supplier's VAT, automatically (ADR-0091, owner 2026-10-20) | **conflict: F3 kept** |
   | 1.7 | transfers between warehouses are not journaled | D8 | value-neutral (`bookKindOf` null) | as built |
   | 1.8 | a customer return comes back at the current average | D8 | the same | as built |
   | 1.9 | a re-costing's variance in the month it is corrected | D8 | dated the costing day | as built |
   | 2.1 | Erkhet's chart as it is | D16 / #37 | the chart import (ADR-0102) | as built; the codes arrive with Erkhet's export |
   | 2.2 | 120101 receivable; the payable from the accountant | D16 | 120101; 310101 temporary | as built |
   | 2.3 | 100101 cash, 110101 bank, 100102 POS cash, 120301 card clearing | D16 | the same | as built |
   | 2.4 | today's codes are Erkhet's same accounts | D16 | — | assumed |
   | 2.5 | the opening is the full trial balance | D27 / #42 | FIN_OPENING (ADR-0102) | as built |
   | 2.6 | Bto starts on a month's 1st | D27 | any date up to today | **built (#5)** |
   | 2.7 | the opening is reconciled per account × party and signed | D27 | nothing | **built (#5)** |
   | 3.3 | the VAT tax point is the document's date | D25 / #40 | the entry's accounting date = the document's (ADR-0105) | as built |
   | 3.4 | a monthly compare list with e-Barimt | D25 | — | **later (#2)** |
   | 3.7 | only the latest closed month reopens, with a reason | — | exactly that (ADR-0102 #2) | as built |
   | 4.1 | an overpayment or advance is a credit on the receivable | D6 / #32 | the same (ADR-0060) | as built |
   | 4.2 | no VAT on a customer advance | D6 | the same | as built |
   | 4.3 | discounts with the VAT inside | D9 / #34 | the same | as built |
   | 4.4 | the daily `Н-` numbers are legal invoice numbers | D15 / #36 | the same | as built |
   | 4.5 | wholesale revenue at the «Борлуулалт» stage | D24 / #39 | the same | as built |
   | 4.6 | receivables at company level, the branch on every line | D26 / #41 | company level; no branch on the lines | **built (#4)** |
   | 4.7 | a reversal is dated the correction day | #43 | voids and reversals are dated today, never before the original | as built (see #6) |
   | 4.8 | no automatic write-off until a policy exists | #44 | none exists | as built |
   | 5.1–5.4 | the manual stopgaps after go-live: assets in Excel with monthly depreciation entries, bank lines by hand, manual entries posted at once with their audit, payroll by manual entry | #46, ADR-0083 #4 | as planned | accepted |

2. **The owner's answers to the rows without a suggestion (2026-10-24):**
   - 1.4 goods-issue expense accounts: keep F4's account per seeded type; a type the admin adds gets its own account picked on screen (#3).
   - 1.6 adjustments and stocktakes: no preference, so F4 stays (a shortage is an expense on 740201, a surplus income on 511030; TODO-VERIFY D8).
   - 3.1–3.2 the statements СТ-1…СТ-4 and the VAT-return rows: not now. D17 stays open.
   - 3.4 the VAT compare with e-Barimt: built with the e-Barimt module (ADR-0065), since no receipt is issued yet.
   - 3.5 the closing entry: once a year, as F6 built it (ADR-0105 #4).
   - 3.6 income tax: the accountant's manual entries.
   - 5.5–5.6 fixed assets: nothing for now.
3. **An admin-added expense type's account** (questionnaire 1.4; amends ADR-0097):
   - **Seeded types.** They keep F4's keys `ISSUE_*` and accounts 730201–730205. Their account moves with the role on «Данс».
   - **Other types.** A type the admin adds (or SUPPLIER_RETURN issued to someone who is not a supplier) books to `ISSUE_OTHER` (730209) until finance gives it an account.
   - **The mapping.** The account is picked in «Санхүү → Данс → Зарлагын төрлийн данс» (`PUT /finance/issue-expense-accounts/:typeId`, `finance.settings.manage`). The core creates the posting key `ISSUE_TYPE_<id>` (`FinChartService.defineKeyInTx`, control NONE) with a company-default rule from today. Null sends the type back to «бусад».
   - **Posting.** The stock journal of a goods issue uses that key when it holds an account on the posting's date, else `ISSUE_OTHER`. Inventory's `StockBookLine` carries `issueTypeId`.
4. **The branch on every line** (questionnaire 4.6, D26):
   - **Receivables.** They stay at company level: no branch balance sheet, no inter-branch lines.
   - **The tag.** Every Bto posting carries `body.branch` (the Bto branch id), and the core writes it on the document and on every line it writes. A reversal keeps the original's branch.
   - **Where the branch comes from.**
     - An invoice: its own branch (the board's, else its warehouse's).
     - A credit note: its invoice's branch.
     - A voucher, including the POS hand-over: its money account's branch.
     - A supplier return: the issue's warehouse.
     - A stock journal, a revaluation or a supplier bill: the one branch all its warehouses share. When they span several, or pass through TRANSIT, the document has no branch.
     - A POS shift's close entry: the edge node's warehouse.
   - **Company-level documents.** Allocations, manual entries, the opening and the year close carry no branch.
   - **The core's side.** A branch ref resolves to the calling source's own ref, else the one branch a source of the company knows by that id (`branchOfRefInTx`). So vouchers of the core's screens (source FIN) can carry Bto's branch. The façade `FinJournalPosting` takes the same `branch`.
   - **A new branch.** A branch added after boot is mapped on its first posting (`FinPosting.branchRefInTx`); a closed branch tags nothing.
   - **Old rows.** Documents posted before this keep no branch; nothing is re-posted.
5. **The opening** (questionnaire 2.6, 2.7, D27; amends ADR-0102 #5):
   - **Its date.** Bto starts on a month's 1st, so the opening is dated the last day of the month before. The import refuses any other date with the row error `NOT_MONTH_END`. The imports page asks for «Bto ашиглаж эхлэх сар» and shows the opening's date.
   - **Its sign-off.** «Санхүү → Эхний үлдэгдлийн тулгалт» (`GET /finance/reports/opening-check[.xlsx]?date`, `finance.read`; `/finance/opening-check/print`):
     - every non-zero balance per account × party at the date, the party as the Bto customer or supplier with its code;
     - account subtotals and the totals;
     - on paper, a statement that it matches Erkhet's closing trial balance, with signature lines for the accountant and the owner;
     - the date defaults to the live opening's, else the previous month's last day.
   - **The core's read.** `FinReports.accountPartyBalances` (under `posting/`).
6. **The reversal date** (questionnaire 4.7): the rule stands as built.
   - Voids and reversals are dated the correction day and never before the original.
   - The revert of an opening import and of a year close keeps its own date. They undo a setup document, not correct an error.
7. **No migration.** The keys `ISSUE_TYPE_<id>` are created at runtime, and the branch columns already exist (ADR-0070 #4). Migration `0045`, reserved with this ADR, is not used.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Follow the questionnaire where it differs from F3/F4 (a daily COGS batch, supplier returns at the document's amount, cash receipts crediting cash) | The owner chose those rules explicitly in F3 and F4, after the questionnaire was written; a later explicit decision wins. The accountant can still change them. |
| A fixed set of spare `ISSUE_*` roles for admin types | It caps the number of types and needs a migration per new set; a key per type is created by the core when the account is picked. |
| Let a Bto posting name its account by code (`accountCode`) | The contract keeps account codes to source FIN (ADR-0071); a key with a rule keeps the mapping in the core's configuration. |
| A branch per line from each line's warehouse | The core stores one branch per document (ADR-0070 #4). A document spanning branches carries none rather than a wrong one. |
| Re-post the old documents with a branch | A bulk rewrite of the books; the owner asks before any. Old rows stay untagged. |
| An opening on any day | The suggestion (2.6): a month's reports stay whole when Bto starts on its 1st. |

## Consequences

**Positive.**
- Twenty-odd open accounting questions now have a rule the owner owns, and the accountant can still correct each one.
- The trial balance can be split by branch later from the lines alone.
- The accountant gets the opening's sign-off sheet in the format the go-live needs.

**Negative.**
- Three rules differ from what the questionnaire proposes (1.1, 1.3, 1.5). The accountant must be told they follow F3/F4.
- Documents spanning branches carry no branch.
- A branch added after boot is mapped inside its first posting's transaction. Two first postings at the same moment would collide on the mapping's unique key, and one of them would be retried by the user.

**Follow-ups.**
- D17: the statements.
- The e-Barimt compare, with the e-Barimt module.
- Fixed assets, after go-live.
- The questionnaire doc says the suggestions were adopted.

## Related

ADR-0060, ADR-0070, ADR-0071, ADR-0083, ADR-0091, ADR-0097, ADR-0101, ADR-0102, ADR-0105, `docs/modules/finance-core.md` §3.13 and §18, `docs/modules/finance.md`, SPEC §11.
