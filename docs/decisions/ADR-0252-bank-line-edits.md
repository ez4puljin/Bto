# ADR-0252: A bank line in the books is edited, and «Гүйлгээ засах» writes only the changed lines again

- Status: Accepted
- Date: 2026-11-26
- Builds on: ADR-0169 (bank statements)

## Context

The owner (2026-11-26): «Дансны хуулгын бүх талбар бөглөгдсөн үед бичилт хийх дарахад бүх гүйлгээг хийгдсэн байна. Хэрэв дараа аль нэг мөрийг засаад гүйлгээ засах дарахад зөвхөн өөрчлөгдсөн гүйлгээнийг шинэчилдэг байна. Бүх гүйлгээг устгаж дахин хийгдэггүй байна. Өөрчлөлтийн түүх өдөр бүрийн хуулга дээрээ байна.» Also: a month's bank fees as one Erkhet file, a month's totals per account («Сарын хөл дүн»), and fees and settlements filled from the settings with a fixed party («харилцагч болон данс нь үргэлж тогтмол»).

Until now a posted line could not be edited (ADR-0169): the accountant reversed it by hand («Буцаах»), edited it, and posted again.

## Decision

1. A NORMAL line in the books is edited like an open one; fee and settlement lines still follow the rules. Migration `0128_bank_statement_edits` adds `bank_statement_lines.posted_fields` (jsonb): the fields the books took (`customerId`, `supplierId`, `counterAccountId`, `description`, `action`), written at every posting and backfilled for lines posted before. A posted line whose fields differ from it is «changed» (`changed` on the line, `changedCount` on the statement); putting the value back makes it unchanged again. `exportType` only steers Erkhet's file and does not make a line changed.
2. `POST :id/post` writes the ready open lines as before and, for each changed complete line, in ONE transaction with the line locked: the document's own reversal (`voidInTx` / `reverseManualInTx`, dated today as every reversal, reason «Банкны хуулгын мөр засагдсан»), then the new document under the next source key `bank-line-<id>-<post_attempt+1>`. The result adds `updated`. Unchanged lines in the books are never touched. The page names the button «Гүйлгээ засах» when only changed lines wait.
3. Every edit is audited per line with the fields' before and after (also from the bulk bar); a re-posting is audited as `REPOST`. `GET history?date` reads these rows for the lines of a day's statements (`finance.read`), shown by «Түүх» on the day.
4. `GET month-totals?month` sums each bank account's lines of a month by their own date: lines, days, money in, money out, net and the fees among the money out. The fee export already filters by the lines' own dates; the page adds a month mode (`Шимтгэл_YYYY-MM.xlsx`).
5. The rules gain `feePartyCode` and `settlementPartyCode` (`bank_statement_settings.fee_party_code`, `settlement_party_code`, null = the general `partyCode`): the party a fee's or a settlement's posting on a party account takes, the code their Erkhet rows carry, and the party shown on their lines.

## Consequences

- A correction no longer needs «Буцаах» and a second post, and never re-creates the lines that did not change. «Буцаах» stays for taking a line out of the books.
- The reversal of an edited line is dated the day of the correction, as with «Буцаах»; a closed month refuses the line, which is reported and stays as it was.
