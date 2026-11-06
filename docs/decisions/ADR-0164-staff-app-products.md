# ADR-0164: «Апп → Бараа» narrows only «Bto300»; the staff app's products are settings per staff

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («Зөвхөн Bto300 апп харагдах барааны тохируулдаг болго. Ажилтны апп дээр ажилтан бүрт ямар сегментийн барааг харуулахыг тохируулдаг болго … Тохиргоо үүсгэж хэдэн ч ажилтан сонгож болно, мөн хэдэн ч барааны segment тохируулж болно», with a picture of the same setting in Erxes; «Апп»-ын барааны тохиргоо дотор ажилтны апп гэж байх ба түүн дотор зураг шиг тохиргоо нэмнэ), Claude (the direct-mode session on main) |
| Amends | ADR-0127 #1 (one segment for both apps), ADR-0127 #2 («Бараа» holds both apps' settings) |

## Context

ADR-0127 made both apps sell from one product segment. Staff do not all sell the same goods: a warehouse's keeper works with its goods, the floor's sellers with theirs. The owner keeps such lists in Erxes as named settings of segments and staff, and asked for the same here, inside the «Апп» module's product settings.

## Decision

1. **`app_settings.assortment_segment_id` is «Bto300»'s alone.** The customer app's shop, home, orders and thumbnails keep narrowing by it; the staff app no longer reads it.
2. **A setting is a title, any number of product segments and any number of staff.** `staff_app_assortments` (title 1–120, soft delete so its audit rows keep naming something), `staff_app_assortment_segments` (no foreign key to `segments`, ADR-0127 #1's rule) and `staff_app_assortment_users` (migration `0082`). A staff member may stand in several settings.
3. **What a staff member sees.** The union of the live segments of all their settings. **With no setting naming them they see every sale-ready product**, and so does anyone whose every named segment was archived since: the shop keeps working until the office decides (ADR-0127 #1's rule). A setting with an archived segment says so on its card, and a save drops it.
4. **One rule in one service.** Every read of `SalesRepShopService` takes a required `ShopScope` (`customerScope()` or `staffScope(ctx)`), so none can forget whose shop it is: the page, products by id, the index both homes use, the suppliers, the thumbnails. The rep home's banners and sections are filtered by the rep's own universe. `POST /sales-rep/orders` refuses a product outside the scope with 409 `PRODUCT_NOT_IN_APP`. A banner's link is still checked against «Bto300»'s assortment. The general barcode lookup stays open, as ADR-0127 recorded; the product it opens loads through the narrowed batch route.
5. **Where it is kept.** «Апп → Бараа» (`/app/products`) has two tabs, «Bto300» and «Ажилтны апп» (`?tab=staff`). The second lists the settings as cards that fold: name, segments and staff as chips, «Хадгалах», «Устгах». No new menu entry, and the staff app's screens did not change: the server gives each person their products. `GET`, `POST`, `PUT /:id`, `DELETE /:id` under `/app-settings/staff-assortments` need `customer.home.manage` (ADR-0127 #5); the staff are found through `/users/lookup`, the segments through `/segments`. One audit row per change, with what it named before and after.

## Alternatives considered

- **A segment on each user's record:** one person's list per person, the opposite of what the owner asked; twenty sellers would mean twenty edits.
- **Staff see nothing until a setting names them:** on the day this ships every rep's shop would be empty. The owner can ask for it later; the page says what the default is.
- **Adding `segmentIds` to catalog's list filter:** the union is built in sales from `within`, one call per segment, with no change to catalog's contract and its keyset paging.

## Consequences

**Positive.** Each staff group sees its own goods; the setting is the owner's familiar shape; `ShopScope` makes a forgotten narrowing a compile error.

**Negative.** One more read per request (an indexed join) and one evaluation per segment on a narrowed person's shop reads. A staff member who was narrowed by `app_settings` before this change now sees everything until a setting names them.

## Related

ADR-0049, ADR-0052 (segments), ADR-0061, ADR-0068 (the staff app), ADR-0127, `docs/modules/sales.md`, `docs/modules/customer.md`, `docs/modules/segments.md`.
