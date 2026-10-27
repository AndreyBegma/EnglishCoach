#!/usr/bin/env bash
# Scheduler for the `backup` compose service: a daily backup at BACKUP_HOUR (UTC, default 03),
# plus a restore check right after it on BACKUP_CHECK_DAY (ISO weekday 1-7, default 7 = Sunday).
# A failed run is logged loudly and does not stop the loop.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hour="${BACKUP_HOUR:-3}"
check_day="${BACKUP_CHECK_DAY:-7}"

seconds_until_next() {
  local now next
  now="$(date -u +%s)"
  next="$(date -u -d "today $(printf '%02d' "$hour"):00" +%s)"
  [[ $next -le $now ]] && next="$(date -u -d "tomorrow $(printf '%02d' "$hour"):00" +%s)"
  echo $((next - now))
}

run() {
  "$here/backup.sh" || echo "BACKUP LOOP: backup.sh failed $(date -u +%FT%TZ)" >&2
  if [[ "$(date -u +%u)" == "$check_day" ]]; then
    "$here/restore-check.sh" || echo "BACKUP LOOP: restore-check.sh failed $(date -u +%FT%TZ)" >&2
  fi
}

[[ "${BACKUP_ON_START:-1}" == "1" ]] && run

while true; do
  wait_s="$(seconds_until_next)"
  echo "backup: next run in ${wait_s}s"
  sleep "$wait_s"
  run
done
