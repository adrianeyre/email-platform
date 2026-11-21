# Pen test: statement of work

What the first pen-test round of the email platform delivers, and what must be true before the owner signs it off. The brief is [the pen-testing PRD](../product-requirements-document/pen-testing.md), and how testing is done is [the rules of engagement](./rules-of-engagement.md).

**Status:** Unsigned. **It stays unsigned until the round closes.** A statement of work signed before the work is done records nothing, so a signature given before every condition below is met counts for nothing and is taken off.

## Parties

- **The owner,** Adi, who commissions the round, triages its findings, writes its waivers and signs this statement.
- **The testers** named in [the rules of engagement](./rules-of-engagement.md#who-tests-and-on-whose-authority): the owner and the agents working each scope issue.

## The work

The round as the PRD describes it, and nothing beyond it:

- **The enablement issues, E1 to E5,** delivered before the window opens.
- **Every scope issue** in [the scope partition](../product-requirements-document/pen-testing.md#scope-partition), worked inside [the window](./rules-of-engagement.md#the-window) against [the pen-test deployment and the gated run](./rules-of-engagement.md#in-scope-the-pen-test-deployment-only) only. Each delivers a findings note at `docs/pen-test/findings/<ID>.md` with a verdict for each probe, probe tests in the gated run, one finding issue per confirmed weakness, and its H entries in the PRD amended with their verdicts.
- **The two issues that build rather than probe,** named under the scope partition: checking pull requests in CI, and adding this round to Wizzaroo's second-School gate.

Fixing a finding is not part of a scope issue. Each fix is its own issue, against its finding, and counts here only through the conditions below.

## What signing means

Signing this statement **closes the first round**. It does not meet Wizzaroo's second-School gate, and it does not let another Application be given an API Key. Those also need every finding above `severity:low` remediated or waived in writing, and [the external round](../product-requirements-document/pen-testing.md#pre-condition-an-external-round-before-the-gate) run and closed the same way ([ADR 0008](../architectural-decision-record/0008-the-email-platform-is-inside-wizzaroos-trust-boundary.md)). Medium findings can still be open when this is signed; they cannot be open at the gate.

## Sign-off conditions

The round closes when all six hold. Each comes from the PRD's [success criteria](../product-requirements-document/pen-testing.md#success-criteria). Before signing, the owner posts on the E3 issue (#89), for each condition, the evidence listed beside it. A condition with no evidence posted is not met.

| #   | Condition                                                                                                                                                                                                                                                                                                                                     | Evidence posted on the E3 issue                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The pen-test deployment is destroyed,** volume and all, not just its containers. Its origin no longer answers, its throwaway backup remote and age key are gone with it                                                                                                                                                                     | `pnpm pen-test:down`, run, with its output. Then `docker compose ls`, `docker ps -a` and `docker volume ls --filter label=com.docker.compose.project=email-platform-pen-test` on the machine it ran on, showing none of it. A request to its origin that fails |
| 2   | **Every finding has exactly one severity:** one of `severity:critical`, `severity:high`, `severity:medium` or `severity:low`. No more, no fewer                                                                                                                                                                                               | The list of every issue under `prd:pen-test` filed as a finding, with its labels, showing one `severity:*` label each                                                                                                                                          |
| 3   | **Every critical and high finding is fixed or waived in writing.** Fixed means verified, not just merged: the probe that found it has been run again, before the deployment was destroyed where it needs it, and passes. Waived means the owner wrote the rationale in the issue, with the date it stops being true, before `wontfix` went on | For each critical and high finding: the issue, and either the re-run that passed (commit, test and output) or the link to the owner's written waiver                                                                                                           |
| 4   | **Every hypothesis has a verdict.** Every entry in the opening register, H1 to H17 and any added during the round, says confirmed (with its findings), refuted, or confirmed as a documented decision. **H1, H2 and H3 have a dated answer:** fixed, or a recorded decision naming the date they stop being true                              | The PRD's opening register at the closing commit, with H1, H2 and H3's dates quoted                                                                                                                                                                            |
| 5   | **The PRD is amended in place,** so the next round doesn't start from stale text. Every H entry carries its verdict and its findings' issue numbers, each fixed finding is marked fixed with the date it was verified, and the Status line records the round closed and when                                                                  | The commit or pull request that amends the PRD                                                                                                                                                                                                                 |
| 6   | **Every credential issued for the round is revoked:** every fixture User's password, every fixture API Key, the fixture seed, and the deployment's own `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, rclone configuration and age identity                                                                                                           | [E4's list](./credentials-package.md#revoking-it-at-the-end), with each credential marked revoked and the date it was revoked                                                                                                                                  |

Two success criteria are checked during the round, not at sign-off: criterion 1, every scope issue filed before the window opens, when [the window](./rules-of-engagement.md#the-window) opens, and criterion 3, every finding filed within one working day of being found, at each finding's [triage](./README.md#triage-the-same-working-day). Criterion 6, every finding above low remediated before the gate, belongs to [the gate](#what-signing-means), not to this round.

## Signature

Left empty until every condition above is met. The owner signs by commenting on the E3 issue (#89), "I sign the statement of work for the first pen-test round of the email platform.", once the evidence is posted there, and then fills this block in with a link to that comment.

| Signed by | Date | Commit the round closed at | Signing comment |
| --------- | ---- | -------------------------- | --------------- |
|           |      |                            |                 |
