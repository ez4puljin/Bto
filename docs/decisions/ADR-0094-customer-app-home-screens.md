# ADR-0094: The customer app's home screens (CA5)

| | |
|---|---|
| Status | Accepted (the CA5 plan and the owner's four answers, 2026-10-20) |
| Date | 2026-10-20 |
| Deciders | Owner (the CA5 plan, 2026-10-20), Claude (Claude Code session, CA5) |
| Implements | ADR-0092 (#1, #5–#8, #10, #12): «Bto300»'s home, lists, category page, cards, «Мэдэгдэл» and «Профайл» on the approved boards, over the server of ADR-0093 |
| Amends | ADR-0085 (the shop's sheet becomes the floating pill's two sheets), `docs/modules/mobile.md` §1a, §3, §6a, §9, §10 |

## Context

ADR-0092 decided the home as a shop window and the owner approved its redrawn boards on 2026-10-20. ADR-0093 (CA4, PR #12, merged as 09da290 the same day) built the server: `GET /customer-app/home`, `/sections/:key/products`, `/categories/:id/page`, `deal` and `dealPrice` on every card, the shop's `deals` / `new` / `inStock` flags and the cart's `orderDeals`. The app still showed the CA3 home: the debt card, the cart's banner, the last two orders, ★ tiles and «Холбоо барих».

In plan mode the owner answered four questions the boards left open (2026-10-20), each with the recommended answer.

## Decision

1. **The banners move by themselves:** every 5 seconds (`BANNER_SECONDS`), back to the first after the last, never while a finger is on them; they can be swiped, and the dots below choose one. A banner without a link (none, or a gone target) does nothing on a tap.
2. **«Ангиллын жагсаалт» → «Бүгд»** opens a new page «Бүх ангилал» (`/categories`): every top category the home lists, four a row with their pictures, each opening its category page. The home shows the first eight. The page reads the home's answer; no new route.
3. **A subcategory on a category page** opens «Бараа» filtered to it (as the board links it), not a page of its own.
4. **«Бараа»'s orders** are «Шинэ эхэндээ», «Үнэ өсөхөөр» and «Үнэ буурахаар». The board's «Нэрээр» is left out until the server can sort by name; CA5 changes only the app.
5. **A section's orders** (ADR-0093 #6): the section's own order (DEFAULT) comes first and is named after what it is — «Олон захиалснаар» for recent products, «Хямдрал ихээр» for promotions and discounts, «Шинэ эхэндээ» for a segment and the new products, «Сүүлд ♡ дарснаар» for favourites; an order that would repeat it is left out (DEAL on a discounts list, NEW on a segment); the prices follow.
6. **The card** (`src/customer/product-card.tsx`) is the board's, used on every list of the store: a white card with a hairline, the whole picture on grey (swiped when it has several, dots on the left), ♡ in the right corner, the badges at the bottom left — `deal.label` orange with dark text for a promotion, red for a discount, «Шинэ» blue —, the name in two lines, the pack line, the price per base unit with `basePrice` struck through above `dealPrice`, the stock word with its dot, a blue «+» or the cart's quantity. The rep app's card is unchanged (ADR-0085: a shared piece never changes what a rep sees); `CardPictures` gained its fit and its dots' side for it.
7. **The product page's sentence** is built in the app from `deal.threshold`, `effect`, `value`, `perUnitName` and `lastDay` (`dealSentenceOf`, words in mn.json): «10/31 хүртэл 20+ хайрцаг авбал 3% хямд. Хямдрал сагсанд өөрөө орно.» A category's step says «энэ ангиллаас нийт …»; an amount step «500,000₮ хүрвэл»; tugriks off per pack «хайрцаг тутамд 200₮ хямд»; a new price «үнэ нь 900₮ болно». The badge stays the server's `label`.
8. **«Сагс»** shows each order amount program on a blue note over «Дүн»: the next step and what is still missing («500,000₮ хүрвэл 3% хямд · дахиад 120,000₮»), else the step reached («Захиалгын 3% хямдрал орсон»). The quote stays the server's.
9. **«Мэдэгдэл»'s tabs** each count their unread; the screen opens on the first tab with any, «Захиалга» first. «Бүгдийг уншсан» marks both. A notice card shows its picture, or its kind's colour and icon without one.
10. **The cache.** The home, a section, a category page and the draft counts live under `['customer', 'products', …]`. ♡ marks every cached copy at once whatever its shape (`withFavourite`: arrays, pages, sections), a product page opens from any of them (`productsIn`), and a sent order refreshes the home («Сүүлд захиалсан бараа»).
11. **What left the app with the old home:** the debt card, the cart's banner, the recent orders and the ★ tiles (their helpers and the `useFavourites` / `useRecentStoreOrders` reads); «Холбоо барих» moved whole to «Профайл» (`src/customer/contacts.tsx`). The server's routes stay.
12. **Version 0.2.0** of «Bto300» (`variants.json`); the APK `bto300-0.2.0-<versionCode>.apk`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Banners moved only by hand | The owner chose the E-mart way: they move by themselves. |
| «Бүгд» opening «Бараа» with the filter sheet | The owner chose a page of every category with its picture. |
| A subcategory's own page | The board links it to «Бараа»; the owner kept that. |
| A server sort by name for «Нэрээр» | CA5 is the app only; the owner left it for later. |
| One label «Үндсэн» for every section's DEFAULT | It says nothing; naming the order after the section tells the store what it gets. |
| The rep's card frame with ♡ in its corner | The board's card differs (border, badges, «+» beside the price); changing the shared frame would change the rep's app. |
| Building the badge in the app with `dealLabel` | The server already sends `label`; the app would need Decimal conversions for the same text. |

## Consequences

**Positive.**
- The store's home sells: banners, categories and sections the admins steer, with the same card everywhere.
- ♡, the cart's quantity and the stock word agree on every list without a refetch.

**Negative.**
- The sentence's words live in the app; a new kind of step needs new words there.
- «Нэрээр» waits for a server change.

**Follow-ups.**
- The owner's walk on a phone (STATUS).
- A server sort by name, if the owner asks.
- The «1+1» pricing session (SPEC §11 #26) adds its own badge.

## Related

ADR-0068, ADR-0079, ADR-0085, ADR-0087, ADR-0092, ADR-0093, `docs/modules/mobile.md`, `docs/modules/customer.md`, `docs/SPEC.md` §5.17.
