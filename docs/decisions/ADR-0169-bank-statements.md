# ADR-0169: «Банкны хуулга хаах», the bank's statements filled line by line and written to the books

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-07 |
| Deciders | Owner («https://bto.puljika.site/bank-statements цэсийг судалж ойлгож Bto-д шинэ цэс болгон оруул», 2026-11-07, asleep: no questions, recommended defaults decide), Claude |
| Amends | ADR-0083 (the bank import moves from "after go-live" to now); ADR-0077 #6 and ADR-0080 keep the rule that a statement match may record a payment |
| Renamed | Owner, 2026-11-07: the page was first «Тооцоо хаах», the old tool's name; on screen it is «Банкны хуулга хаах». Route, tables and code names unchanged |

## Context

The accountant closes the day in the owner's older system, Butenorgil, on its menu «Тооцоо хаах» (`/bank-statements`): the bank's Excel files per account and day, a table where each line gets its party, counter account, text and action, and three Excel files for Erkhet's own import. Bto replaces Erkhet on the go-live day, so the same work has to end in Bto's books, but until that day it must still reach Erkhet. The old code was read (`backend/app/api/bank_statements.py`, `frontend/src/pages/BankStatement.tsx`) and its screens and data looked at in the owner's signed-in Chrome, read-only.

## Decision

1. **A new page «Санхүү → Банкны хуулга хаах»** at `/finance/bank-statements`, with the old tool's two tabs: «Календар» (a month with the days that hold statements, the day's statements as cards with how far each is filled and what it lacks, one statement's lines to work on) and «Тохиргоо». An open statement takes the whole width: its lines need it, and the day's other statements stay as chips above it.
2. **Upload.** Files come through the private file kind `finance.bank_statement` and are read at once (`parseBankStatement`): the account and the currency from Khan Bank's file name `Statement_<MNT>_<number>`, the columns by their header words (the bank has swapped debit and credit before), every dated row with an amount; the totals row has no date and falls away. A statement is dated by the first day of its lines, whichever day is open on the screen. `dedupe_key` (sha256 of the account, the row and its occurrence in the file) makes a re-upload harmless: a file seen whole adds nothing, a later file of the same day adds a statement of its new lines only. The old tool had no such guard.
3. **Kinds.** A line is `NORMAL`, `FEE` or `SETTLEMENT`. Only money out is a fee, and only money in a settlement. The old tool called any line with the words a fee, so a customer paying «үйлчилгээний төлбөр» was lost as a bank charge; `\bfee\b` also keeps «coffee» out.
4. **The bank account.** A statement's money account is the accountant's link, else the number on the account («Дансны дугаар»), else the number in its name. An unknown number shows «Бүртгэлгүй данс» with a choice of the bank accounts, kept on every statement of that number. It cannot be written to the books until then, nor can a statement in another currency. The old tool's «Хадгалсан данс» list is not copied: Bto's money accounts are that list.
5. **The rules** (`bank_statement_settings`, one row, absent until saved): the settlement's and the fee's counter account, text and action, the fee's Erkhet file, the accounts offered first in «Харьц. данс», and Erkhet's general party code for a line without a party. Until saved they start from the old tool's values: settlement `120105` else the role `CARD_CLEARING`, fee `703012` else `OTHER_EXPENSE`, party `30000`. Saving fills every open fee and settlement line again, so the old «дахин хэрэглэх» buttons are not needed. Those lines stay locked on the table.
6. **Erkhet's files stay until Erkhet stops.** `RECEIVABLE` (money in), `CASH` and `BANK` (money out by the line's «Экспорт»), per statement and per day, with Erkhet's exact headers, and the fees of a period summed per day and account. The date column has the built-in Short Date on the cells, the header and the column, as the old tool found Erkhet needs (`common/excel/erkhet-workbook.ts`). A settlement keeps the old layout: the date in its text, the bank in «Харьцсан данс», the clearing account in «Дансны код». Action as in the old tool: `CLOSE` and `CREATE` 1, `CLOSE_CREATE` 2. The old tool's Excel re-save on the server is left out: it needs Excel on the server and has no equivalent on Linux.
7. **«Дэвтэрт бичих» is new: the same lines reach Bto's books.** `POST /finance/bank-statements/:id/post` (`finance.journal.manage` and `finance.payments.record`) writes every ready line, each posting unit in its own transaction, so one refused line (a closed month, an inactive customer) leaves the others in and is listed with its reason.
   - Money in on the receivable account (role `AR`) with a customer and an action other than `CREATE`: a `CUSTOMER_PAYMENT` voucher through `PaymentsService.recordInTx`, settling the oldest invoices first, the rest the customer's open credit (ADR-0060 #5). This is the statement match CLAUDE.md allows.
   - Every other line, `CREATE` included: a manual journal entry on the statement's bank account against the line's counter account and party (`JournalService.postManualInTx`), which also leaves a supplier's payment to be paired on «Нийлүүлэгчийн тооцоо» as today (ADR-0091).
   - A statement's fees of one day: one entry, as the old fee export summed them.
   - The line is locked `FOR UPDATE` first and marked in the posting's transaction; its source key is `bank-line-<id>-<attempt>`. So it is in the books once, however many presses meet: a late press finds it posted and passes over it.
