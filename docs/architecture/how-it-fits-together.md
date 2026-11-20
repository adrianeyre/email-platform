# How it fits together

## One package, four roles

One package runs as four roles ([ADR 0004](../architectural-decision-record/0004-one-package-with-a-role-per-process.md)):

| Role      | Does                                                                                         |
| --------- | -------------------------------------------------------------------------------------------- |
| `api`     | The UI, the session-authenticated `/app` API behind it, the API-key `/v1` API and `/docs`    |
| `worker`  | Sends queued emails through SMTP with 3 retries, and deletes logs past their retention daily |
| `migrate` | Applies migrations and creates the job queues, then exits                                    |
| `cli`     | `user:create`, `apikey:create`, `templates:add-built-ins` and `templates:update-built-ins`   |

Production runs `postgres`, `migrate`, `api`, `worker` and `backup` under Docker Compose ([Deploying](../operations/deploying.md)).

## The life of an email

1. **Accepted.** `POST /v1/messages` is checked: the API key, the fields, the template (by slug, name or ID) and its required variables.
2. **Rendered.** The template's HTML, subject and text are rendered with the variables, with its header and footer around it. The from address is chosen: the request's, then the template's configuration, then the Delivery default.
3. **Queued.** The email is stored with status `queued` in the same transaction that queues its `send-message` job, and the request gets `202`.
4. **Sent.** The worker sends it through the SMTP provider and marks it `sent` with the provider's message ID.
5. **Or failed.** If the send fails, the worker records the error and retries 3 times with backoff before marking it `failed`. A permanent `5xx` refusal from the provider fails it at once. Attachments are kept only until the email is sent or has failed.

## What is stored

Everything is in the app's own Postgres: users, API keys, templates (with their designs), headers and footers, configurations, Delivery settings and the send log. The schema is `src/lib/schema.ts` and its migrations are in `src/drizzle/`. The design decisions are recorded in [the architectural decision records](../architectural-decision-record/), and the terms used in [GLOSSARY.md](../../GLOSSARY.md).
