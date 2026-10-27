#!/usr/bin/env bash
# Deploy or update the production stack on this host:
#   pull develop -> build -> docker compose up -d (production profile) -> wait for /health -> status.
# Idempotent: with nothing new it rebuilds from cache, recreates nothing, and passes the same checks.
# Exits non-zero, loudly, when the app does not become healthy in time. Never prints .env values.
#
# Environment (all optional):
#   DEPLOY_BRANCH        branch to deploy                            (default: develop)
#   DEPLOY_SKIP_PULL=1   deploy the working tree as it is, no git    (default: pull)
#   DEPLOY_TIMEOUT       seconds to wait for /health                 (default: 240)
#   COMPOSE_PROJECT_NAME compose project, e.g. for a trial run       (compose default)
#   HTTP_HOST_PORT       host port of the app                        (default: .env value or 18740)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

branch="${DEPLOY_BRANCH:-develop}"
timeout_s="${DEPLOY_TIMEOUT:-240}"
compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

die() {
  echo "DEPLOY FAILED: $*" >&2
  exit 1
}

[ -f .env ] || die ".env is missing (cp .env.example .env and fill it in)"
command -v docker >/dev/null || die "docker is not installed"
command -v curl >/dev/null || die "curl is not installed"

if [ "${DEPLOY_SKIP_PULL:-}" != "1" ]; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "the working tree has local changes"
  echo "deploy: pulling $branch"
  git fetch --quiet origin "$branch"
  [ "$(git branch --show-current)" = "$branch" ] || git checkout --quiet "$branch"
  git pull --quiet --ff-only origin "$branch"
fi
echo "deploy: revision $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# Only the port is read from .env: the file is never sourced and never printed.
port="${HTTP_HOST_PORT:-}"
if [ -z "$port" ]; then
  port="$(grep -E '^HTTP_HOST_PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d "\"' \t\r" || true)"
fi
port="${port:-18740}"
case "$port" in '' | *[!0-9]*) die "HTTP_HOST_PORT is not a number" ;; esac

echo "deploy: building and starting the production stack"
"${compose[@]}" up -d --build --remove-orphans || die "docker compose up failed"

echo "deploy: waiting up to ${timeout_s}s for http://127.0.0.1:${port}/health"
deadline=$((SECONDS + timeout_s))
until curl -fsS --max-time 5 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "--- last app log lines ---" >&2
    "${compose[@]}" logs --tail 30 app >&2 || true
    die "/health did not answer 200 within ${timeout_s}s"
  fi
  sleep 3
done

echo "deploy: healthy"
"${compose[@]}" ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
