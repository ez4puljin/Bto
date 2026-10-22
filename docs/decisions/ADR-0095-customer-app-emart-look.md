# ADR-0095: «Bto300» in the E-mart structure and sizes

| | |
|---|---|
| Status | Accepted (the owner, 2026-10-21: the redrawn boards approved with «Тийм. Энэ хэмжээ, хэв маягаар бүх дэлгэцийг апп-д хий») |
| Date | 2026-10-21 |
| Deciders | Owner (three answers and two looks at the boards, 2026-10-21), Claude (Claude Code session, CA5) |
| Amends | ADR-0092 #1, #7, #10 (the home's look; only the structure was E-mart's), ADR-0094 #6 (the card), ADR-0079 #13 (the tabs), ADR-0068 #11 (the font cap, for «Bto300» only) |

## Context

«Bto300» 0.2.0 (CA5, ADR-0094) drew the home as a shop window on the rep app's kit: large titles, a floating pill tab bar, round controls. After the first look on the phone the owner asked: «Апп харагдах байдлыг яг Emart шиг болгож надад харуул» and, after the redrawn boards, «Апп бүх харагдац жижигхэн болго. Яг ийм хэмжээтэй байна» with an E-mart screenshot. The owner's answers (2026-10-21):

- **Colour:** Bto300's blue stays; only the structure is E-mart's.
- **Tab bar:** flat and white, the barcode camera raised in the middle.
- **Card:** no stars (there are no ratings), a cart icon instead.
- **Scope:** every screen.

## Decision

1. **The blue header** (`src/customer/store-header.tsx`) runs under the status bar, which turns white while the store is signed in:
   - the home has two rows: «Bto300», the search field with the scanner in it, the bell and the store's initials; then the sections' names as upper-case links;
   - every other page has ← with its title and, on the right, the cart with its count — or its own button («Засах», «Бүгдийг уншсан», the orders' filter);
   - the large titles are gone.
2. **The tab bar** (`src/customer/store-tab-bar.tsx`): «Нүүр · Бараа · [Баркод] · Сагс · Захиалга», flat and white along the bottom, the barcode camera a raised blue circle in the middle. «Тооцоо» leaves the tabs: it opens from «Профайл» (a new first row) as a page with ←.
3. **The home** (E-mart's order):
   - the banners edge to edge, still 2:1 (the admins' banners are cut 2:1, ADR-0093 #8), with dark and grey dots;
   - «АНГИЛЛЫН ЖАГСААЛТ ›» in upper case, the category pictures without a frame;
   - a thin rule;
   - each section's heading in upper case with an icon (the history, a megaphone, a tag, a sparkle, a heart), its line and ›.
4. **The card** (amends ADR-0094 #6):
   - white with a hairline and 10 px corners;
   - the whole picture on white;
   - ♡ in black outline (red when on);
   - the badges under the picture — the program's label, «ШИНЭ» in capitals;
   - the name on one line, the pack, the price with the old one struck through beside it;
   - the stock word with its dot and a cart icon (or the cart's quantity).
5. **Lists:**
   - two columns;
   - the floating pill is blue «⇅ Эрэмбэлэх ≡ Шүүлтүүр», with a round «дээш» once the list has scrolled;
   - a section's or a category's count goes in the header's title («Хямдралтай бараа (24)»);
   - a category page's subcategories are larger pictures without a frame, and «АНГИЛЛЫН БҮХ БАРАА · N» is a grey full-width button.
6. **«Мэдэгдэл»'s tabs** are two wide buttons, the open one blue, the other grey; the page is white, groups and cards with a hairline.
7. **Sizes, measured on the owner's E-mart screenshot** (1080 px wide ≈ 411 dp; `storeType` in `src/theme/tokens.ts`):

   | Part | Size |
   |---|---|
   | Header row | 48 (the home's 46, its search field 34) |
   | Header title | 17 |
   | Headings | 16–17, regular, upper case |
   | Card | 164 wide in a row, the picture 146 |
   | Card name / pack / price | 15 / 13 / 16 |
   | Badges | 20 high |
   | Tab bar | 56 high, labels 11, the camera 50 |
   | Pill | 44 high |

   Touch targets stay 44 through hit slop.
8. **The phone's font size setting no longer enlarges «Bto300»** (`fontScaleCap`: 1 for the customer variant; the rep app keeps 1.15, ADR-0068 #11): the owner asked for exactly these sizes.
9. **Not taken from E-mart:**
   - its logo, mascot and yellow;
   - star ratings;
   - delivery and «Scan&Go» marks;
   - its 3:1 banner (ours stay 2:1 until the admin web cuts another shape).
10. **The rep app is unchanged:** every new part is the customer variant's (`src/customer/*`); the shared kit only gained `CardPictures`' fit and dots (ADR-0094) and the variant's font cap.
11. **Version 0.3.0** of «Bto300».

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| E-mart's yellow | The owner kept Bto300's blue (2026-10-20 and again 2026-10-21). |
| Keeping the floating pill tab bar | The owner chose E-mart's flat bar with the camera raised in the middle. |
| Star ratings on the cards | There are no ratings; the owner chose the cart icon instead. |
| Keeping the 1.15 font cap | The phone's larger font setting made every size about 15% bigger than E-mart's; the owner asked for exactly E-mart's sizes. |
| A 3:1 banner | The admins' banners are cut 2:1 (ADR-0093 #8); changing it is admin web work. |

## Consequences

**Positive.**
- «Bto300» looks like the shop app the owner's customers already know, in Bto300's colour.
- The rep app does not change.

**Negative.**
- A store with a large font setting reads E-mart's sizes, not larger ones.
- «Тооцоо» is one tap deeper: from «Профайл».

**Follow-ups.**
- The owner's walk with APK 0.3.0.
- A 3:1 banner, if the owner asks: the admin web's cutting and ADR-0093 #8.

## Related

ADR-0068, ADR-0079, ADR-0085, ADR-0092, ADR-0093, ADR-0094, the boards «Bto300 дэлгэц» (https://claude.ai/artifact/GFhasAC4DUASUM2WibYuRe, versions 24–25), `docs/modules/mobile.md`.
