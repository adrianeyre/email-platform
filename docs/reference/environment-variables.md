# Environment variables

Every variable is read in [`src/config/vars.ts`](../../src/config/vars.ts). Everything else, including the SMTP provider and the default from address, is set in the UI and stored in Postgres (see [Delivery and access](../guide/delivery-and-access.md)).

| Variable         | Required | Default | Purpose                                                                           |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Yes      |         | Postgres, for data and the pg-boss job queue                                      |
| `PORT`           |          | `4320`  | Port of the `api` process                                                         |
| `APP_URL`        | Yes      |         | Where the UI is reached; session cookies are `Secure` when it is `https://`       |
| `ENCRYPTION_KEY` | Yes      |         | 32 random bytes in base64 (`openssl rand -base64 32`); encrypts the SMTP password |

`.env.example` has development values for the stack in `docker-compose.dev.yml`. The backup service has its own variables, listed in [Backups and restore](../operations/backups-and-restore.md).

The website build reads `SITE_URL` and `SITE_DOMAIN`, and `pnpm site:film` reads `SITE_FILM_URL` and `CHROME_PATH`; see [Website, CI and releases](../operations/website-ci-and-releases.md).
