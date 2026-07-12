/* ============================================================
   MAILER  (optional transport; honest degradation)
   ------------------------------------------------------------
   In-app notifications are the guaranteed channel; email is an
   OPTIONAL upgrade activated purely by environment configuration:

     SMTP_URL=smtp://user:pass@host:587        (single-var form)
   or SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
     EMAIL_FROM="Career Autopilot <no-reply@yourdomain>"

   Rules:
   - No config  → emailEnabled() is false, sendMail() returns
     { ok:false, status:'not_configured' }. Callers report this
     honestly to the UI instead of pretending delivery happened.
   - nodemailer missing or transport failure → { ok:false,
     status:'failed', error }. Never throws into a route.
   ============================================================ */
import { logger } from '../../logger.js';

let _transportPromise = null;

export function emailEnabled(env = process.env) {
  return Boolean(env.SMTP_URL || (env.SMTP_HOST && env.SMTP_PORT));
}

export function emailFrom(env = process.env) {
  return env.EMAIL_FROM || 'Career Autopilot <no-reply@career-autopilot.local>';
}

async function getTransport() {
  if (!emailEnabled()) return null;
  if (_transportPromise) return _transportPromise;
  _transportPromise = (async () => {
    try {
      const nodemailer = (await import('nodemailer')).default;
      if (process.env.SMTP_URL) return nodemailer.createTransport(process.env.SMTP_URL);
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      });
    } catch (err) {
      logger.error('Mailer transport unavailable', { message: err.message });
      return null;
    }
  })();
  return _transportPromise;
}

/** Send one email. Returns { ok, status: 'sent'|'not_configured'|'failed', error? }. */
export async function sendMail({ to, subject, text, html }) {
  if (!emailEnabled()) return { ok: false, status: 'not_configured' };
  try {
    const transport = await getTransport();
    if (!transport) return { ok: false, status: 'failed', error: 'transport_unavailable' };
    await transport.sendMail({ from: emailFrom(), to, subject: String(subject || '').slice(0, 200), text, html });
    return { ok: true, status: 'sent' };
  } catch (err) {
    logger.error('sendMail failed', { message: err.message, to: String(to || '').slice(0, 120) });
    return { ok: false, status: 'failed', error: err.message };
  }
}

/* Plain-text nudge template — deliberately boring and deliverable. */
export function nudgeEmail({ studentName, collegeName, title, message, appUrl }) {
  const subject = title || `${collegeName || 'Your placement cell'} — action needed on your readiness`;
  const text = [
    `Hi ${studentName || 'there'},`,
    '',
    message || 'Your placement cell asked you to update your Career Autopilot progress.',
    '',
    appUrl ? `Open your workspace: ${appUrl}` : '',
    '',
    `— ${collegeName || 'Placement cell'} via Career Autopilot`,
  ].filter((l) => l !== null).join('\n');
  return { subject, text };
}

export default { emailEnabled, emailFrom, sendMail, nudgeEmail };
