# PRD: Pen-testing the email platform

**Status:** Round open, v0.7 (21 November 2026): the enablement issues E1-E5 are delivered, and every scope issue (A1, A2, K1, B1, S1-S3, D1-D3 and I1-I6) is probed, with its verdict below: 70 findings filed (#113-#157 and #162-#186) and one fix (#158). Pull requests are checked in CI (#109), the request-rate figures are set (I2b), and these findings are fixed: #113, #114, #115, #116, #117, #118, #119, #120, #121, #122, #123, #124, #125, #126, #127, #128, #129, #130, #131, #132, #133, #134, #135, #136, #137, #138, #139, #140, #141, #142, #143, #144, #145, #146, #147, #148, #149, #150, #151, #152, #153, #154, #155, #156, #157, #162, #163, #164, #165, #166, #167, #168, #169, #170, #171, #172, #173, #174, #175, #176, #177, #178, #179, #180, #181, #182, #183, #184, #185 and #186 (fixed, unverified until their probes are run again on the pen-test deployment). The rules of engagement, statement of work, credentials package and fixtures are in [`docs/pen-test/`](../pen-test/README.md), not in this file.
**Date:** 20 November 2026
**Owner:** Adi
**Label:** `prd:pen-test`

This file is the brief. Decisions stay in [`docs/architectural-decision-record/`](../architectural-decision-record/), and how the platform works stays in [`docs/`](../README.md). Capitalised terms (User, API Key, Application, Template, Message, Settings…) are used exactly as [`GLOSSARY.md`](../../GLOSSARY.md) defines them. Nothing here restates a product rule; a tester who needs one reads it there.

> **Keep this file private.** The opening register below names files, lines and exploit chains. It must not be published, and this repository must not be made public, while any hypothesis or finding here at `severity:high` or `severity:critical` is open. `site/` and GitHub Pages publish `docs/images` only; nothing under `docs/pen-test/` or this file may be added to them.

---

## Terms used in this file

These are words about the engagement, not about the platform, so they live here and not in the glossary. They mean what they mean in [Wizzaroo's pen-testing PRD](https://github.com/adrianeyre/temp/blob/main/docs/product-requirements-document/pen-testing.md), so the two rounds read alike.

| Term                    | Meaning                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Round**               | One pen-test engagement: a window, a scope, a set of findings and a sign-off. This file describes the first.                                  |
| **Hypothesis**          | An entry in the opening register (H1, H2…): what the code reads like from outside, with the file that has to be disproved. Not yet a finding. |
| **Scope issue**         | A GitHub issue under `prd:pen-test` that partitions the surface (E1, A1, K1…) and lists what to probe there.                                  |
| **Finding**             | A confirmed weakness, filed as its own issue with one `severity:*` label and a pointer to its scope issue.                                    |
| **Verdict**             | What the round concluded about a hypothesis: confirmed (and filed as a finding), refuted, or confirmed as a documented decision.              |
| **Pen-test deployment** | The dedicated Compose stack the round runs against. Never the production instance.                                                            |

---

## Current state of play

The platform is one Fastify process serving a React UI, the `/v1` REST API and its OpenAPI page, with a pg-boss worker sending through one upstream SMTP provider, and Postgres behind both, all in Docker Compose on the home server ([ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md), [ADR 0004](../architectural-decision-record/0004-one-package-with-a-role-per-process.md)). It is reached over the home network and the tailnet, with nothing in front of it: no reverse proxy, no TLS terminator and no single sign-on. Its own sign-in and its API Keys are the only gates between the LAN and the data.

What is built and so in scope ([ADR 0005](../architectural-decision-record/0005-templates-and-sending-only.md)):

- **Users:** email and password (scrypt), a 30-day session cookie, a sign-in throttle, and Users who can add and delete each other. One tenant: every User has full rights. There is no second factor.
- **API Keys:** `ek_…` bearer tokens, shown once and stored hashed, each of which can call every `/v1` route.
- **Sending:** `POST /v1/messages` by Template slug, name or id, with to, cc, bcc, reply-to, from and attachments; the `Idempotency-Key` header; the queue and its three retries; test sends from the UI.
- **Templates:** Handlebars subject, HTML and text; the visual designer and its Blocks; Headers, Footers and Configurations ([ADR 0006](../architectural-decision-record/0006-visual-designer-keeps-a-design-beside-the-html.md), [ADR 0007](../architectural-decision-record/0007-headers-and-footers-are-added-when-sending.md)); the 15 Built-in emails.
- **Settings:** the SMTP provider, its password sealed with `ENCRYPTION_KEY`, the default from address and Retention.
- **The log:** one row per Message with its rendered subject and bodies, searchable, deleted after Retention.
- **Operations:** nightly age-encrypted `pg_dump`s sent with rclone, `pnpm deploy:server` run on the server, and the GitHub Actions that build the website, cut releases and publish `@adrianeyre/email-client`.

**Wizzaroo sends every account email through this platform.** Its password resets, Invites, email address checks and passkey notices are rendered here, and the log keeps the rendered body, working link included, for Retention's 90 days by default. So the platform sits inside Wizzaroo's trust boundary ([ADR 0008](../architectural-decision-record/0008-the-email-platform-is-inside-wizzaroos-trust-boundary.md)): a reader of its log, its database or its backups holds a way into Wizzaroo adults' accounts, staff included.

**Nothing in this tree has ever been probed by anyone who did not write it.** Wizzaroo's own round ran against a stand-in for this platform, not the platform itself.

---

## Problem statement

**Before Wizzaroo adds a second School, and before any Application other than Wizzaroo is given an API Key, someone working against the platform rather than for it must probe this tree against a platform-shaped scope and file what they find, so the owner can sign off that the platform does not hand out Wizzaroo's accounts, or send as anyone it likes, on evidence rather than on the care of whoever built it.**

Three reasons to do it now:

1. **Its log is a box of keys.** Every live reset and Invite link Wizzaroo sends is kept here. Wizzaroo's second School brings other people's children's data behind those links.
2. **The surface is small.** About 40 routes, six migrations and one Compose file. This is the cheapest the round will ever be.
3. **One credential is everything.** A User can do anything, and an API Key can rewrite the very Templates that carry Wizzaroo's reset links. There is no second wall to fall back on.

---

## Engagement shape

- **Who runs it:** this round is run by the owner and by agents (Sandcastle) working each scope issue against this file. Anything only the owner can do carries `owner`. **A second round by an external tester is a pre-condition of the gate** (see [the pre-condition](#pre-condition-an-external-round-before-the-gate)).
- **Type: grey-box.** Testers get read-only source, the pen-test deployment's URL, one fixture User per role in E2's fixtures, and the fixture API Keys. They do **not** get `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, any SMTP password, the rclone configuration, the age identity, the GitHub token or write access to the repository. Finding any of those anyway is itself a finding.
- **Target: a dedicated pen-test deployment.** Its own Compose project, Postgres volume and `.env`, reachable only by the testers. Never the production instance on the home server, not even its `/health`. Teardown destroys the volume, not just the containers.
- **No email leaves it.** The SMTP provider is a Mailpit sink on an internal network, and no network in the deployment has a way out. Backups go to throwaway rclone targets. Never the real provider, the real remote or the real age key.
- **Data: synthetic only,** generated by a seed script that ships with the deployment (E2). The Wizzaroo links in seeded Messages are shaped like real ones and lead nowhere.
- **Rules of engagement** (E3) are codified before the window opens: the window in dates, the in-scope host, no destructive testing outside the pen-test deployment, an out-of-band channel for a critical finding, and the remediation targets below.

### Explicitly out of scope

- **SMTP providers (Amazon SES, Postmark, Fastmail…), GitHub, GitHub Pages and GitHub Packages as platforms.** How the platform _uses_ them (the SMTP host, TLS and credentials, the publish workflow's token, what the site copies) is in scope; the platforms themselves are not.
- **Denial of service and volume testing.** A missing limit is in scope as a finding, worked out by arithmetic; exercising it is not.
- **Social engineering, phishing, and physical access** to the home server or the backup remote.
- **The production instance** and its data, and the home network and tailnet beyond the pen-test deployment.
- **Wizzaroo itself.** Its round is its own. What Wizzaroo sends here, and what a reader here can do with it, is in scope.
- **The public website** (`site/`), except for what it publishes from the repository.

---

## The tester's opening register

This is the reconnaissance a tester would do on day one, done in advance so the round starts from hypotheses rather than from a directory listing. **Each entry is a hypothesis, not a confirmed finding.** It says what the code reads like from outside and names the file that has to be disproved. Where a behaviour is deliberate and documented, that is said plainly; a documented decision is still a finding when nothing records when it has to stop being true.

Severities are the **opening** estimate, for triage order only. File and line references are as of commit `0e75431`. "Carried over" names a finding from Wizzaroo's round whose other side lives here.

### H1: The sign-in throttle trusts a header anyone can send · high

`buildHttpServer` sets `trustProxy: true` with no named proxy (`src/api/http-server.ts:91`), so `request.ip` is the left-most `X-Forwarded-For` a caller sends. The sign-in throttle keys on `request.ip` and the email together (`src/access/access-routes.ts:68`), allows 10 failures per 15 minutes, and lives in one process's memory with no bound on its map (`:24-43`). So:

- a fresh `X-Forwarded-For` on each try resets the key, and password guessing against one User is bounded only by scrypt;
- one password sprayed across many emails is never throttled, whatever the header;
- there is no second factor ([ADR 0005](../architectural-decision-record/0005-templates-and-sending-only.md)), so a guessed password is the whole account, and with H5 the whole platform.

The platform has no proxy in front of it, so nothing legitimate ever sets `X-Forwarded-For`. Probe the throttle with and without the header, the sign-in body's unbounded `password` against scrypt (`access-routes.ts:50-53`, the 36 MB `bodyLimit`), and the arithmetic for one account and for a spray.

Carried over: Wizzaroo #246 and #332.

> **Verdict, first round (A1 #92, 20 November 2026):** confirmed (high). trustProxy: true makes request.ip whatever X-Forwarded-For a caller sends; a fresh header per try gets 11 wrong passwords through as 401s, and the right password past a block (#114). Without the header the throttle works (10 × 401, then 429). A spray is never throttled (#122). scrypt is the only bound, at an eighth of OWASP's minimum cost (#140): about 187 guesses/s measured, so a 1 million password list against one account takes about 89 minutes (5.9 hours on a CPU four times slower). The throttle is lost on restart (#142), its map never forgets a key (#123), and sign-in fields are unbounded (#141). Refusals don't tell an email with an account from one without (status, body, length and timing match).
>
> **Verdict, first round (I2a #103, 21 November 2026):** confirmed, and quantified. 101 wrong passwords for one User from one address: 10 × 401, then 91 × 429 that run no scrypt. 101 emails from one address: 101 × 401, 46 scrypts a second one at a time (#122). 101 wrong passwords for one User, each from its own socket address and no header: 101 × 401, because nothing counts per account, so 1,000 addresses guess 960,000 a day at one User, and that stays true once #114 is fixed (#163, medium). request.ip follows X-Forwarded-For on every route, the request log's remoteAddress included, so the only sound key is the socket's address with trustProxy false (#114). The 429 carries no Retry-After. The proposed per-IP and per-account figures are in docs/pen-test/findings/I2a.md, "Numbers for I2b".
>
> **Fixed, unverified (21 November 2026):** H1's header half. `trustProxy` is `false`, so the throttle keys on the socket's address and a fresh `X-Forwarded-For` no longer resets it (#114). The spray (#122) and the map's growth (#123) are fixed below; the per-address count (#163), the restart (#142) and scrypt's cost (#140) are still open; the figures that will close them are set in [the request-rate pre-condition](#pre-condition-the-request-rate-policy-before-the-gate).

> **Fixed, unverified (21 November 2026, third pull request):** sign-in has the policy's per-IP limit: a burst of 10 tries from one socket address, whatever emails they name, refilling one every 30 seconds and capped at 30 in any 15 minutes, so a spray is refused by its 11th try (#122). Both sign-in throttles forget a key once its window passes, hold at most 10,000 keys (a new key is refused while they are full), and the sign-in email is limited to 320 characters (#123). Every limit now refuses with one `429` body, `too_many_requests`, and `Retry-After`. The per-account count in Postgres (#163), the restart (#142) and scrypt's cost (#140) are still open.

> **Fixed, unverified (21 November 2026, fourth pull request):** both sign-in throttles and the step-up throttle keep their counts in Postgres (`throttle_keys`), so a restart or a second api process no longer resets them (#142); the 10,000-key cap that guarded the api's memory is gone. Passwords are hashed with scrypt at N=2^17, r=8, p=1, and a cheaper hash is re-hashed at the User's next sign-in (#140). A password longer than 1,024 characters is refused with `422` before hashing, and `/auth` takes a body of at most 16 KiB (#141). The per-account count (#163) is still open.

> **Fixed, unverified (21 November 2026, fifth pull request):** failed sign-ins are counted per account, on the normalised email alone, across every address and whether or not the email has an account: the 11th wrong password in 15 minutes is refused with the same `429` from any address, the right one included (#163). The count replaces the per-address-and-email one; the per-address limit (#122) is unchanged.

### H2: The log keeps every Wizzaroo account link, readable by every User · high

`acceptMessage` stores the fully rendered `html` and `text` of every Message (`src/sending/accept-message.ts:246-257`, `src/lib/schema.ts:161-162`), and `GET /app/messages/:id` returns both to any signed-in User (`src/sending/message-routes.ts:203-214`). Wizzaroo's Built-in emails carry `resetUrl`, `inviteUrl`, `confirmationUrl` and `parentPageUrl` ([Templates guide](../guide/templates.md#built-in-emails)), so each link sits in the log, working, until Wizzaroo expires it, and stays in the row for Retention: 90 days by default, any User can set 1 to 3,650 (`src/settings/settings-routes.ts:46-48`), then 14 more nights in each backup (H12).

Probe: for every Built-in email, whether the link in the stored body is the live credential; who can read it, through the UI, `GET /v1/messages/:id`, the database and a backup; and how long it outlives the token it carries. The question for the verdict is whether the platform needs to keep a body at all after it is sent.

> **Verdict, first round (D2 #100, D3 #101, 20 November 2026):** confirmed. The stored html and text hold each Built-in's link byte for byte, the same credential Wizzaroo sent and the addressee received; four of the six linked Built-ins (confirm, reset, both Invites) carry one-use credentials. Every User reads it through GET /app/messages/:id, and so does the database login (D1); GET /v1/messages/:id gives neither key a body. Every backup holds it, and a restore brings it back (D3). It outlives a 24-hour link by 89 days at the default Retention and up to 3,649 at the 3,650 maximum any User can set, plus up to 14 nights in backups. Nothing reads the body after sending except the Logs page, so the platform doesn't need to keep it (#116, high; #147).
>
> **Fixed, unverified (21 November 2026):** a sent or finally failed Message keeps no html or text, so the log, the database and new backups hold no working link once it is sent; migration 0006 drops the bodies already kept (#116). A queued Message keeps its body until the worker sends it. Retention's 3,650-day maximum (#147) is still open; restores of older backups (#130) are fixed under H12.

> **Fixed, unverified (21 November 2026, fourth pull request):** whatever Retention is, Retention drops the html, text and attachments of every Message older than seven days and fails one still queued, so no working link outlives a week, and a restore does the same. The Retention range, 1 to 3,650 days, is documented and recorded as a decision ([ADR 0012](../architectural-decision-record/0012-a-message-body-is-kept-at-most-seven-days.md); #147).

### H3: An API Key can do everything the `/v1` API can · high

One `onRequest` hook checks that a key is valid (`src/api/http-server.ts:171-182`); nothing checks what it is for. Every API Key can:

- send from any `from` (`message-routes.ts:20-27`, `accept-message.ts:220-223`), so a leaked key sends as `no-reply@wizzaroo…` or anything else the SMTP provider will relay;
- create, replace and delete Templates, Headers and Footers (`src/templates/template-routes.ts:226-389`, `src/templates/part-routes.ts:170-272`), so a leaked key rewrites `wizzaroo-reset-your-password` to send every future reset link to a server of its own choosing as well;
- read any Message by id, whichever Application sent it (`message-routes.ts:127-138`).

Keys never expire and belong to no Application or User (`src/lib/schema.ts:47-54`). Probe each power with each fixture key, and what the platform records about which key did what.

> **Verdict, first round (K1 #94, 20 November 2026):** confirmed. ADR 0005/0008 leave keys unscoped until the round's findings say otherwise, with an end condition (no second Application gets a key before both rounds close) but no date. The second app's key sends from Wizzaroo's no-reply address and from addresses no one configured, and Mailpit receives them (#117). It replaces wizzaroo-reset-your-password so Wizzaroo's next reset email also hands its working link to a server the key holder chose, and it deletes the Header all 15 Built-ins use without a word (#113, critical). It reads any Wizzaroo Message's recipient, subject and status by id (#118). Nothing records which key sent or changed anything (#132). Refuted: the deleted key, and a key deleted mid-session, are refused on all 25 /v1 routes at once; key entropy (192 bits), storage (SHA-256 only), constant-time comparison and show-once are sound.
>
> **Fixed, unverified (21 November 2026):** every API Key belongs to an Application ([ADR 0009](../architectural-decision-record/0009-api-keys-belong-to-an-application.md)). A key changes and deletes only its Application's Templates, Headers and Footers (#113), sends only from its Application's Configurations' addresses or the default from address (#117), reads only its Application's Messages (#118), and its Idempotency-Keys are its Application's alone (#119, #120). A Message records the key that sent it; a change to a Template, Header or Footer records its key or User since #132 (below).

> **Fixed, unverified (21 November 2026, third pull request):** each Template, Header and Footer records the API Key or the User that last made or replaced it, and the `/v1` request log names the key (#132). The record keeps the last change, not a history.

### H4: Every container connects as the Postgres superuser · high

`docker-compose.yml` creates the database with `POSTGRES_USER: email_platform`, which the official image makes a superuser, and `api`, `worker`, `migrate`, `backup` and `restore` all log in as it (`docker-compose.yml:8,27,82,105`). There is no row-level security and no second role. Any SQL a bug lets through, or anyone holding `POSTGRES_PASSWORD`, can read every table, run `COPY … PROGRAM` in the `postgres` container, and turn off whatever a later fix adds. The backup container holds the same password on a network with a way out.

Probe: with the app's own connection string, what can't a tester do? Carried over: Wizzaroo #273 and #279.

> **Verdict, first round (D1 #99, 20 November 2026):** confirmed. The app's connection has rolsuper, rolbypassrls and rolcreaterole; it reads and can drop every table in public, pgboss and drizzle, runs shell commands in the postgres container as uid 70 via COPY … FROM PROGRAM, creates login roles and reads pg_authid (#121). Refuted: that program can't read POSTGRES_PASSWORD (the entrypoint keeps it out of the server's environment). No steerable query: the log search escapes and binds, ordering is fixed, the slug like sees only [a-z0-9-]; odd log filters reach Postgres as a 500 (#157). Six services hold POSTGRES_PASSWORD as one role (#138); five sit on the non-internal default network, migrate included (#139). The least-privilege role per container is proposed in D1.md section 4 and filed as a fix (#158).

> **Fixed, unverified (21 November 2026, third pull request):** no container but `postgres` and the one-shot `provision` logs in as the superuser. api, worker, migrate (and restore) and backup each log in as a role of their own with its own password; none can run `COPY … PROGRAM`, make a role or read `pg_authid`, and only migrate can change the schema ([ADR 0010](../architectural-decision-record/0010-each-container-logs-in-as-a-least-privilege-postgres-role.md); #121, and #138 with it). migrate still sits on a network with a way out (#139).

> **Fixed, unverified (21 November 2026, fourth pull request):** migrate is on the internal `database` network alone, with no way out; no holder of the superuser password has one (#139).

> **Fixed, unverified (21 November 2026, fifth pull request):** the Logs list's `page` has a maximum and `after`/`before` must be dates in the years 1000-2999, so odd filters are refused by the schema with `422` before any query (#157).

### H5: One User is every User · medium

Any User can add Users, delete any other User, mint API Keys, change Settings and Retention and read every log (`src/access/access-routes.ts:116-192`, `src/settings/settings-routes.ts`); that is [ADR 0005](../architectural-decision-record/0005-templates-and-sending-only.md)'s "every User has full rights", and nothing records when it has to stop being true. Separately:

- changing a password ends no other session (`src/access/users.ts:98-119`);
- a session lasts a fixed 30 days with no idle timeout, and expired ones are swept only when a new one is made (`users.ts:139-181`);
- nothing records who made a User or an API Key, or tells the other Users;
- `POST /app/users` tells a User which emails have accounts (`users.ts:61-63`).

Probe the takeover chain from one stolen session: what it can make that survives the real owner changing their password. Carried over: Wizzaroo #244, #245 and #239.

> **Verdict, first round (A1 #92, A2 #93, 20 November 2026):** confirmed (medium; its takeover chain is high). Changing a password ends no other session (#124); no idle timeout (#143); 30-day expiry, sign-out and a deleted User's sessions hold. One stolen session adds a User, mints a key, deletes the colleague and sets Retention to 10 years with no step-up, all surviving a password change (#115). Nothing records who made a User or key, and nobody is told (#125). The self-delete guard is bypassed with an upper-case id, which can leave no User (#145). ADR 0005's full rights is a documented decision with no recorded end (#146). POST /app/users naming existing emails is refuted as a disclosure: only a signed-in User sees it, and they can list every User anyway. A NUL byte in an email answers 500 (#144).
>
> **Fixed, unverified (21 November 2026):** adding a User, minting an API Key and deleting a User ask for the current password (step-up), with wrong tries throttled per User (#115); changing a password ends every other session of that User (#124). #125 is fixed below; #143, #145 and #146 are still open.

> **Fixed, unverified (21 November 2026, third pull request):** each User and API Key records the User who made it, shown under Users and API keys, and every other User is emailed when a User is added or deleted or an API Key minted (#125). #143, #145 and #146 are still open.

> **Fixed, unverified (21 November 2026, fourth pull request):** a session unused for 7 days is refused, within the 30-day maximum (#143). The self-delete guard compares ids in lower case (#145). A new User's email is at most 254 characters and a NUL byte in an email is refused with `422` (#144). [ADR 0011](../architectural-decision-record/0011-every-user-has-full-rights-until-the-second-school.md) ends "every User has full rights" before Wizzaroo's second School or a second Application's API Key, with a review by 21 May 2027 (#146).

### H6: A User can point the SMTP provider anywhere · medium

`smtpHost` is any string and `smtpPort` any port (`settings-routes.ts:32-50`), and `POST /app/settings/test` connects at once and answers with the error text (`:97-102`). The `api` container sits on the internal `database` network as well as `default` (`docker-compose.yml:12-14`), so:

- the test is a port scanner and banner grabber for anything the `api` container can reach, `postgres:5432` included;
- a User who points the host at their own server receives the SMTP username and the decrypted password in the AUTH exchange, without ever being shown it;
- `smtpSecure: false` on 587 leaves STARTTLS opportunistic (`src/sending/delivery.ts:32-42`), so a network in the middle strips it and reads the same AUTH.

Probe each, and whether changing the host keeps the stored password. Carried over: Wizzaroo #307, whose sending side this is.

> **Verdict, first round (I5 #107, 21 November 2026):** confirmed, with one part refuted. `POST /app/settings/test` is a port scanner and banner grabber: pointed at each internal address it tells a closed port (`ECONNREFUSED`, with the container IP), an open held port (`Greeting never received`), an open non-SMTP port (`Timeout`/`Connection closed`) and a non-SMTP banner (returned verbatim) apart, `postgres:5432` included, which no User can otherwise reach (#184). A User changes only the host, leaves the saved password (the write-only one the UI never shows), runs the test, and the stored SMTP username and password reach a server they chose in the AUTH exchange (#185). With `smtpSecure: false`, a relay that strips STARTTLS makes the worker send AUTH in the clear (#186); nothing sets `requireTLS`. Refuted: certificates _are_ verified once TLS is reached — a self-signed certificate is refused on the STARTTLS upgrade and on implicit TLS — so the gap is that nothing requires TLS, not that it is unchecked. The SMTP reply reaching `messages.error`, read by the sender and every User, is cited to S1, K1 (#118) and S2 (#119).

> **Fixed, unverified (21 November 2026, sixth pull request):** the test send answers success, or one `502 smtp_failed` naming only the failure's class: "refused" with the reply and status code but never the reply's text, or "could not be reached", which covers a closed port, a name that won't resolve, a timeout, a TLS failure and a greeting that isn't SMTP's alike, so it no longer tells a closed port from a held one, gives no container address and grabs no banner (#184). What it can't hide is that a working SMTP server takes the test email, and that a held-open port takes the timeout to answer; probe 5's `it.fails` stays, with a `today_` pinning that. Changing the host or the port while keeping a saved SMTP password is refused with `422` until the password is entered again (#185). Whenever a username is set the worker and the test send require STARTTLS (`requireTLS`), so a stripped STARTTLS fails the send before AUTH; with no username, as against Mailpit, it stays opportunistic (#186).

### H7: An Idempotency-Key belongs to no one · medium

`messages.idempotency_key` is unique across the whole table (`src/lib/schema.ts:170`) and bound to neither the API Key nor the payload. A repeated key returns the first Message's summary, recipients, from, subject, status and error included (`accept-message.ts:196-217,274-281`, `message-routes.ts:73-88`). So one Application that guesses or reuses another's key reads that Message's summary, and one that sends first with a key the other will use stops the other's send without a word. Probe both, and the same key with a different body.

> **Verdict, first round (S2 #97, 20 November 2026):** confirmed. secondApp repeating a key wizzaroo used gets 200 and Wizzaroo's Message summary (recipients, subject, from, status, SMTP error), and Wizzaroo's keys follow a guessable pattern; no body, so no link (#119, high). If secondApp uses the key first, Wizzaroo's reset gets 200 and is never stored or sent (#120, high). The same key with a different or invalid body gets 200 and the first Message (#135). Refuted: the race (one 202, one 200, one row) and reuse after Retention (a key lasts as long as its Message, 90 days by default; the guide should say so). Raised above the opening medium under the table's "one Application reading another's Messages".
>
> **Fixed, unverified (21 November 2026):** an Idempotency-Key is unique within its sender's Application, so another Application's key neither returns its Message (#119) nor stops its send (#120) (ADR 0009). The same key with a different body is refused since #135 (below).

> **Fixed, unverified (21 November 2026, third pull request):** an Idempotency-Key is bound to its request: the same key with a different body is refused with `409` (`idempotency_key_reused`). A Message stored before the change has no fingerprint, so a repeat of its key still answers the first Message (#135).

### H8: Addresses, names and filenames are free text · medium

`to`, `cc`, `bcc`, `replyTo` and `from` are strings of 3 to 320 characters with no format check (`message-routes.ts:14,20-31`); attachment `filename` and `contentType` are free text with no count limit (`accept-message.ts:67-88,232-244`); `subject` is up to 998 characters, rendered with Handlebars without escaping (`src/templates/render.ts:57`). Probe:

- CR and LF in `subject`, `from`, a Configuration's from name, and a `filename`, for header injection through Nodemailer;
- one `to` entry holding `"a@x, b@y, …"`, and whether Nodemailer sends to all of them past the 50-recipient cap and the Message's stored recipients;
- a `from` naming a display name and address the owner never configured.

Carried over: Wizzaroo #321 (names reaching an email verbatim) and #322 (an address Nodemailer delivers elsewhere), whose receiving side this is.

> **Verdict, first round (S1 #96, 20 November 2026):** confirmed in part. Header injection refuted: CR/LF in subject (raw or via a variable), from, replyTo, a Configuration's from name and a filename add no header; Nodemailer 10.6.0 folds, strips or encodes them, and formatFromAddress folds the from name. That defence is Nodemailer's alone: the platform stores CR/LF and accepts with 202 input that can only fail at the worker. One to entry holding a list or group is delivered to every address while the Message stores one entry; 50 entries reached 100 recipients, about 3,300 per request by arithmetic against a documented 150 (#134). The unconfigured from is confirmed and filed under K1. Attachments have no count, length or type limit; 16,384 answer 500 (#150); the 25 MB limit holds (413). NUL in any field answers 500 (#151), and a rendered subject has no length limit (#152).

> **Fixed, unverified (21 November 2026, third pull request):** each `to`, `cc` and `bcc` entry must be exactly one mailbox: a list, a group or a control character is refused with `422`, so the recipient cap and the log describe the envelope (#134). #150, #151 and #152 are still open.

> **Fixed, unverified (21 November 2026, fourth pull request):** a NUL byte in any body field or header is refused with `422` naming it, before any query (#151). A Message has at most 100 attachments, each filename and contentType at most 255 characters and the contentType one MIME type (#150). A Template's rendered subject is held to 998 characters (#152).

### H9: HTTP hardening is absent, and the port is wider than the ADR says · medium

- No security headers: no content security policy, frame protection, HSTS, `nosniff` or referrer policy (no helmet, nothing in `src/api/http-server.ts`), so a page on the LAN can frame the signed-in UI's Users and API Keys pages.
- The session cookie is `Secure` only when `APP_URL` is `https:` (`access-routes.ts:62,95`), and the documented example is `http://email.home:4320` (`docker-compose.yml:10`), so on the LAN the cookie and every password cross in clear.
- The cookie has no `__Host-` prefix and is `SameSite=Lax`; every other service on the same host name is the same site.
- `api` publishes `4320:4320` on every host interface (`docker-compose.yml:58-59`), and Docker's published ports pass a host firewall's `INPUT` rules, while [ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md) says LAN and tailnet only.
- `bodyLimit` is 36 MB on every route, sign-in and the `/app` routes included (`http-server.ts:50,90`).

Probe the headers and the cookie at the pen-test deployment's origin, and from where the published port answers. Carried over: Wizzaroo #311, #312, #247 and #248.

> **Verdict, first round (I1 #102, 21 November 2026):** confirmed for the headers, the cookie and the body limit. No response on the UI, /v1, /app, /auth, /docs or /health sends a CSP, X-Frame-Options, nosniff, a referrer policy or (on https:) HSTS; in Chrome a page on another port of the same host frames the signed-in Users and API Keys pages with the session, and one on another LAN host frames them signed out only because SameSite=Lax withholds the cookie (#170). The cookie is session, HttpOnly, Lax, Path=/, 30 days, Secure only on an https: APP_URL, as documented under ADR 0003's no-TLS decision, which has no recorded end (#168, I3's). Any other port on the host name receives the session with every request, can plant one that replaces it (the UI then runs as that User), and can sign the User out with a text/plain form; no /app route takes a form body, and a JSON fetch fails its preflight (#171). Every route reads and parses 36 MB: sign-in and the bodiless sign-out with no credential, a bodiless /app DELETE once signed in, and every 413 cites the 25 MB message limit (#172; the password itself is #141). X-Forwarded-Proto and -Host change neither the cookie nor the API document's origin.
>
> **Verdict, first round (I4 #106, 21 November 2026) — the published port:** confirmed. `api` publishes `4320:4320` with no `host_ip`, so Docker binds every interface; a stand-in published port answered on `127.0.0.1`, both LAN addresses and `[::1]`, while the E1 deployment's `127.0.0.1:43320` answered only on loopback. A host firewall's `INPUT`/ufw DROP rule does not stop it — a published port is DNAT'd through `PREROUTING`/`DOCKER` and `FORWARD`/`DOCKER-USER`, not `INPUT` (reproduced in Docker-in-Docker; only a `DOCKER-USER` rule stopped it) — so the port is wider than ADR 0003's "LAN and tailnet only" and the obvious firewalling leaves it open (#181). The headers, cookie and `bodyLimit` are I1's (#102).

> **Fixed, unverified (21 November 2026, fifth pull request):** every response, the UI, static files, `/v1`, `/app`, `/auth`, `/docs` and `/health` included, sends a `Content-Security-Policy` (`default-src 'self'`, scripts by hash, images and fonts from `'self'` and `data:` only, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Cross-Origin-Opener-Policy: same-origin`, and an `https:` `APP_URL` adds `Strict-Transport-Security: max-age=31536000`; Chrome no longer frames `/users` or `/api-keys` from another origin (#170). On an `https:` `APP_URL` the session cookie is `__Host-session`, `Secure`, so no subdomain or plain-HTTP service on another port can plant one, and sign-out refuses a request whose `Origin` isn't `APP_URL`'s with `403` (#171). A browser still sends the cookie to every port of the host name, which no code can stop: the deployment guide now requires a host name of the platform's own. The 36 MB body (#172), the port (#181) and the cookie's `Secure` on `http:` are still open.

> **Fixed, unverified (21 November 2026, sixth pull request):** every route takes at most 16 KiB unless it carries a Message or a Template (`POST /v1/messages`, the Template, Header and Footer saves, preview and the Template test send), which take 36 MB; a route that takes no body refuses one with `413` before reading it; and each `413` is `request_too_large`, naming that route's own limit (#172). `api` publishes 4320 on one host address, `API_BIND_ADDRESS`, loopback unless set, and the deployment guide says a published port skips `INPUT`/ufw and is filtered in `DOCKER-USER` (#181). The cookie's `Secure` on `http:` is still open.

### H10: Configuration accepts a development secret · medium

`ENCRYPTION_KEY` must decode to 32 bytes (`src/config/vars.ts:53-61`), and `.env.example`'s `BwcHBwc…` does, so a production `.env` copied from the example starts and seals the SMTP password with a key in the repository. Nothing checks `POSTGRES_PASSWORD`'s strength or refuses an `http:` `APP_URL` outside development. Missing variables fail closed, which is good and to be confirmed (`vars.ts:16-22`, `docker-compose.yml`'s `:?`). Probe: unset, then weaken, each variable in turn; a warning alone is a fail. Carried over: Wizzaroo #306 and #308.

> **Verdict, first round (I3 #105, 21 November 2026):** confirmed, with no warning in any case. Missing variables do fail closed: every role exits 1 naming an unset or empty DATABASE_URL, APP_URL or ENCRYPTION_KEY, and Compose's :? names each of its six. But migrate, api and worker start with .env.example's ENCRYPTION_KEY (or any 32-byte key, all zeros included) and seal the SMTP password with it (#165); a one-character or whitespace POSTGRES_PASSWORD passes Compose and starts Postgres and the app (#166); a changed ENCRYPTION_KEY starts cleanly, then fails every Message, answers the test send with a 500 and leaves Delivery saying the password is saved, with no rotation path (#167); an http: (or any-scheme) APP_URL starts, as ADR 0003 decides, with no expiry recorded (#168); and a whitespace PORT listens on a random port and a whitespace DATABASE_URL passes the parser (#169). The sealed format holds: a fresh 12-byte IV each time, a 16-byte tag, and every truncated tag refused.

> **Fixed, unverified (21 November 2026, fifth pull request):** every role refuses an `ENCRYPTION_KEY` of one repeated byte, the old `.env.example` key and all-zero included, and `.env.example` leaves it empty (#165). Every role refuses a `DATABASE_URL` password shorter than 16 characters, with whitespace or of one repeated character, and `provision`, which every other app container waits on, applies the same floor to `POSTGRES_PASSWORD` and the four role passwords by name (#166). `api` and `worker` refuse to start when `ENCRYPTION_KEY` can't open the saved SMTP password; Delivery says so and the test send answers `409 smtp_password_unreadable`; `cli smtp-password:reseal` and `smtp-password:forget` are the rotation path (#167). `APP_URL` must be `http:` or `https:`, and [ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md#when-plain-http-stops-being-acceptable) records when plain HTTP stops being acceptable, with a review by 21 November 2027 (#168). A whitespace-only value is refused by name, and `PORT` must be digits (#169).

### H11: Nothing limits sending or the API · medium

There is no rate limit on `/v1` or on any send. One API Key can send as fast as the provider takes it, burning the provider's quota and the sending domain's reputation, and every call writes `api_keys.last_used_at` (`src/access/api-keys.ts:94-97`). `POST /v1/templates/preview` compiles any Handlebars a key sends, with no cache and no cost bound (`template-routes.ts:342-389`). The figures belong to [the request-rate pre-condition](#pre-condition-the-request-rate-policy-before-the-gate) and are not set. Quantify by arithmetic, not by load. Carried over: Wizzaroo #328 and #329.

> **Verdict, first round (K1 #94, 20 November 2026):** confirmed for sending, by arithmetic. 20 sends in a row from one key are all accepted with no limit reported, 2.9 ms each in-process: about 345 Messages a second (about 51,700 recipient addresses at 150 each). Every authenticated call, reads included, writes last_used_at. The one-at-a-time worker means a minute's burst queues hours ahead of Wizzaroo's account emails (#133). The API-wide limit is I2a's (#103), and the preview's render cost is S3's.
>
> **Verdict, first round (I2a #103, 21 November 2026):** confirmed, by arithmetic. The only limit in the server is the sign-in throttle. 101 in a row from one key or session all answered, with no 429 and no RateLimit or Retry-After header: sends (#133), Template previews and reads on /v1, previews on /app (#162, medium), and test emails, which go straight to the SMTP provider outside the queue with no Message row (#164, low). One key's second of intake is 51,750 recipients, more than a day of SES's starting 50,000-recipient quota; the worker's 1,800 Messages an hour spend that quota in 11 minutes; a minute's intake is 11.5 hours of queue. Each send is three writes (Message, job, last_used_at) and each read one. One key sending S3's worst preview (687 ms, #137) one after another holds the single api's event loop. The figures I2b needs, the key (the socket's address, trustProxy false) and per-process or deployment-wide for each cell, are in docs/pen-test/findings/I2a.md, "Numbers for I2b".

> **Fixed, unverified (21 November 2026, third pull request):** `POST /v1/messages` has the policy's per-key limit, recipient addresses a minute counted on the key's row across the deployment, refused with `429` and `Retry-After` and reported in `RateLimit-*` headers; `last_used_at` is written at most once a minute (#133). The other `/v1` and `/app` limits (#162) and test sends (#164) are still open.

> **Fixed, unverified (21 November 2026, fifth pull request):** every other `/v1` call is counted against its API Key (120 a minute, burst 60), `POST /v1/templates/preview` against its own 10 a minute, and every `/app` call against its User across their sessions (300 a minute, burst 100), all in Postgres on the key's or User's row, refused with the one `429` and reported in `RateLimit-*` headers (#162). `POST /app/settings/test` is limited to 5 an hour per User, and each test send is recorded as a Message with no Application, so every User sees it in the Logs and no API Key can (#164).

### H12: Deleting a Message leaves copies behind · medium

Retention deletes old Messages at 03:30 UTC (`src/sending/retention.ts:8-19`). It does not remove:

- the nightly backups, kept 14 nights by default (`BACKUP_KEEP_DAYS`);
- the container logs, where Fastify's request log records each URL, `/app/messages?search=<email>` included, and a failing query may record its parameters, with no `logging:` bound in `docker-compose.yml`.

Probe: list every place a Message's recipients and body are copied, and run a Retention sweep, then a restore, end to end. Carried over: Wizzaroo #280 and #282.

> **Verdict, first round (D2 #100, D3 #101, 20 November 2026):** confirmed. Retention deletes Messages in every status with their attachments; the pg-boss job rows it leaves hold only Message ids. The api container log keeps searched addresses (request URLs) and any failed query's SQL and parameters, with no logging: bound, outside Retention (#126); the worker and Postgres logs hold no personal data. Backups keep deleted Messages up to 14 more nights, and a restore brings back every Message deleted since, links included, and the old Retention setting (#130).

> **Fixed, unverified (21 November 2026, third pull request):** the api's request log drops every query string and logs errors without their SQL, parameters or Postgres message, and every container's log is bounded to three 10 MB files (#126). A restore re-applies the Retention in force now, deleting every Message older than it, and the guide states a Message's real lifetime is Retention plus `BACKUP_KEEP_DAYS` (#130). Retention's 3,650-day maximum (#147) is still open.

### H13: The backups trust the server that makes them · medium

The server holds only the age recipient, which is right: it can't read a backup (`backup/backup.sh:13-19`). But:

- old backups are removed with `rclone deletefile` (`backup.sh:21-30`), so the rclone credential on the server can delete every backup, and nothing locks them;
- a failed night writes a log line and tells no one (`backup/nightly.sh:6-10`);
- `restore` mounts `./backup-identity.txt` by default (`docker-compose.yml:113`), and `.gitignore` doesn't name it, so the one key that opens every backup is one `git add .` from the repository.

Carried over: Wizzaroo #317.

> **Verdict, first round (D3 #101, 20 November 2026):** confirmed, and wider than written. Encryption holds: a backup can't be read without the age identity. The server's rclone credential deletes every backup (#127), and with the public recipient forges a backup that restore latest restores, planted User included (#128). A failed night (bad remote or full disk) writes one stderr line and keeps looping, with no healthcheck or alert (#129). backup-identity.txt and the runbook's key.txt are not in .gitignore, and the restore runbook puts the identity in the server's checkout (#131).

> **Fixed, unverified (21 November 2026, third pull request):** `backup.sh` deletes nothing unless a separate prune remote is named; the runbook gives an append-only credential and lifecycle rule for B2, S3 and SFTP, and D3's probe runs against an append-only SFTP server (#127). A restore restores only a backup named by its stamp and the sha256 from the record the operator keeps off the server, and refuses future stamps (#128). A failed night stops `nightly.sh` and the `backup` container is unhealthy until a night succeeds, or when none has for 26 hours (#129). `.gitignore` names `backup-identity.txt` and `key.txt`, and the runbook keeps the identity off the server (#131).

### H14: The supply chain trusts tags and the production host · medium

- `publish-email-client.yml` pins `actions/checkout@v4`, `pnpm/action-setup@v4` and `actions/setup-node@v4` to tags (`:20-24`), grants `packages: write` to the whole workflow, keeps the checkout's token in `.git/config` while `pnpm install` runs install scripts (`:9-11,20,31-33`), and on `workflow_dispatch` publishes from any branch without the version check (`:7,35-36`). `pages.yml` and `release.yml` pin by SHA, which is good and to be confirmed.
- No workflow checks a pull request: no lint, test, `pnpm audit` or dependency review, and no Dependabot. `docs/operations/deploying.md` says "There is no hosted CI".
- `ops/deploy-server.sh` runs `pnpm install` with development dependencies and the whole test suite on the production host (`:12-18`), as a user who can drive Docker, so any development dependency runs with root's reach over the stack.
- Images are named by tag, not digest (`docker-compose.yml:24`, `Dockerfile:1,10`, `backup/Dockerfile:1`), and `apk add age rclone` by name. No container sets `read_only`, `cap_drop` or `no-new-privileges`.

Good and to confirm: `allowBuilds` in `pnpm-workspace.yaml`, `--frozen-lockfile` everywhere, no `pull_request_target`, and the published package shipping only `dist`. Carried over: Wizzaroo #313, #314, #333 and #334.

> **Verdict, first round (I6 #108, 21 November 2026):** confirmed for `publish-email-client.yml`, the deploy script and the missing pull-request checks; refuted for `pages.yml`, `release.yml` and everything under "good and to confirm". `pages.yml` and `release.yml` pin all 11 actions by SHA, set `persist-credentials: false`, and keep every write scope in a job that installs nothing. `publish-email-client.yml` runs install, typecheck, test and build beside `packages: write` with its token left in `.git/config` (#175), pins three actions to `@v4` (#176), and on `workflow_dispatch` publishes any branch's code and version with the version check skipped, and on a tag from any commit (#177). `pnpm deploy:server` installs every development dependency and runs typecheck, lint and the whole test suite on the production host, as a user who drives Docker, beside `.env` (#178). No workflow ran on a pull request at `2f11db2`; #109 is its fix. Nothing proposes dependency or pinned-action updates (#179). `allowBuilds` names every installed package with a build script and lets only `esbuild` and `@fastify/pre-commit` run; every `pnpm install` has `--frozen-lockfile`; no workflow uses `pull_request_target`; the package ships `dist`'s JavaScript and types, `README.md` and `package.json` only. The image-digest and container bullet is I4's (#106).
>
> **Verdict, first round (I4 #106, 21 November 2026) — the containers and images:** confirmed. No service drops a capability, runs `read_only`, sets `no-new-privileges` (NoNewPrivs 0 everywhere) or bounds memory, CPU or PIDs; every container keeps Docker's default capability set, and `mailpit` and `entry` (nginx) run their main process as root. The app and backup images do set a non-root `USER` (`node`, `postgres`), so `api`, `worker` and `backup` run unprivileged — refuted for those (#182). Every image is a mutable tag, none pinned by digest, and `apk add age rclone` is unversioned (#183). The log driver's bound is left to the host daemon (no `logging:` in Compose; cited to D2 #126), and the five containers on the non-internal `default` network each have a way out (cited to D1 #139). The CI, deploy script, client package and public site are I6's (#108).
>
> **Fixed (21 November 2026):** pull requests are checked by `.github/workflows/checks.yml`: lint, typecheck, Prettier, the tests, `pnpm audit --audit-level high` and dependency review, SHA-pinned with a read-only token (#109). The publish workflow (#175, #176, #177), the deploy script (#178), update proposals (#179), the published port (#181), container hardening (#182) and digests (#183) are still open.

> **Fixed, unverified (21 November 2026, sixth pull request):** `publish-email-client.yml` builds, tests and packs in a job with `contents: read` and no kept token, and publishes that tarball from a job that installs nothing and alone holds `packages: write`; every checkout in every workflow sets `persist-credentials: false` (#175). Every action in every workflow is pinned by commit SHA (#176). The workflow runs only on an `email-client-v*` tag whose commit is on `main`, the version check is unconditional, `workflow_dispatch` is gone and the publish job runs in the `email-client` environment (#177). `ops/deploy-server.sh` pulls `main`, refuses a checkout that isn't `origin/main`, and only builds and runs the images: no `pnpm install`, typecheck, lint or test on the host (#178). Dependabot proposes grouped npm and GitHub Actions updates weekly (#179). Every Compose service drops every capability, sets `no-new-privileges`, runs read-only and is bounded in memory and PIDs, and the pen-test override's `mailpit` and `entry` run as non-root users (#182). Every base image is pinned by digest and `age` and `rclone` by version (#183). Repository settings stay with the owner: the `email-client` environment's tag rule, a tag ruleset, required SHA pinning and a ruleset on `main` ([Owner steps after merge](../operations/website-ci-and-releases.md#owner-steps-after-merge)).

### H15: Templates run what their authors write · low

Every send compiles its Template with Handlebars 4.7.10, no custom helpers and prototype access left at its safe default (`src/templates/render.ts:23-37`); that is to be confirmed rather than retested. Weaker:

- Template authors include every API Key (H3), and triple-stash `{{{x}}}` is theirs to use;
- the designer writes link and image URLs escaped but with any scheme, `javascript:` included (`src/templates/design/render-html.ts:157-160,183,213,239`);
- the designer's HTML-block frames are `sandbox="allow-same-origin"` with remote images and CSS loading in the User's browser, and `fontFamily` goes unescaped into a `<style>` (`src/ui/designer/designer.tsx:396-404,793-806`); the previews' `sandbox=""` is right.

Probe what a hostile Template, Header or Design can do to a recipient's mail client, to the User editing it, and to the server rendering it.

> **Verdict, first round (S3 #98, 20 November 2026):** confirmed, with prototype access refuted. Handlebars 4.7.10's prototype protections hold in subject, HTML and text on preview and send (18 tricks, constructor/**proto**/lookup and the pre-4.6 String.prototype.sub chain, all render empty); Fastify refuses **proto** and constructor.prototype keys in variables; the preview, thumbnail and log frames are `sandbox=""`. Weaker: the built-in `{{log}}` helper copies any variable, Wizzaroo links included, into the api log (#136); a Block's showIf carries Handlebars (#153); Button, Image and Socials keep javascript: and data: URLs (#154); the designer's HTML-block and Header/Footer frames are allow-same-origin and load any remote content (#155); fontFamily gets past safeFont with &#59 and closes the designer frame's `<style>` (#156); /v1/templates/preview has no cost bound, about 21 hours of event loop at the 36 MB limit by arithmetic (#137). HTML Blocks and hand-written Header HTML reach the email verbatim by ADR 0006/0007: a documented decision with no recorded end.

> **Fixed, unverified (21 November 2026, third pull request):** Templates render in a Handlebars environment of their own where `{{log}}` renders nothing and writes nothing, and a prototype-access denial writes nothing to the log (#136). #137 and #153-#156 are still open.

> **Fixed, unverified (21 November 2026, fourth pull request):** every render, on send, preview and save, is bounded: at most 50,000 characters of Handlebars per part, 1,000,000 characters of html or text out, and a budget of work charged from inside Handlebars that refuses nested `{{#each}}` and fanning partials in about 200 ms; the `<body` scans are linear (#137). #153-#156 are still open.

> **Fixed, unverified (21 November 2026, fifth pull request):** a Block's `showIf` is written into `{{#if}}` only when it is a variable path, and is dropped otherwise (#153). Button, Image and Socials links and image sources keep only `http(s):`, `mailto:`, `tel:`, `#` or a `{{variable}}`, and anything else is dropped (#154). The designer's HTML-block and Header/Footer frames are `sandbox=""`, read by nothing, and sit under #170's content security policy, so a remote image, stylesheet or font in them doesn't load (#155). A Design's `fontFamily` must be a font stack of letters, digits, spaces, hyphens, underscores and quoted names, on the server and in the designer, or the default stack is used (#156).

### H16: Refusals and the API page say more than they need to · low

`/docs` serves the whole `/v1` OpenAPI document and its UI with no sign-in (`http-server.ts:138-156`); the `/app` routes are hidden from it, which is right (`:186-188`). 5xx answers are one fixed body (`http-server.ts:96-131`), which is good and to be confirmed. But 4xx answers echo Fastify's message (`:118-126`), a Template that won't compile echoes Handlebars' parse error (`template-routes.ts:203-219`), a Message's `error` returns the SMTP provider's reply to the key that sent it (`src/sending/send-worker.ts:88`), and `@adrianeyre/email-client` accepts an `http:` `baseUrl` with no warning (`packages/email-client/src/client.ts:236`). Carried over: Wizzaroo #310.

> **Verdict, first round (B1 #95, 20 November 2026):** confirmed for /docs (low); the route boundary is sound. All 102 routes enumerated from the router: 25 /v1 all behind the key hook, 49 /app all behind the session hook, 28 outside both (the UI, /health, /auth, /robots.txt, /sitemap.xml and 14 /docs routes). Nine identities × 102 routes: no mismatch, no 5xx, every 401 one of three fixed bodies, and no answer tells a thing that exists from one that doesn't. Path tricks over a real socket can't cross a hook, because hooks belong to route scopes, not path matches; the SPA fallback only serves the page. /docs, /docs/json and /docs/yaml give anyone the /v1 description and version 2.0.0, and correctly hide /app and /auth (#148). No test guards a route registered outside both hooks; one is proposed as the fix (#149). The error-handler, Handlebars, SMTP-text and client http: bullets are I1's (#102) and I6's (#108).
>
> **Verdict, first round (I1 #102, 21 November 2026):** confirmed for SMTP text and Fastify's codes; the 5xx body and Handlebars' error refuted. With Postgres refusing the password, every route as no one, a key and a session answers a fixed 500, a fixed 401 or /health's 503, with no driver text. A Template that won't compile gets Handlebars' parse error, which holds only its author's template and Handlebars' grammar and goes only to them. A failed Message's error is the provider's reply or Node's network error word for word (the provider's internal host, address and account, or the SMTP host and port), readable by the key that sent it and by any other (#173, with #118); the User's test send showing it is right. Fastify's own 4xx pass through with their FST_ERR_ codes, so refusals aren't a closed set and name the framework (#174). An oversize body on any route is told of the 25 MB message limit (#172).

> **Verdict, first round (I6 #108, 21 November 2026), the client's `http:` bullet:** confirmed (low). `@adrianeyre/email-client` takes an `http:` `baseUrl` for any host with no warning and sends the API Key across it in the clear; with ADR 0003's plain-HTTP port it is the only `baseUrl` that works on the LAN (#180; the server's half is I3's #168). Refuted: the key goes only in `Authorization: Bearer`, never in a URL or body, and not across a redirect to another origin; the client's errors carry the status and the app's own code, message and field errors, never the key.

> **Fixed, unverified (21 November 2026, fourth pull request):** `/docs`, `/docs/json` and `/docs/yaml` answer only a signed-in User or an API Key holder (#148). `src/api/route-guard.test.ts` asks every route with no credential in every `pnpm test` and fails on any served route not on the reviewed allow-list (#149).

> **Fixed, unverified (21 November 2026, sixth pull request):** a failed Message's `error`, which `/v1` and the Logs show, names only its class (refused with the reply and status code, permanent or temporary; could not be reached; or the platform's own Settings refusal) and never the provider's reply text or Node's network error; the full detail goes only to the worker's and the api's own logs as codes (#173). Every 4xx carries a code from the platform's own set, mapped from Fastify's (`unsupported_media_type`, `invalid_json`, `invalid_content_length`, `request_too_large`, `not_found`, `bad_request`), and the sending guide lists every code (#174). `@adrianeyre/email-client` refuses an `http:` `baseUrl` for a host other than loopback unless the caller sets `allowInsecureHttp: true` (#180).

### H17: The public site and screenshots leak nothing · low

`site/build.ts:70` copies all of `docs/images` to GitHub Pages. The screenshots read so far show only `example.com` addresses, `localhost:1025` and an empty password field. Confirm every image, the illustrations included, holds no API Key, password, session cookie or real address beyond `no-reply@adrianeyre.co.uk`, and that a test pins the set so a new image is read again. Carried over: Wizzaroo H20.

> **Verdict, first round (I6 #108, 21 November 2026):** refuted. All 35 images `site/build.ts` publishes (the 29 in `docs/images`, 14 of them not on the page, and six icons) were read at full size: no API Key, password, session cookie, real recipient or image metadata. Beyond `no-reply@adrianeyre.co.uk` they show the Built-in Wizzaroo Configuration's `no-reply@wizzaroo.adrianeyre.co.uk` and the Built-in Footer's three social links, which every Built-in email sends anyway, so the allow-list above is that much short. The set is now pinned: `src/pen-test/probes/i6.test.ts` compares what `site/build.ts` publishes, by SHA-256, with `src/pen-test/probes/i6-reviewed-images.json`, and a new or changed image fails until it is read and recorded. No finding.

---

## Scope partition

Child issues under `prd:pen-test` partition the surface along the platform's own lines. Each names its trust boundary, links the ADRs and guides that govern it, points at the code, lists the hypotheses it answers, and says what to probe. Each produces a committed findings note at `docs/pen-test/findings/<ID>.md` with a verdict per probe, probe tests in the gated run (an `it.fails` for the property that should hold beside a `today_…` test pinning what happens now), one finding issue per confirmed weakness, and its H entries here amended with their verdicts. A scope issue probes and never fixes; each fix is its own issue against its finding.

- **Enablement (E1-E5)**
  - **E1** the pen-test deployment: its own Compose project, volume and `.env`, a Mailpit sink, no way out, throwaway backup targets, torn down with its volume. (#87)
  - **E2** fixtures: two Users, one of them the victim; two API Keys standing for two Applications, Wizzaroo and a second one, and a deleted key; the 15 Built-in emails with their Header, Footer and Configuration; Messages in every status, Wizzaroo reset and Invite links among them; Settings pointing at the sink. Built by a pure plan and a separate loader, committed, synthetic. (#88)
  - **E3** rules of engagement and statement of work. (#89)
  - **E4** the credentials package, and how its secrets are delivered. (#90)
  - **E5** the findings workflow: labels, issue template, triage note. (#91)
- **Users and sessions (A1-A2)**
  - **A1** passwords, sessions and the sign-in throttle (H1, H5). (#92)
  - **A2** User management: adding, deleting and what one User can do to another (H5). (#93)
- **API Keys (K1)**
  - **K1** API Keys and their reach: each `/v1` power with each fixture key (H3, H11). (#94)
- **Routes (B1)**
  - **B1** every route compared with the hook it should have (`/v1` key, `/app` session, none), every route as every identity, and a test that fails when a route is added outside both (H16). (#95)
- **Sending and Templates (S1-S3)**
  - **S1** Message input: addresses, from, subject, attachments and headers (H8). (#96)
  - **S2** the `Idempotency-Key` (H7). (#97)
  - **S3** Templates, Handlebars and the designer (H15). (#98)
- **Data (D1-D3)**
  - **D1** Postgres privilege (H4). (#99)
  - **D2** the log, Retention and the personal data it holds (H2, H12). (#100)
  - **D3** backups and restore (H12, H13). (#101)
- **Infrastructure and delivery (I1-I6)**
  - **I1** HTTP hardening, the cookie and the error handler (H9, H16). (#102)
  - **I2a** rate limiting, probed and quantified by arithmetic (H1, H11). (#103)
  - **I2b** the owner sets the figures in [the request-rate pre-condition](#pre-condition-the-request-rate-policy-before-the-gate). (#104)
  - **I3** secrets and fail-closed configuration (H10). (#105)
  - **I4** containers, Compose, the published port and the networks (H9, H14). (#106)
  - **I5** the SMTP provider settings (H6). (#107)
  - **I6** the CI supply chain, the deploy script, the client package and the public site (H14, H16, H17). (#108)

Two issues in the set **build rather than probe**:

- **Check pull requests in CI:** lint, typecheck and test, `pnpm audit` and dependency review on every pull request, every action pinned by SHA, so a package with a known advisory fails the build. Read advisories from the lockfile, not GitHub's dependency graph, which reads manifests and can miss most of a pnpm tree. This reverses "There is no hosted CI" in `docs/operations/deploying.md`. (#109)
- **Add this round to Wizzaroo's second-School gate:** the gate is enforced in Wizzaroo's repository (`src/server/schools/second-school-gate.ts` and section 11 of `wizzaroo.md`), so this issue is the owner's reminder to add "the email platform's pen test, with every finding above low remediated or waived" there. (#110)

A tracking issue lists them all. (#111)

---

## Checks every scope issue carries

These are the general checks from Wizzaroo's round, which apply across this platform's surface. A scope issue lists the ones that apply to it.

- **Refusals give nothing away.** An unauthenticated caller gets the same status, body and length whether the thing they asked about exists or not.
- **Every refusal comes from a closed set.** No route answers a well-formed request with a 500, and no error message, driver text, Handlebars or SMTP text reaches a caller who didn't need it.
- **Odd input stops above the database:** NUL bytes, numbers written as `0x10`, `1e3` or `1.5`, `"Infinity"`, the year 0000, very long strings, and path segments past the router's limit. (Wizzaroo #294-#297.)
- **An idempotency key is bound to its payload and its owner.** The same key with a different body is refused, and one caller's key never returns another caller's result.
- **Nothing is left to a collaborator to bound.** Every retry loop, every list and every recipient field has its own limit; Nodemailer and the SMTP provider are not the limit.
- **A secret is sealed or hashed where it is kept, and kept no longer than it is needed.** That includes secrets that belong to someone else, such as the links in Wizzaroo's emails.
- **Logs are a copy of the data.** Sweep them for personal data, and count them in Retention.
- **Internal headers are trusted only when the server set them.** Send each header the server reads, `X-Forwarded-For` first, from outside.
- **Middleware that matches by path matches by segment.** Try `/v1X`, `//v1`, `/app/../v1`, encoded slashes and trailing dots against both hooks and the SPA fallback.
- **Configuration fails closed.** Unset each variable in turn; a one-character, whitespace or `.env.example` secret is refused at boot.
- **Run the probes against a real Postgres,** not a mock. `src/integration.test.ts` already starts one, and Mailpit, with testcontainers.
- **A test that passes either way proves nothing.** Pin the observed outcome. Name a probe `today_…` while a gap is open, and rename it `(regression)` once it is fixed; turn tests, never delete them.

---

## Findings workflow

Every finding is its own GitHub issue carrying `prd:pen-test`, exactly one of `severity:critical`, `severity:high`, `severity:medium` or `severity:low`, and a pointer to the scope issue it was found under. It states the rule it breaks (guide section and ADR), the steps to reproduce it, what happened against what should have, and the test that would have caught it. That test joins the gated run with the fix.

Remediation targets, in working days after triage confirms the finding. Triage happens the same working day a finding is filed.

| Severity | Target      | What it means here                                                                                                                                                 |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| critical | 2           | Someone with no User or API Key sends email, reads a Message or the SMTP password, or acts as a User; or a Wizzaroo account link reaches anyone but its addressee. |
| high     | 10          | One credential gets more than its role should, such as an API Key reaching what only a User should, or one Application reading another's Messages.                 |
| medium   | 30          | A control is weaker than its documentation says, or a boundary has no defence in depth.                                                                            |
| low      | best effort | Hygiene, disclosure, or a documented decision with no recorded expiry.                                                                                             |

- **In the external round, a critical finding never starts life as a GitHub issue.** It goes to the owner by the out-of-band channel E3 names, with no exploit detail in the first message; the issue is filed once a fix is in hand. If the owner doesn't acknowledge within 30 minutes, testing pauses. **In this first round** the testers report to the owner, the repository is private and the data is synthetic, so a critical finding is filed as an issue straight away.
- **A critical or high finding that touches H2 is also Wizzaroo's.** Its issue links Wizzaroo's tracking issue, and the owner decides the same day whether Wizzaroo's live reset and Invite links must be expired.
- **`wontfix` needs a written rationale from the owner in the issue before the label goes on.**
- **Fixed is not verified.** A finding is "fixed, unverified" until the probe that found it has been run again and passes.
- **A decision is not a fix.** A finding answered by a new ADR, or by a change to [ADR 0005](../architectural-decision-record/0005-templates-and-sending-only.md), stays open until the code matches the ADR, unless the ADR's decision is to accept the finding.
- **This file is amended in place** as hypotheses get verdicts and findings are fixed, so the next round doesn't start from stale text.
- Closing keywords are written plainly (`Fixes #123`), never inside bold or code, so they work.
- An issue that waits on the owner's decision carries `owner`.
- A credential that expires (a token, a key) has its expiry date recorded and a rotation issue filed a week before it.

---

## Pre-condition: the request-rate policy, before the gate

This section is the only home of the platform's request-rate figures. Configuration reads them from here; no other file, comment, test or environment variable carries a copy.

|                                       | Per IP                                                               | Per account (normalised email)      | Per API Key                                          |
| ------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Window                                | 15 minutes                                                           | 15 minutes                          | 1 minute                                             |
| Burst                                 | 10                                                                   | 10                                  | 60                                                   |
| `POST /auth/sign-in`                  | 30 tries per 15 minutes                                              | 10 failures per 15 minutes          | —                                                    |
| `POST /v1/messages` (Messages)        | —                                                                    | —                                   | 30 recipient addresses (to + cc + bcc) per minute    |
| `POST /v1/templates/preview`          | —                                                                    | —                                   | 10 per minute                                        |
| Every other `/v1` call                | —                                                                    | —                                   | 120 per minute, burst 60                             |
| Every `/app` call (per User)          | —                                                                    | 300 per minute, burst 100, per User | —                                                    |
| `POST /app/settings/test` (per User)  | —                                                                    | 5 per hour, per User                | —                                                    |
| Per process, or across the deployment | Across the deployment, in Postgres, with expired keys deleted (#142) | Across the deployment, in Postgres  | Across the deployment, in Postgres, on the key's row |

**Set 21 November 2026 (I2b #104), from [I2a's numbers](../pen-test/findings/I2a.md#numbers-for-i2b).** The reasoning, cell by cell, is in that section; in short:

- **The key and `trustProxy`, one decision (H1):** the limit keys on the socket's address (`request.socket.remoteAddress`, IPv4-mapped IPv6 folded to IPv4, the whole address, not a /64), and `trustProxy` is `false` (done in #114). Every caller is a LAN or tailnet device with its own address ([ADR 0003](../architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md)). If the platform is ever reached from the internet or put behind a proxy, that is a new decision recorded here: `trustProxy` names only that proxy, and IPv6 keys widen to a /64.
- **Sign-in:** today one address gets 46 scrypts a second in sequence (#122), and 1,000 addresses guess one User 960,000 times a day (#163). 30 tries per address and 10 failures per account per 15 minutes bound a 1 million password list against one User to about 2.9 years. The cost, accepted because callers are LAN or tailnet only: anyone can lock a User out with 40 requests an hour. The per-account count is kept in Postgres so a restart (#142) or a crash (#123) doesn't reset it, and counts whether or not the email has an account.
- **Sending:** counted in recipient addresses, not Messages (after #134 parses entries), at the worker's floor of 1,800 an hour, so one key can't queue ahead of the worker or past a 50,000-a-day provider quota (43,200 a day). Today one key queues 345 Messages, 51,750 recipients, a second (#133).
- **Preview:** 10 a minute holds the worst render today (687 ms, #137) to about 11% of the event loop. #137 now bounds a render, so this figure can be raised.
- **The rest (#162, #164):** every other `/v1` call 120 a minute per key, with `last_used_at` written at most once a minute; every `/app` call 300 a minute per User, above the designer's 150 previews a minute while typing; test sends 5 an hour per User.
- **Refusals:** one `429` whichever limit fired, with `Retry-After`.

These are the round's figures, proposed by the round from I2a's measurements and set here as the policy the build reads; the owner confirms them with the statement of work, and a change is made here, with its date and reason.

- The figures were set in I2b, from I2a's numbers, and are recorded above with the date and the reasoning beside them.
- **Until they are set, an unset policy is a closed door, not "no limit":** once rate limiting is built, a production server with no policy refuses to start. A development policy may be named explicitly; there is no implicit production default.
- The address the limit keys on and the `trustProxy` setting are **one decision** (H1), made together and recorded here. `trustProxy: true` with no named proxy is never acceptable. The platform has no proxy in front of it today, so the starting point is the socket's address.
- The per-account limit counts whether or not the email has an account, so it can't tell a caller which addresses do.
- Refusals answer `429` the same way whichever limit fired.

**Review:** re-read on **31 March 2027**, whether or not the gate has been reached. Record the answer in this section; "no change" is a valid answer, and silence is not.

---

## Pre-condition: an external round before the gate

This first round is run by the people and agents who built the platform, working against a brief written by reading the tree from outside. That is better than nothing and is not independent. **Before Wizzaroo adds a second School, or another Application is given an API Key**, a second round is run by someone outside the project, against this file as amended by the first round, and its findings above `severity:low` are remediated or waived in writing ([ADR 0008](../architectural-decision-record/0008-the-email-platform-is-inside-wizzaroos-trust-boundary.md)). It may be the same engagement as Wizzaroo's external round, with this platform in its scope.

---

## Success criteria

1. Every scope issue is filed, labelled and anchored to this file before the window opens, so the round works against a platform-shaped scope and not a copy of Wizzaroo's.
2. The pen-test deployment is stood up, seeded and reachable only by the testers, sends no email out, and is destroyed with its volume at the end.
3. Every finding is filed as a labelled issue within one working day of being found.
4. Every hypothesis in the opening register has a verdict, recorded here.
5. **H1, H2 and H3 have a dated answer** before the round closes: fixed, or a recorded decision naming the date they stop being true.
6. Every finding above `severity:low` is remediated, or waived in writing by the owner, **before the gate**, and the external round in the pre-condition above has done the same.
7. Every credential issued for the round is revoked when it ends.
