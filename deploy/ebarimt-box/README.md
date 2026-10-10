# e-Barimt box (office Ubuntu mini-PC) — checklist

PosAPI 3.0 accepts calls only from Mongolian IP addresses and has no authentication, so it runs on a small Ubuntu machine in the Ulaanbaatar office, reachable only over Tailscale (ADR-0012, ADR-0017, docs/architecture.md §9.1). Week-0 owner task 3 in `docs/STATUS.md`.

## Setup

- [ ] Ubuntu LTS, amd64, wired network, automatic security updates, UPS if possible.
- [ ] Download the **staging** package `ST_PosService_3.0.12-Staging.zip` from share.itc.gov.mn first (production package in the go-live phase, ADR-0026).
- [ ] Install `PosAPI.deb`; keep `/opt/posapi` persistent. The launcher self-updates hourly (outside the skip hours).
- [ ] `posapi.ini`: `webServiceHost` = the box's `tailscale0` address (100.x.y.z), `webServicePort` = 7080, PostgreSQL (`QPSQL`) backend on the box.
- [ ] `tailscale up --advertise-tags=tag:posapi`; Tailscale ACL: only `tag:server` (droplet) and `tag:dev` (owner's PC, staging only) may reach `tag:posapi:7080`.
- [ ] Outbound allowed only to the e-Barimt and ITC endpoints listed in docs/architecture.md §9.1.
- [ ] From the owner's machine (`tag:dev`): `GET http://100.x.y.z:7080/rest/info` answers (from the droplet in the go-live phase).

## Week-1 spike (owner + Claude session)

- [ ] Issue one staging receipt through PosAPI from the owner's machine over Tailscale (ADR-0026: no droplet before go-live).
- [ ] Re-submit the same payload with the same `billIdSuffix`; record the exact response (idempotent, error or duplicate).
- [ ] Look up a receipt in the PosAPI local database by `billIdSuffix` / `posNo` / date.
- [ ] Force a timeout (block the outbound link briefly) and record PosAPI's behaviour.
- [ ] Print "Төв Үнэ ө ү" and an e-Barimt-style QR on every candidate printer (raster mode, docs/architecture.md §9.4).

Record the results in docs/architecture.md §5.9 and docs/SPEC.md §11 #15, then tick the items in docs/STATUS.md.
