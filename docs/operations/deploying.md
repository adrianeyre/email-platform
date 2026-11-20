# Deploying

The platform runs on one Linux home server under Docker Compose ([ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md)). There is no hosted CI: a deploy is one command run on the server.

## First time

1. Install Docker (with the Compose plugin), Node 26 and pnpm 12, and clone the repository.
2. Copy `.env.example` to `.env` and fill in the production values: `POSTGRES_PASSWORD`, `APP_URL`, `ENCRYPTION_KEY` (`openssl rand -base64 32`) and the backup settings (see [Backups and restore](backups-and-restore.md)). Every variable the stack needs and does not default is marked `:?` in `docker-compose.yml`, so `docker compose config` names any that are missing.
3. Run `pnpm deploy:server`.
4. Create the first user: `docker compose run --rm -it api dist/src/index.js cli user:create you@example.com`.
5. Set up an SMTP provider and its DNS records ([Setting up Brevo](setting-up-brevo.md) walks through one).
6. Sign in at `APP_URL`, set the SMTP provider under **Delivery**, check the default from address (it starts as `no-reply@adrianeyre.co.uk`), and use **Send a test email**.

## Every deploy

```sh
pnpm deploy:server
```

`ops/deploy-server.sh` runs these steps in order and stops at the first failure:

| Step         | Command                                            | If it fails                                                                                       |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Pull         | `git pull --ff-only`                               | Nothing has changed                                                                               |
| Install      | `pnpm install --frozen-lockfile`                   | Nothing running has changed                                                                       |
| Check        | `pnpm run typecheck`, `pnpm run lint`, `pnpm test` | The running stack is unchanged                                                                    |
| Build images | `docker compose build`                             | Images are built beside the running containers, which are unchanged                               |
| Migrate      | `docker compose run --rm migrate`                  | Migrations run in a transaction, so the database is unchanged, and no container has been replaced |
| Restart      | `docker compose up -d --wait`                      | Compose waits for health checks; see `docker compose ps`                                          |
| Health       | `curl` `/health` until it returns 200              | The deploy exits non-zero                                                                         |

The script exits non-zero on any failure. Set `DEPLOY_HEALTH_URL` if the API is not on `http://127.0.0.1:4320`.

## What runs

| Service    | Role                                     | Reached from                         |
| ---------- | ---------------------------------------- | ------------------------------------ |
| `api`      | UI, REST API and `/docs` on port 4320    | LAN and tailnet                      |
| `worker`   | Sends queued emails and deletes old logs | Nothing (outgoing SMTP only)         |
| `migrate`  | Applies migrations, then exits           | —                                    |
| `postgres` | Database and job queue                   | The internal `database` network only |
| `backup`   | Nightly encrypted backups                | —                                    |

Data lives on the `postgres-data` volume, so it survives `docker compose down` and restarts. Only `docker compose down --volumes` removes it.
