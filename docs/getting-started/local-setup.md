# Local setup

Run Email Platform on your own machine, send your first email, and find the commands you'll use while working on it.

## Prerequisites

- **Node.js 26** and **pnpm 12.21** (pinned in `package.json` under `packageManager`).
- **Docker** with Compose. The dev stack runs Postgres and Mailpit. The tests start their own containers through Testcontainers.

## Run it

```sh
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres on 127.0.0.1:54321, Mailpit on 1025 (SMTP) and 8025 (UI)
cp .env.example .env
pnpm migrate
pnpm cli user:create you@example.com             # prompts for a password (12+ characters)
pnpm exec vite build                              # builds the UI that the api serves from dist/ui
pnpm local                                        # the api and worker together: UI and API on http://localhost:4320, API reference at /docs
pnpm dev:ui                                       # optional: Vite dev server for the UI, proxying the API
```

`pnpm local` runs the `api` and the `worker` (which sends queued emails and deletes old logs) side by side in one terminal, each log line prefixed `local:api` or `local:worker`. Ctrl-C stops both. To run one on its own, use `pnpm local:api` or `pnpm local:worker` (or `pnpm run:local api`). All of them read `.env`; `pnpm start` is the production command and does not.

The variables in `.env` are described in [Environment variables](../reference/environment-variables.md).

## Send your first email

1. Sign in at <http://localhost:4320>.
2. Open **Delivery**. For local development, set the SMTP host to `localhost`, the port to `1025`, no TLS and no username, so email is caught by Mailpit at <http://localhost:8025>. The default from address starts as `no-reply@adrianeyre.co.uk`. See [Delivery and access](../guide/delivery-and-access.md).
3. Add the built-in emails, with their Wizzaroo header, footer and configuration:

   ```sh
   pnpm cli templates:add-built-ins
   ```

4. Create an API key under **API keys**, or run `pnpm cli apikey:create "My app"`. It is shown once.
5. Send a template by its slug:

   ```sh
   curl -X POST http://localhost:4320/v1/messages \
     -H "Authorization: Bearer ek_…" -H "Content-Type: application/json" \
     -d '{"to":["ada@example.com"],
          "templateSlug":"wizzaroo-reset-your-password",
          "variables":{"email":"ada@example.com",
            "resetUrl":"https://app.example.com/reset?t=abc",
            "linkLifetime":"1 hour"}}'
   ```

   Or send raw content:

   ```sh
   curl -X POST http://localhost:4320/v1/messages \
     -H "Authorization: Bearer ek_…" -H "Content-Type: application/json" \
     -d '{"from":"app@example.com","to":["someone@example.com"],"subject":"Hello","text":"It works"}'
   ```

6. Open **Logs** to see it sent, and Mailpit to read it. Every field of a send is in [Sending](../guide/sending.md).

## Send from a Node app

The typed client, [`@adrianeyre/email-client`](../../packages/email-client/README.md), is published to [GitHub Packages](https://github.com/adrianeyre/email-platform/pkgs/npm/email-client) whenever its version changes on `main`.

1. Create a GitHub [personal access token (classic)](https://github.com/settings/tokens) with the `read:packages` scope, and make it available to your app's installs as `GITHUB_TOKEN`. In GitHub Actions, the workflow's own `GITHUB_TOKEN` works when the workflow has `packages: read`.
2. Add an `.npmrc` beside your app's `package.json`, so the `@adrianeyre` scope comes from GitHub Packages:

   ```ini
   @adrianeyre:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

3. Install the client:

   ```sh
   pnpm add @adrianeyre/email-client
   ```

4. Send with the API key from step 4 above:

   ```ts
   import { createEmailClient } from "@adrianeyre/email-client";

   const email = createEmailClient({
     baseUrl: "http://localhost:4320",
     apiKey: process.env.EMAIL_API_KEY,
   });
   await email.builtIn.resetYourPassword({
     to: "ada@example.com",
     variables: {
       email: "ada@example.com",
       resetUrl: "https://app.example.com/reset?t=abc",
       linkLifetime: "1 hour",
     },
   });
   ```

Everything the client does is in [its README](../../packages/email-client/README.md).

## Commands

| Command                                        | Does                                                                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                    | Unit tests, the UI tests and the Postgres + Mailpit integration suite (needs Docker), with coverage                                                                          |
| `pnpm typecheck`, `pnpm lint`, `pnpm prettier` | Type, lint and formatting checks; the pre-commit hook runs lint, Prettier and the tests                                                                                      |
| `pnpm local`                                   | Runs the `api` and `worker` together from the source, reading `.env`; Ctrl-C stops both                                                                                      |
| `pnpm local:api`, `pnpm local:worker`          | Runs one of them on its own                                                                                                                                                  |
| `pnpm run build`                               | Compiles the server with `tsc` and the UI with Vite into `dist/`                                                                                                             |
| `pnpm migrate`                                 | Applies the Drizzle migrations in `src/drizzle` and creates the job queues                                                                                                   |
| `pnpm db:generate`                             | Generates a migration from a change to `src/lib/schema.ts`                                                                                                                   |
| `pnpm cli user:create <email>`                 | Creates a user, prompting for the password                                                                                                                                   |
| `pnpm cli apikey:create <name>`                | Creates an API key and prints it once                                                                                                                                        |
| `pnpm cli templates:add-built-ins`             | Adds the Wizzaroo header, footer, configuration and [built-in emails](../guide/templates.md#built-in-emails) that aren't there yet                                           |
| `pnpm cli templates:update-built-ins`          | Replaces the built-in header, footer, configuration and emails with this version's, keeping their IDs and setting their slugs                                                |
| `pnpm site:build`, `pnpm site:dev`             | Builds or serves the project website in `site/`, published to GitHub Pages                                                                                                   |
| `pnpm site:film`                               | Films the website's illustrations into `docs/images/illustrations/` (with `pnpm site:dev` running); see [Website, CI and releases](../operations/website-ci-and-releases.md) |
| `pnpm deploy:server`                           | On the server: pull, build, test, migrate and restart the stack                                                                                                              |
| `pnpm restore`                                 | Restores a backup into Postgres                                                                                                                                              |

See [CONTRIBUTING.md](../../CONTRIBUTING.md) to work on the code.
