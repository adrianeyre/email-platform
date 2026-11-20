# Glossary

**User**
: A person who signs in to the UI with an email and password. Every User can do everything. The first one is created with `pnpm cli user:create`.

**API Key**
: A secret that lets an application call the `/v1` API as a Bearer token (`ek_…`). It is shown once and stored as a hash.

**Template**
: A named email: a subject, an HTML body, an optional text body, and the names of its **required variables**. All three parts are rendered with Handlebars. When the text body is empty, it is generated from the rendered HTML.

**Slug**
: A Template's short, unique handle for applications, such as `order-shipped`: 1 to 100 lowercase letters, numbers and hyphens, with no spaces. Applications send by it as `templateSlug`. A new Template's slug is made from its name; it can be edited, and renaming the Template keeps it.

**Design**
: The blocks a Template was made from in the visual designer, saved beside its HTML. Sending uses only the HTML. A Template whose HTML was written by hand has no Design.

**Block**
: One part of a Design: Text, Button, Image, Columns, Divider, Spacer or HTML. Every Block can have spacing, a box (background, border and rounding), a "show only if" variable and "hide on phones".

**Built-in email**
: One of the account and security emails that come with the app as Designs, such as "Reset your password". Add them with `pnpm cli templates:add-built-ins`, or one at a time from the new template gallery.

**Header** and **Footer**
: Content shared by Templates, shown above or below a Template's own content when it is sent, such as a logo or legal notes. Each is made in the same designer as a Template. Changing one changes every Template using it, straight away.

**Configuration**
: Settings shared by Templates: a name, a from email address and a from name. A Template using one is sent from `From name <from email address>` when the send request gives no from address. The built-in "Wizzaroo" Configuration sends from `Wizzaroo <no-reply@wizzaroo.adrianeyre.co.uk>`.

**Delivery**
: The page for the Settings below: the SMTP provider, default from address (`no-reply@adrianeyre.co.uk` on a new install) and log retention.

**Appearance**
: The colour mode (System, Light or Dark) and theme (Sky, Grape, Forest, Sunset, Berry or Lagoon) chosen on the Settings page from the account menu. It is saved in the browser, not on the server.

**Sample variables**
: Example values saved with a Template. They are used for the live preview and for test sends.

**Message**
: One email the app has been asked to send, and its row in the log. Its status is `queued`, then `sent` or `failed`. The row keeps the rendered subject and bodies, the recipients, the attempt count, the provider's message ID and the last error.

**Settings**
: The single set of options for the app: the SMTP provider (host, port, TLS, username and the encrypted password), the default from address, and the log retention in days.

**SMTP provider**
: The mail service the worker hands each Message to, such as Amazon SES SMTP, Postmark or Mailpit in development.

**Retention**
: How many days Messages are kept. A daily job deletes older ones.

**Idempotency-Key**
: An optional header on `POST /v1/messages`. Repeating a key returns the first Message instead of sending again.
