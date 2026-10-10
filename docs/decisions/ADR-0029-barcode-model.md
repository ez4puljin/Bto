# ADR-0029: Barcode model: one lookup key, a type per barcode, internal EAN-13 codes

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0008 #1 (`barcode_type` on `product_units`) |

## Context

Pieces carry manufacturer barcodes, boxes and blocks carry their own (often ITF-14), and some products carry none, so the system must issue internal codes that labels print later (interview of 2026-10-10). Barcodes never repeat across products. One GTIN reaches the scanner in several forms: a UPC-A label may be read as 12 digits or as a 13-digit EAN with a leading zero, and an 8-digit code may be EAN-8 or UPC-E. ADR-0008 #1 puts the e-Barimt `barcode_type` on the unit row, but a unit can have a manufacturer code and an internal code of different types, and an e-Barimt item line sends one specific `barCode` with its `barCodeType`. Keyboard-wedge scanners with Caps Lock on send upper-case Code 128 text.

## Decision

1. **Normalisation in `packages/shared/src/gtin`.** Numeric codes of 8, 12, 13 or 14 digits must carry a valid GS1 check digit (scanners verify it, so a wrong one is a typo and is refused); UPC-E is expanded to UPC-A; valid GTINs are padded to `gtin14`. Other printable ASCII codes up to 48 characters stay as entered.
2. **One lookup key.** `product_barcodes.lookup_key = coalesce(gtin14, upper(code))`, unique across the whole table and enforced by a CHECK. A scan is resolved through `lookupCandidates()`: an 8-digit code valid both as EAN-8 and as UPC-E yields two keys, and when both resolve to different products the API answers 409 `BARCODE_AMBIGUOUS`. Units that are superseded or retired are never returned.
3. **Type per barcode.** `product_barcodes.barcode_type` (GS1, ISBN for 978/979 prefixes, UNDEFINED for non-GTIN codes and GS1 restricted-circulation numbers) is derived on insert. Each unit marks at most one barcode `is_primary`; that is the `barCode` sent on e-Barimt lines (delivery 3). `product_units` carries no `barcode_type`.
4. **Internal codes.** EAN-13 with prefix `20` (GS1 restricted circulation), a 10-digit number from a PostgreSQL sequence and a check digit; type UNDEFINED; at most one internal code per unit. Prefixes 21–29 are avoided because many POS systems read them as weight- or price-embedded codes. Gaps in the sequence do not matter, so `NumberingService` (gap-free, row-locking) is not used.
5. Barcode rows are deleted, not deactivated: documents reference units, never barcodes, and the audit log keeps the removed code.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Two unique indexes (`code`, `gtin14`) | UPC-A and EAN-13 forms of one GTIN would still be stored twice under different `code` values. |
| `barcode_type` on the unit (ADR-0008 #1 as written) | Wrong for units with a manufacturer and an internal code; "the first barcode" is undefined after a deletion. |
| Code 128 internal labels | Equally scannable, but EAN-13 prints compactly on small labels and passes every POS and scale configuration. |
| Accepting numeric codes with a wrong check digit | Typed typos would be stored and never match a scan. |

## Consequences

**Positive.** One index answers every scan form; e-Barimt gets the right type for the code it prints; products without barcodes become scannable once labels exist.

**Negative.** A local product whose printed EAN has an invalid check digit cannot be registered under that number; it gets an internal code instead. An 8-digit ambiguity needs a human decision.

## Related

ADR-0008, ADR-0017, ADR-0021, `docs/SPEC.md` §5.2, `docs/architecture.md` §5.2, `docs/modules/catalog.md`.
