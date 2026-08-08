/* ============================================================
   SECURITY MIDDLEWARE
   ------------------------------------------------------------
   - corsMiddleware : strict credentialed-CORS allowlist
   - helmetMiddleware : security headers (CSP tuned for the SPA,
       Razorpay checkout and OAuth redirects)
   - csrfProtection : double-submit-cookie CSRF guard for
       cookie-authenticated, state-changing requests
   - rate limiters : per-endpoint-class abuse protection
   ============================================================ */
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
  ALLOWED_ORIGINS,
  COOKIE_SAMESITE,
  COOKIE_SECURE,
  ENABLE_CSP,
  IS_PROD,
} from './config.js';
import { logger } from './logger.js';

/* ---------------------------------------------------------------
   CORS — explicit allowlist, never a reflected wildcard with creds.
   Same-origin requests carry no Origin header and are always allowed.
   --------------------------------------------------------------- */
const allowSet = new Set(ALLOWED_ORIGINS);
export const corsMiddleware = cors({
  origin(origin, cb) {
    // No Origin header → same-origin / curl / server-to-server: allow.
    if (!origin) return cb(null, true);
    const clean = origin.replace(/\/+$/, '');
    if (allowSet.has(clean)) return cb(null, true);
    logger.warn('CORS blocked origin', { origin: clean });
    return cb(null, false); // not allowed: omit CORS headers (no error page)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
});

/* ---------------------------------------------------------------
   HELMET — security headers. CSP allows the assets the SPA actually
   uses (self bundles, blob workers for pdf.js, data: images, Google
   avatars, Razorpay checkout). Tuned so it does not break Vite assets
   or OAuth redirects. Disable with DISABLE_CSP=1 if needed.
   --------------------------------------------------------------- */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: ENABLE_CSP
    ? {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          // Razorpay checkout script + inline bootstrapping the bundler emits.
          'script-src': ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'],
          'script-src-elem': ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'],
          // Tailwind ships static CSS, but allow inline styles for runtime tweaks.
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:', 'https:'],
          'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
          'worker-src': ["'self'", 'blob:'],
          'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'", 'https://accounts.google.com'],
          ...(IS_PROD ? { 'upgrade-insecure-requests': [] } : {}),
        },
      }
    : false,
  crossOriginEmbedderPolicy: false, // would block blob workers / external images
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS only makes sense over HTTPS in production.
  hsts: IS_PROD ? { maxAge: 15552000, includeSubDomains: true } : false,
});

/* ---------------------------------------------------------------
   CSRF — double-submit cookie.
   A readable (non-httpOnly) `ca_csrf` cookie is set on every response.
   For state-changing methods on cookie-authenticated requests the
   client must echo it back in the X-CSRF-Token header. Unauthenticated
   public POSTs (login bootstrap, anonymous support) and the signed
   payment webhook are exempt.
   --------------------------------------------------------------- */
const CSRF_COOKIE = 'ca_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set([
  '/api/payments/webhook', // verified by Razorpay HMAC signature, not cookies
  '/api/integrations/github/webhook', // verified by GitHub HMAC signature, not cookies
  '/auth/dev-login', // pre-auth bootstrap (no session yet)
  '/auth/logout', // clearing state; safe and must always succeed
  '/api/ops/client-error', // crash telemetry; writes nothing, and a crashed UI cannot be relied on to attach a token
]);

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Sets a fresh CSRF cookie if the request doesn't already carry one. */
export function csrfCookieIssuer(req, res, next) {
  if (!readCookie(req, CSRF_COOKIE)) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // must be readable by the SPA to echo back
      sameSite: COOKIE_SAMESITE,
      secure: COOKIE_SECURE,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: '/',
    });
    // Make it available to the rest of this request too.
    req._issuedCsrf = token;
  }
  next();
}

/** Determines whether the request carries an authenticated identity cookie. */
function hasIdentity(req) {
  return !!(
    (req.session && req.session.user) ||
    readCookie(req, 'ca_user')
  );
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  // Only enforce for authenticated, cookie-based mutations (the real attack
  // surface). Anonymous public POSTs are still rate-limited + validated.
  if (!hasIdentity(req)) return next();

  const cookieToken = readCookie(req, CSRF_COOKIE) || req._issuedCsrf || '';
  const headerToken = req.get('X-CSRF-Token') || req.get('x-csrf-token') || '';
  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));
  const ok = cookieToken && headerToken && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    logger.warn('CSRF token mismatch', { path: req.path, method: req.method });
    return res.status(403).json({
      error: 'csrf_failed',
      message: 'Invalid or missing CSRF token. Refresh the page and try again.',
    });
  }
  next();
}

/* ---------------------------------------------------------------
   RATE LIMITERS — keyed by authenticated user id when available,
   otherwise by IP. Reads (dashboards, FAQ lists) are intentionally
   NOT throttled here.
   --------------------------------------------------------------- */
function keyGen(req) {
  const id = (req.user && req.user.id) || (req.session && req.session.user && req.session.user.id);
  return id ? `u:${id}` : `ip:${req.ip}`;
}
function limitHandler(message) {
  return (req, res) =>
    res.status(429).json({ error: 'rate_limited', message });
}
const base = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  // Don't rate-limit in the test env so the suite stays deterministic.
  skip: () => process.env.NODE_ENV === 'test',
};

export const authLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 10,
  handler: limitHandler('Too many sign-in attempts. Please wait a minute and try again.'),
});

export const aiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_AI_PER_HOUR || 60),
  handler: limitHandler('AI request limit reached for this hour. Please try again later.'),
});

export const jobsLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_JOBS_PER_HOUR || 60),
  handler: limitHandler('Job search limit reached. Please wait before searching again.'),
});

export const contactsLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_CONTACTS_PER_HOUR || 40),
  handler: limitHandler('Contact lookup limit reached for this hour.'),
});

export const supportChatLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 20,
  handler: limitHandler('You are sending messages too quickly. Please slow down.'),
});

export const ticketLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_TICKETS_PER_HOUR || 5),
  handler: limitHandler('Support ticket limit reached. Please wait before submitting another.'),
});

export const generationLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_GENERATION_PER_HOUR || 80),
  handler: limitHandler('Generation limit reached for this hour. Please try again later.'),
});

/* GitHub integration: protects sync + repo analysis (each call hits the GitHub
   API and mints an installation token), so it gets its own tighter ceiling. */
export const githubLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_GITHUB_PER_HOUR || 60),
  handler: limitHandler('GitHub sync/analyze limit reached for this hour. Please try again later.'),
});

/* A gentle global ceiling to blunt brute scraping without touching normal use. */
export const globalLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_GLOBAL_PER_MIN || 300),
  handler: limitHandler('Too many requests. Please slow down.'),
});
