#!/usr/bin/env bash
# One backup: pg_dump -Fc into $BACKUP_DIR, verified with pg_restore --list, then rotated.
# Connection comes from the standard libpq env (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
# or from DATABASE_URL. The password is never printed.
set -euo pipefail

dir="${BACKUP_DIR:-/backups}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$dir"

stamp="$(date -u +%Y%m%d-%H%M%S)"
final="$dir/coach-$stamp.dump"
tmp="$dir/.coach-$stamp.dump.partial"

fail() {
  echo "BACKUP FAILED $(date -u +%FT%TZ): $1" >&2
  rm -f -- "$tmp"
  exit 1
}

conn=()
if [[ -n "${DATABASE_URL:-}" && -z "${PGHOST:-}" ]]; then
  conn=(--dbname "$DATABASE_URL")
fi

echo "backup: start $(date -u +%FT%TZ)"
pg_dump -Fc "${conn[@]}" -f "$tmp" || fail "pg_dump exited with status $?"
[[ -s "$tmp" ]] || fail "pg_dump produced no output"
pg_restore --list "$tmp" >/dev/null 2>&1 || fail "dump is not a readable archive"
mv -- "$tmp" "$final"
echo "backup: ok $(basename "$final") ($(stat -c %s "$final") bytes)"

"$here/backup-rotate.sh" "$dir"
