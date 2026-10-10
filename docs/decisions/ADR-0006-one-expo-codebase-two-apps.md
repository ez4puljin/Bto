# ADR-0006: One Expo codebase, two store apps via APP_VARIANT

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0026 (store listings and the EAS Starter plan come with the go-live phase; development builds reach the API on the LAN) |

## Context

Four mobile roles (customer, warehouse worker, sales rep, driver) must be served by one maintainer on Windows without Xcode. The EAS free tier allows 30 builds per month and caps EAS Update at 1,000 MAU. Apple review is hostile to public apps that hide staff features. Scanner and printer hardware is Android-first. Real mobile work starts in delivery 4 (staff app) and delivery 6 (customer app), several months after this decision; Expo SDK 58 was in beta on 2026-09-15 and each SDK receives about one year of support, so pinning SDK 57 today would put the customer app on a near-end-of-life SDK (`docs/architecture.md` §8, §13).

## Decision

1. **One Expo project** in `apps/mobile`. `app.config.ts` reads `APP_VARIANT` and produces two apps: `customer` (public listing, iOS + Android) and `staff` (Android-first, EAS internal distribution + Google Play internal track; iOS later). Role-gated route groups `app/(customer)` and `app/(staff)/(warehouse|sales|driver)` after login; build-time exclusion of the staff groups from the customer bundle is evaluated at delivery-4 kickoff (`docs/architecture.md` §8); in any case every staff endpoint is protected by API permissions (ADR-0005).
2. **The Expo SDK is chosen at delivery-4 kickoff**: the then-current stable SDK (expected 58 or 59) is pinned in `docs/modules/mobile.md` and CLAUDE.md with the date. Any Expo scaffold created before delivery 4 is disposable. SDK upgrades happen only in dedicated sessions between deliveries.
3. **Development builds only** (never Expo Go), built with EAS Build; EAS Update for JavaScript-only fixes. EAS Starter plan from the customer-app launch (free tier MAU cap). Org accounts (D-U-N-S, Apple Developer, Google Play) and the Expo org are created in Week 0.
4. **Scanning** goes through one `useScanner` hook: a hidden, always-focused `TextInput` (`showSoftInputOnFocus={false}`, Enter suffix) for keyboard-wedge scanners (built-in PDA scanners and Bluetooth HID guns), with an `expo-camera` `CameraView` fallback. Allowed camera barcode types: `ean13`, `ean8`, `code128`, `qr`, `itf14`, `upc_a`, `upc_e` (ITF-14 is the usual carton GTIN-14 for box units). Debounce by clearing the handler after a hit and requiring the same value twice. Scanned GTIN-8/12/13/14 values are normalised to a canonical GTIN before lookup in `BarcodeService.resolve`. Vendor SDKs (Zebra DataWedge, Sunmi broadcast) are added later behind the same hook.
5. **Printing** from the staff app goes through `packages/printing` (ADR-0021). Push through `expo-notifications`; secure storage through `expo-secure-store`; location for proof of delivery through `expo-location`.
6. Shared code: `packages/api-client`, `packages/shared` (validation, unit conversion, pricing resolver, i18n `mn.json`). Mobile never computes prices.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Two separate Expo projects | Doubles builds, config and upgrades; shares nothing without a third package. |
| Four apps (one per role) | Four store listings and four build pipelines for one person. |
| One public app for everyone | Apple review risk; staff features visible to customers; one incident takes down both. |
| PWA for staff | No Bluetooth Classic printers, weak scanner intents, no reliable camera scanning on iOS. |
| Flutter | Second language; cannot share the generated client or `packages/shared` (ADR-0001). |
| Pin Expo SDK 57 now | Would be near end-of-support when the customer app ships; SDK 58 reworks Expo Router, so the upgrade would land in the middle of the first mobile module. |

## Consequences

**Positive.** Shared auth, API client, scanner and printing code; two listings; the staff build never goes through public review. SDK choice deferred to when it matters.

**Negative.** Variant-specific native config must be tested for both apps on every build; iOS staff support deferred; community printer libraries must be re-tested on SDK upgrades (hardware checklist in ADR-0021).

**Follow-ups.**
- Week 0: D-U-N-S, Apple, Google Play, Expo org (owner).
- Delivery 4 kickoff: pin SDK, write `docs/modules/mobile.md`, evaluate build-time exclusion of the staff route groups on that SDK.
- Delivery 6: EAS Starter plan.

## Related

ADR-0001, ADR-0004, ADR-0005, ADR-0020, ADR-0021, `docs/architecture.md` §8, §9.
