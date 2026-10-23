# ADR-0102: The Finance Core's month close, Erkhet's chart import and the opening import (F5)

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-23 |
| Deciders | Owner (one round of questions, all on the recommended options, 2026-10-23; the accountant's D16 and D27 not answered yet), Claude (Claude Code worker session of «Bto удирдлага», Finance Core F5) |
| Implements | ADR-0083 #3 (phase F5), ADR-0075 #1–#3 as reduced by ADR-0083 #4 (close and reopen of the latest month, the event row, the two rights), ADR-0077 (Erkhet's chart and opening balances before go-live) |
| Amends | ADR-0075 #1 (the close's checklist is the end date, the order of months and the core reconcile; no soft close, override or pending list until after go-live), ADR-0083 (the opening is one or more OPENING documents per import, not one per company) |

## Context

Erkhet stops on the go-live day (ADR-0077). From then on Bto's books must:
- start from Erkhet's chart and its closing trial balance;
- let the accountant close a month that is done.

ADR-0083 cut P5 to the close and reopen of the latest month with a reason, plus the import of the chart and the opening. The accountant's questionnaire (D6–D27) has not come back, so defaults hold until it does.

The owner answered on 2026-10-23:
1. ADMIN and the accountant close and reopen.
2. A close needs the month ended, the earlier months closed and a clean reconcile.
3. Erkhet's chart export comes later from the accountant. Until then the import is tried on fictitious data only.
4. An optional «Үүрэг» column of the chart sheet moves a posting key's rule to the imported account.

## Decision

1. **Rights.**
   - `finance.periods.close` and `finance.periods.reopen` join Bto's catalog.
   - The ADMIN and ACCOUNTANT roles hold both. Other roles can be given them on «Дүр».
   - Per company, through `user_company_roles` (ADR-0084 #2).
   - `finance.periods.override` and the rest of ADR-0075's rights wait (ADR-0083 #4).
2. **The close** (`FinPeriodsService.close`, `POST /finance/periods/:code/close`):
   - **Refusals.** A month whose last day has not passed in the company's timezone is refused with `FIN_PERIOD_NOT_ENDED`. A month is also refused while an earlier month with a row is OPEN (`FIN_PERIOD_ORDER`). Finally it is refused when the core reconcile finds an item or ledger drift (`FIN_CHECKLIST_FAILED`).
   - **The reconcile.** `reconcileBooks` runs first in its own transaction. A cache drift is rewritten by that run and only recorded.
   - **The close itself.** It then takes the company's period lock exclusively and the month's row FOR UPDATE. A month without a row gets one, CLOSED.
   - **Records.** It writes a `fin.period_events` row (CLOSE, with the reconcile's runs in `checks`) and an audit row.
   - **Again.** Closing a closed month changes nothing.
3. **The reopen** (`POST /finance/periods/:code/reopen {reason}`):
   - Only the company's latest closed month can be reopened; another is refused with `FIN_PERIOD_ORDER`.
   - It needs a reason of 1–500 characters. A blank one is refused with `FIN_PAYLOAD_INVALID`.
   - It writes an event row (REOPEN, with the reason) and an audit row.
   - `fin.period_events` is append-only for every role (migration `0041_fin_close_opening`).
4. **A closed month refuses postings in-process.**
   - Every posting takes the company's period lock shared before it reads or creates its month (`openPeriodInTx`, advisory key 72_026_133). A close takes the same lock exclusively.
   - A posting that would create a month earlier than a closed one therefore never commits after that close. A close waits for postings already inside the month.
   - Nothing is held or moved to another month (the pending list waits, ADR-0083 #4).
5. **Erkhet's chart** (import kind `FIN_CHART`, `FinChartService.importChartInTx`):
   - **Rows.** One row per account by its code:
     - the name;
     - the kind (a code or «Хөрөнгө», «Өр төлбөр», «Өөрийн хөрөнгө» / «Эздийн өмч», «Орлого», «Зардал»);
     - the group (a code and a name, kept in the new `fin.account_groups`);
     - the control («Авлага», «Өглөг», «Урьдчилж авсан», «Урьдчилж төлсөн», «Мөнгө» — a clearing account is a money account of kind CLEARING, so «Клиринг» is MONEY);
     - the normal side (empty: from the kind);
     - «Үүрэг» (a chart role, its label or its posting key).
   - **Empty cells.** An empty control or group keeps the account's own.
   - **Rules.** A key in «Үүрэг» gets a rule from today pointing to the account. Its required control must match (`MISMATCH`). A key appears once per file.
   - **Accounts in use.** An account holding journal lines keeps its kind, side and control (`IN_USE`, `FIN_ACCOUNT_IN_USE`).
   - **Accounts not in the file** stay as they are.
   - **The revert.** Re-pointed keys go back while they still point to the imported account. Changed fields go back where they still hold the imported value. Created accounts and groups are deactivated when nothing holds them.
   - **Who.** Creating a FIN_CHART or FIN_OPENING import needs `finance.journal.manage` as well as `imports.manage`. A file with «Үүрэг» also needs `finance.settings.manage` (ADMIN holds all three).
6. **The opening import** (import kind `FIN_OPENING`):
   - **Rows.** Every row is one debit or credit line on an account by its code:
     - a receivable or advance received names its customer by code;
     - a payable or advance paid names its supplier by code;
     - each such line becomes its own open item with the original document's number, date and due date;
     - a money line names its money account;
     - any other line names neither.
   - **The date.** It comes from the import dialog: the day before go-live by default (TODO-VERIFY D27), today or earlier.
   - **Inventory.** A row on the account INVENTORY's rule points to (today) goes to OPENING_STOCK's account (390101, warning `TO_OPENING_STOCK`). The stock's opening import credits that account (F4), so it drains when Erkhet's inventory equals the stock's value.
   - **Balance.** The file must balance (`UNBALANCED` on its first row with the totals).
   - **Documents.** It posts as OPENING documents (class built in the intake, source FIN, type `FIN.OPENING` numbered from the journal series) of at most 499 rows. A document whose rows do not balance gets one line on the opening offset account that balances it; the file balances, so those lines cancel out. Keys are `FIN/OPENING/import:<id>:<n>`.
   - **One at a time.** Another file is refused while a live opening stands (`OPENING_EXISTS`).
   - **The revert** reverses each document on the opening's own date (the month must be open). A document already reversed by hand from «Журнал» is skipped.
   - **The cut-over** (default, TODO-VERIFY D27): import, compare with Erkhet's closing trial balance per account and per party, then close the month.
7. **Screens.**
   - «Санхүү → Сарын хаалт» (`/finance/periods`) has:
     - the months with their status and last event;
     - «Сарыг хаах» with a month field and a confirmation;
     - «Дахин нээх» with a reason, on the latest closed month only;
     - the history.
   - The imports page shows the two kinds to holders of `finance.journal.manage`. The opening's card asks for its date.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A close checklist that only warns, with an override | Override and soft close wait for after go-live (ADR-0083 #4); the owner chose a blocking reconcile. |
| Lock the month row only (`FOR UPDATE` against `FOR SHARE`) | A posting that creates an earlier month's row would not meet the close's lock and could commit an open month before a closed one. |
| One OPENING document per company, refused when a second is posted | The intake caps a document at 500 lines; one line per customer invoice exceeds it. One opening per import, chunked, keeps the contract. |
| Re-point the rules from the beginning of the books | It would change how earlier documents' rules resolve in the development database; a rule from the import day is enough at the cut-over, when nothing is older. |
| The accountant re-points the roles on «Данс» one by one | The owner chose the «Үүрэг» column. |

## Consequences

**Positive.**
- The accountant closes a month and the books refuse anything dated in it.
- A reopen leaves its reason.
- The chart and the opening come from files that can be fixed and imported again.
- An opening of any size posts.

**Negative.**
- Every posting takes one more (shared, transaction-level) advisory lock.
- A drift blocks the close until it is found.
- A rule re-pointed today does not reach documents dated earlier. Import the chart before trading starts on the go-live day.

**Follow-ups.**
- The accountant answers D16 and sends Erkhet's chart export. The temporary codes (F3, F4) are re-pointed then.
- D27 (the opening date and the sign-off).
- After go-live: soft close, override, the pending list, drafts and approval, fixed assets in the opening.
- F6: the statements read the groups.

## Related

ADR-0072, ADR-0075, ADR-0077, ADR-0083, ADR-0084, ADR-0089, ADR-0090, ADR-0091, ADR-0097, `docs/modules/finance-core.md` §3.11, §13, `docs/modules/finance.md`, `docs/modules/imports.md`.
