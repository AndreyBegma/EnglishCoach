#!/usr/bin/env bash
# Prune dumps in a directory: keep the newest dump of each of the last N days, ISO weeks and
# months (default 7 / 4 / 3); everything else matching coach-YYYYMMDD-HHMMSS.dump is deleted.
# Usage: backup-rotate.sh [dir]   (default: $BACKUP_DIR or /backups)
set -euo pipefail

dir="${1:-${BACKUP_DIR:-/backups}}"
keep_daily="${KEEP_DAILY:-7}"
keep_weekly="${KEEP_WEEKLY:-4}"
keep_monthly="${KEEP_MONTHLY:-3}"

declare -A seen_day seen_week seen_month
nd=0 nw=0 nm=0

# Newest first: the first dump seen for a bucket is the one kept for it.
while IFS= read -r f; do
  base="$(basename "$f")"
  ymd="${base:6:8}"
  day="$ymd"
  week="$(date -d "$ymd" +%G-W%V)"
  month="${ymd:0:6}"
  keep=0
  if [[ -z "${seen_day[$day]:-}" && $nd -lt $keep_daily ]]; then
    seen_day[$day]=1; nd=$((nd + 1)); keep=1
  fi
  if [[ -z "${seen_week[$week]:-}" && $nw -lt $keep_weekly ]]; then
    seen_week[$week]=1; nw=$((nw + 1)); keep=1
  fi
  if [[ -z "${seen_month[$month]:-}" && $nm -lt $keep_monthly ]]; then
    seen_month[$month]=1; nm=$((nm + 1)); keep=1
  fi
  if [[ $keep -eq 0 ]]; then
    rm -f -- "$f"
    echo "rotate: removed $base"
  fi
done < <(find "$dir" -maxdepth 1 -type f -name 'coach-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump' | sort -r)
