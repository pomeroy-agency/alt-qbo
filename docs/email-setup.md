# Sending email through Gmail

Alt-QBO sends sign-in links, password resets, email confirmations and team invitations through one Gmail or Google Workspace mailbox over SMTP. Until it is set up, those features stay hidden and invitation links are copied by hand, as before.

## 1. Pick the mailbox

Use a mailbox people will recognise, such as `books@yourdomain.com` on Google Workspace. A personal `@gmail.com` address works too, but Workspace is better for deliverability and its limit is higher (about 2,000 messages a day, against about 500).

## 2. Create an app password

1. Sign in to that mailbox's Google Account and turn on 2-Step Verification (Security, 2-Step Verification).
2. Go to <https://myaccount.google.com/apppasswords>, create an app password named "Alt-QBO", and copy the 16 characters.

On Google Workspace, if the App passwords page says the setting isn't available, a Workspace admin needs to allow users to manage 2-Step Verification (Admin console, Security, Authentication, 2-Step Verification).

## 3. Add the settings to Netlify

In the Netlify project (Site configuration, Environment variables), add:

| Variable | Value |
|---|---|
| `GMAIL_USER` | the mailbox address |
| `GMAIL_APP_PASSWORD` | the app password (spaces don't matter); mark it secret |
| `MAIL_FROM` | optional, e.g. `Alt-QBO <books@yourdomain.com>` |
| `APP_URL` | optional, the address links should point at, e.g. `https://alt-qbo.netlify.app`; defaults to Netlify's URL for the deploy |

Then redeploy. Signing up sends a confirmation email; "Forgot your password?" and "Email me a sign-in link" appear on the sign-in page.

## Limits and notes

- Each person can request at most five links of each kind an hour.
- Gmail may rewrite the From address to the mailbox itself if `MAIL_FROM` names a different address that isn't set up as a "Send mail as" alias.
- To move to a sending service later, point `SMTP_HOST` at its SMTP server and use its credentials in the same two variables, or replace `gmailFromEnv` in `src/app/mail.ts`.
