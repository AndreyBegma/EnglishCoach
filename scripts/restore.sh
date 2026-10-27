#!/usr/bin/env bash
# Manual restore of a dump into a database (default: a NEW database, never an overwrite).
# Usage: restore.sh <dump-file> [target-db]   (target-db default: coach_restored)
# Connection: PGHOST, PGPORT, PGUSER, PGPASSWORD.
set -euo pipefail

dump="${1:?usage: restore.sh <dump-file> [target-db]}"
target="${2:-coach_restored}"

[[ -f "$dump" ]] || { echo "restore: no such file: $dump" >&2; exit 1; }
createdb "$target"
pg_restore --no-owner --no-privileges --exit-on-error -d "$target" "$dump"
echo "restore: $dump -> database $target"
