# Templates and sending only

The platform had grown to about 30,000 lines across around 15 feature areas: Workspaces and roles, OIDC sign-in through Pocket ID, the SES API with SNS/SQS/S3, an SMTP relay, a Sandbox, inbound Routes, Mailing Lists, Suppressions, open and click tracking, Webhooks, Events and analytics, deliverability testing, Address Validation, send-time optimisation and Sending Domain management. What was actually needed is email templates and an API that sends emails. All of that complexity cost effort to run, secure and keep tested.

We cut the app down to that core (issues #70 to #80):

- **One install, one tenant.** Users sign in with an email and password stored as scrypt hashes in Postgres. Every user has full rights.
- **REST only.** `POST /v1/messages` with an API key. There is no SMTP relay.
- **One SMTP provider**, configured in Settings with its password encrypted. Sends are queued in pg-boss and retried 3 times.
- **Simple Templates:** subject, HTML, optional text and required variables, with no versions, locales, partials or visual builder.
- **A simple log:** one row per email, deleted after the retention period.
- **Everything in Postgres**, including attachments until they are sent. There is no content volume, so backups are a single `pg_dump`.
- **A fresh start.** The migrations were squashed into one `0000_init.sql`, and existing data was not migrated.

## Consequences

- An install that needs several isolated tenants needs several installs.
- Tracking, unsubscribe handling, bounce suppression and inbound mail, if needed, come from the SMTP provider or a future, deliberate addition.
- ADR 0001 is superseded. ADR 0002 now describes SMTP delivery.
