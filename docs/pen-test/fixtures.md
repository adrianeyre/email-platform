# The pen-test fixtures

The synthetic world a pen-test round probes, loaded into [the pen-test deployment](./deployment.md) and into every probe test's own Postgres in the gated run: two Applications, two Users, the Applications' API Keys and a deleted one, the 15 Built-in emails with their Header, Footer and Configuration, a second Application's Template, Messages in every status, and Settings pointing at Mailpit. Every value is made up. Every id is fixed, so a probe, a findings note or a finding names a fixture by its handle or id, never by a credential ([rules of engagement](./rules-of-engagement.md#how-testers-behave)). Keep this page private on the same terms as the PRD.

- **The plan** is [`src/pen-test/fixtures/fixture-plan.ts`](../../src/pen-test/fixtures/fixture-plan.ts): data only, with the handles below exported as `penTestFixtureIds`.
- **The loader** is [`src/pen-test/fixtures/load-fixtures.ts`](../../src/pen-test/fixtures/load-fixtures.ts), run in the deployment by `load-fixtures-command.ts` and in the gated run by `startProbeWorld` (`src/pen-test/probes/probe-world.ts`).
- **The tests** are [`src/pen-test/fixtures/fixtures.test.ts`](../../src/pen-test/fixtures/fixtures.test.ts): the plan covers every Message status, Block kind and Header and Footer kind, and loading twice gives the same rows.

## Loading them

With the deployment up:

```bash
pnpm pen-test:seed
```

The first time, it generates the fixture seed into `.pen-test-deployment/fixture-seed.txt`, readable only by you. Then it hands the seed, on standard input, to `node dist/src/pen-test/fixtures/load-fixtures-command.js` in the running `api` container, which loads every fixture in one transaction. The command refuses to run where `PEN_TEST_DEPLOYMENT` isn't `email-platform-pen-test`, which only `docker-compose.pen-test.yml` sets, so it can't put fixture Users and API Keys into production. It ends:

```text
Loaded the pen-test fixtures for 2026-11-20: 2 Applications, 2 Users, 2 API Keys and 1 deleted one, 16 Templates, 2 Headers and Footers, 2 Configurations and 21 Messages. Their credentials come from the seed, and none is printed.
```

- **Loading again puts every fixture back as the plan has it,** by id, whatever a probe did to it: a changed Template, a deleted User, a Retention sweep or a changed password all come back. It removes a row a probe added only when it took a fixture's unique email, name, slug or `Idempotency-Key`. This is how a tester recovers after destructive testing.
- **Loading twice on one day gives the same rows.** `fixtures.test.ts` checks every table row for row in the gated run, and on the deployment an MD5 of every fixture table is the same before and after a second `pnpm pen-test:seed`. A password hash or sealed SMTP password that still matches is kept rather than made again with a new salt, and every Block id in a Design is fixed. Message times are counted back from midnight UTC on the day of loading, so loading on a later day moves them.
- **Every credential comes from the seed:** each User's password, each API Key's secret and the SMTP password, by HMAC-SHA256 of the seed and the fixture's handle. The plan holds none, so committing it commits no credential. The same seed always gives the same credentials ([the credentials package](./credentials-package.md)).
- **Every address ends in `.invalid`**, which can never be delivered (RFC 2606), except the Built-in Configuration's own `no-reply@wizzaroo.adrianeyre.co.uk`, which is the Built-in emails' real from address and is what K1 and S1 probe sending as. No email leaves the deployment anyway.

## Users

| Handle      | Id                                     | Email                              | For                                                                                                    |
| ----------- | -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `victim`    | `7e570000-0000-4000-8000-000100000001` | `victim@users.pen-test.invalid`    | The User whose session is stolen: A1 and A2 take it over, change their password and see what survives  |
| `colleague` | `7e570000-0000-4000-8000-000100000002` | `colleague@users.pen-test.invalid` | The victim's colleague: a second User for one User to delete, and the account a guess or spray aims at |

## Applications

Every key, Template, Header, Footer, Configuration and Message belongs to one of these ([ADR 0009](../architectural-decision-record/0009-api-keys-belong-to-an-application.md)); the loader writes it to the row's `application_id`, and each Message's `api_key_id` is its Application's live key.

