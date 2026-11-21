# The visual designer keeps a design beside the HTML

ADR 0005 left out a visual builder. Writing table-based email HTML by hand turned out to be the hardest part of using the app, so templates now have a visual designer. It has blocks such as text, buttons, images and columns, and full text formatting. The app also comes with built-in emails as designs.

## Decision

- **The design is stored beside the HTML,** in a nullable `templates.design` JSON column. It is never used for sending. The send path, the worker and the API stay the same: the HTML is still the template.
- **The browser renders the HTML from the design** when a template is saved, using `src/templates/design/render-html.ts`. That module is plain string building, with no DOM, so the server uses the same code for the built-in emails (`pnpm cli templates:add-built-ins`).
- **A design is read defensively** (`parseDesign`). Unknown blocks are dropped and values are clamped to their ranges, since a design can also arrive through the API.
- **A design's own fields are rendered only when they are what they claim to be** (pen test S3, #153, #154, #156). A Block's condition is written into `{{#if …}}` only when it is one variable path; a Button's link, an Image's source and link and a Socials address only when they are http(s), `mailto:`, `tel:`, `#` or start with a `{{variable}}`; a font only when it is a font stack. Anything else is dropped when rendering (`safeCondition`, `safeUrl`, `safeFont` in `render-html.ts`), not refused, as the rest of a design is read: a design is free-form JSON on the API, and the HTML it renders is what is sent. The browser and the server render with the same code, so both drop the same values.
- **Rich text uses TipTap** (ProseMirror), whose schema keeps only known marks and nodes. Its HTML is given the inline styles that mail apps need when it is rendered.
- **Custom HTML on the canvas, and a Header or Footer shown in line, are in frames that are `sandbox=""`,** like the previews: no scripts, and an opaque origin, so the frame shares nothing with the app (#155). The app can't read such a frame's height, so each starts at a set height the author can drag. The content-security policy that limits what such a frame may load from other hosts is the server's (#170).
- **Templates can be sent by name** (`templateName`) as well as by ID, so an application can use the same name in every install. This is what the `@adrianeyre/email-client` package does.

## Consequences

- A template's HTML and design can disagree if a client writes both. A `PUT` without `design` clears it, so the HTML the API sets always wins.
- Editing the HTML by hand takes a template out of the designer. Opening hand-written HTML in the designer turns it into one HTML block, and styles in its `<head>` are dropped.
- The UI bundle grows by the TipTap packages.
