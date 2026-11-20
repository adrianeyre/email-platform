#!/bin/sh
set -eu

: "${BACKUP_HOUR_UTC:=2}"

run_backup() {
  if ! backup.sh; then
    echo "backup.nightly.failed: see the lines above for the step that failed" >&2
  fi
}

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) $BACKUP_HOUR_UTC:00:00" +%s)
  if [ "$next" -le "$now" ]; then
    next=$((next + 86400))
  fi
  sleep $((next - now))
  run_backup
done