| Handle       | Id                                     | Name         | Owns                                                                                                        |
| ------------ | -------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `wizzaroo`   | `7e570000-0000-4000-8000-000800000001` | `Wizzaroo`   | The `wizzaroo` key, the 15 Built-in emails, their Header, Footer and Configuration, and Wizzaroo's Messages |
| `second-app` | `7e570000-0000-4000-8000-000800000002` | `Second app` | The `secondApp` key (and the `deleted` one), its Template and Configuration, and its Messages               |

## API Keys

Each key belongs to the Application in its row (`api_keys.application_id`).

| Handle      | Id                                     | Lookup id (`ek_<lookup>_…`) | Application  | For                                                                                                                  |
| ----------- | -------------------------------------- | --------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `wizzaroo`  | `7e570000-0000-4000-8000-000200000001` | `7e57000000000001`          | `wizzaroo`   | Wizzaroo's key: sends the Built-in emails, whose Messages hold Wizzaroo's links                                      |
| `secondApp` | `7e570000-0000-4000-8000-000200000002` | `7e57000000000002`          | `second-app` | A second Application's key: the one that should not reach Wizzaroo's Templates, Messages or from address             |
| `deleted`   | `7e570000-0000-4000-8000-000200000003` | `7e57000000000003`          | `second-app` | A key a User deleted, so it is in no row; its secret is still in the package, and every `/v1` route should refuse it |

## Headers, Footers and Configurations

| Fixture                    | Id                                     | Application  | What                                                                    |
| -------------------------- | -------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| Header `Wizzaroo`          | `7e570000-0000-4000-8000-000300000001` | `wizzaroo`   | The Built-in Header, above every Wizzaroo email; an HTML Block          |
| Footer `Wizzaroo`          | `7e570000-0000-4000-8000-000300000002` | `wizzaroo`   | The Built-in Footer: a Divider, a Text and a Socials Block              |
| Configuration `Wizzaroo`   | `7e570000-0000-4000-8000-000400000001` | `wizzaroo`   | `Wizzaroo <no-reply@wizzaroo.adrianeyre.co.uk>`, used by every Built-in |
| Configuration `Second app` | `7e570000-0000-4000-8000-000400000002` | `second-app` | `Second app <orders@second-app.pen-test.invalid>`                       |

## Templates

The 15 Built-in emails, each Wizzaroo's and with the Header, Footer and Configuration above, have the ids `7e570000-0000-4000-8000-0005000000NN`, with `NN` from `01` to `0f` in the order of `builtInEmails` in `src/templates/built-in-emails.ts`:

| `NN` | Slug                                  | `NN` | Slug                                    |
| ---- | ------------------------------------- | ---- | --------------------------------------- |
| `01` | `wizzaroo-confirm-your-email-address` | `09` | `wizzaroo-email-address-changed`        |
| `02` | `wizzaroo-reset-your-password`        | `0a` | `wizzaroo-sign-in-codes-paused`         |
| `03` | `wizzaroo-teacher-invite`             | `0b` | `wizzaroo-family-device-signed-in`      |
| `04` | `wizzaroo-parent-invite`              | `0c` | `wizzaroo-two-factor-turned-off`        |
| `05` | `wizzaroo-password-changed`           | `0d` | `wizzaroo-email-address-already-in-use` |
| `06` | `wizzaroo-passkey-added`              | `0e` | `wizzaroo-family-join-request`          |
| `07` | `wizzaroo-passkey-removed`            | `0f` | `wizzaroo-adult-joined-family`          |
| `08` | `wizzaroo-email-change-requested`     |      |                                         |

And the second Application's own, which belongs to `second-app`:

| Id                                     | Slug                       | For                                                                                                                         |
| -------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `7e570000-0000-4000-8000-000500000101` | `second-app-order-shipped` | Designed with one Block of every kind (Text, Image, Button, Divider, Spacer, HTML, Socials, Columns), so S3 meets each kind |

## Messages

