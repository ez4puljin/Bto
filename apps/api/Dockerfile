# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t ghcr.io/ez4puljin/bto-api:local .
# One image, two processes: ROLE=api (HTTP, runs migrations first) or ROLE=worker (pg-boss jobs).
ARG NODE_IMAGE=node:26-trixie-slim

FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION=11.28.2
# Filtered installs leave other workspace projects without node_modules: do not verify them on run.
ENV CI=true pnpm_config_verify_deps_before_run=false
RUN npm install --global --no-audit --no-fund "pnpm@${PNPM_VERSION}"
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@tugeel/api..."
# Topological: packages/shared first, then nest build (copies the SQL migrations into dist).
RUN pnpm --filter "@tugeel/api..." run build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @tugeel/api deploy --prod --store-dir /pnpm/store /out/api

FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=dev
LABEL org.opencontainers.image.source="https://github.com/ez4puljin/Bto" \
      org.opencontainers.image.revision="${GIT_SHA}"
ENV NODE_ENV=production NODE_OPTIONS=--enable-source-maps APP_VERSION=${GIT_SHA}
WORKDIR /app
# Owned by root: the node user cannot modify its own code.
COPY --from=build /out/api ./
COPY --chmod=0755 apps/api/docker/entrypoint.sh /usr/local/bin/tugeel-entrypoint
COPY apps/api/docker/healthcheck.mjs /usr/local/lib/tugeel/healthcheck.mjs
# Guards against CRLF if the file was ever checked out with Windows line endings.
RUN sed -i 's/\r$//' /usr/local/bin/tugeel-entrypoint
# File storage (STORAGE_LOCAL_DIR): the named volume shared by api and worker is mounted here and
# takes this owner when Docker creates it.
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "/usr/local/lib/tugeel/healthcheck.mjs"]
ENTRYPOINT ["tugeel-entrypoint"]
