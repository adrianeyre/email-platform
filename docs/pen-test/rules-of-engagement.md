# Pen test: rules of engagement

The rules every tester in the first pen-test round of the email platform works to: when testing happens, what may be touched, what may not, and how a critical finding reaches the owner. The brief is [the pen-testing PRD](../product-requirements-document/pen-testing.md), and what has to be true for the round to close is [the statement of work](./statement-of-work.md). This page names hosts and how the round is run, so it is kept private on the same terms as the PRD.

**Status:** In force from 21 November 2026, when the owner confirmed the window and the out-of-band channel on the E3 issue (#89).

## Amendments

| Date             | Change                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 21 November 2026 | The owner confirmed the window's opening and the out-of-band channel as proposed. The window's close moves forward from 18 December 2026 to the day the re-verification run ends: every scope issue is probed and every finding is fixed, so the one testing left is running every probe again on a fresh deployment, after which it is torn down. That day is recorded here when it comes |

## Who tests, and on whose authority

The owner, Adi, authorises this round and is the only person who can change these rules, pause testing or end it. In this first round the testers are the owner and the agents (Sandcastle) working each scope issue under `prd:pen-test`. Nobody else tests, and an agent tests only within its own scope issue.

The external round ([the pre-condition](../product-requirements-document/pen-testing.md#pre-condition-an-external-round-before-the-gate)) is run under a revision of this page that names its tester and its own window. Everything else here carries over to it unless that revision says otherwise. It may be the same engagement as Wizzaroo's external round, with this platform in its scope.

## The window

Confirmed by the owner on 21 November 2026, and amended the same day (see [Amendments](#amendments)): the window opened on **Friday 20 November 2026 at 09:00** UK time, the day E1 to E5 were delivered, and **closes at the end of the day the re-verification run ends**, when every probe has been run again on a fresh pen-test deployment and that deployment has been torn down. It closes no later than **Friday 18 December 2026 at 17:00** UK time, the date first proposed. Inside it, testing may happen at any hour.

Why these dates: the enablement issues and the first probes of every scope issue were delivered together, so there was no reason to wait. Every scope issue is probed and every finding fixed, so the four weeks first proposed would hold nothing but the re-run; closing when it ends lets the round be signed off. Any hour, because the agents run unattended and the deployment holds only synthetic data. The external round sets its own hours, when the owner can answer within 30 minutes.

- **The window opens only when every enablement issue (E1 to E5) is ready,** even if the date has passed. If they aren't ready, this page is amended with new dates. The window doesn't slip without a recorded change.
- **No testing happens outside the window.** A probe that is still running when the window closes is stopped, not finished.
- **The owner can pause testing at any time** by saying so on the scope issues. Testing starts again only when the owner says so in the same place.
- **The window can be extended only by an amendment to this page,** dated and made before the close.

## In scope: the pen-test deployment only

Testing is aimed at **the pen-test deployment E1 stands up**, and at nothing else. [Its runbook](./deployment.md) is the record of its hosts. Each must meet every condition below; one that fails any of them is out of scope until E1 fixes it.

| In scope                                                                                                                     | Condition it must meet                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The deployment's origin, `http://localhost:43320`, the one URL testers send requests to                                      | Published on `127.0.0.1` only, so reachable only by testers on the machine running it or over SSH. Never the production instance at `email.home` or on the tailnet, not even its `/health`                                      |
| The deployment's own Compose project, `email-platform-pen-test`: its `api`, `worker`, `postgres`, `backup` and `mailpit`     | A project name other than production's `email-platform`, its own Postgres volume and its own `.env` in `.pen-test-deployment/`. No published port that is 4320                                                                  |
| Its Mailpit, at `http://localhost:43325`                                                                                     | Every email the deployment sends is caught there and never delivered                                                                                                                                                            |
| Its throwaway backup remote, the `backup-stand-in` volume, and its throwaway age key                                         | Never the real rclone remote and never the real age identity                                                                                                                                                                    |
| The gated run's own containers: the Postgres and Mailpit each probe test starts with Testcontainers (`src/pen-test/probes/`) | Started and destroyed by the test run itself, holding only the fixtures. This is where privilege and database probes run, as [the checks](../product-requirements-document/pen-testing.md#checks-every-scope-issue-carries) ask |
| The source, read-only                                                                                                        | This repository at the commit the round is run against, `.github/workflows/` included. Read, never pushed to outside an agent's own branch, and no workflow is run to probe it                                                  |

**The boundary is the deployment, not the machine it runs on.** If a probe reaches the host (a container escape, the Docker socket, the host's files or another Compose project, production's above all), prove it with one read-only command, stop, and report it. Change nothing on the host, because the host may also run production.

## Out of scope

The exclusions under [Explicitly out of scope](../product-requirements-document/pen-testing.md#explicitly-out-of-scope) in the PRD, with what each means for a tester:

- **The production instance** on the home server and its data, and the home network and tailnet beyond the deployment. No request goes to it at all, `/health` included.
- **SMTP providers (Amazon SES, Postmark, Fastmail…), GitHub, GitHub Pages and GitHub Packages as platforms.** How the platform uses them is in scope, read from the source and the deployment. The platforms themselves, and other customers on them, are not.
- **Denial of service and volume testing.** A missing limit is worked out by arithmetic (H11). Send only as many requests as it takes to see a behaviour happen once, such as the eleventh sign-in, never a load.
- **Social engineering, phishing, and physical access** to the home server or the backup remote. Nobody is contacted to test them, including the owner.
- **Wizzaroo itself.** What Wizzaroo sends here, and what a reader here can do with it, is in scope; Wizzaroo's own servers are not.
- **The public website** (`site/`), except for what it publishes from the repository (H17).

## How testers behave

- **No destructive testing outside the deployment.** Inside it, a tester may delete rows, break Templates, fail backups or restart containers, because it is torn down with its volume at the end. To recover, load the fixtures again (`pnpm pen-test:seed`); don't hand-repair the data. Outside the deployment, nothing destructive is done, anywhere, for any reason.
- **Synthetic data only.** Only E2's fixtures, and data made up for a probe, with addresses under `pen-test.invalid`. Never a real person's name or address, and never a real Wizzaroo link.
- **Only the credentials the package issues.** Testers use the fixture Users and API Keys in [E4's credentials package](./credentials-package.md) and nothing else. Finding a secret the package didn't issue is a finding:
  - a secret of **the deployment's** (its `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, rclone configuration or age identity) may be used inside the deployment just far enough to show its impact, and reported;
  - a secret of **anything else** (production's `.env`, the real SMTP provider, the real rclone remote or age identity, the GitHub token) is not used at all, not even to check it works. Report it at once as `severity:critical`, so the owner rotates it.
- **Reaching production or real data by accident ends the probe.** Stop, keep no copy, tell the owner at once by [the out-of-band channel](#the-out-of-band-channel), and record what happened in the scope issue's findings note without the data itself.
- **No secret leaves the deployment.** No password, cookie, API Key, seed or connection string goes into an issue, a findings note, a commit, a log or a prompt. Name the fixture identity instead.
- **A probe does not fix.** Nothing found is fixed in the scope issue that found it; each fix is its own issue against its finding.

## Reporting

Findings are filed and triaged as [the findings workflow](./README.md) and [the PRD](../product-requirements-document/pen-testing.md#findings-workflow) describe. The remediation targets that start at triage are [the table in the PRD](../product-requirements-document/pen-testing.md#findings-workflow), which is their only home.

- **In this first round,** a critical finding is filed as an issue straight away, because the testers report to the owner, the repository is private and the data is synthetic.
- **In the external round,** a critical finding never starts life as a GitHub issue. It goes to the owner by the out-of-band channel below. The issue is filed once a fix is in hand.

## The out-of-band channel

Used in the external round for a critical finding, and in either round when a tester reaches production or real data by accident.

Confirmed by the owner on 21 November 2026: **a phone call to the owner's mobile, then a Signal message to the same number if the call isn't answered.** The number goes to the external tester with the credentials package (E4), never in this repository, an issue or a prompt.

Why: a phone reaches the owner away from the computer, so the 30 minutes can be met, and Signal is end-to-end encrypted and waits if the call is missed. A GitHub issue isn't out-of-band, because everyone with access to the repository reads it before the fix exists. Email isn't either, because the account it would go to may be part of what was compromised. It matches Wizzaroo's channel, so one external engagement can use one channel for both.

1. **The first message carries no exploit detail:** that it is the email platform's pen test, that the finding is critical, the scope issue's ID, and the time it was found.
2. **The owner acknowledges on the same channel.** If there is no acknowledgement **within 30 minutes, testing pauses** until there is one.
3. **The detail goes over the agreed end-to-end encrypted channel,** never by email or in an issue.
4. **The finding issue is filed once a fix is in hand,** with the time of first contact and of acknowledgement recorded in it.

## The end of the window

When the window closes, testing stops. What has to be true before the round is signed off, the deployment's teardown and every credential's revocation included, is in [the statement of work](./statement-of-work.md).

## Changing these rules

This page changes only by a pull request the owner approves. A change made during the window carries its date beside the rule it changes, and the scope issues it affects are told on the issue.
