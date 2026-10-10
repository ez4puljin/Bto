# ADR-0021: Scanning and printing: keyboard-wedge first, raster receipts by default, browser labels first

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0031 (camera fallback: `barcode-detector` with self-hosted ZXing WebAssembly instead of `html5-qrcode`; wedge digits read by physical key) |

## Context

Facts (`docs/architecture.md` §9, §13): cheap USB and Bluetooth scanners act as keyboards (HID wedge, Enter suffix); every Android PDA brand supports keyboard-wedge output; `expo-camera` supports `itf14`, `upc_a`, `upc_e` besides EAN/Code128/QR; browsers cannot open raw sockets to port 9100 and WebUSB is blocked by Windows printer drivers; QZ Tray needs a purchased certificate or a self-managed root certificate for silent printing; the Russian Cyrillic code pages (PC866, CP1251) that thermal printers offer do not contain Mongolian Ө/ө and Ү/ү, so "Төв", "Үнэ" print as wrong glyphs; the e-Barimt receipt must show seller name and TIN, ДДТД, totals, VAT, the lottery after the word "сугалаа" and a sharp QR; the API runs in Singapore while the printers are in Ulaanbaatar. Delivery-1 warehouse flows run in phone browsers before the staff app exists (delivery 4), and the lead time for Bluetooth scanners in Ulaanbaatar is unknown.

## Decision

**Scanners.**
1. **Keyboard-wedge first.** Web admin: a global keydown burst detector (onScan.js-style; Enter suffix, `minLength 4`, ignores focused inputs unless they are the visible "scan box") in `apps/web/src/lib/scan`. Mobile: the hidden always-focused `TextInput` in `useScanner` (ADR-0006). All scanners are standardised to US layout + Enter suffix.
2. **Browser camera scanning in delivery 1.** The web scan box also offers a camera mode using the Chrome Android `BarcodeDetector` API with a JavaScript fallback (`html5-qrcode`) so phone-browser receiving, put-away and counting work before the staff app exists. Allowed types everywhere: `ean13`, `ean8`, `code128`, `qr`, `itf14`, `upc_a`, `upc_e`; GTIN-8/12/13/14 are normalised before lookup (ADR-0008).
3. **Two cheap Bluetooth HID scanners are ordered on day 1** of Week 0 so they arrive before go-live; one keyboard-wedge Android handheld, one Sunmi-class device and the printers below are ordered the same week for the week-1 hardware test. Device models are chosen **after** that test, not in this ADR.

**Labels.**
4. Phase 1 (delivery 1, below the cut line if time is short): HTML/CSS `@page { size: <w>mm <h>mm; margin: 0 }` templates with bwip-js barcodes, printed through the browser and the printer's Windows driver (optional Chrome `--kiosk-printing` on the label PC). Phase 2: server-generated TSPL/ZPL sent to an Ethernet label printer on port 9100 through the print agent (ADR-0022). Label printers are bought with Ethernet and documented TSPL + ZPL emulation.

**Receipts.**
5. **Raster is the default for any line containing Mongolian text** (and for the QR) on every printer class: the receipt view is rendered to a 1-bit bitmap (384 dots for 58 mm, 576 dots for 80 mm) and sent as ESC/POS raster (`GS v 0`); text mode is used only for ASCII and digits. A code-page path is enabled per printer model only after the physical device proves it prints "Төв Үнэ ө ү" correctly. The week-1 printer test includes exactly that string plus a QR.
6. **POS receipts (delivery 9)** are generated server-side as ESC/POS bytes (`@point-of-sale/receipt-printer-encoder`) and delivered to the Ethernet 80 mm printer at the supermarket by the **print agent** on the POS PC (ADR-0022), which also pulses the cash drawer. No browser print dialog, no QZ Tray.
7. **Driver and rep receipts** use the `packages/printing` raster pipeline over Sunmi built-in printers or Bluetooth SPP (dual-mode Classic + BLE printers so iOS can follow later), Android-first. The delivery in which this ships depends on the accountant's receipt-timing answer (ADR-0017, `docs/SPEC.md` §11 #2): delivery 5 if the driver is to print the receipt at the point of handover to the customer, otherwise delivery 10.
8. **Server PDFs** (pick lists, invoices, delivery notes, payslips) use pdfmake with embedded Noto Sans (ADR-0011).
9. `packages/printing` isolates every community printer library behind one interface and carries a **hardware re-test checklist** that is run on every Expo SDK upgrade.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Vendor scanner SDKs (DataWedge, Sunmi broadcast) from day one | Native modules before the staff app exists; the wedge works everywhere and the SDKs fit behind the same hook later. |
| Zebra Browser Print | Zebra-only; request-gated download. |
| Code-page text as the default with raster fallback | PC866/CP1251 lack Ө and Ү; receipts would be wrong by default. |
| Browser print dialog for POS receipts | No cash-drawer pulse, uncertain Cyrillic and QR rendering, a dialog per sale. |
| QZ Tray for POS receipts | Certificate purchase or a self-managed root certificate on every POS PC, plus warning dialogs (ADR-0022). |
| React Native POS on Sunmi hardware | Harder to build and debug than a screen in the existing web admin. |
| Waiting for the staff app to scan at all | Delivery-1 go-live would have workers typing SKUs. |

## Consequences

**Positive.** No native code in delivery 1; Mongolian text correct on every printer; scanning works in a phone browser from go-live; printer libraries are isolated.

**Negative.** Raster printing is slower than text mode (acceptable for one receipt at a time); two hardware-test cycles (week 1, delivery 9); the driver-printing delivery placement waits for the accountant.

**Follow-ups.** Day 1: scanners and test printers ordered. Week 1: hardware test with the Mongolian test string. Delivery 1: scan box, camera mode, label templates. Delivery 4: `useScanner`. Delivery 9: POS receipts via ADR-0022.

## Related

ADR-0006, ADR-0008, ADR-0011, ADR-0017, ADR-0022, `docs/architecture.md` §8, §9, §13, `docs/SPEC.md` §5, §9.
