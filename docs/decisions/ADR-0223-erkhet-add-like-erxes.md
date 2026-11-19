# ADR-0223: «Эрхэт тулгалт» files and prices each product as erxes does

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-19 |
| Deciders | Owner (2026-11-19: «Bto-д нэмэхдээ Erxes.bto.mn дээрхи ангилал болон үнийн Profile уншиж дуурайж хийх хэрэгтэй»), Claude (the brain and a `bto-core` worker) |
| Migration | none |
| Amends | ADR-0222 #3 (one category and one profile for every ticked row) |

## Context

ADR-0222 adds Erkhet's items Bto lacks under one category and one price profile chosen for all the ticked rows, so a mixed set is added in several rounds and every product's profile is chosen by hand. The company's erxes (erxes.bto.mn) already files each of these products: Erkhet's item code is erxes's product code (the old ERP compared the two masters by it: 12,884 active on both, names, prices and barcodes equal), and two earlier copies made Bto's categories and profiles from erxes:

- **Categories** (ADR-0098 #2, `tools/migration/erxes-rules.mjs` `placeCategory`): a numbered «101 Дарс виски» became the Bto category of that name with the range 101000–101999; «+Тамхи» the top category «Тамхи»; a product filed under a group's own name its group's «Ангилаагүй»; the unnumbered names stayed as they were.
- **Profiles** (ADR-0207 #6, the copy of 2026-11-17): for the till «Бүтэн Оргил ХХК» («Мөрөн-P.O.S»), the active plans of its branch and department or of none were taken; a product's key was the set of tag plans reaching it by its tags (a plan's tag with its child tags, its excluded tags and products out); each of the 18 keys became one Bto profile (the key of the plans of «oldCategories - BB» «Үндсэн», no plan «Нэмэгдэлгүй», «110 - Архи» «Архи», …), named after the group, not as the plan («Үндсэн - Үнийн тохиргоо жиж /Мөрөн/» became «Үндсэн»). Products that a plan names alone (112) got their own profile in ten cases («УБ гурил (заал)», «Өндөг (+70₮)», …).

Checked read-only against the company's erxes on 2026-11-19 (signed in through the owner's browser, queries only):

- 13,142 active products, 101 categories, 112 product tags, 5 tills, 294 pricing plans; the till's plans are 107 (24 by tag, 83 by product) and give the same 18 keys, with the same counts within a few products, as on 2026-11-17 (16.21: 6,512; none: 3,885; …).
- **Categories against the development database** (`bto_main`, the product master's categories): of the 11,936 active erxes products whose code is a Bto product's code, the rule below files 11,935 in the category the product has in Bto; the one other was moved by hand (206 → 207).
- **Profiles**: the development database carries «Үндсэн» on every product, so agreement there says nothing. The real system was not read (no worker reads it); by the copy of 2026-11-17 every key's products carry the key's profile, except the ten products of a product plan (12,801 of 12,811 priced and matched products), and the 200 products added from erxes the same day took their profile by the same key.
- **The rows waiting on the development database** (the check of 2026-11-16): of 375 `MISSING_IN_BTO` items, 374 are in erxes by code (one not at all); 350 get a Bto category, the 24 of «Хархорин Боломж» none. All 42 `NO_BTO_PRICE` items are in erxes.

## Decision

1. **The category and the profile come from erxes, row by row.** For «Bto-д нэмэх» (`MISSING_IN_BTO`) and «Үнийг тааруулах» for products without a price (`NO_BTO_PRICE`), the apply reads erxes once, before any transaction, with the saved erxes sign-in and queries only (`ErxesProductFactsFlowService`, module erxes; erkhet imports `ErxesFactsModule`, and erxes reads pricing).
2. **The erxes product** is the one whose code is Erkhet's code; else the one product holding one of the item's barcodes; else none.
3. **Its category** is the Bto category its erxes category became, by `placeCategory`'s rule read against Bto's categories as they are now: a numbered name by the category whose range starts at that number × 1000, else the one category whose own name carries the number (a range or a name may have changed since: 905's range was widened, «215 Савалгаатай чихэр» renamed); «+X» the top category X; a group's own name its «Ангилаагүй»; another name the one category of that name. None when Bto has none or more than one («Хархорин Боломж»).
4. **Its profile** is its price group's: the till's plans that reach it by its tags form the key of ADR-0207's copy; the profile is the one more than half of the Bto products of the same key carry today (matched by code, products a plan names alone not counted), when it is live with values today. The profile's name is not compared: the copy named profiles after the group, not as erxes's plans.
5. **What erxes does not settle** (not found, no Bto counterpart, no majority, no saved sign-in, erxes down) takes the dialog's choices, which are now fallbacks and both optional in the api: «Erxes-ээс олдохгүй бол ангилал» (may be left empty: such a product is `REFUSED`) and «Erxes-ээс олдохгүй бол үнийн профайл» («Үндсэн» proposed). An unusable choice that is given still refuses the request (422). The dialog says «Ангилал, үнийн профайлыг бараа бүрээр erxes.bto.mn-ээс авна.».
6. **The result says it.** `POST erkhet/sync/apply` answers `fallback` (applied products that took a choice) and `erxesFailure` (why erxes was not read); the page's toast says «{{count}} бараа erxes-ээс олдоогүй тул сонгосон ангилал, профайлаар орлоо.».
7. **Everything else of ADR-0222 stays:** one row one transaction through catalog and pricing, `STALE` and `REFUSED`, the completion, and Erkhet's code, name, barcodes, box, weight and price; a new product's code is Erkhet's when free, else the next free code of its category (now erxes's or the fallback).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The profile of the same name as the erxes plan or tag | The copy of 2026-11-17 named profiles after groups («Үндсэн» for «Үндсэн - Үнийн тохиргоо жиж /Мөрөн/», «Ургамлын тос» for the tag «154 - Ургамалын тос»): no name matches |
| A table of erxes plan → Bto profile kept in code or in a setting | A second copy of the 2026-11-17 assignment that goes stale when the owner edits a profile or erxes a plan, and a migration or a constant; the products themselves already carry it |
| erxes's category code («101») instead of the name | `placeCategory` read the name; the code and the name agree on the numbered ones, and the name also carries the «+» groups |
| Refuse rows erxes does not settle | The owner's dialog choices exist for them, and erxes may be down |
| Read only the ticked items from erxes | The profile needs every product's price group to count; 14 pages take about 8 s |

## Consequences

**Positive.** A mixed set of items is added in one round, each in its erxes category with the profile its erxes group carries in Bto; priced products sell at the till as erxes would price them.

**Negative.** Each apply of products reads all of erxes's active products (about 8 s). A group whose Bto products carry no majority profile, and a group with no priced Bto product yet, take the fallback. A product that an erxes plan names alone gets its group's profile, not the special one the copy gave a few such products. Items of «Хархорин Боломж» take the fallback category: the owner still leaves them unticked. On the development database every product carries «Үндсэн», so new products there always get «Үндсэн».

**Verified.** The rules (`erxes-product-facts.spec.ts`), the apply with a scripted erxes (`erkhet-sync.int-spec.ts`), and a run of the built api on a copy of the development database with erxes's real answers (a subset, ids aliased) and the profiles «Архи», «Дарс виски», «Тамхи» given to their groups' products as on the real system: 102244 → «102 Архи», «Архи»; 101143 → «101 Дарс виски», «Дарс виски»; 104131 → «104 Цэвэр ус, Рашаан», «Үндсэн»; 923063 → «Тамхи»; 990001 («Хархорин Боломж») → the fallback category; 101252 (no price in Bto) → «Дарс виски».

## Related

ADR-0222, ADR-0207, ADR-0098, ADR-0203, ADR-0218, `docs/modules/erkhet.md`, `docs/modules/erxes.md`.
