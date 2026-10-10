# Tugeel deploy runbook

Operational steps for the DigitalOcean droplet (docs/architecture.md §10, ADR-0012, ADR-0023, ADR-0024). **Nothing here is used before the go-live phase** (ADR-0026: development is local-only and production is deployed once, after delivery 11); until then rehearse locally with `pnpm docker:build` and the staging stack behind the edge Caddy (`http://staging.localhost:8080`). Commands run on the droplet in `/opt/tugeel` unless stated. Never paste secrets into this file or any other file in the repository: it is public.

## 1. Topology

| Item | Value |
|---|---|
| Directory on the droplet | `/opt/tugeel`: `docker-compose.prod.yml`, `docker-compose.staging.yml`, `Caddyfile`, `.env` (production, chmod 600), `.env.staging` (chmod 600) |
| Compose projects | `tugeel-prod` (edge `caddy`, `web`, `api`, `worker`) and `tugeel-staging` (`postgres-staging`, `api-staging`, `worker-staging`, `web-staging`) |
| Networks | external `tugeel_edge_prod` and `tugeel_edge_staging`; the edge Caddy joins both, the two stacks cannot reach each other |
| Images | `ghcr.io/ez4puljin/bto-api:<tag>` (ROLE=api or worker) and `ghcr.io/ez4puljin/bto-web:<tag>` (Caddy file server, port 8080); tags are `sha-<git sha>` |
| Databases | production: DigitalOcean Managed PostgreSQL 18 (SGP1); staging: the `postgres-staging` container with a named volume |
| Pool budget | production api 6 + pg-boss 2, worker 3 + pg-boss 2, transient migrator 1; staging 2/2/2. **Cluster connection limit: record it here on creation day:** `____` |

## 2. Droplet bootstrap (once)

1. Ubuntu LTS droplet, 4 GiB / 2 vCPU, SGP1. Create a `deploy` user with SSH key login; disable password login.
2. Firewall (UFW and the DigitalOcean cloud firewall): allow 22, 80, 443 only.
3. Install Docker Engine and the compose plugin from Docker's apt repository; add `deploy` to the `docker` group.
4. Install `tailscaled`, join the tailnet with `tag:server` (docs/architecture.md §10.3).
5. `sudo mkdir -p /opt/tugeel && sudo chown deploy: /opt/tugeel`
6. `docker network create tugeel_edge_prod && docker network create tugeel_edge_staging`
7. If the GHCR packages stay private: `echo <token with read:packages> | docker login ghcr.io -u ez4puljin --password-stdin` (the token lives only on the droplet).

## 3. Hello deploy (first time)

1. Cloudflare DNS: A records `admin`, `api`, `staging` → droplet IPv4, **DNS only** (grey cloud) so Caddy can obtain Let's Encrypt certificates.
2. Copy `deploy/docker-compose.prod.yml`, `deploy/docker-compose.staging.yml` and `deploy/Caddyfile` to `/opt/tugeel`.
3. Create `/opt/tugeel/.env` and `/opt/tugeel/.env.staging` from `deploy/.env.example` (real hostnames, ACME email, image tags, passwords). `chmod 600 .env*`.
4. Staging:
   ```sh
   S="docker compose -f docker-compose.staging.yml --env-file .env.staging"
   $S up -d --wait postgres-staging
   $S run --rm --no-deps api-staging node dist/db/provision.js   # needs ADMIN_DATABASE_URL in .env.staging
   $S up -d --wait
   ```
5. Production database: create the cluster (PostgreSQL 18, SGP1), download its CA certificate to `/opt/tugeel/do-ca.crt`, mount it read-only into `api`/`worker` and use `sslmode=verify-full&sslrootcert=/run/secrets/do-ca.crt` in the URLs (node-postgres treats `sslmode=require` as verify-full). Provision once, typing the admin URL at the prompt so it is never stored:
   ```sh
   read -s ADMIN_DATABASE_URL && export ADMIN_DATABASE_URL
   docker compose -f docker-compose.prod.yml --env-file .env run --rm --no-deps -e ADMIN_DATABASE_URL api node dist/db/provision.js
   unset ADMIN_DATABASE_URL
   ```
6. Production stack: `docker compose -f docker-compose.prod.yml --env-file .env up -d --wait`
7. Checks: `curl -fsS https://staging.<domain>/health`, `curl -fsS https://api.<domain>/health`, open `https://admin.<domain>/system/status`.
8. UptimeRobot monitors: `https://api.<domain>/health` and `https://admin.<domain>/`.

## 4. Routine deploy

Done by `.github/workflows/deploy.yml` (written in the go-live phase, before the hello deploy): build and push both images tagged `sha-<sha>`, then on the droplet `API_TAG=… WEB_TAG=… docker compose … pull && docker compose … up -d --wait` for staging, a manual approval, then production. The api container applies migrations as `migrator` before it serves traffic (ADR-0024).

## 5. Rollback

Run `up -d` again with the previous `API_TAG`/`WEB_TAG`. Migrations are forward-only: roll back only to an image whose code works with the current schema. Data rollback = point-in-time recovery of the managed cluster (production) or restoring a dump (staging).

## 6. Caddyfile change

Copy the new file to `/opt/tugeel/Caddyfile`, then `docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`.

## 7. Restore drill (once in the go-live phase before production data is imported, then quarterly)

1. Take the latest weekly `pg_dump` from Spaces (job `backup.pgdump`, built in the go-live phase) or make one: `pg_dump -Fc`.
2. In `postgres-staging`: `createdb restore_drill`, `pg_restore -d restore_drill <dump>`.
3. Run the integrity SQL (row counts, `SELECT assert_unicode_casefold()`), record the duration here, then `dropdb restore_drill`.

## 8. Tailscale from containers (PosAPI, go-live phase)

Primary: `tailscaled` on the host; api/worker get `POSAPI_URL=http://100.x.y.z:7080`. Verify from inside the container (the slim image has no wget):
`docker compose -f docker-compose.prod.yml exec api node -e "fetch(process.env.POSAPI_URL + '/rest/info').then((r) => r.text()).then(console.log)"`
Fallback if the bridge network cannot route to the tailnet: a `tailscale` sidecar container with `network_mode: service:tailscale` for api and worker.

## 9. Secrets

All secrets live in `/opt/tugeel/.env*` (chmod 600) and GitHub Actions secrets. Rotation procedure: TODO (delivery 1, identity session adds `JWT_SECRET` and `REFRESH_PEPPER`).
