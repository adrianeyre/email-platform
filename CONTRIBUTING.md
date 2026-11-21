# Contributing

## Stack

TypeScript on Node 26, with Fastify and TypeBox for the API, Drizzle ORM on Postgres, pg-boss for the send queue, Nodemailer for SMTP and Handlebars for templates. The UI is React, Vite and CodeMirror, with TipTap for rich text in the visual designer. `packages/email-client` is the Node client published to GitHub Packages; it has its own `pnpm test` and builds with `tsc`. Tests use Vitest, happy-dom for the UI and Testcontainers (Postgres and Mailpit) for the integration suite.

## Setting up

Follow [Local setup](README.md#local-setup) in the README. Docker must be running for `pnpm test`, because the integration and backup tests start their own containers.

## Checks

Run these before every push. The pre-commit hook runs lint, Prettier and the tests. Every pull request runs them again in `.github/workflows/checks.yml`, with `pnpm audit` and GitHub's dependency review ([Checks every pull request](docs/operations/website-ci-and-releases.md#checks-every-pull-request)). That is the last time they run before a deploy: the server builds and runs the images and runs no check ([Deploying](docs/operations/deploying.md)).

```sh
pnpm typecheck
pnpm lint          # typescript-eslint strict, no type assertions
pnpm prettier      # or pnpm format to fix
pnpm test
```

## Commits and releases

Write commit messages and PR titles as [Conventional Commits](https://www.conventionalcommits.org), such as `feat: …`, `fix: …` or `docs: …`. On every merge to `main`, `.github/workflows/release.yml` runs semantic-release:

- `feat` makes a minor release;
- `fix` and `perf` make a patch release;
- a `BREAKING CHANGE:` footer makes a major release;
- anything else makes no release.

The release updates `CHANGELOG.md` and `package.json`, tags `v<version>` and creates the GitHub release. Don't edit those by hand.

## The website

`site/` is the project website, published to GitHub Pages by `.github/workflows/pages.yml`. `pnpm site:dev` serves it as you edit it, and `site/seo.test.ts` checks its metadata. Screenshots come from `docs/images/` and icons from `src/ui/public/`.

## Conventions

- **One PR, green checks.** Every PR keeps typecheck, lint, Prettier and tests passing.
- **Test behaviour through the API.** Prefer a case in `src/integration.test.ts` that drives the HTTP API against real Postgres and Mailpit. Write unit tests for pure logic such as rendering.
- **Schema changes** go in `src/lib/schema.ts`, followed by `pnpm db:generate --name <change>`. Never edit an applied migration.
- **Secrets** are never stored or returned in plain text. Passwords use scrypt, API keys and session tokens are stored as SHA-256 hashes, and the SMTP password is encrypted with AES-256-GCM.
- **Keep it small.** This app does templates and sending. A new feature needs a reason that fits that scope. Record big decisions as an ADR in `docs/architectural-decision-record/`.
- **Workflows** pin every action by full commit SHA with its version in a comment, set `persist-credentials: false` on every checkout, and give a write scope only to a job that installs and runs no dependency code ([Pinned actions](docs/operations/website-ci-and-releases.md#pinned-actions)). Dependabot proposes updates to the packages and the pins.
- Use the terms in [GLOSSARY.md](GLOSSARY.md).
