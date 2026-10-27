#!/bin/sh
# Container entrypoint of the app image: migrate, seed, then hand PID 1 to the bot.
# Both steps are idempotent, so every restart (crash, reboot, deploy) runs them again safely.
# Any failure stops the container; `restart: unless-stopped` retries it. Nothing here prints env values.
set -eu

bun scripts/entrypoint-migrate.ts
bun scripts/seed.ts

exec "$@"
