# Sending email

Alt-QBO sends sign-in links, password resets, email confirmations and team invitations over SMTP. Until it is set up, those features stay hidden and invitation links are copied by hand.

Brevo is the recommended route: mail comes from your own domain, and its SMTP key can only send mail. A Gmail mailbox with an app password also works, but an app password opens the whole mailbox, so use one only on an account kept for this.

## Brevo

1. **Verify the sender.** In Brevo, go to Senders, Domains & Dedicated IPs. Add and authenticate the domain (for example `pomeroyagency.com`; Brevo gives DNS records for DKIM and DMARC), then add a sender such as `books@pomeroyagency.com`.
2. **Create an SMTP key.** Go to SMTP & API, then the SMTP tab, and generate a new SMTP key named "Alt-QBO". The same page shows the SMTP server and your login.
3. **Add the settings to Netlify.** Open Site configuration, then Environment variables, and add:

   | Variable | Value |
   |---|---|
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | the login shown on Brevo's SMTP tab (it looks like `…@smtp-brevo.com`) |
   | `SMTP_PASSWORD` | the SMTP key (mark it secret) |
   | `MAIL_FROM` | `Alt-QBO <books@pomeroyagency.com>`, using the sender you verified |
   | `APP_URL` | optional: the address links should point at, such as `https://alt-qbo.netlify.app`. It defaults to Netlify's URL for the deploy |

4. **Redeploy.**

Once it's live, signing up sends a confirmation email, and the sign-in page shows "Forgot your password?" and "Email me a sign-in link".

Brevo counts these emails against the plan's monthly allowance, which is shared with marketing campaigns. Brevo's Transactional log shows each message that was sent, delivered or bounced.

## Gmail instead

1. In the Google Account you will send from, turn on 2-Step Verification.
2. Create an app password at <https://myaccount.google.com/apppasswords>.
3. In Netlify, set `GMAIL_USER` to the mailbox address and `GMAIL_APP_PASSWORD` to the app password. `MAIL_FROM` is optional.

Gmail allows about 500 emails a day.

If both are configured, the `SMTP_*` settings win.

## Limits

- Each person can request at most five links of each kind an hour.
- Links are one-time and short-lived:
  - sign-in links last 15 minutes;
  - reset links last 1 hour;
  - confirmation links last 3 days.
