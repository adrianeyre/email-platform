# @adrianeyre/email-client

A small TypeScript client for sending emails through the email app's templates. It has no runtime dependencies and needs Node 20 or later (it uses the global `fetch`).

## Install

The package is published to GitHub Packages. Add an `.npmrc` next to your app's `package.json`:

```ini
@adrianeyre:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` must be a classic personal access token with the `read:packages` scope (in GitHub Actions, the workflow's own `GITHUB_TOKEN` works when the workflow has `packages: read`). Then:

```sh
pnpm add @adrianeyre/email-client
```

## Create a client

```ts
import { createEmailClient } from "@adrianeyre/email-client";

const email = createEmailClient({
  baseUrl: "https://mail.example.com",
  apiKey: process.env.EMAIL_API_KEY, // an API key from the app, starting ek_
  defaultFrom: "Wizzaroo <noreply@wizzaroo.example.com>", // optional
  timeoutMs: 10_000, // optional, the default
  // fetch: customFetch, // optional, defaults to the global fetch
});
```

`createEmailClient` throws at once if the API key is missing. Without `from` or `defaultFrom`, the app uses the from address of the template's configuration, or else the default from address in its Delivery settings. A `defaultFrom` is sent with every email, so it wins over a template's configuration: leave it out to let the app choose.

## Send a template

`template` is a template's **exact name** or its **ID**. A UUID is sent as `templateId`; anything else is sent as `templateName`, which must match the name of a template in the email app.

```ts
const message = await email.send({
  template: "Order shipped",
  to: "ada@example.com", // a string or up to 50 addresses
  variables: { name: "Ada", orderId: "1042" },
});
// message.id, message.status: "queued"
```

The send is queued: the response says `status: "queued"`, and `email.getMessage(message.id)` later says `sent` or `failed`.

## Send a template by its slug

A template's **slug**, such as `order-shipped`, is shown on its page in the email app. It stays the same when the template is renamed, so it is the steadiest way to name one. `sendBySlug` sends it as `templateSlug`:

```ts
await email.sendBySlug({
  slug: "order-shipped",
  to: "ada@example.com",
  variables: { name: "Ada", orderId: "1042" },
});
```

A built-in email's slug, such as `wizzaroo-reset-your-password`, has its variables checked at compile time, as with `send`.

## Built-in emails

The built-in emails are typed, so a missing or misspelt variable fails at compile time. Use a helper on `email.builtIn`, which sends by the template's slug:

```ts
import { maskEmailAddress } from "@adrianeyre/email-client";

await email.builtIn.resetYourPassword({
  to: user.email,
  variables: {
    email: user.email,
    resetUrl: `https://app.example.com/reset?token=${token}`,
    linkLifetime: "1 hour",
  },
});

