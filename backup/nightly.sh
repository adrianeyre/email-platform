#!/bin/sh
set -eu

: "${BACKUP_HOUR_UTC:=2}"
: "${BACKUP_STATE_DIR:=/var/lib/postgresql/backup-state}"

# backup-health.sh counts from when this container started until the first success (backup.sh records each run).
mkdir -p "$BACKUP_STATE_DIR"
if [ ! -f "$BACKUP_STATE_DIR/started" ]; then
  date -u +%s >"$BACKUP_STATE_DIR/started"
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) $BACKUP_HOUR_UTC:00:00" +%s)
  if [ "$next" -le "$now" ]; then
    next=$((next + 86400))
  fi
  sleep $((next - now))
  if ! backup.sh; then
    # Stop rather than carry on: the container is seen to fail (it restarts, and stays unhealthy until a night
    # succeeds), instead of a line in a log no one reads.
    echo "backup.nightly.failed: see the lines above for the step that failed" >&2
    exit 1
  fi
done
