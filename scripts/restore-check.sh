#!/usr/bin/env bash
# Restore the newest dump into a throwaway database and run a sanity query. The result is logged
# to stdout and appended to $BACKUP_DIR/restore-check.log. Exit 1 on any failure.
# Connection: PGHOST, PGPORT, PGUSER, PGPASSWORD (the role needs CREATEDB).
set -euo pipefail

dir="${BACKUP_DIR:-/backups}"
log="$dir/restore-check.log"
scratch="coach_restorecheck_$(date -u +%Y%m%d%H%M%S)_$$"
created=0

report() {
  local line="$(date -u +%FT%TZ) restore-check: $1"
  echo "$line"
  echo "$line" >>"$log" 2>/dev/null || true
}

cleanup() {
  if [[ $created -eq 1 ]]; then
    dropdb --if-exists "$scratch" >/dev/null 2>&1 || report "WARNING could not drop $scratch"
  fi
}
trap cleanup EXIT

fail() {
  report "FAILED: $1" >&2
  exit 1
}

latest="$(find "$dir" -maxdepth 1 -type f -name 'coach-*.dump' | sort | tail -n1)"
[[ -n "$latest" ]] || fail "no dump found in $dir"

createdb "$scratch" || fail "cannot create throwaway database"
created=1
pg_restore --no-owner --no-privileges --exit-on-error -d "$scratch" "$latest" \
  || fail "pg_restore of $(basename "$latest") failed"

tables="$(psql -qAt -d "$scratch" -c "select count(*) from information_schema.tables where table_schema in ('public','drizzle') and table_type = 'BASE TABLE'")" \
  || fail "sanity query failed"
[[ "$tables" -gt 0 ]] || fail "restored database has no tables"

report "OK $(basename "$latest"): $tables tables restored"
