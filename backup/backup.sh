#!/bin/sh
set -eu -o pipefail

: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT to the age public key backups are encrypted to}"
: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE to the off-server target backups are sent to, such as b2:email-backups}"
: "${BACKUP_KEEP_DAYS:=14}"

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
dump_name="email-platform-$stamp.dump.age"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pg_dump --format=custom | age --recipient "$BACKUP_AGE_RECIPIENT" >"$work/$dump_name"

if ! rclone copyto "$work/$dump_name" "$BACKUP_RCLONE_REMOTE/$dump_name"; then
  echo "backup.upload.failed remote=$BACKUP_RCLONE_REMOTE name=$dump_name" >&2
  exit 1
fi
echo "backup.upload.finished remote=$BACKUP_RCLONE_REMOTE name=$dump_name"

cutoff=$(date -u -d "@$(($(date -u +%s) - BACKUP_KEEP_DAYS * 86400))" +%Y-%m-%dT%H%M%SZ)
rclone lsf --files-only --include 'email-platform-*.age' "$BACKUP_RCLONE_REMOTE" |
  while read -r old; do
    old_stamp=$(echo "$old" | sed -E 's/^email-platform-([0-9T-]+Z)\..*$/\1/')
    earlier=$(printf '%s\n%s\n' "$old_stamp" "$cutoff" | sort | head -n 1)
    if [ "$earlier" = "$old_stamp" ] && [ "$old_stamp" != "$cutoff" ]; then
      rclone deletefile "$BACKUP_RCLONE_REMOTE/$old"
      echo "backup.old-backup.deleted remote=$BACKUP_RCLONE_REMOTE name=$old"
    fi
  done

echo "backup.finished stamp=$stamp"
