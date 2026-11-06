# ADR-0153: The receipt window in Erkhet's three parts, numbered at the first save

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («Падаан дугаар гараар оруулахгүй. Хадгалах дарахад систем цаанаас падааны дугаар өгнө», «Орлого авах хуудас үндсэн 3 хэсэгтэй», «бараа хайж сонгоход шууд байршил нь бөглөгддөг», «Хувийн жин дээр бараа мэдээллээс шууд дуудагддаг», «Орлого дотор зарах шинэ үнэ гэж байх ёсгүй», 2026-11-05), Claude (the direct-mode session) |
| Supersedes | ADR-0099 answer 7 (a panel above, the table below: now side by side as Erkhet has it) and ADR-0078 #6 in the same point; ADR-0099 answer 9 (a sale price on a receipt); the `Conventions` rule that drafts have no number, for receipts |

## Decision

1. **The number comes with the first save.** `ReceiptsService.createInTx` allocates the `GR-YYYY-NNNNNN` number, for a receipt from the window, an import or a purchase order alike; the posting keeps it. The check `goods_receipts_posted` (migration `0074_receipt_number_at_save`) now says a draft may carry a number and a posted receipt must. A draft saved before this has none and takes one at its posting, as before.
2. **Nobody types a delivery-note number.** The field is gone from the window, and «Падааны дугаар» shows the system's number, read-only. `supplier_doc_no` stays: an import and older receipts fill it, shown as «Нийлүүлэгчийн падаан» only when there is one.
3. **Three parts.** The document on the left (date, number, supplier, «Харилцсан данс», description), the line editor on the right, the lines below; side by side from `lg`.
4. **«Харилцсан данс» is one choice among the payable and the money accounts.** It replaces «Төлбөр» and «Данс» on screen and sets the same facts (`payment_method`, `money_account_id`, ADR-0078 #5), so the books post as they did. Erkhet's free choice of any account is not taken: a receipt's posting knows only these sides (ADR-0091).
5. **A line saves with «Хадгалах» and the fields empty for the next one.** A line is what makes the document, so the empty-document save is gone.
6. **The product fills in its own.** «Байршил» (its home warehouse, with the shelf once shelves are in use) and «Хувийн жин» (`products.weight_kg`, with the line's total under it) are read-only. «Бараа засах» beside the location opens the product in a new tab, and coming back reads the location and weight again. A product without a home warehouse still asks for it, in the location's place.
7. **A receipt sets no sale price.** The field and the lines table's column are gone; a price changes on the price screens. The window still shows the sale price in force and the markup on it, for reading. The API's `salePrice` on a line and the `RECEIPT_SALE_PRICES` hook stay unused by the window; no receipt on the development database holds one.
8. **Delivery-note money fields use `MoneyInput`** (ADR-0152): the unit price and the amount show `1,500,000`.

## Consequences

**Positive.** The number is known while the document is still being typed, and can be written on the paper.

**Negative.** A cancelled draft keeps its number, so `GR-` numbers have gaps; the cancelled document remains listed under that number. A receipt's number is no longer proof that it was posted: the status says that. An order's arrival takes a number when its draft is made.

## Not taken

From Erkhet's window, as in ADR-0078: the VAT and city-tax ticks (VAT follows the supplier), currency, landed costs, a line's own account and a different counter-party.

## Related

ADR-0033, ADR-0078, ADR-0091, ADR-0099, ADR-0115, ADR-0152.
