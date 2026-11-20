# Delivery relays through an upstream SMTP provider

**Status:** amended by [ADR 0008](0008-postfix-is-the-default-smtp-provider.md): a new install sends through its own Postfix service, and an upstream provider is optional.

We don't run our own mail transfer agent. Emails go to an upstream provider over SMTP. Running our own MTA would mean warming up IPs, monitoring blocklists, processing feedback loops and running high-availability SMTP egress ourselves.

Delivery originally used the Amazon SES API. [ADR 0005](0005-templates-and-sending-only.md) replaced that with plain SMTP to a single provider configured in Settings, so any provider works, including SES through its SMTP endpoint.

## Consequences

- Templates, logs and the API belong to us and don't depend on the provider.
- DKIM, SPF and DMARC are set up with the provider, not in this app.
- Bounces and complaints are visible at the provider, not in this app's logs.
