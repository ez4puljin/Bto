# ADR-0134: «Борлуулалт /Бараагаар/» by brand, segment and the order's author, split by payment

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-01 |
| Deciders | Owner («Брэнд, segment, захиалга үүсгэсэн хэрэглэгчээр, төлбөрийн дансаар задлахыг нэм», 2026-11-01), Claude (the direct-mode session) |
| Amends | ADR-0133 #8 and #10 (the sales report's conditions; the brand and the payment split are no longer left out) |

## Context

ADR-0133 #10 left out Erkhet's brand condition and its payment split by account, because products have no brand field. Bto's products do have a brand: ADR-0098 #4 turned every Erxes brand into the product's main supplier. The owner asked for the sales report to be broken down by brand, by segment and by the user who took the order, and for the sales to be split by payment account.

## Decision

1. **Brand = the main supplier.** A product's brand is its main supplier (`product_suppliers.is_main`, ADR-0098 #4). The prompt offers «Брэнд» as a pick-many list of every supplier that is some product's main supplier.
2. **Segment = a hand-picked product segment.** «Сегмент» offers the live LIST product segments (ADR-0052). The reporting module reads tables, not the segments module (§3.1 rule 4), and only the segments module can evaluate a RULES segment, so rule segments are not offered. A product in two segments counts in both groups. The «НИЙТ ДҮН» row reads every line once.
3. **The order's author.** The «Ажилтан» condition and the «Захиалга үүсгэсэн хэрэглэгчээр» grouping use one rule:
   - the sales order's author for a wholesale line (the invoice's author when there is no order);
   - the cashier for a till's sale or return.
   Lines of the customer app's orders form a group of their own, «Харилцагчийн апп». Lines with nobody, such as re-costing, go under «Хэрэглэгчгүй».
4. **«Бүлэглэл».** The products can be grouped in one of four ways: «Ангиллаар», «Брэндээр», «Сегментээр» or «Захиалга үүсгэсэн хэрэглэгчээр».
   - The server returns each row with its group key and name: an id, `APP` or `NONE`, with names such as «Брэндгүй».
   - A row's lines are read within its group, so a product under one author shows only that author's documents.
   - The Excel sheet puts the brand, segment or author in front as a column of its own.
5. **«Төлбөрийн дансаар задлах».** With this condition the sales are split into one column per way of payment, net of VAT like the sales column, so a row's columns add up to its sales:
   - a wholesale invoice or credit note is «Авлага» (the invoice is owed; vouchers pay it later);
   - a till's sale is split in proportion to its tenders: CREDIT is «Авлага», a tender with the admin's payment type goes under that type's name («Бэлэн», «Khaanbank terminal», «Шилжүүлэг»), and an older tender goes under its kind.
   - The documents in a row's lines carry the same split.
   - Each figure is rounded to whole cents after the sum. A column total can therefore differ from the sum of the row amounts by a cent.

## Consequences

- No table and no migration. `GET /reports/product-sales` takes `brandIds`, `segmentIds`, `by` and `payments`; the documents endpoint also takes `group`. `GET /reports/book-options` adds `brands` and `segments`.
- The columns are the till's payment types, not GL account codes: the reporting module may not read the Finance Core's posting rules (§3.1 rule 4). If the accountant wants account codes, a `reporting` view of the rules is the way to add them.
- Still left out from ADR-0133 #10: the journal's product, type, «Агуулга» and «Х.Я» conditions, and picking several customers at once.
