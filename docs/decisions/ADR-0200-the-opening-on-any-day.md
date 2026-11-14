# ADR-0200: The opening balance may be the closing balance of any day

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-14 |
| Deciders | Owner (2026-11-14: «11/14 өдрийн эцсийн үлдэгдлээр bto дээр данс бүрийн үлдэгдлийг оруул», then, told that the opening is refused unless it is a month's last day and offered 11-30 instead, «11/14-өөр, дүрмийг өөрчлөх»), Claude (the direct-mode session) |
| Amends | ADR-0106 #5 (the opening's date), ADR-0102 #6 (the `FIN_OPENING` import) |

## Context

ADR-0106 #5 fixed the opening to a month's last day: Bto starts on a month's 1st, so its first month is whole, the month close and the VAT report of that month come from one system, and the sign-off compares with a month-end trial balance, which is the one an accountant closes anyway. The import refused any other date (`NOT_MONTH_END`), and the imports page asked for «Bto ашиглаж эхлэх сар».

The owner decided to start from the closing balances of 2026-11-14, a Saturday in the middle of November, and was told what that splits. Nothing in the books needs a month end: the opening is an ordinary document dated a day, a period is a month whether its first posting is on the 1st or the 15th, and every report is «as of a day» or «between two days».

## Decision

1. **The opening is dated any day up to today.** `FinOpeningImporter` no longer refuses a date that is not a month's last day; a date after today is still refused (`OUT_OF_RANGE`), and one opening at a time still holds (`OPENING_EXISTS`). The error code `NOT_MONTH_END` is removed from `IMPORT_ERROR_CODES` and from the texts.
2. **Bto starts the day after.** The imports page asks for «Эхний үлдэгдлийн огноо» (a day, offered as the last day of the month before, the usual case) and says the day Bto starts from; when that day is not a month's 1st it also says that the month's reports are split between the earlier system and Bto.
3. **Nothing else changes.** The sign-off «Эхний үлдэгдлийн тулгалт» already takes the live opening's date; the period rules (a close needs the month ended, the earlier months closed, a clean reconcile) stand; the months before the opening hold no postings and are closed as empty months.
4. **No migration, no new right.**

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the rule; open on 2026-10-31 and enter 1–14 November again in Bto | Two weeks of sales, receipts and payments typed twice, by hand, with every chance of a difference. |
| Keep the rule; open on 2026-11-30 | The recommended answer, and the owner's to refuse: it moves the start by two weeks. |
| Allow any day only with a special permission or a confirmation box | The opening import already needs `finance.journal.manage`, is checked before it is committed and can be reverted; the page says what a mid-month start splits. |

## Consequences

**Positive.** The start no longer waits for a month's end; the import says what it does instead of refusing.

**Negative.** With a start inside a month, that month's figures exist in two systems: its income statement and its VAT report in Bto cover only the days from the start, and the accountant adds the earlier system's part for the same month (for November 2026: Erkhet 1–14, Bto 15–30). The sign-off compares with a trial balance taken on a day Erkhet does not close, so it must be exported for exactly that day, after the day's last entry. The stock's opening (`OPENING_STOCK`) must be of the same day's end, or the inventory account and the stock disagree from the first day.

**Follow-ups.**
- The owner exports from Erkhet, as of the chosen day: the trial balance per account, the receivables and payables per party, the money per account; and the stock per product.
- TODO-VERIFY with the accountant: how November's VAT return is put together from the two systems.

## Related

ADR-0102, ADR-0106, `apps/api/src/modules/imports/importers/fin-opening.importer.ts`, `apps/web/src/features/imports/imports-pages.tsx`, `packages/shared/src/imports/index.ts`, `docs/modules/imports.md`, `docs/modules/finance.md`.
