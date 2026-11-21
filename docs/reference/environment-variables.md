# Environment variables

Every variable is read in [`src/config/vars.ts`](../../src/config/vars.ts). Everything else, including the SMTP provider and the default from address, is set in the UI and stored in Postgres (see [Delivery and access](../guide/delivery-and-access.md)).

| Variable         | Required | Default | Purpose                                                                                                                                                                                               |
| ---------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Yes      |         | A `postgres://` URL, for data and the pg-boss job queue                                                                                                                                               |
| `PORT`           |          | `4320`  | Port of the `api` process, digits only                                                                                                                                                                |
| `APP_URL`        | Yes      |         | Where the UI is reached, `http://` or `https://`; on `https://` the session cookie is `__Host-session`, `Secure`, and every response adds `Strict-Transport-Security`; must be a host name of its own |
| `ENCRYPTION_KEY` | Yes      |         | 32 random bytes in base64 (`openssl rand -base64 32`); encrypts the SMTP password                                                                                                                     |

Every process checks these at boot and refuses to start, exit 1, naming the variable, when one is wrong. Unset and empty are the same; a value of only whitespace is refused, never read as unset or as 0. Beyond that:

- **`DATABASE_URL`** must be `postgres://` or `postgresql://`, with no whitespace in it. A password in it must be at least 16 characters, with no whitespace and not one character repeated (`openssl rand -hex 32` makes 64); a URL with no password is left to the server, as the development stack's trust login is (#166). The value is never printed, as it may hold a password. `provision` checks `POSTGRES_PASSWORD`, inside its `DATABASE_URL`, and the four `DATABASE_*_PASSWORD`s the same way, by name, and every other app container waits on it, so a weak one stops the stack before anything but Postgres starts.
- **`APP_URL`** must be `http:` or `https:`: any other scheme, such as `javascript:` or `ftp:`, is refused (#168). Plain `http:` is [ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md#when-plain-http-stops-being-acceptable)'s decision for the LAN and tailnet, until the condition it records.
- **`ENCRYPTION_KEY`** must decode to 32 bytes that are not all one byte, so an all-zero key, or the 32 bytes of `0x07` `.env.example` once held, is refused (#165). It is never printed. `api` and `worker` also refuse a key that can't open the saved SMTP password (#167): changing the key means resealing that password, as [Changing `ENCRYPTION_KEY`](../operations/backups-and-restore.md#changing-encryption_key) describes.

`.env.example` has development values for the stack in `docker-compose.dev.yml`, except `ENCRYPTION_KEY`, which it leaves empty so no install starts with a key from the repository: make one with `openssl rand -base64 32`. The backup service has its own variables, listed in [Backups and restore](../operations/backups-and-restore.md).

`API_BIND_ADDRESS` is read by `docker-compose.yml`, not by the app: it is the host address the `api` container's port 4320 is published on (#181). Unset or empty, it is `127.0.0.1`, the server alone; set it to the server's LAN or tailnet address, never `0.0.0.0`. A published port skips the host firewall's `INPUT` chain, so filter it in `DOCKER-USER`: see [The published port](../operations/deploying.md#the-published-port). `pnpm deploy:server` checks `/health` on `http://127.0.0.1:4320` unless `DEPLOY_HEALTH_URL` says otherwise, so set that to the same address.

`PEN_TEST_DEPLOYMENT` is set only by `docker-compose.pen-test.yml`, to `email-platform-pen-test`; the pen-test fixture loader refuses to run without it, so it never runs in production. See [the pen-test deployment](../pen-test/deployment.md).

The website build reads `SITE_URL` and `SITE_DOMAIN`, and `pnpm site:film` reads `SITE_FILM_URL` and `CHROME_PATH`; see [Website, CI and releases](../operations/website-ci-and-releases.md).
