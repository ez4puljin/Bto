# ADR-0150: Transactions by the account's journal, like Erkhet

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («Дансны төрлөөр гүйлгээ хийх боломжтой болго. Эрхэт шиг», 2026-11-05), Claude (the direct-mode session) |
| Amends | ADR-0149 (the journal now decides the screens, and a cash or bank account gets its money account) |

## Context

In Erkhet each journal has its own menu, list and form: «Ерөнхий журнал», «Касс», «Харилцах», «Авлага өглөг», «НӨАТ», «Бараа материал», «Үндсэн хөрөнгө». A form offers only that journal's accounts. Bto had one multi-line manual entry, and no money account stood behind the new cash and bank accounts, so a line on them was refused.

## Decision

1. **«Санхүү → Гүйлгээ» `/finance/transactions`:** a tab per journal lists the entries touching its accounts, from any source (`GET /journal-entries?journal=`). A row opens the entry on the journal page, where a manual one is reversed.
2. **`POST /journal-entries/by-account`** (`finance.journal.manage`, Idempotency-Key): one account of that journal against a counter account, posted through `postManual`, so every core rule on money accounts and parties holds.
   - «Касс», «Харилцах»: «Орлого» debits the account, «Зарлага» credits it.
   - «Авлага өглөг», «НӨАТ»: «Үүсгэх» grows the account on its normal side, «Хаах» shrinks it.
   - «Ерөнхий журнал», «Үндсэн хөрөнгө»: «Дебет», «Кредит».
3. **It always balances; a counter account is required.** This is where Bto differs from Erkhet, whose one-sided document waits as «бүрэн бус баримт». ADR-0072's balanced journal stands.
4. **Tax** on money forms: the amount includes it, as in Erkhet. VAT goes to the VAT_OUTPUT account on money in and VAT_INPUT on money out; city tax splits only on money in, since no key holds it on a purchase and it stays in the cost. Rates come from the company's settings on the entry's date; a company not paying a tax splits nothing.
5. **«Бараа материал» only lists.** Stock accounts move through the warehouse's documents, and a stock account is refused as a counter account too, or the books leave the stock ledger (ADR-0097).
6. **A cash or bank account gets its money account by itself:** on the chart import, on creation and on a journal change to cash or bank, with the account's code and name and no branch.
7. **Not built:** «Тооцоо хаагдах огноо» and matching. A manual «Хаах» makes an opposite open item; the party's balance is right, but the original item stays open in ageing, since a JOURNAL may not settle (ADR-0072 #1). Paying an invoice stays on «Төлбөр». Foreign amounts wait (ADR-0149 #5). «НӨАТ үзүүлэлт» and asset registers are not in Bto; manual VAT lines are outside the VAT report.

## Consequences

**Positive.** An accountant used to Erkhet finds each journal's form, and only its accounts.

**Negative.** Two ways to pay a customer now exist: «Төлбөр» settles invoices, «Авлага өглөг» does not. The form says so.

## Related

ADR-0072, ADR-0090, ADR-0097, ADR-0148, ADR-0149.
