# ADR-0087: «Bto300» after the owner's look — the statement alone on «Тооцоо», who took each purchase, tidy order lines, order filters like the rep app's

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-20 |
| Deciders | Owner (asked 2026-10-20, seven points; the IBAN answered the same day: «Дансны дугаарт IBAN бичих»), Claude (Claude Code session, CA3) |
| Amends | ADR-0079 #6, #7 and #13 (the Orders, Order, Account and Invoice boards), ADR-0086 #3 («Тооцоо» keeps only the statement) |
| Related | ADR-0082 (the customer routes), ADR-0085 (the app's build), ADR-0068 #19 (the rep app's order filters) |

## Context

After ADR-0086 put «Хуулга» first on «Тооцоо», the owner asked (2026-10-20):

1. no «Нэхэмжлэх / Төлбөр» parts on «Тооцоо», no «Бүртгэгдсэн төлбөр — шинэ эхэндээ» list;
2. copying the company's account copies it in full, with the IBAN;
3. the transfer's description must carry the copied invoice number — say so firmly;
4. an order's goods laid out very cleanly;
5. an invoice opened from the statement without its «Хүргэсэн бараа» list;
6. purchases made through any rep's order visible in the statement, and the order telling which rep took it;
7. «Захиалга» showing every rep's orders of the store, separable by rep, with the rep app's filter.

Finance keeps one free-text account number per bank account (`money_accounts.bank_account_no`); the owner chose to type the IBAN there rather than add a field.

## Decision

1. **«Тооцоо» = the debt card, «Тооцооны хуулга» (ADR-0086) and the bank accounts.** The open-invoice and payment lists leave the app (their routes stay for later use); the statement is the account.
2. **The account number is copied exactly as finance keeps it.** The accountant types the full IBAN (`MN…`) in «Дансны дугаар» of a bank account shown to customers; the app shows the whole text and «Хуулах» copies it unchanged. No new field.
3. **The advice is firm:** «Гүйлгээний утга дээр хуулсан нэхэмжлэхийн дугаараа **заавал бичнэ үү**. Төлбөрийг нягтлан шалгаж бүртгэнэ.»
4. **Who took a purchase.** The statement's invoice entries carry their order (`orderId`, `orderNumber`, `orderChannel`, `orderTakerName`; finance joins the invoice's order, the customer facade asks sales for its origin), and each row says «10/19 · Худалдан авалт · Төлөөлөгч Бат» (or «Апп», «Оффис»). The invoice says the same beside its order number, which opens the order; the order page names its taker as before.
5. **An invoice without its goods list:** its dates, its order with the taker, «Дүн» (before discount and the discount when there is one, the total, «Үүнд НӨАТ», paid, credited) and the transfer advice. The goods are on the order.
6. **Order lines as the rep app shows them:** a thumbnail, the name, the confirmed price split (`parts`: «2 хайрцаг × 174,600₮», «3 ш × 29,100₮»; a pending line says only how many), what waits for stock, the line total on the right; then «Дүн» with «Бараа · N төрөл» and «Нийт».
7. **«Захиалга»'s filters** (the rep app's, ADR-0068 #19): a filter button with the count; the days (today, 7 days — the default —, this month, or the calendar); the chosen filters as chips with ×; the sheet: the days, **«ХТ, хэн авсан»** — «Бүгд», «Апп», «Оффис», «Бүх ХТ», each rep who took the store's orders by name (`GET /customer-app/orders/reps`) —, a product of the shop, the payment, delivery or pickup, the state in the customer's words; «N захиалга харуулах» counts the draft. `GET /customer-app/orders` takes `taker` (APP / OFFICE / REP), `repId`, `productId`, `paymentMethod`, `fulfilment`, `state`; the summary follows the filters.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| An IBAN field beside the account number | The owner chose to type the IBAN in the existing field (no migration, no form). |
| Building the IBAN from a bank code and the account | Bank names are free text; a wrong IBAN would send money astray. |
| Opening the order (not the invoice) from a statement row | The invoice is the purchase's document and holds the number to write in the transfer; it links to its order. |
| A rep filter by name text | Names repeat and change; the filter keeps the rep's id from the reps list. |

## Consequences

- Positive: the store reads one account view, sees which rep sold what, and filters its orders as the reps do.
- Negative: a bank account typed without its IBAN is copied without one; the accountant fixes it in the finance settings.
- Negative: the reps list shows the names of the reps who took the store's orders (the store saw them on each order already).

## Related

ADR-0068, ADR-0079, ADR-0082, ADR-0085, ADR-0086, `docs/modules/customer.md`, `docs/modules/mobile.md` §1a.
