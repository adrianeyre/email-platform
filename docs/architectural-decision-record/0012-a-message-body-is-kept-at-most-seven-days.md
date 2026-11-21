# A Message's body is kept at most seven days

A Message keeps its rendered body (HTML and text, and its attachments) only while it is queued: the worker drops it once the Message is sent or has finally failed (#116). Retention, which any User may set from 1 to 3,650 days, decides how long the rest of the row is kept. Pen test D2 found the range recorded nowhere, and that a body kept while a Message is queued would last as long as Retention says (#147). A Message stays queued only while the worker hasn't finished with it: three retries with backoff take minutes, but a stopped worker or a lost job leaves it queued, body and working link included, for as long as the worker is down, up to Retention's ten years.

## Decision

- **A Message's body is kept at most seven days, whatever Retention is.** The daily Retention job also drops the body and attachments of every Message more than seven days old (`messageBodyMaxDays` in `src/sending/retention.ts`). One still queued is marked `failed`, with an error saying it wasn't sent within seven days, so it is never sent late: a reset link is good for 24 hours and an Invite's for days, so a week-old account email is of no use to its recipient.
- **Retention is 1 to 3,650 days, 90 by default.** The range is documented ([Logs](../guide/logs.md#retention), [Delivery and access](../guide/delivery-and-access.md)) and is what `PUT /app/settings` accepts. Long Retention keeps recipients, subjects, statuses and errors, not links. Any User may change it ([ADR 0011](0011-every-user-has-full-rights-until-the-second-school.md)).

## Consequences

- A link can be in the log for at most seven days after its Message was asked for, and in a nightly backup for seven days plus the backups' own life.
- A Message the worker hasn't reached in seven days fails rather than sends. If the worker was down that long, sends must be asked for again.
- Seven days is longer than any account link Wizzaroo sends lives. Shortening it is a one-constant change.
- Considered and rejected: flagging Templates or Messages as credential-bearing and bounding only those. Every Message's body is already dropped on sending, so a flag would add a choice a User could get wrong for no gain.
