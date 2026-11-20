# Postfix is the default SMTP provider

A new install could not send anything until someone signed up with a hosted provider, verified a domain with it and typed its details into Delivery. The owner wanted email to work as soon as the stack is up, while still being able to switch to a hosted provider later.

## Decision

- **Postfix runs in the Compose stack** as the `postfix` service ([`boky/postfix`](https://github.com/bokysan/docker-postfix)). It delivers each email straight to the recipient's mail server.
- **A new install's Delivery points at it:** host `postfix`, port 587, no TLS and no username. Migration `0006_default_smtp_host` sets the column default and gives an install with no SMTP host this one. It is an ordinary setting, so changing Delivery to any other provider uses that provider instead, and the app's code doesn't change.
- **Only the worker reaches it.** The service is on the Compose network and never published, so it can't be used as an open relay. It accepts mail only from the domains in `POSTFIX_SENDER_DOMAINS`.
- **Every email is DKIM-signed** with a key Postfix makes for each sender domain on first start and keeps in the `postfix-dkim` volume.
- **It can relay too.** `POSTFIX_RELAYHOST` hands mail on to a hosted provider instead of delivering it directly, without changing Delivery.

This amends [ADR 0002](0002-live-delivery-relays-through-an-upstream-provider.md) and [ADR 0003](0003-self-hosted-on-a-home-server-with-docker-compose.md): an upstream provider is now optional, not required.

## Consequences

- Delivering from a home IP is unreliable. Residential IPs are often on blocklists such as the Spamhaus PBL, their reverse DNS can't usually be set, and a changing IP breaks SPF. Gmail and Outlook may junk or refuse these emails. Switching to a hosted provider, or setting `POSTFIX_RELAYHOST`, is the fix when that matters.
- The sender domain needs SPF, DKIM and DMARC records for this server ([Sending with Postfix](../operations/sending-with-postfix.md)), and outgoing port 25 must be open.
- Bounces are seen in `docker compose logs postfix`, not in the app's log: the app logs an email as `sent` once Postfix accepts it.
- Local development and the tests still use Mailpit, so Delivery has to be pointed at it there.
