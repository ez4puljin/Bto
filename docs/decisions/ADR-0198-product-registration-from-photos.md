# ADR-0198: «AI ашиглах» on the registration form: a product read from its photos, its picture cut out by an outside service

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-14 |
| Deciders | Owner (2026-11-14: «Бараа нэмэх дээр ai ашиглах боломжтой болго … барааг дарсан хэдэн ч зураг хийхэд OCR хийж Шинэ бараа нэмэх бүх Зүйлсийг бөглөөд өгдөг байна. Жишээ нь тохирох ангиалал … зургийн backgound хасах апп ашиглагдах Бүтэн-Оргил ХХК тамгатай барааны зураг сонгогдсон байхаар хий»; answers the same day: the logo in the top-left corner, an outside background service, the connected AI reads the photos, only the product stays in the picture), Claude |
| Amends | ADR-0045 #7 and ADR-0162 (a third purpose of a model call, and a second outside service with a sealed key), ADR-0044 #5 (the registration form gets a way to be filled; what it saves and how is unchanged), ADR-0030 (two file kinds) |

## Context

A new product is registered on `/catalog/products/new` (ADR-0044): a category that suggests the code, a name, the base unit and the carton, barcodes, a supplier, the home warehouse and at least one photo. Every field is typed by a person holding the product, many times a day. The label already says most of it.

The catalogue's 7,228 pictures are phone photos on a white board with a matchbox beside the product for scale. The owner wants the picture of a new product without its background, with the company's mark on it.

The model's clients already take images (ADR-0122: the invoice check), the connection and its meter live on «Тохиргоо → AI» (ADR-0162), and the real system has no model key typed yet. Nothing in the stack processes pixels on the server.

## Decision

1. **A proposal, never a save.** «AI ашиглах» fills the form; the registrar reads it, corrects it and presses «Хадгалах» as before. `POST /product-registrations` is unchanged and nothing the model wrote reaches the catalogue without that click. No reading is stored: no table, no audit row, no log of the prompt, the photos or the answer (ADR-0045 #7). The call is counted in `ai_usage` under the new purpose `PRODUCT_READ`.

2. **The photos are private uploads nobody attaches.** The browser scales each chosen photo to 1280 px (as product photos, ADR-0030) and uploads it as the new kind `catalog.ai_photo` (private, 5 MB, right `catalog.products.register`). The server reads only the caller's own uploads of that kind (another person's is 404). They are never confirmed, so identity's housekeeping removes them with the other abandoned uploads. At most 8 photos a reading.

3. **The model chooses from the catalogue's own lists.** `POST /product-registrations/ai/read` sends the model every category with its full path, the units of measure, the active suppliers by name, 40 product names as the house style, and the photos. It answers in a fixed schema: name, category id, base unit id, carton and inner-pack quantities, the weight of one unit, the digits of the barcodes on the piece, the carton and the inner pack, a supplier id, which photo shows the front, and where the product is on it.

4. **Nothing of the answer is trusted.** `proposalOf` (`modules/inventory/services/product-ai.ts`) keeps an id only if it is in the list that was sent, never the carton as the base unit, a quantity only if it converts exactly (`isExactFactor`) and is more than one, a weight only in the catalogue's scale, and a barcode only if it is a GTIN with a valid check digit (the model misreads digits; a misread fails the check nine times in ten). Dropped barcodes are counted for the screen. A field the model left empty proposes nothing, so the form keeps what it had (the category, supplier and unit stay from the product before).

5. **A barcode a product already carries is named, not filled in.** The reading looks every kept barcode up (`BarcodeService.lookup`) and returns the products that carry one. The form leaves those codes out (saving them would be refused with `BARCODE_TAKEN`) and shows «… бараанд бүртгэлтэй байна» with a link: the usual cause is that the product is registered already.

6. **What a photo cannot tell is left to the person.** The home warehouse, the shelf and the code (which follows the category) are not proposed.

7. **The background is removed by remove.bg; the picture is drawn in the browser.** The owner chose an outside service over a model on this PC. `POST /product-registrations/ai/picture` sends one photo (the front one the model named, else the first) to `https://api.remove.bg/v1.0/removebg` and returns the PNG and the company's logo. The browser then keeps the product (decision 8), centres it on a white 1000 × 1000 square with 7 % margins, draws the logo and uploads the JPEG and its thumbnail as ordinary `catalog.product_image` / `catalog.product_thumb` files, first among the form's photos: it is the primary photo unless the registrar removes it. The server handles no pixels and gets no image library.

8. **Only the product stays.** The cut-out's objects are its connected groups of solid pixels. With the product's place known from the model, every object lying mostly inside it stays (a set of two is one product) with the one that overlaps it most; otherwise the largest object is the product. A matchbox standing apart goes; one touching the product is one object with it and stays (`keepProduct`, `apps/web/src/lib/product-picture.ts`).

