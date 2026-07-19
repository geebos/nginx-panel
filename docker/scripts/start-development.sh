#!/bin/sh
set -eu

# The named volume hides image-layer node_modules after the first run. Reconcile
# it on every container start so `docker compose up -d --build` also applies a
# changed lockfile without touching the host's node_modules.
CI=true pnpm install --frozen-lockfile

exec node docker/scripts/start-development.mjs
