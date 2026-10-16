# App `mobile` — contract

Status: **v1 built** 2026-10-15 (the sales-rep app, ADR-0061), pulled forward from deliveries 4 and 7 at the owner's request. Code: `apps/mobile/` (Expo, the `staff` variant of ADR-0006), the API it uses in `apps/api/src/modules/sales/` (`/sales-rep/*`) and `apps/api/src/modules/identity/` (`/auth/mobile/*`). Decisions: ADR-0006, ADR-0016, ADR-0025, ADR-0027, ADR-0061, ADR-0062 (notices, 2026-10-16).

## 1. Scope (v1, owner 2026-10-15)

The sales rep's app, modelled on the screens of the erxes SR app the owner uses (only its flow: no code, logo or picture of it):

- **Server and login:** the API server's address (checked with `GET /health`), then the staff account; the session lasts one shift (`auth.staff_session_hours`, 12).
- **«Нүүр»:** the month's orders, total and drafts; where new orders land; shortcuts.
- **«Дэлгүүр»:** categories, search by name, code or barcode, the camera scanner; each product's units (piece, box…) with the server's wholesale price, the home warehouse's free stock, − n + per unit.
- **«Сагс»:** the lines priced by the server (`POST /pricing/quote`: whole packs and loose parts, discount programs), the customer (search), the address or pickup, the delivery date (tomorrow by default, from the server's «today»), the payment (Бэлнээр / Дансаар / Зээл), a note, «Илгээх».
- **«Захиалга»:** the rep's own orders by month (Ulaanbaatar), with status, stage, payment label; an order's page with lines, reserved and short quantities.
- **«Профайл»** (redesigned 2026-10-16, ADR-0062): the bell with the unread count in the top right corner (also on the Profile tab), the user's initials, name, login and role, the order settings with the chosen stage, the server, logout, «Сервер солих», the version.
- **Notices (ADR-0062, `docs/modules/notifications.md`):** the admin's unread popup notices one at a time in the middle of the screen when the app starts or returns to the foreground (never over the camera, the customer picker or a pending send; shown = read); «Мэдэгдэл» with the running notices and the rep's sold orders by day; a notice's page with its products and − n +.
- **Settings «Захиалга бүртгэх тохиргоо»:** the board → pipeline → stage new orders land on, among those the rep may place on.

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
                           (staff)/(tabs)/{index,shop,cart,orders,profile}, (staff)/{product/[id],
                           order/[id],customers,scan,settings,notifications,notice/[id]},
                           (staff)/notice-popup (a transparentModal route)
  src/api/                 session.ts (tokens), problem.ts, rep.ts, notifications.ts (TanStack hooks)
  src/notifications/       feed.ts (the list by day, the popup queue), kinds.tsx, popup-gate.tsx
  src/cart/                cart.ts (reducer, the order body), send.ts (the pending send), use-send.ts
  src/state/               session.tsx (server + session), shop.tsx (cart, stage, pending send),
                           placement.ts
  src/device/storage.ts    AsyncStorage JSON, the secure token store
  src/{dates,format,scan,server,theme,i18n,ui}/
```

## 4. Workspace rules

- **Packages:** only `@tugeel/api-client` and `@tugeel/shared` (ESLint G1). Not `@tugeel/shared/{text,taxpayer,imports,inventory}` nor `businessDate*` from `@tugeel/shared/time`: Hermes lacks reliable `Intl` time zones and some Unicode regexes (ESLint `mobile` block). The server sends «today» (`GET /sales-rep/context`).
- **Metro** watches the workspace, reads `@tugeel/shared` from source (`@tugeel/source`), resolves `react` and `react-native` from `apps/mobile` (`scripts/metro-pin.cjs`) and skips `apps/api`, `apps/web`, `.claude`, `tmp`.
- **Scripts:** never `build` or `dev` (`pnpm check` and `pnpm dev` run them on every package). `typecheck` and `test` run in `pnpm check`; `apk` and `expo` are by hand.
- **Strings:** every one in `packages/shared/i18n/mn.json` under `mobile.*` (reusing `sales.*`, `auth.login.*`, `common.*`, `errors.*`); no `count` interpolation (Hermes may lack `Intl.PluralRules`).
- **Tokens:** `src/theme/tokens.ts`, the web's values (docs/ui.md); Inter faces by file name; touch targets ≥ 44.

## 5. Auth (ADR-0061 #4)

`MobileSession` (`src/api/session.ts`): `POST /auth/mobile/login` gives the access token (memory) and the refresh token (expo-secure-store `bto.session.v1`, with the server and user). One refresh at a time, 30 s before the access token ends or after a 401 (then the call is sent again once); a rotated token is stored before it is used; `refreshToken: null` (the grace answer) keeps the stored one. A refresh nobody answered → `offline` (session kept); one refused → anonymous (`expired`). Logout clears the store even without a connection. Known limit: a refresh answer lost on the network ends in TOKEN_REUSE and a new login.

## 6. API used

`GET /health`; `/auth/mobile/{login,refresh,logout}`, `GET /auth/me`; `GET /sales-rep/context`, `GET /sales-rep/products`, `GET /sales-rep/products/batch`, `GET /sales-rep/customers`, `GET /sales-rep/customers/:id`, `POST /sales-rep/orders`, `GET /sales-rep/orders?month=`, `GET /sales-rep/orders/:id`; `POST /pricing/quote`, `GET /categories`, `GET /barcodes/:code` (these three need only a signed-in user); `GET /me/notifications/summary` (at start, on foreground, every 60 s), `GET /me/notifications`, `POST /me/notifications/read`; product and notice pictures from `/api/v1/files/public/<key>`. Rights: `sales.orders.rep` (the SALES_REP role); `docs/modules/sales.md` §4.

## 7. Data on the phone (ADR-0061 #8)

| Where | Key | What |
|---|---|---|
| expo-secure-store | `bto.session.v1` | `{server, userId, refreshToken}` |
| AsyncStorage | `bto.server.v1` | the server address |
| AsyncStorage | `bto.cart.v1:<server>:<userId>` | the cart (lines, customer, delivery, date, payment, note), written 300 ms after a change |
| AsyncStorage | `bto.stage.v1:<server>:<userId>` | the chosen stage |
| AsyncStorage | `bto.send.v1:<server>:<userId>` | the pending send `{key, body, startedAt}`, stored BEFORE the request leaves |

The send (`src/cart/use-send.ts`): the same body keeps its Idempotency-Key (canonical JSON), a different body takes a new key; 201 (a replay too) clears the cart; 409 `IDEMPOTENCY_KEY_IN_PROGRESS` waits 1.5 s (four times); no answer or a 5xx keeps the pending send and locks the cart («Дахин илгээх» repeats the stored body and key; «Илгээлтийг хаях» after checking «Миний захиалгууд»); any other refusal drops it (the server released the key) and shows the problem, lines from `errors[].path = lines.N`. A pending send older than 6 days takes a new key (the server forgets keys after 7).

## 8. Scanning

`expo-camera` `CameraView` with ean13, ean8, upc_a, upc_e, itf14, code128; `ScanGate` (`src/scan/scan-gate.ts`): a value counts when read twice within 1.5 s and passing `classifyBarcode` (check digit), then 2 s of rest; then `GET /barcodes/:code` (a box barcode gives the box unit) and the product from `/sales-rep/products/batch`. The camera permission is asked in the app; a refused one opens the phone's settings.

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

- **Vitest** (`pnpm --filter @tugeel/mobile test`, in `pnpm check`): the session (login, one refresh for concurrent 401s, early refresh, grace, restore online/offline/refused, other server, logout offline), the cart reducer and order body, the pending send, the placement rule, dates without time zones, money and stock texts, the scan gate, the server address, the APK helpers, the Metro pin, one React in the workspace, the credit refusal's text (`creditMessage`), the notifications feed by day, the popup queue and initials.
- **API:** `auth-mobile.int-spec.ts`, `sales-rep.int-spec.ts`, `sales-rep-shop.int-spec.ts`, `sales-rep-races.spec.ts` (integrity), `rep-access.spec.ts`, `notifications.int-spec.ts`, `notifications-guards.spec.ts` (integrity).
- **On the phone:** the owner's walk (server, login, shop, scan, cart, send on a NONE and a CONFIRM stage, own orders by month, a lost connection while sending).

## 11. Open items

- **TODO-VERIFY (owner):** the package id `mn.butenorgil.bto.staff`, permanent once handed out; a release key and how APKs reach the reps; a logo (1024×1024 PNG) instead of the placeholder «B»; the reps' phones (Android ≥ 7, arm64).
- Payments, returns, receivables on the customer card (with finance, delivery 3); visit plans and rep zones (delivery 5/7; the customer reads by id must then pass `CustomersService.visibleTo`, `docs/modules/sales.md` §10); biometric unlock; keyboard-wedge scanners (delivery 4's warehouse flows).
- EAS Build and Update, the Play internal track and HTTPS at go-live (row 12); push for notices then (ADR-0062 #7).
- The new design of the other screens («Бараа» with the filter, the cart's customer step, the keypad, «Миний захиалгууд» with dates; the owner's design artifact of 2026-10-16) comes in a later session.
