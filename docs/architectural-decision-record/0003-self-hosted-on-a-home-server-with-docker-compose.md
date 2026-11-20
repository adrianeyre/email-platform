# Self-hosted on a home server with Docker Compose

The app runs on a single Linux home server under Docker Compose, not on managed cloud services. It's for the owner's own projects, so running cost and simplicity matter more than elastic scale. Every stateful piece is chosen so it runs in one Compose file:

- **Postgres** as a container is the only database, and it holds everything: users, API keys, templates, settings, the send log and attachments still waiting to be sent.
- **Queues are Postgres-backed jobs** (pg-boss), not a separate broker, so a job is committed in the same transaction as the Message it belongs to.
- **Nothing is exposed to the internet.** The UI and API are reached over the home network or tailnet. No router ports are opened.

A home IP can't deliver mail reliably, so email goes out through an upstream SMTP provider ([ADR 0002](0002-live-delivery-relays-through-an-upstream-provider.md)), which needs only outgoing connections.

## Consequences

- Availability is bounded by home power and broadband, so sending applications must retry on failure.
- Nightly encrypted backups of Postgres are copied off the server.
- The original cloud setup (ECS Fargate, RDS, SQS, S3, CDK) was considered and rejected for its cost and operational weight at this scale.
