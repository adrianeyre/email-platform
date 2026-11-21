#!/bin/sh
# restore.sh                   lists the backups on the remote, and restores nothing
# restore.sh <stamp> <sha256>  restores that backup, if its SHA-256 is the one in the backup job's record
#
# The server can write to the remote, so whoever holds the server can put a backup there too: age encrypts, it
# doesn't sign. So a restore takes no backup on trust. It needs the operator to name one, and to give the sha256 its
# `backup.finished` line logged, from a copy kept off the server (docs/operations/backups-and-restore.md).
set -eu -o pipefail

: "${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE to where backups were sent, such as b2:email-backups}"

now_stamp=$(date -u +%Y-%m-%dT%H%M%SZ)

# A stamp later than now was not made by the backup job, which names each backup by the time it ran.
is_future() {
  [ "$(printf '%s\n%s\n' "$1" "$now_stamp" | sort | tail -n 1)" = "$1" ] && [ "$1" != "$now_stamp" ]
}

list_backups() {
  rclone lsl --include 'email-platform-*.dump.age' "$BACKUP_RCLONE_REMOTE" | sort -k 4 |
    while read -r size day time name; do
      stamp=$(echo "$name" | sed -E 's/^email-platform-(.*)\.dump\.age$/\1/')
      if is_future "$stamp"; then
        echo "backup.restore.listed stamp=$stamp size=$size modified=${day}T${time%%.*} refused=future-stamp"
      else
        echo "backup.restore.listed stamp=$stamp size=$size modified=${day}T${time%%.*}"
      fi
    done
}

stamp="${1:-}"
expected="${2:-}"
if [ -z "$stamp" ] || [ "$stamp" = latest ] || [ -z "$expected" ]; then
  list_backups
  echo "backup.restore.refused reason=needs-stamp-and-sha256: run restore.sh <stamp> <sha256>, with the sha256 from the backup job's record kept off the server" >&2
  exit 1
fi

: "${BACKUP_AGE_IDENTITY_FILE:?set BACKUP_AGE_IDENTITY_FILE to the file holding the age private key}"
: "${PGDATABASE:?set PGDATABASE to the empty database to restore into}"
: "${RESTORE_RETENTION_DAYS:?set RESTORE_RETENTION_DAYS to the Retention days in force now, which the restore applies}"

if ! echo "$stamp" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$'; then
  echo "backup.restore.refused reason=bad-stamp stamp=$stamp" >&2
  exit 1
fi
if ! echo "$expected" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "backup.restore.refused reason=bad-sha256" >&2
  exit 1
fi
if ! echo "$RESTORE_RETENTION_DAYS" | grep -Eq '^[0-9]+$' || [ "$RESTORE_RETENTION_DAYS" -lt 1 ] || [ "$RESTORE_RETENTION_DAYS" -gt 3650 ]; then
  echo "backup.restore.refused reason=bad-retention-days: RESTORE_RETENTION_DAYS is a whole number of days, 1 to 3650" >&2
  exit 1
fi
if is_future "$stamp"; then
  echo "backup.restore.refused reason=future-stamp stamp=$stamp: the backup job never made it" >&2
  exit 1
fi
if [ ! -s "$BACKUP_AGE_IDENTITY_FILE" ]; then
  echo "backup.restore.refused reason=no-identity file=$BACKUP_AGE_IDENTITY_FILE" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

rclone copyto "$BACKUP_RCLONE_REMOTE/email-platform-$stamp.dump.age" "$work/dump.age"
actual=$(sha256sum "$work/dump.age" | cut -d ' ' -f 1)
size=$(wc -c <"$work/dump.age" | tr -d ' ')
if [ "$actual" != "$expected" ]; then
  echo "backup.restore.refused reason=sha256-mismatch stamp=$stamp size=$size sha256=$actual: not the backup the record names" >&2
  exit 1
fi
echo "backup.restore.verified stamp=$stamp size=$size sha256=$actual"

age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" --output "$work/dump" "$work/dump.age"
pg_restore --exit-on-error --no-owner --dbname="$PGDATABASE" "$work/dump"

# A backup holds every Message deleted since it was taken, and the Retention setting of its day. Re-apply today's
# Retention, as the worker's sweep does (src/sending/retention.ts), so the restore brings back neither.
deleted=$(
  psql --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 -v days="$RESTORE_RETENTION_DAYS" <<'SQL'
insert into settings (id, log_retention_days) values (1, :days)
  on conflict (id) do update set log_retention_days = excluded.log_retention_days, updated_at = now();
-- A Message keeps its body at most seven days, whatever Retention is (src/sending/retention.ts, #147). The worker
-- does this daily, but a restored queued Message would be sent before then.
update messages set html = null, text = null, status = 'failed',
    error = 'Not sent within 7 days, so its body was dropped'
  where created_at < now() - interval '7 days' and status = 'queued';
update messages set html = null, text = null
  where created_at < now() - interval '7 days' and (html is not null or text is not null);
delete from message_attachments
  where message_id in (select id from messages where created_at < now() - interval '7 days');
with deleted as (
  delete from messages where created_at < now() - make_interval(days => :days) returning 1
)
select count(*) from deleted;
SQL
)
echo "backup.restore.retention-applied days=$RESTORE_RETENTION_DAYS deleted_messages=$deleted"
echo "backup.restore.finished stamp=$stamp database=$PGDATABASE"
