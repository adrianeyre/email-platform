# Deploying

The platform runs on one Linux home server under Docker Compose ([ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md)). A deploy is one command run on the server. Every pull request is checked by `.github/workflows/checks.yml` before it can reach `main` ([Checks every pull request](website-ci-and-releases.md#checks-every-pull-request)), and that is the only place typecheck, lint and the tests run: the server builds and runs only the images. It installs no npm package and runs no check, so no development dependency or test file ever runs beside `.env` and the Docker daemon, which is root's reach over the host ([pen test I6](../pen-test/findings/I6.md), #178).

## First time

1. Install Docker (with the Compose plugin), git and curl, and clone the repository. The server needs no Node or pnpm: the images build the app inside Docker.
2. Copy `.env.example` to `.env` and fill in the production values: `POSTGRES_PASSWORD` and the four `DATABASE_*_PASSWORD`s (each its own `openssl rand -hex 32`; see [Database roles](#database-roles)), `APP_URL` (on a host name of the platform's own: see [A host name of its own](#a-host-name-of-its-own)), `ENCRYPTION_KEY` (`openssl rand -base64 32`; `.env.example` leaves it empty), `API_BIND_ADDRESS` (the server's LAN or tailnet address: see [The published port](#the-published-port)) and the backup settings (see [Backups and restore](backups-and-restore.md)). Every variable the stack needs and does not default is marked `:?` in `docker-compose.yml`, so `docker compose config` names any that are missing. Compose can't look inside a value, so the app checks the rest at boot, by name ([Environment variables](../reference/environment-variables.md)): `provision` refuses a database password under 16 characters, with whitespace or one character repeated, and every app container refuses an `ENCRYPTION_KEY` of one repeated byte or an `APP_URL` that isn't `http:` or `https:`. An install made before these checks with a weaker value stops at the deploy's Migrate step, or at `api` and `worker`, until it is changed (see **Rotating a password** below, and [Changing `ENCRYPTION_KEY`](backups-and-restore.md#changing-encryption_key) for the key).
3. Run `sh ops/deploy-server.sh`.
4. Create the first user: `docker compose run --rm -it api dist/src/index.js cli user:create you@example.com`.
5. Sign in at `APP_URL`, set the SMTP provider under **Delivery**, check the default from address (it starts as `no-reply@adrianeyre.co.uk`), and use **Send a test email**.

## Every deploy

```sh
sh ops/deploy-server.sh
```

(`pnpm deploy:server` runs the same script, where pnpm is installed; the server doesn't need it.)

`ops/deploy-server.sh` runs these steps in order and stops at the first failure:

| Step         | Command                                                                     | If it fails                                                                                       |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Pull         | `git pull --ff-only origin main`, then `HEAD` must be `origin/main` exactly | Nothing has changed                                                                               |
| Build images | `docker compose build`                                                      | Images are built beside the running containers, which are unchanged                               |
| Migrate      | `docker compose run --rm migrate`                                           | Migrations run in a transaction, so the database is unchanged, and no container has been replaced |
| Restart      | `docker compose up -d --wait`                                               | Compose waits for health checks; see `docker compose ps`                                          |
| Health       | `curl` `/health` until it returns 200                                       | The deploy exits non-zero                                                                         |

Compose runs `provision` before `migrate`, so every deploy also brings the [database roles](#database-roles) and their passwords up to date.

The script exits non-zero on any failure. Set `DEPLOY_HEALTH_URL` if the API is not on `http://127.0.0.1:4320`, as it isn't once `API_BIND_ADDRESS` names another address: export `DEPLOY_HEALTH_URL=http://<API_BIND_ADDRESS>:4320/health` in the shell that runs the deploy, which doesn't read `.env`.

The Pull step deploys `main` and nothing else: a checkout with a commit of its own on top, or on another branch that has moved away from `main`, is refused before anything is built, so what runs is what was merged and checked. Signed commits aren't verified (`git pull --verify-signatures` needs a signing key and a keyring on the server); until `main` requires pull requests and passing checks ([Owner steps after merge](website-ci-and-releases.md#owner-steps-after-merge)), a direct push to `main` reaches the server unchecked.

An install made before this change still has `node_modules/` in the checkout from the old Install step; nothing uses it any more, and `rm -rf node_modules` removes it.

## What runs

| Service     | Role                                     | Reached from                         |
| ----------- | ---------------------------------------- | ------------------------------------ |
| `api`       | UI, REST API and `/docs` on port 4320    | `API_BIND_ADDRESS`: LAN or tailnet   |
| `worker`    | Sends queued emails and deletes old logs | Nothing (outgoing SMTP only)         |
| `provision` | Makes the database roles, then exits     | The internal `database` network only |
| `migrate`   | Applies migrations, then exits           | The internal `database` network only |
| `postgres`  | Database and job queue                   | The internal `database` network only |
| `backup`    | Nightly encrypted backups                | —                                    |

Only `api`, `worker`, `backup` and `restore` are also on the `default` network, which reaches the LAN and the internet: the api for its published port and a test send, the worker for the SMTP provider, and `backup` and `restore` for the backup remote. Each logs in as its own role (below), none with `POSTGRES_PASSWORD`. `provision`, `migrate` and `postgres` need nothing outside, so they sit on the internal `database` network alone and have no way out ([pen test D1](../pen-test/findings/D1.md), #139). `/docs`, the API reference, answers only a signed-in user or an API key (#148).

Data lives on the `postgres-data` volume, so it survives `docker compose down` and restarts. Only `docker compose down --volumes` removes it.

## The published port

`api` is the only container with a published port, and it is published on one host address, `API_BIND_ADDRESS`, never on every interface ([pen test I4](../pen-test/findings/I4.md), #181). Unset, it is `127.0.0.1`, so only the server itself (or an SSH tunnel to it) reaches the UI and API: safe, but not yet what [ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md) describes. Set it in `.env` to the address the platform is reached on:

- **the server's LAN address**, such as `192.168.1.20`, for devices on the home network; tailnet devices reach it too if the server advertises the LAN as a [Tailscale subnet route](https://tailscale.com/kb/1019/subnets);
- **or its tailnet address**, such as `100.64.0.20` (`tailscale ip -4`), for tailnet devices only. Docker can only bind an address that exists when the container starts, so start Docker after Tailscale (a systemd `After=tailscaled.service` drop-in for `docker.service`), or `api` fails to start after a reboot with `cannot assign requested address`.

Give the address a static DHCP lease or a fixed tailnet IP, so it doesn't move from under the binding. Never set `0.0.0.0` or `::`: that is every interface again. One address is published, not a list; `docker compose ps` shows which.

**A host firewall's `INPUT` rules don't apply to it.** Docker publishes a port by DNAT in the `nat` table and forwards the connection through `FORWARD`, never through `INPUT`, so a `ufw deny 4320` or an `iptables -A INPUT … -j DROP` leaves the port open to anything that can route to the bound address. Filter a published port in the `DOCKER-USER` chain, which Docker keeps and runs before its own rules. To let only the home LAN in, say:

```sh
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 4320 --ctdir ORIGINAL ! -s 192.168.1.0/24 -j DROP
```

`--ctorigdstport` matches the port the client asked for, before Docker rewrote it. `ufw` doesn't manage `DOCKER-USER`, so make the rule survive a reboot yourself (in `/etc/ufw/after.rules`, or with `iptables-persistent`). The bind address is the first gate and this rule the second; the app's sign-in and API Keys are still the only ones that count (ADR 0003).

**Upgrading an install made before `API_BIND_ADDRESS`:** set it in `.env`, and `DEPLOY_HEALTH_URL` in the shell, before the next `pnpm deploy:server`. Without it the deploy still succeeds, as the health check asks `127.0.0.1`, but the UI and API are reachable from the server alone, and every other device sees the connection refused until it is set.

## Container hardening

Every container in `docker-compose.yml`, the one-shot `provision`, `migrate` and `restore` included, drops every Linux capability (`cap_drop: [ALL]`) and adds none back, sets `no-new-privileges` so a setuid binary can't regain one, runs with a read-only root filesystem, and is bounded in memory and processes ([pen test I4](../pen-test/findings/I4.md), #182):

| Service                                 | Runs as         | Writable                                                                                  | Memory | Processes |
| --------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- | ------ | --------- |
| `api`, `worker`, `provision`, `migrate` | `node` (1000)   | `/tmp`, in memory (64 MB)                                                                 | 512 MB | 128       |
| `postgres`                              | `postgres` (70) | the `postgres-data` volume; `/var/run/postgresql` and `/tmp` in memory; `/dev/shm` 128 MB | 1 GB   | 256       |
| `backup`, `restore`                     | `postgres` (70) | `/tmp` (the dump while it's made) and `/var/lib/postgresql` (the health state), on disk   | 512 MB | 128       |

`postgres` runs as `postgres` from the start rather than as root, so its entrypoint needs no capability: it neither chowns the data directory nor switches user, because the image makes `/var/lib/postgresql` postgres's own and a new `postgres-data` volume inherits that. An existing volume is already postgres's, as the root entrypoint chowned it on first start. The memory bounds are generous for one school; a container that reaches its bound is killed and restarted (`docker compose ps` shows it, and `docker inspect` says `OOMKilled`). Raise `mem_limit` in `docker-compose.yml` if the data outgrows it, Postgres first.

The pen-test override hardens its own `mailpit` and `entry` (nginx) the same way and runs them as non-root users ([the pen-test deployment](../pen-test/deployment.md)).

## Updating an image

Every image is pinned by digest, so the checkout fixes what runs ([pen test I4](../pen-test/findings/I4.md), #183): `postgres` in `docker-compose.yml` and `backup/Dockerfile`, `node` in both stages of `Dockerfile`, and `mailpit` and `nginx` in `docker-compose.pen-test.yml` and `docker-compose.dev.yml`. `email-platform:local` and the backup image aren't pulled at all: `docker compose build` makes them here, from those pinned Dockerfiles. `backup/Dockerfile` also pins `age` and `rclone` to the exact Alpine package versions, as they encrypt and ship every backup.

To move to a newer image, change the tag and the digest together, everywhere the image is named (`grep -rn 'postgres:18-alpine' .`):

```sh
docker buildx imagetools inspect postgres:18-alpine   # the index Digest, which covers every architecture
```

For the backup image, then look up the package versions the new Alpine base carries, and pin those:

```sh
docker run --rm postgres:18-alpine@sha256:<digest> sh -c 'apk update >/dev/null && apk policy age rclone'
```

Alpine's repository keeps only the newest build of each package, so when it publishes a new `age` or `rclone` the pinned one is gone, and `docker compose build` stops at `apk add` with `unable to select packages`. That is the pin working: nothing changes until the versions are bumped in the checkout. Run `pnpm test` after a bump, as `src/backup-restore.test.ts` builds the backup image and runs a backup and a restore with it. The tests' own Testcontainers images (`postgres:18-alpine`, `axllent/mailpit:v1.33.1` in `src/`) are still named by tag.

Nothing proposes these bumps yet. Dependabot could: a `docker` ecosystem entry in `.github/dependabot.yml` watches `FROM` lines and Compose images and updates digests, though not the `apk` versions.

## A host name of its own

`APP_URL`'s host name must be the platform's alone: no other service, container, dev server or router page may answer on that name, on any port. A browser keeps cookies by host name, not port, so every service on the platform's host name is sent every signed-in User's session cookie and can act as them, read the log and every Wizzaroo link in it ([pen test I1](../pen-test/findings/I1.md), #171). No cookie name or flag stops that; only a name of its own does. Give the platform one (such as `email.home` on the LAN's DNS, or a tailnet name), and reach other services on other names.

Users should reach the platform at `APP_URL` itself: the cookie's name and flags, `Strict-Transport-Security`, the links in the UI and the API document, and sign-out's origin check are all built from it.

With an `https://` `APP_URL`, the session cookie is `__Host-session` and `Secure`, which no subdomain and no plain-HTTP service on the host name can set or replace, and every response sends `Strict-Transport-Security` for a year ([Delivery and access](../guide/delivery-and-access.md#access)). Moving an existing deployment to `https://` signs every User out once.

## Database roles

No container but `postgres` logs in as the Postgres superuser (`email_platform`, the `POSTGRES_USER` the image makes). Each logs in as a role of its own, none of them a superuser, so none can run `COPY … PROGRAM`, make a role or read `pg_authid` ([pen test D1](../pen-test/findings/D1.md), #121, #138; [ADR 0010](../architectural-decision-record/0010-each-container-logs-in-as-a-least-privilege-postgres-role.md)):

| Role                     | Logs in from         | Password variable           | May                                                                                                  |
| ------------------------ | -------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `email_platform_owner`   | Nothing (`NOLOGIN`)  | —                           | Owns the `public`, `drizzle` and `pgboss` schemas and everything in them                             |
| `email_platform_migrate` | `migrate`, `restore` | `DATABASE_MIGRATE_PASSWORD` | Becomes the owner on login: runs Drizzle's and pg-boss's migrations, and a restore                   |
| `email_platform_api`     | `api`                | `DATABASE_API_PASSWORD`     | Read and write the tables in `public` and `pgboss` (through `email_platform_app`); no DDL, no ledger |
| `email_platform_worker`  | `worker`             | `DATABASE_WORKER_PASSWORD`  | The same as the api                                                                                  |
| `email_platform_backup`  | `backup`             | `DATABASE_BACKUP_PASSWORD`  | Read every table in `public`, `drizzle` and `pgboss`, for `pg_dump`; write nothing                   |

`provision` (`dist/src/index.js provision`, `src/lib/database-roles.ts`) is a one-shot container that, with `postgres`, is the only holder of `POSTGRES_PASSWORD`, and like `postgres` it is on the internal `database` network only. It needs the superuser because only a superuser, or a role that can create roles, may make roles and set their passwords; `migrate` needs only the owner's rights, so it holds `DATABASE_MIGRATE_PASSWORD` and never the superuser's. It makes the roles, sets each password from `.env`, and hands the three schemas and everything in them to the owner; `migrate` then grants the api, worker and backup roles their access to whatever it has made. Both run on every deploy and change nothing when nothing has changed. The api and worker start pg-boss without installing, migrating or reindexing its schema, which only `migrate` may change.

**Rotating a password:** put the new value in `.env` and run `sh ops/deploy-server.sh`. `provision` sets it before `migrate` runs, and `docker compose up` recreates the container that uses it. `POSTGRES_PASSWORD` is the exception: Postgres reads it only when it makes a new volume, so change the superuser's password with `docker compose exec postgres psql -U email_platform -c '\password'` and then in `.env`.

**Upgrading an install made before the roles:** add the four `DATABASE_*_PASSWORD`s to `.env` (`docker compose config` names any that are missing) and run `sh ops/deploy-server.sh`. `provision` moves the existing schemas, tables, sequences, functions and types from the superuser to the owner, `migrate` grants the rest, and `api`, `worker` and `backup` are recreated with their own logins. Nothing else changes, and the data stays where it is.

The development stack (`docker-compose.dev.yml`) has no roles: the app logs in as the superuser there, and `migrate` skips the grants.

## Logs

Every service writes its log to Docker's `json-file` driver, bounded in `docker-compose.yml` (`x-logging`) to three files of 10 MB each, so `docker compose logs` holds at most 30 MB per container and the oldest lines go first. Docker can bound a log by size, not by age, so how many days that covers depends on traffic. Each request writes two lines of about 350 bytes, and the `api` health check alone makes one every 30 seconds, about 2 MB a day, so the `api` log covers about two weeks at most, and less as traffic grows: within the 90-day default Retention. If you set Retention shorter than that, lower `max-size` to match, or ship the logs elsewhere with their own age limit. Recreating a container (`docker compose up -d` after a build) also starts its log afresh.

The logs hold no personal data to begin with: request lines drop their query string, errors drop the values they carried, and the worker logs a Message's ID and outcome only ([Logs](../guide/logs.md#the-containers-own-logs)). The bound is there so nothing written by mistake outlives Retention for long.