9. **The mark is the company's logo, uploaded by the owner, in the top-left corner.** No logo of «Бүтэн-Оргил ХХК» is in the repository and none is invented: the owner uploads one on «Тохиргоо → AI → Барааны зураг» (kind `ai.picture_stamp`, public, kept as PNG with its transparency, at most 512 px). It is drawn at its own proportions inside a box 22 % wide and 14 % high, 3.5 % from the top and left edges. Until one is uploaded pictures carry no mark.

10. **The service's key is the owner's, sealed like the model's.** `ai_picture_settings` (one row, migration `0103_product_ai`) holds the key sealed under `AI_KEY_SECRET` with its own binding (`ai_picture_settings.api_key`: a value sealed for the model does not open here), its last four characters, and the logo's file. `GET/PATCH /ai/picture-settings` and `POST /ai/picture-settings/test` need `ai.settings.manage`. The test is remove.bg's free account request: it spends no credit and tells the credit left. The key goes only to `api.remove.bg`, never into a response, an audit row or a log. No environment variable is added.

11. **Each half works without the other, and the form without both.** `GET /product-registrations/ai` says what is set. No model: nothing is filled in, and the picture is still made. No key, or the service refuses: the photo is kept as taken and becomes the primary photo, with the reason in words (no credit, a wrong key, busy, unreachable). Neither: the button is off and a line says where the connection is typed. A provider failure is `AI_PROVIDER_FAILED` 502 or `PICTURE_PROVIDER_FAILED` 502, an unset one `AI_NOT_CONFIGURED` 503 or `PICTURE_NOT_CONFIGURED` 503; the screen shows them inside the AI card and the form below stays usable.

12. **Where the code lives.** The flow is `ProductAiFlowService` in `inventory`, beside the registration it serves and the lowest module that may read both catalog and partners; it is provided by `InventoryHttpModule` only, because the gateways exist only in the api's root. remove.bg is `integrations/picture` (plain `fetch`, no SDK, `PICTURE_FETCH` replaced in tests) behind `PictureGateway`, which the ai module's `PictureSettingsFlowService` answers, as `LlmGateway` is answered (ADR-0162). The routes keep nothing in a process's memory that another replica needs.

## What leaves the building

- **To the model's provider** (Anthropic today, whatever «Тохиргоо → AI» names): the photos of the product, the names of every category, unit and active supplier, and 40 product names. No prices, stock, customers or staff.
- **To remove.bg** (Kaleido AI GmbH, Austria; part of Canva): one photo of the product per picture, and the key. Nothing else.

Both are product packaging the company sells in public. Supplier names going to the model's provider is new with this ADR; the assistant already sends supplier data (ADR-0045).

## Alternatives considered

- **Background removal on this PC** (recommended to the owner, who chose the service). Tried on four catalogue photos, two threads at low priority, on the Xeon without AVX2: `u2net` (Apache-2.0, 176 MB) 2 s a picture, all four clean; `u2netp` (4.6 MB) 0.8 s, softer edges; `isnet-general-use` 6 s, sharper but it ate half of a striped noodle pack. Free and private, but it sometimes fails without knowing it, and it would add `onnxruntime-node` (566 MB unpacked) and an image library to the api's image. It stays the fallback if the service's cost or terms change: the gateway's `BackgroundRemover` interface is what a local remover would implement.
- **A text mark «Бүтэн-Оргил ХХК»**, or the Bto app's logo. The owner asked for the logo; the app's logo is the software's mark, not the company's.
- **Composing the picture on the server.** It needs an image library in the api, and CPU beside the apps' requests; the browser has a canvas and the office PC is idle while its user waits.
- **Reading barcodes in the browser** with the scanner's decoder (ADR-0031) and merging them with the model's. More certain digits, and worth adding if misread barcodes show up in use; the check digit and the registrar's eyes guard the first version.
- **Keeping the photos given to the AI as product photos.** Label and barcode shots are not catalogue pictures; the registrar adds any of them by hand.
- **Storing readings** to measure how often the proposal is corrected. Useful, but it is a table of model output; not before the feature has been used.

## Consequences

**Positive.** A product is registered from a few photos and a check instead of a dozen typed fields; the category comes from the catalogue's own tree; an already registered barcode is caught before the save; catalogue pictures get a uniform white square with the company's logo.

**Negative.** Every reading costs model tokens (several images) and every picture one remove.bg credit; the month's limit of ADR-0162 stops readings, nothing but the service's own account stops pictures. A proposal can be wrong in ways the checks do not see (a plausible but wrong category, a wrong carton quantity printed on another line): the registrar's check is the control, as the screen says. A matchbox that touches the product stays in the picture. Two outside services now see product photos.

**Follow-ups.** The owner types the model key and the remove.bg key on the real system and uploads the logo; then tries ten real products and reports wrong fields, so the prompt's wording and the name examples can be tuned. The staff app's product registration, if it gets one, can call the same three routes.

## Related

ADR-0030, ADR-0044, ADR-0045, ADR-0122, ADR-0162, ADR-0192; `docs/modules/catalog.md` §4, §8; `docs/modules/ai.md` §13; `docs/modules/inventory.md`.
