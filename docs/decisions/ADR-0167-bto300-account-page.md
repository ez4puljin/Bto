# ADR-0167: «Тооцоо» redrawn, a purchase opens its order, the accounts behind an ⓘ with IBAN and holder

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («Bto300 аппын тооцоо хэсгийн харагдах байдлыг зас. Дүрэм баригдахгүй загварлаг хэрэглэхэд хялбар болго … худалдын авалтын баримт дээр дарахад тухайн захиалга руу шууд шилждэг, утасны back дээр дарахад буцаад тайлан руугаа … i button … Банк, Данс эзэмшигч, Iban, Дансны дугаар (хуулах боломжтой байна)», 2026-11-06), Claude |
| Amends | ADR-0087 (the IBAN typed into the account number), ADR-0096 (the statement's sum, the purchase opening its invoice) |

## Decision

1. **Two new columns on `fin.money_accounts`:** `iban` and `account_holder`, nullable, typed on «Мөнгөний данс» in the finance settings (migration `0083_money_account_iban`). The IBAN is kept whole and in capitals however it was typed; the app shows it in fours and copies it whole. Until now the accountant typed the IBAN into the account number (ADR-0087): the two are apart from here on.
2. **The accounts leave the page.** The ⓘ in the header, on «Тооцоо» only, opens «Дансны мэдээлэл»: each account's «Банк», «Данс эзэмшигч», «IBAN», «Дансны дугаар», the last two copied with one press, then the advice to write the invoice number. The confirmation stays on the button, because a toast would sit behind the sheet. A value not yet filled shows «—».
3. **The debt is one blue card:** the debt or advance, a credit hold, the credit left, and inside it a white panel with «Тооцоо хийх өдөр» and «Төлөх дүн», red once something is overdue (ADR-0101 #6 unchanged).
4. **The statement:** three tiles («Дебит», «Кредит», «Эцсийн үлдэгдэл») replace the four-row sum, because the table's first and last rows already hold the opening and closing balances. The table keeps its four columns (ADR-0096).
5. **A purchase opens its order** (`statementLink`), or its invoice when it has no order of the store's; the invoice stays reachable from the order. A payment or a return opens nothing. The phone's back returns to «Тооцоо» with the days as they were, since the page stays underneath.
6. **A payment shows its «Гүйлгээний утга»** under its row, across the row's whole width (the owner, 2026-11-06). The statement's entry gains `description`, the voucher's `memo` attribute, for payment documents only; `FinPartyLedgerRow` passes each document's attributes. Once the bank's statement creates the vouchers, the bank's description lands in that field, so a store reads what it wrote in its own transfer.
7. **The table sits inside the page's margins** as a white card, like the cards above it. On a narrow phone the date, kind and number shrink to at most 80% rather than being cut.

## Consequences

- Whatever the accountant types in a customer payment's «Гүйлгээний утга» is now read by that store, so an internal remark does not belong there.
- No account shows in the app until finance marks it «Харилцагчид харуулах»; on `bto_main` none is marked today.
- The columns went on `bto_main` by hand before the merge (`ADD COLUMN IF NOT EXISTS`), so the migration runs harmlessly once merged. The number and journal entry follow main at the merge, as main's checkout already holds `0076`–`0079`.

## Related

ADR-0079 #7, ADR-0086, ADR-0087, ADR-0096, ADR-0101, ADR-0166, `docs/modules/mobile.md` §1a.
