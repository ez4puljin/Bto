# ADR-0166: «Bto300» carries the company's logo, updates itself from the server, and holds «Тооцоо» inside «Захиалга»

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner («Bto300 нэвтрэх хэсэгт лого болон Бүтэн-Оргил ХХК харагддаг болго … Нүүр хэсгийн зүүн дээд буланд Bto300 оронд Logo … Notification дээр мөн Лого … update хийгдэхэд Server-тэй wifi холбодоход шууд шинэчлэл татах боломжтой болго … Аппын захиалга цэс болон Profile - Тооцоо цэс нэгтгэ», 2026-11-06), Claude |
| Amends | ADR-0079 #13, ADR-0092 #1 (the app's mark), ADR-0092 #8 (the notifications' tiles), ADR-0095 («Тооцоо» from «Профайл») |

## Context

Each new APK of «Bto300» has been carried to a phone by hand. A store has no way to know a new version exists, and the owner has dozens of stores to reach. The app also showed its own name where the owner wants the company's logo, and «Тооцоо» sat two taps away under «Профайл» though a store reads it with its orders.

## Decision

1. **The logo.** `assets/customer/logo.png` (the emblem with «Оргил») and `logo-mark.png` (the round emblem alone), cleaned of the checkerboard baked into the owner's file. `CompanyLogo` and `CompanyMark` in `src/ui/brand.tsx` draw them.
   - Sign-in: the logo and «Бүтэн-Оргил ХХК»; the name «Bto300» goes.
   - Home: the logo replaces «Bto300» in the top left, on a white ground because dark green does not read on the blue header.
   - Server and offline screens: the logo and the company.
   - The launcher icon and the splash stay «B300»: the owner did not ask to change them.
2. **«Мэдэгдэл».** Every notification shows the emblem with a small coloured tile saying its kind (the tile used to be the whole picture). A notice without a picture shows the logo, in the list and in the popup. These are the app's own notifications: «Bto300» has no notifications in the phone's shade (no push service).
3. **A release is a folder on the server:** `<STORAGE_LOCAL_DIR>/releases/<variant>/` holds `latest.json` and its APK, written by `pnpm mobile:publish -- <apk>`. Publishing is a separate, deliberate step after a build. It refuses an APK without `arm64-v8a` code, because an emulator's build installs on no phone (it happened on 2026-11-06). No table and no new environment variable: the storage volume already exists in `deploy/`.
4. **`GET /api/v1/app-releases/:variant` and `/:variant/apk` are `@Public()`.** An APK holds no secret, and Android installs it only over an app signed with the same key. A missing, broken or wrong-sized release answers `{ release: null }`, so a phone is never offered a download that cannot finish.
5. **The phone asks every two minutes while the app runs.** A newer `versionCode` counts one on the bell and shows a card on top of «Мэдэгдэл»: the version and size, then «Шинэчлэх», the progress, and Android's installer. A server that does not answer offers nothing, so the offer appears soon after the phone is back on the server's network. The download starts only on a press and shows its size first, so mobile data is never spent unasked. It goes to the app's cache, holds only the newest APK, and stops when the screen is left.
6. **`selfUpdate` per variant** (`variants.json`, only `customer` for now) adds `REQUEST_INSTALL_PACKAGES` to the manifest. **`BTO_PLAY_BUILD=1` turns it off**: Google Play forbids an app updating itself outside Play, and the owner plans Play for «Bto300» (2026-11-05).
7. **«Тооцоо» is a part of the «Захиалга» tab**, through two buttons under the header («Захиалга», «Тооцоо»; `StoreTabs`, shared with «Мэдэгдэл»). The header reads «Захиалга, тооцоо». `/orders?tab=account` opens it from a notification and from the cart's credit note. The `/account` screen and the row on «Профайл» are gone.

## Consequences

- The first APK with this feature still reaches a phone by hand. Every later one comes through the app.
- Android asks the store once to allow installs from «Bto300», on the installer's own screen.
- Only a build signed with the same key installs over the old one. The builds are signed with the debug key until the go-live key is chosen; changing the key means reinstalling by hand on every phone.
- A store on an old version keeps working: nothing forces the update.

## Alternatives

| Alternative | Why not |
|---|---|
| A table and an upload page in «Апп» | More to build for a step done by one person on the build PC; the folder can move behind a page later |
| Expo Updates (over-the-air JavaScript) | Needs a hosted update service, and cannot change native code or the APK itself |
| Download by itself on Wi-Fi only | Needs a network-state module and spends a store's storage unasked; a press after seeing the size is enough |
| Tying the route to a customer's token | The staff app will want the same route, and the APK is not a secret |
| «Тооцоо» as its own tab | The bar already has five places; the owner asked to merge them |

## Related

ADR-0079, ADR-0085, ADR-0092, ADR-0095, ADR-0101, `docs/modules/mobile.md` §1a and §9, `docs/modules/customer.md` §4.
