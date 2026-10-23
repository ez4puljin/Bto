# ADR-0105: The Finance Core's reports (F6): the trial balance, the month's VAT and the year close

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-23 |
| Deciders | Owner (one round of questions, 2026-10-23; the accountant's D17 and D25 not answered yet), Claude (Claude Code session, Finance Core F6) |
| Implements | ADR-0083 #3 (phase F6, reduced), ADR-0077 (the reports Erkhet gave before go-live) |
| Amends | ADR-0083 (F6 builds the trial balance, the VAT report and the closing entry; the statements СТ-1…СТ-4 wait for D17) |

## Context

When Erkhet stops on the go-live day (ADR-0077), the accountant still needs:
- the trial balance;
- the monthly VAT;
- the year's closing entry.

The accountant has not answered D17 (which statements and which forms) or D25 (the VAT tax point).

The owner answered on 2026-10-23:
1. Only the trial balance and the VAT report for now.
2. When the statements come, the accountant links their rows to accounts on a screen.
3. The year-end closing entry is one button.
4. Every report goes to the screen, to Excel and to print.

## Decision

1. **Reports in the core** (`FinReports`, under `posting/` because only `posting/**` reads the journal). Their users hold `finance.read` or a granted source.
2. **Trial balance** (`GET /finance/reports/trial-balance?from&to[&all]`, «Санхүү → Гүйлгээ баланс»):
   - per account: the balance before `from`, the period's debit and credit, the balance at `to` (debit − credit);
   - grouped by `fin.account_groups` (F5), with subtotals;
   - accounts without lines only when asked;
   - the totals must balance, and the screen says so.
3. **The month's VAT** (`GET /finance/reports/vat?period`, «Санхүү → НӨАТ-ын тайлан»):
   - **Lines.** Every line keyed VAT_OUTPUT or VAT_INPUT, or on the account those keys point to at the month's end (a manual entry, the POS shift).
   - **Grouping.** By source document type: sales invoices and returns, POS shifts, supplier bills, cost differences, supplier returns, manual entries.
   - **Amounts.** The VAT (output credit − debit, input debit − credit) and the base the lines carry. A line without a base (the POS shift, a manual line) is counted, and no base is guessed for it.
   - **Payable.** Output − input; a negative payable is carried forward.
   - **Documents.** Listed up to 2,000.
   - **Tax point.** The entry's accounting date (TODO-VERIFY D25). The rows of the official VAT return wait for D17.
4. **The year close** (`POST /finance/year-close/:year`, `.../revert`, `finance.periods.close`, on «Сарын хаалт»):
   - **The posting.** Every INCOME and EXPENSE account's balance up to 31 December is posted away against the new key `RETAINED_EARNINGS` (account 340101 «Хуримтлагдсан ашиг (алдагдал)», a temporary code, TODO-VERIFY D16).
   - **The documents.** `FIN.YEAR_CLOSE` documents (JOURNAL, source FIN, as the staff member) of at most 499 accounts plus that line, dated 31 December, keyed `FIN/YEAR_CLOSE/<year>.<attempt>.<n>`. Bto builds them, as it builds the opening (ADR-0102 #6).
   - **Refusals.**
     - The year has not ended: `FIN_PERIOD_NOT_ENDED`.
     - The year is already closed: `FIN_CLASS_RULE YEAR_CLOSED`.
     - There is nothing to close: `NOTHING_TO_CLOSE`.
     - December is closed: `FIN_PERIOD_CLOSED`.
   - **The revert** reverses on 31 December. A new close is the next attempt.
   - **Not posted by the close.** Income tax is a manual entry by the accountant (the method is TODO-VERIFY).
5. **Excel and print.**
   - `…/trial-balance.xlsx` and `…/vat.xlsx` are written by `tableWorkbook`.
   - `/finance/trial-balance/print` and `/finance/vat/print` are A4 pages in the print frame (ADR-0058).
6. **Data.**
   - Migration `0044_fin_year_close` (data only): the key, the account and its rule, the document type.
   - The boot step and the chart template give a new database the same.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The statements СТ-1…СТ-4 now | The owner chose to wait for the accountant (D17); the trial balance gives the accountant every figure meanwhile. |
| Read the VAT from e-Barimt | The receipts are not issued yet (ADR-0065, ADR-0074); the journal is what the books say. A monthly compare comes with D25. |
| A base for POS lines computed from the rate | It guesses; the shift's net is in its sales line, and a recorded base can be added to the POS posting later. |
| The year close in the core with its own command ids | The core would duplicate Bto's command envelope; Bto posts it through the intake like the opening. |
| A monthly closing of income and expense | Mongolian books close the result yearly; monthly figures come from the trial balance. |

## Consequences

**Positive.**
- The accountant has the trial balance and the VAT from the system on go-live, with Excel and print.
- The year's result moves to retained earnings in one step and can be undone.

**Negative.**
- The POS shifts' VAT has no base in the report.
- The VAT report is not yet the official form.
- 340101 is a temporary code until D16.

**Follow-ups.**
- D17: the statements and their row-to-account screen.
- D25: the tax point and the monthly compare with e-Barimt.
- The income-tax method.
- A base on the POS shift's VAT line.

## Related

ADR-0058, ADR-0072, ADR-0077, ADR-0083, ADR-0089, ADR-0090, ADR-0102, `docs/modules/finance-core.md` §3.12, `docs/modules/finance.md`.
