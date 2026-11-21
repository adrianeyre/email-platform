# Backups and restore

Everything the app keeps is in Postgres, so a backup is one `pg_dump`.

## Nightly backup

The `backup` service runs `backup/nightly.sh` every day at `BACKUP_HOUR_UTC` (default 02:00). Each night it:

1. takes a `pg_dump --format=custom`;
2. encrypts it with [age](https://age-encryption.org) to `BACKUP_AGE_RECIPIENT`;
3. uploads it with rclone to `BACKUP_RCLONE_REMOTE` as `email-platform-<timestamp>.dump.age`;
4. logs the backup's record: `backup.finished stamp=<timestamp> size=<bytes> sha256=<checksum>`.

It deletes nothing. Old backups are deleted by the remote's own lifecycle rule (below), so the credential on the server can add backups and can't remove or overwrite them.

`backup` logs in as `email_platform_backup`, which can read every table `pg_dump` needs (the migrations ledger and pg-boss's queue included) and write none ([Database roles](deploying.md#database-roles)). Its password is `DATABASE_BACKUP_PASSWORD`.

If a step fails, the run logs which one (`backup.dump.failed`, `backup.upload.failed`, …), and `nightly.sh` stops. The container restarts and waits for the next night, and its healthcheck reports it **unhealthy** until a night succeeds. It is also unhealthy when no night has succeeded for 26 hours. Check with `docker compose ps backup` (and `docker compose logs backup` for the failed step); point whatever watches the server at that health status.

| Variable                     | Purpose                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `BACKUP_AGE_RECIPIENT`       | The age public key backups are encrypted to (`age-keygen -y key.txt`)                       |
| `BACKUP_RCLONE_REMOTE`       | Where backups go, such as `b2:email-backups`                                                |
| `BACKUP_RCLONE_CONFIG_FILE`  | Path on the server to the `rclone.conf` that defines the remote                             |
| `BACKUP_KEEP_DAYS`           | Days of backups to keep (default 14): set the remote's lifecycle rule to the same           |
| `BACKUP_PRUNE_RCLONE_REMOTE` | Leave unset. A remote whose credential may delete, for `backup.sh` to prune through (below) |
| `BACKUP_HOUR_UTC`            | Hour of the nightly run (default 2)                                                         |

### The age key

Make the key pair on your own machine, not the server: `age-keygen -o key.txt`, then `age-keygen -y key.txt` prints the recipient for `.env`. Keep `key.txt` (the **private** key) off the server, somewhere you can get at it when the server is gone, such as a password manager. Without it the backups can't be read; with it, every backup can. `.gitignore` names `key.txt` and `backup-identity.txt`, but neither belongs in the checkout on the server.

### An append-only remote

Give the server a credential that can add files and list and read them, but not delete or overwrite them, and let the remote delete backups older than `BACKUP_KEEP_DAYS` itself. Then whoever takes over the server can't erase the backups first.

- **Backblaze B2**: an application key for the bucket with `listFiles`, `readFiles` and `writeFiles` and **not** `deleteFiles`; a lifecycle rule on the bucket with `daysFromUploadingToHiding` set to `BACKUP_KEEP_DAYS` and `daysFromHidingToDeleting` 1. Turn on Object Lock for the bucket, with a default retention of `BACKUP_KEEP_DAYS`, so an upload under an existing name can't replace a backup either.
- **S3 (and S3-compatible stores)**: an IAM policy on the bucket with `s3:PutObject`, `s3:GetObject` and `s3:ListBucket` only (no `s3:DeleteObject`, `s3:DeleteObjectVersion` or `s3:PutLifecycleConfiguration`); versioning and Object Lock on, in compliance mode, with a default retention of `BACKUP_KEEP_DAYS`; a lifecycle rule that expires current and non-current versions after `BACKUP_KEEP_DAYS`. In `rclone.conf` set `no_check_bucket = true`, as the key can't create buckets.
- **SFTP**: an account whose server refuses removes, renames and setstat, and creates files read-only, as OpenSSH does with `ForceCommand internal-sftp -u 0222 -P remove,rmdir,rename,posix-rename,hardlink,symlink,setstat,fsetstat,lsetstat,copy-data`; set `set_modtime = false` and `shell_type = none` in `rclone.conf`, and prune on the server itself with a job of its own. `src/pen-test/probes/d3.test.ts` runs `backup.sh` against such a server.

`BACKUP_PRUNE_RCLONE_REMOTE` is for a remote with no lifecycle rule. Set it to a second rclone remote, on the same bucket, defined with a credential that may delete, and `backup.sh` deletes backups older than `BACKUP_KEEP_DAYS` through it after each upload. That credential is on the server too, so whoever holds the server can delete every backup with it: prefer the lifecycle rule.

### Keep the record off the server

The server can write to the remote, and the age recipient is public, so whoever holds the server can write a backup there too: age encrypts, it doesn't sign. A restore therefore trusts no backup by name or by date alone. It needs the backup's sha256 from the `backup.finished` line, taken from a copy kept where the server can't rewrite it. Keep one:

- copy the lines off the server regularly, such as weekly, onto your own machine: `docker compose logs --no-log-prefix backup | grep '^backup.finished'`; or
- send the container's logs to a log store off the server with a Docker logging driver.

What that buys, and what it doesn't: a backup forged after the copy was taken isn't in it, and one put under the name of a backup that is in it doesn't match its sha256, so neither is restored. A backup the job made after someone took over the server is in the record like any other, and nothing can tell it from an honest one. Restore one from before the break-in.

## Restore

Restore into an empty database. First list what the remote holds:

```sh
pnpm restore
```

A restore recreates the schema, so `restore` logs in as `email_platform_migrate` (with `DATABASE_MIGRATE_PASSWORD`), which becomes the owner of everything it restores. Compose runs `provision` first, so the roles exist even on a new server's empty volume: there, run `docker compose up -d postgres`, then the restore below, then `sh ops/deploy-server.sh`. The dump carries each table's grants, so the api, worker and backup roles can use the restored data straight away.

Each line is `backup.restore.listed stamp=… size=… modified=…`; a stamp later than now is marked `refused=future-stamp`, as the job never made it. Nothing is restored: `restore.sh` restores only a backup named by its stamp and the sha256 from your record. Then:

1. Copy the age private key onto the server, outside the checkout, readable only by you: `install -m 600 /dev/stdin /tmp/backup-identity.txt` and paste it (or `scp` it to that path).
2. Restore, giving the Retention days in force now (Settings, **Keep logs for (days)**):

   ```sh
   BACKUP_AGE_IDENTITY_FILE=/tmp/backup-identity.txt RESTORE_RETENTION_DAYS=90 \
     pnpm restore 2026-11-17T020000Z 3b1f…e9   # the stamp and the sha256 from your record
   ```

3. Remove the key from the server: `shred -u /tmp/backup-identity.txt` (or `rm`).

`restore.sh` checks the backup's sha256 before it decrypts it (`backup.restore.verified …`, or `backup.restore.refused reason=sha256-mismatch`). After `pg_restore` it re-applies Retention: it sets the restored Settings' Retention to `RESTORE_RETENTION_DAYS` and deletes every Message older than that, as the nightly sweep does (`backup.restore.retention-applied days=… deleted_messages=…`). It also drops the body and attachments of every Message more than 7 days old, failing any still queued, as the sweep does whatever Retention is, so a restored queued email is never sent late ([ADR 0012](../architectural-decision-record/0012-a-message-body-is-kept-at-most-seven-days.md)). Without that, a restore would bring back every Message deleted since the backup was taken, and the Retention setting of that day. It refuses to run without `RESTORE_RETENTION_DAYS` or an age identity.

With no record at all, you can still compute a backup's sha256 yourself (`rclone cat <remote>/email-platform-<stamp>.dump.age | sha256sum`) and pass it. That checks nothing: do it only for a backup you have another reason to trust.

Set `RESTORE_DATABASE` to restore into a database other than `email_platform`, for example to test a backup. Make and provision it first, so migrate's role may build in it:

```sh
docker compose run --rm provision dist/src/index.js provision restore_check
RESTORE_DATABASE=restore_check BACKUP_AGE_IDENTITY_FILE=/tmp/backup-identity.txt RESTORE_RETENTION_DAYS=90 \
  pnpm restore 2026-11-17T020000Z 3b1f…e9
```

Drop it afterwards with `docker compose exec postgres dropdb -U email_platform restore_check`. The same `ENCRYPTION_KEY` is needed afterwards to read the saved SMTP password: see [Changing `ENCRYPTION_KEY`](#changing-encryption_key) for what happens under another one.

`src/backup-restore.test.ts` runs a backup and a restore against real Postgres containers on every `pnpm test`.

## Changing `ENCRYPTION_KEY`

`ENCRYPTION_KEY` seals the SMTP password saved under **Delivery**, and nothing else. Keep a copy of it off the server, beside the age key: a backup restored under another key holds a password nothing can open.

**What changing it does.** When an SMTP password is saved, `api` and `worker` open it at boot. If the key they are given can't open it, they refuse to start, exit 1, and say `ENCRYPTION_KEY can't open the saved SMTP password` (#167). Queued Messages wait, untouched, until a `worker` starts with a key that can; nothing is marked failed meanwhile, but nothing is sent either. Should the saved password change under a running stack (a restore, say), the Delivery page says it can't be read with `ENCRYPTION_KEY`, **Send a test email** answers `409` `smtp_password_unreadable`, and the worker records the same on each Message it tries.

**To rotate it**, with the old key to hand:

1. Make the new key: `openssl rand -base64 32`. The app refuses a key of one repeated byte, such as all zeros (#165).
2. Put it in `.env` as `ENCRYPTION_KEY`.
3. Reseal the saved password under it: `docker compose run --rm -it api dist/src/index.js cli smtp-password:reseal` (`pnpm cli smtp-password:reseal` locally). It prompts for the old key, which it never echoes, opens the password with it and seals it again under the new one. It changes nothing if the old key can't open it either.
4. Run `sh ops/deploy-server.sh`, or `docker compose up -d`, so `api` and `worker` start with the new key.

**With the old key lost**, run `docker compose run --rm -it api dist/src/index.js cli smtp-password:forget` to remove the saved password, start the stack, and enter the password again under **Delivery**. Re-entering it there also reseals it under whatever key the api has.
