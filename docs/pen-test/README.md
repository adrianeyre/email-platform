# Pen-test findings workflow

How a finding from a pen-test round of the email platform is filed, triaged, waived, fixed and verified. The brief, the severities and the remediation targets are in [the pen-testing PRD](../product-requirements-document/pen-testing.md), and this page restates none of them. Everything under `docs/pen-test/`, the findings notes in [`findings/`](./findings/) above all, names exploit chains, so it is kept private on the same terms as the PRD and is never added to `site/` or GitHub Pages.

The other pages here:

- [The pen-test deployment](./deployment.md) (E1): standing it up, seeding it and tearing it down.
- [The fixtures](./fixtures.md) (E2): every fixture identity and what it is for.
- [Rules of engagement](./rules-of-engagement.md) and [statement of work](./statement-of-work.md) (E3).
- [The credentials package](./credentials-package.md) (E4).
- [`findings/<ID>.md`](./findings/): one findings note per scope issue, with a verdict for every probe.

## Filing a finding

Every confirmed weakness is its own issue, filed with the **Pen-test finding** template ([`.github/ISSUE_TEMPLATE/pen-test-finding.yml`](../../.github/ISSUE_TEMPLATE/pen-test-finding.yml)) within one working day of being found. The template adds `prd:pen-test`; the filer adds exactly one severity label:

| Label               | Colour    |
| ------------------- | --------- |
| `severity:critical` | `#7f1d1d` |
| `severity:high`     | `#b91c1c` |
| `severity:medium`   | `#ef4444` |
| `severity:low`      | `#fca5a5` |

Which one applies is decided by the table under [Findings workflow](../product-requirements-document/pen-testing.md#findings-workflow). A finding filed without the new-issue page, by `gh issue create` or by an agent, uses the template's headings in its order, so every finding has one shape:

```markdown
### Scope issue

### H entry

### Rule broken

### Steps to reproduce

### Observed

### Expected

### Impact

### Wizzaroo's links exposed?

### Test that would have caught it
```

A finding names fixtures by handle or id (`victim`, `secondApp`, `7e570000-…`), never by a credential.

## Triage, the same working day

Triage happens on the working day the finding is filed, and the remediation clock starts when it ends. For each new finding:

1. **Reproduce it** on the pen-test deployment, or by running the probe test it names, from its steps alone. A finding that won't reproduce goes back to its filer with what happened instead, and the clock doesn't start.
2. **Confirm the severity** against [the targets](../product-requirements-document/pen-testing.md#findings-workflow). Swap the label if it is wrong, so the issue keeps exactly one, and say why in a comment.
3. **Check the shape:** the scope issue and H entry are named, the rule broken cites a guide section and an ADR, and the test that would have caught it is named.
4. **Link it back:** the scope issue's findings note in `findings/` and the H entry in the PRD name the finding's issue.
5. **Write the confirmation** as a comment: "Triaged on _date_; target _date_", the target counted in working days from the table.
6. **Add `owner`** if what happens next waits on the owner's decision.

A critical finding is told to the owner as soon as it is triaged. How it is reported in the first round and in the external round is under [Findings workflow](../product-requirements-document/pen-testing.md#findings-workflow).

### A finding that exposes Wizzaroo's links (H2)

A critical or high finding whose **Wizzaroo's links exposed?** answer is "Yes" is also Wizzaroo's. On the day it is triaged:

1. Link Wizzaroo's pen-test tracking issue from it, as the PRD says.
2. The owner decides, that day, whether Wizzaroo's live reset, Invite and email-check links must be expired, and writes the decision and its reason in the finding as a comment. "Not this time" is a valid decision; no decision is not.
3. If they must be, the expiry is done in Wizzaroo and the finding records when.

## Remediation targets

The working days each severity has, from triage, are the table under [Findings workflow](../product-requirements-document/pen-testing.md#findings-workflow). That table is their only home.

## `wontfix`

`wontfix` goes on only after the owner has written the rationale in the issue: what is accepted, why, and the date it stops being true. A `wontfix` label with no rationale above it is taken off until one is written. A waiver is the "waived in writing" that Wizzaroo's second-School gate counts.

## Fixed is not verified

A finding moves through two states after triage, and only the second ends it.

- **Fixed, unverified:** the fix's pull request says `Fixes #<n>`, written plainly, and turns the probe's `today_…` test into its `(regression)` test and its `it.fails` into an `it`, never deleting either. Merging closes the issue.
- **Verified:** the probe that found it has been run again, with the fix in, and passes, in the gated run and, where it needs the deployment, on the pen-test deployment. The run is posted on the issue (the commit, the test and its output), and the H entry in the PRD records the verdict and the date.

A probe that fails on re-run reopens the issue, and the clock carries on from the original triage. A finding answered by an ADR rather than code stays open until the code matches it, unless the ADR accepts the finding.

## Readiness

The round's window opens once every enablement issue is ready. Each row is amended by the issue it names.

| Issue    | Delivers                                                                                    | Where                                                                                    | Ready                      |
| -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| E1 (#87) | The pen-test deployment: its own Compose project, volume and `.env`, Mailpit, torn down     | `docs/pen-test/deployment.md`, `docker-compose.pen-test.yml`, `src/pen-test/deployment/` | Yes                        |
| E2 (#88) | Fixtures: two Users, three API Keys, the Built-in emails and Messages, as a plan and loader | `docs/pen-test/fixtures.md`, `src/pen-test/fixtures/`                                    | Yes                        |
| E3 (#89) | Rules of engagement and statement of work                                                   | `docs/pen-test/rules-of-engagement.md`, `docs/pen-test/statement-of-work.md`             | Yes, the window to confirm |
| E4 (#90) | The credentials package and the sign-in harness                                             | `docs/pen-test/credentials-package.md`, `src/pen-test/deployment/sign-in.ts`             | Yes                        |
| E5 (#91) | The findings workflow: severity labels, the finding template and this page                  | `.github/ISSUE_TEMPLATE/pen-test-finding.yml`, `docs/pen-test/README.md`                 | Yes                        |
