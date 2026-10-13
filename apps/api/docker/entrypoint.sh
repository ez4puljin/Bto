#!/bin/sh
# Container entrypoint (ADR-0024): ROLE=api applies migrations as migrator, then serves HTTP as app;
# ROLE=worker runs the pg-boss worker. Any explicit command runs as a one-off, e.g.
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
  *)
    echo "tugeel-entrypoint: ROLE must be api or worker (got '${ROLE:-}')" >&2
    exit 64
    ;;
esac
