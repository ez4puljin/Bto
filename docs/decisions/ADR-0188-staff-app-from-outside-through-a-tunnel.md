# ADR-0188: The staff app reaches the centre from outside through the owner's Cloudflare tunnel, the api only

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «Ажилчид өөрсдийн mobile data ашиглан системтэй холбогддог болгох», «ажилчдын апп холбогддог болгох»; the name `app.puljika.site` and «Зөвхөн апп» chosen the same day), Claude (the direct-mode session) |
| Amends | ADR-0186 #3 (LAN-only plain HTTP: the api is now also reachable from outside under one name; the admin's pages and the tills stay LAN-only), ADR-0187 #7 |

## Context

Since ADR-0186 the centre answers only inside the store's network: no forwarded port, no domain, no certificate. The staff app (reps on their round, drivers, keepers away from the building, attendance) therefore worked only on the store's Wi-Fi. The owner wants the staff to connect with their own mobile data.

The PC that carries the centre (ADR-0187) already runs the owner's Cloudflare tunnel as a user service (`cloudflared … run --token-file ~/.cloudflared/token`, managed from the owner's Cloudflare dashboard): it publishes the company's old ERP as `bto.puljika.site`. A tunnel is an outgoing connection from the PC to Cloudflare, so the router forwards nothing and the PC's address stays private; Cloudflare holds the certificate and answers HTTPS.

The staff app signs in with a phone number and a password and then carries tokens, not cookies (ADR-0061 #4); it takes any `https://` address as its server (`normalizeServerUrl`) and checks `GET /health` before it connects.

## Decision

1. **One outside name on the existing tunnel.** `app.puljika.site` is added as a public hostname of the owner's tunnel, pointing at `http://localhost:80` (the centre's port on the same PC). The owner adds it in the Cloudflare dashboard; nothing is installed, no token is handled by Claude, and the old ERP's hostname is not changed. HTTPS ends at Cloudflare; from `cloudflared` to the centre the request is plain HTTP inside the PC.
2. **The api only.** Under the outside name the centre's Caddy answers `/api/*` and `/health` and nothing else: every page of the admin's web is a 404 there (`deploy/store/Caddyfile.store`, the matcher `@outsidePage`). The web is still opened only at the LAN address. The tills' server (port 7400) is not published anywhere outside, now or later by this decision.
3. **`STORE_PUBLIC_HOST`** (`deploy/store/.env`, named in `.env.example`, added empty by `setup.sh`) holds the name; empty means no request is treated as coming from outside. The name is not a secret.
4. **The caller's address.** Requests of the tunnel reach Caddy from the PC itself through Docker's bridge. Caddy trusts only that hop (`trusted_proxies static 172.16.0.0/12`, strict) to pass on `X-Forwarded-For`, so the api's sign-in limits and session rows see the phone's real address (the api already trusts the private hops in front of it, `trust proxy`). The store's LAN (192.168.0.0/16) is outside that range: a LAN client cannot forge an address. Rehearsed 2026-11-13 with the real web image: a forged private address in front of the real one does not win.
5. **The staff app** uses `https://app.puljika.site`: typed once on the phone («Серверийн хаяг»), or built in (`BTO_SERVER=https://app.puljika.site pnpm mobile:apk`). The same address works on the store's Wi-Fi (through the internet); the LAN address `http://192.168.1.250` stays the way in when the internet is down.
6. **What stays as it is.** The web's refresh cookie stays without `Secure` (`COOKIE_SECURE=false`), because the web is used over the LAN's plain HTTP only. Bto300's routes are part of `/api` and so are reachable under the name, but the customer app stays on the test server until the owner decides otherwise (ADR-0186 #3). The external server of ADR-0026 #3 is still the go-live target; the name moves there with the database.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Tailscale on every phone | Every staff member would need another app, an account and an invitation, and would have to switch it on; the owner asked for the tunnel the PC already has. |
| A forwarded router port with an own certificate | Publishes the PC's address to the internet, needs a fixed address or dynamic DNS, and a certificate to renew on the box. |
| A second tunnel only for Bto | A second token and process on the PC for the same result; it becomes worth it if the old ERP's tunnel is ever removed. |
| The whole centre under the outside name | The owner chose the app only: the admin's sign-in page and every screen stay off the internet. |
| Wait for the external server | No hosting exists yet and the staff need the app outside now. |
| Trust every private address as a proxy | A LAN client could then forge `X-Forwarded-For` and slip the per-address sign-in limit. |

## Consequences

**Positive.** The staff app works anywhere with mobile data, over HTTPS, without a change on any phone but the server's address; nothing is opened on the router; the outside way in is the api alone; switching it off is one line in the Cloudflare dashboard or an empty `STORE_PUBLIC_HOST`.

**Negative.** Anyone on the internet can now try a staff phone number and password against the api: the account lock and the per-address limits (ADR-0027) are the guard, so simple passwords must be changed before the name is added, the admins' first. Cloudflare terminates the HTTPS and therefore sees the traffic in the clear, and a failure of Cloudflare or of the tunnel process (shared with the old ERP) stops the outside access, not the LAN. Mobile operators put many phones behind one address, so a stranger's failed sign-ins from the same operator address can briefly slow a staff member's sign-in. Reaching the api under the name with a staff password is possible from any program, not only the app: «the api only» hides the pages, it does not limit who may call.

**Follow-ups.**
- The owner: change the simple admin passwords; add the public hostname in the Cloudflare dashboard (`docs/runbooks/store-install.md` §10); tell the staff the address or hand out the new build.
- Claude, after the name answers: `STORE_PUBLIC_HOST` on the real system, a check from outside (the api answers, a page does not), a staff APK built with the address.
- Optional later: a Cloudflare rate-limiting rule on `/api/v1/auth/*`; the customer app under the same name when the owner opens it.

## Related

ADR-0026, ADR-0027, ADR-0061, ADR-0186, ADR-0187, `deploy/store/Caddyfile.store`, `deploy/store/.env.example`, `docs/architecture.md` §10.7, §10.8, `docs/runbooks/store-install.md` §10, `docs/modules/mobile.md` §9.
