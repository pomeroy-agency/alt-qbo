import nodemailer from "nodemailer";

// Outgoing email. Alt-QBO sends a handful of plain-text messages (sign-in
// links, password resets, email confirmation, team invitations) through a
// Gmail or Google Workspace account over SMTP with an app password.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (message: MailMessage) => Promise<void>;

/**
 * A mailer from GMAIL_USER and GMAIL_APP_PASSWORD, or undefined when they
 * aren't set (email features then say so instead of failing). MAIL_FROM
 * overrides the sender line; SMTP_HOST points at another SMTP server.
 */
export function gmailFromEnv(env: Record<string, string | undefined> = process.env): Mailer | undefined {
  const user = env.GMAIL_USER?.trim();
  const pass = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) return undefined;
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST || "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  const from = env.MAIL_FROM?.trim() || `Alt-QBO <${user}>`;
  return async (m) => {
    await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
  };
}
