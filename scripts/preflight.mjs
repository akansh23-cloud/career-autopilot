#!/usr/bin/env node
/* ============================================================
   PRODUCTION PREFLIGHT  (npm run preflight)
   ------------------------------------------------------------
   Run against your PRODUCTION env (source it or run on the host)
   before the first demo and after any infra change. Checks are
   honest about what they can verify from here:
     · static  — env shape, secret strength, config coherence
     · network — live Mongo ping and SMTP handshake (only when
                 the corresponding env is set)
   Exit code 1 on any FAIL so this can gate a deploy pipeline.
   ============================================================ */
import 'dotenv/config';

const results = [];
const add = (level, name, detail) => results.push({ level, name, detail });
const PASS = 'PASS', WARN = 'WARN', FAIL = 'FAIL';

const env = process.env;
const has = (k) => typeof env[k] === 'string' && env[k].trim().length > 0;

/* ---------- static checks ---------- */

// Session secret: present, long, and not a known-leaked/dev value.
{
  const s = env.SESSION_SECRET || '';
  const KNOWN_BAD = ['dev-secret', 'test-secret', 'change-me', 'smoke-test'];
  if (!s) add(FAIL, 'SESSION_SECRET', 'missing — sessions will not survive restarts safely');
  else if (s.length < 32) add(FAIL, 'SESSION_SECRET', `only ${s.length} chars — use \`openssl rand -hex 32\``);
  else if (KNOWN_BAD.some((b) => s.toLowerCase().includes(b))) add(FAIL, 'SESSION_SECRET', 'looks like a dev/test value — rotate before launch');
  else add(PASS, 'SESSION_SECRET', `${s.length} chars`);
}

// Core identity + origin
add(has('MONGODB_URI') ? PASS : FAIL, 'MONGODB_URI', has('MONGODB_URI') ? 'set' : 'missing — the platform runs in demo-degraded mode without it');
{
  const o = env.FRONTEND_ORIGIN || '';
  if (!o) add(WARN, 'FRONTEND_ORIGIN', 'unset — cookies/CORS default to same-origin only');
  else if (!o.startsWith('https://')) add(FAIL, 'FRONTEND_ORIGIN', `${o} — must be https in production for Secure cookies`);
  else add(PASS, 'FRONTEND_ORIGIN', o);
}
{
  const g = has('GOOGLE_CLIENT_ID') && has('GOOGLE_CLIENT_SECRET');
  add(g ? PASS : FAIL, 'Google OAuth', g ? 'client id + secret set (verify the callback URL in Google console matches your domain)' : 'missing — no real sign-in path');
}
add(has('ADMIN_EMAILS') ? PASS : FAIL, 'ADMIN_EMAILS', has('ADMIN_EMAILS') ? env.ADMIN_EMAILS : 'missing — nobody can approve colleges or seed the demo');
{
  const dev = env.ALLOW_DEV_LOGIN === '1' || env.ALLOW_DEV_LOGIN === 'true';
  const prod = (env.NODE_ENV || '') === 'production';
  if (dev && prod) add(FAIL, 'ALLOW_DEV_LOGIN', 'enabled in production — anyone can mint an account without OAuth');
  else add(PASS, 'ALLOW_DEV_LOGIN', dev ? 'enabled (non-production)' : 'disabled');
}

// Payments + legal + email presence
{
  const r = has('RAZORPAY_KEY_ID') && has('RAZORPAY_KEY_SECRET');
  add(r ? PASS : WARN, 'Razorpay', r ? 'keys set (send one live ₹1 test order + webhook before launch)' : 'not configured — paid plans disabled, pilots unaffected');
}
add(has('SUPPORT_EMAIL') || has('GRIEVANCE_EMAIL') || has('ADMIN_EMAILS') ? PASS : WARN,
  'Legal contacts', 'GET /api/legal will serve ' + (env.GRIEVANCE_EMAIL || env.SUPPORT_EMAIL || (env.ADMIN_EMAILS || '').split(',')[0] || 'a placeholder — set SUPPORT_EMAIL/GRIEVANCE_EMAIL'));
{
  const smtp = has('SMTP_URL') || (has('SMTP_HOST') && has('SMTP_USER'));
  add(smtp ? PASS : WARN, 'SMTP config', smtp ? 'set — handshake tested below' : 'not configured — nudges/tasks are in-app only (works, but set up before placement season). Remember SPF/DKIM/DMARC on the sending domain or mail lands in spam.');
}

/* ---------- network checks (only where configured) ---------- */

async function checkMongo() {
  if (!has('MONGODB_URI')) return;
  try {
    const mongoose = (await import('mongoose')).default;
    const t0 = Date.now();
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
    await mongoose.connection.db.admin().ping();
    add(PASS, 'Mongo ping', `connected + ping in ${Date.now() - t0}ms (${mongoose.connection.host})`);
    await mongoose.disconnect();
  } catch (e) {
    add(FAIL, 'Mongo ping', e.message.split('\n')[0].slice(0, 140));
  }
}

async function checkSmtp() {
  const smtp = has('SMTP_URL') || (has('SMTP_HOST') && has('SMTP_USER'));
  if (!smtp) return;
  try {
    const nodemailer = (await import('nodemailer')).default;
    const transport = has('SMTP_URL')
      ? nodemailer.createTransport(env.SMTP_URL)
      : nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
    await transport.verify();
    add(PASS, 'SMTP handshake', 'server accepted credentials (send a real test mail to Gmail and check the spam folder before trusting deliverability)');
  } catch (e) {
    add(FAIL, 'SMTP handshake', e.message.split('\n')[0].slice(0, 140));
  }
}

await checkMongo();
await checkSmtp();

/* ---------- report ---------- */
const pad = (s, n) => String(s).padEnd(n);
const icon = { PASS: '✅', WARN: '⚠️ ', FAIL: '❌' };
console.log('\nCareer Autopilot — production preflight\n' + '─'.repeat(64));
for (const r of results) console.log(`${icon[r.level]} ${pad(r.name, 18)} ${r.detail}`);
const fails = results.filter((r) => r.level === FAIL).length;
const warns = results.filter((r) => r.level === WARN).length;
console.log('─'.repeat(64));
console.log(`${results.length} checks · ${fails} FAIL · ${warns} WARN`);
console.log('Not checkable from here: Google callback URL match, Razorpay webhook delivery, SPF/DKIM/DMARC DNS — verify each once manually (see docs/GO_LIVE_RUNBOOK.md).\n');
process.exit(fails ? 1 : 0);
