# The pen-test deployment

The dedicated stack a pen-test round runs against, never the production instance on the home server ([the brief](../product-requirements-document/pen-testing.md#engagement-shape)). It is production's own `docker-compose.yml`, run as its own Compose project with [`docker-compose.pen-test.yml`](../../docker-compose.pen-test.yml) merged on top. So the round probes production's own images, services, healthchecks and networks, and the override changes only what has to differ. Keep this page private on the same terms as the PRD.

## It never touches production

| What                                    | How it is kept out                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production's secrets                    | **None is read.** `pnpm pen-test:up` generates every secret into `.pen-test-deployment/` and always gives Compose that folder's `.env` with `--env-file`, so the root `.env` is never read. Docker runs with only the variables its client needs (`PATH`, `HOME`, `DOCKER_*` and the like), so a secret exported in your shell can't reach Compose. The only files mounted from the host are the deployment's own throwaway `rclone.conf` and age identity |
| The production instance                 | Its own project, `email-platform-pen-test`, so its own containers, networks and volumes, including Postgres's `email-platform-pen-test_postgres-data`. `api` publishes nothing; testers reach it through `entry` on `127.0.0.1:43320`, not production's 4320. `api`, `worker`, `postgres`, `backup` and `mailpit` sit only on internal networks, so none of them can reach the production instance, the LAN or the internet                                |
| A real SMTP provider                    | Settings point at `mailpit:1025` once the fixtures are loaded, a Mailpit on the internal `default` network that keeps every email and delivers none. `worker` and `api` have no way out, so even a probe that points Settings elsewhere (H6) reaches only what is inside the deployment                                                                                                                                                                    |
| The real backup remote and age identity | `backup` sends to `stand-in:/srv/backup-stand-in/email-platform`, a local rclone remote on the deployment's own `backup-stand-in` volume, encrypted to an age key pair made for the deployment and kept in `.pen-test-deployment/age-identity.txt`                                                                                                                                                                                                         |
| Production's data                       | The database starts empty. Load the synthetic [fixtures](./fixtures.md) only; never restore a production backup into it                                                                                                                                                                                                                                                                                                                                    |

`src/pen-test/deployment/pen-test-deployment.test.ts` checks the merged configuration against these whenever `docker compose` is installed: the only network that isn't internal and the only service on it, the only published ports, the only host mounts, the backup remote and the project name.

### The one network with a way out

A port can only be published from a network that isn't internal, so one network, `entry`, isn't. Its only member is `entry`, an nginx stream proxy whose configuration, `src/pen-test/deployment/entry-nginx.conf`, names exactly two upstreams, `api:4320` and `mailpit:8025`; no request can change where it connects. It passes TCP straight through and adds no header, so `api` sees exactly what the caller sent, `X-Forwarded-For` included, as it does in production where nothing stands in front of it (H1). The `entry` network is made with `enable_ip_masquerade: "false"`, so on Linux, the home server and the Sandcastle sandbox, even `entry` has no route out. **Docker Desktop doesn't honour that option**: its own userland networking carries `entry`'s traffic out anyway. On a Mac `entry` could reach the internet, though nothing in it ever tries. Every other container has no way out on either.

## What differs from production

| In production                                                       | In the pen-test deployment                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project `email-platform`                                            | Project `email-platform-pen-test`                                                                                                                 |
| `api` publishes `4320` on `API_BIND_ADDRESS` (`127.0.0.1` if unset) | `api` publishes nothing. `entry` publishes `127.0.0.1:43320` (the API and UI) and `127.0.0.1:43325` (Mailpit's UI and API)                        |
| The `default` network reaches the LAN, the tailnet and the internet | `default` is internal. `entry` is the only network that isn't, and only `entry` is on it                                                          |
| An upstream SMTP provider, set in Settings                          | `mailpit`, on the internal `default` network                                                                                                      |
| `BACKUP_RCLONE_REMOTE` is off-server, from the real `rclone.conf`   | `stand-in:/srv/backup-stand-in/email-platform`: a `local` remote on the `backup-stand-in` volume, made writable by `backup-stand-in-folder` first |
| The real age recipient, the identity kept off the server            | An age key pair made by `pnpm pen-test:up` in the backup image, the identity in `.pen-test-deployment/age-identity.txt`                           |
| `APP_URL` is the home server's address                              | `http://localhost:43320`                                                                                                                          |
| No `PEN_TEST_DEPLOYMENT`                                            | `PEN_TEST_DEPLOYMENT=email-platform-pen-test` on `api`, `worker` and `migrate`, the only place the fixture loader agrees to run                   |

Everything else, the app and backup images built from this checkout (tagged for the pen-test project), `migrate`, the Postgres superuser every container logs in as (H4), the healthchecks and the nightly backup, is production's.

## Before you start

Docker with Compose 2.24 or later (the override uses `!reset`), Node 26 and pnpm, and a clone of this repo with `pnpm install` run. Nothing else: no `.env` to write and no credential to fetch. Ports `43320` and `43325` must be free on `127.0.0.1`. It runs beside production and beside the development stack in `docker-compose.dev.yml`, because its project, ports, networks and volumes are all its own.

## Standing it up

```bash
pnpm pen-test:up
```

The first time, it makes `.pen-test-deployment/` (readable only by you; git ignores it) and writes into it a generated `POSTGRES_PASSWORD`, a password for each container's database role and an `ENCRYPTION_KEY`, the stand-in `rclone.conf`, and an age key pair made with `age-keygen` in the backup image. Then it runs `docker compose up --detach --build --wait` on the pen-test project, which builds the app from this checkout, starts Postgres, runs `provision` and `migrate`, starts `api`, `worker`, `mailpit`, `backup` and `entry`, and waits for them to be healthy. It ends:

```text
The pen-test deployment email-platform-pen-test is up at http://localhost:43320, and its mail at http://localhost:43325
```

Running it again keeps the secrets and the data, and rebuilds and restarts what changed.

The database starts empty. Load [the fixtures](./fixtures.md), then write [the credentials package](./credentials-package.md):

```bash
pnpm pen-test:seed
pnpm pen-test:credentials
```

The commands on this page use this shell function, so they always name the pen-test project and its own `.env`. Run them from the root of the repo:

```bash
pen_test_compose() {
  docker compose --project-name email-platform-pen-test \
    --env-file .pen-test-deployment/.env \
    --file docker-compose.yml --file docker-compose.pen-test.yml "$@"
}
```

`pen_test_compose ps` lists the containers, and `pen_test_compose logs -f api worker` follows the app's log.

## Who can reach it

Both ports are published on `127.0.0.1` only, so only the machine running it can reach them. A tester on another machine forwards the ports over SSH rather than the binding being widened:

```bash
ssh -L 43320:127.0.0.1:43320 -L 43325:127.0.0.1:43325 the-machine-running-it
```

Every request reaches `api` from `entry`'s address, so the socket address `api` sees is the same for every tester. What a caller sends in `X-Forwarded-For` arrives untouched, which is what a probe of H1 needs. Since #114 `api` ignores it (`trustProxy` is off), so the sign-in throttle keys on `entry`'s address and every tester shares one count per email.

## Mail

Every email the deployment sends, a send through `/v1/messages`, a test send from a Template and the Settings test included, goes to Mailpit, which keeps it and delivers nothing. Read them at <http://localhost:43325>, or as JSON at `http://localhost:43325/api/v1/messages`, and an email's raw source, its headers included, at `/api/v1/message/<ID>/raw`. Restarting `mailpit` empties it.

## Backups

`backup` is production's container: it takes an age-encrypted `pg_dump` every night at 02:00 UTC and sends it to the stand-in remote. Like production, it deletes none: the stand-in has no lifecycle rule, so they pile up until teardown. Take one now (its last line, `backup.finished stamp=… size=… sha256=…`, is the record a restore checks), and list them:

```bash
pen_test_compose exec backup backup.sh
pen_test_compose exec backup rclone lsf stand-in:/srv/backup-stand-in/email-platform
```

To restore, make and provision an empty database and run production's `restore` with it, as [Backups and restore](../operations/backups-and-restore.md) does. The `restore` service mounts the deployment's own throwaway identity:

```bash
pen_test_compose run --rm -T provision dist/src/index.js provision restore_check
pen_test_compose --profile restore run --rm -T -e PGDATABASE=restore_check -e RESTORE_RETENTION_DAYS=90 restore restore.sh <stamp> <sha256>
pen_test_compose exec -T postgres psql -U email_platform -d restore_check -c 'select count(*) from messages'
```

It ends `backup.restore.finished stamp=… database=restore_check`. Drop the database afterwards with `dropdb`.

## Its secrets

`.pen-test-deployment/` holds the only secrets the deployment has, all generated for it and for nothing else: `.env` (the Postgres passwords and `ENCRYPTION_KEY`), `rclone.conf`, `age-identity.txt`, `fixture-seed.txt` and `credentials-package.env`. Testers get the URL and the credentials package, and none of the rest. Finding one anyway is a finding. Teardown deletes the folder, so every one of them ends with the deployment.

## Tearing it down

```bash
pnpm pen-test:down
```

It removes every container, volume and network labelled with the `email-platform-pen-test` project, those of the `restore` profile and of `run` included, checks none is left, and deletes `.pen-test-deployment/`. It ends:

```text
Removed 8 containers, 2 volumes and 3 networks of email-platform-pen-test.
No container, volume or network labelled email-platform-pen-test is left.
Deleted /path/to/email-platform/.pen-test-deployment, with the deployment's secrets, fixture seed, credentials package and backup key.
```

The counts depend on what ran. It fails, naming what is left, if anything is, such as a network a probe container still holds. Check it yourself with:

```bash
docker volume ls --filter label=com.docker.compose.project=email-platform-pen-test
```

which lists nothing. The images it built, `email-platform-pen-test:local` and `email-platform-pen-test-backup`, are kept so the next round starts faster; they hold code, not data.

## Things to know

- **Never** run `pen_test_compose` with `--project-name email-platform`, or Compose with production's `.env`: that would be production.
- **The data is synthetic only.** Never load a backup of production into it.
- **Its app image is its own,** `email-platform-pen-test:local`, built from the checkout it is run in, so standing it up never replaces production's `email-platform:local`.
