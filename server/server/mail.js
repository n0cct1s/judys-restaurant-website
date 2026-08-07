import nodemailer from "nodemailer";

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function createTransport() {
  if (!isMailConfigured()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendCampaignEmail({ to, subject, html, text }) {
  const transport = createTransport();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  if (!transport) {
    console.log(`[mail:dry-run] To: ${to} | Subject: ${subject}`);
    return { dryRun: true, messageId: `dry-run-${Date.now()}` };
  }

  const info = await transport.sendMail({
    from,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, " "),
  });

  return { dryRun: false, messageId: info.messageId };
}
