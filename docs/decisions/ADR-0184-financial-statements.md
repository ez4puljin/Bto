# ADR-0184: The statements СТ-1 and СТ-2 from the journal, rows as data, accounts linked on the screen

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-11 |
| Deciders | Owner (2026-10-23: «when the statements come, the accountant links their rows to accounts on a screen»; 2026-11-11: «Хагас баригдсан хэсгүүдийг надаас асуулт асуухгүйгээр өөрөө мэдэж хий»), Claude (the row set and the default places) |
| Amends | ADR-0105 (F6 left СТ-1…СТ-4 for D17), ADR-0106 #2 (the statements were not to be built then) |

## Context

F6 gave the trial balance, the VAT report and the year close; the statements waited for the accountant's answer D17 (which forms, which rows). The answer has not come. Бүтэн-Оргил is an ХХК, so the business forms apply, and the chart is Erkhet's (ADR-0148), whose codes already follow the forms' sections. A balance sheet and an income statement are sums of account balances: they can be right by construction from the journal, with the accountant correcting where an account sits. A cash-flow statement and a statement of changes in equity are not sums of balances; they need each movement classified, which the journal does not carry.

## Decision

1. **СТ-1 (the statement of financial position) and СТ-2 (the income statement) are built; СТ-3 and СТ-4 are not.** They stay with D17: the accountant says how equity movements and cash movements are classified before a number is shown under those names.
2. **The forms are data** (`@tugeel/shared/finance`, `BALANCE_ROWS`, `INCOME_ROWS`): each row's stable code, its number on the form, heading / line / total, the account kinds a line takes, the code prefixes that land on it, and a total as a sum of rows with factors. The rows' names are texts (`finance.statements.rows`). СТ-2 ends at «Тайлант үеийн цэвэр ашиг (алдагдал)»; the other comprehensive income rows are not kept.
3. **Where an account sits.** The accountant's link first (`statement_row_links`, one row per account, migration `0099_statement_links`); else the row with the longest matching code prefix among the rows that take the account's kind; else the kind's fallback row («Бусад …»). A link must name a line of the account's own statement that takes its kind. So an equity account on a `3…` code (the temporary `340101`) never lands among the liabilities.
4. **The numbers** come from one read of the core, `FinReports.statementBalances` (under `posting/`, company-scoped): per account the balance before `from`, the movement within the dates and the balance at `to`, the movement and two «unclosed» balances leaving out the entries of the closing document types and their reversals. СТ-1 shows the balance before the period and at its end; the balances still on the income and expense accounts — the result not yet closed — are added to «Хуримтлагдсан ашиг (алдагдал)» and named under it, so the two sides agree whenever the journal balances, and the screen says whether they do. СТ-2 shows the period without the year close, so a closed year still shows its result.
5. **Rights.** Reading with `finance.read`; linking with `finance.journal.manage` — the right that keeps the chart, which the accountant holds. A link is audited with the row before and after.
6. **Screen, Excel, print** (ADR-0105 #5): «Санхүү → Санхүүгийн тайлан» (`/finance/statements`) with СТ-1 | СТ-2, any dates (the year to date by default) and «Дансаар задлах», where each row lists its accounts and a select moves one; `GET /finance/reports/statements/:kind[/xlsx]`; `/finance/statements/print` on A4 with two signature lines.

## Consequences

- No statutory number is typed or stored: a statement is a view of the journal, and changing a link changes every period at once.
- The row numbers and names follow the business forms as built from the chart's sections; the accountant checks them against the form filed (D17) and a difference is a change of data, not of code.
- СТ-3, СТ-4, the comparative column of СТ-2 and the notes are not built.

## Related

ADR-0105, ADR-0106, ADR-0148, ADR-0102, docs/modules/finance.md, docs/modules/finance-core.md.
