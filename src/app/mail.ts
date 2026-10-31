import nodemailer, { type Transporter } from "nodemailer";

// Outgoing email. TrailBook sends a handful of plain-text messages (sign-in
// links, password resets, email confirmation, team invitations) over SMTP:
// Brevo's relay, or a Gmail mailbox with an app password.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** An HTML version beside the text (invoices to customers). */
  html?: string;
  /** Shown as the sender's name, at TrailBook's own verified address ("Sunset Design Studio LLC"). */
  fromName?: string;
  /** Where replies go: the business, for emails to its customers. */
  replyTo?: string;
}

/** The address part of a From line: "TrailBook <a@b.com>" or "a@b.com". */
export function fromAddress(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1]?.trim() ?? from.trim();
}

export type Mailer = (message: MailMessage) => Promise<void>;

/**
 * A mailer from the environment, or undefined when it isn't configured
 * (email features then say so instead of failing).
 *
 *   Brevo or any SMTP service: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER,
 *   SMTP_PASSWORD, and MAIL_FROM (a sender the service has verified).
 *   Gmail: GMAIL_USER and GMAIL_APP_PASSWORD; MAIL_FROM is optional.
 */
export function mailerFromEnv(env: Record<string, string | undefined> = process.env): Mailer | undefined {
  const smtpUser = env.SMTP_USER?.trim();
  const gmailUser = env.GMAIL_USER?.trim();
  let transport: Transporter;
  let from: string | undefined = env.MAIL_FROM?.trim();
  if (env.SMTP_HOST && smtpUser && env.SMTP_PASSWORD) {
    const port = Number(env.SMTP_PORT || 587);
    // 465 speaks TLS from the start; other ports upgrade with STARTTLS, which is then required.
    transport = nodemailer.createTransport({ host: env.SMTP_HOST.trim(), port, secure: port === 465, requireTLS: port !== 465, auth: { user: smtpUser, pass: env.SMTP_PASSWORD.trim() } });
    if (!from) {
      // Without a verified sender the service would refuse every message; leave email off rather than take the API down.
      console.error("email is off: set MAIL_FROM to a sender address the SMTP service has verified");
      return undefined;
    }
  } else if (gmailUser && env.GMAIL_APP_PASSWORD) {
    transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: gmailUser, pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") } });
    from ||= `TrailBook <${gmailUser}>`;
  } else {
    return undefined;
  }
  return async (m) => {
    // The business's name goes on TrailBook's own address; quotes and angle brackets are dropped so the name can't add a second address.
    const sender = m.fromName ? { name: `${m.fromName.replace(/["<>\r\n]/g, "").slice(0, 80)} via TrailBook`, address: fromAddress(from!) } : from;
    await transport.sendMail({
      from: sender, to: m.to, subject: m.subject, text: m.text,
      ...(m.html ? { html: m.html } : {}), ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    });
  };
}
