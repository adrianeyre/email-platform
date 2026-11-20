# The visual designer keeps a design beside the HTML

ADR 0005 left out a visual builder. Writing table-based email HTML by hand turned out to be the hardest part of using the app, so templates now have a visual designer. It has blocks such as text, buttons, images and columns, and full text formatting. The app also comes with built-in emails as designs.

## Decision

- **The design is stored beside the HTML,** in a nullable `templates.design` JSON column. It is never used for sending. The send path, the worker and the API stay the same: the HTML is still the template.
- **The browser renders the HTML from the design** when a template is saved, using `src/templates/design/render-html.ts`. That module is plain string building, with no DOM, so the server uses the same code for the built-in emails (`pnpm cli templates:add-built-ins`).
- **A design is read defensively** (`parseDesign`). Unknown blocks are dropped and values are clamped to their ranges, since a design can also arrive through the API.
- **Rich text uses TipTap** (ProseMirror), whose schema keeps only known marks and nodes. Its HTML is given the inline styles that mail apps need when it is rendered.
- **Custom HTML on the canvas is shown in a frame that runs no scripts,** like the preview.
- **Templates can be sent by name** (`templateName`) as well as by ID, so an application can use the same name in every install. This is what the `@adrianeyre/email-client` package does.

## Consequences

- A template's HTML and design can disagree if a client writes both. A `PUT` without `design` clears it, so the HTML the API sets always wins.
- Editing the HTML by hand takes a template out of the designer. Opening hand-written HTML in the designer turns it into one HTML block, and styles in its `<head>` are dropped.
- The UI bundle grows by the TipTap packages.
