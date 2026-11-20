#!/bin/sh
set -eu -o pipefail

: "${BACKUP_AGE_IDENTITY_FILE:?set BACKUP_AGE_IDENTITY_FILE to the file holding the age private key}"
: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE to where backups were sent, such as b2:email-backups}"
: "${PGDATABASE:?set PGDATABASE to the empty database to restore into}"

stamp="${1:-latest}"
if [ "$stamp" = latest ]; then
  stamp=$(rclone lsf --files-only --include 'email-platform-*.dump.age' "$BACKUP_RCLONE_REMOTE" |
    sed -E 's/^email-platform-(.*)\.dump\.age$/\1/' | sort -r | head -n 1)
  if [ -z "$stamp" ]; then
    echo "backup.restore.failed reason=no-backups remote=$BACKUP_RCLONE_REMOTE" >&2
    exit 1
  fi
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

rclone copyto "$BACKUP_RCLONE_REMOTE/email-platform-$stamp.dump.age" "$work/dump.age"
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" --output "$work/dump" "$work/dump.age"
pg_restore --exit-on-error --no-owner --dbname="$PGDATABASE" "$work/dump"
echo "backup.restore.finished stamp=$stamp database=$PGDATABASE"
