# ADR-0163: Every category has a colourful icon, read from its name

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («Bto300 аппын ангилалын жагсаалт дээрхи тохирох icon оруул. Систем ангилалын жагсаалт дээр дээрхи icon харагддаг байхаар. Өнгөлөг гоёмсог тухайн ангилалын нэрийг уншиж тохирох icon бүтээж оруул»), Claude (the direct-mode session on main) |
| Amends | ADR-0092 #6 (a tile without its own picture no longer borrows a product's thumbnail) |

## Context

«Bto300»'s category grid showed a category's own picture, else a thumbnail of one of its products, else a grey box. No category on the development data has a picture of its own, only a top category may have one, and a product's thumbnail says little at 56 px. The owner asked for a matching, colourful icon on the app's list and on the system's category list, made by reading each category's name.

## Decision

1. **The drawings ship with the code.** `@tugeel/shared/category-icons` holds 96 flat drawings on a 64×64 canvas, each on a soft two-tone tile, drawn for this system. They are plain SVG shapes: the web shows them as an image from a `data:` address (the Caddyfile's `img-src` allows it), the phones through `SvgXml` of `react-native-svg`. Nothing is uploaded, nothing is fetched, and they work offline. The colours are the drawings' own, not the design tokens.
2. **The name decides by default.** `suggestCategoryIcon(name)` reads the name against an ordered list of words, the particular above the general («Цонхтой чихэр, печень» is a box, «Иштэй чихэр» a lollipop, «Элсэн чихэр, Давс» salt); a word fits from a word's start, or whole when written with a trailing space. An unknown name gets `bag`, «Ангилаагүй» its own drawing. A new or renamed category therefore has its icon at once, and no data migration was needed. The words are Mongolian in `packages/shared`, like the search keys' tables: they are matching rules, not text on a screen.
3. **The office may choose another.** `categories.icon_key` (migration `0082`, null = follow the name, length-checked, the DTO accepts only known keys) is set from the category's dialog, «Дүрс», with `catalog.products.manage` like the rest of the dialog. An unknown stored key (an older app than the server) falls back to the name: `categoryIconOf`.
4. **Where they show.** `/catalog/categories` draws it in place of the folder icons. «Bto300» and the staff app draw it on the category grid and the subcategory tiles, whose payloads gain `iconKey`.
5. **A category's own picture still wins.** A top category's uploaded picture (ADR-0092 #6) is shown instead of the icon. The fallback to a product's thumbnail is gone: `imageUrl` is now only the category's own picture, which also spares the home one query.

## Alternatives considered

- **PNG pictures uploaded through the existing picture route:** only top categories may carry one, 89 of the 104 categories could not, and a new category would have none until someone drew one.
- **An icon font or an emoji set:** one colour per glyph, or the look of another product's emoji, and a licence to carry.
- **Assigning each of today's categories by hand in a data migration:** the names live in the owner's database, not in this public repository, and a new category would still have none.

## Consequences

**Positive.** Every category has an icon on both screens without anyone doing anything; a wrong guess is one click to change. Apps need a new build to draw the icons; an older build ignores `iconKey` and shows a box for a tile without a picture.

**Negative.** About 45 KB of strings in the web's and the phones' bundles. A drawing added later reaches a phone only with a new build, and until then the phone falls back to the name's drawing.

## Related

ADR-0079, ADR-0092, ADR-0095 («Bto300»), ADR-0044 (the category tree), `docs/modules/catalog.md`, `docs/modules/customer.md`.
