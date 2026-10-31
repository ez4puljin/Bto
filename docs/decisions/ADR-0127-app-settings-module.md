# ADR-0127: The «Апп» module — every app setting in one menu, the apps sell from one chosen product segment

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner (the request of 2026-10-31 «Апп дээр ямар бараануудыг харуулах, Апп баннер зураг, ямар бараатай segment харуулах гэх мэт тохиргоог систем дээрээс апп гэсэн цэс дээр бүгдийг төвлөрүүл» and one question round the same day: the products the apps show are «Барааны segment үүсгэж оноож өгнө»; both apps; sections on/off plus the segments' order; the stores link, a minimum order amount, the app's name and colour), Claude (the worker session «Апп» settings) |
| Amends | ADR-0114 #1 (an eighth business module), ADR-0092 #2 and #5 (the segments' order and the banners are kept from «Апп → Нүүр» too), ADR-0093 #5 (the fixed home sections may be switched off), ADR-0079 #4 and ADR-0061 #5 (the shops' universe is narrowed by the assortment segment), ADR-0079 #5 (a minimum order amount) |

## Context

The two apps — «Bto300» for the stores (ADR-0079) and the staff app «Bto Бараа дэлгэц» (ADR-0061) — grew their settings in four places on the web: «Систем → Харилцагчийн апп» (the contacts, the banners, whether orders land), «Систем → Аппын мэдэгдэл», the product segment page's «Апп» card (ADR-0092 #2) and «Самбарын тохиргоо → Сувгийн тохиргоо» (the channel's stage). Nothing said *which products* the apps show: both listed every ACTIVE, sale-ready product (the customer app also wants a home warehouse), so a product the owner does not sell through the apps still appeared there.

The owner asked for one menu, and answered the question round as the table above says. The brief had recommended a per-product switch; the owner chose a segment: the catalogue already has RULES and LIST product segments (ADR-0049, ADR-0052), and one segment can say «everything in these categories except these products» without touching 20,000 product rows.

## Decision

### 1. The apps sell from one product segment

- `app_settings.assortment_segment_id` (migration `0062_app_settings`, one row, `sales` module) names a live PRODUCT segment, RULES or LIST. Null means every sale-ready product, as before.
- The segment id has no foreign key: `segments` is a leaf nobody imports (ESLint G1). It is re-checked on every read through catalog's `PRODUCT_SEGMENT_DIRECTORY` hook (ADR-0093 #3). An archived or deleted segment narrows nothing (`assortment.broken`), so the apps keep selling until the office picks another; the «Апп → Бараа» page shows the warning.
- The narrowing happens in one place, sales' `SalesRepShopService`: the page, the index (both homes), products by id (the cart, a barcode, a notice, a banner's product), the thumbnails and the suppliers all pass the segment to catalog's `within`. The customer app's home warehouse rule (ADR-0079 #4) stays on top of it.
- An app order carries only such products: `assertUnitsListed` refuses `POST /customer-app/orders` and `POST /sales-rep/orders` with 409 `PRODUCT_NOT_IN_APP` naming the product ids. The office's own orders are not narrowed.

### 2. One menu: the «Апп» module

The top bar's eighth business module (`key: 'app'`, after «Супермаркет»; ADR-0114 said seven) holds, in order: «Нүүр» (banners, the fixed sections' switches, the shown segments and their order), «Бараа» (the assortment segment), «Захиалга» (whether app orders land and where, the minimum order amount), «Холбоо барих», «Мэдэгдэл» (the notices of both apps, moved from «Систем»), «Дэлгүүрүүд» (links to the customers list by app account) and «Ерөнхий» (the app's name and colour). The old paths `/system/customer-app`, `/system/customer-app/banners` and `/system/app-notices` redirect. The segment page's «Апп» card stays; both edit the same `app_position`.

### 3. The home's fixed sections may be switched off

`home_promotions`, `home_discounts`, `home_new` (default on). A switched-off section is left off `GET /customer-app/home` and `/sales-rep/home` and its list answers 404; RECENT and FAVOURITES are a store's own and always shown; a category page keeps its «Шинэ» and «Хямдралтай» rows. The segments' order stays `segments.app_position` (ADR-0092 #2).

### 4. The minimum order, the name and the colour

- `min_order_amount` (whole MNT, null = none): `POST /customer-app/orders` quotes the lines today, as the office will price them, and refuses an order under it with 422 `ORDER_BELOW_MINIMUM` (`min`, `total`). `GET /customer-app/me` and `/checkout` carry `minOrderAmount` so the app can say so before sending. The reps' orders are not limited.
- `app_name` (≤ 40) and `app_color` (`#RRGGBB`), null = the apps' built-in ones: exposed on `/customer-app/me`, `/customer-app/checkout`, `/sales-rep/context` and the public `GET /app-settings/branding` (the sign-in screens have no token). Today both apps hard-code their name (i18n) and colour (`src/theme/tokens.ts`); reading these fields is the app chats' next versions.

### 5. Rights and audit

`GET /app-settings` and `PUT /app-settings` (the whole row each time) need `customer.home.manage` — the home's keepers (ADR-0092 #9); the api's permission guard requires every permission named on a route, so no «or»; no new permission. One `app_settings` UPDATE audit row with the fields before and after.

## Alternatives considered

- **A per-product «Аппд харуулах» column** with a bulk action and a list filter (the brief's recommendation): one more thing to keep on 20,000 rows; the owner chose the segment, which already has rules, lists, Excel and a page.
- **A per-category switch:** coarser than a segment and a second mechanism beside it.
- **Storing the setting in identity's effective-dated `settings`:** built for tax rates; a nullable segment id, three switches and a colour fit a row better, and `customer` cannot be read by `sales` (the rep shop), so the row lives in `sales`.
- **A foreign key to `segments`:** forbidden by the module boundaries (segments imports sales' betters, nobody imports segments); the banners' `link_id` precedent re-checks on read instead.

## Consequences

**Positive.** One menu for everything the apps show; the owner decides the apps' assortment with the segment tools; both apps and both homes follow one rule in one service; the apps can carry the company's name, colour and minimum.

**Negative.** Each shop read resolves the segment once more (one indexed query; a RULES segment evaluates its conditions). An archived assortment segment silently widens the shop until the office notices the warning. The staff app's general barcode lookup (`/barcodes/:code`, catalog) is not narrowed; the product it opens then loads through the shop's batch route, which is.

**Follow-ups.** The apps read `appName`, `appColor` and `minOrderAmount` (the customer app's cart hint) in their next versions. A CHECK or a hook that refuses archiving the assortment segment, if the owner wants it.

## Related

ADR-0049, ADR-0052 (segments), ADR-0061, ADR-0068 (the staff app), ADR-0079, ADR-0092, ADR-0093 (the customer app and its home), ADR-0114 (the top bar), `docs/modules/sales.md` §2–§4, `docs/modules/customer.md` §4–§5, `docs/modules/segments.md`, `docs/ui.md` «The shell».
