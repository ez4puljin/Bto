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
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@tugeel/web..."
RUN pnpm --filter "@tugeel/web..." run build

FROM ${CADDY_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/ez4puljin/Bto"
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
