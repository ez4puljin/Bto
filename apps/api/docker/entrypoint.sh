#!/bin/sh
# Container entrypoint (ADR-0024): ROLE=api applies migrations as migrator, then serves HTTP as app;
# ROLE=worker runs the pg-boss worker; ROLE=edge runs the store edge (ADR-0067). Any explicit
# command runs as a one-off, e.g.
#   docker compose run --rm api-staging node dist/db/provision.js
set -eu
if [ "$#" -gt 0 ]; then exec "$@"; fi
case "${ROLE:-}" in
  api)
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      : "${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL is required when ROLE=api}"
      echo "tugeel-entrypoint: migrations and pg-boss schema as migrator"
      node dist/db/migrate.js
    fi
    exec env -u MIGRATOR_DATABASE_URL -u ADMIN_DATABASE_URL node dist/main.js
    ;;
  worker)
    # The worker never asks the AI assistant (ADR-0045): its key and read-only role stay with the api.
    exec env -u MIGRATOR_DATABASE_URL -u ADMIN_DATABASE_URL -u LLM_API_KEY -u AI_DATABASE_URL \
      node dist/worker.js
    ;;
  edge)
    # The store edge (ADR-0067): its own small database, migrated by the one role that owns it.
    : "${EDGE_DATABASE_URL:?EDGE_DATABASE_URL is required when ROLE=edge}"
    echo "tugeel-entrypoint: edge migrations"
    node dist/edge/db/migrate.js
    exec node dist/edge.js
    ;;
  *)
    echo "tugeel-entrypoint: ROLE must be api, worker or edge (got '${ROLE:-}')" >&2
    exit 64
    ;;
esac
