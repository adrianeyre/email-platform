# Sending

Applications send with `POST /v1/messages`, using an API key as a Bearer token. The full reference is at `/docs` on a running app.

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

## Fields

| Field                     | Notes                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `from`                    | Optional. See [the from address](#the-from-address)                     |
| `to`                      | 1 to 50 addresses                                                       |
| `cc`, `bcc`               | Optional, up to 50 each                                                 |
| `replyTo`                 | Optional                                                                |
| `templateSlug`            | A template's slug, such as `order-shipped`, shown on its page in the UI |
| `templateName`            | A template's exact name, used instead of `templateSlug`                 |
| `templateId`              | A template's ID, shown on its page in the UI                            |
| `variables`               | An object of values for the template                                    |
| `subject`, `html`, `text` | Raw content, used instead of a template                                 |
| `attachments`             | `[{ "filename", "contentType", "content" }]`, with `content` in base64  |

The whole message, attachments included, must be 25 MB or less.

## What happens next

The response is `202` with the message's `id` and `status: "queued"`. The worker hands the message to the SMTP provider set on the Delivery page:

- On success the status becomes `sent`, and `providerMessageId` is filled in.
- On failure the error is recorded and the send is retried 3 times with backoff, starting after 30 seconds. After the last retry the status becomes `failed`. A permanent `5xx` refusal from the provider fails the message at once.
- Attachments are deleted once the message is `sent` or `failed`. The log keeps the rendered subject and bodies.

Check a message's status with `GET /v1/messages/{id}`.

## Idempotency

Send an `Idempotency-Key` header, such as an order ID with an event name, to make retries safe. A repeated key returns the first message with `200` and doesn't send again.
