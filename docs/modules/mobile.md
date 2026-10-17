# App `mobile` — contract

Status: **v1 built** 2026-10-15 (the sales-rep app, ADR-0061), pulled forward from deliveries 4 and 7 at the owner's request; **redrawn to the owner's design** 2026-10-16 (ADR-0068, version 0.2.0; 0.2.1 on 2026-10-17 gives every call a 10 s limit; **0.3.0** the same day after the owner's first look, ADR-0068 #11–#16: smaller text, a new home, server and sign-in, «Хүлээн авах», pictures kept on the phone). Code: `apps/mobile/` (Expo, the `staff` variant of ADR-0006), the API it uses in `apps/api/src/modules/sales/` (`/sales-rep/*`) and `apps/api/src/modules/identity/` (`/auth/mobile/*`). Decisions: ADR-0006, ADR-0016, ADR-0025, ADR-0027, ADR-0061, ADR-0062 (notices, 2026-10-16), ADR-0068 (the design, 2026-10-16). The design: the artifact «Bto Бараа дэлгэц» (15 boards, https://claude.ai/artifact/BAV6mPG85WCGKu6NjUBhNd).

## 1. Scope (v1, owner 2026-10-15)

The sales rep's app, modelled on the screens of the erxes SR app the owner uses (only its flow: no code, logo or picture of it):

- **Server and login (ADR-0068 #13):** the logo with «Bto» and the company; the API server's address in a labelled field (checked with `GET /health`; «no answer» and «not a Bto server» told apart), the last five servers that answered to pick again; then the staff account (username → password with «next», an eye to show the password, the expired or signed-out note, a chip with the server and «Сервер солих»); the session lasts one shift (`auth.staff_session_hours`, 12).
- **The look (ADR-0068 #1–#2, #11):** the boards' inset grouped lists, segmented controls, switches, pill buttons and sheets (`src/ui/*`, tokens in `src/theme/tokens.ts`), with the boards' text about 12–15% smaller (rows 15, titles 28, notes 12) and the phone's font scaling capped at 1.15; a floating 60 px tab bar «Нүүр · Бараа · Сагс · Захиалга · Профайл» with the cart's and the bell's counts, the open tab on a light-blue pill.
- **«Нүүр» (ADR-0068 #12):** a greeting by given name with the date and the bell; a search bar into the shop and the scanner; this month on a blue card (the confirmed total, the orders, the drafts); the cart's banner while it has lines; where new orders land (a warning when unset); «Шинэ бараа» as a strip of tiles with pictures; the month's latest three orders.
- **«Бараа»** (the Main board): the scanner and the filter (with the count of filters on), the search by name, code or barcode, the order and the filters as chips (a chosen one blue with ×), «N бараа · шинэ нь эхэндээ», two cards a row (pictures to swipe with dots, «Шинэ» for 14 days, «+» by the default unit or the cart's quantity, the base price «29,100₮ / ш», the stock «Үлдэгдэл 73 · хайрцагт 6»).
- **The filter sheet** (Filter, Supplier): the order (Шинэ эхэндээ / Үнэ өсөхөөр / Үнэ буурахаар), the top categories, the home warehouse (every one, or one of the context's), the main suppliers on a sheet over it (search, counts, ticks), «Зөвхөн үлдэгдэлтэй»; «N бараа харуулах» counts the draft. Kept per server and user; a scoped rep starts in their one wholesale warehouse.
- **A product** (Product, ProductKeypad): opened at once from the list's data; the pictures (a pager, each thumbnail until its full picture arrives), the code and category, the stock and the home warehouse, the unit switch, the unit's price with its pack note, − n + with the keypad on the number, +1 +5 +10, what goes short (backordered), the server's total of the line, «Сагсанд нэмэх / шинэчлэх / хасах». From the scanner it opens in the scanned unit and goes back to the camera.
- **«Сагс»** (Cart): one row per product (picture, pieces and the price a piece, the server's line total, the unit pill that opens the product), «Засах» with the remove buttons, «Бараа нэмэх», the server's total and discount, «Захиалга илгээх».
- **«Захиалагчийн мэдээлэл»** (Checkout, CheckoutNote): the customer («Солих»), the contact and phone (the customer's first contact by default), «Хүлээн авах» as two cards — «Хүргэлтээр» with the address (its sheet) and «Өөрөө авна» with the home warehouse — and four day tiles (today, tomorrow, the day after, another day from the calendar, 60 days ahead; a new order starts on today, ADR-0068 #14), the payment with its colour, a note lifted above the keyboard with «Болсон», where the order lands; «Баталгаажуулж илгээх», then the sent order over the page.
- **«Миний захиалгууд»** (MyOrders, DateRange): a customer search, today / a week / this month or a range from the calendar sheet (presets, start and end, Monday first, never the future, ≤ 366 days), the count, the confirmed total and the drafts, the orders by day; an order's page in the same look.
- **«Профайл»** (Profile): the bell with the unread count, the user (to their details), «Хэрэглэгчийн мэдээлэл», «Захиалга илгээх тохиргоо» with the chosen stage, the server, «Гарах» with its question, the version and build. **«Хэрэглэгчийн мэдээлэл»** (ProfileInfo): name, login, role, the branches of the write scope, when the session signed in and ends, the server, «Нууц үг солих» (`POST /auth/password`). The server is changed at sign-in or offline.
- **Notices (ADR-0062, ADR-0068 #9, `docs/modules/notifications.md`):** the popup as the Launch board draws it (a picture by kind, the kind and days, a price drop's old and new prices, the dots, «… харах», «Дараагийнх / Хаах») when the app starts or returns to the foreground (never over the camera, the customer picker, the checkout, the password or a pending send; shown = read), then a toast «Мэдэгдлүүд Профайл дээрх хонхонд хадгалагдсан» with «Дахин харах»; «Мэдэгдэл» (Notifications) with the running notices and the rep's sold orders by day; a notice's page with its products as cards.
- **«Захиалга илгээх тохиргоо»** (OrderSettings): the board (with its branch), its pipeline and the stage new orders land on (a number, the stage's rule), among those the rep may place on; «Дараагийн захиалга».

Not in v1: payments and returns (with finance, delivery 3), new customers, biometric login, offline mode (ADR-0020), visit plans, iOS, keyboard-wedge scanners, EAS.

## 2. Pins (2026-10-15)

| Package | Version |
|---|---|
| Expo SDK | 57: `expo` 57.0.28, `expo-router` 57.0.26, `@expo/metro-runtime` 57.0.16 |
| React Native / React | 0.86.3 / 19.2.3 (`react-dom` 19.2.3 too) — ONE React for the workspace (the web too): a test fails on a second copy |
| Native modules | expo-camera 57.0.6, expo-secure-store 57.0.4, expo-crypto 57.0.4, expo-image 57.0.5, expo-font 57.0.4, expo-splash-screen 57.0.10, expo-system-ui 57.0.4, expo-build-properties 57.0.22, expo-constants 57.0.21, expo-linking 57.0.12, expo-status-bar 57.0.1, react-native-screens 4.26.2, react-native-safe-area-context 5.7.0, react-native-svg 15.15.4, @react-native-async-storage/async-storage 2.2.0 |
| UI | @expo-google-fonts/inter 0.4.2 (embedded at build), lucide-react-native 1.53.0 |
| Data, i18n | @tanstack/react-query 5.104.1, i18next 26.4.2, react-i18next 17.0.16 (the web's) |
| Android build | Gradle 9.3.1 (template), AGP 8.12.0, Kotlin 2.1.20, compile/target SDK 36, minSdk 24, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, JDK 17 (Microsoft OpenJDK 17.0.20.1) |

SDK upgrades only in their own session between deliveries (SDK 58 brings an Expo Router rework); the web's React follows the SDK's.

## 3. Layout

```
apps/mobile/
  app.config.ts            APP_VARIANT=staff, package mn.butenorgil.bto.staff (TODO-VERIFY), plugins
  metro.config.js          the workspace, @tugeel/source, react/react-native pinned to the app
  plugins/with-cmake-object-path.cjs   CMAKE_OBJECT_PATH_MAX=250 (Windows' 260-character limit)
  scripts/build-apk.mjs    `pnpm mobile:apk`; apk-env.mjs (pure helpers), expo.mjs (the Expo CLI)
  app/                     Expo Router: _layout (phases), server, login, offline, not-rep,
                           (staff)/(tabs)/{index,shop,cart,orders,profile} (the floating tab bar),
                           (staff)/{product/[id],checkout,order/[id],customers,scan,settings,
                           profile-info,password,notifications,notice/[id]},
                           (staff)/notice-popup (a transparentModal route)
  src/api/                 session.ts (tokens, a 10 s limit per call), problem.ts, rep.ts, notifications.ts
  src/images/              thumbs.ts + thumb-keeper.tsx (every shop thumbnail kept), pictures.ts
  src/home/                home.ts (the greeting's name, the date line, the new products)
  src/notifications/       feed.ts (the list by day, the popup queue and replay), kinds.tsx, popup-gate.tsx
  src/cart/                cart.ts (reducer, the order body), send.ts (the pending send), use-send.ts
  src/shop/                filters.ts (+ use-filters), units.ts, unit-words.ts, filter-sheet,
                           supplier-sheet, qty-keypad, use-line-quote, use-add
  src/orders/              date-range-sheet
  src/state/               session.tsx (server + session), shop.tsx (cart, stage, pending send),
                           placement.ts, role.ts, use-debounced.ts
  src/ui/                  the boards' kit: text (Text/TextInput with the capped font scaling),
                           layout, grouped, controls, field, brand, sheet, toast, tab-bar,
                           calendar, keypad, product-card, card-pictures, product-tile, order-row,
                           status, stat-row, pending-send, kit
  src/device/storage.ts    AsyncStorage JSON, the secure token store
  src/{dates,format,scan,server,theme,i18n}/
```

## 4. Workspace rules

- **Packages:** only `@tugeel/api-client` and `@tugeel/shared` (ESLint G1). Not `@tugeel/shared/{text,taxpayer,imports,inventory}` nor `businessDate*` from `@tugeel/shared/time`: Hermes lacks reliable `Intl` time zones and some Unicode regexes (ESLint `mobile` block). The server sends «today» (`GET /sales-rep/context`).
- **Metro** watches the workspace, reads `@tugeel/shared` from source (`@tugeel/source`), resolves `react` and `react-native` from `apps/mobile` (`scripts/metro-pin.cjs`) and skips `apps/api`, `apps/web`, `.claude`, `tmp`.
- **Scripts:** never `build` or `dev` (`pnpm check` and `pnpm dev` run them on every package). `typecheck` and `test` run in `pnpm check`; `apk` and `expo` are by hand.
- **Strings:** every one in `packages/shared/i18n/mn.json` under `mobile.*` (reusing `sales.*`, `auth.login.*`, `common.*`, `errors.*`); no `count` interpolation (Hermes may lack `Intl.PluralRules`).
- **Tokens:** `src/theme/tokens.ts`, the web's values (docs/ui.md) and the boards' (ADR-0068); Inter faces by file name; every text size is a `type.*` token (no `fontSize` in a screen), with Android's font padding off; touch targets ≥ 44; shadows as React Native's `boxShadow` (New Architecture); no colour literal in a screen.
- **Text:** `Text` and `TextInput` come from `src/ui/text` only (ESLint `mobile` block): they cap the phone's font scaling at 1.15 (`MAX_FONT_SCALE`), which React 19's lack of `defaultProps` on function components leaves no other way to set.
- **Units:** the system units (`PCS`, `BOX`, `BLOCK`, `KG`; stored names are short, «ш») take their word forms from `mobile.units.<code>` (ширхэг, хайрцагт, ширхэгээр); a custom unit shows its own name.

## 5. Auth (ADR-0061 #4)

`MobileSession` (`src/api/session.ts`): `POST /auth/mobile/login` gives the access token (memory) and the refresh token (expo-secure-store `bto.session.v1`, with the server and user). One refresh at a time, 30 s before the access token ends or after a 401 (then the call is sent again once); a rotated token is stored before it is used; `refreshToken: null` (the grace answer) keeps the stored one. A refresh nobody answered → `offline` (session kept); one refused → anonymous (`expired`). Every call gives up after 10 s (`REQUEST_TIMEOUT_MS`, an `AbortController` per request) and then counts as no connection: React Native's fetch has no timeout of its own, and a stored server that had left the Wi-Fi held the start logo for minutes (2026-10-17); now the phone shows «Сервертэй холбогдсонгүй» with «Дахин оролдох» and «Сервер солих». The server screen's `GET /health` gives up after 8 s. Logout clears the store even without a connection. Known limit: a refresh answer lost on the network ends in TOKEN_REUSE and a new login.

## 6. API used

`GET /health`; `/auth/mobile/{login,refresh,logout}`, `GET /auth/me` (with `sessionStartedAt`), `POST /auth/password`; `GET /sales-rep/context` (with `warehouses`, `branchNames`, boards' `branchName`), `GET /sales-rep/products?q=&categoryIds=&warehouseId=&supplierIds=&inStock=&sort=` (and `limit=1` for the filter's count), `GET /sales-rep/products/batch?productIds=&priceBefore=`, `GET /sales-rep/suppliers`, `GET /sales-rep/thumbs` (every shop product's primary thumbnail, kept on the phone), `GET /sales-rep/customers`, `GET /sales-rep/customers/:id`, `POST /sales-rep/orders` (with the contact), `GET /sales-rep/orders?from=&to=&q=`, `GET /sales-rep/orders/:id`; `POST /pricing/quote` (the cart, a product's line, the keypad), `GET /categories`, `GET /barcodes/:code` (these three need only a signed-in user); `GET /me/notifications/summary` (at start, on foreground, every 60 s), `GET /me/notifications`, `POST /me/notifications/read`; product and notice pictures from `/api/v1/files/public/<key>`. Rights: `sales.orders.rep` (the SALES_REP role); `docs/modules/sales.md` §4.

## 7. Data on the phone (ADR-0061 #8)

| Where | Key | What |
|---|---|---|
| expo-secure-store | `bto.session.v1` | `{server, userId, refreshToken}` |
| AsyncStorage | `bto.server.v1` | the server address |
| AsyncStorage | `bto.cart.v1:<server>:<userId>` | the cart (one line per product, customer, contact, delivery, date, payment, note), written 300 ms after a change |
| AsyncStorage | `bto.shopFilters.v1:<server>:<userId>` | the shop's order and filters |
| AsyncStorage | `bto.stage.v1:<server>:<userId>` | the chosen stage |
| AsyncStorage | `bto.send.v1:<server>:<userId>` | the pending send `{key, body, startedAt}`, stored BEFORE the request leaves |
| AsyncStorage | `bto.servers.recent.v1` | the last five servers that answered `GET /health`, `{url, usedAt}`, newest first |
| AsyncStorage | `bto.thumbs.v1:<server>` | when every shop thumbnail was last kept (asked again at sign-in or on returning to the foreground, once 6 hours have passed) |
| expo-image disk cache | the picture's URL | thumbnails and opened pictures (Glide, 250 MB, least used dropped first); URLs never change, so a kept picture is never downloaded again |

The send (`src/cart/use-send.ts`): the same body keeps its Idempotency-Key (canonical JSON), a different body takes a new key; 201 (a replay too) clears the cart; 409 `IDEMPOTENCY_KEY_IN_PROGRESS` waits 1.5 s (four times); no answer or a 5xx keeps the pending send and locks the cart («Дахин илгээх» repeats the stored body and key; «Илгээлтийг хаях» after checking «Миний захиалгууд»); any other refusal drops it (the server released the key) and shows the problem, lines from `errors[].path = lines.N`. A pending send older than 6 days takes a new key (the server forgets keys after 7).

## 8. Scanning

`expo-camera` `CameraView` with ean13, ean8, upc_a, upc_e, itf14, code128; `ScanGate` (`src/scan/scan-gate.ts`): a value counts when read twice within 1.5 s and passing `classifyBarcode` (check digit), then 2 s of rest; then `GET /barcodes/:code` (a box barcode gives the box unit) and the product's page in that unit (`/product/:id?unit=&from=scan`), which comes back to the camera after «Сагсанд нэмэх». The camera permission is asked in the app; a refused one opens the phone's settings.

## 9. Build and install

**One-time setup (2026-10-15, approved by the owner):** in `C:\Android` (the NDK refuses paths with spaces): `jdk-17` (Microsoft OpenJDK 17 zip), `Sdk\cmdline-tools\latest`, and through the Android CLI (`android --no-metrics sdk install platforms/android-36 build-tools/36.0.0 ndk/27.1.12297006 cmake/3.22.1`; the SDK licence accepted by the owner) `Sdk\{platform-tools,platforms,build-tools,ndk,cmake}`; Gradle's cache in `C:\Android\gradle`. Nothing is installed system-wide; PATH and the registry are untouched.

**`pnpm mobile:apk`** (`apps/mobile/scripts/build-apk.mjs`):
1. Finds JDK 17/21 (`BTO_JAVA_HOME`, `JAVA_HOME`, `C:\Android\jdk-17*`) and the SDK packages.
2. Mirrors the workspace with robocopy to `C:\Android\m` (no node_modules, .git, .claude, android, build, tmp) and runs `pnpm install --frozen-lockfile` there (the shared store): the repository's own path has spaces and is long, and a `subst` drive mixed two roots that React Native's codegen refuses.
3. `expo prebuild --platform android --clean` (the generated `android/` is never committed), then `gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a`. The config plugin `plugins/with-cmake-object-path.cjs` passes `CMAKE_OBJECT_PATH_MAX=250`, so CMake hashes the long object names of the codegen targets and ninja's paths stay under Windows' 260 characters. The limit must leave room for a 32-character hash plus the file name after the object directory (react-native-gesture-handler's: 172 + 33 + 40 on arm64-v8a, two more on armeabi-v7a); 240 was too small. A new native library or a longer mirror path can need it raised (keep it under 255).
4. Copies the APK to `apps/mobile/build/apk/bto-staff-<version>-<versionCode>.apk` (versionCode = minutes since 2026-01-01, so it only grows).

Do not run it while `pnpm check` runs: the load makes the integrity suite time out.

`BTO_SERVER` sets the address the app starts with (default `http://<this PC's Wi-Fi address>:3300`). Cleartext HTTP is allowed outside `APP_ENV=production` (office Wi-Fi until go-live). Release builds are signed with the template's debug key until the owner chooses a release key.

**Install:** copy the APK to the phone (USB, messenger) and allow «install unknown apps»; an update needs a higher versionCode and the same key. The phone and the PC must share the Wi-Fi (no client isolation); Windows Firewall must let Node.js answer on Private networks (as `start.bat` says).

## 10. Tests

- **Vitest** (`pnpm --filter @tugeel/mobile test`, in `pnpm check`): the session (login, one refresh for concurrent 401s, early refresh, grace, restore online/offline/refused, a server that never answers (offline after the limit), other server, logout offline), the thumbnails' schedule and runs, the card's and the page's pictures, the home's name, date line and new products, the recent servers, the cart reducer (one line per product, the contact, an old stored cart) and order body, the pending send, the placement rule, dates without time zones, the calendar (Monday first, presets, the range picker, 366 days), the shop filters (the default warehouse, the count, stored filters, top categories, supplier letters), units (the default and pack units, shortages), money and stock texts, the scan gate, the server address, the APK helpers, the Metro pin, one React in the workspace, the credit refusal's text (`creditMessage`), the notifications feed by day, the popup queue, its replay and pictures, and initials.
- **API:** `auth-mobile.int-spec.ts`, `sales-rep.int-spec.ts`, `sales-rep-shop.int-spec.ts`, `sales-rep-shop-filters.int-spec.ts`, `sales-rep-races.spec.ts` (integrity), `rep-access.spec.ts`, `notifications.int-spec.ts`, `notifications-guards.spec.ts` (integrity).
- **On the phone:** the owner's walk, board by board (ADR-0068): the shop's grid, chips, «+» and quantities; the filter and the suppliers; a product's pictures, units, keypad, shortage and total; the cart's edit; the checkout's sheets, the note over the keyboard and the sent order; the orders' presets, calendar and search; the profile, the details and a password change, the order settings, the notifications, the popup and its toast; a lost connection while sending.

## 11. Open items

- **TODO-VERIFY (owner):** the package id `mn.butenorgil.bto.staff`, permanent once handed out; a release key and how APKs reach the reps; a logo (1024×1024 PNG) instead of the placeholder «B»; the reps' phones (Android ≥ 7, arm64).
- Payments, returns, receivables on the customer card (with finance, delivery 3); visit plans and rep zones (delivery 5/7; the customer reads by id must then pass `CustomersService.visibleTo`, `docs/modules/sales.md` §10); biometric unlock; keyboard-wedge scanners (delivery 4's warehouse flows).
- EAS Build and Update, the Play internal track and HTTPS at go-live (row 12); push for notices then (ADR-0062 #7).
- Swiping a sheet down and the boards' blur (iOS-only effects) are left out (ADR-0068); a sheet closes with ×, «Болих» or the dimmed page.
