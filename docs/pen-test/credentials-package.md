# The pen-test credentials package

What a tester is given to act as each of [the fixtures](./fixtures.md) on [the pen-test deployment](./deployment.md), how it reaches them, and what they are not given. Testers get the fixture identities and nothing more; anything else they reach is a finding ([the brief](../product-requirements-document/pen-testing.md#engagement-shape)). This page holds no credential: those are in the package, which is never committed. Keep this page private on the same terms as the PRD.

## What testers get

- **The deployment's origin,** `http://localhost:43320`, and its Mailpit at `http://localhost:43325`, reached over SSH from another machine as [the deployment page](./deployment.md#who-can-reach-it) says.
- **The credentials package:** each fixture User's password and each fixture API Key, the deleted one included, as environment variables. Every one is derived from the fixture seed, so it is synthetic and works only on this deployment, and only until it is torn down.
- **The sign-in harness,** `pnpm pen-test:sign-in`, which signs in as a named User, or picks a named key, and hands back the header a request needs.
- **The source, read-only,** at the commit the round runs against.
- **An external tester also gets the out-of-band contact** the [rules of engagement](./rules-of-engagement.md#the-out-of-band-channel) settle on, given with the package and never written in this repository.

| Variable                      | Fixture                                        |
| ----------------------------- | ---------------------------------------------- |
| `PEN_TEST_URL`                | The deployment's origin                        |
| `PEN_TEST_PASSWORD_VICTIM`    | `victim`'s password                            |
| `PEN_TEST_PASSWORD_COLLEAGUE` | `colleague`'s password                         |
| `PEN_TEST_API_KEY_WIZZAROO`   | The `wizzaroo` key                             |
| `PEN_TEST_API_KEY_SECOND_APP` | The `secondApp` key                            |
| `PEN_TEST_API_KEY_DELETED`    | The `deleted` key, which the API should refuse |

## What testers don't get

None of these is in the package, and a tester who reaches one anyway has a finding, filed as [the rules of engagement](./rules-of-engagement.md#how-testers-behave) say:

- **`ENCRYPTION_KEY`**, which seals the SMTP password;
- **`POSTGRES_PASSWORD`**, or any connection string to the deployment's Postgres. A probe of database privilege (D1) runs against its own Postgres in the gated run, `src/pen-test/probes/`, with the app's own connection string, as [the checks every scope issue carries](../product-requirements-document/pen-testing.md#checks-every-scope-issue-carries) ask. A probe that needs the deployment's own database is run by the owner;
- **SMTP passwords:** the fixture's sealed one, and any real provider's;
- **the rclone configuration,** the deployment's stand-in `rclone.conf` and the real one;
- **the age identity,** the deployment's `age-identity.txt` and the real one;
- **the GitHub token,** and every CI secret and repository setting;
- **write access to the repository,** beyond an agent's own branch;
- **the fixture seed,** `.pen-test-deployment/fixture-seed.txt`, which every credential in the package comes from, and everything else in `.pen-test-deployment/` but the package.

## Making the package

The owner makes it on the machine running the deployment, once the fixtures are loaded:

```bash
pnpm pen-test:seed
pnpm pen-test:credentials
```

`pnpm pen-test:credentials` reads the fixture seed and writes `.pen-test-deployment/credentials-package.env`, readable only by the owner, and prints none of it. It ends:

```text
Wrote the credentials package for 2 Users and 3 API Keys to /path/to/email-platform/.pen-test-deployment/credentials-package.env, readable only by you. None of it is printed.
```

The same seed always gives the same package, so loading the fixtures again doesn't change it. Teardown deletes it with the seed.

## Handing it over

The package goes to each tester as a file, and only by these routes:

| Tester                                     | How the package reaches them                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The owner, on the machine running it       | It is already there                                                                                                                                                                      |
| The owner, on another machine              | Copied over SSH, as the ports are forwarded, into a file only they can read                                                                                                              |
| An agent (Sandcastle)                      | Put into the agent's environment by whoever starts it. Never in its prompt, its issue or its branch. An agent that finds a credential in its prompt stops and says so on its scope issue |
| The external tester, in the external round | Over the end-to-end encrypted channel the rules of engagement agree for the external round. Never by email or in an issue                                                                |

A tester keeps the file outside every repository and deletes it when the round ends.

## Signing in with the harness

The harness, [`src/pen-test/deployment/sign-in.ts`](../../src/pen-test/deployment/sign-in.ts), takes every credential from the environment, never from the command line, where shell history and `ps` keep it. It is given one thing, the fixture's handle (`victim`, `colleague`, `wizzaroo`, `secondApp` or `deleted`), and refuses anything else, a flag such as `--password` included, without repeating what it was given. It refuses to write to a terminal, because what it writes is a credential. For a User it signs in with `POST /auth/sign-in` and writes `Cookie: session=…`; for a key it writes `Authorization: Bearer ek_…`. Either is a header `curl -H @file` reads.

Load the package into a subshell's environment, and keep each header in a file only you can read:

```bash
(
  umask 077
  set -a
  . .pen-test-deployment/credentials-package.env
  set +a
  pnpm --silent pen-test:sign-in victim >victim.header
  pnpm --silent pen-test:sign-in secondApp >second-app.header
)
curl -H @victim.header http://localhost:43320/app/me
curl -H @second-app.header http://localhost:43320/v1/templates
```

`src/pen-test/deployment/sign-in.test.ts` proves that it signs in as every fixture User, authenticates with every live fixture key, and refuses a credential passed as a flag.

## Expected state changes

A probe changes the deployment, and so does the platform's own work. These are expected, so a tester doesn't file them as findings:

| What you see                                                                              | Why                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A new row in `sessions` each time the harness signs in as a User, and expired ones gone   | Each sign-in makes a session; making one sweeps the expired ones (`src/access/users.ts`)                                                  |
| `last_used_at` moves on the `wizzaroo` and `secondApp` keys                               | Every authenticated `/v1` call writes it (`src/access/api-keys.ts`)                                                                       |
| New Messages, and emails in Mailpit, after a send                                         | The worker sends each queued Message; queued fixture Messages have no job and stay queued                                                 |
| The two Wizzaroo Messages older than 90 days disappear after 03:30 UTC                    | The nightly Retention sweep                                                                                                               |
| A new backup on the stand-in remote after 02:00 UTC, and ones older than 14 nights gone   | The nightly backup                                                                                                                        |
| Anything another tester's probe did: a changed Template, a deleted User, changed Settings | Testers share the deployment. Check the scope issues' logs of fixture ids below before filing, and load the fixtures again to start clean |

Anything else that changes without a tester having done it is worth a note on the scope issue.

**Log the fixture ids you used.** Each probe records, in its scope issue's findings note, the fixture handles and ids it acted as and acted on, and anything it changed but didn't put back. That is how a tester tells their own changes from another's, and from a finding.

## Revoking it at the end

Every credential issued for the round ends with the deployment: teardown deletes the seed they all come from, the Users and keys go with the volume, and so do the deployment's own secrets. The [statement of work](./statement-of-work.md)'s sixth condition is met by marking each line below with the date it was revoked, and posting it on the E3 issue (#89):

| Credential                                                | How it is revoked                                                              | Revoked on |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------- |
| `victim`'s and `colleague`'s passwords                    | The Users go with the Postgres volume at teardown                              |            |
| The `wizzaroo` and `secondApp` keys                       | The keys go with the Postgres volume at teardown                               |            |
| The fixture seed and the credentials package              | `.pen-test-deployment/` deleted at teardown                                    |            |
| The deployment's `POSTGRES_PASSWORD` and `ENCRYPTION_KEY` | `.pen-test-deployment/.env` deleted at teardown                                |            |
| The stand-in rclone configuration and age identity        | `.pen-test-deployment/` deleted at teardown, with the `backup-stand-in` volume |            |
| Each tester's own copy of the package                     | Deleted by the tester, who says so on the E3 issue                             |            |
