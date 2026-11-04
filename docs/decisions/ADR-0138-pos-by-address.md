# ADR-0138: a POS opened by its address, without a pairing code

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («холбох код ашиглахгүйгээр тусдаа порт дээр ажилдаг байвал яах вэ?» → «Тийм, замаар хийгээрэй. http://192.168.1.152:7400/K1 дээр болон кассууд зэрэг ажилдаг», 2026-11-04), Claude (the direct-mode session) |
| Amends | ADR-0067 (a browser bound to a till only with the admin's one-time code) |

## Context

A new till PC had to be bound with a six-digit code taken from «Супермаркет → Пос». The owner asked for each POS to have its own address instead, so the cashier's PC opens its POS directly; a port per POS was weighed and a path chosen, which needs no new port in Docker or the firewall when a POS is added.

## Decision

1. **The address names the POS.** `http://<edge>:7400/K1` (any path segment that is a till code; Latin look-alikes are read as Cyrillic, `K1` → `К1`), or `pos.html?till=K1` on the dev server. The edge's Caddy already serves the kiosk on every path.
2. **Bound without a code.** The kiosk calls `POST /edge/v1/open {tillCode}` (public on the edge): an active till of the snapshot (pulled once more when unknown) gets a new device token, recorded and sent to the centre as `TILL_BOUND` like a code pairing. An unknown or inactive till answers `POS_TILL_INACTIVE`.
3. **Per-POS storage.** A page opened for a POS keeps its device and session tokens under keys of that POS (`bto.kiosk.device.v1@К1`), so one browser may hold `/K1` and `/K2` apart; the root address keeps the code pairing as before.
4. **The start page lists the POS** (owner: «…:7400 гэж ороход идэвхтэй байгаа Посууд сонголтоор байна. Пос1 - Үндсэн заал дарахад :7400/K1 руу ордог»): `…:7400` with no path shows the edge's active POS (`GET /edge/v1/tills`, public on the edge); a click opens `…:7400/K1`. «Холбох кодоор холбох» below it, or no POS to offer, leads to the code pairing.
5. **The admin shows each POS's path** («Хаяг» `/K1`) and the full address in its edit dialog, for the cashier's Chrome shortcut.

## Consequences

- Any browser on the store's LAN that opens `/K1` becomes that POS; the cashier's PIN and the POS's own cashier list (ADR-0124) still decide who sells. A revoked device binds again on its next visit.
- Two PCs on one POS share its shift; each PC's shortcut points at its own POS.
- The code pairing stays for the root address.
