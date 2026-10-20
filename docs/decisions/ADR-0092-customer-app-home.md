# ADR-0092: The customer app's home as a shop window — banners, a category grid, product sections from chosen segments, promotions and discounts

| | |
|---|---|
| Status | Accepted (the owner approved the redrawn boards on 2026-10-20) |
| Date | 2026-10-20 |
| Deciders | Owner (three interview rounds, 2026-10-20), Claude (Claude Code session, the customer-app chat) |
| Amends | ADR-0079 (#13: the home board and the product card; #14: «Холбоо барих» moves from «Нүүр» to «Профайл»), ADR-0082 (the `customer` module gains banners and the home; segments and catalog gain app fields), ADR-0049 / ADR-0052 (a product segment can be shown in the app) |

## Context

The owner sent screenshots of the E-mart Mongolia app and asked: «Апп загварыг ийм болго». The approved boards (ADR-0079 #13) put the store's account on «Нүүр»: the debt card, the cart banner, recent orders, favourites and «Холбоо барих». The owner's example was a product segment «Автомашины бүтээгдэхүүн» described «Өвөлдөө бэлдэцгээе». Created by an admin, it should appear on the home the way the screenshot shows it. Products with promotion or discount settings should appear the same way. If no promotion or discount is set, there is no such section.

What exists on `main` (2026-10-20):
- **Segments** (ADR-0049, ADR-0052) have a name and a description, nothing for the app.
- **Categories** have no picture.
- **Discount programs** (ADR-0041) discount a product, a category subtree or the order, with steps and `valid_from` / `valid_to`. A promotion is a discount with an end date (SPEC §6.1 #5).
- **Pricing** has no free-goods offers such as «1+1» or «2+1».

The owner's answers (2026-10-20):
- Only chosen segments become sections.
- «Урамшуулал» and «Хямдралтай бараа» are separate sections.
- «1+1» / «2+1» come later, as their own pricing work.
- Banners come from a separate admin menu, and a banner opens a segment, a category or a product.
- Admins upload category pictures.
- The debt, recent orders and contacts leave the home.
- The colour stays blue.
- Section order is fixed.
- Automatic sections: «Сүүлд захиалсан бараа», «Шинэ бараа», «Дуртай бараа».
- A new right manages all of this.

## Decision

1. **The home, top to bottom.**
   - The header: the «Bto300» mark, the bell with its count, and the store's initials that open «Профайл».
   - The search field that opens «Бараа», with the scanner beside it.
   - Quick-link chips, one per section shown.
   - The banner carousel, with its dots.
   - «Ангиллын жагсаалт»: top categories as pictures, four per row, two rows, with «Бүгд».
   - The product sections, in this fixed order:
     1. «Сүүлд захиалсан бараа»
     2. «Урамшуулал»
     3. the chosen segments, in their position order
     4. «Хямдралтай бараа»
     5. «Шинэ бараа»
     6. «Дуртай бараа»

   A section without products is not shown. A section is its title, a subtitle, up to 10 product cards in a horizontal row, and a chevron to its full list.

2. **Segments in the app.**
   - A product segment, RULES or LIST, gets `segments.app_position` (an integer, NULL = not shown).
   - On the segment page, holders of #9 set «Апп-д харуулах» and move it up or down among the shown segments.
   - The section's title is the segment's name; its subtitle is the description, or nothing.
   - Customer and supplier segments never show.

3. **Promotions and discounts** come from the WHOLESALE discount programs in force on the business date.
   - **Which products:** a PRODUCT program marks its product; a CATEGORY program marks the products of its subtree.
   - **«Урамшуулал»** holds the products of programs with an end date; its subtitle names the earliest end.
   - **«Хямдралтай бараа»** holds the products of programs without one. A product in both shows in «Урамшуулал» only.
   - **ORDER programs** make no section. The cart says what the order still needs, for example «500,000₮ хүрвэл 3%».
   - **No programs, no sections.**
   - **The badge** is built from the program's first step: «−5%», «−200₮», or a new price with the old one struck through. A threshold above one base unit adds «10+ ш» or «20+ хайрцаг»; a promotion adds its end, for example «· 10/31». Promotions are orange, discounts red.
   - **Prices** stay the server's (ADR-0006 #6). The badge only describes the program; the quote applies it.
   - **«1+1» / «2+1»** free-goods offers are a later pricing session (SPEC §11 #26), not part of this decision.

4. **Automatic sections.**
   - **«Сүүлд захиалсан бараа»:** the store's products from its orders of the last 90 days, the most often ordered first.
   - **«Шинэ бараа»:** products that became sale-ready in the last 14 days (the rep app's rule).
   - **«Дуртай бараа»:** the store's favourites.

   Every section shows only what «Бараа» sells: active, sale-ready products with a home warehouse, with stock words. «Дууссан» products come last.

5. **Banners.**
   - `app_banners` in the `customer` module holds:
     - a required picture, 2:1 (for example 1200×600), through the storage service
     - a short title, used as alt text
     - a link: NONE, SEGMENT, CATEGORY or PRODUCT, with its id
     - `valid_from` / `valid_to`, a position, `archived_at`
   - The admin page is «Систем» → «Харилцагчийн апп» → «Баннер».
   - The home shows the running banners in position order. A tap opens the link: a segment's full list, a category's page, or a product.
   - A banner linked to a category also heads that category's page.

6. **Categories.**
   - `categories.image_file_id` is optional, for top-level categories, and is uploaded on the category's page by holders of #9.
   - Without a picture, the grid shows a picture of one of the category's products.
   - The grid lists top categories that have sale-ready products, by name.
   - **A category's page** shows:
     - its banners
     - its subcategories as round pictures
     - «Шинээр нэмэгдсэн бараа» and «Хямдралтай бараа» of the subtree
     - «… бүх бараа · N», which opens «Бараа» filtered to it.

7. **Lists and cards.**
   - **A section's full list:** title, subtitle and count, a two-column grid, and a floating «Эрэмбэлэх | Шүүлтүүр» pill.
   - **«Бараа»:** the count in its title; chips «Бүгд · ♡ Дуртай · Хямдралтай · Шинэ»; the same pill; a filter sheet with categories and «Зөвхөн байгаа бараа».
   - **The product card everywhere:**
     - the picture
     - ♡, replacing ★; favourites themselves are unchanged
     - badges: promotion orange, discount red, «Шинэ» blue
     - the name in two lines and the pack line
     - the price per base unit, with the old price struck through for an unconditional discount
     - the stock word and «+»
   - **The product page** gains the program's sentence, for example «20+ хайрцаг авбал 3% хямд».

8. **What leaves the home** (amends ADR-0079 #13, #14):
   - The debt and the overdue amount stay on «Тооцоо»; the cart's credit warning stays.
   - The cart count stays on its tab.
   - Recent orders are on «Захиалга».
   - «Холбоо барих» moves to «Профайл»: the same list and direct calls.

   **«Мэдэгдэл»** gets two tabs:
   - «Захиалга»: orders, payments, invoices.
   - «Урамшуулал»: the admin's notices as picture cards.

9. **Rights.** A new permission `customer_app.home.manage` («Апп-ын нүүр удирдах»), held by ADMIN and assignable to custom roles. It covers banners, the segments' app flag and position, and category pictures.

10. **Look.** Bto300's blue, Inter and the rep app's kit stay. Only the structure is taken from the E-mart screens, never their brand.

11. **Server shape** (settled in CA4's plan mode). A `CustomerHomeService` in the `customer` module assembles the home from public services: segments, catalog, pricing, sales and inventory. Routes, each reading only the token's own store:
    - `GET /customer-app/home`
    - `GET /customer-app/sections/:key/products` (cursor, sort, filters)
    - `GET /customer-app/categories/:id/page`

    `app_banners`, `segments.app_position` and `categories.image_file_id` arrive in one migration.

12. **Boards.** The artifact «Bto300 дэлгэц» (https://claude.ai/artifact/GFhasAC4DUASUM2WibYuRe) was redrawn on 2026-10-20:
    - new or redrawn: «Нүүр», «Хэсгийн бүх бараа», «Ангиллын хуудас», «Бараа»
    - updated: the product page, «Мэдэгдэл», «Профайл»

    The owner approved them unchanged on 2026-10-20; CA5 builds the screens on them.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Every product segment with a description in the app | Internal segments («Дутуу мэдээлэлтэй») would show; the owner chose a flag. |
| One «Хямдрал, урамшуулал» section | The owner chose two, as E-mart shows «+1» and «Хямдралтай» apart. |
| Free-goods «N+1» offers now | They change quotes, invoices, stock and e-Barimt; a pricing session of their own. |
| Banners from app notices | The owner chose a separate banner menu with links. |
| Admin-ordered sections | The owner chose a fixed order; only the segments' order moves. |
| Keeping the account on «Нүүр» | The owner moved it off the home; «Тооцоо» and «Профайл» hold it. |
| E-mart's yellow | The owner kept Bto300's blue. |

## Consequences

**Positive.**
- The home sells: admins steer it with segments, banners and discount programs they already keep, and it never shows an empty promotion.
- Reordering is one row away for every store.

**Negative.**
- Three new admin surfaces (banners, a segment flag, category pictures) and a home query that touches five modules.
- «Тооцоо» becomes the only place for the debt; the cart warning remains the reminder when ordering.

**Follow-ups.**
- **CA4:** the server and the admin web: migration, permission, banners page, segment flag, category picture, the three routes, tests.
- **CA5:** the app screens on the approved boards.
- **Later:** the «1+1» pricing session (SPEC §11 #26), which adds its own badge.

## Related

ADR-0006, ADR-0041, ADR-0048, ADR-0049, ADR-0052, ADR-0062, ADR-0079, ADR-0082, ADR-0085, ADR-0087, `docs/SPEC.md` §5.17, §6.1, §11 #26.
