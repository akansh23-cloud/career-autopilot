/* ============================================================
   CONFIG + ENVIRONMENT VALIDATION
   ------------------------------------------------------------
   Central place that reads the environment ONCE, validates that
   production has everything it needs, and exposes typed helpers.

   In production (NODE_ENV=production) the process REFUSES to start
   when a required service/secret is missing — so the app can never
   silently run without persistence or with a throwaway session
   secret. In development the same misconfigurations are surfaced as
   warnings so local work stays frictionless.
   ============================================================ */
import crypto from 'crypto';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PROD = NODE_ENV === 'production';
export const IS_TEST = NODE_ENV === 'test';
export const IS_VERCEL = !!process.env.VERCEL;

/* A SESSION_SECRET is mandatory in production. In dev/test we fall back to a
   random per-process secret (sessions simply won't survive a restart). */
export const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (IS_PROD ? '' : crypto.randomBytes(32).toString('hex'));

export const MONGODB_URI = process.env.MONGODB_URI || '';

/* Allowed browser origins for credentialed CORS. Same-origin deploys (the
   Express server also serves the SPA) need none of these — they are only for
   split frontend/backend hosting. */
function parseOrigins() {
  const raw = [
    process.env.FRONTEND_ORIGIN,
    process.env.ALLOWED_ORIGINS, // comma-separated
  ]
    .filter(Boolean)
    .join(',');
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (!IS_PROD) {
    // Local dev origins (Vite dev server + common localhost ports).
    list.push(
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    );
  }
  return [...new Set(list)];
}
export const ALLOWED_ORIGINS = parseOrigins();

/* Cross-site cookies (SameSite=None; Secure) are needed ONLY when the SPA is
   served from a different origin than this backend, over HTTPS. */
export const CROSS_SITE =
  process.env.COOKIE_CROSS_SITE === '1' ||
  String(process.env.COOKIE_SAMESITE).toLowerCase() === 'none';
export const COOKIE_SAMESITE = (
  process.env.COOKIE_SAMESITE || (CROSS_SITE ? 'none' : 'lax')
).toLowerCase();
export const COOKIE_SECURE =
  process.env.COOKIE_SECURE === '1' || CROSS_SITE || IS_PROD;

/* Toggle the strict Content-Security-Policy. On by default; can be disabled
   with DISABLE_CSP=1 if a deployment needs to load extra third-party assets. */
export const ENABLE_CSP = process.env.DISABLE_CSP !== '1';

/* Demo / dev login is only allowed when explicitly enabled, or in non-prod when
   Google OAuth is not configured. It is NEVER auto-enabled in production. */
export function allowDevLogin() {
  if (process.env.ALLOW_DEV_LOGIN === '1') return true;
  if (process.env.ALLOW_DEV_LOGIN === '0') return false;
  const googleConfigured =
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  return !IS_PROD && !googleConfigured;
}

/**
 * Validate the environment. Throws in production when required values are
 * missing; returns a list of human-readable problems otherwise.
 */
export function validateEnv() {
  const problems = [];
  const warnings = [];

  if (!SESSION_SECRET) {
    problems.push(
      'SESSION_SECRET is required in production (set a long random string).',
    );
  } else if (SESSION_SECRET.length < 16 && IS_PROD) {
    problems.push('SESSION_SECRET is too short — use at least 32 random characters.');
  }

  if (!MONGODB_URI) {
    if (IS_PROD) {
      problems.push(
        'MONGODB_URI is required in production — the app persists users, tickets and dashboards in MongoDB.',
      );
    } else {
      warnings.push(
        'MONGODB_URI is not set — running without persistence (local/session only). Set it to enable real per-user storage.',
      );
    }
  }

  if (IS_PROD && ALLOWED_ORIGINS.length === 0) {
    warnings.push(
      'No FRONTEND_ORIGIN / ALLOWED_ORIGINS set — only same-origin requests will be accepted (fine for single-origin deploys).',
    );
  }

  if (IS_PROD && allowDevLogin()) {
    warnings.push(
      'ALLOW_DEV_LOGIN is enabled in production — demo accounts can sign in without OAuth. Disable it for a public launch.',
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY not set — AI features are disabled.');
  }

  return { problems, warnings };
}

/**
 * Run validation at startup. In production, a fatal problem stops the process.
 */
export function assertEnvOrExit(logger = console) {
  const { problems, warnings } = validateEnv();
  for (const w of warnings) logger.warn ? logger.warn(w) : logger.log(`WARN: ${w}`);
  if (problems.length) {
    for (const p of problems) logger.error ? logger.error(p) : logger.log(`ERROR: ${p}`);
    if (IS_PROD) {
      logger.error
        ? logger.error('Refusing to start in production with the above configuration errors.')
        : logger.log('Refusing to start in production with the above configuration errors.');
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }
  }
  return { problems, warnings };
}
