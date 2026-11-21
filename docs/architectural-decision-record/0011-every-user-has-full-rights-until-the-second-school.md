# Every User has full rights until the second School

[ADR 0005](0005-templates-and-sending-only.md) decided that every User has full rights, and recorded nothing about when that stops being true. [ADR 0008](0008-the-email-platform-is-inside-wizzaroos-trust-boundary.md) let it stand "until the round's findings say otherwise". Pen test A2 found it recorded as a decision with no end (#146): any one User's session may change Settings, mint an API Key, delete an API Key or delete another User, and nothing says how long that is meant to be so. Since the second round, adding a User, minting an API Key and deleting a User ask for the current password (#115), and the other Users are told of each (#125), so a stolen session can no longer do those quietly. Changing Settings, Retention included, still needs only a session.

## Decision

- **"Every User has full rights" stays, for now.** The install has one operator and a handful of trusted Users, all of whom run it; roles would protect no one from anyone today.
- **It stops being true before Wizzaroo adds a second School, or before any Application other than Wizzaroo is given an API Key**, whichever comes first: the same gate [ADR 0008](0008-the-email-platform-is-inside-wizzaroos-trust-boundary.md) sets for the external round. Before either, the owner decides, in a new ADR, who may change Settings, manage API Keys and manage Users, and which of those a User who only edits Templates must not have. "Keep full rights" is an allowed answer, but it has to be written down with the evidence for it.
- **Review on 2027-05-21, or at the external round, whichever is sooner.** The review reads the Users the install has and what each does, and either sets the next review date here or replaces this ADR.

## Consequences

- One stolen session still holds every power not behind the current password: changing Settings and Retention, deleting an API Key. Retention can't be used to keep a Message's body past seven days ([ADR 0012](0012-a-message-body-is-kept-at-most-seven-days.md)).
- The second-School and second-Application gates now carry one more item: a decision on User rights, not only on the round's findings.
- Considered and rejected: adding roles now. With one operator it is code, tests and UI that protect nothing yet, and the right split of rights depends on who the second School's Users turn out to be.