8. **Taking back.** `POST …/lines/:lineId/reverse` reverses the document itself (the voucher's void, the entry's reversal, dated today), gives the invoices their amounts back, opens the line (with the fees of the same entry) and raises `post_attempt`, so the next posting is a new document. A statement with a line in the books cannot be deleted or swapped; a trigger keeps such a line in the table whatever the code does.
9. **What saves the accountant's time, beyond the old tool:** at upload a line takes the customer of an invoice number in the bank's text (money in only), else the party and account chosen last for the same counterpart and direction. Naming a party with no account yet takes the receivable or payable account. Nothing is posted until «Дэвтэрт бичих» is pressed, and the page says how many lines it will write.
10. **Rights.** No new right. Reading with `finance.read`; uploading, editing, the rules and the file kind with `finance.journal.manage`, which the accountant holds; writing to and taking back from the books also needs `finance.payments.record`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Copy the tool as it is, Excel for Erkhet only | Leaves Bto's own books empty of the day's bank money on the go-live day, and the accountant typing it twice |
| Posting only, no Erkhet files | The accountant closes the real books in Erkhet until go-live; the old tool would have to stay |
| A `bank_statement` module of its own | Its only partners are finance's services; `modules/finance` is what becomes `billing` and `fin-bridge` at H1, and a new module would import finance only to reach them |
| Write through `AccountTransactionsService` | It takes a money account by the GL account's first box and opens its own transaction: a line's lock and mark could not share it |

## Consequences

- **TODO-VERIFY, the accountant:** (a) a settlement is booked in Bto on the day the bank shows it, while Erkhet's file keeps the day in its text, so the bank account agrees with the statement line by line; (b) money between two of the company's own accounts appears on both statements: posting both counts it twice, so the accountant should write one side against the other account and leave the other line unposted, or use a transit account, and this is not automated; (c) whether a fee's one entry per day suits the books; (d) whether Erkhet takes ExcelJS's files without Excel's re-save, which only the first real import shows.
- On `bto_main` every bank money account has an empty «Дансны дугаар». Most carry the number in their name and are recognised; an account named without one (a mobile bank account) needs its number or one link.
- `JournalService.postManual`, `reverseManual` and `PaymentsService.void` gained `…InTx` forms; the old ones call them, unchanged.
- Whatever a line's «Гүйлгээний утга» says reaches the store's «Тооцоо» in «Bto300» (ADR-0167 #6).

## Related

ADR-0018 #6, ADR-0060, ADR-0077, ADR-0080, ADR-0083, ADR-0091, ADR-0148, ADR-0167, `docs/modules/finance.md`, `docs/SPEC.md` §5.8.
