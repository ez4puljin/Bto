# ADR-0096: «Тооцоо»'s statement as a four-column table

| | |
|---|---|
| Status | Accepted (the owner, 2026-10-21: the redrawn Account board approved with «Тийм. Энэ самбараар «Тооцоо»-ны хуулгыг апп-д хий.») |
| Date | 2026-10-21 |
| Deciders | Owner (the request, four answers on settlement days, a look at the board, 2026-10-21), Claude (Claude Code session, CA5 follow-up) |
| Amended by | ADR-0101 (2026-10-23: #6 — the settlement fields the card waits for now exist on `/customer-app/account`) |
| Amends | ADR-0086 #3 (the statement's layout) and its rejected alternative «A running-balance column»; ADR-0087 (what «Тооцоо» shows) stands |

## Context

ADR-0086 put «Тооцооны хуулга» on «Тооцоо» as one card:
- three columns «Огноо, баримт · Дебит · Кредит»;
- the balance after each entry as a line under it («Үлдэгдэл …»);
- a running-balance column rejected because five columns would not fit a phone.

After 0.3.0 (ADR-0095) the owner asked: «Тооцоо дээр кридет дебит багана, эхний болон эцсийн үлдэгддэл харагддаг байхаар маш сайн сайжруул». The Account board was redrawn in the E-mart look (version 28 of the boards, https://claude.ai/artifact/GFhasAC4DUASUM2WibYuRe).

The table was measured there at 390 px with 13 px Inter digits:
- a seven-digit amount «2,095,200» needs 66 px;
- the line «09/25 Худалдан авалт» needs 143 px;
- a document column, three amount columns of 66, 66 and 72 px, and 6 px gaps fit with 10 px edges.

So four columns fit; the date does not need a column of its own, since it starts the document line.

The same day the owner gave the settlement days by customer group:
- Mörön stores pay on the 20th for purchases from the 21st to the 20th;
- countryside stores pay on the month's last day for that month's purchases;
- an overdue debt only reminds and never blocks.

The board draws that as a card under the debt. It needs server fields that do not exist yet; that work was proposed as its own session (partners, finance, the customer route).

## Decision

1. **The heading:**
   - «ТООЦООНЫ ХУУЛГА» in upper case beside a blue file icon, with the number of entries under it («8 гүйлгээ»);
   - on the right, the days as a chip with a calendar icon («09/22 – 10/21»). It opens the calendar sheet (up to 366 days) and is blue when the days came from the calendar.
2. **Three chips under it** (`statementRange` in `src/customer/statement.ts`):
   - «Сүүлийн 1 сар»: the first view, as in ADR-0086;
   - «Энэ сар»: the 1st to today;
   - «Өмнөх сар»: the whole month before.

   The chip whose days are shown is blue (`statementPresetOf`). While another period loads, the previous one stays, dimmed.
3. **The sum, «Эхний үлдэгдэл + Дебит − Кредит = Эцсийн үлдэгдэл»,** in an outlined card:
   - the opening balance «09/22-ны эхэнд»;
   - «+ Дебит · Худалдан авалт · өр нэмэгдэнэ»;
   - «− Кредит · Төлбөр, буцаалт · өр буурна» in green;
   - the closing balance «10/21-ний төгсгөлд», large and blue on a blue tint.
4. **The table** runs across the page under upper-case column heads «ОГНОО, БАРИМТ · ДЕБИТ · КРЕДИТ · ҮЛДЭГДЭЛ»:
   - the opening balance row;
   - one row per entry, oldest first:
     - «10/12 Худалдан авалт»;
     - the number, blue with › when it opens the invoice (the whole row opens it);
     - for a purchase, who took its order;
     - its amount under «Дебит» or «Кредит» (green), a zero left out;
     - the balance after it;
   - «НИЙТ» with both totals;
   - «Эцсийн үлдэгдэл» on the blue tint.

   Amounts carry no «₮»: the note under the table says «Дүн төгрөгөөр». The note also explains Дебит and Кредит, the invoice link, and that a negative balance is an advance. An eight-digit amount shrinks to fit its column. On a phone narrower than 390 px, the entry's kind is cut with «…» before any amount is.
5. **The page** is white with outlined cards (the E-mart look, ADR-0095), and the debt is 28 px. The debt card, the overdue banner, the credit bar, the credit hold, the payment term and the bank accounts stay as ADR-0087 has them.
6. **The settlement-day card is not built here.** The board's «Тооцоо хийх өдөр 10/31 · 10 хоног үлдлээ | Төлөх дүн 1,284,600₮ · 10-р сарын авалт» comes with the server work on the owner's rule (its own ADR). Until then the payment term row stays.
7. **Version 0.3.1** of «Bto300». Only the app changes.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keeping the balance as a line under each entry (ADR-0086) | The owner asked for the columns and both balances to read at a glance; the measured table fits four columns. |
| A separate date column (five columns) | It leaves the document column too narrow for the kind; the date starts the document line instead. |
| Only a summary of the totals | The owner asked for Дебит and Кредит as columns; the summary sits above the table, not instead of it. |
| A horizontally scrolling table | The balance column would leave the screen, and swiping sideways hides the rows' meaning. |

## Consequences

**Positive.**
- The store reads its account the way the accountant does: the opening balance, each movement in its column with the running balance, and the closing balance, once as a sum and once at the table's foot.

**Negative.**
- On a phone narrower than 390 px, a long kind is cut.
- The opening and closing balances show twice: in the sum and in the table.

**Follow-ups.**
- The settlement-day card, after the server session on the owner's rule.
- The office's own statement for a customer, and a printable statement, if the owner asks (ADR-0086).

## Related

ADR-0079, ADR-0086, ADR-0087, ADR-0095, `docs/modules/mobile.md` §1a, the board Account.dc.html (version 28).
