# Logs

Every email the app is asked to send is one row in **Logs**, newest first: those sent with an API key, the notices users are sent when a user or key is added, and each **Send a test email** from Delivery, which goes to the provider at once and is recorded as `sent` or `failed`. A notice and a test email have no Application, so only users see them. Each row records:

- when it was queued and sent;
- its from address, recipients (to, cc, bcc) and reply-to;
- its rendered subject;
- its rendered HTML and text, only while it is `queued`, and never for more than 7 days (see below);
- its status: `queued`, `sent` or `failed`;
- the number of attempts, the provider's message ID and the kind of the last failure ([Sending](sending.md#what-happens-next)), never the provider's reply itself;
- the template it came from, if any.

Search by recipient, sender or subject, filter by status, and narrow to a time range in the years 1000 to 2999; a time outside them, or a page past the last one the list can reach, is refused with `422`. Open a row to see its details and any error. A queued email also shows its HTML and text, as it will be sent.

![The Logs page: three Wizzaroo emails to ada@example.com, each sent](../images/ui/logs.png)

## The body isn't kept once an email is sent

The worker needs an email's HTML and text to send it, and to retry while the provider is down. Once the email is `sent`, or has `failed` after its last retry (a failed email is never sent again), the worker drops them, along with any attachments. The row still answers "was it sent?": who it went to, the subject, the template, the status and any error.

This matters because many emails carry a working link: a password reset, an invite, an email address check. Kept in the log, that link would let anyone who can read the log, the database or a backup use it, for as long as the row is kept. To see what an email from a template looks like, preview the template.

## Retention

A daily job (03:30 UTC) deletes emails older than **Keep logs for (days)** on the Delivery page: any whole number of days from 1 to 3,650 (ten years), 90 by default. Any user can change it, and the API refuses anything outside that range with `422`.

Whatever Retention is, no email keeps its HTML, text or attachments for more than **7 days** ([ADR 0012](../architectural-decision-record/0012-a-message-body-is-kept-at-most-seven-days.md)). A sent or failed email has already lost them; the same daily job drops them from any email still `queued` after 7 days, such as one left behind while the worker was stopped, and marks it `failed` with the error "Not sent within 7 days, so its body was dropped", so it is never sent late. So a long Retention keeps who each email went to, its subject and status, but never a working link: a reset link lives 24 hours, and none Wizzaroo sends outlives 7 days.

An email Retention deletes is still in each nightly backup taken before it went, and backups are kept `BACKUP_KEEP_DAYS` (14 by default; [Backups and restore](../operations/backups-and-restore.md)). So an email's real lifetime is Retention plus `BACKUP_KEEP_DAYS`: 104 days with the defaults. A restore doesn't bring deleted emails back: it re-applies the Retention in force now.

## The containers' own logs

The `api` and `worker` also write a line for each request and each send to their container's log (`docker compose logs api`), which Retention doesn't reach. So they keep no personal data:

- a request line keeps the path but not the query string, so a Logs search for `ada@example.com` is written as `/app/messages?[redacted]`;
- an error is written by its type, its code and its stack frames, never with the values it carried: a failed database query is `Failed query` and its Postgres error code (such as `22021`), without its SQL or parameters;
- a send is written as the email's ID and its outcome only;
- a template can't write to them: `{{log}}` renders nothing (see [Templates](templates.md)).

Docker keeps each container's log in at most three 10 MB files, and drops the oldest lines as new ones arrive; see [Deploying](../operations/deploying.md#logs).
