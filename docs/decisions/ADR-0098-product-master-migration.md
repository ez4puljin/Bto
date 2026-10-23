# ADR-0098: The product master migration from Erxes

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-22 |
| Deciders | Owner, Claude (Claude Code session, started by the coordinator «Bto удирдлага») |
| Amends | ADR-0029 #1 (a numeric code of GTIN length with a wrong check digit is kept as printed); applies ADR-0036, ADR-0044 #1, ADR-0048 and ADR-0054 to the real catalog |

## Context

The owner exported the product master of the old system (Erxes) to Excel: sheet «Нэгтгэл», 12,893 products with their category, price, weight, box quantity, brand, barcodes, photo link and location tag; sheet «Эрксэст байхгүй» with 36 rows. The owner asked to drop the development database's test products («Одоо байгаа системийн бараануудыг устга») and start from this file.

**Bto's rules the file breaks:**
- A product code is digits only. 924 codes have a letter («90Q1234»), and 7 look like «td_…».
- A barcode belongs to one product. 263 barcodes, compared by Bto's lookup key, sit on 444 products.
- A numeric barcode of GTIN length must have a valid check digit. About 200 do not.
- One barcode is not ASCII.

**Size.** One category, 905, holds 1,414 products, more than its 1,000-code range.

The file is real business data. It never enters the public repository; only the converter does, so the same run can be repeated at go-live with a fresher export.

## Decision

The owner's answers of 2026-10-22, in an interview of seven rounds:

1. **A clean development database.**
   - The old one is kept twice: renamed `tugeel_pre_master`, and dumped to `tmp/db-backups/`.
   - The new `tugeel` gets only the essentials: the owner's admin (password through a one-time code), a test admin `import` for the scripts (its login only in the gitignored `tmp/dev-logins.txt`), one branch «Оргил Бөөний төв», the warehouses of #5, and the settings (VAT payer at 10 %, no city tax; the finance numbering keeps its defaults).
2. **Categories, two levels.**
   - **Top groups by the hundreds of the old numbers.** 1xx «Шингэн Бүтээгдэхүүн», 2xx «Амттан», 3xx «Сүүн сүүн бүтээгдэхүүн», 4xx «Амтлагч, соус, тос», 5xx «Гэр ахуй & Хувийн арчилгаа», 6xx «Лаазалсан, чанамал», 7xx «Гурил,будаа,гоймон», 8xx «Цай Кофе», 9xx «Төрөл бүрийн бараа». Each has the range n00000–n99999.
   - **Numbered categories.** They go under their group and keep their numbers in the name («101 Дарс виски», range 101000–101999). This keeps «504 Саван» and «508 Саван» apart.
   - **«+» groups.** The six become top groups of their own without the «+», with no range.
   - **Two unnumbered groups.** «Хүүхдийн Бүтээгдэхүүн» and «Эрэгтэй эмэгтэй бээлий» go under «Төрөл бүрийн бараа».
   - **Products filed under a group's own name** go into that group's «Ангилаагүй».
   - This answers SPEC §11 #28.
3. **Codes.**
   - A code Bto cannot keep gets the lowest free code of its category's range.
   - When that range is full, the code comes from its group's range outside every subcategory's. This happened to 414 of 905 «Хятад бараа»'s 694 lettered codes; they got 900xxx codes.
   - The old code is added to the product as a barcode, so a printed label still scans. The owner said this for the lettered codes; the «td_…» codes get the same treatment.
   - The list of old and new codes is in the report.
4. **Suppliers.**
   - «Брэнд нэр» is the supplier, with «Брэнд код» as its code.
   - Each product's brand becomes its main supplier.
   - A name two codes share gets the second code appended, because supplier names are unique.
   - Products without a brand have no supplier.
5. **Warehouses.**
   - Every «Байршил tag» value becomes a WHOLESALE warehouse, WH1 … WH8: Жижиглэн агуулах, Зааланд ирдэг, Бөөний агуулах, Гэрээт компани, Тоглоом, Архи Ус ундаа пиво, Жижиглэн Архи, Хөргүүр (Агуулах).
   - The tag is the product's home warehouse. A combined tag takes its first one.
   - The 63 products without a tag come in without a home.
   - The branch also has the STORE «Супермаркет» (S1).
