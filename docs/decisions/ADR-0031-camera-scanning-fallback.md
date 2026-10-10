# ADR-0031: Camera scanning fallback: barcode-detector with self-hosted ZXing WebAssembly, layout-independent wedge input

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0021 #1 (wedge input read by physical key), #2 (the JavaScript camera fallback) |

## Context

ADR-0021 #2 gives the web scan box a camera mode: the browser's `BarcodeDetector` where it exists, `html5-qrcode` elsewhere. Facts checked on 2026-10-11 against the npm registry: `html5-qrcode` 2.3.8 was published in April 2023 and nothing since; `barcode-detector` (MIT) is a ponyfill of the Barcode Detection API on ZXing-C++ compiled to WebAssembly (`zxing-wasm`), with releases through August 2026 (3.2.2 on 2026-08-16, `zxing-wasm` 3.1.3 on 2026-08-14). The native `BarcodeDetector` ships in Chrome on Android, macOS and ChromeOS, but not in Chrome on Windows, Firefox or Safari, so the owner's Windows PC and iPhones need the fallback. By default `zxing-wasm` downloads its `.wasm` from the jsDelivr CDN. Browsers open a camera only in a secure context (HTTPS or localhost); during local-only development (ADR-0026) phones reach the dev server over plain HTTP on the LAN.

Keyboard-wedge input has a second gap: a USB or Bluetooth scanner types through the active keyboard layout, and the Mongolian Cyrillic layout puts symbols (№, ₮, …) on the unshifted number row, so "4901234567894" arrives as symbols whenever the operating system is set to Mongolian. Standardising the scanners to "US layout" (ADR-0021 #1) does not help, because the translation happens in the operating system.

## Decision

1. **Fallback library.** The web camera fallback is `barcode-detector` 3.2.2 through its `ponyfill` entry, with `zxing-wasm` 3.1.3 as a direct dependency of `apps/web` pinned to the exact version `barcode-detector` declares; both move together in a dependency-upgrade session.
2. **Self-hosted WebAssembly.** Vite emits `zxing_reader.wasm` (1.1 MB, 464 KB gzip) as a hashed asset of our build; `prepareZXingModule({ overrides: { locateFile } })` points at it, so no request ever goes to a CDN. The ponyfill (44 KB) and the `.wasm` are loaded only when a camera scanner opens (`apps/web/src/lib/scan/camera.ts`). The SPA's CSP allows `script-src 'self' 'wasm-unsafe-eval'`; `Permissions-Policy: camera=(self)` stays as it is.
3. **Native first.** When `globalThis.BarcodeDetector` reports every format the scanner reads (`ean_13`, `ean_8`, `upc_a`, `upc_e`, `itf`, `code_128`, `qr_code`), it is used; otherwise the ponyfill with the same formats.
4. **Accepting a camera read.** The video is examined every 150 ms; a code is accepted when two looks in a row read the same value, then the stream stops and the dialog closes. Every accepted code goes through `@tugeel/shared/gtin` on the API (ADR-0029).
5. **Secure contexts only.** The camera button appears only when `isSecureContext` and `getUserMedia` exist; on a plain-HTTP page the scan box says the camera needs HTTPS or localhost, and the wedge and typing still work.
6. **Layout-independent wedge input.** The global burst detector (`apps/web/src/lib/scan/wedge-detector.ts`: at least 4 characters, at most 50 ms between keys, Enter suffix, modifier keys neutral, keys in text fields left alone) and every barcode text field read a number-row key from `event.code` (`Digit0`–`Digit9`) when the active layout typed something else. Letters still come from `event.key`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `html5-qrcode` 2.3.8 (ADR-0021 as written) | No release since April 2023; ships its own UI; a JavaScript port of ZXing, slower than the C++ build. |
| `@zxing/browser` / `@zxing/library` | JavaScript port in maintenance mode, slower on phones. |
| Quagga2 | Linear codes only; no QR. |
| The package default (`.wasm` from jsDelivr) | A third-party host at run time, a CSP exception for it, and scanning that fails when the CDN is unreachable from Ulaanbaatar. |
| Native `BarcodeDetector` only | No camera scanning on the Windows PC, on iPhones or in Firefox. |
| Requiring the English layout on every PC | Depends on each user's settings; one wrong layout turns every scan into symbols. |

## Consequences

**Positive.** Camera scanning works on desktop Chrome, iPhones and Android with one code path; nothing is fetched from third parties; scanners work whatever keyboard layout the PC uses.

**Negative.** The build carries a 1.1 MB `.wasm` (fetched only by users who open the camera); `'wasm-unsafe-eval'` lets the page compile WebAssembly, which `connect-src 'self'` limits to our own files; until LAN HTTPS exists for development, phones test scanning with a Bluetooth scanner or by typing, not with the camera.

## Related

ADR-0021, ADR-0026, ADR-0029, `docs/architecture.md` §8 and §9, `deploy/Caddyfile`, `CLAUDE.md` pin table.
