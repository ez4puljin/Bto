# ADR-0189: The office's web is reached from outside too, and the outside name answers Mongolia only

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «оффисын вэб app.puljika.site дээр ажлуул … Зөвхөн монголоос хандах боломжтой байх»), Claude (the direct-mode session) |
| Amends | ADR-0188 #2 (the api only: the pages are served under the outside name too) and #6 (the web's cookie: `Secure` on HTTPS requests); ADR-0186 #3 |

## Context

ADR-0188 opened `https://app.puljika.site` for the staff app and kept every page of the office's web off it, on the owner's choice the same day. A few hours later the owner asked for the web there as well, so the office can be worked from home and on the road, and asked whether callers from abroad can be refused.

Cloudflare, which carries the name (ADR-0188 #1), places every caller in a country and tells the origin in the `CF-IPCountry` header (two letters; `XX` unknown, `T1` Tor). Everything under the outside name reaches the PC through Cloudflare's tunnel, so the header is Cloudflare's own there. Cloudflare also says whether the visitor used HTTPS (`X-Forwarded-Proto`).

## Decision

1. **The whole centre answers under the outside name**: the pages, `/api` and `/health`, as at the LAN address. ADR-0188's 404 for pages is removed.
2. **Mongolia only, enforced on the PC.** Under the outside name the centre's Caddy answers only when `CF-IPCountry` is one of `STORE_PUBLIC_COUNTRIES` (`deploy/store/.env`, default `MN`; several as `MN|KR`); anyone else gets 403, and so does a request without the header, which did not come through Cloudflare. The rule covers the api too: the staff app works on Mongolian mobile data and Wi-Fi, not abroad.
3. **The same rule at Cloudflare's edge is the owner's option**, not a replacement: a WAF custom rule `(http.host eq "app.puljika.site" and ip.src.country ne "MN")` → Block stops foreign requests before they reach the PC. The PC's rule stays, so a changed or deleted dashboard rule opens nothing.
4. **HTTPS only under the name.** A request that reached Cloudflare over plain HTTP (`X-Forwarded-Proto: http`) is redirected to `https://`.
5. **The web's sign-in cookie is `Secure` whenever the request came over HTTPS** (`request.secure`, from `X-Forwarded-Proto` of the trusted hops: Cloudflare's tunnel through the PC's own Caddy), whatever `COOKIE_SECURE` says. On the LAN's plain HTTP the cookie is as before, so both ways in work side by side. A session started at one address is not a session at the other: cookies belong to their host.
6. **What does not change.** The tills' server (port 7400) is published nowhere outside. The country rule is not a sign-in: the password, the account lock and the per-address limits of ADR-0027 remain the guard. The LAN address stays the way in when the internet or Cloudflare is down.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The country rule only in Cloudflare's dashboard | One click there would open the office's sign-in to the world, and nothing in the repository would say what is meant to be in force. The PC's rule is versioned and tested; the dashboard's is an extra. |
| An address list of Mongolian providers on the PC | Hundreds of ranges that change; Cloudflare already keeps them current. |
| Cloudflare Access (a sign-in page in front) | It stops the staff app, which cannot pass an interactive page; a second sign-in for every user. Worth a look for the web alone if the owner ever wants one. |
| `COOKIE_SECURE=true` for everyone | The LAN's plain HTTP web could no longer keep a session. |
| Keep the web LAN-only (ADR-0188 #2) | The owner now wants it outside. |

## Consequences

**Positive.** The office works from anywhere in Mongolia over HTTPS; the browser's camera scanner, which needs HTTPS, works under the outside name; almost all of the internet's automated probing, which comes from abroad, is refused before a password is tried.

**Negative.** A country is a guess from an address: a VPN with a Mongolian exit passes, and a staff member abroad, on a foreign VPN, or on a network Cloudflare places wrongly is refused, the staff app included. Roaming phones usually keep their home operator's address but not always. The office's sign-in page is now on the internet for every Mongolian address: simple passwords are the remaining weakness, the admins' first. If Cloudflare stopped sending the header (its «IP geolocation» setting off), everyone outside would be refused until it is on again. Monitoring from abroad sees 403.

**Follow-ups.**
- The owner: the admin passwords; optionally the WAF rule of #3; say when someone must work from abroad (a country is added to `STORE_PUBLIC_COUNTRIES`).
- Checked after the deploy: the name from Mongolia (pages 200), from abroad (403), plain HTTP (redirect).

## Related

ADR-0027, ADR-0186, ADR-0188, `deploy/store/Caddyfile.store`, `deploy/store/.env.example`, `apps/api/src/modules/identity/controllers/auth.controller.ts`, `docs/architecture.md` §10.8, `docs/runbooks/store-install.md` §10.
