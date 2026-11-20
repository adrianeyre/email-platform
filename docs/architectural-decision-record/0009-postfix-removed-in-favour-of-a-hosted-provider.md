# Postfix removed in favour of a hosted provider

**Status:** accepted. Supersedes [ADR 0008](0008-postfix-is-the-default-smtp-provider.md); [ADR 0002](0002-live-delivery-relays-through-an-upstream-provider.md) describes delivery again.

ADR 0008 added a Postfix service and made it the default SMTP provider. In use, it didn't work:

- **The home IP was refused.** Outlook rejected the first email with `550 5.7.1 Client host [...] blocked using Spamhaus`. Residential IPs are on the Spamhaus PBL, so Gmail and others refuse them too, whatever SPF, DKIM and DMARC say.
- **Relaying hid failures.** Relaying through Brevo with `POSTFIX_RELAYHOST` delivered mail, but the app logged each email as `sent` once Postfix accepted it. A refusal from Brevo, such as an unverified sender domain, then appeared only in Postfix's log. The bounce notice went to the from address, which can't receive mail.

## Decision

- **The `postfix` service, its volumes and its `POSTFIX_*` variables are removed.**
- **Delivery sends straight to a hosted provider**, as ADR 0002 describes. [Setting up Brevo](../operations/setting-up-brevo.md) is the step-by-step guide, including DNS. Any other SMTP provider works the same way.
- **A new install has no SMTP provider** until one is set in Delivery. Migration `0007_no_default_smtp_host` drops the column default and clears `smtp_host` where it is still `postfix`, which would no longer resolve. Those sends are then refused with "No SMTP provider is configured", rather than failing to connect.

## Consequences

- A new install sends nothing until a provider is set up in Delivery.
- A provider's refusal reaches the worker, so the email is marked `failed` in the log with the reason.
- An install still pointed at `postfix` must set a provider in Delivery, ideally before deploying this change.
