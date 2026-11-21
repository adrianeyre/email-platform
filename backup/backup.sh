#!/bin/sh
set -eu -o pipefail

# backup-health.sh, the container's healthcheck, reads when a run last succeeded or failed. A run by hand counts too,
# so a fixed backup turns healthy without waiting for the night.
: "${BACKUP_STATE_DIR:=/var/lib/postgresql/backup-state}"
work=""
finish() {
  status=$?
  if [ -n "$work" ]; then rm -rf "$work"; fi
  outcome=last-failure
  if [ "$status" -eq 0 ]; then outcome=last-success; fi
  { mkdir -p "$BACKUP_STATE_DIR" && date -u +%s >"$BACKUP_STATE_DIR/$outcome"; } 2>/dev/null || true
}
trap finish EXIT

: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT to the age public key backups are encrypted to}"
: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE to the off-server target backups are sent to, such as b2:email-backups}"
: "${BACKUP_KEEP_DAYS:=14}"
# Unset by default: the server's credential should only be able to add backups, and the remote's own lifecycle rule
# deletes old ones (docs/operations/backups-and-restore.md). Set it only to a remote whose credential may delete.
: "${BACKUP_PRUNE_RCLONE_REMOTE:=}"

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
dump_name="email-platform-$stamp.dump.age"
work=$(mktemp -d)

# Every step names itself when it fails, so the log says which one (a full disk shows as the dump step).
if ! pg_dump --format=custom | age --recipient "$BACKUP_AGE_RECIPIENT" >"$work/$dump_name"; then
  echo "backup.dump.failed database=${PGDATABASE:-} work=$work: pg_dump or age failed, see its error above" >&2
  exit 1
fi

if ! sum=$(sha256sum "$work/$dump_name" | cut -d ' ' -f 1) || ! size=$(wc -c <"$work/$dump_name" | tr -d ' '); then
  echo "backup.checksum.failed name=$dump_name" >&2
  exit 1
fi

# --inplace: an append-only remote (an SFTP server that refuses rename) can't take rclone's upload-then-rename.
if ! rclone copyto --inplace "$work/$dump_name" "$BACKUP_RCLONE_REMOTE/$dump_name"; then
  echo "backup.upload.failed remote=$BACKUP_RCLONE_REMOTE name=$dump_name" >&2
  exit 1
fi
echo "backup.upload.finished remote=$BACKUP_RCLONE_REMOTE name=$dump_name"

if [ -n "$BACKUP_PRUNE_RCLONE_REMOTE" ]; then
  cutoff=$(date -u -d "@$(($(date -u +%s) - BACKUP_KEEP_DAYS * 86400))" +%Y-%m-%dT%H%M%SZ)
  if ! listing=$(rclone lsf --files-only --include 'email-platform-*.age' "$BACKUP_PRUNE_RCLONE_REMOTE"); then
    echo "backup.prune.failed remote=$BACKUP_PRUNE_RCLONE_REMOTE" >&2
    exit 1
  fi
  for old in $listing; do
    old_stamp=$(echo "$old" | sed -E 's/^email-platform-([0-9T-]+Z)\..*$/\1/')
    earlier=$(printf '%s\n%s\n' "$old_stamp" "$cutoff" | sort | head -n 1)
    if [ "$earlier" = "$old_stamp" ] && [ "$old_stamp" != "$cutoff" ]; then
      if ! rclone deletefile "$BACKUP_PRUNE_RCLONE_REMOTE/$old"; then
        echo "backup.prune.failed remote=$BACKUP_PRUNE_RCLONE_REMOTE name=$old" >&2
        exit 1
      fi
      echo "backup.old-backup.deleted remote=$BACKUP_PRUNE_RCLONE_REMOTE name=$old"
    fi
  done
fi

# The record a restore checks against: keep these lines somewhere the server can't rewrite.
echo "backup.finished stamp=$stamp size=$size sha256=$sum"
