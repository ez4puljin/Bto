# ADR-0093: The customer app's home — its server and admin web (CA4)

| | |
|---|---|
| Status | Accepted (the CA4 plan and its defaults approved by the owner on 2026-10-20) |
| Date | 2026-10-20 |
| Deciders | Owner (the CA4 plan, 2026-10-20), Claude (Claude Code session, CA4) |
| Implements | ADR-0092 (#1–#11): the server and the admin web of «Bto300»'s home; CA5 builds the screens |
| Amends | ADR-0049 #4 (segments now also bind a second catalog hook), ADR-0092 #9 (the right's code is `customer.home.manage`), ADR-0082 (the `customer` module gains banners and the home), `docs/modules/customer.md`, `segments.md`, `catalog.md`, `pricing.md`, `sales.md` |

## Context

ADR-0092 decided what «Bto300»'s home shows and left its server shape to CA4's plan mode (#11). On 2026-10-20 (main 9327b24) nothing of it existed:

- no banners, no app flag on segments, no picture on categories;
- discount programs were read only by the quote, which needs a whole cart;
- the customer module could not read segments: nothing imports segments (ESLint G1, ADR-0049 #4), and the customer module imports nothing that segments could bind for it.

The owner approved the plan with eight defaults on 2026-10-20 (below, #8).

## Decision

1. **One migration, `0036_customer_app_home`.**
   - `app_banners` (customer): a required picture (`customer.banner_image`, public, ≤ 1 MB), a title of 1–80 characters (its alt text), `link_kind` NONE / SEGMENT / CATEGORY / PRODUCT with `link_id` (CHECK: NONE exactly when no id), `valid_from` / `valid_to` (exclusive, like notices and discount programs), `position`, `archived_at`, created and updated by and at. No foreign key on `link_id`: the targets belong to other modules (customer's schema may not reference segments) and every read checks them again. `REVOKE DELETE, TRUNCATE` from app: banners are archived.
   - `segments.app_position` smallint: CHECK it is set only on a live PRODUCT segment; archiving clears it in the same statement.
   - `categories.image_file_id` → `files`: CHECK only a category without a parent has one; moving it under a parent or deleting it drops the picture in the same statement and marks the file deleted.
   - Both position constraints are `UNIQUE … DEFERRABLE INITIALLY IMMEDIATE`, written by hand (Drizzle 0.45 cannot say it): two rows swap places in one UPDATE, checked at the statement's end. Positions may have gaps; an advisory lock per list (72_036_001 segments, 72_036_002 banners) serialises the changes.
2. **The right `customer.home.manage`** («Апп-ын нүүр удирдах», ADR-0092 #9): ADMIN, assignable. ADR-0092 wrote `customer_app.home.manage`; a permission code starts with its module's name in lowercase letters (`<module>.<resource>.<action>`, checked by `auth.test.ts`), so the code is `customer.home.manage` — the label is unchanged. It guards the banner routes, `PUT /segments/:id/app`, `POST /segments/:id/app/move`, `PUT` / `DELETE /categories/:id/image` and the file kinds `customer.banner_image` and `catalog.category_image` (public, ≤ 512 KB).
3. **Segments through catalog.** Catalog declares a second hook, `PRODUCT_SEGMENT_DIRECTORY` (live product segments by id, or those the app shows in their order), bound by the segments module like `PRODUCT_SET_RESOLVER`; `ProductQueryService.productSegments()` passes it on, and a segment's members come from `ProductQueryService.within({ segmentId })`. The customer module never imports segments; MODULE_DEPS and the ESLint guards are unchanged.
4. **Deals in pricing.** `ProductDealsService` reads the WHOLESALE programs in force on the business date once per request (`DiscountProgramsService.inForceViews`) and marks products: a PRODUCT program its product, a CATEGORY program every product of its subtree (catalog's `category IN` answer); ORDER programs are kept apart for the cart.
   - A product marked by a program with an end date is a **promotion**, otherwise a **discount**; in both it is a promotion only. «Хямдралтай» (the shop's chip, a category page's «Хямдралтай бараа») is both together.
   - **The badge** (`@tugeel/shared/pricing` `dealOf` / `dealLabel`) comes from the first step: «−5%», «−200₮», a new price «900₮»; a PRODUCT threshold above one base unit adds «10+ ш» (in the chosen threshold unit when whole, «20+ хайрцаг»), a CATEGORY threshold «20+ хайрцаг» or «500,000₮+»; PRICE or AMOUNT on a pack unit adds it («−200₮/хайрцаг»); a promotion adds its last day («· 10/31»). The label holds digits, ₮ and the units' own names; the app's sentences come from mn.json. The structured fields go with it.
   - **Which program a card shows:** a promotion before a discount, a product's own before a category's, then the bigger discount, then the older program.
   - **The size of a discount** (`dealPercent`, the «Хямдрал ихээр» order): a percentage as it is; a new price or tugriks off against the program unit's warehouse price; a category's or the order's tugriks off the total cannot be told and sort last.
   - **The struck-through price** (ADR-0092 #7, «unconditional»): only for programs whose first step always applies — a PRODUCT program from at most one base unit, a CATEGORY percentage from zero. `PriceQuoteService.packPrices` prices one whole pack (one base unit without packs) alone, through the pure `resolveQuote` with one load of terms, profiles and units, without and with those programs; the card shows the per-base result when it is lower. A program on the piece unit of a packed product reaches loose pieces only, so it shows no struck price. The cart is always the server's quote.
   - **ORDER programs** make no section. `POST /customer-app/quote` answers `orderDeals`: each program's step reached and the next one with the amount still missing, measured on the cart's amount after its category programs (`resolveQuote` returns `orderAmount`).
5. **The home** (`CustomerHomeService`, ADR-0092 #1). One read of the shop's index — every product «Бараа» lists (active, sale-ready, with a home warehouse) in the NEW order with its category and sale-ready moment (`SalesRepShopService.index`, catalog's `ProductQueryService.index`) — and of what is free at home (inventory) serves every section:
   - **recent:** the store's orders created in the last 90 days, today included, from every channel, cancelled ones and empty drafts left out; the product in the most orders first, then the most recently ordered (`CustomerOrdersService.recentProducts`);
   - **promotions, discounts:** the biggest discount first; «Урамшуулал» names the earliest last day;
   - **each shown segment:** its members, the newest first; its name the title, its description the subtitle; a segment whose conditions no longer hold is skipped, never the home;
   - **new:** sale-ready within `NEW_PRODUCT_DAYS` of now, the rule of the cards' «Шинэ»;
   - **favourites:** the token's own account, the latest ♡ first.

   Every section carries at most 10 cards and its `total`, «Дууссан» last; an empty section is left out. The banners are the running ones in position order; a link whose target is gone (an archived segment, a deleted category, a product the app no longer lists) is sent as `link: null`. The category grid lists the top categories holding listed products, by name, with their own picture or the thumbnail of one of their 20 newest listed products.
6. **A section's full list** (`GET /customer-app/sections/:key/products`; keys `recent`, `promotions`, `discounts`, `deals`, `new`, `favourites`, `segment-<id>`): sorts DEFAULT (the row's own order), DEAL, NEW, PRICE_ASC, PRICE_DESC, «Дууссан» always last; filters `categoryIds` (with subcategories) and `inStock`. The order is computed per request; the cursor names the key, the sort, the first page's business day, the last product shown and how many came before (a product gone meanwhile falls back to that count); another key or sort answers 422. A segment's list opens only while the app shows it or a running banner links it; anything else is 404.
7. **A category's page** (`GET /customer-app/categories/:id/page`): the category, the products «Бараа» lists in its subtree (`productCount`), its running banners, its subcategories holding listed products, and the `new` and `deals` sections of the subtree (at most 10 each).
8. **The owner's defaults (2026-10-20):**
   - recent counts every channel, cancelled orders left out (#5);
   - the struck price only for an unconditional discount, on one whole pack (#4);
   - one badge per product, a promotion first (#4);
   - the home rows' orders as in #5;
   - a banner is cut to 2:1 (1200×600) in the browser and never edited — a wrong one is archived and made again; a gone target leaves the banner without its link, marked «Холбоос ажиллахгүй» in the admin list; a banner may link a product segment the home does not show;
   - a category picture is square (512×512), set from the categories tree (a row action on top categories), no category page of its own; a move under a parent or a delete drops it;
   - the right as in #2, and the «Харилцагчийн апп» menu open to it too;
   - ORDER programs only as the cart's hint.
9. **Admin web.** «Систем» → «Харилцагчийн апп» → «Баннер» (`/system/customer-app/banners`): the banners in order with link, period and state, ↑ ↓, «Архивлах» (asked first), «Идэвхтэй / Архивласан», and «Баннер нэмэх» (`?new=1`). The «Харилцагчийн апп» page gains a «Баннер» card; its contact list stays with `identity.settings.read`. A product segment's page gains «Bto300 апп» (the switch, its place, ↑ ↓); the segments list marks shown ones «Апп». The categories tree gains an «Апп-ын зураг» column and row action. `RequirePermission` and menu entries take any of several rights.
10. **The shop.** `GET /customer-app/products` gains the filters `deals`, `new` and `inStock` (the chips and «Зөвхөн байгаа бараа» of ADR-0092 #7), and every product the app reads (the shop, a batch, a barcode, the home, a section, a category page) carries `deal` and `dealPrice`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Let `customer` import `segments` (a new MODULE_DEPS edge) | ADR-0049 #4 says nothing imports segments and the guard says to declare a hook; a hook keeps both rules intact. |
| Struck price whenever one pack reaches a step («10+ ш» with a box of 12) | ADR-0092 #7 says «unconditional discount»; the board shows conditional deals without one. |
| Quote every card through `PriceQuoteService.quote` | One quote per card is a dozen reads each; the pure resolver with one load does the same. |
| Banner link columns with foreign keys per kind | Customer's schema may not reference segments; a category delete would hit the key. A checked `link_id` and a broken-link mark cost less. |
| A category page in the admin web for its picture | Every row action of the tree would move there (docs/ui.md: records with their own page are edited from it); a dialog from the tree is enough for one picture. |
| Offsets for section cursors | The repo's lists page by keys; the last product plus a count keeps a page after a change close to right. |

## Consequences

**Positive.**
- CA5 has every read it needs: the home, a section, a category page, badges and struck prices on every card, the shop's chips and the cart's hint.
- Admins steer the home with banners, two clicks on a segment and a picture per top category; no program, segment or category changes shape.

**Negative.**
- The home reads the whole shop index (up to ~20,000 rows) and the programs once per request; measured on the dev database before any cache.
- A banner cannot be edited; a mistake costs an archive and a new upload.
- A badge describes the first step only; deeper steps show in the cart.

**Follow-ups.**
- **CA5:** the screens on the approved boards (`docs/modules/mobile.md` §6a).
- Banner editing, a cache of the shop index per business date, sorted promotions by end date: only if the owner asks.
- The «1+1» pricing session (SPEC §11 #26) adds its own badge.

## Related

ADR-0041, ADR-0049, ADR-0052, ADR-0068, ADR-0079, ADR-0082, ADR-0092, `docs/modules/customer.md`, `docs/SPEC.md` §5.17.
