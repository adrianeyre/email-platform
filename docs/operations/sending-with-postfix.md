# Sending with Postfix

A new install sends through the `postfix` service in `docker-compose.yml`, which delivers each email directly to the recipient's mail server ([ADR 0008](../architectural-decision-record/0008-postfix-is-the-default-smtp-provider.md)). Delivery starts pointed at it, so nothing in the app needs setting up. To use a hosted provider instead, change **Delivery** ([Delivery and access](../guide/delivery-and-access.md#delivery)).

## Settings

Set these in `.env`, then run `docker compose up -d`.

| Variable                     | Default                                      | Purpose                                                                                                      |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `POSTFIX_SENDER_DOMAINS`     | `adrianeyre.co.uk wizzaroo.adrianeyre.co.uk` | Space-separated domains emails may be sent from. Postfix refuses any other from address.                     |
| `POSTFIX_HOSTNAME`           | the container name                           | The name Postfix greets other mail servers with, such as `mail.adrianeyre.co.uk`. Point it at the public IP. |
| `POSTFIX_DKIM_SELECTOR`      | `mail`                                       | The DKIM selector, so the DKIM record is `<selector>._domainkey.<domain>`.                                   |
| `POSTFIX_RELAYHOST`          |                                              | Hand every email on to this server instead of delivering it directly, such as `[smtp-relay.brevo.com]:587`.  |
| `POSTFIX_RELAYHOST_USERNAME` |                                              | The relay's username, if it needs one.                                                                       |
| `POSTFIX_RELAYHOST_PASSWORD` |                                              | The relay's password.                                                                                        |

Every domain the app sends from must be listed, including each configuration's from address and the Delivery default. The default covers the Delivery default (`adrianeyre.co.uk`) and the built-in Wizzaroo configuration (`wizzaroo.adrianeyre.co.uk`).

## DNS records

Add these for each sender domain, with your DNS provider. In Cloudflare, leave them **DNS only**.

| Record | Name                       | Value                                                                                     |
| ------ | -------------------------- | ----------------------------------------------------------------------------------------- |
| SPF    | the domain, TXT            | `v=spf1 ip4:<the server's public IP> ~all`, merged into any SPF record already there      |
| DKIM   | `mail._domainkey`, TXT     | The record Postfix generated (below)                                                      |
| DMARC  | `_dmarc`, TXT              | `v=DMARC1; p=none; rua=mailto:<your address>`, tightened to `quarantine` once mail passes |
| A      | `POSTFIX_HOSTNAME`, if set | The server's public IP                                                                    |

Postfix makes a DKIM key for each sender domain the first time it starts and keeps it in the `postfix-dkim` volume. Print the records to add:

```sh
docker compose exec postfix sh -c 'cat /var/lib/rspamd/dkim/*.txt'
```

Keep the volume: removing it makes new keys, and the DNS records must then be replaced.

## Checking it

Use **Send a test email** in Delivery, then look at the email's headers where it arrives for `spf=pass`, `dkim=pass` and `dmarc=pass`. The app marks an email `sent` once Postfix accepts it, so delivery problems such as bounces and refusals are in Postfix's log:

```sh
docker compose logs postfix | grep status=
```

## Limits of a home server

Mail servers trust a home IP much less than a hosted provider's. Residential IPs are often on blocklists such as the Spamhaus PBL, their reverse DNS usually can't be set, and SPF breaks whenever the IP changes. Many ISPs also block outgoing port 25. If emails land in spam or are refused, either set **Delivery** to a hosted provider, or keep Postfix and set `POSTFIX_RELAYHOST` to the provider's SMTP server.
