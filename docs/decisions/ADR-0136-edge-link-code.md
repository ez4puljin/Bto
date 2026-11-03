# ADR-0136: a new store edge linked to the centre with a one-time code

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-03 |
| Deciders | Owner («Үндсэн систем - Касс edge системийг хооронд нь хялбар аргаар холбодог болго», 2026-11-03), Claude (the direct-mode session) |
| Amends | ADR-0063 #6 (the node token, the PIN key), ADR-0067 (the edge's environment) |

## Context

Installing an edge meant copying three values into `deploy/edge/.env` by hand: the centre's address, the node token shown once in «Супермаркет → Касс → Шинэ токен», and the centre's `POS_PIN_PEPPER` read from the centre's own environment file. The last two are secrets; the PIN key in particular lived only on the centre's PC. The tills already pair with a six-digit one-time code (ADR-0067); the owner wants the edge itself linked as simply, on Windows and on Ubuntu.

## Decision

1. **A link code per edge server.** «Супермаркет → Касс» → an edge server → «Холбох код» (`POST /pos/edge-nodes/:id/link-code`, `pos.manage`) issues eight characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no look-alikes), shown once as `ABCD-EF23`, valid 15 minutes. The centre keeps its sha-256 (salted with the node id) in `pos_edge_nodes.link_code_hash` with `link_expires_at` (migration `0065_pos_edge_link`); a new code replaces the one in force.
2. **One public route buys the link.** `POST /pos/edge-link {nodeCode, linkCode}` (`@Public()`) checks the code in a transaction holding the node's row: a wrong code counts in `link_attempts` and the fifth voids the code; an unknown, inactive or expired node and a wrong code get the same `EDGE_LINK_INVALID`. The right code issues a fresh node token (the old one stops at once, as «Шинэ токен» does), forgets the code and answers the token and the PIN key. Every outcome is audited (`LINKED`, `LINK_FAILED`, `LINK_CODE_VOIDED`).
3. **The edge keeps the link in its own database.** The edge's `CENTRAL_API_URL`, `EDGE_NODE_TOKEN` and `POS_PIN_PEPPER` become optional. With all three in the environment the edge is linked by it, as before. Without them it starts unlinked; the kiosk's first screen «Төв системтэй холбох» takes the centre's address, the edge server's code and the link code, the edge calls the centre (no transaction open) and stores the answer in `edge_link` (edge migration `0007_link`, one row). It pulls its snapshot at once; the tills then pair as before. A code-linked edge whose token the centre refuses (401: a new token was issued) may be linked again from the kiosk, to the same edge server only; an environment-linked edge never.
4. **The PIN key handed out is POS_PIN_PEPPER.** Outside production the centre falls back to `AUTH_PEPPER`, as its PIN hashes do. In production without `POS_PIN_PEPPER` the link is refused (`EDGE_LINK_PEPPER_MISSING`): the staff's password key is never sent to an edge.
5. **Setup scripts.** `deploy/edge/setup.sh` (Ubuntu: installs Docker when missing) and `deploy/edge/setup.ps1` with `setup-windows.bat` (Windows, Docker Desktop) write `deploy/edge/.env` with fresh local secrets (`EDGE_DB_PASSWORD`, `EDGE_JWT_SECRET`) and the fake e-Barimt provider, build and start the stack, open the kiosk port and print the kiosk's address. The steps are in `docs/runbooks/edge-install.md`.

## Consequences

- Nobody copies a token or the PIN key; the admin reads out a code of eight characters, and the edge's own database holds what the `.env` file used to.
- Over plain HTTP on the store's LAN the token and the PIN key travel once in the clear, as the snapshot's PIN hashes already do on every pull; production's centre is reached over HTTPS (Caddy). An unlinked edge accepts a link from anyone on its LAN, so a new edge is linked right after it is started.
- A linked edge does not move to another centre: going live means a fresh edge database (backlog 0 first) linked with the real centre's code.
- `deploy/edge/docker-compose.edge.yml` no longer requires the three variables; `deploy/edge/.env.example`, `docs/modules/pos.md` and architecture §10.2 say so.
