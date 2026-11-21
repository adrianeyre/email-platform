# Self-hosted on a home server with Docker Compose

The app runs on a single Linux home server under Docker Compose, not on managed cloud services. It's for the owner's own projects, so running cost and simplicity matter more than elastic scale. Every stateful piece is chosen so it runs in one Compose file:

- **Postgres** as a container is the only database, and it holds everything: users, API keys, templates, settings, the send log and attachments still waiting to be sent.
- **Queues are Postgres-backed jobs** (pg-boss), not a separate broker, so a job is committed in the same transaction as the Message it belongs to.
- **Nothing is exposed to the internet.** The UI and API are reached over the home network or tailnet. No router ports are opened. Port 4320 is published on one host address, `API_BIND_ADDRESS` (the server's LAN or tailnet address; loopback when unset), never on every interface, and since a published port skips the host's `INPUT` chain, any firewalling of it goes in Docker's `DOCKER-USER` chain ([Deploying](../operations/deploying.md#the-published-port), #181).
- **The home network and the tailnet are the outside.** Nothing stands in front of the app: no reverse proxy, TLS terminator or single sign-on. Every device and container that can reach port 4320, Wizzaroo's included, is treated as untrusted, and the app's own sign-in and API Keys are the only gates. This is the boundary the [pen-test round](../product-requirements-document/pen-testing.md) probes ([ADR 0008](0008-the-email-platform-is-inside-wizzaroos-trust-boundary.md)).

A home IP can't deliver mail reliably, so email goes out through an upstream SMTP provider ([ADR 0002](0002-live-delivery-relays-through-an-upstream-provider.md)), which needs only outgoing connections.

## When plain HTTP stops being acceptable

With nothing in front of the app, the UI and API are plain `http:` on the LAN and tailnet: sessions, passwords at sign-in, API Keys and the SMTP password typed under Delivery cross them in clear. That is accepted only while every network that carries them is the owner's own: the tailnet is encrypted end to end, and the home LAN is the owner's. Pen test I3 asked for the decision's end to be recorded (#168).

The decision ends, and `APP_URL` must become `https:` with TLS in front of port 4320, at the first of these:

- the platform is reachable from anything but the owner's LAN and tailnet: a router port, a public DNS name, a tunnel, or a host on a network the owner doesn't run;
- a second school or any user who isn't the owner signs in ([ADR 0011](0011-every-user-has-full-rights-until-the-second-school.md));
- Wizzaroo, or any sending application, calls the API from outside the LAN and tailnet;
- the review date passes without this section being renewed.

Review by: 21 November 2027.

`APP_URL` must be `http:` or `https:`; the app refuses any other scheme at boot, naming it (`src/config/vars.ts`). Session cookies are `Secure` only when it is `https:` ([Environment variables](../reference/environment-variables.md)).

## Consequences

- Availability is bounded by home power and broadband, so sending applications must retry on failure.
- Nightly encrypted backups of Postgres are copied off the server.
- The original cloud setup (ECS Fargate, RDS, SQS, S3, CDK) was considered and rejected for its cost and operational weight at this scale.
