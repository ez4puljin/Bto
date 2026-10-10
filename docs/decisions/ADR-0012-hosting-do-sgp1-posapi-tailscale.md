# ADR-0012: Hosting: DigitalOcean SGP1 droplet + Managed PostgreSQL; PosAPI on an office mini-PC over Tailscale

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0026 (nothing is created before the go-live phase after delivery 11; the Week-0 and week-1 follow-ups below move there) |

## Context

Budget-conscious solo operator; Singapore is the nearest budget region (about 100-150 ms from Ulaanbaatar, to be measured in Week 0). Facts (`docs/architecture.md` §9, §13): e-Barimt PosAPI 3.0 and the `api.ebarimt.mn` lookup services are reachable only from Mongolian networks; PosAPI has no authentication of its own and must never be exposed on a public network; it is shipped as a Linux amd64 `.deb` launcher (PosService 3.0.12) that self-updates hourly. DigitalOcean: Basic droplet 4 GiB/2 vCPU $24, Managed PostgreSQL 1 GiB $15.15 (2 GiB $30.45), Spaces $5; Standard Edition clusters above 4 GiB or with standby nodes are no longer offered from Oct/Nov 2026. Hetzner raised prices twice in 2026 and its cost-optimised plans are unorderable. External uptime monitors cannot probe a tailnet-private endpoint. Docker Compose containers do not join a tailnet by themselves.

## Decision

1. **DigitalOcean SGP1.** One Basic droplet (4 GiB / 2 vCPU) runs Docker Compose: `caddy` (auto-TLS, serves the admin SPA, proxies `/api`), `api`, `worker`, and the staging stack. **Managed PostgreSQL 18** (1 GiB, upgrade to 2 GiB when needed) with daily backups and PITR for **production only**. **Staging uses a local `postgres:18` container on the droplet** (no managed backups needed), which keeps the managed cluster's connection limit for production. Pool budget: api 6, worker 3, pg-boss 2 per process (ADR-0003). Spaces for files (ADR-0014), Cloudflare DNS, GitHub Actions deploy over SSH with a manual production gate, Sentry free tier.
2. **PosAPI 3.0 runs on a small Ubuntu amd64 mini-PC in the Ulaanbaatar office** (owner decision). It runs the official PosService 3.0.12 `.deb` directly on Ubuntu (no Docker), with `/opt/posapi` persisted on the system disk and the hourly self-update accepted (assumption A2 in `docs/architecture.md` §13.1). It is joined to the tailnet; **PosAPI listens on the `tailscale0` address** (or is fronted by a localhost proxy), never on a public interface, and **Tailscale ACLs** allow only the droplet's `api`/`worker` nodes and the owner's laptop to reach port 7080. All `api.ebarimt.mn` lookups (TIN, branch, classification, tax-product codes) are routed through the same box. A **second PosAPI instance at the supermarket** is added in delivery 9 with its own `ebarimt_config` row (ADR-0017).
3. **Container-to-tailnet pattern.** `tailscaled` runs on the droplet host. `api` and `worker` receive the box's tailnet IP via `POSAPI_URL` in `/opt/tugeel/.env` (`docs/architecture.md` §10.2 is the env source of truth); the Docker bridge network reaches the tailnet through the host's routing table (documented and tested in `deploy/runbook.md`). If that ever fails, the fallback is a `tailscale` sidecar container with `network_mode: service:tailscale`. The deploy runbook contains the step-by-step mini-PC setup (`deploy/ebarimt-box/`).
4. **Monitoring.** The worker refreshes a PosAPI health record from `GET /rest/info` every few minutes (reachability, `lastSentDate`, `leftLotteries`) and the API exposes it at **`/health/ebarimt`** (part of `/health`). UptimeRobot probes only the public `/health`; DO alerts cover CPU, disk and DB connections.
5. **Tailscale is budgeted as a paid Starter plan** (commercial use). This is an assumption to confirm at sign-up; it does not change the design.
6. **Costs**: launch ≈ $45-60/month plus a one-off mini-PC; full rollout ≈ $90-130/month plus EAS Starter and Tailscale. Scaling path without code change: resize droplet, second worker container, Managed PG to 2-4 GiB.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| DO App Platform | No clean path from containers to a tailnet-only PosAPI box; no static egress; no SSH for debugging. |
| Hetzner | No managed PostgreSQL; two price rises and unorderable plans in 2026. |
| Fly.io / Railway | Usage billing; Fly Managed Postgres $38 minimum. |
| AWS/GCP Seoul or Tokyo | Closer, but 2-3x cost and IAM/VPC complexity for one person. |
| Host everything in Mongolia | Immature managed tooling; the office box already covers the geo-restricted part. |
| PosAPI sidecar on the droplet | Impossible: Mongolia-IP-only. |
| Mongolian VPS for PosAPI | Owner prefers the office box; a VPS remains a fallback if office connectivity proves unreliable. |
| External probe of PosAPI | Cannot reach a tailnet address; replaced by `/health/ebarimt`. |
| Staging on the managed cluster | Doubles connection usage on the entry plan for no benefit. |

## Consequences

**Positive.** Flat pricing, managed backups and PITR for production, one Ubuntu host plus one mini-PC to patch; the geo-restricted dependency is isolated behind one URL.

**Negative.** Single droplet is a single point of failure (accepted; resize or second droplet later). Supermarket checkout depends on office connectivity until delivery 9's second instance. The owner must learn Docker, Tailscale and basic Ubuntu administration (2-3 days budgeted in Week 0).

**Follow-ups.** Week 0: accounts, domain, droplet, cluster, Tailscale, mini-PC ordered and set up, RTT measured. Week 1: hello deploy with HTTPS on staging and admin hostnames; `/health/ebarimt` once the staging PosAPI answers.

## Related

ADR-0003, ADR-0013, ADR-0014, ADR-0017, ADR-0022, `docs/architecture.md` §2, §9, §10, §11, §13.
