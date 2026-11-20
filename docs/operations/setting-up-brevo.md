# Setting up Brevo

The app sends through one SMTP provider, set in **Delivery** ([ADR 0002](../architectural-decision-record/0002-live-delivery-relays-through-an-upstream-provider.md)). This guide sets up [Brevo](https://www.brevo.com), whose free plan sends 300 emails a day, with its DNS records in Cloudflare. Other providers follow the same pattern: verify the domain, add its DNS records, then enter its SMTP details in Delivery.

The examples use `adrianeyre.co.uk` and `wizzaroo.adrianeyre.co.uk`. Use every domain your from addresses are on: the Delivery default, and each [configuration](../guide/templates.md#configuration)'s from address.

## 1. Create a Brevo account

Sign up at <https://www.brevo.com>. Brevo asks for a postal address, because anti-spam laws require one in marketing emails. It is added to campaigns built in Brevo, not to emails the app sends through SMTP. A business address or PO box works too.

## 2. Add each sending domain in Brevo

1. Click **Settings** (the gear icon in the left sidebar), then **Senders, Domains & Dedicated IPs → Domains**.
2. Click **Add a domain** and enter the domain, such as `adrianeyre.co.uk`.
3. Choose to add the DNS records yourself. Brevo then shows the records for that domain (step 3).
4. Repeat for each domain, such as `wizzaroo.adrianeyre.co.uk`. Brevo refuses mail from a domain it hasn't verified.

## 3. Add the DNS records

In Cloudflare, open the domain, go to **DNS → Records**, and add each record Brevo shows. Set every one to **DNS only** (grey cloud). A proxied record breaks verification.

| Record             | Type  | Name (for `adrianeyre.co.uk`)               | Content                                                              |
| ------------------ | ----- | ------------------------------------------- | -------------------------------------------------------------------- |
| Brevo verification | TXT   | `@`                                         | `brevo-code:…`, as Brevo shows it                                    |
| DKIM               | CNAME | `brevo1._domainkey` and `brevo2._domainkey` | `b1.….dkim.brevo.com` and `b2.….dkim.brevo.com`, as Brevo shows them |
| SPF                | TXT   | `@`                                         | `v=spf1 include:spf.brevo.com ~all` (see below)                      |
| DMARC              | TXT   | `_dmarc`                                    | `v=DMARC1; p=none; rua=mailto:you@example.com` (see below)           |

For a subdomain such as `wizzaroo.adrianeyre.co.uk`, add the same records with the subdomain in the name: `@` becomes `wizzaroo`, `brevo1._domainkey` becomes `brevo1._domainkey.wizzaroo`, and so on.

Each name may have only one SPF record and one DMARC record. Two of either makes receiving servers treat it as broken:

- **SPF:** if the name already has a `v=spf1` record, such as Cloudflare Email Routing's `v=spf1 include:_spf.mx.cloudflare.net ~all`, add Brevo to it instead of creating another: `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all`.
- **DMARC:** if `_dmarc` already exists, such as one made by Cloudflare's DMARC Management, keep it and skip Brevo's. One `_dmarc` on the main domain also covers its subdomains. `rua=` is where receiving servers send daily reports; it takes several addresses separated by commas.

Then, back in Brevo's **Domains** page, click **Authenticate** for each domain. DNS changes in Cloudflare usually show within minutes. To check one yourself:

```sh
dig +short TXT adrianeyre.co.uk                   # one v=spf1 line, and the brevo-code
dig +short CNAME brevo1._domainkey.adrianeyre.co.uk
dig +short TXT _dmarc.adrianeyre.co.uk            # one v=DMARC1 line
```

## 4. Get the SMTP login

1. Open <https://app.brevo.com/settings/keys/smtp> (**Settings → SMTP & API**, **SMTP** tab).
2. Click **+ Generate SMTP key** and copy it. It starts `xsmtpsib-` and is shown only once. An API key (`xkeysib-`) won't work.
3. Copy the **Login** shown on the same page, such as `xxxxxxxx@smtp-brevo.com`. It belongs to the account, not to the key. If none is shown, use the email address you signed up with.

If the page says the account isn't activated for transactional email, Brevo has to approve it first.

## 5. Set Delivery

Sign in to the app, open **Delivery**, and set:

| Field                           | Value                                 |
| ------------------------------- | ------------------------------------- |
| Host                            | `smtp-relay.brevo.com`                |
| Port                            | `587`                                 |
| Connect with TLS from the start | Unticked (587 upgrades with STARTTLS) |
| Username                        | The Login from step 4                 |
| Password                        | The SMTP key from step 4              |

Check the **Default from address** is on a domain verified in step 2, then **Save**.

## 6. Test it

1. Use **Send a test email** in Delivery, with an address you can read.
2. Open the email's original (in Gmail, **⋮ → Show original**) and check for `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS`.
3. Once mail passes reliably, tighten DMARC to `p=quarantine`.

## When an email doesn't arrive

- **The app's Logs** show each email's status and error. A provider's refusal, such as `Sender not valid` for an unverified domain, marks the email `failed` with the reason.
- **Brevo's logs** (**Transactional → Logs** in Brevo) show what happened after Brevo accepted it: delivered, deferred, bounced or blocked.
- **`535 Authentication failed`:** the Login or SMTP key is wrong, or an API key was used.
- **In spam:** check the authentication results in step 6. A `FAIL` points at the DNS record to fix.
