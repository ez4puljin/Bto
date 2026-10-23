# ADR-0100: The rep app in «Bto300»'s look

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-23 |
| Deciders | Owner, Claude (Claude Code session, the rep-app chat) |
| Amends | ADR-0068 #1 and #11 (the boards' look and the 1.15 font cap), #2 (the floating tab bar), #12 (the home's header), #3 (the shop's card); ADR-0095 #10 («the rep app is unchanged») and #8 (the font cap, now both apps) |

## Context

«Bto300», the customer app, took the E-mart structure in Bto300's blue (ADR-0095): a blue header under the status bar, a flat white tab bar with the barcode camera raised in the middle, small measured sizes, white cards with a hairline. The rep app kept the iOS-like boards of ADR-0068: large titles, a floating pill tab bar, round buttons. The owner asked (2026-10-23): «Төлөөлөгчийн апп Bto300 хэв маягтай болгож өөрчил». Answers:

- **Scope:** every screen.
- **Tabs:** as «Bto300» — «Нүүр · Бараа · [Баркод] · Сагс · Захиалга»; «Профайл» and the bell in the home's header.
- **Home:** the rep's own content (this month, the cart, where orders land, the map, new products, the latest orders) in «Bto300»'s form.
- **Font:** the phone's larger font setting no longer enlarges the app, as in «Bto300».

## Decision

1. **One frame for both apps.** «Bto300»'s blue header and tab bar move to the shared kit (`src/ui/store-header.tsx`, `src/ui/store-tab-bar.tsx`). Both product cards draw on one frame (`src/ui/store-card-frame.tsx`: picture, badges, name, a grey line, price, stock, the cart or its quantity):
   - «Bto300»'s card looks exactly as before;
   - the rep's card shows the code with the pack on the grey line and the stock as a short count beside the cart («73 ш»; «Дууссан» or «Боломжгүй» in red), the product page keeping the full line;
   - the rep's card has no ♡ (reps keep no favourites); since 0.8.0 it shows the deal badge and the deal price with the old one struck through, as «Bto300» does (#10).
2. **The tabs** are «Нүүр · Бараа · [Баркод] · Сагс · Захиалга» on «Bto300»'s flat bar, the camera raised in the middle opening the scanner. «Профайл» becomes a page with ←, opened from the initials in the home's header. The bell with its unread count (ADR-0062 #3) sits beside them.
3. **Every page** has the blue header with ← and its title, and on the right the cart or the page's own button («Засах», «Бүгдийг уншсан», the orders' filter). The large titles and the round floating buttons are gone. The map keeps its controls over the map under the header.
4. **The home** keeps the rep's content as «Bto300»'s upper-case sections with › (0.7.0); since 0.8.0 «Bto300»'s shop window comes first (#9).
5. **«Бараа»** has the search field and the scanner in the blue header, a two-column grid, the count in the title, and «Bto300»'s floating «⇅ Эрэмбэлэх ≡ Шүүлтүүр» over the list. The rep's filters (category, home warehouse, main supplier, in stock) and sorts are unchanged.
6. **The font cap is 1 for both apps** (`FONT_SCALE_CAPS`): a larger setting does not enlarge them, a smaller one still shrinks them.
7. **Nothing else changes:** the rep's flows, the map, calls and the store history, and «Bto300»'s own look. The API changes only as #9 and #10 describe (0.8.0).
8. **Version 0.7.0** of the rep app.

### The home as «Bto300»'s shop window (the owner, 2026-10-23, after 0.7.0)

The owner asked «Төлөөлөгчийн Нүүрийг Bto300 шиг болго». Answers: the header with the search and the links row, the banners, the category list with pictures and the product sections, with the rep's blocks below them; deals shown on the rep's cards as in «Bto300»; «›» and categories open their own pages.

9. **The rep home** starts with «Bto300»'s shop window:
   - the blue header has «Bto», the search field (it opens «Бараа» searching), the scanner, the bell and the initials, then the upper-case links;
   - then the admins' banners, «АНГИЛЛЫН ЖАГСААЛТ ›» with the 4×2 category pictures, and the sections as rows of cards: promotions, the segments shown in the app, discounts, new;
   - below them come this month, the cart, where orders land, the map and the latest orders;
   - the store-own «Сүүлд авсан» and «Дуртай» sections are left out.

   The server is `GET /sales-rep/home`, `/sales-rep/sections/:key/products` and `/sales-rep/categories/:id/page`, in the customer module behind `sales.orders.rep` (sales cannot import customer). It shares `CustomerHomeService`'s product universe, section ids, tiles and banners with «Bto300», and its cards are the rep's product. «›» opens `/section/[key]`, and the categories open `/categories` and `/category/[id]`, all as in «Bto300». A category's «бүх бараа» opens «Бараа» filtered to it.
10. **Deals on the rep's products:** every `SalesRepProduct` carries its `deal` badge and `dealPrice` from the same rule as «Bto300»'s (`SalesRepShopService.withDeals`, the WHOLESALE deal book). The rep's card and product page show them. The order is still priced by the server's quote, which already applied the programs.
11. **Version 0.8.0.**

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Restyle only the main screens | The owner chose every screen. |
| Six tabs with «Профайл» in the bar | The owner chose «Bto300»'s five places, «Профайл» in the header. |
| «Bto300»'s shop-window home at first (0.7.0) | The owner first kept the rep's own home content, then after 0.7.0 asked for the shop window above it (#9). |
| Serve the rep home from the sales module | Sales may not import customer, which owns the banners and sections; customer already depends on sales. |
| No deal prices for reps | Deals already apply to rep orders; a promotions section without its prices would mislead. |
| Keep the 1.15 font cap | The owner chose «Bto300»'s exact sizes. |
| Stock words («Байгаа / Цөөхөн / Дууссан») on the rep's card | A rep needs the count to sell; words are for stores (ADR-0079 #4). |
| Copy «Bto300»'s components into the rep app | Two copies of one look would drift apart; the shared kit keeps them one. |

## Consequences

- The rep app and «Bto300» share the header, tab bar and card frame. A change to them changes both apps, which is intended.
- A rep with a large phone font setting sees smaller text than in 0.6.0.
- The quantity keypad (shared) turns the status bar dark while it is open, so its white page keeps readable icons under both apps' white-on-blue bar; this also fixes «Bto300».
- The phone needs the 0.7.0 APK. The API is unchanged, so 0.6.0 keeps working against the same server.

## Related

ADR-0068 (the rep app's design), ADR-0079, ADR-0094, ADR-0095 («Bto300»'s E-mart look), `docs/modules/mobile.md`.
