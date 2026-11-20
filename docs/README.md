# Documentation

## Getting started

- [Local setup](getting-started/local-setup.md): prerequisites, running it, sending your first email, installing the Node client from GitHub Packages, and every command.
- [Environment variables](reference/environment-variables.md): the four the app reads.

## Using it

- [Templates](guide/templates.md): the visual designer and its blocks (Socials included), light and dark previews, slugs, headers and footers, configurations and the built-in emails.
- [Sending](guide/sending.md): `POST /v1/messages` by slug, name or ID, the from address, every field, and idempotency.
- [Logs](guide/logs.md): every email sent, and how long it is kept.
- [Delivery and access](guide/delivery-and-access.md): the SMTP provider, the default from address, users, API keys and appearance.
- [Accessibility](guide/accessibility.md): WCAG 2.2 AA, and how it is checked.
- [The email client](../packages/email-client/README.md): the typed Node client.

## How it works

- [How it fits together](architecture/how-it-fits-together.md): the four roles and the life of an email.
- [Architectural decision records](architectural-decision-record/): why it is built as it is.
- [Glossary](../GLOSSARY.md): the terms used.

## Running it

- [Deploying](operations/deploying.md): first-time setup and `pnpm deploy:server`.
- [Setting up Brevo](operations/setting-up-brevo.md): an SMTP provider step by step, with its DNS records in Cloudflare.
- [Backups and restore](operations/backups-and-restore.md): nightly encrypted `pg_dump`, sent off the server.
- [Website, CI and releases](operations/website-ci-and-releases.md): the website and its illustrations, releases and the client package.
- [Search engines and icons](operations/search-engines-and-icons.md): SEO and device icons for the app and the website.
