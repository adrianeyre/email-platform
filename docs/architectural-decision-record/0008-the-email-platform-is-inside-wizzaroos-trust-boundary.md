# The email platform is inside Wizzaroo's trust boundary

Wizzaroo sends every account email through this platform: password resets, Invites, email address checks and passkey notices. Each is rendered here, and the log keeps the rendered body, working link included, for Retention's 90 days by default. So whoever can read this platform's log, database or backups, or rewrite its Templates, can take over Wizzaroo adults' accounts, staff included, whatever Wizzaroo's own defences are. Until now the platform has been treated as a tool that sits outside Wizzaroo and is secured on its own terms.

## Decision

- **The platform is part of Wizzaroo's trust boundary.** Its security is judged by what a breach of it does to Wizzaroo, not by what the platform itself holds.
- **Growth waits on a pen-test round.** Before Wizzaroo adds a second School, or any Application other than Wizzaroo is given an API Key, the round in [the pen-testing PRD](../product-requirements-document/pen-testing.md) is run, an external round follows it, and every finding above low from both is remediated or waived in writing by the owner.
- **Wizzaroo's second-School gate names this round** beside its own pen test, so the gate one repository enforces covers what the other holds.

## Consequences

- Adding a second Application, even a harmless one, is blocked until both rounds close. The cheaper alternative, a second install per Application ([ADR 0005](0005-templates-and-sending-only.md)), keeps Wizzaroo's links out of the other Application's reach, but not out of this one's.
- A finding here that exposes Wizzaroo's links is triaged with Wizzaroo: the owner decides the same day whether live reset and Invite links must be expired.
- "Every User has full rights" and API Keys with no scope ([ADR 0005](0005-templates-and-sending-only.md)) stand until the round's findings say otherwise. A change to them is made against a finding, not ahead of one. The round's findings #113, #117 and #118 did so for keys: [ADR 0009](0009-api-keys-belong-to-an-application.md) scopes each to its Application.
- Considered and rejected: securing the platform to its own, lower bar and accepting that a breach here is a breach of Wizzaroo. That fails the moment Wizzaroo holds a second School's children's data behind those links.
