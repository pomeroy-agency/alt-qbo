# TrailBook News (the weekly newsletter)

A weekly email to people who signed up for it: the week's tax, payroll and labor news that matters to a small business, what's new in TrailBook, and one tip on winning work or getting paid. TrailBook watches the news and drafts each issue; a person reviews, tests and approves it. **Nothing goes to subscribers without that approval.**

## How it works

1. **Every morning (13:00 UTC)** `newsletter-daily` starts the `newsletter-background` worker, which reads the feeds in `src/newsletter/sources.ts`:
   - the Federal Register (rules and notices from the IRS, the Labor Department's Wage and Hour Division, SSA and SBA), the IRS newsroom and the Labor Department's news releases;
   - Accounting Today, Journal of Accountancy and CPA Practice Advisor;
   - three Google News searches (payroll and minimum wage, small business tax, selling).

   Each new story gets a score from 0 to 100 (`src/newsletter/score.ts`): the source's weight (agencies count most), points for each group of keywords it mentions (deadlines and penalties, rate or threshold changes, payroll, small business tax, new rules, scams, selling), 5 for naming a state TrailBook supports, 10 if it's under two days old and minus 30 if it's over two weeks old. The same story from a second feed is kept once.

2. **Stories scoring 60 or more** are read (the article page, when it can be fetched) and Claude writes up the facts **in its own words**: a headline, a short summary, who it affects, when it starts, and what to do. Claude can mark a story as not relevant. Article text is never stored; only the feed's own short summary and Claude's write-up are kept, with a link to the source.

3. **Monday morning** the worker drafts Tuesday's issue from the best write-ups (up to five) and the team's notes, and emails the reviewer. Without Claude it builds a plain draft from a template instead.

4. **Review**, on the Newsletter page (in the operator's organisation only, for owners and admins): edit the subject, preview line, intro, each section and the closing; reorder or remove sections; add notes (TrailBook updates and sales tips) for the next issue; dismiss stories; see which feeds are failing.

5. **Send yourself a test.** This puts the current version into a Brevo campaign (as a draft, with no recipients) and sends a test to the addresses you type. Brevo sends tests only to addresses on the account's test list.

6. **Approve and schedule.** Only possible once Brevo, the subscriber list and the postal address are set, and once a test of this exact version has gone out (an edit after the test needs a new test). The campaign is scheduled for 7 a.m. Pacific on Tuesday, or 15 minutes from now if that has passed. Approval and every test are recorded in the organisation's audit log. Until the send time, **Cancel the send** takes it off Brevo's schedule and back to a draft.

## Setting it up

In Netlify, Site configuration, Environment variables:

| Variable | What it is |
|---|---|
| `NEWSLETTER_ORG_ID` | Your own organisation's id (Pomeroy Agency). Turns the feature on. |
| `ANTHROPIC_API_KEY` | A Claude API key, for the write-ups and drafts. Optional; without it drafts come from a template. |
| `BREVO_API_KEY` | A Brevo **API** key (SMTP & API, then API Keys). Not the SMTP key TrailBook already uses for sign-in emails. |
| `NEWSLETTER_SENDER_ID` | The Brevo sender id the issue comes from (Senders, Domains & Dedicated IPs). Sender 1 is "Greg at Pomeroy Agency". |
| `NEWSLETTER_LIST_ID` | The Brevo list of people who signed up for TrailBook News. |
| `NEWSLETTER_POSTAL_ADDRESS` | The postal address shown in every footer (a PO box is fine). |
| `NEWSLETTER_REVIEWER_EMAIL` | Who hears a draft is ready. Defaults to `OPS_EMAIL`. |
| `NEWSLETTER_REPLY_TO` | Optional: where replies go, if not the sender. |

The worker is started with a secret derived from `PII_KEY`, which is already set, so nobody else can start it.

Claude's cost is small: about a dozen short write-ups a day and one draft a week.

## Subscribers and the law

Pomeroy Agency's Brevo account is in Canada, so Canada's anti-spam law (CASL) applies as well as the U.S. CAN-SPAM Act. In practice:

- **Opt-in only.** Use a dedicated Brevo list that people join on purpose: a sign-up form (Brevo's double opt-in form is the simplest), or an unticked box at TrailBook sign-up. Don't add customers, MilePost contacts or other Brevo lists without their consent.
- **Identify the sender** and give a postal address: the footer says "Pomeroy Agency, a DBA of Harmony in the Wild, LLC" and `NEWSLETTER_POSTAL_ADDRESS`.
- **An unsubscribe link in every issue** that works for at least 60 days and is honoured within 10 business days: the footer's `{{ unsubscribe }}` link is Brevo's, and Brevo removes people at once.
- **Honest subject lines** that match the content. The review step is where this is checked.
- Each issue says it's general information, not tax or legal advice.

## Changing the sources

Edit `SOURCES` in `src/newsletter/sources.ts`. Feed addresses move; the Sources table on the Newsletter page shows when each one last answered and any error, so a broken feed is easy to spot.
