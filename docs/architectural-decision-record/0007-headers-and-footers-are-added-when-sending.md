# Headers and footers are added when sending

Templates that share a look, such as the 15 Wizzaroo emails, each kept their own copy of the logo and the closing note. Changing the logo meant changing every template.

## Decision

- **Headers and Footers** are their own records (`email_parts`, with a `kind`), made in the same designer as Templates. A Template may name one of each (`header_id` and `footer_id`; deleting a part sets them to null).
- **A Template's HTML stays its own content.** The server adds its Header and Footer each time it renders it: for a send, a test send and the preview (`src/templates/compose.ts`). So a change to a Header reaches every Template using it at once, with nothing to re-save.
- **A designed Template stays one email.** When the Template has a design, the parts' blocks are put before and after its own, and the whole design is rendered with the Template's settings: its width, colours and fonts. A hand-written Template has the parts' HTML put just inside its `<body>`.
- This refines ADR 0006. Sending still never reads a design alone: a Template with no Header or Footer is sent with exactly its HTML.

## Consequences

- Every send of a Template with a Header or Footer renders its design again, which costs a few milliseconds.
- A Header written for one look can sit oddly in a Template with different settings. The designer shows the parts in place, locked, so this is seen while editing.
- The built-in Wizzaroo emails use a "Wizzaroo" Header with the logo's SVG inline, and a "Wizzaroo" Footer. Gmail and Outlook on Windows don't display inline SVG, so they show these emails without the logo. If that matters, change the Header's HTML block to an image of the PNG logo.
