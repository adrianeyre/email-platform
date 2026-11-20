# Mailpit is the Sandbox, not the mail server

**Status:** superseded by [ADR 0005](0005-templates-and-sending-only.md).

Mailpit was proposed as the platform's mail server, but it only captures email and cannot deliver it to real recipients. We used Mailpit solely to back a Sandbox mode, in which Messages were captured for inspection.

ADR 0005 removed the Sandbox. Mailpit now runs only in `docker-compose.dev.yml`, as the SMTP server that development Settings point at.
