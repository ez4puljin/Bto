#!/usr/bin/env bash
# Mirrors the "check" job of .github/workflows/ci.yml. Keep the two in sync.
set -euo pipefail
version="$(node -p "require('./package.json').devEngines.packageManager.version")"
npm install --global --no-audit --no-fund "pnpm@${version}" > /dev/null
echo "commit $(git rev-parse --short HEAD) | node $(node --version) | pnpm $(pnpm --version)"
pnpm install --frozen-lockfile --store-dir /pnpm/store
pnpm check
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: pnpm check modified tracked files:"
  git status --porcelain
  exit 1
fi
echo "REHEARSAL GREEN"
