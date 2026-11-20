# Backups and restore

Everything the app keeps is in Postgres, so a backup is one `pg_dump`.

## Nightly backup

The `backup` service runs `backup/nightly.sh` every day at `BACKUP_HOUR_UTC` (default 02:00). Each night it:

1. takes a `pg_dump --format=custom`;
2. encrypts it with [age](https://age-encryption.org) to `BACKUP_AGE_RECIPIENT`;
3. uploads it with rclone to `BACKUP_RCLONE_REMOTE` as `email-platform-<timestamp>.dump.age`;
4. deletes backups older than `BACKUP_KEEP_DAYS` (default 14) from the remote.

If any step fails, the run exits non-zero and logs which step failed (`docker compose logs backup`).

| Variable                    | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `BACKUP_AGE_RECIPIENT`      | The age public key backups are encrypted to (`age-keygen -y key.txt`) |
| `BACKUP_RCLONE_REMOTE`      | Where backups go, such as `b2:email-backups`                          |
| `BACKUP_RCLONE_CONFIG_FILE` | Path on the server to the `rclone.conf` that defines the remote       |
| `BACKUP_KEEP_DAYS`          | Days of backups to keep (default 14)                                  |
| `BACKUP_HOUR_UTC`           | Hour of the nightly run (default 2)                                   |

Keep the age **private** key off the server. Without it the backups can't be read.

## Restore

Restore into an empty database:

```sh
BACKUP_AGE_IDENTITY_FILE=./backup-identity.txt pnpm restore              # the latest backup
BACKUP_AGE_IDENTITY_FILE=./backup-identity.txt pnpm restore 2026-11-17T020000Z
```

Set `RESTORE_DATABASE` to restore into a database other than `email_platform`, for example to test a backup. The same `ENCRYPTION_KEY` is needed afterwards to read the saved SMTP password.

`src/backup-restore.test.ts` runs a backup and a restore against real Postgres containers on every `pnpm test`.