A queued Message's `html` and `text` are its Template rendered as a send renders them, Header and Footer included. A sent or failed one has none, as the platform drops a Message's body once it is sent or has failed (#116); the plan still records the link each one carried. Wizzaroo's links are shaped like real ones, `https://wizzaroo.pen-test.invalid/<path>?token=pen-test-<email>-not-a-real-token`, and lead nowhere. Ages are counted back from midnight UTC on the day of loading; two Wizzaroo Messages are past the default 90-day Retention, so the next sweep deletes them.

| Id (`7e570000-0000-4000-8000-…`) | Application  | Template                                | Status   | `Idempotency-Key`                          | Age (days) | Link                                                                              |
| -------------------------------- | ------------ | --------------------------------------- | -------- | ------------------------------------------ | ---------- | --------------------------------------------------------------------------------- |
| `000600000001`                   | `wizzaroo`   | `wizzaroo-confirm-your-email-address`   | `queued` | `wizzaroo-confirm-your-email-address-1`    | 0          | Yes                                                                               |
| `000600000002`                   | `wizzaroo`   | `wizzaroo-reset-your-password`          | `sent`   | None                                       | 0          | Yes                                                                               |
| `000600000003`                   | `wizzaroo`   | `wizzaroo-teacher-invite`               | `failed` | `wizzaroo-teacher-invite-3`                | 1          | Yes                                                                               |
| `000600000004`                   | `wizzaroo`   | `wizzaroo-parent-invite`                | `queued` | None                                       | 1          | Yes                                                                               |
| `000600000005`                   | `wizzaroo`   | `wizzaroo-password-changed`             | `sent`   | `wizzaroo-password-changed-5`              | 2          |                                                                                   |
| `000600000006`                   | `wizzaroo`   | `wizzaroo-passkey-added`                | `failed` | None                                       | 3          |                                                                                   |
| `000600000007`                   | `wizzaroo`   | `wizzaroo-passkey-removed`              | `queued` | `wizzaroo-passkey-removed-7`               | 5          |                                                                                   |
| `000600000008`                   | `wizzaroo`   | `wizzaroo-email-change-requested`       | `sent`   | None                                       | 8          |                                                                                   |
| `000600000009`                   | `wizzaroo`   | `wizzaroo-email-address-changed`        | `failed` | `wizzaroo-email-address-changed-9`         | 13         |                                                                                   |
| `00060000000a`                   | `wizzaroo`   | `wizzaroo-sign-in-codes-paused`         | `queued` | None                                       | 21         |                                                                                   |
| `00060000000b`                   | `wizzaroo`   | `wizzaroo-family-device-signed-in`      | `sent`   | `wizzaroo-family-device-signed-in-11`      | 34         | Yes                                                                               |
| `00060000000c`                   | `wizzaroo`   | `wizzaroo-two-factor-turned-off`        | `failed` | None                                       | 55         |                                                                                   |
| `00060000000d`                   | `wizzaroo`   | `wizzaroo-email-address-already-in-use` | `queued` | `wizzaroo-email-address-already-in-use-13` | 89         |                                                                                   |
| `00060000000e`                   | `wizzaroo`   | `wizzaroo-family-join-request`          | `sent`   | None                                       | 91         | Yes                                                                               |
| `00060000000f`                   | `wizzaroo`   | `wizzaroo-adult-joined-family`          | `failed` | `wizzaroo-adult-joined-family-15`          | 120        |                                                                                   |
| `000600000101`                   | `second-app` | `second-app-order-shipped`              | `queued` | `second-app-order-SA-1001`                 | 0          | Has an attachment, `invoice-SA-1001.txt` (`7e570000-0000-4000-8000-000700000001`) |
| `000600000102`                   | `second-app` | `second-app-order-shipped`              | `queued` | None                                       | 7          |                                                                                   |
| `000600000103`                   | `second-app` | `second-app-order-shipped`              | `sent`   | `second-app-order-SA-1003`                 | 14         |                                                                                   |
| `000600000104`                   | `second-app` | `second-app-order-shipped`              | `sent`   | None                                       | 21         |                                                                                   |
| `000600000105`                   | `second-app` | `second-app-order-shipped`              | `failed` | `second-app-order-SA-1005`                 | 28         |                                                                                   |
| `000600000106`                   | `second-app` | `second-app-order-shipped`              | `failed` | None                                       | 35         |                                                                                   |

`000600000101` also has a cc, a bcc and a reply-to. Queued fixture Messages have no job in the queue, so they stay queued until a probe delivers them; a `failed` one carries a synthetic SMTP refusal as its `error`.

## Settings

| Setting              | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| SMTP host and port   | `mailpit:1025`, the deployment's sink, without TLS                               |
| SMTP username        | None, so no AUTH: Mailpit has no TLS, and credentials only ever cross TLS (#186) |
| SMTP password        | From the seed, sealed with the deployment's `ENCRYPTION_KEY`                     |
| Default from address | `Pen-test platform <no-reply@platform.pen-test.invalid>`                         |
| Retention            | 90 days                                                                          |

In the gated run the host and port are those of the probe's own Mailpit container instead.
