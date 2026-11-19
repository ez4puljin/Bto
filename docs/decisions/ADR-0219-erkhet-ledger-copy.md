# ADR-0219: Erkhet's receivable and payable transactions are copied into Bto's books until go-live

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «Bto has no sales of its own, so put the Erkhet transactions into Bto, under the customer's name»; the opening balance from Erkhet; every day until the move is done, with a button; a click on a copied transaction opens Erkhet; accounts 120101 and 310101 from 2026-10-01; Bto's own receipts of 2026-11-16 «are in Erkhet too»), the brain (the brief), Claude (the bto-core worker) |
| Migration | `0112_erkhet_ledger_copy` |
| Amends | ADR-0077 (Decision 3 and «no Erkhet bridge»: nothing is exported to Erkhet still, but until the go-live day Bto's books hold a copy of two of Erkhet's accounts); ADR-0203 (#5 and the invariant «a check changes nothing in Bto»: that holds for the check of customers and items; the copy described here posts documents); ADR-0102 #6 and ADR-0200 (the opening import on the go-live day, see Decision 9) |

## Context

Until the cut-over the wholesale side sells in the old system, which feeds Erkhet. Bto's books hold almost nothing of the customers' receivables and the suppliers' payables, so the customer ledger, the balances and the settlement SMS (ADR-0216) show zeros while the real figures are in Erkhet. The owner wants Erkhet's transactions on its accounts 120101 (customer receivable) and 310101 (supplier payable) in Bto under each party, kept up every night, and the balance before October taken from Erkhet.

Erkhet has no API. What the brain verified on the live Erkhet on 2026-11-17, read-only, through the owner's signed-in browser:

- `GET /{company}/transactions/?date1=&date2=&account=<Erkhet's internal account id>&page=N` answers an HTML page of the general journal, 100 lines a page, newest first, only that account's lines. A page past the end answers 200 without lines.
- The rows stand in an inline script, `var items = [ … ];`: a header object (`is_ptr`, `tr_id`, `ptr__id`) followed by that transaction's lines (`description`, `debit_text`, `credit_text`, `full_code`, `date`, `bill_number`, `customer` as «код - нэр»). A line has no id of its own.
- The internal account id is not the code: `GET /{company}/transactions/get-filter-form/?main_text=Ерөнхий журнал` (as a background request) answers `{"content": "<html>"}` whose `<select name="account">` maps them.
- `GET /{company}/transactions/get-ptr-actions/?tr_id=` answers `update_url`, the address that opens the transaction, and `delete_url`.
- From 2026-10-01 about 62 pages (6,200 lines); the whole history before it about 435 pages.

No code reaches the live Erkhet from development, so everything here was built against a scripted Erkhet and the first real run cannot be tried beforehand.

## Decision

1. **What is copied.** Every line of Erkhet's general journal on the two accounts dated from the start date, and each party's balance on each account before that day. The account codes (`120101`, `310101`) and the start date (`2026-10-01`) are settings of the feature (`erkhet_ledger_settings`, changed on the page by `erkhet.settings.manage`), with those defaults. Erkhet's account code says which Erkhet list is read; in Bto the party line posts by the posting keys `AR` and `AP`, that is on Bto's own receivable and payable accounts.

2. **Erkhet stays read-only.** After the sign-in the client sends GET requests only. Of a transaction's actions only `update_url` is read; `delete_url` is never kept or requested, and an `update_url` that holds «delete» or leaves the company's path is dropped.

3. **A transaction is a document.** A copy is keyed by Erkhet's account code and transaction number (`120101:13659251`); its lines are told apart by their order within the transaction on that account. In the books it is a document of type `ERKHET.TR` (class JOURNAL): each line with an amount on the receivable or payable account under its party and on the side Erkhet shows, and the other side on one clearing account, «Эрхэтээс хуулсан гүйлгээний тохируулга» (`390102`, posting key `ERKHET_CLEARING`; the journal list names no counter account). The document's number is Erkhet's «Баримтын дугаар», or its «Ажил гүйлгээний дугаар» when there is none; its date is Erkhet's.
   - A party's opening balance is a document of type `ERKHET.OPENING` (class OPENING) dated the day before the start date, one per party and account, against the same clearing account.
   - The copies post **as source `BTO`**, not as a source of their own: the core knows a party by its source's ref (`customer:<id>`, `supplier:<id>`), and only under the same source do the copies and Bto's own documents meet in one balance. What keeps a copy from being taken for a Bto invoice or voucher is its document type (`ERKHET.*`) and its source document type (`ERKHET_TR`, `ERKHET_OPENING`, `ERKHET_ALLOCATION`), which no other code uses. The ledgers show such a line as «Эрхэт».
   - A customer is matched by Erkhet's party code on 120101, a supplier on 310101: the two code spaces are separate.

4. **A changed or deleted transaction follows.** Each run compares what Erkhet shows now (a hash of the date and of every line's party code, amounts, text and bill number) with what was posted. A changed transaction is reversed and posted again as the next revision (the intake accepts revision n + 1 only once n is reversed); one that Erkhet no longer lists is reversed. A reversal is dated the original's own day.

5. **A party Bto does not have is never made up.** A transaction with a line whose party code is not in Bto (employees, Kharkhorin, groups not taken, a line without a party) is left out whole, listed on the page per party code with Erkhet's name, its line count and amounts, and posted by the first run after the party exists. The same holds for an opening balance.

6. **Credits close debits oldest first.** Erkhet settles by balance. After a run's postings, a party's copied credit items are paired with its copied debit items oldest first, as documents of type `ERKHET.ALLOCATION` (at most 200 pairs each), so the open items, the overdue amount and the aging read as the balance does. Only items a copy opened are paired; an item of one of Bto's own documents is never touched. An item is due the day it is dated. Before a copy of a party is reversed its pairings are taken back, and made again afterwards: the books refuse to reverse a document while an allocation holds its item.
   - When one of **Bto's own** allocations holds a copy's item (a Bto receipt applied to it, an allocation by hand), the copy cannot be reversed: it is marked `BLOCKED`, counted on the page, and tried again every run. A person releases that allocation.

7. **Two steps, and an undo.**
   - «Шалгах» downloads, replaces what the tables hold of Erkhet and shows what a post would do: per account the opening, debit, credit and closing totals as Erkhet shows them, the counts to post, revise and reverse, the parties Bto lacks, and Bto's own documents on the two accounts. It posts nothing.
   - «Bto-д оруулах» posts what the latest check holds (the first post needs a check of the last 24 hours and downloads nothing itself). From then on the copy is «on»: the night's run (`erkhet.ledgerNightly`, 03:10) and a later press download and post in one go. Before the first post the night does nothing.
   - «Хуулсныг буцаах» reverses every copy and its pairings and turns the copy off; a new check and post start again with the next revisions.
   - A download that could not be read whole changes nothing. A post goes copy by copy, oldest first, each in its own transaction with the row that says it is posted; a run that dies is continued by the next, and the intake's key keeps a copy from posting twice. No request to Erkhet is made inside a transaction.

8. **A closed month.** Copies are posted oldest first, and closed months are always the earliest ones (ADR-0102), so a copy dated in a closed month is refused before anything later is posted: the run fails with `PERIOD_CLOSED` and the month. Nothing is moved to another month.

9. **Bto's own documents on the two accounts count twice, and a person decides.** Bto already holds documents of its own on these accounts (49 receipts of 2026-11-12 … 14), and the owner confirmed they are in Erkhet too. The check lists every such document (number, date, party, amount) and the total. «Bto-д оруулах» refuses while any stands unless the person chooses: «Эдгээрийг буцааж, Эрхэтийнхийг үлдээх» (each is reversed through its own service, `PaymentsService.voidInTx` or `JournalService.reverseManualInTx`, with that person's rights and audit, in the transaction that queues the run) or «Хэвээр үлдээх» (they are not in Erkhet). Nothing is chosen silently and no document is deleted. Other kinds (an invoice, a supplier bill, an opening) cannot be reversed from this page, and neither can a voucher or an entry that a bank statement line holds (ADR-0169): reversed here it would leave the line pointing at a void document, so it is taken back from «Банкны хуулга хаах», which opens the line again. With one of those in the list the first choice is refused (`NOT_REVERSIBLE`), the row says why, and the person settles it on its own screen first.
   - The list holds documents of any date, not only from the start date: one dated before it counts twice with Erkhet's opening balance in the same way.
   - «Хуулсныг буцаах» does **not** bring back documents reversed this way: they are posted again by hand if they are wanted.
   - The night's run cannot ask: it posts, and the page keeps showing the list while such documents stand.

10. **The go-live day (the trap of ADR-0102 #6 and ADR-0200).** The plan was one opening import of the full trial balance, receivables and payables per party included. With the copies in the books that would double both accounts. Decided: **the copies stay, and the opening import's rows on these two accounts go to the clearing account instead of the party accounts**, as its inventory rows already go to the opening-stock account (`TO_OPENING_STOCK`). The clearing account then holds «minus the copies» from the copies and «plus Erkhet's trial balance» from the opening, so it drains to zero when the two agree, and anything left is the difference to explain. The parties keep their history and their open items with the original dates. Until that importer change is built, an opening import that names these accounts must not be committed while copies stand: «Хуулсныг буцаах» first is the manual way.

11. **The address of a copied transaction.** The path differs by journal, so it is asked transaction by transaction after a run has ended, newest first, with a pause between requests and at most 1,500 a run; missing ones are filled on later runs. `GET erkhet/ledger/links` gives a ledger row its address: the transaction's own page, or until that is known the journal list filtered to that day and account.

12. **Rights.** `erkhet.sync.read` reads the page, `erkhet.sync.manage` starts a check, a post or a revert, `erkhet.settings.manage` changes the accounts and the start date. Reversing Bto's own documents also needs the right their own screens ask. The addresses (`GET erkhet/ledger/links`) ask `finance.read`, the right of the ledgers that show them. A post and a revert are audited when they are started (as the person) and when they end.

13. **Module order.** `erkhet` now depends on `fin-bridge` (the only way it reaches the books: `FinErkhetBooks`, as source BTO) and on `finance` (to reverse Bto's own vouchers and entries). Nobody imports `erkhet`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A side list of Erkhet's transactions beside the ledger | The owner wants them in the party's balance: the statement and the SMS read the books |
| A source system `ERKHET` of its own | Its parties would be other parties than Bto's: the balances would not combine without linking every ref by hand |
| Reusing `FIN.*` or `BTO.*` document types | The ledgers would show a copy as a Bto invoice, voucher or manual entry and link to a Bto document that does not exist |
| Leaving the copied items open, unpaired | The balance would be right, but every customer would show its whole turnover since October as overdue |
| Pairing inside each posting (`settles: FIFO`) | A JOURNAL may not settle, and a pairing made by the copy's own document cannot be taken back without reversing the copy |
| Reading the opening from Erkhet's «Авлага өглөг ЭҮ» screen | Not studied; the journal list is the one source both for the opening and for the turnover, so they cannot disagree |
| Reversing all copies on the go-live day and importing the opening per party | Loses the history and the dates of the open items on the day they matter most |
| Reversing Bto's own documents automatically | They are money documents entered by a person; only a person says they are duplicates |

## Consequences

**Positive.** The customer and supplier ledgers, the balances, the aging and the settlement SMS show Erkhet's figures the morning after, with a way from each line to its transaction in Erkhet. A wrong first run is undone with one press.

**Negative.**
- Bto's books hold a clearing account whose balance is the mirror of two control accounts until the go-live day; the trial balance of Bto is not a real one before then.
- Erkhet is read through its pages. A change of the journal page fails a run (`UNEXPECTED_PAGE`, `ACCOUNT_NOT_FOUND`), never silently: a line of another account or of a day outside the asked range stops the run, and the first page is read once more at the end and the read repeated when it moved.
- The first post writes about 8,000 documents (some minutes); the first check reads the whole history once (about five minutes at 700 ms a page).
- A transaction with lines for several parties is left out whole when one of them is not in Bto.
- Credit control reads these balances: a customer's overdue amount in Bto is now Erkhet's.

**TODO-VERIFY.**
- Whether Erkhet's own entered opening balances («Авлага өглөг ЭҮ», `/debt/fb/`) appear in the journal list. The page shows, per account, the opening, debit, credit and closing totals and per party the closing balance, so the accountant holds them against Erkhet's «Авлага өглөг» report before the first post.
- The table form of the journal page was not seen: the reader takes the script, and falls back to a table whose columns it finds by their headings («Огноо», «Дебит», «Кредит», «Харилцагч», «Баримтын дугаар», «Гүйлгээний утга»).
- Whether Erkhet ends a session when the same name signs in again; the two nightly jobs are an hour and a half apart for that reason.
- The clearing account's code on the real chart. The account is found by its posting key, never by its code. Migration 0112 leaves a key that already has a rule alone; otherwise it creates the account on `390102`, or, when another account holds that code, on the next free code up to `390199` (with a notice naming it), and fails loudly when none is free. An account of another name is never reused. A chart that is empty takes the account from the chart template at the next boot.
- Whether Erkhet repeats a transaction's header when a page begins inside it. The reader takes both: lines without a header at the top of a page join the last transaction of the page before, and the run fails (`UNEXPECTED_PAGE`) when they have none to join or name another transaction number.

**Follow-ups.**
- The opening importer (`fin-opening.importer.ts`): rows on the receivable and payable accounts go to the clearing account while copies stand (Decision 10). Not built here: the file belongs to `imports`.
- The page has no form for the copy's settings yet (`PATCH erkhet/ledger/settings` exists): the defaults are the owner's.
- A guide article for the accountant once the first real run has been made.

## Related

ADR-0071, ADR-0072, ADR-0077, ADR-0090, ADR-0091, ADR-0102, ADR-0200, ADR-0203, ADR-0216, `docs/modules/erkhet.md`, `docs/modules/fin-bridge.md`, `docs/modules/finance-core.md` §5, §6, docs/architecture.md §4.