await email.builtIn.emailChangeRequested({
  to: user.email,
  variables: {
    email: user.email,
    newEmailMasked: maskEmailAddress(newEmail), // "a•••@example.com"
    requestedAt: "20 November 2026 at 10:48 (UK time)",
  },
});
```

or `send` with the template's name, or `sendBySlug` with its slug, which are checked the same way:

```ts
await email.send({
  template: "Wizzaroo - Password changed",
  to: user.email,
  variables: {
    email: user.email,
    changedAt: "20 November 2026 at 10:48 (UK time)",
  },
});
```

Dates and times are strings you format; lifetimes are phrases such as `"24 hours"`. The `BuiltInEmails` type lists every built-in email and its variables (`BuiltInEmailsBySlug` does the same by slug), `builtInEmailNames` maps each helper to its template name, and `builtInEmailSlugs` to its slug.

| Helper                     | Template                                | Slug                                    |
| -------------------------- | --------------------------------------- | --------------------------------------- |
| `confirmYourEmailAddress`  | Wizzaroo - Confirm your email address   | `wizzaroo-confirm-your-email-address`   |
| `resetYourPassword`        | Wizzaroo - Reset your password          | `wizzaroo-reset-your-password`          |
| `teacherInvite`            | Wizzaroo - Teacher invite               | `wizzaroo-teacher-invite`               |
| `parentInvite`             | Wizzaroo - Parent invite                | `wizzaroo-parent-invite`                |
| `passwordChanged`          | Wizzaroo - Password changed             | `wizzaroo-password-changed`             |
| `passkeyAdded`             | Wizzaroo - Passkey added                | `wizzaroo-passkey-added`                |
| `passkeyRemoved`           | Wizzaroo - Passkey removed              | `wizzaroo-passkey-removed`              |
| `emailChangeRequested`     | Wizzaroo - Email change requested       | `wizzaroo-email-change-requested`       |
| `emailAddressChanged`      | Wizzaroo - Email address changed        | `wizzaroo-email-address-changed`        |
| `signInCodesPaused`        | Wizzaroo - Sign-in codes paused         | `wizzaroo-sign-in-codes-paused`         |
| `familyDeviceSignedIn`     | Wizzaroo - Family Device signed in      | `wizzaroo-family-device-signed-in`      |
| `twoFactorTurnedOff`       | Wizzaroo - Two-factor turned off        | `wizzaroo-two-factor-turned-off`        |
| `emailAddressAlreadyInUse` | Wizzaroo - Email address already in use | `wizzaroo-email-address-already-in-use` |
| `familyJoinRequest`        | Wizzaroo - Family join request          | `wizzaroo-family-join-request`          |
| `adultJoinedFamily`        | Wizzaroo - Adult joined Family          | `wizzaroo-adult-joined-family`          |

The templates must exist in the email app with these slugs, which they get when added from the **Start from a built-in email** gallery in the UI or with `pnpm cli templates:add-built-ins` on the server. An email app from before slugs needs its migrations run (`pnpm migrate`), which gives each template a slug made from its name. You can restyle and rename them in the app; keep the slugs and variables.

## Send raw content

```ts
await email.sendContent({
  to: "ada@example.com",
  subject: "Hello",
  html: "<p>Hi Ada</p>", // html, text or both; text is generated from html when left out
});
```

## Options on every send

| Option           | Notes                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| `to`             | A string or an array, 1 to 50 addresses                               |
| `cc`, `bcc`      | A string or an array, up to 50 each                                   |
| `from`           | Overrides `defaultFrom`                                               |
| `replyTo`        | One address                                                           |
| `attachments`    | `[{ filename, content, contentType? }]`; `content` is bytes or base64 |
| `idempotencyKey` | Sent as the `Idempotency-Key` header                                  |

The whole message, attachments included, must be 25 MB or less.

## Idempotency

Pass an `idempotencyKey`, such as an ID with an event name, to make retries safe. A repeated key returns the first message and doesn't send again:

```ts
await email.send({
  template: "Order shipped",
  to: "ada@example.com",
  variables: { orderId: "1042" },
  idempotencyKey: "order-1042-shipped",
});
```

## Errors

```ts
import {
  EmailApiError,
  EmailNetworkError,
  EmailTimeoutError,
} from "@adrianeyre/email-client";

try {
  await email.send({ template: "Order shipped", to: "ada@example.com" });
} catch (error) {
  if (error instanceof EmailApiError) {
    // The app refused: error.status (such as 401, 404, 422), error.code (such as "validation_failed"),
    // error.message, and error.fieldErrors: [{ field, message }], such as a missing variable.
  } else if (error instanceof EmailTimeoutError) {
    // No answer within timeoutMs. The email may still have been queued, so retry with the same idempotencyKey.
  } else if (error instanceof EmailNetworkError) {
    // The app couldn't be reached; error.cause has the underlying failure.
  }
  throw error;
}
```

`EmailTimeoutError` is a kind of `EmailNetworkError`.

## Reading

```ts
const message = await email.getMessage(id); // status: "queued" | "sent" | "failed"
const templates = await email.listTemplates();
const template = await email.getTemplate(templateId);
```

## Publishing

Bump `version` in `package.json` in a pull request. When it merges to `main`, the **Publish email client** workflow typechecks, tests, builds and publishes the package to GitHub Packages. A version that is already published is skipped, so changes that don't bump the version publish nothing. The workflow can also be run by hand from the Actions tab.
