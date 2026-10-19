# ADR-0084: The customer app's build — one variants table, a session class per app, route groups by variant, a shared kit

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-19 |
| Deciders | Owner (the CA3 plan approved 2026-10-19), Claude (Claude Code session, CA3) |
| Implements | ADR-0079 (#1, #9–#14): the app side of «Bto300» on the server of ADR-0082 |
| Amends | ADR-0006 #1 (how `APP_VARIANT` selects an app), ADR-0061 #4 (the native token transport serves both apps), `docs/modules/mobile.md` |

## Context

ADR-0079 decided that «Bto300» is the `customer` variant of the one Expo project in `apps/mobile`, drawn on the rep app's kit (ADR-0068) and built as an APK on the owner's PC. On 2026-10-19 (50a74f4) the project was the rep app only:

- `app.config.ts` threw for any `APP_VARIANT` but `staff`; `scripts/build-apk.mjs` hard-coded the staff variant and its `bto-staff` file name; the location plugin was always on.
- `MobileSession` hard-coded `/auth/mobile/*`, the staff `Me` and `GET /auth/me`; the root layout let a user in by the `sales.orders.rep` permission.
- The cart send, the pending-send card, the product card, the quantity keypad, the notice popup gate and the thumbnail keeper were wired to the rep's routes and its numeric stock.

The customer API (ADR-0082) answers a store's token on `/auth/customer/*` and `/customer-app/*` only and refuses it everywhere else with 403; its stock is a word (`IN` / `LOW` / `OUT`), never a number.

## Decision

1. **One table of apps.** `apps/mobile/variants.json` holds what differs per app: the name («Bto» / «Bto300»), the slug and scheme, the version (staff 0.6.0, customer 0.1.0), the Android package (`mn.butenorgil.bto.staff` / `mn.butenorgil.bto300`, both TODO-VERIFY), the icon folder (`assets/` / `assets/customer/`), the APK's prefix (`bto-staff` / `bto300`) and whether the app uses the position (the store map: staff only; the customer build blocks the location permissions). `app.config.ts` reads the row of `APP_VARIANT` (an unknown name fails the build) and puts `variant`, `defaultServer` and `serverFixed` in `extra`; both apps keep `CALL_PHONE` (the rep's store calls, the store's «Холбоо барих»). `src/config/app.ts` reads `extra` once for the app.
2. **A fixed server in production builds** (ADR-0079 #10). `serverFixed` is true only for `APP_ENV=production` with `BTO_SERVER` set: the app then never shows the server screen or the «Сервер солих» chip. Office builds keep both, as today.
3. **A session class per app.** `MobileSession<P>` keeps the transport (the access token in memory, the refresh token in secure storage, one refresh at a time, a 401 refreshed once and resent, a 403 never refreshed, 10 s per call, offline vs refused) and leaves the routes and the principal to two subclasses: `StaffSession` (`/auth/mobile/*`, the user from `GET /auth/me`) and `CustomerSession` (`/auth/customer/*`, `login(phone, password)` and `setupPassword(phone, code, newPassword)`, the store from `GET /customer-app/me`). A store's stored session is keyed on its app account (`account.id`, ADR-0082); the two apps are separate Android packages, so their secure stores never meet. `useSignedIn()` gives the rep's session and `useCustomer()` the store's; each refuses the other.
4. **Route groups by variant.** The root layout guards `login`, `not-rep` and `(staff)` with the staff build and `sign-in`, `set-password` and `(customer)` with the customer build, each also by the phase (`src/state/phase.ts`: a staff user without `sales.orders.rep` sees «not a rep»; every signed-in store enters). Screens of both groups may share a URL (`/order/12`): Expo Router resolves a path to the group the user is in. Both groups' code is in each bundle until go-live; the other group is never mounted, and the server refuses the other kind of token anyway.
5. **A shared kit, each app's data.** The rep app's pieces are split where the store's app differs, without changing what a rep sees: the idempotent send (`useIdempotentSend`, the rep's `useSendOrder` and the store's `useCustomerSendOrder` on it), `PendingSendView`, `KeypadSheet` (the rep's `QtyKeypad` and the store's keypad on it), `ProductCardFrame` (the rep's stock count or the store's ★ and stock word), `PopupGate` and `ThumbKeeperFor` (each app's summary and thumbnail list). The store's own logic lives in `src/customer/` and its reads in `src/api/customer.ts` and `src/api/customer-notifications.ts`.
6. **Words, never numbers.** The store's screens show `sales.stockWords.*` and `quote.stock[].mayBackorder` only; the keypad's line under the name says the code and the word; no store screen reads a quantity in stock.
7. **`expo-clipboard` 57.0.2** (SDK 57's bundled version) copies a bank account or an invoice number («Хуулах», ADR-0079 #13); nothing else is added.
8. **Build.** `pnpm mobile:apk -- --variant customer` builds `apps/mobile/build/apk/bto300-<version>-<versionCode>.apk`; without `--variant` it builds the staff app as before. The «B300» icons are placeholders drawn from the boards until the owner's 1024×1024 logo (TODO-VERIFY).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A second Expo project for «Bto300» | Two copies of the kit, the session, the scanner and the build to keep in step; ADR-0006 chose one project. |
| A `variant` check inside every shared screen | Mixes two apps in one screen tree; a change for stores could silently change the rep app. Groups keep each app's screens apart. |
| One session class with a variant switch inside | The typed client needs literal paths per call; two small subclasses keep the paths literal and the principal typed. |
| Copying the rep's components wholesale for stores | They would drift; the split keeps one picture of a card, a keypad or a send. |
| Dropping the server screen in every customer build now | Until go-live the office Wi-Fi address changes (DHCP); the owner's builds keep the screen, a production build fixes the server. |

## Consequences

- Positive: one project builds both apps; the rep app's tests and screens stay as they were; the store's app reads only its own routes.
- Positive: the store's pure rules (stock words, order progress and takers, the account card, reorder, the sign-in fields, notification targets) are unit-tested in Vitest.
- Negative: each APK carries the other app's screen code (unreachable) until go-live; a smaller bundle per app is a go-live task (row 12) if it ever matters.
- Negative: the placeholder icon and package id wait for the owner (TODO-VERIFY).
- Follow-ups: the owner's phone walk; push, iOS and store listings at go-live (ADR-0079 follow-ups); a store's centre when Kharkhorin joins.

## Related

ADR-0006, ADR-0061, ADR-0062, ADR-0068, ADR-0079, ADR-0082, `docs/modules/mobile.md`, `docs/modules/customer.md`.