6. **Barcodes.**
   - **Any barcode is accepted (amends ADR-0029 #1).** A numeric code of GTIN length whose check digit is wrong is stored as printed, with `gtin14` null and `lookup_key` = the code, and is found by exactly that code. `classifyBarcode` no longer has the problem `CHECK_DIGIT`. `lookupCandidates` returns the code itself when no GTIN reading is valid; the keys cannot meet a GTIN's, whose check digit is always valid.
   - **The camera stays strict.** The phone's scan gate still ignores such a read as a misread digit (`isMisreadGtin`).
   - **No migration.** The table's CHECKs already allow it. A non-ASCII code is still refused.
   - **Shared barcodes are left out.** Every barcode in the cell is a piece (base-unit) barcode. A barcode several products share is removed from all of them and listed for the owner to give to the right one; nothing is guessed.
7. **Prices.**
   - **What «Нэгж үнэ» is.** It is the price of a piece when bought by the box, which is ADR-0048's warehouse price W per base unit. It comes in through the PRICES import.
   - **The profile.** One temporary price profile «Үндсэн» (0 % loose, 0 % supermarket, WHOLE) carries every price. The owner did not want the old «Үнэ бодох tag» as profiles and sets the percentages later.
   - **The pack.** The box is the whole pack.
   - **Unpriced products.** Products without a price above zero wait at «Үнэ хүлээгдэж буй».
8. **Photos.**
   - **Download.** The `imageUrl` links are downloaded with GET only, at most two at a time with a pause, so the Erxes production server is never strained or changed.
   - **Storage.** They are kept in `tmp/` and attached as each product's photo. The thumbnail is the photo itself when it is at most 512 KB.
   - **Broken links** are skipped and counted: 7,228 of 7,258 photos came in, and 30 links were broken.
9. **Left out.**
   - «Үнэ бодох tag», tagIds, «Ачааны ангилал», «Хайрцагны жин», «Барааны индекс», createdAt.
   - The 26 products of «Хархорин Боломж»: Kharkhorin is its own installation (ADR-0084 #1).
   - The sheet «Эрксэст байхгүй».
10. **Tooling.**
    - **Converter.** `tools/migration/erxes-master.mjs` turns the export into the SUPPLIERS, PRODUCTS and PRICES sheets, the category tree, the photo list and a report. It uses the shared rules (`gtin`, `catalog`, `text`).
    - **Loader.** `erxes-load.mjs` creates the missing essentials and categories, then runs the imports through Bto's own pipeline.
    - **Photos.** `erxes-images.mjs` handles them.
    - **Configuration.** `erxes-map.json` holds this ADR's names and mappings, never product rows.
    - **Where data goes.** Every output lands in the gitignored `tmp/`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Strip the letter from the codes («90Q1234» → «901234») | The owner chose new codes from the ranges, keeping the old one as a barcode. |
| Keep a shared barcode on the newest or the oldest product | A guess; the owner chose to list them. |
| Drop barcodes with a wrong check digit | The owner wants every barcode kept («Баркод чөлөөт байхад болно»); Erxes holds them and labels carry them. |
| A price profile per «Үнэ бодох tag» (113) with 0 % | The owner chose one temporary profile. |
| Clean the old database in place | Leftover documents, stock and finance rows of the test data; a fresh database from the migrations is simpler and the old one stays whole. |

## Consequences

**Positive.**
- The real catalog runs in Bto: 12,867 products, 104 categories, 380 suppliers, 9 warehouses, prices and photos.
- The same run can be repeated with a fresh export at go-live.

**Negative.**
- **Typos are no longer caught.** A typo in a typed numeric barcode is stored instead of refused.
- **Codes outside their range.** 414 products of 905 have codes outside 905's range.
- **Owner's follow-ups.**
  - The shared barcodes, the homeless products and the profile's percentages wait for the owner.
  - The store edge paired against the old database must be paired again.
  - The test logins of the old database (rep1, kassir1, …) are gone.

## Related

ADR-0029, ADR-0036, ADR-0044, ADR-0048, ADR-0054, ADR-0084, `docs/modules/catalog.md`, `docs/modules/imports.md`, `tools/migration/README.md`.
