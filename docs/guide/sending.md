# Sending

Applications send with `POST /v1/messages`, using an API key as a Bearer token. The full reference is at `/docs` on a running app, for a signed-in user (open it in the browser you use the UI in) or an API key holder (`curl -H "Authorization: Bearer ek_…" http://localhost:4320/docs/json`). Anyone else gets `401`.

## From a template

```sh
curl -X POST http://localhost:4320/v1/messages \
  -H "Authorization: Bearer ek_…" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1042-shipped" \
  -d '{
    "to": ["ada@example.com"],
    "templateSlug": "order-shipped",
    "variables": { "name": "Ada", "orderId": "1042" }
  }'
```

The request is refused with `422` if a required variable is missing or `null`, and the response names each missing variable.

The template is rendered with the variables before anything is stored, within the [render bounds](templates.md#render-bounds): a rendered subject longer than 998 characters (the most a raw `subject` may have), rendered HTML or text longer than 1,000,000 characters, or a render that does more work than one may, is refused with `422` on the field that named the template, such as `templateSlug`, and nothing is stored or sent.

Name the template in one of three ways, and only one per request:

- `templateSlug`, the template's [slug](templates.md#slugs), such as `"templateSlug": "wizzaroo-reset-your-password"`. A slug is the same in every install and stays the same when the template is renamed, so it is the steadiest choice for an application.
- `templateName`, the template's exact name, such as `"templateName": "Wizzaroo - Reset your password"`.
- `templateId`, the template's ID. IDs differ between installs.

An unknown slug or name is refused with `404`. A request that sends more than one of them is refused with `422`. From Node, the [`@adrianeyre/email-client`](../../packages/email-client/README.md) package does this for you, with typed variables for the [built-in emails](templates.md#built-in-emails).

## With raw content

Send `subject` with `html`, `text` or both. When only `html` is sent, the text part is generated from it. A request can't combine `templateSlug`, `templateName` or `templateId` with `subject`, `html` or `text`.

## The from address

The first of these is used:

1. the request's `from`;
2. the template's [configuration](templates.md#configuration), as its from name and address, such as `Wizzaroo <no-reply@wizzaroo.adrianeyre.co.uk>`, or the address alone when it has no from name;
3. the **default from address** on the Delivery page, which starts as `no-reply@adrianeyre.co.uk`.

With none of them, because the default was cleared, the request is refused with `422` on the field `from`. Raw content has no template, so it uses the request's `from` or the default.

Whichever it is, an API key may send only from an address its Application may use: the from email address of one of that Application's [configurations](templates.md#configuration), or the default from address. Anything else is refused with `422` on the field `from`, and nothing is stored or sent. This is checked on the from address the send ends up with, so a template whose configuration belongs to another Application can't be sent without a `from` of your own. Only the address counts, in any case; the from name is yours to choose. To let a key send from a new address, give its Application a configuration naming it ([ADR 0009](../architectural-decision-record/0009-api-keys-belong-to-an-application.md)).

## Fields

| Field                     | Notes                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `from`                    | Optional. See [the from address](#the-from-address)                     |
| `to`                      | 1 to 50 [recipients](#recipients)                                       |
| `cc`, `bcc`               | Optional, up to 50 recipients each                                      |
| `replyTo`                 | Optional                                                                |
| `templateSlug`            | A template's slug, such as `order-shipped`, shown on its page in the UI |
| `templateName`            | A template's exact name, used instead of `templateSlug`                 |
| `templateId`              | A template's ID, shown on its page in the UI                            |
| `variables`               | An object of values for the template                                    |
| `subject`, `html`, `text` | Raw content, used instead of a template; `subject` up to 998 characters |
| `attachments`             | Up to 100 [attachments](#attachments)                                   |

A template's subject is held to the same 998 characters once rendered. The whole message, attachments included, must be 25 MB or less. No field, and no header such as `Idempotency-Key`, may hold a NUL byte (`\u0000`): one is refused with `422` naming it, such as `body.subject`.

## Attachments

Each attachment is `{ "filename", "contentType", "content" }`, with `content` in base64:

| Field         | Notes                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filename`    | 1 to 255 characters                                                                                                                                   |
| `contentType` | Optional. One MIME type of up to 255 characters, such as `application/pdf` or `text/plain; charset=utf-8`. Left out, it is `application/octet-stream` |
| `content`     | The file, in base64                                                                                                                                   |

More than 100 attachments, a longer filename, or a `contentType` that is not one MIME type (a `multipart/` type, a list of types, a line break or other control character, or anything else) is refused with `422` on that field, such as `attachments.0.contentType`, and nothing is stored or sent.

## Recipients

Each `to`, `cc` and `bcc` entry is one address: `ada@example.com`, or with a display name, `Ada <ada@example.com>` or `"Lovelace, Ada" <ada@example.com>`. An entry holding more than one address, such as `"a@example.com, b@example.com"`, a group such as `"Team: a@example.com, b@example.com;"`, or a line break or other control character is refused with `422` on that entry, such as `to.0`, and nothing is stored or sent. So the limits here and in the [log](logs.md) count people, not strings.

## The send limit

An API key may send to a set number of recipient addresses a minute, `to`, `cc` and `bcc` together, counted across every `api` process. The figure is the platform's [request-rate policy](../product-requirements-document/pen-testing.md#pre-condition-the-request-rate-policy-before-the-gate), and every counted send reports it in three headers (from the IETF RateLimit header fields draft):

| Header                | Meaning                                                     |
| --------------------- | ----------------------------------------------------------- |
| `RateLimit-Limit`     | The recipient addresses the key may send to in a minute     |
| `RateLimit-Remaining` | How many it has left in the current minute                  |
| `RateLimit-Reset`     | Seconds until the current minute ends and the limit is back |

A key's minute starts with its first send after the last minute ended. A send that doesn't fit in what is left is refused with `429`, a `Retry-After` header in seconds, and the same body every request-rate limit gives:

```json
{
  "error": "too_many_requests",
  "message": "Too many requests. Try again after the number of seconds in the Retry-After header"
}
```

Nothing is stored or sent, and the refusal counts nothing, so retry the same request, with its `Idempotency-Key`, after `Retry-After`. A single message with more recipients than the whole limit could never be sent, so it is refused with `422` on `to` instead. Each key has a minute of its own; a repeat of an `Idempotency-Key` and a refused request count nothing.

## Request limits

Every other `/v1` call is limited per API key too, and every `/app` call (the UI) per user, across every `api` process, with the figures in the [request-rate policy](../product-requirements-document/pen-testing.md#pre-condition-the-request-rate-policy-before-the-gate):

- **`POST /v1/templates/preview`** has a figure of its own a minute per key, counted like the send limit, apart from the key's other calls.
- **Every other `/v1` call** but a send is counted per key with a burst: a key may make that many calls in a row, and gets them back at a steady rate.
- **Every `/app` call** is counted per user the same way, whichever of their sessions makes it, well above what the designer's live preview makes while you type.
- **`POST /app/settings/test`** has a figure an hour per user on top ([Delivery](delivery-and-access.md#delivery)).

Each answer reports where the key or user stands in `RateLimit-Limit` (the figure, or the burst), `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the whole limit is back). A call past a limit is refused with `429`, a `Retry-After` in seconds (for a burst, when the next call is back), and the same body as the send limit, whichever limit fired. A send counts against the send limit only, not the key's other calls.

## Request bodies

Each route takes a body of up to its own size, refused with `413` before it is read:

- **36 MB:** `POST /v1/messages`, and the routes that carry a template or its variables: `POST` and `PUT` on templates, headers and footers, `POST /v1/templates/preview` and a template's test send. That holds a 25 MB message in base64; the message itself is still held to [25 MB](#fields).
- **16 KiB:** every other route that takes a body, such as sign-in, users, API keys, applications, configurations and Delivery.
- **None:** a route that takes no body, such as most `DELETE`s and sign-out, refuses any body. Send no `Content-Type` and no body there.

The `413` names the route's own limit:

```json
{
  "error": "request_too_large",
  "message": "The request is larger than the 16 KiB this route takes"
}
```

or, where no body is taken, `"This route takes no request body"`. A body is JSON, sent as `application/json`.

## Errors

Every refusal is a JSON body with an `error` code from the list below and a `message` for a person to read; a `422` adds `errors`, one `{ "field", "message" }` for each field refused. No other code is sent.

| Status | `error`                                                                                                                                      | When                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `400`  | `invalid_json`                                                                                                                               | The body is not valid JSON, or is empty with `Content-Type: application/json`         |
| `400`  | `invalid_content_length`                                                                                                                     | The body's length doesn't match its `Content-Length`                                  |
| `400`  | `bad_request`                                                                                                                                | Any other request the server can't read, such as a URL with a broken percent-encoding |
| `401`  | `unauthenticated`                                                                                                                            | No API key or session, or one that isn't valid                                        |
| `403`  | `forbidden`                                                                                                                                  | Sign-out from a page that isn't the platform's own                                    |
| `404`  | `not_found`                                                                                                                                  | No such route, or no such thing that the caller may see                               |
| `409`  | `idempotency_key_reused`                                                                                                                     | See [Idempotency](#idempotency)                                                       |
| `409`  | `template_name_taken`, `template_slug_taken`, `header_name_taken`, `footer_name_taken`, `configuration_name_taken`, `application_name_taken` | The name or slug is in use                                                            |
| `409`  | `application_has_api_keys`, `cannot_delete_self`, `default_from_missing`, `smtp_not_configured`, `smtp_password_unreadable`                  | The change can't be made as things stand; the message says why                        |
| `413`  | `request_too_large`                                                                                                                          | The body is over the [route's limit](#request-bodies)                                 |
| `413`  | `message_too_large`                                                                                                                          | The message, attachments included, is over 25 MB                                      |
| `415`  | `unsupported_media_type`                                                                                                                     | The body's `Content-Type` is not `application/json`                                   |
| `422`  | `validation_failed`                                                                                                                          | A field is missing or refused; `errors` names each                                    |
| `429`  | `too_many_requests`                                                                                                                          | A [limit](#request-limits) was met; try again after `Retry-After`                     |
| `500`  | `internal_error`                                                                                                                             | Something went wrong on the server; the message says no more                          |
| `502`  | `smtp_failed`                                                                                                                                | Delivery's test send: the SMTP provider refused or couldn't be reached                |

## What happens next

The response is `202` with the message's `id` and `status: "queued"`. The worker hands the message to the SMTP provider set on the Delivery page:

- On success the status becomes `sent`, and `providerMessageId` is filled in.
- On failure the kind of failure is recorded as `error` (below), and the send is retried 3 times with backoff, starting after 30 seconds. After the last retry the status becomes `failed`. A permanent `5xx` refusal from the provider fails the message at once.
- Attachments, HTML and text are deleted once the message is `sent` or `failed`, so the log keeps no working link from them. It keeps the rendered subject, the recipients and the status. See [Logs](logs.md).

`error` is one of a closed set, never the provider's reply or the network error itself, which can name the provider's internal hosts, addresses and accounts, or the SMTP host and port:

| `error`                                                                                                            | What happened                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `The SMTP provider refused it with reply 550 5.1.1 (permanent)`                                                    | The provider refused a command (logging in, the sender, a recipient or the message) with that reply code and, if it gave one, that status code. `5xx` is permanent, `4xx` temporary. |
| `The SMTP provider could not be reached, or the connection to it failed (a name, network, TLS or timeout failure)` | No SMTP session was reached: the name didn't resolve, nothing answered, the connection timed out, TLS failed, or what answered wasn't SMTP. Retried.                                 |
| `No SMTP provider is configured: set one in Settings`, or the saved password can't be read                         | The Delivery page needs fixing. Retried.                                                                                                                                             |
| `The email could not be sent`                                                                                      | Anything else. Retried.                                                                                                                                                              |

The same kind of failure is all the Logs and a [test email](delivery-and-access.md#delivery) show. The worker's own log (the api's, for a test email) keeps, for each failed try, the error's code (such as `ESOCKET` with `ECONNREFUSED`, `EDNS` or `ETLS`), the SMTP command and the reply code, never a reply's text, which can quote a recipient's address.

Check a message's status with `GET /v1/messages/{id}`. A key can read only the messages its own Application sent; any other answers `404`, as an unknown ID does.

## Idempotency

Send an `Idempotency-Key` header, such as an order ID with an event name, to make retries safe. A repeated key with the same request returns the first message with `200` and doesn't send again. Keys are your Application's own: another Application using the same key gets a message of its own, and never yours.

A key is bound to its request. The same key with a different request (another recipient, template, variable or anything else in the body) is refused with `409` and `"error": "idempotency_key_reused"`, and nothing is stored or sent, so a reused key never silently drops an email. The order of the JSON's keys doesn't matter, and a left-out `cc`, `bcc` or `attachments` is the same as an empty one. A message stored before the platform began keeping a fingerprint of each request has none, so a repeat of its key is answered with `200` and the first message whatever the request, as it was then; such messages leave with [Retention](logs.md).
