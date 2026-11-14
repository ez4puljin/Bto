# ADR-0199: «Бараа нэмэх» in the staff app: a product registered from the phone's camera, its picture finished on the server

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-14 |
| Deciders | Owner (2026-11-14, the day ADR-0198 was built: «ажилтны апп дээр барааг ai ашиглан зураг дарж оруулж нэмэх боломжтой болго»), Claude |
| Amends | ADR-0198 #7 (the server now draws pictures too, for a client that cannot), ADR-0061 (a new screen of the staff app, a second time limit for its calls), ADR-0174 (a menu entry by right) |

## Context

ADR-0198 put «AI ашиглах» on the office's registration form. The product, though, is in the warehouse, in the hands of whoever unpacks it, and that person holds a phone with the staff app, not a PC: with the web they photograph the product, send the photos to themselves and register at a desk. The staff app already has a camera (the barcode scanner) and every registrar signs in to it.

Two things of ADR-0198 do not carry over. The office's browser draws the catalogue picture on a canvas; React Native has none, and a drawing library would be a new native dependency of the app. And the app gives every call ten seconds, where a reading takes tens.

## Decision

1. **A screen «Бараа нэмэх» in the staff app** (`/products/new`), in «Цэс → Ажил» for holders of `catalog.products.register`, the right the office's form asks for. Staff 0.21.0.

2. **The camera takes the photos; the gallery is not offered.** `PhotoCamera` uses the scanner's `expo-camera`: one press, one photo, up to 8, the last one in the corner. No new native dependency. The camera is asked for its smallest picture size whose long side reaches 1600 px (`pictureSizeFor`), so a photo is a few hundred kilobytes; where it names none, its own size is taken and the server scales.

3. **The same three calls, and one new.** Photos go up as private `catalog.ai_photo` uploads straight from their files; `POST /product-registrations/ai/read` fills the form as on the web (ADR-0198 #3–#6). The picture comes from the new `POST /product-registrations/ai/image`.

4. **The server finishes the picture for a client that cannot draw.** `ai/image` takes a photo and the product's place from the reading and answers with a finished product image: stored as pending `catalog.product_image` and `catalog.product_thumb` files of the caller (`StorageService.ingest`), ready for the registration's `images`, and returned as a JPEG in base64 so the phone can show it before the product exists. It is drawn by the rules the browser uses: they moved to `@tugeel/shared/pictures` (`keepProduct`, `productPlace`, `stampPlace`), so the two cannot drift apart.

5. **`ai/image` never fails for the service's sake.** A background service that is not set, refuses or finds nothing gives the photo as taken (upright, within 1280 px) as the image, with `picture: 'original'` and, when the service was asked, `failure` (its reason, status and code). A product can therefore always be registered from the phone, with or without remove.bg and with or without a model: the route is also how a hand-typed registration gets its photo.

6. **Photos are normalised on the server.** A phone's camera photo is large and carries its turn in EXIF. `normalisedPhoto` turns it upright, scales it within 1280 px and re-encodes it as a JPEG before it goes to the model or the service; a photo that already is upright, small and a JPEG (the web's uploads) passes untouched, byte for byte. Bytes that are no picture are 415 `UNSUPPORTED_MEDIA_TYPE`.

7. **`sharp` 0.35.5 in the api** (libvips; prebuilt for linux-x64, no install script, Apache-2.0), used only in `common/images/product-picture.ts`. libvips works off the event loop; `keepProduct` runs on it for about a tenth of a second per picture. Inputs over 120 megapixels are refused before they are decoded.

8. **The form on the phone holds what the web's holds**, less the shelf (off on the web too): the category from a searchable list (it suggests the code), the name, the code, the base unit, the carton quantity, the weight, an optional block, barcodes per unit, the supplier from a server search, the home warehouse (the person's write scope; a single one is chosen). Its rules are `src/products/rules.ts`, pure and tested; the server checks everything again.

9. **Barcodes are scanned, not only read.** Each unit has «Уншуулах», the app's scanner with its check digit and double-read gate: the reliable way to a barcode, where the model's reading of printed digits is the fallible one. A scanned code is looked up (`GET /barcodes/:code`); one a product already carries is named in a toast and not added, as the reading's are (ADR-0198 #5).

10. **Nothing is saved before «Хадгалах», and one key per product.** As on the web: `POST /product-registrations` with an Idempotency-Key that lives until the save succeeds; a code taken meanwhile is replaced by the next free one; after a save the category, supplier, home and unit stay for the next product. Leaving with photos taken or fields typed asks first.

11. **Two calls get two minutes.** `MobileSession` gives `…/ai/read` and `…/ai/image` 120 s (`SLOW_ROUTES`, `timeoutFor`) instead of the 10 s every other call keeps: they wait for an outside service by design, and giving up early throws away an answer already paid for.

## What leaves the building

Nothing new: the same photos and lists to the model's provider and the same one photo to remove.bg as ADR-0198, now also when the registrar is on the phone, over the app's own connection to the centre (`app.puljika.site` from outside the building, ADR-0188).

## Alternatives considered

- **Drawing on the phone** with a canvas library (`@shopify/react-native-skia`). A new native dependency, megabytes in the APK, and a third place to keep the picture's rules.
- **Letting remove.bg compose** (`bg_color`, `crop`). It cannot draw the logo or drop the matchbox, so a second pass would be needed anyway.
- **Moving the web to the server's drawing too.** One implementation less; the browser's works, costs the server nothing and is covered by tests. The rules are shared; who draws may change later without a new decision.
- **Picking photos from the gallery** (`expo-image-picker`). A new native dependency for photos that are, in practice, taken on the spot.
- **A separate right for the phone.** The work is the same registration; one right.

## Consequences

**Positive.** A product is registered where it stands, by the person who unpacks it: photos, a check, a barcode scan, a save. A hand-typed registration from the phone is possible as well. The catalogue picture is the same whichever client made it.

**Negative.** The api gains an image library (about 20 MB in the image) and does pixel work for the phone's registrations: a quarter of a second of CPU per picture, a few times a day. A registrar on mobile data uploads up to eight photos and waits for the reading on a slower line; the two-minute limit covers it, the wait is theirs. The screen cannot be exercised by automated tests on this PC (no emulator in the checks): its rules are tested, its camera, sheets and layout are the owner's walk on a phone.

**Follow-ups.** The owner's walk with staff 0.21.0 on a phone; the keys and the logo of ADR-0198 on the real system. If readings on the phone prove slow, the photos can be scaled before upload (`expo-image-manipulator`).

## Related

ADR-0030, ADR-0044, ADR-0061, ADR-0174, ADR-0188, ADR-0198; `docs/modules/mobile.md` §1l; `docs/modules/inventory.md` §4; `docs/modules/catalog.md` §5.
