# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t ghcr.io/ez4puljin/bto-web:local .
ARG NODE_IMAGE=node:26-trixie-slim
ARG CADDY_IMAGE=caddy:2.11-alpine

FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION=11.28.2
ENV CI=true pnpm_config_verify_deps_before_run=false
RUN npm install --global --no-audit --no-fund "pnpm@${PNPM_VERSION}"
WORKDIR /repo
# Dependencies first, from the manifests alone (2026-11-27): this layer is reused while no
# package.json or the lockfile changes, so an update of the code downloads nothing (the npm registry
# timed out for 10-20 minutes a build). Every workspace package.json is listed here
# (deploy/store/auto-deploy.test.sh checks it); node_modules never enters the context (.dockerignore).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/api-client/package.json packages/api-client/
COPY packages/fin-contract/package.json packages/fin-contract/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm/store --filter "@tugeel/web..."
COPY . .
RUN pnpm --filter "@tugeel/web..." run build

FROM ${CADDY_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/ez4puljin/Bto"
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
