#!/bin/sh
# The backup container's healthcheck: unhealthy when the last night failed, or when no night has succeeded for
# BACKUP_MAX_AGE_HOURS (26: a day and a margin), so a failed or missing backup shows in `docker compose ps`.
set -eu

: "${BACKUP_STATE_DIR:=/var/lib/postgresql/backup-state}"
: "${BACKUP_MAX_AGE_HOURS:=26}"

read_time() {
  if [ -f "$BACKUP_STATE_DIR/$1" ]; then cat "$BACKUP_STATE_DIR/$1"; else echo 0; fi
}

now=$(date -u +%s)
started=$(read_time started)
success=$(read_time last-success)
failure=$(read_time last-failure)

if [ "$failure" -gt "$success" ]; then
  echo "backup.health.failed reason=last-night-failed failed_at=$(date -u -d "@$failure" +%Y-%m-%dT%H%M%SZ)"
  exit 1
fi

# Before the first success, count from when the container started.
since=$success
if [ "$since" -eq 0 ]; then since=$started; fi
if [ "$since" -eq 0 ]; then
  echo "backup.health.failed reason=nightly-not-running"
  exit 1
fi
if [ $((now - since)) -gt $((BACKUP_MAX_AGE_HOURS * 3600)) ]; then
  echo "backup.health.failed reason=no-recent-success hours=$(((now - since) / 3600))"
  exit 1
fi
echo "backup.health.ok"
