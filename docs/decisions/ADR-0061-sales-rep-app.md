# ADR-0061: The sales-rep app v1 — an Expo staff app built on the owner's PC, native token refresh and a sales-rep facade

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0006 (#2: SDK 57 pinned now; #3: local Gradle release APKs instead of EAS until go-live; #4: the camera path first), ADR-0016 (#1: Vitest unit tests for the app's pure modules instead of `jest-expo` for now), ADR-0027 (#8: a body-token transport for native clients beside the web's cookie), ADR-0056 (#2) and ADR-0057 (#4: a rep's order lands on the stage the rep chose; a CONFIRM stage submits it in the same transaction) |
| Amended by | ADR-0062 (#1: the app shows the admin's notices — a popup at start, a bell with a count on «Профайл», a notifications screen, a notice's products — and the rep's sold orders); ADR-0068 (#1, #5, #8: the boards' look, «Бараа», the shop's filters and sorts, a checkout page, orders by days, one cart line per product with a contact) |

## Context

The owner gave the APK of the sales-rep app they use today (erxes SR, Expo SDK 57) and asked for the same kind of app on Bto. The APK served as a reference for screens and flows only: login with a server address, a shop by category, search and barcode with piece and box units, prices and stock, a cart, a customer, sending; the rep's orders by month; a setting that chooses the board, pipeline and stage of new orders. No code, logo or picture of it is used.

The roadmap had the Expo project in delivery 4 and the rep in delivery 7 (STATUS rows 4 and 7). The owner pulled a first version forward. What the code offered (2026-10-15):

- The refresh token lives only in an httpOnly cookie, and refresh and logout require an `Origin` equal to `Host`: a native app sends neither, so it could not stay signed in past the 15-minute access token.
- The `SALES_REP` role held no permission; every order was created on the `ADMIN` channel.
- Orders without a pipeline, and those on PUBLIC pipelines, are visible to every holder of `sales.orders.read`: a rep given that permission would see the office's orders.
- Unit prices could be read one product at a time only.
- The web pins React 19.3.0; React Native 0.86 needs exactly 19.2.3.

The owner's answers (2026-10-15):
- **Scope.** Order taking and «Миний захиалгууд» (by month). Payments, returns, new customers and biometric login come later.
- **Look.** Bto's tokens and Inter, with the reference app's order of screens.
- **Build.** On the owner's PC (no cloud builds); the phone reaches the PC over the office Wi-Fi.
- **Placement.** The rep chooses the board, pipeline and stage in the app's settings; an order is created directly on that stage.
- **Customers.** Every active customer for now; zones come with deliveries (delivery 5).
- **At sending.** The payment method, the delivery date (tomorrow by default) and a note; delivery to the customer's default address.

## Decision

1. **Scope.** `apps/mobile`, the `staff` variant of ADR-0006 #1, with the sales-rep route group only: server address, login, «Нүүр», «Дэлгүүр», «Сагс», «Захиалга», «Профайл», a product page, the scanner, the customer picker, the order page and the placement settings.
2. **Platform and build** (amends ADR-0006 #2–#3).
   - **SDK 57**, the stable SDK on the day: `expo` 57.0.x, `react-native` 0.86.3, `react` 19.2.3 in `apps/mobile` only; Expo Router. Recorded in `docs/modules/mobile.md`. An SDK 58 upgrade gets its own session before the customer app.
   - **Release APKs built on the owner's PC** with `pnpm mobile:apk`: `expo prebuild` (the `android/` folder is generated, never committed), then Gradle `assembleRelease` with JDK 17, Android SDK 36, NDK 27.1.12297006 and CMake 3.22.1. The build runs in a robocopy mirror of the workspace at `C:\Android\m`, because the repository path is long and holds spaces (a `subst` drive gave React Native's codegen two roots), and CMake's object paths are capped for Windows' 260 characters. No EAS Build or EAS Update until go-live: every fix is a new APK with a higher `versionCode`.
   - **Cleartext HTTP** is allowed in builds for the office network (the system is local until go-live, ADR-0026); production builds turn it off.
   - The APK is signed with the template's debug key until the owner chooses a release key (before handing the app to the reps).
3. **Workspace.** The app lives in the pnpm workspace beside the web: exact pins, every version at least a day old, one TypeScript, and **one React: the Expo SDK's** (19.2.3, with `react-dom` 19.2.3 in the app too). The web moves from 19.3.0 to 19.2.3: on a clean install a second React hoisted beside packages both apps use (react-i18next, Radix, vaul) broke the web with «Invalid hook call», and React Native runs only with the React it was built for. A unit test fails on any second copy of `react` or `react-dom`; the web's React follows the SDK at each upgrade. Metro resolves `react` and `react-native` from `apps/mobile` and reads `@tugeel/shared` from source through the `@tugeel/source` condition (ADR-0025 #4). The app imports only `@tugeel/api-client` and `@tugeel/shared`; shared modules that need `Intl` time zones, `\p{…}` regexes or `normalize()` (`text`, `taxpayer`, `imports`, `inventory`, `businessDate`) are not imported: the server sends «today».
4. **Native token transport** (amends ADR-0027 #8). `POST /auth/mobile/login`, `/auth/mobile/refresh` and `/auth/mobile/logout` carry the refresh token in the JSON body, with the same rotation, 20-second grace and reuse revocation as the cookie. A request carrying an `Origin` header is refused: browsers always send one, so a script on the admin's origin cannot obtain a readable refresh token. The app keeps the token in `expo-secure-store`. A grace answer carries no new token (the stored one stays); a refresh answer lost on the network can therefore end in TOKEN_REUSE and a new login — the security model is kept on purpose.
5. **Rights and the facade.** A new permission `sales.orders.rep` («Төлөөлөгчийн апп»); the `SALES_REP` role holds only it. Reps get neither `sales.orders.read` / `manage` (other orders) nor `partners.customers.read` (credit data). Everything the app needs passes through `/api/v1/sales-rep/*` in the sales module:
   - `GET /context`: the server's business date, the stages the rep may place on (by board and pipeline) and the SALES_REP channel default when it is one of them.
   - `POST /orders` (Idempotency-Key): the order on the chosen stage.
   - `GET /orders?month=YYYY-MM` and `GET /orders/:id`: the rep's own SALES_REP orders, by Ulaanbaatar month; another order answers 404.
   - `GET /products`, `GET /products/batch`: active, sale-ready products with each unit's wholesale price and the home warehouse's available quantity.
   - `GET /customers`, `GET /customers/:id`: active customers only, with their addresses and contacts, through `CustomersService.visibleTo` (the hook reserved for zones).
   - The cart's totals come from `POST /pricing/quote`; the app never computes a price (ADR-0006 #6).
6. **Placement** (amends ADR-0056 #2, ADR-0057 #4). A rep may place an order on a stage when its pipeline is live and PUBLIC or visible to one of the rep's roles, the stage is live with action NONE or CONFIRM, and its MOVE right is open (no roles) or granted to one of the rep's roles; admins limit reps per stage with MOVE roles. In one transaction: the pipeline and stage are locked `FOR SHARE` and the rule checked, the order is created on the `SALES_REP` channel; a NONE stage leaves a numbered draft, a CONFIRM stage submits it as ADR-0055 says (prices frozen, stock reserved, the rest backordered) and the number is drawn last. Any refusal leaves nothing behind. The office flow is unchanged.
7. **Prices for the shop.** `ProductPricesService.tablesOf(productIds)` computes, for many products, the unit table `view()` computes for one.
8. **Data on the device.** The refresh token in secure storage; the server address, the chosen stage and the unsent cart in app storage, per server and user; the cart's pending send keeps its Idempotency-Key, so a send repeated after a lost answer never creates a second order.
9. **Tests** (amends ADR-0016 #1). Vitest unit tests for the app's pure modules (session, cart, send, dates, the Metro pin), integration and integrity tests for the API, and a walk on the owner's phone. `jest-expo` waits until screens need automated tests.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| EAS cloud builds | The owner chose building on the PC; no account or plan needed before go-live. |
| A cookie jar in React Native with a hand-made `Origin` | Fragile, and it bends the CSRF rule the cookie exists for. |
| Giving reps `sales.orders.read` and own-orders pipelines | Pipeline-less and PUBLIC-pipeline orders would still be visible; the facade enforces "own orders" on the server. |
| Giving reps `partners.customers.read` | It shows credit limits, holds and notes; the facade returns what an order needs. |
| A draft, then a second request to submit | Not atomic: a failed submit would leave a draft the rep cannot see why. |
| SDK 58 | Still a beta on the day. |
| Android Studio's bundled JDK 25 | AGP 8.12 and Kotlin 2.1.20 predate it. |
| Two Reacts side by side (the web on 19.3.0, the app on 19.2.3) | Under the hoisted layout a clean install put the app's copy beside packages the web shares: the web's tests failed with «Invalid hook call». |
| The app outside the pnpm workspace | A second lockfile and toolchain; the app would lose the shared lint, typecheck and tests of `pnpm check`. |
| `jest-expo` now | A second Jest and Babel toolchain in `pnpm check` for no screen tests yet. |

## Consequences

**Positive.**
- Reps take orders from the phone the way they do today, and the orders land on the owner's boards.
- The server alone decides prices, stock and visibility; the app holds no rule of its own.

**Negative.**
- Every fix is a new APK to install by hand until go-live.
- Cleartext HTTP on the office Wi-Fi until go-live.
- A lost refresh answer means a new login; a session lasts one 12-hour shift.
- The web's React version follows the Expo SDK (19.2.3 now, not 19.3.0).

## Related

ADR-0005, ADR-0006, ADR-0016, ADR-0020, ADR-0025, ADR-0026, ADR-0027, ADR-0055, ADR-0056, ADR-0057, ADR-0058, SPEC §3, §5.7, architecture §3, §6–§8, `docs/modules/mobile.md`, `docs/modules/sales.md`, `docs/modules/identity.md`.
