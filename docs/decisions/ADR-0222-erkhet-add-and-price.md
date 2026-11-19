# ADR-0222: «Эрхэт тулгалт» adds the products Bto lacks and prices the ones it has without a price

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-19 |
| Deciders | Owner (2026-11-19: the «Bto-д байхгүй» items added to Bto in bulk under one chosen category, ticked so that groups like «Хархорин Боломж» are left out; the «Bto-д үнэгүй» items priced from Erkhet and made sale-ready; both Erkhet → Bto only), Claude (the brain and a `bto-core` worker) |
| Migration | none (`erkhet_sync_items.plan`, a nullable jsonb column, carries the new rows' data) |
| Amends | ADR-0203 #6 («Products missing in Bto are shown, not created») |

## Context

The first checks on the real system found 252 Erkhet items Bto does not have (24 of them in Erkhet's category «Хархорин Боломж», 67 in «Хятад бараа») and 61 Bto products with no price today, 27 of which have no price in Erkhet either. ADR-0203 #6 left missing products to «Шинэ бараа» because a registration needs a category, a supplier, a photo and a home warehouse (ADR-0044); one by one, 252 registrations are days of work, and the waiting products sell nothing until a price clerk completes them. The Excel import of products (ADR-0036) already creates products without a supplier, a photo or a home warehouse, and the price sheet import (ADR-0054) completes the products it prices: what is missing for Erkhet's items is only the choice of a Bto category and of a price profile, which Erkhet does not know.

Erkhet's item list carries more than ADR-0203 read: «Хэмжих нэгж код» and «Хэмжих нэгж нэр» (the base unit: «ш ширхэг» for 12,954 of 13,141 items on 2026-11-19, then «ха Хайрцаг», «кг Килограмм», «гр грамм»), «Задрах харьцаа» and «Жин». «Задрах харьцаа» is one base unit in the pack unit: 1/12 (0.0833…) for a box of 12, on about 7,800 items; about 120 items have it the other way round (12), and ten have a count that is not whole. Read as a box of n base units (1/n or n, n whole and at least 2), it was checked once against the development database `bto_main` on 2026-11-19 (read-only): of the 11,509 Erkhet items whose barcodes lead to exactly one Bto product, 6,841 give the same n as that product's current box, 13 another one, 119 a box where Bto has none, 5 none where Bto has a box, and 4,531 none on either side: where both sides have a box they agree 6,841 times in 6,854 (99.8 %).

## Decision

1. **Two more differences close from the page, Erkhet → Bto only.** `erkhetIssueAppliable` takes `PRODUCT` `MISSING_IN_BTO` («Bto-д нэмэх») and `PRODUCT` `NO_BTO_PRICE` («Үнийг тааруулах») besides the three of ADR-0203 #6. Nothing is written to Erkhet. The right stays `erkhet.sync.manage`.
2. **The rows are ticked.** The list of an issue «Bto-д тааруулах» acts on has a tick on each open row and «Бүгдийг сонгох» over the loaded rows; the button acts on the ticked rows, or with none ticked on every open row of the issue, up to 500 (ADR-0203). The search also finds Erkhet's category, so a group is found and left unticked.
3. **The person chooses what Erkhet does not know.** A dialog asks for one Bto product category (required, for every product of the request) and a price profile («Үндсэн» proposed); `POST erkhet/sync/apply` takes them as `categoryId` and `profileId` and refuses the whole request (422) when a row needs one that is missing, unknown, archived or without values today (`erkhetApplyChoices`).
4. **A check keeps what a new product takes.** For a `MISSING_IN_BTO` item the check stores Erkhet's unit code and name, «Задрах харьцаа» and «Жин» as Erkhet gave them in the row's `plan` (a union by the row's kind: the customer's plan on customer rows, these cells on product rows). A row of a check made before this decision has none and is `REFUSED`: a new check is needed first.
5. **A new product** is created through `CatalogImportService.createManyInTx` (audited, like an import, waiting for prices) with Erkhet's name; every barcode of the item on its base unit (an unreadable one refuses the row; one Bto has taken since the check makes the row `STALE`); the base unit found by Erkhet's unit name, else its code, among Bto's units of measure, else pieces; a box (`BOX`) when «Задрах харьцаа» gives a whole count of two or more, read either way round (1/12 or 12), and none when the base unit is the box itself; the weight from «Жин» when above nothing; VAT_ABLE; and the code: Erkhet's when it is digits only and no Bto product has that number (an import may use any code, ADR-0044 #1), else the next free code of the chosen category as «Шинэ бараа» suggests it. Supplier, photo and home warehouse are filled on the product's page afterwards.
6. **Its price.** When Erkhet's «Нэгж үнэ» is a whole tugrik above nothing it becomes the warehouse price from today (`ProductPricesService.setInTx`) with the chosen profile and the box counted whole (none without a box), and the product is completed (`SaleReadinessService.completeManyInTx`) in the same transaction. Otherwise the product is added without a price and waits in «Үнэ хүлээгдэж буй».
7. **A product without a price today** takes Erkhet's price from today with the chosen profile and its largest pack counted whole (none without packs), and is completed. No Erkhet price or one with a fraction: `REFUSED`; Bto priced it, or switched it off, since the check: `STALE`.
8. **As before (ADR-0203 #6):** one row, one transaction, through the owning modules' services and their rules, audited as the acting person's; the row is claimed first and checked again; `APPLIED`, `STALE` or `REFUSED`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Erkhet's category mapped to a Bto category per row | Erkhet's categories are not Bto's; the owner chooses one category for what is ticked |
| «Задрах харьцаа» as the box count only when above one | Erkhet keeps it the other way for almost every item: about 7,800 boxes would be lost and some 120 found |
| An unreadable barcode left out instead of refusing the row | A product without one of its barcodes is found at the till as missing; the row says it was refused and a person registers it |
| Every new product's code from the category's range | Erkhet's own code is what the staff know the item by; ADR-0044 lets imports keep any code |
| A migration with a table of Erkhet's units | The rows of a check are short-lived (five checks kept); the nullable `plan` column holds them without a migration on the real system |

## Consequences

**Positive.** The 252 missing items and the 34 unpriced products with an Erkhet price close in a few clicks, in a category the owner chooses, and sell at once. **Negative.** The new products have no supplier, photo or home warehouse until someone fills them; the category is one for all ticked rows, so a mixed set is added in several rounds. Two people adding products to the same code range at the same moment can make one row `REFUSED` (the code taken between the read and the write); applying again takes the next code. The units are read from Erkhet's cells: a list that loses those columns adds products in pieces without a box or a weight.

## Related

ADR-0203, ADR-0036, ADR-0044, ADR-0048, ADR-0054, `docs/modules/erkhet.md`.
