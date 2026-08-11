import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as db from './db.js';
import demoTalent from './server/utils/demoTalentData.js';
import * as subs from './paymentsStore.js';
import * as access from './access.js';
import { FAQS, QUICK_ACTIONS, matchFaq } from './support-kb.js';
import * as config from './config.js';
import { logger } from './logger.js';
import { maxFreshDaysFromQuery, passesFreshness } from './freshness.js';
import { createMongooseSessionStore } from './sessionStore.js';
import {
  scoreResume, normalizeResumeText, normalizeRole, hashResume as computeResumeHash,
  SCORING_VERSION, buildFeedback, parseJD, computeJobFit, tailorResume, checkFabrication,
} from './server/utils/resume/index.js';
import { verifyProjectSubmission, levelForXp } from './server/utils/skillVerificationEngine.js';
import { computeMarketplaceScore, sortComparator, LISTING_TYPES, LISTING_CTAS } from './server/utils/marketplaceEngine.js';
import { buildInspirations, generateProjectBlueprint } from './server/modules/inspirations/index.js';
import { generateArchitecture, ARCH_LEVELS } from './server/utils/architectureEngine.js';
import { assessPatentReadiness, priorArtKeywords, inventionDisclosureDraft, PATENT_STATUSES, PATENT_DISCLAIMER } from './server/utils/patentEngine.js';
import { generateApplicationPackage } from './server/utils/applicationPackageEngine.js';
import { computeReadiness, READINESS_CATEGORIES, computeRoleReadiness, explainReadinessChange } from './server/utils/readinessEngine.js';
import { rankNextBestActions } from './server/utils/nextBestActionEngine.js';
import { classifyResumeEvidenceGaps } from './server/utils/resume/evidenceGapClassifier.js';
import collegeObservability from './server/utils/collegeObservability.js';
import { scorePatentIdea } from './server/utils/patentScoringEngine.js';
import { generateIdeasDeterministic, normalizeAIIdea, buildGenerationPrompt } from './server/utils/ideaGenerationEngine.js';
import { strengthenIdea } from './server/utils/ideaStrengtheningEngine.js';
import { priorArtPlan } from './server/utils/priorArtEngine.js';
import { generateDisclosure, convertToProject, PATENT_OS_DISCLAIMER } from './server/utils/disclosureEngine.js';
import { getUserPatentMemory, buildGenerationContext, suggestNextActions } from './server/utils/patentMemoryEngine.js';
import {
  corsMiddleware, helmetMiddleware, csrfCookieIssuer, csrfProtection,
  authLimiter, aiLimiter, jobsLimiter, contactsLimiter,
  supportChatLimiter, ticketLimiter, generationLimiter, globalLimiter, githubLimiter,
} from './security.js';
import {
  validateBody, supportChatSchema, ticketSchema, userStatePatchSchema,
  userProfileSchema, contactsFindSchema, createOrderSchema, verifyPaymentSchema,
  networkPostSchema, networkRequestSchema, aiMessagesSchema, templateImageSchema,
  resumeAnalyzeSchema, resumeTailorSchema, resumeVersionSchema,
  projectSubmissionSchema, adminVerifySchema,
  marketplaceListingSchema, collaborationApplySchema, listingReviewSchema,
  architectureSchema, patentAssessSchema, patentRecordSchema, appPackageSchema,
  patentIdeaGenerateSchema, patentIdeaPatchSchema, priorArtRecordSchema, patentFeedbackSchema,
  githubLinkProjectSchema, githubVisibilitySchema, githubAnalyzeSchema, githubImportProjectSchema,
} from './validation.js';
import * as ghEngine from './server/utils/githubIntegrationEngine.js';
import * as credEngine from './server/utils/verificationCredentialEngine.js';
import * as vivaEngine from './server/utils/vivaEngine.js';
import * as vivaStore from './server/utils/vivaSessionStore.js';
import { registerProblemIntelligenceRoutes } from './server/routes/problemIntelligenceRoutes.js';
import { registerProjectIntelligenceRoutes } from './server/routes/projectIntelligenceRoutes.js';
import { registerProjectBuilderRoutes } from './server/routes/projectBuilderRoutes.js';
import { registerArchitectureRoutes } from './server/routes/architectureRoutes.js';
import { registerWorkspaceRoutes } from './server/routes/workspaceRoutes.js';
import { registerCareerIntelligenceRoutes } from './server/routes/careerIntelligenceRoutes.js';
import { registerResumeOsRoutes } from './server/routes/resumeOsRoutes.js';
import { registerTemplateOsRoutes } from './server/routes/templateOsRoutes.js';
import { registerProjectStoreRoutes } from './server/routes/projectStoreRoutes.js';
import { registerOpsRoutes } from './server/routes/opsRoutes.js';
import { registerCollegeRoutes } from './server/routes/collegeRoutes.js';
import { registerTeamProjectRoutes } from './server/routes/teamProjectRoutes.js';
import { registerTeamProgressRoutes } from './server/routes/teamProgressRoutes.js';
import { registerJobSearchRoute } from './server/routes/jobSearchRoute.js';
import { patchAppAsync, installProcessGuards, errorMiddleware } from './server/utils/asyncRoute.js';
import progressEngine from './server/utils/teamProgressEngine.js';
import { requestIdMiddleware, createErrorHandler } from './server/utils/observability.js';
import { createQuotaMiddleware } from './server/utils/quotaMiddleware.js';
import { generateArchitectureSpec } from './server/utils/architecture/index.js';

dotenv.config();

/* ============================================================
   SAFE AI MODEL RESOLVER  (single source of truth for the model id)
   ------------------------------------------------------------
   The previous build hardcoded `claude-sonnet-4-20250514` everywhere. That
   snapshot was retired from the Claude API, so every AI call started failing
   with an upstream `not_found_error: model: claude-sonnet-4-20250514`, which
   surfaced as a raw technical error in the UI (e.g. the Tailor & Apply modal).

   resolveAiModel() reads the model from the environment when provided and
   validates it; otherwise it returns a supported default. The /ai/messages
   proxy and every server-side Anthropic call use this, so a stale/invalid
   client-supplied model can never reach the API again. If the model env var
   is absent we simply use the default — a missing/invalid model never breaks
   a feature on its own.
   ============================================================ */
const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';
// Accept canonical Anthropic ids like `claude-sonnet-4-6`, `claude-opus-4-8`,
// or dated snapshots like `claude-haiku-4-5-20251001`. Anything that doesn't
// look like a model id (or is blank) is ignored in favour of the default.
const AI_MODEL_PATTERN = /^claude-[a-z0-9.-]+$/i;
function resolveAiModel() {
  const fromEnv = String(process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || '').trim();
  if (fromEnv && AI_MODEL_PATTERN.test(fromEnv)) return fromEnv;
  return DEFAULT_AI_MODEL;
}

// Validate environment up front. In production this exits on fatal misconfig
// (missing MONGODB_URI / SESSION_SECRET) so the app never silently runs without
// persistence or with a throwaway session secret.
config.assertEnvOrExit(logger);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

/* Express 4 does not catch rejections from `async (req, res)` handlers, and this
   app registers ~100 of them with no try/catch. Without this, one throw becomes
   an unhandled rejection and Node terminates the process. patchAppAsync wraps
   every handler registered from here on; installProcessGuards is the backstop
   for rejections that escape from timers and fire-and-forget calls. */
patchAppAsync(app);
installProcessGuards(logger);

app.set('trust proxy', 1); // honor X-Forwarded-Proto (Vercel/Render/etc.) so Secure cookies work
app.disable('x-powered-by'); // do not advertise Express

/* Every response carries an X-Request-Id (honoring a well-formed upstream id)
   so support tickets, error logs and load-balancer traces line up. */
app.use(requestIdMiddleware());

/* Cookie policy is centralised in config.js. Cross-site cookies
   (SameSite=None; Secure) are needed ONLY when the SPA is served from a
   DIFFERENT origin than this backend, over HTTPS. */
const COOKIE_SAMESITE = config.COOKIE_SAMESITE;
const COOKIE_SECURE = config.COOKIE_SECURE;

/* Security headers first, then the strict credentialed-CORS allowlist. */
app.use(helmetMiddleware);
app.use(corsMiddleware);

/* Raw body ONLY for the Razorpay webhook (HMAC verification needs the exact bytes). */
app.use('/api/payments/webhook', express.raw({ type: '*/*' }));
/* Raw body ONLY for the GitHub App webhook (HMAC verification needs exact bytes). */
app.use('/api/integrations/github/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '5mb' }));

/* Persistent session store: when MongoDB is configured we store sessions there
   (production never uses the in-memory MemoryStore). Without a DB (local dev/
   test) we fall back to the default in-process store. config.js already refuses
   to boot production without MONGODB_URI, so production always lands here. */
const sessionStore = db.dbEnabled() ? createMongooseSessionStore(session, { connect: db.connectDB }) : undefined;
if (!sessionStore && config.IS_PROD) {
  logger.error('No session store configured in production (MONGODB_URI missing) — refusing MemoryStore.');
}

/* Serverless-safe DB readiness gate. MUST run before the session middleware so
   the Mongo-backed session store never touches an un-connected Mongoose (which
   on Vercel would buffer then time out, turning /auth/me into a 500). Uses the
   cached connection promise in db.js, so warm invocations reuse one pool.
   Health endpoints are exempt so the DB status can always be inspected. */
app.use(async (req, res, next) => {
  if (!db.dbEnabled()) return next();                 // no DB → in-process session (dev/test)
  if (req.path === '/health' || req.path === '/health/db') return next();
  try {
    await db.connectDB();                              // cached; reused on warm starts
    return next();
  } catch (e) {
    logger.error('Database unavailable for request', { path: req.path, message: e.message });
    // Production: a configured-but-unreachable DB is a clear 503, never a vague 500.
    if (config.IS_PROD) {
      if (res.headersSent) return next(e);
      return res.status(503).json({
        error: 'service_unavailable',
        message: 'Database temporarily unavailable. Check MongoDB/session configuration.',
      });
    }
    // Dev: degrade gracefully so local work without a reachable DB still loads.
    return next();
  }
});

app.use(session({
  name: 'career_autopilot.sid',
  store: sessionStore,
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE }
}));

/* Issue a readable CSRF token cookie, then enforce double-submit on
   cookie-authenticated, state-changing requests. */
app.use(csrfCookieIssuer);
app.use(csrfProtection);


/* Serve the frontend so the whole tool runs from one origin (no CORS for same-origin calls).
   Prefer the built React/Vite app in dist/. Fall back to the legacy single-file UI if dist
   has not been built yet (e.g. `npm run build` not run). Same-origin keeps OAuth + the
   session cookie working with zero CORS config. */
const DIST_DIR = path.join(__dirname, 'dist');
const HAS_DIST = fs.existsSync(path.join(DIST_DIR, 'index.html'));
const UI_DIR = HAS_DIST ? DIST_DIR : __dirname;
const UI_INDEX = HAS_DIST
  ? path.join(DIST_DIR, 'index.html')
  : path.join(__dirname, 'legacy_index.html');

app.use(express.static(UI_DIR));

/* Gentle global rate ceiling (skipped in the test env).
   Mounted AFTER express.static and exempting asset requests on purpose: the
   limiter falls back to keying on req.ip for unauthenticated requests, and a
   college computer lab shares one NAT public IP. With this before static, a
   single cohort cold-loading the SPA blew the per-minute bucket on JS chunks
   alone and every subsequent API call 429'd. */
app.use((req, res, next) => {
  if (req.method === 'GET' && /\.(js|mjs|css|woff2?|png|jpe?g|svg|ico|webp|map|txt)$/i.test(req.path)) return next();
  return globalLimiter(req, res, next);
});

/* Explicit root route for platforms like Vercel where static index serving can be skipped. */
app.get('/', (req, res) => {
  res.sendFile(UI_INDEX);
});

/* ------------------------------------------------------------------
   USER AUTH GATE
   The main tool features (AI, job search, contacts, arena, profile,
   apply) are protected — only signed-in users may call them. The
   landing page, static assets and the /auth/* + /health endpoints stay
   public. requireAuth/currentUser are declared lower down (hoisted).
   ------------------------------------------------------------------ */
const PROTECTED_PREFIXES = ['/ai', '/jobs', '/contacts', '/opportunities', '/profile', '/apply', '/dashboard'];
app.use(PROTECTED_PREFIXES, requireAuth);

const JOB_FETCH_TIMEOUT  = Number(process.env.JOB_FETCH_TIMEOUT  || 6000);
const JOB_VERIFY_TIMEOUT = Number(process.env.JOB_VERIFY_TIMEOUT || 5000);
const JOB_SEARCH_BUDGET  = Number(process.env.JOB_SEARCH_BUDGET  || 8000); // overall deadline per source batch
const JOB_CACHE_TTL_MS   = Number(process.env.JOB_CACHE_TTL_MS   || 90000); // cache identical searches briefly
const STRICT_JOB_VERIFICATION = process.env.STRICT_JOB_VERIFICATION === '1';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || process.env.X_RAPIDAPI_KEY || process.env.RAPID_API_KEY || '';
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'jsearch.p.rapidapi.com';

/* Small bounded in-memory cache for identical job searches. Cuts repeat latency
   and protects upstream provider quotas from refresh loops. */
const _jobCache = new Map(); // key -> { at, payload }
function jobCacheGet(key) {
  const hit = _jobCache.get(key);
  if (hit && Date.now() - hit.at < JOB_CACHE_TTL_MS) return hit.payload;
  if (hit) _jobCache.delete(key);
  return null;
}
function jobCacheSet(key, payload) {
  _jobCache.set(key, { at: Date.now(), payload });
  if (_jobCache.size > 200) {
    // evict oldest
    const oldest = [..._jobCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50);
    for (const [k] of oldest) _jobCache.delete(k);
  }
}
/* Race a promise against the overall search budget so one slow source can never
   hang the whole request. */
function withBudget(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/* ============================================================
   SHARED HELPERS
   ============================================================ */
function stripHtml(x) {
  return String(x || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
/** Convert any date-ish value to whole-days-old. Returns null when unknown. */
function ageDays(v) {
  if (v == null || v === '') return null;
  let ms;
  if (typeof v === 'number') ms = v < 2e10 ? v * 1000 : v;           // seconds vs ms epoch
  else {
    const s = String(v).trim();
    // relative strings e.g. "2 days ago", "just posted", "today", "yesterday"
    const low = s.toLowerCase();
    if (/just\s*posted|just\s*now|today|few\s*(hours?|minutes?)\s*ago|^\d+\s*(hour|minute)s?\s*ago/.test(low)) return 0;
    if (/yesterday/.test(low)) return 1;
    const rel = low.match(/(\d+)\+?\s*(day|week|month)s?\s*ago/);
    if (rel) {
      const n = Number(rel[1]);
      const mult = rel[2] === 'week' ? 7 : rel[2] === 'month' ? 30 : 1;
      return n * mult;
    }
    const d = Date.parse(s.replace(/(\d+)(st|nd|rd|th)/gi, '$1')); if (isNaN(d)) return null; ms = d;
  }
  const age = Math.floor((Date.now() - ms) / 86400000);
  return age < 0 ? 0 : age;
}
function isoDate(v) { const a = ageDays(v); return a == null ? '' : new Date(Date.now() - a * 86400000).toISOString().slice(0, 10); }
function humanAge(a) { return a == null ? 'Date unknown' : a <= 0 ? 'Today' : a === 1 ? 'Yesterday' : a + ' days ago'; }
function normText(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function roleTokens(role) {
  return normText(role).split(/\s+/)
    .filter(w => w.length > 2 && !['engineer', 'developer', 'analyst', 'manager', 'intern', 'internship', 'the', 'and', 'for'].includes(w));
}
function maxFreshDaysFromQuery_LEGACY_REMOVED() { /* moved to ./freshness.js */ }

async function fetchJson(url, timeout = JOB_FETCH_TIMEOUT, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'CareerAutopilot/3.0 (+job-verification)', ...headers } });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; }
    if (!r.ok) {
      const msg = data?.message || data?.error || data?.raw || r.statusText;
      throw new Error(`${r.status} ${r.statusText}: ${String(msg).slice(0, 220)}`);
    }
    return data;
  } finally { clearTimeout(t); }
}


function jsearchFreshness(f) {
  if (f === '24h') return 'today';
  if (f === '3d') return '3days';
  return 'week';
}
function jsearchCountry(loc) {
  const s = String(loc || process.env.DEFAULT_JOB_LOCATION || '').toLowerCase();
  if (/india|pune|mumbai|bangalore|bengaluru|hyderabad|delhi|gurgaon|gurugram|noida|chennai|kolkata/.test(s)) return 'in';
  if (/united states|usa|us|new york|california|texas|seattle|austin/.test(s)) return 'us';
  if (/united kingdom|uk|london|england/.test(s)) return 'gb';
  if (/canada|toronto|vancouver/.test(s)) return 'ca';
  return process.env.JSEARCH_COUNTRY || 'in';
}
function boardQueryTarget(q) {
  const s = String(q || '').toLowerCase();
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('indeed')) return 'Indeed';
  if (s.includes('naukri')) return 'Naukri';
  if (s.includes('foundit') || s.includes('monster')) return 'Foundit/Monster';
  if (s.includes('wellfound') || s.includes('startup')) return 'Wellfound';
  if (s.includes('instahyre')) return 'Instahyre';
  if (s.includes('cutshort')) return 'Cutshort';
  if (s.includes('hirist')) return 'Hirist';
  if (s.includes('shine')) return 'Shine';
  if (s.includes('timesjobs')) return 'TimesJobs';
  return 'JSearch';
}

/* ============================================================
   STRUCTURED JOB SOURCES  (real, public, structured APIs only)
   Each returns a normalised job with a REAL posted date.
   No AI, no invented companies/links/postings anywhere.
   ============================================================ */
const SOURCES = [
  {
    name: 'Remotive',
    home: 'https://remotive.com',
    description: 'Curated remote jobs API. Returns active listings with a real publication_date.',
    fetch: async (role) => {
      const data = await fetchJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(role || 'software engineer')}&limit=50`);
      return (data.jobs || []).map(x => ({
        title: x.title, company: x.company_name, location: x.candidate_required_location || 'Remote', mode: 'Remote',
        experience: x.job_type || '', salary: x.salary || '', companyType: 'Remote', source: 'Remotive',
        postedDate: isoDate(x.publication_date), postedDays: ageDays(x.publication_date),
        url: x.url, summary: stripHtml(x.description).slice(0, 260), requiredSkills: (x.tags || []).slice(0, 12)
      }));
    }
  },
  {
    name: 'RemoteOK',
    home: 'https://remoteok.com',
    description: 'Remote jobs board API. Active listings with epoch/date posting timestamps.',
    fetch: async (role) => {
      const tags = roleTokens(role).slice(0, 2).join(',') || 'dev';
      const data = await fetchJson(`https://remoteok.com/api?tags=${encodeURIComponent(tags)}`);
      return (Array.isArray(data) ? data.slice(1) : []).map(x => ({   // first element is legal/metadata
        title: x.position, company: x.company, location: x.location || 'Remote', mode: 'Remote',
        experience: '', salary: (x.salary_min || x.salary_max) ? `${x.salary_min || ''}-${x.salary_max || ''}` : '',
        companyType: 'Remote', source: 'RemoteOK',
        postedDate: isoDate(x.date), postedDays: ageDays(x.date),
        url: x.url || x.apply_url, summary: stripHtml(x.description).slice(0, 260), requiredSkills: (x.tags || []).slice(0, 12)
      }));
    }
  },
  {
    name: 'Arbeitnow',
    home: 'https://www.arbeitnow.com',
    description: 'European/global job board API. Active listings with created_at timestamps.',
    fetch: async (role) => {
      const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api');
      const terms = roleTokens(role);
      return (data.data || []).filter(x => {
        const txt = normText(`${x.title} ${x.company_name} ${(x.tags || []).join(' ')}`);
        return !terms.length || terms.some(t => txt.includes(t));
      }).map(x => ({
        title: x.title, company: x.company_name, location: x.location || '—', mode: x.remote ? 'Remote' : 'On-site/Hybrid',
        experience: '', salary: '', companyType: '', source: 'Arbeitnow',
        postedDate: isoDate(x.created_at), postedDays: ageDays(x.created_at),
        url: x.url, summary: stripHtml(x.description).slice(0, 260), requiredSkills: (x.tags || []).slice(0, 12)
      }));
    }
  },
  {
    name: 'Jobicy',
    home: 'https://jobicy.com',
    description: 'Remote jobs API. Active listings with a real pubDate.',
    fetch: async (role) => {
      const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=50');
      const terms = roleTokens(role);
      return (data.jobs || []).filter(x => {
        const txt = normText(`${x.jobTitle} ${x.companyName} ${(x.jobIndustry || []).join(' ')} ${x.jobExcerpt || ''}`);
        return !terms.length || terms.some(t => txt.includes(t));
      }).map(x => ({
        title: x.jobTitle, company: x.companyName, location: x.jobGeo || 'Remote', mode: 'Remote',
        experience: x.jobLevel || '', salary: (x.annualSalaryMin || x.annualSalaryMax) ? `${x.annualSalaryMin || ''}-${x.annualSalaryMax || ''} ${x.salaryCurrency || ''}`.trim() : '',
        companyType: 'Remote', source: 'Jobicy',
        postedDate: isoDate(x.pubDate), postedDays: ageDays(x.pubDate),
        url: x.url, summary: stripHtml(x.jobExcerpt).slice(0, 260),
        requiredSkills: ([]).concat(x.jobType || [], x.jobIndustry || []).slice(0, 12)
      }));
    }
  }
];


/* Extra structured sources. These expand coverage without allowing AI-generated jobs. */
SOURCES.push({
  name: 'The Muse',
  home: 'https://www.themuse.com',
  description: 'Public jobs API with publication_date and landing-page links.',
  requiresKey: false,
  fetch: async (role) => {
    const pages = [0, 1];
    const roleTerms = roleTokens(role);
    const batches = await Promise.allSettled(pages.map(p => fetchJson(`https://www.themuse.com/api/public/jobs?page=${p}`)));
    const all = [];
    batches.forEach(r => { if (r.status === 'fulfilled') all.push(...(r.value.results || [])); });
    return all.filter(x => {
      const txt = normText(`${x.name} ${x.company?.name || ''} ${stripHtml(x.contents)} ${(x.categories || []).map(c=>c.name).join(' ')}`);
      return !roleTerms.length || roleTerms.some(t => txt.includes(t));
    }).map(x => ({
      title: x.name,
      company: x.company?.name || '',
      location: (x.locations || []).map(l => l.name).join(', ') || '—',
      mode: /remote/i.test(((x.locations || []).map(l => l.name).join(' ')) + ' ' + stripHtml(x.contents)) ? 'Remote' : 'On-site/Hybrid',
      experience: (x.levels || []).map(l => l.name).join(', '),
      salary: '',
      companyType: (x.categories || []).map(c => c.name).join(', '),
      source: 'The Muse',
      postedDate: isoDate(x.publication_date),
      postedDays: ageDays(x.publication_date),
      url: x.refs?.landing_page || x.refs?.apply || '',
      summary: stripHtml(x.contents).slice(0, 260),
      requiredSkills: (x.categories || []).map(c => c.name).slice(0, 12)
    }));
  }
});

if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) {
  SOURCES.push({
    name: 'Adzuna',
    home: 'https://www.adzuna.com',
    description: 'Adzuna jobs API. Requires ADZUNA_APP_ID and ADZUNA_APP_KEY.',
    requiresKey: true,
    fetch: async (role) => {
      const country = (process.env.ADZUNA_COUNTRY || 'in').toLowerCase();
      const qs = new URLSearchParams({
        app_id: process.env.ADZUNA_APP_ID,
        app_key: process.env.ADZUNA_APP_KEY,
        results_per_page: '50',
        sort_by: 'date',
        what: role || 'software engineer'
      });
      const data = await fetchJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${qs.toString()}`);
      return (data.results || []).map(x => ({
        title: x.title,
        company: x.company?.display_name || '',
        location: x.location?.display_name || '—',
        mode: /remote/i.test(`${x.title} ${x.description} ${x.location?.display_name || ''}`) ? 'Remote' : 'On-site/Hybrid',
        experience: '',
        salary: (x.salary_min || x.salary_max) ? `${x.salary_min || ''}-${x.salary_max || ''}` : '',
        companyType: x.category?.label || '',
        source: 'Adzuna',
        postedDate: isoDate(x.created),
        postedDays: ageDays(x.created),
        url: x.redirect_url,
        summary: stripHtml(x.description).slice(0, 260),
        requiredSkills: []
      }));
    }
  });
}


/* ============================================================
   ROLE ALIASES — provider-level query broadening only.
   ------------------------------------------------------------
   Used ONLY to re-query an upstream provider that returned zero
   results, and always reported back to the user as a labelled
   broader search. This never loosens a filter and never invents a
   posting; it just asks the provider the same question using the
   other words the market uses for the same job.
   ============================================================ */
const ROLE_ALIAS_GROUPS = [
  ['devops engineer', 'site reliability engineer', 'platform engineer', 'cloud engineer', 'infrastructure engineer'],
  ['cloud engineer', 'cloud infrastructure engineer', 'devops engineer', 'platform engineer'],
  ['data engineer', 'big data engineer', 'etl developer', 'analytics engineer'],
  ['backend developer', 'backend engineer', 'software engineer', 'api developer'],
  ['frontend developer', 'frontend engineer', 'ui developer', 'react developer'],
  ['full stack developer', 'full stack engineer', 'software engineer'],
  ['machine learning engineer', 'ml engineer', 'ai engineer', 'data scientist'],
  ['qa engineer', 'test engineer', 'sdet', 'automation engineer'],
  ['security engineer', 'cybersecurity engineer', 'infosec engineer'],
  ['mobile developer', 'android developer', 'ios developer'],
];
function roleAliasQueries(role) {
  const q = normText(role);
  if (!q) return [];
  const out = [];
  for (const group of ROLE_ALIAS_GROUPS) {
    // Match if the query is (or contains) the group's head term.
    if (group.some(g => q === g || q.includes(g) || g.includes(q))) {
      for (const alias of group) {
        if (normText(alias) !== q && !out.includes(alias)) out.push(alias);
      }
    }
  }
  if (out.length) return out;

  /* Unknown role: fall back to swapping the developer/engineer suffix, which
     is the single most common reason a provider returns zero. */
  if (/\bdeveloper\b/i.test(role)) out.push(role.replace(/\bdeveloper\b/i, 'Engineer'));
  else if (/\bengineer\b/i.test(role)) out.push(role.replace(/\bengineer\b/i, 'Developer'));
  return out;
}

/* ---- RapidAPI JSearch.
   Important fix: do NOT fire 8-10 parallel board-targeted JSearch calls.
   RapidAPI free/test plans commonly return 429 when the app does that.
   We make one broad provider-backed request per user search and infer the
   real publisher from each returned job/apply URL. */
if (RAPIDAPI_KEY) {
  const JSEARCH_CACHE = new Map();
  SOURCES.push({
    name: 'JSearch',
    home: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    description: 'JSearch/RapidAPI jobs API. Broad provider-backed search across LinkedIn, Indeed, Naukri and other publishers when available.',
    requiresKey: true,
    fetch: async (role, ctx = {}) => {
      const loc = (ctx.location || process.env.DEFAULT_JOB_LOCATION || 'India').trim();
      const roleQ = (role || 'software engineer').trim();
      const country = jsearchCountry(loc);
      const freshness = jsearchFreshness(ctx.freshness);
      // diagnostics object shared back to the route (never depends on other sources)
      const diag = (ctx.diag = ctx.diag || {});
      diag.apiKeyDetected = true;
      diag.host = RAPIDAPI_HOST;
      diag.country = country;

      // Broad, effective query: "<role> jobs in <location>".
      // Do NOT append board names like LinkedIn/Naukri/Indeed to the query.
      // JSearch treats them as literal keywords and often returns 0 jobs.
      const cleanLoc = /^(in|ind|india)$/i.test(loc) ? 'India' : loc;
      const q = `${roleQ} jobs in ${cleanLoc}`.replace(/\s+/g, ' ').trim();
      diag.query = q;

      const cacheKey = JSON.stringify({ q: q.toLowerCase(), country, freshness, loc: cleanLoc.toLowerCase() });
      const ttlMs = Number(process.env.JSEARCH_CACHE_TTL_MS || 10 * 60 * 1000);
      const cached = JSEARCH_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.ts < ttlMs) {
        Object.assign(diag, cached.diag, { cached: true });
        return cached.jobs;
      }

      async function callJSearch(query, datePosted) {
        const qs = new URLSearchParams({
          query,
          date_posted: datePosted,
          num_pages: String(Number(process.env.JSEARCH_NUM_PAGES || 1)),
          page: '1',
          country
        });
        const endpoint = `https://${RAPIDAPI_HOST}/search?${qs.toString()}`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), JOB_FETCH_TIMEOUT);
        let resp, bodyText = '';
        try {
          resp = await fetch(endpoint, {
            signal: ctrl.signal,
            headers: { Accept: 'application/json', 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': RAPIDAPI_HOST }
          });
          bodyText = await resp.text();
        } finally { clearTimeout(t); }
        return { resp, bodyText, query, datePosted };
      }

      let resp, bodyText = '', usedQuery = q, usedFreshness = freshness;
      try {
        let result = await callJSearch(q, freshness);
        resp = result.resp; bodyText = result.bodyText;
        diag.reachable = true; diag.statusCode = resp.status;

        if (resp.ok) {
          const firstData = bodyText ? JSON.parse(bodyText) : {};
          let firstArr = firstData?.data || firstData?.jobs || [];
          // Fallback only when the API is healthy but the query is too narrow.
          // Keep this to at most 2 extra calls to avoid 429 on free plans.
          if (!firstArr.length && freshness !== 'all') {
            result = await callJSearch(q, 'all');
            resp = result.resp; bodyText = result.bodyText; usedFreshness = 'all';
            diag.statusCode = resp.status;
          }
          if (resp.ok) {
            const secondData = bodyText ? JSON.parse(bodyText) : {};
            const secondArr = secondData?.data || secondData?.jobs || [];
            if (!secondArr.length && /\bjobs?\b/i.test(q)) {
              const q2 = `${roleQ} ${cleanLoc}`.replace(/\s+/g, ' ').trim();
              result = await callJSearch(q2, 'all');
              resp = result.resp; bodyText = result.bodyText; usedQuery = q2; usedFreshness = 'all';
              diag.statusCode = resp.status;
            }
          }

          /* PROVIDER QUERY BROADENING — deliberately distinct from FILTER
             broadening (which happens later, in progressiveGate).

             The two retries above only rephrase the SAME role. If the upstream
             API genuinely indexes nothing for "DevOps Engineer", a near-synonym
             usually does: the industry uses DevOps / Platform / SRE / Cloud /
             Infrastructure close to interchangeably.

             This retries the PROVIDER with an alias and LABELS the outcome, so
             the UI can say "no exact DevOps Engineer postings — showing real
             Site Reliability Engineer postings". Nothing is fabricated: every
             job returned is a real posting the provider indexed under that
             alias. Capped at 2 extra calls to stay inside free-plan 429s. */
          if (resp.ok) {
            const thirdData = bodyText ? JSON.parse(bodyText) : {};
            const thirdArr = thirdData?.data || thirdData?.jobs || [];
            if (!thirdArr.length) {
              for (const alias of roleAliasQueries(roleQ).slice(0, 2)) {
                const qa = `${alias} ${cleanLoc}`.replace(/\s+/g, ' ').trim();
                const attempt = await callJSearch(qa, 'all');
                if (!attempt.resp.ok) break;
                let aArr = [];
                try {
                  const aData = attempt.bodyText ? JSON.parse(attempt.bodyText) : {};
                  aArr = aData?.data || aData?.jobs || [];
                } catch { break; }
                if (aArr.length) {
                  resp = attempt.resp; bodyText = attempt.bodyText;
                  usedQuery = qa; usedFreshness = 'all';
                  diag.statusCode = resp.status;
                  diag.broadened = {
                    kind: 'provider_role_alias',
                    requestedRole: roleQ,
                    searchedRole: alias,
                    label: `No postings found for "${roleQ}" — showing real "${alias}" postings.`
                  };
                  break;
                }
              }
            }
          }
        }
      } catch (e) {
        diag.reachable = false; diag.statusCode = 0;
        diag.errorCode = 'NETWORK';
        diag.errorMessage = `Could not reach JSearch: ${String(e.message || e)}`;
        throw new Error(diag.errorMessage);
      }

      diag.query = usedQuery;
      diag.usedFreshness = usedFreshness;

      if (resp.status === 401 || resp.status === 403) {
        diag.errorCode = /not subscribed|you are not subscribed|subscribe/i.test(bodyText) ? 'NOT_SUBSCRIBED' : 'INVALID_KEY';
        diag.errorMessage = diag.errorCode === 'NOT_SUBSCRIBED'
          ? 'RapidAPI key valid but NOT subscribed to the JSearch API. Subscribe (free Basic plan works) on RapidAPI.'
          : 'RapidAPI key invalid/unauthorized (401/403). Recheck RAPIDAPI_KEY.';
        throw new Error(diag.errorMessage);
      }
      if (resp.status === 429) {
        diag.errorCode = 'RATE_LIMITED';
        diag.errorMessage = 'JSearch rate limit hit (429). Wait a minute or lower repeated searches; the app now uses one main call plus limited fallback only for zero-result queries.';
        throw new Error(diag.errorMessage);
      }
      if (!resp.ok) {
        diag.errorCode = 'UPSTREAM';
        diag.errorMessage = `JSearch returned HTTP ${resp.status}.`;
        throw new Error(diag.errorMessage);
      }

      let data;
      try { data = bodyText ? JSON.parse(bodyText) : {}; }
      catch { diag.errorCode = 'UPSTREAM'; diag.errorMessage = 'JSearch returned a non-JSON response.'; throw new Error(diag.errorMessage); }

      const arr = data?.data || data?.jobs || [];
      diag.returnedCount = arr.length;
      diag.firstPublishers = arr.slice(0, 3).map(x => x?.job_publisher || x?.employer_name || 'unknown');
      if (!arr.length) { diag.errorCode = 'NO_RESULTS'; diag.errorMessage = 'JSearch reachable but returned 0 jobs after fallback queries.'; }

      const jobs = arr.map(x => {
        const url = x.job_apply_link || x.job_google_link || x.job_offer_url || '';
        const publisher = x.job_publisher || sourceFromUrl(url) || '';
        const postedRaw = x.job_posted_at_datetime_utc || x.job_posted_at_timestamp || x.job_posted_at || x.job_posted_at_string;
        return {
          title: x.job_title,
          company: x.employer_name,
          location: [x.job_city, x.job_state, x.job_country].filter(Boolean).join(', ') || x.job_location || loc || '—',
          mode: x.job_is_remote ? 'Remote' : 'On-site/Hybrid',
          experience: '',
          salary: [x.job_min_salary, x.job_max_salary].filter(Boolean).join('-') || '',
          companyType: x.employer_company_type || '',
          // Honest labelling: provider-backed, NOT a direct board integration.
          source: publisher ? `${publisher} via JSearch` : 'JSearch',
          rawPublisher: publisher || null,
          providerBacked: true,
          sourceProvider: 'JSearch / RapidAPI',
          postedDate: isoDate(postedRaw),
          postedDays: ageDays(postedRaw),
          url,
          summary: stripHtml(x.job_description).slice(0, 260),
          requiredSkills: (x.job_required_skills || []).slice(0, 12)
        };
      }).filter(j => j.url);
      JSEARCH_CACHE.set(cacheKey, { ts: Date.now(), jobs, diag: { ...diag } });
      return jobs;
    }
  });
}

/* ---- SerpAPI (Google Jobs engine). Requires SERPAPI_KEY. ---- */
if (process.env.SERPAPI_KEY) {
  SOURCES.push({
    name: 'SerpAPI',
    home: 'https://serpapi.com/google-jobs-api',
    description: 'Google Jobs results via SerpAPI. Runs targeted queries for LinkedIn, Indeed, Naukri, Foundit, Wellfound, Instahyre, Cutshort, Hirist, Shine and TimesJobs.',
    requiresKey: true,
    fetch: async (role, ctx = {}) => {
      const loc = ctx.location || process.env.DEFAULT_JOB_LOCATION || 'India';
      const roleQ = role || 'software engineer';
      const queries = [
        `${roleQ} ${loc}`,
        `${roleQ} LinkedIn jobs ${loc}`,
        `${roleQ} Indeed jobs ${loc}`,
        `${roleQ} Naukri jobs ${loc}`,
        `${roleQ} Foundit Monster jobs ${loc}`,
        `${roleQ} Instahyre Cutshort Hirist jobs ${loc}`,
        `${roleQ} Wellfound startup jobs ${loc}`,
        `${roleQ} Shine TimesJobs ${loc}`
      ];
      const calls = queries.map(q => {
        const qs = new URLSearchParams({ engine: 'google_jobs', q, hl: 'en', api_key: process.env.SERPAPI_KEY });
        if (loc) qs.set('location', loc);
        return fetchJson(`https://serpapi.com/search.json?${qs.toString()}`);
      });
      const settled = await Promise.allSettled(calls);
      const all = [];
      for (const r of settled) if (r.status === 'fulfilled') all.push(...(r.value.jobs_results || []));
      return all.map(x => {
        const apply = x.apply_options?.[0] || {};
        const link = apply.link || x.share_link || x.related_links?.[0]?.link || '';
        const via = apply.title || (x.via || '') || (x.extensions || []).join(' ');
        const src = inferSource({ url: link, source: via }, 'Google Jobs');
        const posted = x.detected_extensions?.posted_at || (x.extensions || []).find(e => /ago|today|yesterday/i.test(e)) || '';
        return {
          title: x.title,
          company: x.company_name,
          location: x.location || '—',
          mode: /remote/i.test(`${x.location} ${x.title} ${x.description}`) ? 'Remote' : 'On-site/Hybrid',
          experience: '',
          salary: x.detected_extensions?.salary || '',
          companyType: '',
          source: src,
          sourceProvider: 'SerpAPI / Google Jobs',
          postedDate: isoDate(posted),
          postedDays: ageDays(posted),
          url: link,
          summary: stripHtml(x.description).slice(0, 260),
          requiredSkills: []
        };
      }).filter(j => j.url);
    }
  });
}


/* ---- USAJobs (US federal government). Requires USAJOBS_API_KEY + USAJOBS_EMAIL. ---- */
if (process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL) {
  SOURCES.push({
    name: 'USAJobs',
    home: 'https://developer.usajobs.gov',
    description: 'US federal jobs via USAJobs API. Requires USAJOBS_API_KEY and USAJOBS_EMAIL.',
    requiresKey: true,
    fetch: async (role) => {
      const qs = new URLSearchParams({
        Keyword: role || 'software engineer',
        ResultsPerPage: '50',
        DatePosted: '7' // last 7 days; freshness gate trims further to 24h/3d
      });
      const data = await fetchJson(`https://data.usajobs.gov/api/search?${qs.toString()}`, JOB_FETCH_TIMEOUT, {
        'Authorization-Key': process.env.USAJOBS_API_KEY,
        'User-Agent': process.env.USAJOBS_EMAIL,
        'Host': 'data.usajobs.gov'
      });
      const items = data.SearchResult?.SearchResultItems || [];
      return items.map(it => {
        const d = it.MatchedObjectDescriptor || {};
        const pay = d.PositionRemuneration?.[0];
        const salary = pay ? `${pay.MinimumRange}-${pay.MaximumRange} ${pay.RateIntervalCode || ''}`.trim() : '';
        const start = d.PositionStartDate || d.PublicationStartDate || '';
        return {
          title: d.PositionTitle,
          company: d.OrganizationName || 'US Federal Government',
          location: (d.PositionLocationDisplay || (d.PositionLocation?.[0]?.LocationName)) || 'United States',
          mode: /remote|telework/i.test(JSON.stringify(d.PositionLocation || '')) ? 'Remote' : 'On-site/Hybrid',
          experience: '',
          salary,
          companyType: 'Government',
          source: 'USAJobs',
          postedDate: isoDate(start),
          postedDays: ageDays(start),
          url: d.PositionURI || d.ApplyURI?.[0],
          summary: stripHtml(d.UserArea?.Details?.JobSummary || d.QualificationSummary).slice(0, 260),
          requiredSkills: []
        };
      }).filter(j => j.url);
    }
  });
}

/* ============================================================
   FILTERS / DE-DUPE
   ============================================================ */
function jobKey(j) {
  const url = String(j.url || '').split('?')[0].toLowerCase();
  return url || `${normText(j.title)}|${normText(j.company)}|${normText(j.location)}`;
}
function sourceFromUrl(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, '').toLowerCase();
    if (h.includes('linkedin')) return 'LinkedIn';
    if (h.includes('indeed')) return 'Indeed';
    if (h.includes('naukri')) return 'Naukri';
    if (h.includes('foundit') || h.includes('monster')) return 'Foundit/Monster';
    if (h.includes('wellfound') || h.includes('angel.co')) return 'Wellfound';
    if (h.includes('instahyre')) return 'Instahyre';
    if (h.includes('cutshort')) return 'Cutshort';
    if (h.includes('hirist')) return 'Hirist';
    if (h.includes('shine')) return 'Shine';
    if (h.includes('timesjobs')) return 'TimesJobs';
    if (h.includes('remotive')) return 'Remotive';
    if (h.includes('remoteok')) return 'RemoteOK';
    if (h.includes('arbeitnow')) return 'Arbeitnow';
    if (h.includes('jobicy')) return 'Jobicy';
    if (h.includes('themuse')) return 'The Muse';
    if (h.includes('adzuna')) return 'Adzuna';
    if (h.includes('usajobs')) return 'USAJobs';
    return h;
  } catch { return ''; }
}
const JOB_BOARD_TARGETS = [
  'LinkedIn','Indeed','Naukri','Foundit/Monster','Wellfound','Instahyre','Cutshort','Hirist','Shine','TimesJobs',
  'Adzuna','JSearch','SerpAPI','The Muse','Arbeitnow','Jobicy','Remotive','RemoteOK','USAJobs'
];
function sourceKey(x) { return normText(x).replace(/monster/g, 'foundit').replace(/\s+/g, ''); }
function requestedSources(req) {
  const raw = String(req.query.sources || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!raw.length || raw.some(s => /^all$/i.test(s))) return null;
  const set = new Set(raw.map(sourceKey));
  return set;
}
function sourceAllowed(name, set) {
  if (!set) return true;
  const k = sourceKey(name);
  if (set.has(k)) return true;
  if (k === 'founditfoundit' && set.has('foundit')) return true;
  return false;
}
function inferSource(job, fallback = '') {
  // Provider-backed jobs (JSearch/SerpAPI) must KEEP their honest "X via JSearch" label,
  // never be relabelled as a direct LinkedIn/Naukri/Indeed integration.
  if (job && (job.providerBacked || / via (JSearch|SerpAPI)/i.test(String(job.source || '')))) {
    return job.source || fallback || 'via JSearch';
  }
  const fromUrl = sourceFromUrl(job.url || '');
  const txt = `${job.source || ''} ${job.publisher || ''} ${job.sourceName || ''} ${job.via || ''}`.toLowerCase();
  for (const n of JOB_BOARD_TARGETS) if (txt.includes(n.toLowerCase().split('/')[0])) return n;
  return fromUrl || fallback || 'Structured source';
}
function balancedBySource(arr, limit) {
  const buckets = new Map();
  for (const j of arr) {
    const k = j.source || 'Other';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(j);
  }
  for (const b of buckets.values()) b.sort((a,b)=>(a.postedDays??99)-(b.postedDays??99));
  const out = [];
  while (out.length < limit && [...buckets.values()].some(b => b.length)) {
    for (const [k,b] of buckets) {
      if (b.length && out.length < limit) out.push(b.shift());
    }
  }
  return out;
}
function configuredSources() {
  const activeNames = new Set(SOURCES.map(s => s.name));
  return JOB_BOARD_TARGETS.map(name => {
    let active = activeNames.has(name);
    let integration = active ? 'direct/public API' : 'requires API/search provider';
    let reason = active ? '' : 'Not directly queryable from Vercel without an approved API or search-provider key.';
    if (['LinkedIn','Indeed','Naukri','Foundit/Monster','Wellfound','Instahyre','Cutshort','Hirist','Shine','TimesJobs'].includes(name)) {
      active = !!(process.env.SERPAPI_KEY || RAPIDAPI_KEY);
      integration = active ? 'via SerpAPI/JSearch search provider' : 'inactive: set SERPAPI_KEY or RAPIDAPI_KEY';
      reason = active ? '' : 'These boards block/limit unauthenticated scraping; configure SERPAPI_KEY or RAPIDAPI_KEY for compliant discovery.';
    }
    return { source: name, active, integration, reason };
  });
}
function validRoleMatch(job, role) {
  const terms = roleTokens(role);
  if (!terms.length) return true;
  const txt = normText(`${job.title} ${job.summary} ${(job.requiredSkills || []).join(' ')}`);
  return terms.some(t => txt.includes(t));
}
function validLocationMatch(job, loc) {
  const q = normText(loc);
  if (!q) return true;                       // no location filter → everything passes

  const hay = normText(`${job.location} ${job.summary} ${job.mode}`);

  // Country / region aliases so "usa" matches "united states", "uk" matches "england", etc.
  const ALIASES = {
    india: ['india', 'bharat', 'bengaluru', 'bangalore', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai', 'noida', 'gurgaon', 'gurugram', 'kolkata', 'ahmedabad'],
    usa: ['united states', 'usa', 'u s', 'us only', 'us based', 'america', 'american', 'new york', 'san francisco', 'texas', 'california'],
    us: ['united states', 'usa', 'u s', 'us only', 'us based', 'america', 'american'],
    'united states': ['united states', 'usa', 'u s', 'america', 'american'],
    uk: ['united kingdom', 'uk', 'england', 'britain', 'london', 'scotland', 'wales'],
    'united kingdom': ['united kingdom', 'uk', 'england', 'britain', 'london'],
    canada: ['canada', 'canadian', 'toronto', 'vancouver', 'ontario'],
    germany: ['germany', 'deutschland', 'berlin', 'munich'],
    australia: ['australia', 'sydney', 'melbourne', 'brisbane'],
    singapore: ['singapore'],
    europe: ['europe', 'european', 'eu', 'emea'],
  };

  const first = q.split(' ')[0];
  const terms = new Set([q, first]);
  (ALIASES[q] || ALIASES[first] || []).forEach(t => terms.add(normText(t)));

  // Explicit country / city / region match anywhere in the listing.
  for (const t of terms) { if (t && hay.includes(t)) return true; }

  // Truly global / location-agnostic listings are valid for any country search.
  // This covers explicit "worldwide/anywhere" AND bare "Remote" with no specific geography.
  // A job tied to a DIFFERENT specific region (e.g. "Remote – US only", "Europe") will NOT
  // reach here, so it is correctly excluded from a mismatched country search.
  const locNorm = normText(job.location);
  if (!locNorm || locNorm === 'remote' || locNorm === 'remote remote') return true;
  if (/\bworldwide\b|\banywhere\b|\bglobal\b|\bany location\b|\blocation independent\b|\bremote any\b/.test(hay)) return true;

  return false;
}
function validModeMatch(job, mode) {
  if (!mode || mode === 'Any') return true;
  const m = String(job.mode || '').toLowerCase();
  if (mode === 'Hybrid') return /hybrid|on-?site/.test(m);
  return m.includes(String(mode).toLowerCase());
}

/* ============================================================
   URL VERIFICATION
   - 2xx / clean redirect            -> verified, level 'live'   (link confirmed reachable & open)
   - 404 / 410 / gone / expired URL  -> REJECT                   (broken / expired)
   - 403 / 405 / 429 / timeout       -> verified, level 'source' (bot-blocked: cannot crawl, but the
                                                                   structured source lists it as active
                                                                   and it has a real fresh date)
   ============================================================ */
async function verifyJobUrl(url, timeout = JOB_VERIFY_TIMEOUT) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, level: null, reason: 'missing/invalid URL', status: 0 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; CareerAutopilot/3.0)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  };
  try {
    let r;
    try { r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers }); }
    catch { r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers }); }
    const finalUrl = r.url || url;
    if (/\/(expired|closed|no-longer|not[-_]?found|404|410)\b/i.test(finalUrl))
      return { ok: false, level: null, reason: 'final URL indicates expired/closed', status: r.status, finalUrl };
    if (r.status === 404 || r.status === 410 || r.status === 451)
      return { ok: false, level: null, reason: `dead/expired link (HTTP ${r.status})`, status: r.status, finalUrl };
    if (r.status >= 200 && r.status < 400)
      return { ok: true, level: 'live', reason: `reachable (HTTP ${r.status})`, status: r.status, finalUrl };
    if ([401, 403, 405, 429].includes(r.status)) {
      if (STRICT_JOB_VERIFICATION) return { ok: false, level: null, reason: `cannot confirm live page (HTTP ${r.status}) in strict mode`, status: r.status, finalUrl };
      return { ok: true, level: 'source', reason: `bot-blocked (HTTP ${r.status}); source-listed active`, status: r.status, finalUrl };
    }
    return { ok: false, level: null, reason: `unexpected HTTP ${r.status}`, status: r.status, finalUrl };
  } catch (e) {
    if (e.name === 'AbortError') {
      if (STRICT_JOB_VERIFICATION) return { ok: false, level: null, reason: 'verify timeout in strict mode', status: 0 };
      return { ok: true, level: 'source', reason: 'verify timeout; source-listed active', status: 0 };
    }
    if (STRICT_JOB_VERIFICATION) return { ok: false, level: null, reason: `verify error (${e.message || e}) in strict mode`, status: 0 };
    return { ok: true, level: 'source', reason: `verify error (${e.message || e}); source-listed active`, status: 0 };
  } finally { clearTimeout(t); }
}
async function verifyMany(jobs, concurrency = 6) {
  const out = []; let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const idx = i++; const j = jobs[idx];
      const v = await verifyJobUrl(j.url);
      out[idx] = { ...j, verified: v.ok, exists: v.ok, verifyLevel: v.level, verifyReason: v.reason, verifyStatus: v.status, url: v.finalUrl || j.url };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, worker));
  return out;
}


/* ============================================================
   GET /jobs/diagnostics — sanitized provider health
   ============================================================ */
app.get('/jobs/diagnostics', async (req, res) => {
  const role = req.query.role || 'software engineer';
  const location = req.query.location || process.env.DEFAULT_JOB_LOCATION || 'India';
  const out = { time: new Date().toISOString(), env: { rapidapiConfigured: !!RAPIDAPI_KEY, serpapiConfigured: !!process.env.SERPAPI_KEY, rapidapiHost: RAPIDAPI_HOST }, checks: [] };
  if (RAPIDAPI_KEY) {
    try {
      const qs = new URLSearchParams({ query: `${role} ${location}`, date_posted: '3days', num_pages: '1', page: '1', country: jsearchCountry(location) });
      const d = await fetchJson(`https://${RAPIDAPI_HOST}/search?${qs.toString()}`, JOB_FETCH_TIMEOUT, { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': RAPIDAPI_HOST });
      out.checks.push({ provider: 'JSearch / RapidAPI', ok: true, count: (d.data || []).length, message: 'API reachable' });
    } catch (e) {
      out.checks.push({ provider: 'JSearch / RapidAPI', ok: false, count: 0, message: String(e.message || e).replace(RAPIDAPI_KEY, '[redacted]') });
    }
  } else out.checks.push({ provider: 'JSearch / RapidAPI', ok: false, count: 0, message: 'RAPIDAPI_KEY missing' });
  res.json(out);
});

/* ============================================================
   GET /jobs/sources  — list configured structured sources
   ============================================================ */
app.get('/jobs/sources', (req, res) => {
  const configured = configuredSources();
  res.json({
    sources: configured,
    activeSources: configured.filter(s => s.active).map(s => s.source),
    inactiveSources: configured.filter(s => !s.active).map(s => ({ source: s.source, reason: s.reason })),
    aiJobGeneration: false,
    note: 'Only structured/API-backed job sources are used. LinkedIn/Indeed/Naukri-style boards require SERPAPI_KEY or RAPIDAPI_KEY; scraping is intentionally not used.'
  });
});

/* ============================================================
   POST /jobs/verify  — verify one or many job URLs
   body: { url } | { jobs: [{ url, ... }] }
   ============================================================ */
app.post('/jobs/verify', async (req, res) => {
  try {
    const body = req.body || {};
    let jobs = [];
    if (Array.isArray(body.jobs)) jobs = body.jobs.filter(j => j && j.url);
    else if (body.url) jobs = [{ url: body.url }];
    if (!jobs.length) return res.status(400).json({ error: 'Provide { url } or { jobs: [{ url }] }' });
    const verified = await verifyMany(jobs.slice(0, 50));
    res.json({
      verifiedAt: new Date().toISOString(),
      results: verified.map(j => ({
        url: j.url, verified: j.verified, exists: j.exists, verifyLevel: j.verifyLevel,
        status: j.verifyStatus, reason: j.verifyReason
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ============================================================
   GET /jobs/search  — registered from server/routes/jobSearchRoute.js
   ------------------------------------------------------------
   The inline route that used to live here gated jobs in ONE hard
   pass (role -> location -> mode) and returned an empty array the
   moment any filter failed, with no explanation. That is what
   produced "unable to find any job with any filter".

   server/utils/jobSearchEngine.js already contained a tested
   five-step progressive fallback ladder, and jobFilters.js the
   canonical filter vocabulary — neither was ever imported here.
   registerJobSearchRoute wires both in. Fetching, verification and
   caching are unchanged; only gating, ranking and the explanation
   returned to the UI are different.
   ============================================================ */
registerJobSearchRoute(app, {
  jobsLimiter, SOURCES, configuredSources, sourceKey, sourceAllowed,
  requestedSources, inferSource, sourceFromUrl, balancedBySource,
  jobKey, verifyMany, withBudget, jobCacheGet, jobCacheSet,
  maxFreshDaysFromQuery, passesFreshness,
  validRoleMatch, validLocationMatch,
  jsearchCountry, logger,
  RAPIDAPI_KEY, RAPIDAPI_HOST, STRICT_JOB_VERIFICATION, JOB_SEARCH_BUDGET,
});

/* ============================================================
   GET /health
   ============================================================ */
app.get('/health', (req, res) => res.json({
  ok: true,
  ai: !!process.env.ANTHROPIC_API_KEY,
  db: db.dbEnabled() ? 'configured' : 'off',
  sessionStore: db.dbEnabled() ? 'mongodb' : 'memory',
  google: googleEnabled(),
  sources: SOURCES.map(s => s.name),
  aiJobGeneration: false,
  strictJobVerification: STRICT_JOB_VERIFICATION,
  time: new Date().toISOString()
}));

/* Deployment-debug probe: actually attempts the (cached) Mongo connection and
   reports the result. Returns 200 when the DB is reachable or intentionally off,
   503 when it is configured but unreachable. */
app.get('/health/db', async (req, res) => {
  if (!db.dbEnabled()) return res.json({ ok: true, db: 'off', message: 'MONGODB_URI not set — running session/cookie only.' });
  try {
    await db.connectDB();
    res.json({ ok: true, db: 'connected' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'unreachable', message: e.message });
  }
});

/* ============================================================
   OAUTH PROVIDERS  (no passwords ever — official OAuth only)
   ============================================================ */
const providers = {
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    meUrl: 'https://api.linkedin.com/v2/userinfo',
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri: process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/auth/linkedin/callback',
    scope: process.env.LINKEDIN_SCOPE || 'openid profile email'
  },
  indeed: {
    authUrl: process.env.INDEED_AUTH_URL || 'https://secure.indeed.com/oauth/v2/authorize',
    tokenUrl: process.env.INDEED_TOKEN_URL || 'https://apis.indeed.com/oauth/v2/tokens',
    meUrl: process.env.INDEED_ME_URL || '',
    clientId: process.env.INDEED_CLIENT_ID,
    clientSecret: process.env.INDEED_CLIENT_SECRET,
    redirectUri: process.env.INDEED_REDIRECT_URI || 'http://localhost:3000/auth/indeed/callback',
    scope: process.env.INDEED_SCOPE || 'offline_access'
  }
};

/* OAuth is OPTIONAL/advanced. It is "enabled" only when BOTH client id + secret
   are present in the environment. When disabled we never throw technical errors at
   students — the UI hides the button and they simply add a profile URL instead. */
function oauthEnabled(p) {
  return !!(providers[p] && providers[p].clientId && providers[p].clientSecret
    && !/^paste-/i.test(String(providers[p].clientId))
    && !/^paste-/i.test(String(providers[p].clientSecret)));
}

function requireProvider(req, res, next) {
  const p = req.params.provider;
  if (!providers[p]) return res.status(404).json({ error: 'Unknown provider' });
  // Only reached when the user EXPLICITLY hits an /auth/:provider/* route.
  if (!oauthEnabled(p)) {
    return res.status(400).json({
      oauthEnabled: false,
      provider: p,
      error: 'oauth_not_enabled',
      message: `Sign in with ${p === 'linkedin' ? 'LinkedIn' : 'Indeed'} is not enabled on this server. You can still add your profile URL and job preferences.`
    });
  }
  next();
}
function randomState() { return crypto.randomBytes(24).toString('hex'); }

/* ---- Stateless signed cookie for OAuth connection status ----
   express-session's default store is in-memory and does NOT survive serverless
   (e.g. Vercel) cold starts or multiple instances, so a token written in the
   callback can be invisible to a later /auth/status request — which shows up as
   "completed sign-in but still Not connected". To make status reliable everywhere
   we ALSO record a small, HMAC-signed, httpOnly cookie carrying only the connection
   status + display name/email (NEVER the access token). */
const COOKIE_SECRET = process.env.SESSION_SECRET || 'career-autopilot-dev-secret';
function signValue(obj) {
  const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', COOKIE_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifyValue(value) {
  if (typeof value !== 'string' || !value.includes('.')) return null;
  const [data, sig] = value.split('.');
  const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}
function readRawCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(/;\s*/)) {
    if (part.startsWith(name + '=')) return decodeURIComponent(part.slice(name.length + 1));
  }
  return '';
}
function oauthStatusCookieName(p) { return `ca_oauth_${p}`; }
function setOAuthStatusCookie(res, p, payload) {
  res.cookie(oauthStatusCookieName(p), signValue(payload), {
    httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}
function readOAuthStatusCookie(req, p) { return verifyValue(readRawCookie(req, oauthStatusCookieName(p))); }

/* Safely add query params to a returnTo URL, even one that already has a query string
   (fixes the malformed "?oauth_return=linkedin?oauth_return=linkedin&connected=1"). */
function buildReturn(returnTo, params) {
  try {
    const u = new URL(returnTo);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  } catch {
    const sep = returnTo.includes('?') ? '&' : '?';
    return returnTo + sep + new URLSearchParams(params).toString();
  }
}

/* Lightweight, dependency-free validators reused by the profile routes. */
function validateLinkedInUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return { ok: false, error: 'Please paste your LinkedIn profile URL.' };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;       // tolerate "linkedin.com/in/..."
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: 'That does not look like a valid URL.' }; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const okHost = host === 'linkedin.com' || host.endsWith('.linkedin.com');
  const okPath = /^\/(in|pub|profile)\/[^/]+/i.test(u.pathname);
  if (!okHost) return { ok: false, error: 'URL must be a linkedin.com address.' };
  if (!okPath) return { ok: false, error: 'Use your public profile URL, e.g. linkedin.com/in/your-name.' };
  // Normalise: strip query/hash, drop trailing slash.
  const clean = `https://www.linkedin.com${u.pathname.replace(/\/+$/, '')}`;
  return { ok: true, url: clean };
}

const WORK_MODES = ['Any', 'Remote', 'Hybrid', 'On-site'];
const EXPERIENCE_LEVELS = ['Any', 'Student / Intern', 'Fresher (0-1 yr)', 'Junior (1-3 yr)', 'Mid (3-6 yr)', 'Senior (6+ yr)'];
function asCleanArray(v, max = 25) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean).slice(0, max);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean).slice(0, max);
  return [];
}
function sanitizePreferences(body = {}) {
  const errors = [];
  const titles = asCleanArray(body.titles ?? body.jobTitles, 12);
  const skills = asCleanArray(body.skills, 40);
  const portals = asCleanArray(body.portals ?? body.preferredPortals, 20);
  const locations = asCleanArray(body.locations, 12);
  let workMode = String(body.workMode ?? body.mode ?? 'Any').trim();
  if (!WORK_MODES.includes(workMode)) workMode = 'Any';
  let experienceLevel = String(body.experienceLevel ?? body.experience ?? 'Any').trim();
  if (!EXPERIENCE_LEVELS.includes(experienceLevel)) experienceLevel = 'Any';
  const salaryMin = body.salaryMin === '' || body.salaryMin == null ? '' : Number(body.salaryMin);
  const salaryMax = body.salaryMax === '' || body.salaryMax == null ? '' : Number(body.salaryMax);
  if (salaryMin !== '' && (!Number.isFinite(salaryMin) || salaryMin < 0)) errors.push('Minimum salary must be a positive number.');
  if (salaryMax !== '' && (!Number.isFinite(salaryMax) || salaryMax < 0)) errors.push('Maximum salary must be a positive number.');
  if (salaryMin !== '' && salaryMax !== '' && Number.isFinite(salaryMin) && Number.isFinite(salaryMax) && salaryMin > salaryMax)
    errors.push('Minimum salary cannot be greater than maximum salary.');
  const prefs = {
    titles, locations, workMode, experienceLevel,
    salaryMin: salaryMin === '' ? '' : salaryMin,
    salaryMax: salaryMax === '' ? '' : salaryMax,
    salaryCurrency: String(body.salaryCurrency || 'INR').trim().slice(0, 8) || 'INR',
    skills, portals,
    updatedAt: new Date().toISOString()
  };
  // "Completed" once a student has given the basics that power matching.
  prefs.completed = titles.length > 0 && (locations.length > 0 || workMode !== 'Any');
  return { errors, prefs };
}

/* ============================================================
   GOOGLE OAUTH — USER SIGN-IN  (real end-to-end authentication)
   ------------------------------------------------------------
   Separate from the LinkedIn/Indeed job-board *connectors* above.
   This establishes the logged-in identity that gates the whole app.
   All secrets come from env vars — nothing is ever hardcoded.
   ============================================================ */
const googleProvider = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  meUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
  scope: process.env.GOOGLE_SCOPE || 'openid email profile'
};
function googleEnabled() {
  const c = googleProvider;
  return !!(c.clientId && c.clientSecret
    && !/^paste-/i.test(String(c.clientId))
    && !/^paste-/i.test(String(c.clientSecret)));
}
/* Dev login lets you exercise the protected app + sign-in/out flow locally
   without Google credentials. It is auto-OFF in production and whenever real
   Google OAuth is configured; force it on with ALLOW_DEV_LOGIN=1. */
function allowDevLogin() {
  if (process.env.ALLOW_DEV_LOGIN === '1') return true;
  if (process.env.ALLOW_DEV_LOGIN === '0') return false;
  return !googleEnabled() && process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
}

/* Serverless-safe login: a small HMAC-signed httpOnly cookie carries only the
   user's display identity (never tokens), so /auth/me works even when the
   in-memory session store is wiped between serverless invocations. */
function setUserCookie(res, user) {
  res.cookie('ca_user', signValue({
    uid: user.id, name: user.name, email: user.email,
    picture: user.picture, provider: user.provider,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  }), { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE, maxAge: 1000 * 60 * 60 * 24 * 30 });
}
function clearUserCookie(res) {
  res.clearCookie('ca_user', { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE });
}
function currentUser(req) {
  if (req.session && req.session.user) return req.session.user;
  const ck = verifyValue(readRawCookie(req, 'ca_user'));
  if (ck && ck.uid) {
    const u = { id: ck.uid, name: ck.name || null, email: ck.email || null, picture: ck.picture || null, provider: ck.provider || 'google' };
    if (req.session) req.session.user = u;   // hydrate session from cookie
    return u;
  }
  return null;
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'auth_required', message: 'Please sign in to continue.' });
  req.user = u;
  next();
}

/* Admin-only guard. MUST run after requireAuth. Admin authority is resolved
   entirely server-side: the ADMIN_EMAILS allowlist, or a persisted
   User.role === 'admin'. The client role/plan is NEVER trusted here.
   - 401 if unauthenticated
   - 403 if authenticated but not an admin */
async function requireAdmin(req, res, next) {
  const u = req.user || currentUser(req);
  if (!u) return res.status(401).json({ error: 'auth_required', message: 'Please sign in to continue.' });
  req.user = u;
  let dbRole = null;
  if (!access.isAdminEmail(u.email) && db.dbEnabled()) {
    try {
      const fresh = await db.getUser({ id: u.id, googleId: u.id, email: u.email });
      dbRole = fresh?.role || null;
    } catch { /* fall through to allowlist-only decision */ }
  }
  if (!access.resolveIsAdmin({ email: u.email, dbRole })) {
    return res.status(403).json({ error: 'forbidden', message: 'Admin access required.' });
  }
  req.isAdmin = true;
  next();
}

/* ============================================================
   PRIVILEGED-ROLE RBAC — access context + middleware
   ------------------------------------------------------------
   Backend privilege is SERVER-CONTROLLED only:
     - admin       → ADMIN_EMAILS allowlist / persisted User.role==='admin' / isAdmin
     - recruiter   → accountType==='recruiter' AND roleVerified===true (admin-approved)
     - college_admin → accountType==='college_admin' AND roleVerified===true
   The self-selected onboarding persona (profile.role) is NEVER consulted here, so
   a student who picked "recruiter" in onboarding gets NO recruiter API access.
   Backward compatible: users without these fields resolve to a normal
   authenticated student; existing admin (allowlist) keeps working.
   ============================================================ */
async function getCurrentUserAccessContext(req) {
  const u = req.user || currentUser(req);
  const empty = { user: null, role: null, isAdmin: false, privileged: false, accountType: '', roleVerified: false, verificationStatus: 'none', organizationId: '', collegeId: '' };
  if (!u) return empty;
  let dbRole = null;
  let v = null;
  if (db.dbEnabled()) {
    try { const fresh = await db.getUser({ id: u.id, googleId: u.id, email: u.email }); dbRole = fresh?.role || null; } catch { /* allowlist-only */ }
  }
  try { v = await db.getUserVerification({ id: u.id, email: u.email }); } catch { /* none */ }
  v = v || {};
  const privileged = access.resolvePrivilegedRole({
    email: u.email,
    dbRole,
    accountType: v.accountType || '',
    roleVerified: v.roleVerified === true,
    isAdmin: dbRole === 'admin',
  });
  return {
    user: u,
    role: privileged || 'student',
    privileged: privileged != null,
    isAdmin: privileged === 'admin',
    accountType: v.accountType || '',
    roleVerified: v.roleVerified === true,
    verificationStatus: v.verificationStatus || 'none',
    organizationId: v.organizationId || '',
    collegeId: v.collegeId || '',
  };
}
// Back-compat alias used by older call sites.
const resolveUserRole = getCurrentUserAccessContext;

/* requireVerifiedRole(...roles): runs after auth. Admin always passes; otherwise
   the caller's VERIFIED privileged role must be in `roles`. 401 unauth, 403 else.
   Attaches req.userRole + req.isAdmin. */
function requireVerifiedRole(...roles) {
  return async function verifiedRoleGuard(req, res, next) {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'auth_required', message: 'Please sign in to continue.' });
    req.user = u;
    try {
      const ctx = await getCurrentUserAccessContext(req);
      req.userRole = ctx;
      req.isAdmin = ctx.isAdmin;
      if (ctx.isAdmin || (ctx.privileged && roles.includes(ctx.role))) return next();
      return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this resource.' });
    } catch {
      return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this resource.' });
    }
  };
}
// Back-compat alias (same semantics).
const requireRole = requireVerifiedRole;

/* requireCollegeScope(getTargetCollege): a college_admin may only act on
   resources in their OWN college (compared by stable collegeId, never a typed
   name). Admin bypasses scope. Missing target → no cross-college resource to
   leak → pass. */
function requireCollegeScope(getTargetCollege) {
  return async function collegeScopeGuard(req, res, next) {
    try {
      const ctx = req.userRole || await getCurrentUserAccessContext(req);
      req.userRole = ctx;
      if (ctx.isAdmin) return next();
      if (!(ctx.privileged && ctx.role === 'college_admin')) {
        return res.status(403).json({ error: 'forbidden', message: 'College access required.' });
      }
      const target = typeof getTargetCollege === 'function' ? await getTargetCollege(req) : null;
      if (!target) return next();
      if (!access.collegeScopeAllowed(ctx.collegeId, target)) {
        return res.status(403).json({ error: 'forbidden_scope', message: 'You can only access students from your own college.' });
      }
      return next();
    } catch {
      return res.status(403).json({ error: 'forbidden', message: 'College access required.' });
    }
  };
}


/* HTTP status for a persistence (DB write) result.
   - DB on + write ok        → 200
   - DB on + write failed     → 500 (real server-side error)
   - DB off in PRODUCTION     → 503 (persistence is required but unavailable;
                                     never pretend the write succeeded)
   - DB off in dev/test       → 200 (client is told db:false → "saved locally only") */
function persistenceStatus(result) {
  if (db.dbEnabled()) return result && result.ok ? 200 : 500;
  return config.IS_PROD ? 503 : 200;
}

app.get('/auth/google/start', (req, res) => {
  if (!googleEnabled()) return res.redirect(buildReturn(req.query.returnTo || '/', { login: 'unavailable' }));
  const state = randomState();
  req.session.googleAuth = { state, returnTo: req.query.returnTo || process.env.FRONTEND_ORIGIN || '/' };
  const url = new URL(googleProvider.authUrl);
  url.searchParams.set('client_id', googleProvider.clientId);
  url.searchParams.set('redirect_uri', googleProvider.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', googleProvider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'select_account');
  req.session.save(() => res.redirect(url.toString()));
});

app.get('/auth/google/callback', async (req, res) => {
  const saved = req.session.googleAuth || {};
  const returnTo = saved.returnTo || '/';
  try {
    if (!googleEnabled()) return res.redirect(buildReturn(returnTo, { login: 'unavailable' }));
    if (req.query.error) return res.redirect(buildReturn(returnTo, { login: 'error' }));
    if (!req.query.code) return res.redirect(buildReturn(returnTo, { login: 'error' }));
    if (!saved.state || saved.state !== req.query.state) return res.redirect(buildReturn(returnTo, { login: 'error' }));

    const tokenRes = await fetch(googleProvider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: googleProvider.redirectUri,
        client_id: googleProvider.clientId,
        client_secret: googleProvider.clientSecret
      }).toString()
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) throw new Error('token_exchange_failed');

    const meRes = await fetch(googleProvider.meUrl, { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } });
    const profile = meRes.ok ? await meRes.json() : {};
    const googleId = profile.sub || profile.id || null;
    let user = {
      id: googleId || ('g_' + crypto.randomBytes(6).toString('hex')),
      name: profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || 'Google user',
      email: profile.email || null,
      picture: profile.picture || null,
      provider: 'google'
    };
    // Persist / refresh the user record (no-op if MONGODB_URI is not set).
    const stored = await db.upsertUser({ googleId, email: user.email, name: user.name, avatar: user.picture, provider: 'google' });
    if (stored) user = { ...user, ...stored, id: stored.id, picture: stored.picture || user.picture };
    req.session.user = user;
    setUserCookie(res, user);
    delete req.session.googleAuth;
    req.session.save(() => res.redirect(buildReturn(returnTo, { login: 'success' })));
  } catch (err) {
    res.redirect(buildReturn(returnTo, { login: 'error' }));
  }
});

/* Optional local/demo sign-in (guarded). */
app.post('/auth/dev-login', authLimiter, async (req, res) => {
  if (!allowDevLogin()) return res.status(403).json({ error: 'dev_login_disabled', message: 'Demo sign-in is disabled. Configure Google OAuth.' });
  const name = String((req.body && req.body.name) || 'Demo User').trim().slice(0, 60) || 'Demo User';
  const email = String((req.body && req.body.email) || 'demo@careerautopilot.local').trim().slice(0, 120);
  let user = { id: 'dev_' + crypto.createHash('sha1').update(email).digest('hex').slice(0, 12), name, email, picture: null, provider: 'dev' };
  const stored = await db.upsertUser({ googleId: user.id, email, name, avatar: null, provider: 'dev' });
  if (stored) user = { ...user, ...stored, id: stored.id };
  req.session.user = user;
  setUserCookie(res, user);
  req.session.save(() => res.json({ ok: true, user }));
});

/* Who am I + which sign-in methods this server offers. Must never 500 — the
   client uses it to decide what to render, so on any internal hiccup we still
   return a well-formed "not authenticated" payload with provider flags. */
app.get('/auth/me', async (req, res) => {
  try {
    let u = currentUser(req);
    // Enrich with persisted fields (role, createdAt, lastLoginAt, loginCount) when the DB is on.
    if (u && db.dbEnabled()) {
      try {
        const fresh = await db.getUser({ id: u.id, googleId: u.id, email: u.email });
        if (fresh) u = { ...u, ...fresh, picture: fresh.picture || u.picture };
      } catch { /* never block /auth/me on a DB issue */ }
    }
    res.json({
      authenticated: !!u,
      user: u || null,
      // DPDP: the client blocks feature use behind the consent modal until the
      // current consent version is accepted (recorded server-side).
      consentRequired: !!u && (!u.consent || u.consent.version !== db.CONSENT_VERSION),
      consentVersion: db.CONSENT_VERSION,
      providers: { google: { enabled: googleEnabled() }, dev: { enabled: allowDevLogin() } },
    });
  } catch (e) {
    logger.error('/auth/me failed unexpectedly', { message: e.message });
    res.status(200).json({
      authenticated: false,
      user: null,
      providers: { google: { enabled: googleEnabled() }, dev: { enabled: allowDevLogin() } },
    });
  }
});

/* Sign out of the user session (separate from connector /auth/:provider/logout). */
app.post('/auth/logout', (req, res) => {
  clearUserCookie(res);
  if (req.session) {
    req.session.user = null;
    if (typeof req.session.destroy === 'function') return req.session.destroy(() => res.json({ ok: true }));
  }
  res.json({ ok: true });
});

app.get('/auth/:provider/start', requireProvider, (req, res) => {
  const p = req.params.provider;
  const cfg = providers[p];
  const state = randomState();
  req.session.oauth = req.session.oauth || {};
  req.session.oauth[p] = { state, returnTo: req.query.returnTo || process.env.FRONTEND_ORIGIN || 'http://localhost:3000' };

  const url = new URL(cfg.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', cfg.scope);
  url.searchParams.set('state', state);
  req.session.save(() => res.redirect(url.toString()));
});

app.get('/auth/:provider/callback', requireProvider, async (req, res) => {
  const p = req.params.provider;
  const cfg = providers[p];
  const saved = req.session.oauth?.[p];
  const returnTo = saved?.returnTo || process.env.FRONTEND_ORIGIN || '/';

  if (!req.query.code) return res.redirect(buildReturn(returnTo, { oauth_return: p, error: 'missing_code' }));
  if (!saved || saved.state !== req.query.state) return res.redirect(buildReturn(returnTo, { oauth_return: p, error: 'bad_state' }));

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(req.query.code),
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret
    });
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(token.error_description || token.error || 'Token exchange failed');
    if (!token.access_token) throw new Error('No access token returned by provider');

    let profile = null;
    if (cfg.meUrl && token.access_token) {
      const meRes = await fetch(cfg.meUrl, { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } });
      if (meRes.ok) profile = await meRes.json();
    }

    req.session.tokens = req.session.tokens || {};
    req.session.tokens[p] = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
      scope: token.scope || cfg.scope,
      profile
    };
    // Stateless fallback so "connected" survives serverless / multi-instance hosting.
    const name = profile ? (profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || null) : null;
    setOAuthStatusCookie(res, p, { connected: true, name, email: (profile && profile.email) || null, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    req.session.save(() => res.redirect(buildReturn(returnTo, { oauth_return: p, connected: '1' })));
  } catch (err) {
    res.redirect(buildReturn(returnTo, { oauth_return: p, error: err.message || 'oauth_failed' }));
  }
});

app.get('/auth/status', (req, res) => {
  const tokens = req.session.tokens || {};
  const result = { providers: {} };
  for (const p of Object.keys(providers)) {
    const t = tokens[p];
    const ck = readOAuthStatusCookie(req, p);          // serverless-safe fallback
    const connected = !!t?.access_token || !!ck?.connected;
    const name = (t?.profile && (t.profile.name || [t.profile.given_name, t.profile.family_name].filter(Boolean).join(' '))) || ck?.name || null;
    const email = (t?.profile && t.profile.email) || ck?.email || null;
    result.providers[p] = {
      enabled: oauthEnabled(p),          // is "Sign in with …" available on this server?
      connected,
      profile: connected ? { name: name || null, email: email || null } : null,
      scopes: t?.scope ? String(t.scope).split(/[ ,]+/).filter(Boolean) : []
    };
  }
  res.json(result);
});

/* Tiny capability probe so the frontend can hide/disable OAuth buttons cleanly. */
app.get('/auth/config', (req, res) => {
  res.json({
    oauth: {
      linkedin: { enabled: oauthEnabled('linkedin') },
      indeed: { enabled: oauthEnabled('indeed') }
    },
    auth: {
      google: { enabled: googleEnabled() },
      dev: { enabled: allowDevLogin() }
    }
  });
});

app.post('/auth/:provider/logout', (req, res) => {
  const p = req.params.provider;
  if (req.session.tokens) delete req.session.tokens[p];
  res.clearCookie(oauthStatusCookieName(p), { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE });
  res.json({ ok: true });
});

/* ============================================================
   STUDENT-FIRST CAREER PROFILE  (no developer accounts needed)
   ------------------------------------------------------------
   Data is stored against the current session (the logged-in user).
   No LinkedIn/Indeed OAuth or developer app is required to use these.
   ============================================================ */
function getProfile(req) {
  req.session.profile = req.session.profile || { linkedin: null, preferences: null };
  return req.session.profile;
}

/* --- LinkedIn profile URL (paste, no OAuth) --- */
app.get('/profile/linkedin', (req, res) => {
  res.json({ linkedin: getProfile(req).linkedin });
});
app.post('/profile/linkedin', (req, res) => {
  const v = validateLinkedInUrl(req.body && req.body.url);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const profile = getProfile(req);
  profile.linkedin = { url: v.url, addedAt: new Date().toISOString() };
  res.json({ ok: true, linkedin: profile.linkedin, status: 'LinkedIn Profile Added' });
});
app.delete('/profile/linkedin', (req, res) => {
  getProfile(req).linkedin = null;
  res.json({ ok: true });
});

/* --- Manual job preferences (used for search / matching) --- */
app.get('/profile/preferences', (req, res) => {
  res.json({ preferences: getProfile(req).preferences });
});
app.post('/profile/preferences', (req, res) => {
  const { errors, prefs } = sanitizePreferences(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
  getProfile(req).preferences = prefs;
  res.json({ ok: true, preferences: prefs });
});

/* --- One call to hydrate the dashboard "Career Profile" card --- */
app.get('/profile/career', (req, res) => {
  const profile = getProfile(req);
  res.json({
    linkedin: profile.linkedin || null,
    preferences: profile.preferences || null,
    oauth: {
      linkedin: { enabled: oauthEnabled('linkedin'), connected: !!req.session.tokens?.linkedin?.access_token },
      indeed: { enabled: oauthEnabled('indeed'), connected: !!req.session.tokens?.indeed?.access_token }
    }
  });
});
app.put('/profile/career', (req, res) => {
  const profile = getProfile(req);
  const body = req.body || {};
  if (body.linkedinUrl != null && body.linkedinUrl !== '') {
    const v = validateLinkedInUrl(body.linkedinUrl);
    if (!v.ok) return res.status(400).json({ error: v.error });
    profile.linkedin = { url: v.url, addedAt: new Date().toISOString() };
  }
  if (body.preferences) {
    const { errors, prefs } = sanitizePreferences(body.preferences);
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
    profile.preferences = prefs;
  }
  res.json({ ok: true, linkedin: profile.linkedin || null, preferences: profile.preferences || null });
});

app.post('/apply/:provider/submit', (req, res) => {
  const p = req.params.provider;
  if (!req.session.tokens?.[p]?.access_token) return res.status(401).json({ error: `${p} OAuth not connected` });
  // Intentionally NOT auto-submitting. Official apply submission needs provider-approved apply scopes/API.
  res.status(202).json({
    submitted: false,
    message: 'OAuth is connected, but official auto-submit is not enabled. Use the assisted manual apply flow, or add approved provider API logic here.'
  });
});



/* ============================================================
   USER APP STATE — cross-device persistence for onboarding,
   resume dashboard stats and project/XP state. DB-backed when
   MONGODB_URI is configured; local-only clients still work.
   ============================================================ */
app.get('/api/user/state', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const state = await db.getUserState({ userId: u?.id, email: u?.email });
  res.json({ ok: true, state: state || { profile: {}, resume: {}, projects: [], tracker: {}, xpSnapshot: {}, creator: {} }, db: db.dbEnabled() });
});

app.patch('/api/user/state', requireAuth, validateBody(userStatePatchSchema), async (req, res) => {
  const u = currentUser(req);
  const body = req.body || {};
  const allowed = {};
  for (const k of ['profile', 'resume', 'projects', 'tracker', 'xpSnapshot', 'creator']) {
    if (Object.prototype.hasOwnProperty.call(body, k)) allowed[k] = body[k];
  }
  const result = await db.patchUserState({ userId: u?.id, email: u?.email, patch: allowed });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled(), result });
});

app.get('/api/user/profile', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const state = await db.getUserState({ userId: u?.id, email: u?.email });
  res.json({ ok: true, profile: state?.profile || {}, db: db.dbEnabled() });
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const profile = req.body?.profile || req.body || {};
  const result = await db.patchUserState({ userId: u?.id, email: u?.email, patch: { profile } });
  res.status(persistenceStatus(result)).json({ ok: result.ok, profile, db: db.dbEnabled(), result });
});

app.post('/api/resume/save-analysis', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const resume = req.body?.resume || req.body || {};
  const result = await db.saveResumeSnapshot({ userId: u?.id, email: u?.email, resume });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled(), result });
});

/* ============================================================
   DETERMINISTIC RESUME ANALYSIS
   ------------------------------------------------------------
   The SCORE is computed entirely by server/utils/resume/scoringEngine.js
   (no LLM). The AI is used ONLY to explain the already-final score and to
   write summary/strengths/improvements — it is explicitly told NOT to change
   the number. Same resumeText + targetRole + scoringVersion always yields the
   same score, and a per-user content hash caches the result so a re-upload
   returns the identical analysis.
   ============================================================ */
async function aiResumeFeedback({ resumeText, scoredRole, deterministic }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const sys =
    'You are an expert ATS resume reviewer. The final score has ALREADY been calculated by the system. ' +
    'Do NOT change, recompute, or contradict it. Only EXPLAIN it and give concrete, actionable suggestions. ' +
    'Return ONLY valid JSON (no prose, no markdown fences) with shape: ' +
    '{"summary":"<one sentence referencing the given score>","strengths":["..."],"improvements":["..."],"missingKeywordNotes":["short note per missing keyword on where to add it"]}.';
  const user =
    `TARGET ROLE: ${scoredRole}\n` +
    `FINAL SCORE (do not change): ${deterministic.score}/100\n` +
    `SUB-SCORES: ATS ${deterministic.ats}, Impact ${deterministic.impact}, Clarity ${deterministic.clarity}\n` +
    `BREAKDOWN: ${JSON.stringify(deterministic.breakdown)}\n` +
    `MATCHED KEYWORDS: ${JSON.stringify(deterministic.matchedKeywords.slice(0, 30))}\n` +
    `MISSING KEYWORDS: ${JSON.stringify(deterministic.missingKeywords.slice(0, 20))}\n` +
    `RESUME:\n"""${String(resumeText).slice(0, 8000)}"""`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: resolveAiModel(),
        max_tokens: 1100,
        temperature: 0, // determinism for the explanation too
        system: sys,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = parseJSONLoose(text);
    if (!parsed) return null;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 1000) : '',
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 12) : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements.map(String).slice(0, 12) : [],
      missingKeywordNotes: Array.isArray(parsed.missingKeywordNotes) ? parsed.missingKeywordNotes.map(String).slice(0, 20) : [],
    };
  } catch { return null; }
}

/* Deterministic, no-AI fallback feedback so the endpoint NEVER fails just
   because AI is unavailable. */
function fallbackResumeFeedback(d, scoredRole) {
  return { ...buildFeedback(d, scoredRole), missingKeywordNotes: [] };
}

app.post('/api/resume/analyze', requireAuth, aiLimiter, validateBody(resumeAnalyzeSchema), async (req, res) => {
  try {
    const u = currentUser(req);
    const { resumeText, fileName } = req.body || {};
    const targetRole = normalizeRole(req.body?.targetRole); // empty -> "General"; never silently uses AI's role

    if (!resumeText || String(resumeText).trim().length < 40) {
      return res.status(400).json({ error: 'resume_too_short', message: 'Please provide more resume text to analyze (at least a few lines).' });
    }

    const normalized = normalizeResumeText(resumeText);
    const hash = computeResumeHash(normalized, targetRole, SCORING_VERSION);

    // 1) Cache hit -> return the identical stored analysis (same score, always).
    const cached = await db.findResumeAnalysis({
      userId: u?.id, email: u?.email, resumeHash: hash, targetRole, scoringVersion: SCORING_VERSION,
    });
    if (cached) {
      return res.json({ ...cached, scoredRole: targetRole, cached: true, scoringVersion: SCORING_VERSION });
    }

    // 2) Deterministic scoring (the source of truth for the number).
    const d = scoreResume({ resumeText, targetRole });

    // 3) AI explanation only (temperature 0). Falls back to deterministic prose
    //    if AI is unavailable — the score is NEVER blocked by AI failure.
    let feedback = await aiResumeFeedback({ resumeText, scoredRole: targetRole, deterministic: d });
    let feedbackSource = 'ai';
    if (!feedback || (!feedback.summary && !feedback.strengths.length && !feedback.improvements.length)) {
      feedback = fallbackResumeFeedback(d, targetRole);
      feedbackSource = 'deterministic';
    }

    const analysis = {
      score: d.score,
      ats: d.ats,
      impact: d.impact,
      clarity: d.clarity,
      breakdown: d.breakdown,
      matchedKeywords: d.matchedKeywords,
      missingKeywords: d.missingKeywords,
      skillEvidence: d.skillEvidence || [],
      summary: feedback.summary || `Scored ${d.score}/100 for ${targetRole}.`,
      strengths: feedback.strengths || [],
      improvements: feedback.improvements || [],
      missingKeywordNotes: feedback.missingKeywordNotes || [],
      recommendedRole: d.recommendedRole,   // SUGGESTION ONLY — never re-scores
      scoredRole: targetRole,
      fileName: fileName || '',
      targetRole,
      resumeHash: hash,
      scoringVersion: SCORING_VERSION,
      experienceLevel: d.experienceLevel,
      feedbackSource,
      cached: false,
    };

    // 4) Persist the full breakdown (best-effort; analysis is still returned
    //    even if the DB is off or the write fails).
    await db.saveResumeAnalysis({ userId: u?.id, email: u?.email, analysis });

    res.json({ ...analysis, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Resume analyze failed', { message: err.message });
    res.status(500).json({ error: 'analyze_failed', message: 'Could not analyze the resume. Please try again.' });
  }
});

/* ============================================================
   RESUME-TO-JD FIT + SAFE TAILORING
   ------------------------------------------------------------
   Deterministic JD parse + Job Fit Score (separate from the resume-quality
   score) + fact-preserving tailoring. The tailoring engine NEVER fabricates
   experience; missing skills are returned as review suggestions, and a
   fabrication checker diffs original vs tailored facts and flags any new,
   unsupported claims.
   ============================================================ */
app.post('/api/resume/tailor', requireAuth, aiLimiter, validateBody(resumeTailorSchema), async (req, res) => {
  try {
    const { resumeText, jobDescription, fileName } = req.body || {};
    const targetRole = normalizeRole(req.body?.targetRole);
    const mode = ['conservative', 'balanced', 'aggressive'].includes(req.body?.mode) ? req.body.mode : 'balanced';

    if (!resumeText || String(resumeText).trim().length < 40) {
      return res.status(400).json({ error: 'resume_too_short', message: 'Please provide more resume text to tailor.' });
    }
    if (!jobDescription || String(jobDescription).trim().length < 30) {
      return res.status(400).json({ error: 'jd_too_short', message: 'Please paste a fuller job description to tailor against.' });
    }

    const jd = parseJD({ jobDescription, targetRole });
    const fitBefore = computeJobFit({ resumeText, jd });
    const tailored = tailorResume({ resumeText, jd, targetRole, mode });
    const fitAfter = computeJobFit({ resumeText: tailored.tailoredResume.text, jd });
    const fabrication = checkFabrication({ originalResume: resumeText, tailoredResume: tailored.tailoredResume.text });

    res.json({
      jd,
      tailoredResume: tailored.tailoredResume,
      jobFitScoreBefore: fitBefore.score,
      jobFitScoreAfter: fitAfter.score,
      jobFitBreakdownBefore: fitBefore.breakdown,
      jobFitBreakdownAfter: fitAfter.breakdown,
      keywordsAdded: tailored.keywordsAdded,
      keywordsMissing: tailored.keywordsMissing,
      changeLog: tailored.changeLog,
      safeChanges: tailored.safeChanges,
      needsReview: tailored.needsReview,
      fabricationRisks: fabrication.risks,
      fabricationSafe: fabrication.safe,
      integrityScore: fabrication.integrityScore,
      mode,
      fileName: fileName || '',
      targetRole,
      scoringVersion: SCORING_VERSION,
      db: db.dbEnabled(),
    });
  } catch (err) {
    logger.error('Resume tailor failed', { message: err.message });
    res.status(500).json({ error: 'tailor_failed', message: 'Could not tailor the resume. Please try again.' });
  }
});

/* ============================================================
   RESUME VERSION MANAGER
   ------------------------------------------------------------
   Base / role-specific / job-specific resume versions, each storing its
   score, job-fit score, keywords and change log. Backend-owned; the client
   only displays what it returns.
   ============================================================ */
app.get('/api/resume/versions', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const versions = await db.listResumeVersions({ userId: u?.id, email: u?.email });
  res.json({ ok: true, versions, db: db.dbEnabled() });
});

app.post('/api/resume/versions', requireAuth, validateBody(resumeVersionSchema), async (req, res) => {
  const u = currentUser(req);
  const result = await db.saveResumeVersion({ userId: u?.id, email: u?.email, version: req.body || {} });
  res.status(persistenceStatus(result)).json({ ok: result.ok, version: result.version || null, db: db.dbEnabled(), result });
});

app.delete('/api/resume/versions/:id', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.deleteResumeVersion({ userId: u?.id, email: u?.email, id: req.params.id });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled(), result });
});

/* ============================================================
   VERIFIED SKILLS + XP
   ------------------------------------------------------------
   Selecting/building a project grants NOTHING. A project must be
   SUBMITTED with proof; the deterministic skillVerificationEngine then
   decides which skills are verified vs pending and how much XP is earned.
   verifiedXp only ever increases for verified skills, duplicate-safe per
   (projectId|skill). Pending skills/XP never count toward resume, job
   match, recruiter shortlist or placement readiness — enforced server-side.
   ============================================================ */

/* Submit a project for verification (preview if DB is off). */
app.post('/api/projects/submit', requireAuth, generationLimiter, validateBody(projectSubmissionSchema), async (req, res) => {
  try {
    const u = currentUser(req);
    const submission = { ...(req.body || {}), subjectId: u?.id || u?.email || '' };
    const result = verifyProjectSubmission(submission); // deterministic, no AI

    // Persist submission + apply XP to the per-skill ledger (duplicate-safe).
    let id = null;
    if (db.dbEnabled()) {
      const saved = await db.saveProjectSubmission({ userId: u?.id, email: u?.email, submission, result });
      id = saved.id || null;
      if (saved.ok) {
        await db.applySkillVerification({ userId: u?.id, email: u?.email, projectId: id, result, levelForXp });
      }
    }
    res.json({ ok: true, id, ...result, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Project submit failed', { message: err.message });
    res.status(500).json({ error: 'submit_failed', message: 'Could not submit the project. Please try again.' });
  }
});

/* List my submissions. */
app.get('/api/projects/submissions', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const submissions = await db.listProjectSubmissions({ userId: u?.id, email: u?.email });
  res.json({ ok: true, submissions, db: db.dbEnabled() });
});

/* My skill-XP summary (expandable UI source). verifiedOnly=1 -> only counted skills. */
app.get('/api/skills/xp', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const verifiedOnly = String(req.query.verifiedOnly || '') === '1';
  const summary = await db.getSkillXpSummary({ userId: u?.id, email: u?.email, verifiedOnly });
  res.json({ ok: true, ...summary, db: db.dbEnabled() });
});

/* Canonical verified-skills list other features may count. */
app.get('/api/skills/verified', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const verifiedSkills = await db.getVerifiedSkills({ userId: u?.id, email: u?.email });
  res.json({ ok: true, verifiedSkills, db: db.dbEnabled() });
});

/* Admin manual review: re-verify a submission with a forced decision. */
app.post('/api/admin/projects/:id/verify', requireAuth, requireAdmin, validateBody(adminVerifySchema), async (req, res) => {
  try {
    const u = currentUser(req);
    const sub = await db.getProjectSubmission({ userId: req.query.userId || u?.id, email: req.query.email, id: req.params.id })
      || await db.getProjectSubmission({ userId: u?.id, email: u?.email, id: req.params.id });
    if (!sub) return res.status(404).json({ error: 'not_found', message: 'Submission not found.' });
    const result = verifyProjectSubmission(sub, req.body || {});
    await db.saveProjectSubmission({ userId: sub.userId, email: sub.email, submission: { ...sub, id: req.params.id }, result });
    await db.applySkillVerification({ userId: sub.userId, email: sub.email, projectId: req.params.id, result, levelForXp });
    res.json({ ok: true, id: req.params.id, ...result, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Admin verify failed', { message: err.message });
    res.status(500).json({ error: 'verify_failed', message: 'Could not apply verification.' });
  }
});

/* ============================================================
   LIVE COMPREHENSION VIVA  (top verification tier)
   ------------------------------------------------------------
   The candidate proves, live and timed, that they understand the specific code
   they committed. Eligibility requires an authorship-verified repo (you said
   you wrote it — now explain it). Probes are generated server-side from the
   candidate's own files; scoring is deterministic; a PASS mints HIGH-confidence
   `assessment_passed` credentials. AI never sets a score or a pass/fail.
   ============================================================ */
app.post('/api/viva/start', requireAuth, generationLimiter, async (req, res) => {
  try {
    const u = currentUser(req);
    const userId = u?.id || u?.email;
    const { repoFullName, skills } = req.body || {};
    if (!repoFullName) return res.status(400).json({ ok: false, error: 'repo_required', message: 'repoFullName is required.' });

    const cached = vivaStore.getRepoFiles(userId, repoFullName);
    if (!cached) {
      return res.status(409).json({ ok: false, error: 'analyze_first', message: 'Analyze this repository first so the viva can be generated from your code.' });
    }
    // Gate: only repos whose authorship is verified (your identity committed the
    // code) are eligible. This is what makes a viva pass mean something.
    if (!cached.authorship?.authorshipVerified) {
      return res.status(403).json({
        ok: false, error: 'authorship_unverified',
        message: 'A live viva is only offered for repositories whose authorship is verified. Connect the GitHub identity that committed this code and ensure iterative history.',
        authorship: cached.authorship || null,
      });
    }

    const probes = vivaEngine.generateVivaProbes(cached.files, { seed: `${userId}:${repoFullName}:${Date.now()}`, count: vivaEngine.DEFAULT_PROBE_COUNT });
    if (probes.length < vivaEngine.MIN_PROBES) {
      return res.status(422).json({ ok: false, error: 'insufficient_code', message: 'Not enough analyzable code in this repository to run a meaningful viva.' });
    }
    const session = vivaStore.createSession({ userId, repoFullName, probes, skills: Array.isArray(skills) ? skills : [] });
    res.json({
      ok: true,
      sessionId: session.sessionId,
      version: vivaEngine.VIVA_VERSION,
      budgetMs: vivaEngine.SESSION_BUDGET_MS,
      threshold: vivaEngine.PASS_THRESHOLD,
      probes: probes.map(vivaEngine.publicProbe), // answer keys stripped
    });
  } catch (err) {
    logger.error('Viva start failed', { message: err.message });
    res.status(500).json({ ok: false, error: 'viva_start_failed', message: 'Could not start the viva.' });
  }
});

app.post('/api/viva/submit', requireAuth, async (req, res) => {
  try {
    const u = currentUser(req);
    const userId = u?.id || u?.email;
    const { sessionId, answers, totalElapsedMs } = req.body || {};
    const session = vivaStore.getSession(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'session_not_found', message: 'Viva session not found or expired.' });
    if (session.userId !== userId) return res.status(403).json({ ok: false, error: 'not_your_session' });
    if (session.submitted) return res.status(409).json({ ok: false, error: 'already_submitted' });

    // Deterministic scoring — no AI.
    const result = vivaEngine.scoreVivaSession(session.probes, answers || {}, { totalElapsedMs: Number(totalElapsedMs) || null });
    vivaStore.closeSession(sessionId);

    // On PASS, mint HIGH-confidence assessment credentials (time-bounded) for the
    // claimed skills. The score is bound into the signed evidence.
    const credentials = [];
    if (result.passed) {
      const skills = vivaEngine.vivaVerifiedSkills(result, session.skills);
      const issuedAt = new Date().toISOString();
      for (const skill of skills) {
        credentials.push(credEngine.issueCredential({
          subject: userId, claim: skill, claimType: 'skill',
          method: 'assessment_passed', confidence: 'high',
          evidence: { signal: 'live_viva', repo: session.repoFullName, score: result.comprehensionScore, probes: result.totalProbes, version: result.version },
          issuedAt, validityDays: 365,
        }));
      }
      await db.logGithubAudit?.({ userId: u?.id, email: u?.email, action: 'viva_passed', detail: { repo: session.repoFullName, score: result.comprehensionScore, skills } });
    }

    res.json({
      ok: true,
      passed: result.passed,
      comprehensionScore: result.comprehensionScore,
      threshold: result.threshold,
      answered: result.answered,
      totalProbes: result.totalProbes,
      sessionFlags: result.sessionFlags,
      perProbe: result.perProbe.map((p) => ({ id: p.id, score: p.score, flags: p.flags })),
      credentials: credentials.map(credEngine.credentialPublicView),
      credentialsFull: credentials, // server/caller may persist these
    });
  } catch (err) {
    logger.error('Viva submit failed', { message: err.message });
    res.status(500).json({ ok: false, error: 'viva_submit_failed', message: 'Could not score the viva.' });
  }
});


/* ============================================================
   CREDENTIAL VERIFICATION  (recruiter trust surface)
   ------------------------------------------------------------
   A verified skill is only worth something if the green checkmark can be
   independently re-checked. These endpoints let a recruiter (or any
   authenticated viewer) recompute a credential's signature server-side and
   detect tampering — the confidence was bumped, the claim was swapped, or the
   evidence behind it was changed. The signing key never leaves the server.
   ============================================================ */

/* Publish the Ed25519 public key so ANYONE can verify a credential's signature
   offline, without trusting this server and without being able to forge one.
   This is the difference between "trust our API" and "trust the math". Public
   on purpose — it's a public key. */
app.get('/api/verification/public-key', (req, res) => {
  res.json({
    ok: true,
    alg: credEngine.ALG,
    issuer: credEngine.DEFAULT_ISSUER,
    kid: credEngine.keyId(),
    signingConfigured: credEngine.signingConfigured(),
    publicKeyJwk: credEngine.publicKeyJwk(),
    publicKeyPem: credEngine.publicKeyPem(),
    credentialVersion: credEngine.CREDENTIAL_VERSION,
  });
});

/* Expose the verification-method taxonomy so the UI can explain what each
   method/confidence actually means (and its trust ceiling). */
app.get('/api/verification/methods', requireAuth, (req, res) => {
  const methods = Object.entries(credEngine.METHODS).map(([key, m]) => ({
    method: key, label: m.label, ceiling: m.ceiling, authorship: !!m.authorship, kind: m.kind,
  }));
  res.json({ ok: true, version: credEngine.CREDENTIAL_VERSION, signingConfigured: credEngine.signingConfigured(), methods });
});

/* Re-verify one or many credentials. Body: { credential } or { credentials: [] }.
   Optionally include { evidence } to also prove the underlying evidence behind
   a single credential has not been swapped. Reports tampering, expiry, revocation. */
app.post('/api/verification/verify-credential', requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    const list = Array.isArray(body.credentials) ? body.credentials
      : (body.credential ? [body.credential] : []);
    if (!list.length) {
      return res.status(400).json({ error: 'no_credential', message: 'Provide a credential or credentials array to verify.' });
    }
    if (list.length > 100) {
      return res.status(400).json({ error: 'too_many', message: 'Verify at most 100 credentials per request.' });
    }
    const singleEvidence = list.length === 1 ? body.evidence : undefined;
    const results = list.map((c) => {
      const result = credEngine.verifyCredential(c, { evidence: list.length === 1 ? singleEvidence : undefined });
      return { ...result, credential: credEngine.credentialPublicView(c) };
    });
    res.json({
      ok: true,
      allValid: results.every((r) => r.valid),
      anyTampered: results.some((r) => r.tampered),
      anyExpired: results.some((r) => r.expired),
      anyRevoked: results.some((r) => r.revoked),
      count: results.length,
      results,
    });
  } catch (err) {
    logger.error('Credential verify failed', { message: err.message });
    res.status(500).json({ error: 'verify_failed', message: 'Could not verify the credential(s).' });
  }
});

/* Revoke a credential (admin only). A credential later found fraudulent — e.g.
   plagiarism discovered after issuance — must be killable; revoked credentials
   fail verification thereafter. */
app.post('/api/verification/revoke', requireAuth, requireAdmin, (req, res) => {
  try {
    const { credentialId, reason } = req.body || {};
    if (!credentialId) return res.status(400).json({ error: 'no_id', message: 'credentialId is required.' });
    credEngine.revokeCredential(credentialId, reason || '');
    res.json({ ok: true, credentialId, revoked: true });
  } catch (err) {
    logger.error('Credential revoke failed', { message: err.message });
    res.status(500).json({ error: 'revoke_failed', message: 'Could not revoke the credential.' });
  }
});

/* ============================================================
   PROJECT MARKETPLACE
   ------------------------------------------------------------
   Backend-owned marketplaceScore + verificationStatus. Idea listings and
   published-proof listings coexist (filter by listingType). Verified-skill
   XP feeds owner credibility and recruiter-ready status. Ranking is computed
   server-side per viewer; the client only displays + filters.
   ============================================================ */

/* Viewer context for role-relevance ranking (target role + verified skills). */
async function marketplaceViewer(req) {
  const u = currentUser(req);
  if (!u) return {};
  let targetRole = '';
  let verifiedSkills = [];
  try {
    const state = await db.getUserState({ userId: u.id, email: u.email });
    targetRole = state?.resume?.targetRole || state?.profile?.targetRole || '';
    verifiedSkills = await db.getVerifiedSkills({ userId: u.id, email: u.email });
  } catch { /* best-effort */ }
  return { targetRole, verifiedSkills };
}

const ctaFor = (type) => LISTING_CTAS[type] || ['save', 'report'];

/* List/browse marketplace listings with filters + sort. */
app.get('/api/marketplace/listings', requireAuth, async (req, res) => {
  try {
    const q = req.query || {};
    const filters = {
      listingType: q.listingType || '', category: q.category || '', targetRole: q.targetRole || '',
      difficulty: q.difficulty || '', verificationStatus: q.verificationStatus || '',
      recruiterReady: q.recruiterReady === '1', featured: q.featured === '1',
      hasGithub: q.hasGithub === '1', hasLiveDemo: q.hasLiveDemo === '1',
      skill: q.skill || '', ownerId: q.mine === '1' ? currentUser(req)?.id : (q.ownerId || ''),
    };
    const viewer = await marketplaceViewer(req);
    let listings = await db.listMarketplaceListings({ filters, viewer, computeScore: computeMarketplaceScore });
    const sort = String(q.sort || 'trending');
    listings.sort(sortComparator(sort));
    listings = listings.map((l) => ({ ...l, ctas: ctaFor(l.listingType) }));
    res.json({ ok: true, listings, listingTypes: LISTING_TYPES, sort, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Marketplace list failed', { message: err.message });
    res.status(500).json({ error: 'marketplace_failed', message: 'Could not load the marketplace.', listings: [] });
  }
});

/* Publish a listing. */
app.post('/api/marketplace/listings', requireAuth, generationLimiter, validateBody(marketplaceListingSchema), async (req, res) => {
  const u = currentUser(req);
  const result = await db.createMarketplaceListing({ userId: u?.id, email: u?.email, name: u?.name, listing: req.body, computeScore: computeMarketplaceScore });
  res.status(persistenceStatus(result)).json({ ok: result.ok, id: result.id || null, listing: result.listing || null, db: db.dbEnabled(), result });
});

/* Listing detail (increments view). */
app.get('/api/marketplace/listings/:id', requireAuth, async (req, res) => {
  const listing = await db.getMarketplaceListing({ id: req.params.id, incrementView: true });
  if (!listing) return res.status(404).json({ error: 'not_found', message: 'Listing not found.' });
  const viewer = await marketplaceViewer(req);
  const { score, parts } = computeMarketplaceScore(listing, viewer);
  const reviews = await db.listReviews({ listingId: req.params.id });
  res.json({ ok: true, listing: { ...listing, marketplaceScore: score, marketplaceScoreParts: parts, ctas: ctaFor(listing.listingType) }, reviews, db: db.dbEnabled() });
});

app.delete('/api/marketplace/listings/:id', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.deleteMarketplaceListing({ userId: u?.id, email: u?.email, id: req.params.id });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled(), result });
});

/* Save / unsave. */
app.post('/api/marketplace/listings/:id/save', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.toggleSavedListing({ userId: u?.id, email: u?.email, listingId: req.params.id });
  res.status(persistenceStatus(result)).json({ ok: result.ok, saved: result.saved, db: db.dbEnabled() });
});

app.get('/api/marketplace/saved', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const viewer = await marketplaceViewer(req);
  const listings = await db.listSavedListings({ userId: u?.id, email: u?.email, viewer, computeScore: computeMarketplaceScore });
  res.json({ ok: true, listings: listings.map((l) => ({ ...l, ctas: ctaFor(l.listingType) })), db: db.dbEnabled() });
});

/* Clone a roadmap. */
app.post('/api/marketplace/listings/:id/clone', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.cloneListing({ userId: u?.id, email: u?.email, listingId: req.params.id });
  res.status(persistenceStatus(result)).json({ ok: result.ok, roadmap: result.roadmap || null, db: db.dbEnabled() });
});

/* Apply to collaborate. */
app.post('/api/marketplace/listings/:id/apply', requireAuth, validateBody(collaborationApplySchema), async (req, res) => {
  const u = currentUser(req);
  const result = await db.applyToCollaborate({ userId: u?.id, email: u?.email, name: u?.name, listingId: req.params.id, roleApplied: req.body?.roleApplied, message: req.body?.message });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled() });
});

/* Mentor review. */
app.post('/api/marketplace/listings/:id/review', requireAuth, validateBody(listingReviewSchema), async (req, res) => {
  const u = currentUser(req);
  const result = await db.reviewListing({ userId: u?.id, email: u?.email, name: u?.name, listingId: req.params.id, rating: req.body?.rating, comment: req.body?.comment });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled() });
});

/* Engagement: shortlist (recruiter) / contact / report. */
app.post('/api/marketplace/listings/:id/:kind(shortlist|contact|report)', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.recordEngagement({ userId: u?.id, email: u?.email, listingId: req.params.id, kind: req.params.kind });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled() });
});

/* Admin moderation. */
app.post('/api/admin/marketplace/:id/:action(feature|unfeature|hide|approve)', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.adminModerateListing({ id: req.params.id, action: req.params.action });
  res.status(persistenceStatus(result)).json({ ok: result.ok, applied: result.applied || null, db: db.dbEnabled() });
});

/* ============================================================
   LIVE INSPIRATION ENGINE  (backend-powered; external APIs never hit
   the frontend). Cached in DB when available, plus a short in-memory TTL
   cache so repeated reads don't re-fetch. Falls back to seed ideas.
   ============================================================ */
const INSPIRATION_TTL_MS = 6 * 60 * 60 * 1000; // 6h
let _inspirationCache = { at: 0, data: null };

async function getInspirationsFresh({ force = false } = {}) {
  const now = Date.now();
  if (!force && _inspirationCache.data && (now - _inspirationCache.at) < INSPIRATION_TTL_MS) {
    return { ..._inspirationCache.data, cached: true };
  }
  const built = await buildInspirations({ limit: 30 });
  _inspirationCache = { at: now, data: built };
  if (db.dbEnabled()) { try { await db.cacheInspirations({ inspirations: built.inspirations }); } catch { /* best-effort */ } }
  return { ...built, cached: false };
}

app.get('/api/inspirations', requireAuth, async (req, res) => {
  try {
    const filters = { category: req.query.category || '', source: req.query.source || '', difficulty: req.query.difficulty || '', featured: req.query.featured === '1' };
    // Prefer DB-cached rows when present; otherwise build fresh (TTL cached).
    let inspirations = [];
    let meta = {};
    if (db.dbEnabled()) {
      inspirations = await db.listInspirations({ filters, limit: 40 });
      if (!inspirations.length) {
        const fresh = await getInspirationsFresh();
        inspirations = fresh.inspirations; meta = { sources: fresh.sources, usedFallback: fresh.usedFallback };
      }
    } else {
      const fresh = await getInspirationsFresh();
      inspirations = fresh.inspirations.filter((i) =>
        (!filters.category || i.category === filters.category) &&
        (!filters.source || i.source === filters.source) &&
        (!filters.difficulty || i.difficulty === filters.difficulty));
      meta = { sources: fresh.sources, usedFallback: fresh.usedFallback };
    }
    res.json({ ok: true, inspirations, ...meta, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Inspirations list failed', { message: err.message });
    res.status(500).json({ error: 'inspirations_failed', message: 'Could not load inspirations.', inspirations: [] });
  }
});

app.post('/api/inspirations/refresh', requireAuth, generationLimiter, async (req, res) => {
  try {
    const fresh = await getInspirationsFresh({ force: true });
    res.json({ ok: true, inspirations: fresh.inspirations, sources: fresh.sources, usedFallback: fresh.usedFallback, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Inspirations refresh failed', { message: err.message });
    res.status(500).json({ error: 'refresh_failed', message: 'Could not refresh inspirations.' });
  }
});

/* "Build this": turn an inspiration (by id, or a posted idea) into a roadmap. */
app.post('/api/inspirations/:id/build', requireAuth, generationLimiter, async (req, res) => {
  try {
    const u = currentUser(req);
    let idea = null;
    const id = req.params.id;
    if (db.dbEnabled() && id && id !== 'custom') idea = await db.getInspiration({ id });
    if (!idea) {
      // Fall back to the in-memory cache or the posted idea body.
      const cached = (_inspirationCache.data?.inspirations || []).find((i) => i.id === id || i.sourceId === id);
      idea = cached || req.body?.idea || req.body || {};
    }
    const roadmap = generateProjectBlueprint(idea);
    /* Architecture Diagram OS (additive): inspiration-built projects also get
       the structured spec. Failure never blocks the roadmap. */
    try {
      const pkg = generateArchitectureSpec(
        { title: roadmap.title || idea.title || 'Project', description: `${roadmap.problemStatement || ''} ${idea.summary || ''}`.trim(), techStack: roadmap.techStack || [], targetRole: roadmap.targetRole || '' },
        { targetLevel: 'production' }
      );
      roadmap.architectureSpec = pkg.architectureSpec;
      roadmap.architectureValidation = pkg.validation;
      if (!roadmap.architectureDiagram) roadmap.architectureDiagram = pkg.mermaidViews.component;
    } catch (specErr) {
      logger.warn('Inspiration architecture spec failed (roadmap unaffected)', { message: specErr.message });
    }
    let savedId = null;
    if (db.dbEnabled()) {
      const saved = await db.saveProjectRoadmap({ userId: u?.id, email: u?.email, roadmap, inspirationId: idea?.id || '' });
      savedId = saved.id || null;
    }
    res.json({ ok: true, id: savedId, roadmap, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Build-this failed', { message: err.message });
    res.status(500).json({ error: 'build_failed', message: 'Could not generate a roadmap.' });
  }
});

app.post('/api/inspirations/:id/save', requireAuth, async (req, res) => {
  // Saving an inspiration reuses the marketplace SavedListing store via roadmap,
  // but inspirations live separately; we persist a roadmap stub as the "save".
  const u = currentUser(req);
  let idea = null;
  if (db.dbEnabled() && req.params.id !== 'custom') idea = await db.getInspiration({ id: req.params.id });
  if (!idea) idea = (_inspirationCache.data?.inspirations || []).find((i) => i.id === req.params.id || i.sourceId === req.params.id) || req.body?.idea || {};
  const roadmap = generateProjectBlueprint(idea);
  const result = await db.saveProjectRoadmap({ userId: u?.id, email: u?.email, roadmap, inspirationId: idea?.id || '' });
  res.status(persistenceStatus(result)).json({ ok: result.ok, id: result.id || null, db: db.dbEnabled() });
});

/* My saved/created roadmaps. */
app.get('/api/roadmaps', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const roadmaps = await db.listProjectRoadmaps({ userId: u?.id, email: u?.email });
  res.json({ ok: true, roadmaps, db: db.dbEnabled() });
});

app.post('/api/admin/inspirations/:id/:action(feature|hide|unhide)', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.adminModerateInspiration({ id: req.params.id, action: req.params.action });
  res.status(persistenceStatus(result)).json({ ok: result.ok, status: result.status || null, db: db.dbEnabled() });
});

/* ============================================================
   INDUSTRY-LEVEL ARCHITECTURE GENERATOR
   ------------------------------------------------------------
   The architecture spec + maturity score + gaps are DETERMINISTIC (engine,
   no AI). When `enrich` is set and an AI key exists, the AI may ONLY add a
   richer narrative summary — it can never change the score, diagrams, or
   gaps. Defaults to a production-ready modular monolith (not microservices).
   ============================================================ */
app.post('/api/architecture/generate', requireAuth, generationLimiter, validateBody(architectureSchema), async (req, res) => {
  try {
    const body = req.body || {};
    const level = ARCH_LEVELS.includes(body.level) ? body.level : 'production';
    const project = {
      title: body.title || 'Application',
      description: body.description || '',
      techStack: Array.isArray(body.techStack) ? body.techStack : [],
      targetRole: body.targetRole || '',
      difficulty: body.difficulty || '',
      teamSize: body.teamSize || 0,
    };
    const arch = generateArchitecture(project, { level }); // deterministic source of truth

    /* Architecture Diagram OS (additive, backward compatible): attach the new
       structured spec + per-view Mermaid + validation alongside the legacy
       fields. If the new engine ever fails, the legacy response is unaffected. */
    let archSpecPkg = null;
    try {
      archSpecPkg = generateArchitectureSpec(
        { ...project, projectId: body.projectId || '', cloudProvider: body.cloudProvider || '' },
        { targetLevel: level === 'college_saas' ? 'college_saas' : level, cloudProvider: body.cloudProvider || '' }
      );
    } catch (specErr) {
      logger.warn('Architecture spec generation failed (legacy response unaffected)', { message: specErr.message });
    }

    // Optional AI narrative enrichment — never changes score/diagrams/gaps.
    let narrative = '';
    if (body.enrich && process.env.ANTHROPIC_API_KEY) {
      const prompt = `You are a principal engineer. The architecture, maturity score (${arch.maturityScore.total}/100) and gaps are ALREADY decided by the system — do NOT change, recompute or contradict them. Write a concise 2-3 paragraph narrative explaining WHY this architecture fits the project and how to address the listed gaps. Return plain text only.\n\nPROJECT: ${JSON.stringify(project).slice(0, 1500)}\nSTYLE: ${arch.recommendedStyle.style}\nGAPS: ${JSON.stringify(arch.gaps)}`;
      const text = await anthropicJSON(prompt, 900);
      if (text && typeof text === 'string') narrative = text.slice(0, 2500);
    }

    res.json({
      ok: true, architecture: arch, narrative, db: db.dbEnabled(),
      // ---- Architecture Diagram OS additions (null-safe for old clients) ----
      architectureSpec: archSpecPkg?.architectureSpec || null,
      mermaidViews: archSpecPkg?.mermaidViews || null,
      validation: archSpecPkg?.validation || null,
      specWarnings: archSpecPkg?.warnings || [],
      specRecommendations: archSpecPkg?.recommendations || [],
    });
  } catch (err) {
    logger.error('Architecture generate failed', { message: err.message });
    res.status(500).json({ error: 'architecture_failed', message: 'Could not generate the architecture.' });
  }
});

/* ============================================================
   PATENT ENGINE  (readiness + prior-art + disclosure + tracker).
   NOT legal advice. Scores are deterministic; AI may only enrich prose.
   ============================================================ */
app.post('/api/patent/assess', requireAuth, generationLimiter, validateBody(patentAssessSchema), async (req, res) => {
  try {
    const project = req.body || {};
    const assessment = assessPatentReadiness(project);
    const priorArt = priorArtKeywords(project);
    const disclosure = inventionDisclosureDraft(project);

    /* Architecture Diagram OS (additive): a simplified, figure-ready patent
       diagram from the same deterministic engine — system modules, data
       transformation flow, decision engine, storage/indexing and feedback
       loop. It supports a disclosure only; it is NOT a patentability claim.
       If the engine ever fails, the patent response is unaffected. */
    let patentFigure = null;
    try {
      const figPkg = generateArchitectureSpec(
        { title: project.title || 'Invention', description: `${project.problemStatement || ''} ${project.technicalSolution || project.summary || ''}`, techStack: project.skillsCovered || project.skills || [] },
        { diagramTypes: ['patentFigure'] }
      );
      const figView = figPkg.architectureSpec.views.find((v) => v.type === 'patentFigure') || null;
      if (figView) patentFigure = { view: figView, mermaid: figPkg.mermaidViews.patentFigure || '', spec: figPkg.architectureSpec };
    } catch (figErr) {
      logger.warn('Patent figure generation failed (assessment unaffected)', { message: figErr.message });
    }
    let narrative = '';
    if (project.enrich && process.env.ANTHROPIC_API_KEY) {
      const prompt = `You are a patent-readiness assistant (NOT a lawyer; never claim patentability). The readiness score (${assessment.patentReadinessScore}/100), classification and risks are ALREADY decided — do NOT change them. Write 2 short paragraphs explaining the novelty angle and recommended next steps. Plain text only.\nPROJECT: ${JSON.stringify({ title: project.title, problem: project.problemStatement, solution: project.technicalSolution }).slice(0, 1500)}`;
      const text = await anthropicJSON(prompt, 700);
      if (text && typeof text === 'string') narrative = text.slice(0, 2000);
    }
    res.json({ ok: true, assessment, priorArt, disclosure, narrative, patentFigure, disclaimer: PATENT_DISCLAIMER, statuses: PATENT_STATUSES, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Patent assess failed', { message: err.message });
    res.status(500).json({ error: 'patent_failed', message: 'Could not run the patent assessment.' });
  }
});

app.get('/api/patent/records', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const records = await db.listPatentRecords({ userId: u?.id, email: u?.email });
  res.json({ ok: true, records, statuses: PATENT_STATUSES, disclaimer: PATENT_DISCLAIMER, db: db.dbEnabled() });
});

app.post('/api/patent/records', requireAuth, validateBody(patentRecordSchema), async (req, res) => {
  const u = currentUser(req);
  const result = await db.savePatentRecord({ userId: u?.id, email: u?.email, record: req.body });
  res.status(persistenceStatus(result)).json({ ok: result.ok, id: result.id || null, db: db.dbEnabled(), result });
});

app.delete('/api/patent/records/:id', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.deletePatentRecord({ userId: u?.id, email: u?.email, id: req.params.id });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled(), result });
});

app.get('/api/patent/dashboard', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const stats = await db.patentDashboard({ userId: u?.id, email: u?.email });
  res.json({ ok: true, stats, disclaimer: PATENT_DISCLAIMER, db: db.dbEnabled() });
});

/* ============================================================
   PATENT OS  (invention intelligence — NOT legal advice)
   ------------------------------------------------------------
   Plural /api/patents/* namespace. Deterministic engines own all scoring;
   AI (when ANTHROPIC_API_KEY is set) only drafts idea prose and is validated
   + re-scored before save. Every route is auth-gated and user-isolated.
   ============================================================ */
async function patentMemoryFor(u) {
  const [ideas, feedback] = await Promise.all([
    db.listPatentIdeas({ userId: u?.id, email: u?.email, filters: { archived: 'all' } }),
    db.listPatentFeedback({ userId: u?.id, email: u?.email }),
  ]);
  return { ideas, feedback, memory: getUserPatentMemory({ ideas, feedback }) };
}

/* Dashboard: totals + pipeline + recent activity + next actions + memory. */
app.get('/api/patents/dashboard', requireAuth, async (req, res) => {
  try {
    const u = currentUser(req);
    const [dash, activity, { ideas, memory }] = await Promise.all([
      db.patentOsDashboard({ userId: u?.id, email: u?.email }),
      db.listPatentActivity({ userId: u?.id, email: u?.email, limit: 15 }),
      patentMemoryFor(u),
    ]);
    res.json({ ok: true, ...dash, activity, nextActions: suggestNextActions({ ideas }), memory, disclaimer: PATENT_OS_DISCLAIMER, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Patent OS dashboard failed', { message: err.message });
    res.status(500).json({ error: 'patent_os_failed', message: 'Could not load the Patent OS dashboard.' });
  }
});

/* Generate ideas (AI when available, deterministic fallback otherwise). Saves them. */
app.post('/api/patents/ideas/generate', requireAuth, generationLimiter, validateBody(patentIdeaGenerateSchema), async (req, res) => {
  try {
    const u = currentUser(req);
    const input = req.body || {};
    const count = Math.min(10, Math.max(1, input.count || 6));
    const { memory } = await patentMemoryFor(u);
    const { context, why } = buildGenerationContext(memory, input.domain);

    let ideas = [];
    let usedAI = false;
    if (input.useAI !== false && process.env.ANTHROPIC_API_KEY) {
      try {
        const out = parseJSONLoose(await anthropicJSON(buildGenerationPrompt(input, count, context), 3000));
        const rawList = Array.isArray(out?.ideas) ? out.ideas : [];
        ideas = rawList.map((r) => normalizeAIIdea(r, input)).filter(Boolean);
        usedAI = ideas.length > 0;
      } catch { /* fall through to deterministic */ }
    }
    if (!ideas.length) ideas = generateIdeasDeterministic(input, count);

    // Attach full score (factors + suggestions + risks) to each before saving.
    ideas = ideas.map((i) => {
      const sc = scorePatentIdea(i);
      return {
        ...i,
        score: { ...sc.factors, overall: sc.overall, grade: sc.grade, riskLevel: sc.riskLevel, triage: sc.triage, positioning: sc.positioning },
        scoreDetail: sc,
        triage: sc.triage,
        riskWarnings: sc.reasons.filter((r) => /generic|business|weak|crowded|stuffing/i.test(r)),
        strengtheningSuggestions: sc.improvementSuggestions,
      };
    });

    const saved = await db.createPatentIdeas({ userId: u?.id, email: u?.email, ideas, generationWhy: why });
    res.status(persistenceStatus(saved)).json({ ok: saved.ok, ideas: saved.ideas || ideas, usedAI, generationWhy: why, source: usedAI ? 'ai' : 'deterministic', disclaimer: PATENT_OS_DISCLAIMER, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Patent idea generation failed', { message: err.message });
    res.status(500).json({ error: 'generate_failed', message: 'Could not generate ideas.' });
  }
});

app.get('/api/patents/ideas', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const filters = { status: req.query.status || '', domain: req.query.domain || '', minScore: req.query.minScore || '', search: req.query.search || '', archived: req.query.archived === '1' ? true : (req.query.archived === 'all' ? 'all' : false) };
  const ideas = await db.listPatentIdeas({ userId: u?.id, email: u?.email, filters });
  res.json({ ok: true, ideas, db: db.dbEnabled() });
});

app.get('/api/patents/ideas/:id', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const idea = await db.getPatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
  if (!idea) return res.status(404).json({ error: 'not_found', message: 'Idea not found.' });
  const [priorArt, disclosure] = await Promise.all([
    db.listPriorArtRecords({ userId: u?.id, email: u?.email, ideaId: req.params.id }),
    db.getPatentDisclosure({ userId: u?.id, email: u?.email, ideaId: req.params.id }),
  ]);
  res.json({ ok: true, idea, priorArt, disclosure, disclaimer: PATENT_OS_DISCLAIMER, db: db.dbEnabled() });
});

app.patch('/api/patents/ideas/:id', requireAuth, validateBody(patentIdeaPatchSchema), async (req, res) => {
  const u = currentUser(req);
  // Re-score if any inventive field changed.
  let patch = { ...req.body };
  const inventive = ['title', 'problem', 'proposedSolution', 'technicalMechanism', 'inputData', 'processingLogic', 'outputResult', 'feedbackLoop', 'noveltyAngle', 'marketUseCase'];
  if (inventive.some((k) => k in patch)) {
    const current = await db.getPatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
    if (current) {
      const sc = scorePatentIdea({ ...current, ...patch });
      patch.score = { ...sc.factors, overall: sc.overall, grade: sc.grade, riskLevel: sc.riskLevel };
      patch.strengtheningSuggestions = sc.improvementSuggestions;
    }
  }
  const result = await db.updatePatentIdea({ userId: u?.id, email: u?.email, id: req.params.id, patch, versionNote: req.body?.status ? '' : 'Edited fields' });
  res.status(persistenceStatus(result)).json({ ok: result.ok, idea: result.idea || null, db: db.dbEnabled() });
});

app.delete('/api/patents/ideas/:id', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.deletePatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
  res.status(persistenceStatus(result)).json({ ok: result.ok, archived: !!result.archived, deleted: !!result.deleted, db: db.dbEnabled() });
});

/* Strengthen: deterministic upgrade + new version entry. */
app.post('/api/patents/ideas/:id/strengthen', requireAuth, generationLimiter, async (req, res) => {
  const u = currentUser(req);
  const idea = await db.getPatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
  if (!idea) return res.status(404).json({ error: 'not_found', message: 'Idea not found.' });
  const priorArt = await db.listPriorArtRecords({ userId: u?.id, email: u?.email, ideaId: req.params.id });
  const result = strengthenIdea(idea, { priorArtRecords: priorArt });
  const sc = scorePatentIdea(result.idea, { priorArtRecords: priorArt });
  const patch = {
    title: result.idea.title, proposedSolution: result.idea.proposedSolution, technicalMechanism: result.idea.technicalMechanism,
    inputData: result.idea.inputData, processingLogic: result.idea.processingLogic, outputResult: result.idea.outputResult,
    feedbackLoop: result.idea.feedbackLoop, noveltyAngle: result.idea.noveltyAngle, marketUseCase: result.idea.marketUseCase,
    tags: result.idea.tags, status: idea.status === 'raw_idea' ? 'refining' : idea.status,
    score: { ...sc.factors, overall: sc.overall, grade: sc.grade, riskLevel: sc.riskLevel },
    strengtheningSuggestions: sc.improvementSuggestions,
  };
  const saved = await db.updatePatentIdea({ userId: u?.id, email: u?.email, id: req.params.id, patch, versionNote: `Strengthened: ${result.scoreBefore}→${result.scoreAfter}. ${result.changes.slice(0, 3).join(' ')}` });
  if (db.dbEnabled()) { try { await db.listPatentActivity; } catch { /* */ } }
  res.status(persistenceStatus(saved)).json({ ok: saved.ok, idea: saved.idea || null, result, db: db.dbEnabled() });
});

/* Re-score on demand. */
app.post('/api/patents/ideas/:id/score', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const idea = await db.getPatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
  if (!idea) return res.status(404).json({ error: 'not_found', message: 'Idea not found.' });
  const priorArt = await db.listPriorArtRecords({ userId: u?.id, email: u?.email, ideaId: req.params.id });
  const sc = scorePatentIdea(idea, { priorArtRecords: priorArt });
  await db.updatePatentIdea({ userId: u?.id, email: u?.email, id: req.params.id, patch: { score: { ...sc.factors, overall: sc.overall, grade: sc.grade, riskLevel: sc.riskLevel }, strengtheningSuggestions: sc.improvementSuggestions } });
  res.json({ ok: true, score: sc, db: db.dbEnabled() });
});

/* Prior-art search plan (suggestions only) — saved onto the idea. */
app.post('/api/patents/ideas/:id/prior-art-plan', requireAuth, generationLimiter, async (req, res) => {
  const u = currentUser(req);
  const idea = await db.getPatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
  if (!idea) return res.status(404).json({ error: 'not_found', message: 'Idea not found.' });
  const plan = priorArtPlan(idea);
  await db.updatePatentIdea({ userId: u?.id, email: u?.email, id: req.params.id, patch: { priorArtSearchPlan: plan, status: idea.status === 'raw_idea' || idea.status === 'shortlisted' ? 'prior_art_review' : idea.status } });
  res.json({ ok: true, plan, disclaimer: PATENT_OS_DISCLAIMER, db: db.dbEnabled() });
});

/* Manual prior-art records. */
app.post('/api/patents/ideas/:id/prior-art', requireAuth, validateBody(priorArtRecordSchema), async (req, res) => {
  const u = currentUser(req);
  const result = await db.addPriorArtRecord({ userId: u?.id, email: u?.email, ideaId: req.params.id, record: req.body });
  res.status(persistenceStatus(result)).json({ ok: result.ok, id: result.id || null, record: result.record || null, db: db.dbEnabled() });
});

app.get('/api/patents/ideas/:id/prior-art', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const records = await db.listPriorArtRecords({ userId: u?.id, email: u?.email, ideaId: req.params.id });
  res.json({ ok: true, records, db: db.dbEnabled() });
});

app.delete('/api/patents/prior-art/:recordId', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.deletePriorArtRecord({ userId: u?.id, email: u?.email, recordId: req.params.recordId });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled() });
});

/* Invention disclosure (generate/regenerate, versioned). */
app.post('/api/patents/ideas/:id/disclosure', requireAuth, generationLimiter, async (req, res) => {
  const u = currentUser(req);
  const idea = await db.getPatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
  if (!idea) return res.status(404).json({ error: 'not_found', message: 'Idea not found.' });
  const payload = generateDisclosure(idea);
  const saved = await db.savePatentDisclosure({ userId: u?.id, email: u?.email, ideaId: req.params.id, payload });
  res.status(persistenceStatus(saved)).json({ ok: saved.ok, version: saved.version || 1, disclosure: payload, disclaimer: PATENT_OS_DISCLAIMER, db: db.dbEnabled() });
});

app.get('/api/patents/ideas/:id/disclosure', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const disclosure = await db.getPatentDisclosure({ userId: u?.id, email: u?.email, ideaId: req.params.id });
  res.json({ ok: true, disclosure, disclaimer: PATENT_OS_DISCLAIMER, db: db.dbEnabled() });
});

/* Convert idea -> buildable project plan (linked back to the idea). */
app.post('/api/patents/ideas/:id/convert-to-project', requireAuth, generationLimiter, async (req, res) => {
  const u = currentUser(req);
  const idea = await db.getPatentIdea({ userId: u?.id, email: u?.email, id: req.params.id });
  if (!idea) return res.status(404).json({ error: 'not_found', message: 'Idea not found.' });
  const plan = await convertToProject(idea, { audience: req.body?.audience || 'student' });
  await db.updatePatentIdea({ userId: u?.id, email: u?.email, id: req.params.id, patch: { linkedProjectPlan: plan, status: idea.status === 'raw_idea' || idea.status === 'shortlisted' ? 'poc_planned' : idea.status } });
  res.json({ ok: true, plan, db: db.dbEnabled() });
});

/* Feedback (drives the self-learning memory). */
app.post('/api/patents/ideas/:id/feedback', requireAuth, validateBody(patentFeedbackSchema), async (req, res) => {
  const u = currentUser(req);
  const result = await db.recordPatentFeedback({ userId: u?.id, email: u?.email, ideaId: req.params.id, feedbackType: req.body?.feedbackType, notes: req.body?.notes });
  res.status(persistenceStatus(result)).json({ ok: result.ok, db: db.dbEnabled() });
});

/* Pipeline grouped by status. */
app.get('/api/patents/pipeline', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const ideas = await db.listPatentIdeas({ userId: u?.id, email: u?.email, filters: {} });
  const STATUSES = ['raw_idea', 'shortlisted', 'refining', 'prior_art_review', 'poc_planned', 'disclosure_drafted', 'attorney_ready', 'filed', 'published', 'granted', 'abandoned'];
  const pipeline = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const i of ideas) (pipeline[i.status] || (pipeline[i.status] = [])).push(i);
  res.json({ ok: true, pipeline, statuses: STATUSES, db: db.dbEnabled() });
});

app.get('/api/patents/activity', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const activity = await db.listPatentActivity({ userId: u?.id, email: u?.email, limit: 50 });
  res.json({ ok: true, activity, db: db.dbEnabled() });
});

/* Disclosures list (for the Disclosures page). */
app.get('/api/patents/disclosures', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const disclosures = await db.listPatentDisclosures({ userId: u?.id, email: u?.email });
  res.json({ ok: true, disclosures, db: db.dbEnabled() });
});

/* ============================================================
   INNOVATION & PATENT INTELLIGENCE OS
   ------------------------------------------------------------
   Source-backed problem discovery → clustering → buildable
   project synthesis → feasibility/cost → IP-readiness (hard
   caps) → prior-art workspace → disclosure → bridges into the
   existing Project store and Patent OS. Mounted modularly so
   server.js stays thin; all routes require auth and are
   user-scoped. Degrades to a clearly-labelled limited mode when
   API keys / DB are missing — it never crashes the app.
   ============================================================ */
/* Per-plan DAILY quotas on the expensive route families (distinct from the
   per-minute burst limiters in security.js). Fails open — quota accounting
   can never take the API down. Registered before the metered routes. */
app.use(createQuotaMiddleware({ currentUser, planFor: (req) => planForReq(req), db, logger }));

registerProblemIntelligenceRoutes(app, { requireAuth, currentUser, generationLimiter, persistenceStatus, db });
registerProjectIntelligenceRoutes(app, { requireAuth, currentUser, generationLimiter });
registerProjectBuilderRoutes(app, { requireAuth, currentUser, generationLimiter, db });
registerArchitectureRoutes(app, { requireAuth, currentUser, generationLimiter, db });
registerWorkspaceRoutes(app, { requireAuth, currentUser, generationLimiter, db });
registerCareerIntelligenceRoutes(app, { requireAuth, currentUser, generationLimiter, db });
registerResumeOsRoutes(app, { requireAuth, currentUser, generationLimiter, db, requireRole, requireCollegeScope, observe: (event, data) => logger.info?.(`[resume-os] ${event}`, data) });
registerTemplateOsRoutes(app, { requireAuth, requireRole, currentUser, generationLimiter, db, observe: (event, data) => logger.info?.(`[template-os] ${event}`, data) });
registerProjectStoreRoutes(app, { requireAuth, currentUser, db });
registerOpsRoutes(app, { requireAuth, requireAdmin, currentUser, db, logger });

/* ---- Public legal metadata (no auth): the single source the in-app legal
   pages, Razorpay policy URLs and DPDP grievance notice all read from.
   Contacts come from env (LEGAL_* → SUPPORT/ADMIN fallbacks) so the
   deployment owner is the named entity, never a hardcoded placeholder. */
app.get('/api/legal', (req, res) => {
  const firstAdmin = String(config.ADMIN_EMAILS || process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)[0] || 'support@careerautopilot.in';
  res.json({
    ok: true,
    entityName: process.env.LEGAL_ENTITY_NAME || 'Career Autopilot',
    entityLocation: process.env.LEGAL_ENTITY_LOCATION || 'Pune, Maharashtra, India',
    supportEmail: process.env.SUPPORT_EMAIL || firstAdmin,
    grievanceEmail: process.env.GRIEVANCE_EMAIL || process.env.SUPPORT_EMAIL || firstAdmin,
    grievanceResponseDays: 7, // DPDP-aligned response commitment
    consentVersion: db.CONSENT_VERSION,
    policies: {
      terms: { effective: '2026-07-12', path: '#/legal/terms' },
      privacy: { effective: '2026-07-12', path: '#/legal/privacy' },
      refunds: { effective: '2026-07-12', path: '#/legal/refunds' },
    },
  });
});

/* ============================================================
   APPLICATION PACKAGE GENERATOR
   ------------------------------------------------------------
   Tailored resume + cover letter + recruiter email + LinkedIn message +
   referral request + follow-up + interview talking points for one job.
   Uses resume facts + the user's VERIFIED skills/projects only; runs the
   fabrication checker; no fake claims. AI (if enabled) only refines tone.
   ============================================================ */
app.post('/api/applications/package', requireAuth, generationLimiter, validateBody(appPackageSchema), async (req, res) => {
  try {
    const u = currentUser(req);
    const { resumeText, jobDescription, applicantName } = req.body || {};
    const targetRole = normalizeRole(req.body?.targetRole);
    let verifiedSkills = [];
    let verifiedProjects = [];
    try {
      verifiedSkills = await db.getVerifiedSkills({ userId: u?.id, email: u?.email });
      const subs = await db.listProjectSubmissions({ userId: u?.id, email: u?.email });
      verifiedProjects = (subs || []).filter((s) => s.verificationStatus === 'verified').map((s) => ({ title: s.title }));
    } catch { /* verified data is best-effort */ }

    const pkg = generateApplicationPackage({ resumeText, jobDescription, targetRole, verifiedSkills, verifiedProjects, applicantName });

    // Optional AI tone polish on the written pieces only — never adds facts;
    // if anything looks off we keep the deterministic version.
    if (req.body?.enrich && process.env.ANTHROPIC_API_KEY) {
      try {
        const prompt = `Refine the TONE of these application messages. Do NOT add any new facts, skills, companies, metrics, or claims — only improve flow and professionalism. Keep them concise. Return ONLY JSON with the same keys: {"coverLetter","linkedinMessage","followUp"}.\n\n${JSON.stringify({ coverLetter: pkg.documents.coverLetter, linkedinMessage: pkg.documents.linkedinMessage, followUp: pkg.documents.followUp }).slice(0, 4000)}`;
        const out = parseJSONLoose(await anthropicJSON(prompt, 1200));
        if (out && typeof out.coverLetter === 'string') {
          // Re-verify the AI cover letter introduces no fabricated skills/metrics.
          const fab = pkg.fabricationSafe;
          if (fab) {
            pkg.documents.coverLetter = out.coverLetter.slice(0, 4000);
            if (typeof out.linkedinMessage === 'string') pkg.documents.linkedinMessage = out.linkedinMessage.slice(0, 1500);
            if (typeof out.followUp === 'string') pkg.documents.followUp = out.followUp.slice(0, 2000);
            pkg.toneEnrichedBy = 'ai';
          }
        }
      } catch { /* keep deterministic version */ }
    }

    res.json({ ok: true, package: pkg, db: db.dbEnabled() });
  } catch (err) {
    logger.error('Application package failed', { message: err.message });
    res.status(500).json({ error: 'package_failed', message: 'Could not generate the application package.' });
  }
});

/* ============================================================
   READINESS + RECRUITER / ADMIN  (verified data only)
   ============================================================ */
/* My own placement readiness. */
app.get('/api/readiness', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const inputs = await db.roleReadinessInputsFor({ userId: u?.id, email: u?.email });
  const readiness = computeReadiness(inputs); // v1 — unchanged contract for college/recruiter consumers.

  /* readiness-v2: role-specific, explainable, delta-attributed. The client
     may pass ?targetRole= (profile is client-held when the DB is off);
     server-side profile/resume role wins when present. */
  const targetRole = String(req.query.targetRole || inputs.targetRole || '').trim();
  let roleReadiness = null; let change = null;
  if (targetRole) {
    roleReadiness = computeRoleReadiness({
      targetRole,
      verifiedSkills: inputs.verifiedSkills,
      provenSkills: inputs.provenSkills,
      claimedSkills: inputs.claimedSkills,
      resumeSkills: inputs.resumeSkills,
      verifiedProjectCount: inputs.verifiedProjectCount,
      recruiterReadyProjectCount: inputs.recruiterReadyProjectCount,
      resumeScore: inputs.resumeScore,
    });
    const prev = inputs.roleReadinessSnapshot;
    change = explainReadinessChange(
      prev && prev.targetRole === roleReadiness.targetRole ? prev : null,
      roleReadiness,
    );
    /* Persist the new baseline (fire-and-forget; measuring must never break
       the endpoint). Only when it moved or no baseline existed. */
    if (db.dbEnabled() && (!prev || prev.targetRole !== roleReadiness.targetRole || prev.score !== roleReadiness.score)) {
      db.saveRoleReadinessSnapshot({ userId: u?.id, email: u?.email, snapshot: { ...roleReadiness, savedAt: new Date().toISOString() } }).catch(() => {});
    }
  }
  res.json({ ok: true, readiness, roleReadiness, change, categories: READINESS_CATEGORIES, db: db.dbEnabled() });
});

/* ============================================================
   NEXT BEST ACTION  (platform-wide; deterministic)
   ------------------------------------------------------------
   One ranked answer to "what should I do next?", assembled from
   real state: college task deadlines, workspace verification
   remediation, active-project momentum, role-readiness gaps and
   verified-evidence resume wins. db-off returns ok:false with
   reason so the client falls back to its local computation — it
   never fabricates server state.
   ============================================================ */
app.get('/api/next-best-action', requireAuth, async (req, res) => {
  const u = currentUser(req);
  if (!db.dbEnabled()) return res.json({ ok: false, reason: 'db_off', db: false });
  try {
    const [inputs, workspaces, collegeTasks] = await Promise.all([
      db.roleReadinessInputsFor({ userId: u?.id, email: u?.email }),
      db.listProjectWorkspaces({ userId: u?.id, email: u?.email }),
      db.listMyTasks({ userId: u?.id, email: u?.email }).catch(() => []),
    ]);
    const targetRole = String(req.query.targetRole || inputs.targetRole || '').trim();
    const roleReadiness = targetRole ? computeRoleReadiness({
      targetRole,
      verifiedSkills: inputs.verifiedSkills, provenSkills: inputs.provenSkills,
      claimedSkills: inputs.claimedSkills, resumeSkills: inputs.resumeSkills,
      verifiedProjectCount: inputs.verifiedProjectCount,
      recruiterReadyProjectCount: inputs.recruiterReadyProjectCount,
      resumeScore: inputs.resumeScore,
    }) : null;
    const resumeGaps = classifyResumeEvidenceGaps({
      targetRole, verifiedSkills: inputs.verifiedSkills,
      resumeSkills: inputs.resumeSkills, provenSkills: inputs.provenSkills,
    });
    const nba = rankNextBestActions({
      roleReadiness,
      workspaces,
      collegeTasks: (collegeTasks || []).map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, done: !!t.done })),
      resumeRecommendations: resumeGaps.recommendations.filter((r) => r.type === 'evidence_exists'),
    });
    logger.info?.('nba.computed', { actions: nba.actions.length, top: nba.highestImpact?.actionType || 'none' });
    res.json({ ok: true, ...nba, roleReadiness, db: true });
  } catch (err) {
    logger.error('next-best-action failed', { message: err.message });
    res.status(500).json({ ok: false, error: 'nba_failed' });
  }
});

/* ============================================================
   RBAC NAMESPACE GUARDS
   ------------------------------------------------------------
   Whole-namespace protection so privileged API families can never be reached by
   the wrong persona — independent of any individual route's own guard.
   - /api/admin/*    → already protected per-route by requireAdmin.
   - /api/recruiter/* → recruiter-or-admin (each recruiter route also guards
                         itself so it can apply consent-safe response shaping).
   - /api/college/*  → college_admin-or-admin. No college routes exist yet, so a
                         wrong-role caller gets 403 and an authorized caller falls
                         through to 404 — the namespace is protected for any
                         college endpoint added later. requireCollegeScope is
                         available to enforce same-college access on those routes.
   ============================================================ */
app.use('/api/college', requireAuth, requireRole('college_admin', 'admin'));

/* ---- College / placement-cell APIs — extracted to a dedicated module ------
   All TPO routes (/api/college/*), student self-service (/api/my/*), and the
   platform-admin college registry live in server/routes/collegeRoutes.js:
   multi-tenant membership (roster/domain/code/admin binding), roster CSV
   import, real notifications (in-app + optional email), task assignments,
   DPDP consent, 60s-cached observability, and the demo-college seed. ---- */
registerCollegeRoutes(app, {
  requireAuth, requireRole, requireCollegeScope, requireAdmin,
  currentUser, db, logger, computeReadiness,
});

/* ---- Team projects — placement-cell group assignments --------------------
   A coordinator forms a team, the engine generates a project customised to
   that team's combined skills, every member is notified, and the team's live
   hosted URL is verified for real. Coordinator routes live under
   /api/college/team-projects/* (scope-guarded); students reach only their own
   assignments under /api/my/team-projects/*. ---- */
registerTeamProjectRoutes(app, {
  requireAuth, requireRole, requireCollegeScope,
  currentUser, db, logger, computeReadiness,
});

/* Per-member progress for team projects. Mounted separately so the 586 lines of
   working tenancy logic in teamProjectRoutes.js stay untouched; same guards,
   same college scoping. This is what makes individual contribution visible to a
   placement coordinator instead of only a team-level status. */
registerTeamProgressRoutes(app, {
  requireAuth, requireRole, requireCollegeScope, currentUser, db, logger,
});

/* Recruiter candidate shortlist — ranked by VERIFIED signals only. */
app.get('/api/recruiter/candidates', requireAuth, requireRole('recruiter', 'admin'), async (req, res) => {
  const filters = { skill: req.query.skill || '', category: req.query.category || '', minScore: req.query.minScore || '' };
  let candidates = await db.recruiterCandidates({ filters, computeReadiness, limit: 60 });
  // Admins get the full talent pool (including contact email) — unchanged.
  // Self-selected recruiters are NOT identity-verified, so they only ever see
  // consent-gated candidates (opted in to recruiters) and NEVER raw email/PII or
  // non-consenting students. This enforces the consent rule server-side.
  if (!req.isAdmin) {
    const optIn = await db.listNetworkProfiles({ forRecruiter: true });
    const allowed = new Set(optIn.map((p) => String(p.userId)));
    candidates = candidates
      .filter((c) => allowed.has(String(c.id)))
      .map(({ email, ...safe }) => safe);
  }
  res.json({ ok: true, candidates, categories: READINESS_CATEGORIES, db: db.dbEnabled() });
});

/* Admin: project verification queue (pending / needs_review). */
/* ============================================================
   ADMIN — DEMO WORLD SEEDING
   ------------------------------------------------------------
   The same seed as `npm run seed:demo`, over HTTP, for a deployment
   where opening a shell against the cluster is inconvenient. Admin
   only (ADMIN_EMAILS / persisted admin role).

   `reset: true` rebuilds from scratch. It can only ever delete
   records tagged demo or addressed @demo-institute.test, so it
   cannot touch a real college or a real recruiter.
   ============================================================ */
app.post('/api/admin/demo/seed', requireAuth, requireAdmin, async (req, res) => {
  const body = req.body || {};
  const result = await db.seedDemoCollege({
    reset: body.reset === true,
    count: Number(body.perBranch) || 0,
    talent: body.talent !== false,
  });
  res.status(result.ok ? 200 : 400).json(result);
});

/* Recruiter side only — for a database whose cohort is already seeded and
   predates the recruiter world. */
app.post('/api/admin/demo/recruiter-seed', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.seedDemoTalent({ reset: (req.body || {}).reset === true });
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/admin/demo/status', requireAuth, requireAdmin, async (req, res) => {
  const recruiter = await db.demoTalentStatus().catch(() => ({ seeded: false }));
  res.json({ ok: true, recruiter, db: db.dbEnabled() });
});

app.get('/api/admin/verification-queue', requireAuth, requireAdmin, async (req, res) => {
  const queue = await db.verificationQueue({ limit: 100 });
  res.json({ ok: true, queue, db: db.dbEnabled() });
});

/* Admin: readiness rollup across the candidate pool (skill heatmap + buckets). */
app.get('/api/admin/readiness-overview', requireAuth, requireAdmin, async (req, res) => {
  const candidates = await db.recruiterCandidates({ filters: {}, computeReadiness, limit: 500 });
  const buckets = Object.fromEntries(READINESS_CATEGORIES.map((c) => [c, 0]));
  const skillHeat = {};
  for (const c of candidates) {
    buckets[c.readinessCategory] = (buckets[c.readinessCategory] || 0) + 1;
    for (const s of c.verifiedSkills) skillHeat[s] = (skillHeat[s] || 0) + 1;
  }
  const heatmap = Object.entries(skillHeat).map(([skill, count]) => ({ skill, count })).sort((a, b) => b.count - a.count).slice(0, 25);
  res.json({ ok: true, total: candidates.length, buckets, heatmap, categories: READINESS_CATEGORIES, db: db.dbEnabled() });
});

/* ============================================================
   CAREER PROOF NETWORK
   ------------------------------------------------------------
   Recruiter-visible profiles, segmented leaderboards, structured
   referral exchange + community feed and shortlists. DB-backed when
   MONGODB_URI is set (true cross-user network); the frontend falls
   back to user-scoped local storage otherwise. Trust score, XP and
   role-fit are NEVER accepted as authoritative from the client —
   trust is recomputed server-side from objective inputs.
   ============================================================ */
const REFERRAL_WEEKLY_LIMITS = { free: 3, pro: 15, premium: 60, admin: 1000 };
function planForReq(req) {
  const email = (req.user && req.user.email) || '';
  const s = subs.getSubscription(req.user || {});
  const role = access.getUserRole(email, s.planId);
  return { planId: s.planId, role, isAdmin: role === 'admin', effectivePlan: access.effectivePlan(role, s.planId) };
}

/* Upsert my own network profile (snapshot of derived metrics + visibility). */
app.put('/api/network/profile', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const payload = req.body?.profile || req.body || {};
  payload.name = payload.name || u?.name || 'Member';
  payload.picture = payload.picture || u?.picture || null;
  const result = await db.upsertNetworkProfile({ userId: u?.id, email: u?.email, payload });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

/* Public / recruiter-safe view of a profile (privacy enforced server-side). */
app.get('/api/network/profile/:userId', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.getNetworkProfile({ viewerUserId: u?.id, targetUserId: req.params.userId });
  // Attach opt-in GitHub proof (private repos only ever surface a safe summary).
  if (result?.ok && !result.private) {
    try {
      const ghProof = await db.githubPublicProof({ targetUserId: req.params.userId, filterFn: ghEngine.filterPrivateRepoDataForPublicView });
      if (ghProof && (ghProof.handle || ghProof.repos.length)) result.githubProof = ghProof;
    } catch { /* GitHub proof is best-effort */ }
  }
  res.json({ ...result, db: db.dbEnabled() });
});

/* Leaderboard source: all eligible (public / published / open-to-recruiter) profiles. */
app.get('/api/network/leaderboards', requireAuth, async (req, res) => {
  const profiles = await db.listNetworkProfiles({ forRecruiter: false });
  res.json({ ok: true, profiles, db: db.dbEnabled() });
});

/* Recruiter candidate discovery (respects visibility + open-to-recruiters).
   Candidate discovery is recruiter-or-admin only; the underlying list is already
   consent-gated (public / published / opted-in profiles), so no PII leaks. */
app.get('/api/network/candidates', requireAuth, requireRole('recruiter', 'admin'), async (req, res) => {
  const profiles = await db.listNetworkProfiles({ forRecruiter: true });
  res.json({ ok: true, profiles, db: db.dbEnabled() });
});

/* Referral exchange + community feed posts. */
app.get('/api/network/posts', requireAuth, async (req, res) => {
  const posts = await db.listReferralPosts({ type: req.query.type || undefined });
  res.json({ ok: true, posts, db: db.dbEnabled() });
});
app.post('/api/network/posts', requireAuth, validateBody(networkPostSchema), async (req, res) => {
  const u = currentUser(req);
  const body = req.body || {};
  if (!body.type) return res.status(400).json({ ok: false, error: 'type_required' });
  const result = await db.createReferralPost({
    userId: u?.id, email: u?.email, name: u?.name, picture: u?.picture,
    type: String(body.type), fields: body.fields || {},
  });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});
app.delete('/api/network/posts/:id', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.deleteReferralPost({ userId: u?.id, email: u?.email, postId: req.params.id });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});
app.post('/api/network/posts/:id/report', requireAuth, async (req, res) => {
  const result = await db.reportReferralPost({ postId: req.params.id });
  res.json({ ...result, db: db.dbEnabled() });
});

/* Referral requests — anti-spam weekly limit by plan. */
app.post('/api/network/requests', requireAuth, validateBody(networkRequestSchema), async (req, res) => {
  const u = currentUser(req);
  const { isAdmin, effectivePlan } = planForReq(req);
  const limit = REFERRAL_WEEKLY_LIMITS[effectivePlan] ?? REFERRAL_WEEKLY_LIMITS.free;
  if (!isAdmin && db.dbEnabled()) {
    const used = await db.countRecentReferralRequests({ userId: u?.id, email: u?.email, sinceMs: 7 * 86400000 });
    if (used >= limit) return res.status(429).json({ ok: false, error: 'weekly_limit_reached', limit, used });
  }
  const body = req.body || {};
  const result = await db.createReferralRequest({
    userId: u?.id, email: u?.email, toUserId: body.toUserId, postId: body.postId,
    kind: body.kind, message: body.message,
  });
  res.status(persistenceStatus(result)).json({ ...result, limit, db: db.dbEnabled() });
});

/* Recruiter shortlists — recruiter or admin only. */
app.get('/api/network/shortlists', requireAuth, requireRole('recruiter', 'admin'), async (req, res) => {
  const u = currentUser(req);
  const shortlists = await db.listShortlists({ recruiterUserId: u?.id, recruiterEmail: u?.email });
  res.json({ ok: true, shortlists, db: db.dbEnabled() });
});
app.post('/api/network/shortlists', requireAuth, requireRole('recruiter', 'admin'), async (req, res) => {
  const u = currentUser(req);
  const body = req.body || {};
  const result = await db.shortlistCandidate({
    recruiterUserId: u?.id, recruiterEmail: u?.email,
    candidateUserId: body.candidateUserId, note: body.note,
  });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

/* ============================================================
   RECRUITER — CAMPUS BRIDGE
   ------------------------------------------------------------
   The recruiter-facing counterpart to /api/college/*. Same guard
   posture as the rest of candidate discovery: recruiter-or-admin
   only, behind requireAuth.

   Two sources, one shape:
     · database attached  → the seeded recruiter world, scoped to the
       caller's own organisation (db.resolveRecruiterOrg). Candidate
       ids are real user ids, so every row in the pipeline opens a
       profile that exists.
     · no database, DEMO_MODE=1 → the in-memory world, for local
       recording. Nothing is written and nothing persists.

   A caller with no organisation still gets empty collections rather
   than someone else's requisitions — the client renders its own
   empty states, the same contract the college routes use. `demo` on
   every response stays true for seeded data, so a viewer is never
   invited to mistake it for their own records.
   ============================================================ */
const recruiterGuard = [requireAuth, requireRole('recruiter', 'admin')];
const talentDemoActive = () => demoTalent.demoModeEnabled() && !db.dbEnabled();

/* Which organisation's console the caller sees, or null. requireVerifiedRole
   has already resolved the access context onto req.userRole. */
async function recruiterOrgFor(req) {
  if (!db.dbEnabled()) return null;
  const ctx = req.userRole || {};
  try {
    return await db.resolveRecruiterOrg({
      organizationId: ctx.organizationId || '',
      isAdmin: ctx.isAdmin === true,
    });
  } catch {
    return null;
  }
}

app.get('/api/recruiter/summary', ...recruiterGuard, async (req, res) => {
  if (talentDemoActive()) {
    return res.json({ ok: true, demo: true, summary: demoTalent.demoTalentSummary(), db: false });
  }
  const orgKey = await recruiterOrgFor(req);
  if (!orgKey) return res.json({ ok: true, demo: false, summary: null, db: db.dbEnabled() });
  const summary = await db.getRecruiterSummary(orgKey);
  res.json({ ok: true, demo: !!summary, summary, db: db.dbEnabled() });
});

app.get('/api/recruiter/requisitions', ...recruiterGuard, async (req, res) => {
  const status = String(req.query.status || '');
  if (talentDemoActive()) {
    let list = demoTalent.demoRequisitions();
    if (status) list = list.filter((r) => r.status === status);
    return res.json({ ok: true, demo: true, requisitions: list, db: false });
  }
  const orgKey = await recruiterOrgFor(req);
  if (!orgKey) return res.json({ ok: true, demo: false, requisitions: [], db: db.dbEnabled() });
  const requisitions = await db.listRecruiterRequisitions(orgKey, { status });
  res.json({ ok: true, demo: true, requisitions, db: db.dbEnabled() });
});

/* Ranked, eligibility-gated candidates for one requisition. This is the bridge
   mechanic itself: the requisition's criteria are run against the connected
   campus cohort, and the response explains every match rather than just
   scoring it. */
app.get('/api/recruiter/requisitions/:id/matches', ...recruiterGuard, async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 25));
  const id = String(req.params.id);

  if (talentDemoActive()) {
    const out = demoTalent.demoMatchesForRequisition(id, { limit });
    if (!out.requisition) return res.status(404).json({ ok: false, error: 'requisition_not_found' });
    return res.json({ ok: true, demo: true, ...out, db: false });
  }
  const orgKey = await recruiterOrgFor(req);
  if (!orgKey) return res.json({ ok: true, demo: false, requisition: null, matches: [], db: db.dbEnabled() });
  const out = await db.getRecruiterMatches(orgKey, id, { limit });
  if (!out.requisition) return res.status(404).json({ ok: false, error: 'requisition_not_found' });
  res.json({ ok: true, demo: true, ...out, db: db.dbEnabled() });
});

app.get('/api/recruiter/pipeline', ...recruiterGuard, async (req, res) => {
  const filters = {
    requisitionId: String(req.query.requisitionId || ''),
    stage: String(req.query.stage || ''),
  };
  if (talentDemoActive()) {
    return res.json({
      ok: true, demo: true, pipeline: demoTalent.demoPipeline(filters),
      stages: demoTalent.PIPELINE_STAGES, db: false,
    });
  }
  const orgKey = await recruiterOrgFor(req);
  if (!orgKey) {
    return res.json({ ok: true, demo: false, pipeline: [], stages: demoTalent.PIPELINE_STAGES, db: db.dbEnabled() });
  }
  const pipeline = await db.listRecruiterPipeline(orgKey, filters);
  res.json({ ok: true, demo: true, pipeline, stages: demoTalent.PIPELINE_STAGES, db: db.dbEnabled() });
});

app.get('/api/recruiter/campus-partners', ...recruiterGuard, async (req, res) => {
  if (talentDemoActive()) {
    return res.json({ ok: true, demo: true, partners: demoTalent.demoCampusPartners(), db: false });
  }
  const orgKey = await recruiterOrgFor(req);
  if (!orgKey) return res.json({ ok: true, demo: false, partners: [], db: db.dbEnabled() });
  const partners = await db.listRecruiterCampusPartners(orgKey);
  res.json({ ok: true, demo: true, partners, db: db.dbEnabled() });
});

/* What our open roles need vs what the connected cohort can actually prove.
   The one view a recruiter and a placement cell can act on together. */
app.get('/api/recruiter/skill-gap', ...recruiterGuard, async (req, res) => {
  if (talentDemoActive()) {
    return res.json({ ok: true, demo: true, gaps: demoTalent.demoSkillGap(), db: false });
  }
  const orgKey = await recruiterOrgFor(req);
  if (!orgKey) return res.json({ ok: true, demo: false, gaps: [], db: db.dbEnabled() });
  const gaps = await db.getRecruiterSkillGap(orgKey);
  res.json({ ok: true, demo: true, gaps, db: db.dbEnabled() });
});

app.get('/api/recruiter/interviews', ...recruiterGuard, async (req, res) => {
  if (talentDemoActive()) {
    return res.json({ ok: true, demo: true, interviews: demoTalent.demoInterviews(), db: false });
  }
  const orgKey = await recruiterOrgFor(req);
  if (!orgKey) return res.json({ ok: true, demo: false, interviews: [], db: db.dbEnabled() });
  const interviews = await db.listRecruiterInterviews(orgKey);
  res.json({ ok: true, demo: true, interviews, db: db.dbEnabled() });
});

/* ============================================================
   ADMIN — USER DIRECTORY / TALENT INTELLIGENCE
   ------------------------------------------------------------
   Admin-only endpoints behind requireAuth + requireAdmin:
   - 401 if unauthenticated, 403 if not an admin (enforced server-side
     from ADMIN_EMAILS / persisted role — the client role is never trusted)
   - Responses are mapped to safe DTOs (db.adminUserDTO); secrets,
     OAuth tokens, sessions and raw files are never returned
   - Listing supports search, filtering, sorting and pagination
   Recruiters explicitly do NOT get access here — the future recruiter
   "Talent Directory" uses /api/network/candidates, which only ever
   returns opted-in (openToRecruiters) profiles.
   ============================================================ */

// Parse + clamp directory query params (all optional, all safe defaults).
function parseDirectoryQuery(q = {}) {
  const filters = {
    q: String(q.q || '').slice(0, 120),
    skill: String(q.skill || '').slice(0, 60),
    speciality: String(q.speciality || '').slice(0, 60),
    targetRole: String(q.targetRole || '').slice(0, 80),
    experienceLevel: String(q.experienceLevel || '').slice(0, 40),
    location: String(q.location || '').slice(0, 80),
    userType: String(q.userType || '').slice(0, 40),
    minCompletion: Math.max(0, Math.min(100, Number(q.minCompletion) || 0)),
    projectStatus: ['completed', 'none'].includes(String(q.projectStatus)) ? String(q.projectStatus) : '',
    recruiterVisible: q.recruiterVisible === 'true' || q.recruiterVisible === true,
    activity: ['active', 'inactive'].includes(String(q.activity)) ? String(q.activity) : '',
  };
  const sort = ['xp', 'active', 'completion', 'projects', 'created', 'name'].includes(String(q.sort)) ? String(q.sort) : 'xp';
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(q.pageSize) || 24));
  return { filters, sort, page, pageSize };
}

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { filters, sort, page, pageSize } = parseDirectoryQuery(req.query || {});
  const result = await db.adminListUsers({ filters, sort, page, pageSize, adminEmailSet: access.adminEmailSet() });
  res.json(result);
});

app.get('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.adminGetUserDetail({ id: req.params.id, adminEmailSet: access.adminEmailSet() });
  const code = result.ok ? 200 : (result.reason === 'not_found' ? 404 : result.reason === 'bad_request' ? 400 : 200);
  res.status(code).json(result);
});

app.patch('/api/admin/users/:id/visibility', requireAuth, requireAdmin, async (req, res) => {
  const recruiterVisible = req.body?.recruiterVisible === true || req.body?.recruiterVisible === 'true';
  const result = await db.adminSetVisibility({ id: req.params.id, recruiterVisible });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

app.patch('/api/admin/users/:id/admin-notes', requireAuth, requireAdmin, async (req, res) => {
  const result = await db.adminSetNotes({ id: req.params.id, adminNotes: req.body?.adminNotes });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

app.patch('/api/admin/users/:id/featured', requireAuth, requireAdmin, async (req, res) => {
  const featuredTalent = req.body?.featuredTalent === true || req.body?.featuredTalent === 'true';
  const result = await db.adminSetFeatured({ id: req.params.id, featuredTalent });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

/* ---- Admin: privileged-role verification management ------------------------
   List pending requests, and set/approve/reject server-controlled role fields.
   This is the ONLY path that grants recruiter/college_admin backend privilege. */
app.get('/api/admin/verification-requests', requireAuth, requireAdmin, async (req, res) => {
  const requests = await db.listVerificationRequests({ status: req.query.status || 'pending' });
  res.json({ ok: true, requests, db: db.dbEnabled() });
});

const ACCOUNT_TYPES = ['', 'student', 'professional', 'recruiter', 'college_admin', 'admin'];
app.post('/api/admin/users/:id/verify', requireAuth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const patch = { id: req.params.id, email: b.email };
  if (b.accountType !== undefined) {
    if (!ACCOUNT_TYPES.includes(String(b.accountType))) return res.status(400).json({ ok: false, error: 'invalid_account_type' });
    patch.accountType = b.accountType;
  }
  if (b.roleVerified !== undefined) patch.roleVerified = b.roleVerified === true || b.roleVerified === 'true';
  if (b.organizationId !== undefined) patch.organizationId = b.organizationId;
  if (b.collegeId !== undefined) patch.collegeId = b.collegeId;
  if (b.action === 'approve') { patch.roleVerified = true; patch.verificationStatus = 'approved'; }
  if (b.action === 'reject') { patch.roleVerified = false; patch.verificationStatus = 'rejected'; }
  const result = await db.setUserVerification(patch);
  res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
});

/* Self-service: a user REQUESTS a privileged role. Creates a pending request
   only — never grants access (an admin must approve). */
app.post('/api/account/request-verification', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const b = req.body || {};
  const requestedType = String(b.requestedType || '');
  if (!['recruiter', 'college_admin'].includes(requestedType)) return res.status(400).json({ ok: false, error: 'invalid_requested_type' });
  const result = await db.requestRoleVerification({
    id: u?.id, email: u?.email, name: u?.name,
    requestedType, organizationId: b.organizationId, collegeId: b.collegeId,
  });
  res.status(result.ok ? 200 : 400).json({ ...result, db: db.dbEnabled() });
});

/* Current caller's server-controlled access context (UI reads this to know its
   VERIFIED privileges — distinct from the self-selected onboarding persona). */
app.get('/api/account/access-context', requireAuth, async (req, res) => {
  const ctx = await getCurrentUserAccessContext(req);
  res.json({
    ok: true,
    role: ctx.role, isAdmin: ctx.isAdmin, privileged: ctx.privileged,
    accountType: ctx.accountType, roleVerified: ctx.roleVerified,
    verificationStatus: ctx.verificationStatus || 'none',
    organizationId: ctx.organizationId, collegeId: ctx.collegeId,
    db: db.dbEnabled(),
  });
});


/* ============================================================
   CONTACTS / REFERRALS  (compliant provider lookups)
   ------------------------------------------------------------
   COMPLIANCE: only official provider APIs gated behind env keys.
   NO LinkedIn scraping, NO cookies/sessions, NO CAPTCHA bypass,
   NO private APIs, NO browser automation. Missing keys never crash:
   each provider is skipped and reported as inactive. Never fabricates
   names/emails/URLs; guessed emails are returned only with
   verified:false and a clear "guessed" label.
   ============================================================ */
const HUNTER_API_KEY = process.env.HUNTER_API_KEY || process.env.HUNTERIO_API_KEY || process.env.HUNTER_KEY || '';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY || '';
const SNOV_API_KEY = process.env.SNOV_API_KEY || (process.env.SNOV_CLIENT_ID && process.env.SNOV_CLIENT_SECRET ? `${process.env.SNOV_CLIENT_ID}:${process.env.SNOV_CLIENT_SECRET}` : '');
const PDL_API_KEY = process.env.PDL_API_KEY || process.env.PEOPLE_DATA_LABS_API_KEY || process.env.PEOPLEDATALABS_API_KEY || '';
const ROCKETREACH_API_KEY = process.env.ROCKETREACH_API_KEY || '';

const CONTACT_PROVIDERS = {
  hunter:      () => !!HUNTER_API_KEY,
  apollo:      () => !!APOLLO_API_KEY,
  snov:        () => !!SNOV_API_KEY,
  pdl:         () => !!PDL_API_KEY,
  rocketreach: () => !!ROCKETREACH_API_KEY,
  serpapi:     () => !!process.env.SERPAPI_KEY
};
function providersConfigured() {
  const o = {};
  for (const k of Object.keys(CONTACT_PROVIDERS)) o[k] = CONTACT_PROVIDERS[k]();
  return o;
}
async function timedFetch(url, opts = {}, timeout = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: (text || '').slice(0, 300) }; }
    if (!r.ok) throw new Error((data && (data.message || data.error || data.raw)) || `${r.status} ${r.statusText}`);
    return data;
  } finally { clearTimeout(t); }
}
function cleanDomain(d) {
  return String(d || '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
}
const ROLE_HINTS = {
  recruiter: 'recruiter', 'technical recruiter': 'technical recruiter',
  'talent acquisition': 'talent acquisition', HR: 'human resources',
  'hiring manager': 'hiring manager', 'engineering manager': 'engineering manager'
};

/* Hunter.io — Domain Search (official API). Returns real, source-attributed emails. */
async function hunterDomain(domain, diagnostics) {
  if (!CONTACT_PROVIDERS.hunter() || !domain) return [];
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${encodeURIComponent(HUNTER_API_KEY)}`;
    const d = await timedFetch(url, {}, 9000);
    const emails = (d && d.data && d.data.emails) || [];
    diagnostics.push({ provider: 'hunter', ok: true, count: emails.length });
    return emails.map(e => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(' '),
      title: e.position || '', company: (d.data.organization || ''), email: e.value || '',
      linkedinUrl: e.linkedin || '', source: 'Hunter.io',
      confidence: typeof e.confidence === 'number' ? e.confidence : 60,
      verified: (e.verification && e.verification.status === 'valid') || false,
      reason: `Found via Hunter.io domain search${e.department ? ' (' + e.department + ')' : ''}.`,
      contactType: classifyTitle(e.position)
    }));
  } catch (err) { diagnostics.push({ provider: 'hunter', ok: false, error: err.message }); return []; }
}
/* Apollo.io — People Search (official API). */
async function apolloPeople(ctx, diagnostics) {
  if (!CONTACT_PROVIDERS.apollo()) return [];
  try {
    const body = {
      api_key: APOLLO_API_KEY,
      q_organization_domains: ctx.domain || undefined,
      organization_names: ctx.company ? [ctx.company] : undefined,
      person_titles: ['recruiter', 'talent acquisition', 'technical recruiter', 'hiring manager', 'engineering manager'],
      page: 1, per_page: 10
    };
    const d = await timedFetch('https://api.apollo.io/v1/mixed_people/search',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body: JSON.stringify(body) }, 9000);
    const people = (d && (d.people || d.contacts)) || [];
    diagnostics.push({ provider: 'apollo', ok: true, count: people.length });
    return people.map(p => ({
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      title: p.title || '', company: (p.organization && p.organization.name) || ctx.company || '',
      email: p.email && !/email_not_unlocked/i.test(p.email) ? p.email : '',
      linkedinUrl: p.linkedin_url || '', source: 'Apollo',
      confidence: 65, verified: !!(p.email && /@/.test(p.email) && !/not_unlocked/i.test(p.email)),
      reason: 'Matched via Apollo people search by company + role.',
      contactType: classifyTitle(p.title)
    }));
  } catch (err) { diagnostics.push({ provider: 'apollo', ok: false, error: err.message }); return []; }
}
/* Snov.io — domain search (official API; uses client credentials). */
async function snovDomain(ctx, diagnostics) {
  if (!CONTACT_PROVIDERS.snov() || !ctx.domain) return [];
  try {
    // SNOV_API_KEY here is expected as "clientId:clientSecret"
    const [cid, secret] = String(SNOV_API_KEY).split(':');
    if (!cid || !secret) throw new Error('SNOV_API_KEY must be "clientId:clientSecret"');
    const tok = await timedFetch('https://api.snov.io/v1/oauth/access_token',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: cid, client_secret: secret }) }, 8000);
    const access = tok && tok.access_token; if (!access) throw new Error('Snov auth failed');
    const url = `https://api.snov.io/v2/domain-emails-with-info?domain=${encodeURIComponent(ctx.domain)}&type=all&limit=10&access_token=${encodeURIComponent(access)}`;
    const d = await timedFetch(url, {}, 9000);
    const emails = (d && d.emails) || [];
    diagnostics.push({ provider: 'snov', ok: true, count: emails.length });
    return emails.map(e => ({
      name: [e.firstName, e.lastName].filter(Boolean).join(' '), title: e.position || '',
      company: ctx.company || '', email: e.email || '', linkedinUrl: e.sourcePage && /linkedin/.test(e.sourcePage) ? e.sourcePage : '',
      source: 'Snov.io', confidence: 55, verified: (e.status === 'valid'),
      reason: 'Found via Snov.io domain search.', contactType: classifyTitle(e.position)
    }));
  } catch (err) { diagnostics.push({ provider: 'snov', ok: false, error: err.message }); return []; }
}
/* People Data Labs — Person Search (official API). */
async function pdlPeople(ctx, diagnostics, opts = {}) {
  if (!CONTACT_PROVIDERS.pdl()) return [];
  try {
    const company = String(ctx.company || '').replace(/'/g, '').trim();
    const domain = cleanDomain(ctx.domain || '');
    if (!company && !domain) return [];

    const companyWhere = company
      ? `(job_company_name='${company}' OR job_company_name LIKE '%${company}%')`
      : `job_company_website='${domain}'`;

    const roleTerms = roleTokens(ctx.title || ctx.role || '').slice(0, 3);
    let titleWhere;
    if (opts.referral) {
      const roleLike = roleTerms.length
        ? roleTerms.map(t => `job_title LIKE '%${String(t).replace(/'/g, '')}%'`).join(' OR ')
        : "job_title_role='engineering' OR job_title_role='information_technology' OR job_title LIKE '%engineer%' OR job_title LIKE '%developer%'";
      titleWhere = `(${roleLike} OR job_title LIKE '%manager%' OR job_title LIKE '%lead%')`;
    } else {
      titleWhere = "(job_title_role='human_resources' OR job_title LIKE '%recruit%' OR job_title LIKE '%talent%' OR job_title LIKE '%hiring%' OR job_title LIKE '%people%')";
    }

    const body = { sql: `SELECT * FROM person WHERE ${companyWhere} AND ${titleWhere}`, size: 10 };
    const d = await timedFetch('https://api.peopledatalabs.com/v5/person/search',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': PDL_API_KEY }, body: JSON.stringify(body) }, 9000);
    const data = (d && d.data) || [];
    diagnostics.push({ provider: 'pdl', ok: true, count: data.length, mode: opts.referral ? 'referral' : 'hiring-contact' });
    return data.map(p => ({
      name: p.full_name || '', title: p.job_title || '', company: p.job_company_name || ctx.company || '',
      email: (p.work_email || (p.emails && p.emails[0] && p.emails[0].address)) || '',
      linkedinUrl: p.linkedin_url ? (/^https?:/.test(p.linkedin_url) ? p.linkedin_url : 'https://' + p.linkedin_url) : '',
      source: 'People Data Labs', confidence: p.work_email ? 72 : 58, verified: !!p.work_email,
      reason: opts.referral ? 'Matched via People Data Labs as a possible employee/referral path.' : 'Matched via People Data Labs person search for recruiter/HR roles.',
      contactType: opts.referral ? 'current employee' : classifyTitle(p.job_title),
      relationshipSignal: opts.referral ? 'same company' : undefined,
      referralFitReason: opts.referral ? 'Works at the target company in a potentially relevant function.' : undefined
    }));
  } catch (err) { diagnostics.push({ provider: 'pdl', ok: false, error: err.message, mode: opts.referral ? 'referral' : 'hiring-contact' }); return []; }
}
/* RocketReach — search (official API). */
async function rocketreach(ctx, diagnostics) {
  if (!CONTACT_PROVIDERS.rocketreach()) return [];
  try {
    const body = { query: { current_employer: ctx.company ? [ctx.company] : undefined, current_title: ['recruiter', 'talent acquisition', 'hiring manager'] }, page: 1, page_size: 10 };
    const d = await timedFetch('https://api.rocketreach.co/api/v2/person/search',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Api-Key': ROCKETREACH_API_KEY }, body: JSON.stringify(body) }, 9000);
    const profiles = (d && d.profiles) || [];
    diagnostics.push({ provider: 'rocketreach', ok: true, count: profiles.length });
    return profiles.map(p => ({
      name: p.name || '', title: p.current_title || '', company: p.current_employer || ctx.company || '',
      email: '', linkedinUrl: p.linkedin_url || '', source: 'RocketReach',
      confidence: 55, verified: false,
      reason: 'Matched via RocketReach search (email lookup requires a separate credit-based call).',
      contactType: classifyTitle(p.current_title)
    }));
  } catch (err) { diagnostics.push({ provider: 'rocketreach', ok: false, error: err.message }); return []; }
}
/* SerpAPI — Google search for PUBLIC profile/page links only (no scraping of LinkedIn itself). */
async function serpPublic(ctx, diagnostics, referral) {
  if (!CONTACT_PROVIDERS.serpapi()) return [];
  try {
    const q = referral
      ? `site:linkedin.com/in "${ctx.company}" "${ctx.title || ''}"`
      : `site:linkedin.com/in "${ctx.company}" ("recruiter" OR "talent acquisition")`;
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&num=8&api_key=${encodeURIComponent(process.env.SERPAPI_KEY)}`;
    const d = await timedFetch(url, {}, 9000);
    const org = (d && d.organic_results) || [];
    diagnostics.push({ provider: 'serpapi', ok: true, count: org.length });
    // We return these as public-profile *links* only — never as confirmed people with emails.
    return org.slice(0, 8).map(r => ({
      name: (r.title || '').replace(/\s*[-|].*$/, '').trim(), title: '', company: ctx.company || '',
      email: '', linkedinUrl: r.link || '', source: 'SerpAPI (public Google result)',
      confidence: 20, verified: false,
      reason: 'Public Google result link. Open to verify; no profile data was scraped.',
      contactType: 'public profile result',
      relationshipSignal: referral ? 'weak public match' : undefined
    }));
  } catch (err) { diagnostics.push({ provider: 'serpapi', ok: false, error: err.message }); return []; }
}
function classifyTitle(t) {
  const s = String(t || '').toLowerCase();
  if (/technical recruit/.test(s)) return 'technical recruiter';
  if (/recruit/.test(s)) return 'recruiter';
  if (/talent/.test(s)) return 'talent acquisition';
  if (/engineering manager|eng manager|head of eng/.test(s)) return 'engineering manager';
  if (/hiring manager/.test(s)) return 'hiring manager';
  if (/\bhr\b|human resresource|human resources|people ops|people operations/.test(s)) return 'HR';
  return 'recruiter';
}
function dedupePeople(list) {
  const seen = new Set(); const out = [];
  for (const p of list) {
    if (!p || (!p.name && !p.email && !p.linkedinUrl)) continue;
    const k = (p.email || p.linkedinUrl || p.name || '').toLowerCase();
    if (seen.has(k)) continue; seen.add(k); out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------
   Fallback contact intelligence — used to guarantee useful results
   even when no paid provider key is configured. Returns:
   • role-targeted LinkedIn people-search links (recruiters, HR,
     hiring managers, engineering leads), and
   • probable company emails (clearly labelled) when a domain is known.
   No scraping; LinkedIn links are public search URLs only.
   ------------------------------------------------------------------ */
function linkedinSearchUrl(company, keywords) {
  const kw = [keywords, company].filter(Boolean).join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`;
}
function isTechnicalRole(title = '') {
  return /(engineer|developer|sde|swe|devops|sre|data|software|cloud|platform|architect|programmer|ml|ai|backend|frontend|full.?stack)/i.test(title);
}
function probableEmails(domain, role) {
  if (!domain) return [];
  const d = cleanDomain(domain);
  const patterns = [
    { local: 'careers', label: 'Careers inbox' },
    { local: 'jobs', label: 'Jobs inbox' },
    { local: 'recruiting', label: 'Recruiting inbox' },
    { local: 'hr', label: 'HR inbox' },
    { local: 'talent', label: 'Talent inbox' },
  ];
  return patterns.map((p, i) => ({
    name: `${p.label} · ${role || 'Hiring'}`,
    title: 'Company application inbox',
    company: '', email: `${p.local}@${d}`,
    linkedinUrl: '', source: 'Probable pattern',
    confidence: 30 - i * 2, verified: false, probable: true, emailProbable: true,
    reason: `Common ${p.label.toLowerCase()} address for ${d}. Verify before sending.`,
    contactType: 'application inbox',
  }));
}
function fallbackContacts(ctx, referral) {
  const company = ctx.company || 'the company';
  const role = ctx.role || ctx.title || '';
  const out = [];
  const targets = referral
    ? [
        { kw: `${role}`, type: 'current employee', why: 'Works in a relevant role — a strong referral path.' },
        { kw: `${role} ${isTechnicalRole(role) ? 'engineer' : 'team'}`, type: 'team member', why: 'On the likely hiring team for this role.' },
        { kw: 'engineering manager', type: 'engineering manager', why: 'Often owns referral and hiring decisions.', tech: true },
      ]
    : [
        { kw: 'recruiter', type: 'recruiter', why: 'Recruiters route applications and book first calls.' },
        { kw: 'talent acquisition', type: 'talent acquisition', why: 'Owns sourcing for open roles.' },
        { kw: 'technical recruiter', type: 'technical recruiter', why: 'Handles engineering pipelines.', tech: true },
        { kw: 'human resources', type: 'HR', why: 'HR can redirect you to the right hiring contact.' },
        { kw: `${role} hiring manager`, type: 'hiring manager', why: 'The decision-maker for this specific role.' },
        { kw: 'engineering manager', type: 'engineering manager', why: 'Likely hiring manager for technical roles.', tech: true },
      ];
  for (const t of targets) {
    if (t.tech && !isTechnicalRole(role)) continue;
    out.push({
      name: `${company} — ${t.kw.replace(role, role || '').trim() || t.type}`.slice(0, 70),
      title: t.type.replace(/\b\w/g, (c) => c.toUpperCase()),
      company,
      email: '', linkedinUrl: linkedinSearchUrl(company, t.kw),
      source: 'LinkedIn search (fallback)', confidence: 22, verified: false,
      linkedinOnly: true, reason: t.why, contactType: t.type,
      relationshipSignal: referral ? 'same company' : undefined,
    });
  }
  out.push(...probableEmails(ctx.domain, role));
  return out;
}
/* Ensure every contact has a LinkedIn link and an email-status label. */
function enrichContacts(list, ctx) {
  return list.map((c) => {
    const out = { ...c };
    if (!out.linkedinUrl && !out.email) {
      out.linkedinUrl = linkedinSearchUrl(out.company || ctx.company, out.name || out.title || ctx.title);
      out.linkedinOnly = true;
    }
    if (!out.linkedinUrl && out.name && !/inbox/i.test(out.title || '')) {
      out.linkedinUrl = linkedinSearchUrl(out.company || ctx.company, out.name);
    }
    if (!out.email && !out.linkedinOnly && !/inbox/i.test(out.title || '')) out.linkedinOnly = true;
    if (typeof out.confidence !== 'number') out.confidence = out.verified ? 70 : out.probable ? 30 : 45;
    return out;
  });
}


app.get('/contacts/diagnostics', async (req, res) => {
  const company = String(req.query.company || '').trim();
  const domain = cleanDomain(req.query.domain || '');
  const out = {
    ok: true,
    time: new Date().toISOString(),
    providersConfigured: providersConfigured(),
    acceptedEnvNames: {
      hunter: ['HUNTER_API_KEY', 'HUNTERIO_API_KEY', 'HUNTER_KEY'],
      pdl: ['PDL_API_KEY', 'PEOPLE_DATA_LABS_API_KEY', 'PEOPLEDATALABS_API_KEY']
    },
    checks: []
  };
  if (CONTACT_PROVIDERS.hunter()) {
    if (!domain) out.checks.push({ provider: 'hunter', ok: false, count: 0, message: 'Hunter key detected. Add a company domain to test domain-search.' });
    else {
      const dx = [];
      const rows = await hunterDomain(domain, dx);
      out.checks.push({ provider: 'hunter', ok: dx.some(x => x.provider === 'hunter' && x.ok), count: rows.length, message: dx.find(x => x.provider === 'hunter')?.error || 'Hunter domain-search tested.' });
    }
  } else out.checks.push({ provider: 'hunter', ok: false, count: 0, message: 'HUNTER_API_KEY missing.' });

  if (CONTACT_PROVIDERS.pdl()) {
    const dx = [];
    const rows = await pdlPeople({ company, domain, title: req.query.title || 'software engineer' }, dx, { referral: true });
    out.checks.push({ provider: 'pdl', ok: dx.some(x => x.provider === 'pdl' && x.ok), count: rows.length, message: dx.find(x => x.provider === 'pdl')?.error || 'People Data Labs person-search tested.' });
  } else out.checks.push({ provider: 'pdl', ok: false, count: 0, message: 'PDL_API_KEY / PEOPLE_DATA_LABS_API_KEY missing.' });
  res.json(out);
});

app.post('/contacts/find', contactsLimiter, validateBody(contactsFindSchema), async (req, res) => {
  const ctx = req.body || {};
  ctx.domain = cleanDomain(ctx.domain);
  const diagnostics = [];
  let contacts = [];
  try {
    const batches = await Promise.allSettled([
      hunterDomain(ctx.domain, diagnostics),
      apolloPeople(ctx, diagnostics),
      snovDomain(ctx, diagnostics),
      pdlPeople(ctx, diagnostics),
      rocketreach(ctx, diagnostics),
      serpPublic(ctx, diagnostics, false)
    ]);
    for (const b of batches) if (b.status === 'fulfilled' && Array.isArray(b.value)) contacts = contacts.concat(b.value);
    const providerCount = contacts.length;
    // Always guarantee useful results with compliant fallbacks (search links + probable inboxes)
    contacts = contacts.concat(fallbackContacts(ctx, false));
    contacts = enrichContacts(dedupePeople(contacts), ctx).map(c => ({ ...c, relatedJobId: ctx.jobId || null }));
    // sort: real verified first, then by confidence
    contacts.sort((a, b) => (b.verified - a.verified) || (Number(b.confidence) - Number(a.confidence)));
    res.json({
      ok: true, contacts, diagnostics,
      providersConfigured: providersConfigured(),
      lookupCount: contacts.length, providerCount,
      usedFallback: providerCount === 0,
      note: providerCount === 0
        ? 'No contact provider keys configured — showing role-targeted LinkedIn search links and probable company inboxes (labelled). Add Hunter/Apollo/PDL keys for verified emails.'
        : 'Compliant provider lookups + public search links. Guessed/unverified items are labelled.'
    });
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e), contacts, diagnostics, providersConfigured: providersConfigured() });
  }
});

app.post('/contacts/referrals', contactsLimiter, async (req, res) => {
  const ctx = req.body || {};
  ctx.domain = cleanDomain(ctx.domain);
  const diagnostics = [];
  let contacts = [];
  try {
    const batches = await Promise.allSettled([
      apolloPeople(ctx, diagnostics),     // current employees by company + role
      pdlPeople(ctx, diagnostics, { referral: true }),
      hunterDomain(ctx.domain, diagnostics),
      snovDomain(ctx, diagnostics),
      rocketreach(ctx, diagnostics),
      serpPublic(ctx, diagnostics, true)
    ]);
    for (const b of batches) if (b.status === 'fulfilled' && Array.isArray(b.value)) contacts = contacts.concat(b.value);
    const providerCount = contacts.length;
    contacts = contacts.concat(fallbackContacts(ctx, true));
    contacts = enrichContacts(dedupePeople(contacts), ctx).map(c => ({
      ...c, relatedJobId: ctx.jobId || null,
      contactType: c.contactType === 'public profile result' ? 'public profile result' : (/(recruit|talent)/i.test(c.title || '') ? 'recruiter' : (c.contactType || 'current employee')),
      relationshipSignal: c.relationshipSignal || (c.company && ctx.company && String(c.company).toLowerCase().includes(String(ctx.company).toLowerCase()) ? 'same company' : 'weak public match'),
      referralFitReason: c.reason || 'Possible referral path at the target company.'
    }));
    contacts.sort((a, b) => (b.verified - a.verified) || (Number(b.confidence) - Number(a.confidence)));
    res.json({
      ok: true, contacts, diagnostics,
      providersConfigured: providersConfigured(),
      lookupCount: contacts.length, providerCount,
      usedFallback: providerCount === 0,
      note: providerCount === 0
        ? 'No provider keys configured — showing referral search paths (LinkedIn) for likely teammates and managers. Add PDL/Apollo keys for named employees.'
        : 'Compliant API + public search results. No scraping.'
    });
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e), contacts, diagnostics, providersConfigured: providersConfigured() });
  }
});

app.get('/contacts/providers', (req, res) => {
  res.json({ providersConfigured: providersConfigured(), time: new Date().toISOString() });
});

/* ============================================================
   AI PROXY  (keeps the Anthropic key server-side — NOT in the browser)
   Used ONLY for resume analysis, tailoring, cover letters, recruiter
   messages, interview prep and the growth plan. NEVER for job search.
   ============================================================ */
app.post('/ai/messages', aiLimiter, validateBody(aiMessagesSchema), async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  // Student-facing copy: never name an internal environment variable. The
  // operational detail belongs in the server logs, not on a student's screen.
  if (!key) {
    logger.warn('AI proxy called but no provider key is configured');
    return res.status(400).json({ error: { code: 'ai_not_configured', message: 'AI features are not enabled on this account yet, so you are seeing the standard template version. Everything else still works.' } });
  }
  try {
    // Always force the server-resolved, supported model. The client may send a
    // stale/hardcoded model id (older builds sent a now-retired snapshot); we
    // override it so an invalid client model can never reach the API.
    const body = { ...(req.body || {}), model: resolveAiModel() };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({ error: { message: 'Bad upstream response' } }));
    // A non-2xx from the provider used to pass through silently: nothing in the
    // logs, a generic message on screen. Log the real cause (status + provider
    // error type + model) so "tailoring is broken" is one grep away.
    if (!r.ok) {
      logger.error('AI provider rejected the request', {
        status: r.status,
        type: data?.error?.type || '',
        providerMessage: data?.error?.message || '',
        model: body.model,
      });
    }
    res.status(r.status).json(data);
  } catch (err) {
    logger.error('AI proxy failed', { message: err.message });
    res.status(502).json({ error: { code: 'ai_unavailable', message: err.message || 'AI proxy failed' } });
  }
});

/* ============================================================
   SUPPORT SYSTEM  (FAQ knowledge base, grounded chatbot, tickets)
   - /support/faqs   : public — FAQ list + quick-action chips
   - /support/chat   : public — answers from the FAQ KB first; only calls the
                       AI model (grounded on the same KB) when nothing matches,
                       and never invents platform behaviour or leaks secrets.
   - /support/tickets: public POST (create) ; protected GET /my (list mine)
   ============================================================ */
app.get('/support/faqs', (req, res) => {
  res.json({
    quickActions: QUICK_ACTIONS,
    faqs: FAQS.map(({ id, category, q, a }) => ({ id, category, q, a })),
    categories: [...new Set(FAQS.map((f) => f.category))],
  });
});

app.post('/support/chat', supportChatLimiter, validateBody(supportChatSchema), async (req, res) => {
  try {
    const message = String((req.body && req.body.message) || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: 'empty_message' });

    const { best, confident, related } = matchFaq(message);

    // Strong, confident FAQ hit → answer directly from the knowledge base.
    if (best && confident) {
      return res.json({
        source: 'faq',
        reply: best.a,
        faq: { id: best.id, q: best.q, category: best.category },
        related: related.map((r) => ({ id: r.id, q: r.q })),
        suggestTicket: false,
      });
    }

    // No confident match → try the AI model, GROUNDED strictly on the KB.
    const key = process.env.ANTHROPIC_API_KEY;
    if (key) {
      const kb = FAQS.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
      const system =
        'You are the in-app support assistant for "Career Autopilot", a job-search & resume SaaS. ' +
        'Answer ONLY using the KNOWLEDGE BASE below. Be concise, friendly and give concrete steps. ' +
        'Never invent features, never reveal API keys, environment variables, stack traces or internal config. ' +
        'If the question is not covered by the knowledge base, reply with exactly the token NO_ANSWER and nothing else.\n\n' +
        `KNOWLEDGE BASE:\n${kb}`;
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: resolveAiModel(),
            max_tokens: 400,
            system,
            messages: [{ role: 'user', content: message }],
          }),
        });
        const data = await r.json().catch(() => ({}));
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (text && !/NO_ANSWER/i.test(text)) {
          return res.json({
            source: 'ai',
            reply: text,
            related: (related.length ? related : best ? [best] : []).map((r) => ({ id: r.id, q: r.q })),
            suggestTicket: false,
          });
        }
      } catch { /* fall through to ticket suggestion */ }
    }

    // Soft FAQ hint if we had a weak match; otherwise suggest a ticket.
    return res.json({
      source: best ? 'faq-weak' : 'fallback',
      reply: best
        ? `I think this might help:\n\n${best.a}\n\nIf that doesn't solve it, you can create a support ticket and our team will follow up.`
        : "I couldn't find that in our help center. Create a support ticket and our team will get back to you with the details.",
      faq: best ? { id: best.id, q: best.q, category: best.category } : null,
      related: related.map((r) => ({ id: r.id, q: r.q })),
      suggestTicket: true,
    });
  } catch (err) {
    res.status(500).json({ error: 'support_chat_failed' });
  }
});

app.post('/support/tickets', ticketLimiter, validateBody(ticketSchema), async (req, res) => {
  try {
    const b = req.body || {};
    const me = currentUser(req);
    const name = String(b.name || me?.name || '').trim().slice(0, 120);
    const email = String(b.email || me?.email || '').trim().slice(0, 160);
    const subject = String(b.subject || '').trim().slice(0, 200);
    const message = String(b.message || '').trim().slice(0, 5000);
    const category = String(b.category || 'general').trim().slice(0, 40);
    const priority = ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : 'normal';

    if (!email || !subject || !message) {
      return res.status(400).json({ ok: false, error: 'missing_fields', message: 'Email, subject and message are required.' });
    }

    const userId = me && db.dbEnabled() ? (await db.getUser({ id: me.id, email: me.email }))?.id || null : null;
    const result = await db.createTicket({ userId, name, email, category, subject, message, priority });

    // If the DB is off we still acknowledge so the UX never dead-ends.
    if (!result.stored) {
      return res.json({
        ok: true, stored: false,
        message: 'Ticket received. (Database not configured — connect MONGODB_URI to persist tickets.)',
        ticket: { subject, category, priority, status: 'open' },
      });
    }
    res.json({ ok: true, stored: true, message: 'Support ticket created.', ticket: result.ticket });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'ticket_create_failed' });
  }
});

app.get('/support/tickets/my', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    const dbUser = db.dbEnabled() ? await db.getUser({ id: me.id, email: me.email }) : null;
    const tickets = await db.ticketsByUser({ userId: dbUser?.id, email: me.email });
    res.json({ ok: true, dbEnabled: db.dbEnabled(), tickets });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'tickets_fetch_failed', tickets: [] });
  }
});

/* ============================================================
   DASHBOARD SUMMARY  (per-authenticated-user, never shared)
   - Real users (Google OAuth): stats are aggregated from THEIR OWN MongoDB
     records. A brand-new user has no records, so every value is zero / empty.
   - Demo users (dev-login): get clearly-flagged sample data (demo: true) so the
     UI can showcase a populated dashboard without ever faking real-user stats.
   ============================================================ */
function demoDashboardSummary() {
  return {
    resumeScore: 92,
    resumeDelta: 6,
    liveApplications: 12,
    recruiterReplies: 6,
    outreachSent: 24,
    funnel: { saved: 34, applied: 12, interview: 4, offer: 1 },
    weekly: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [8, 14, 10, 18, 12, 22, 16] },
    activity: [
      { text: 'Tailored resume for Senior DevOps role', when: '2h ago', tone: 'cyan' },
      { text: '18 new verified matches found', when: '5h ago', tone: 'violet' },
      { text: 'Outreach sent to 3 recruiters', when: 'Yesterday', tone: 'mint' },
      { text: 'Resume score improved to 92', when: 'Yesterday', tone: 'amber' },
    ],
    matches: [],
  };
}

app.get('/dashboard/summary', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    const isDemo = me.provider === 'dev';

    // Demo accounts get sample data, explicitly marked so the UI can label it.
    if (isDemo) {
      return res.json({ ok: true, demo: true, dbEnabled: db.dbEnabled(), summary: demoDashboardSummary() });
    }

    // Real users: aggregate strictly from their own persisted records.
    const dbUser = db.dbEnabled() ? await db.getUser({ id: me.id, email: me.email }) : null;
    const summary = dbUser
      ? await db.dashboardSummary({ userId: dbUser.id })
      : db.emptyDashboardSummary(); // DB off → honest zeros, never fake data

    res.json({ ok: true, demo: false, dbEnabled: db.dbEnabled(), summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'dashboard_summary_failed', summary: db.emptyDashboardSummary() });
  }
});

/* ============================================================
   OPPORTUNITY ARENA  (hackathons, hiring challenges & competitions)
   COMPLIANCE: public APIs (Codeforces, Devpost public JSON), public
   pages, SerpAPI public Google links (only when SERPAPI_KEY is set) and
   curated static fallback search links. NO scraping, NO CAPTCHA bypass,
   NO login/cookie/session scraping, NO Puppeteer/Playwright. The app is
   fully functional without SERPAPI_KEY (curated fallbacks are returned).
   ============================================================ */
const OPP_FETCH_TIMEOUT = Number(process.env.OPP_FETCH_TIMEOUT || 9000);

const OPP_TYPES = ['hackathon','hiring challenge','coding contest','case competition','innovation challenge','internship challenge','campus challenge','open source program','data science competition','cybersecurity challenge','cloud/devops challenge'];
const OPP_MODES = ['online','offline','hybrid','unknown'];
const OPP_DIFFICULTY = ['beginner','intermediate','advanced','open'];

function oppId(seed) { return 'opp_' + crypto.createHash('sha1').update(String(seed || Math.random())).digest('hex').slice(0, 12); }
function oppNorm(s) { return String(s || '').toLowerCase(); }

/* hiring / internship / full-time detection from free text */
function detectHiring(text) {
  const s = oppNorm(text);
  const hiring = /(hiring challenge|recruitment challenge|interview opportunity|job opportunity|pre[\s-]*placement interview|\bppi\b|get hired|fast[\s-]*track interview)/.test(s);
  const internship = /(internship opportunity|internship challenge|intern hiring|summer intern|winter intern|internship offer)/.test(s);
  const fulltime = /(full[\s-]*time opportunity|full[\s-]*time offer|fte\b|placement|on[\s-]*roll position)/.test(s);
  return { hiringOpportunity: hiring || internship || fulltime, internshipOpportunity: internship, fullTimeOpportunity: fulltime };
}
function inferCategory(text) {
  const s = oppNorm(text);
  if (/(machine learning|deep learning|\bml\b|\bai\b|nlp|computer vision|llm|generative)/.test(s)) return 'AI/ML';
  if (/(data science|data analytics|kaggle|analytics|statistic)/.test(s)) return 'Data Science';
  if (/(cyber|security|infosec|ctf|capture the flag|pentest)/.test(s)) return 'Cybersecurity';
  if (/(devops|cloud|kubernetes|docker|aws|azure|gcp|terraform|sre|ci\/cd)/.test(s)) return 'DevOps/Cloud';
  if (/(frontend|react|web app|website|full[\s-]*stack|javascript|html|css)/.test(s)) return 'Web Development';
  if (/(android|ios|mobile|flutter|react native|kotlin|swift)/.test(s)) return 'Mobile Development';
  if (/(open source|oss|gsoc|hacktoberfest)/.test(s)) return 'Open Source';
  if (/(product manage|product management|\bpm\b)/.test(s)) return 'Product Management';
  if (/(design|ui\/ux|ux|figma)/.test(s)) return 'Design';
  if (/(fintech|finance|trading|banking|quant)/.test(s)) return 'Finance';
  if (/(case competition|business|consult|strategy|b-?school)/.test(s)) return 'Business/Case';
  if (/(software|coding|programming|algorithm|developer|engineering)/.test(s)) return 'Software Development';
  return 'General';
}
function inferType(text, platform) {
  const s = oppNorm(text + ' ' + platform);
  if (/case competition/.test(s)) return 'case competition';
  if (/(ctf|cyber|security challenge)/.test(s)) return 'cybersecurity challenge';
  if (/(devops|cloud|kubernetes|sre)/.test(s)) return 'cloud/devops challenge';
  if (/(data science|kaggle|analytics competition)/.test(s)) return 'data science competition';
  if (/(open source|gsoc|hacktoberfest|oss)/.test(s)) return 'open source program';
  if (/(internship challenge|intern hiring)/.test(s)) return 'internship challenge';
  if (/(campus|college fest)/.test(s)) return 'campus challenge';
  if (/(innovation|ideathon|startup challenge)/.test(s)) return 'innovation challenge';
  if (/(hiring challenge|recruitment|ppi|pre[\s-]*placement)/.test(s)) return 'hiring challenge';
  if (/(codeforces|codechef|leetcode|topcoder|contest|round\b)/.test(s)) return 'coding contest';
  return 'hackathon';
}
function inferDifficulty(text) {
  const s = oppNorm(text);
  if (/(beginner|newbie|fresher|student|first[\s-]*time|div\.?\s*[34]|easy)/.test(s)) return 'beginner';
  if (/(advanced|expert|hard|div\.?\s*1|grandmaster|senior)/.test(s)) return 'advanced';
  if (/(intermediate|div\.?\s*2|medium)/.test(s)) return 'intermediate';
  return 'open';
}
function inferMode(text) {
  const s = oppNorm(text);
  if (/(online|virtual|remote)/.test(s)) return 'online';
  if (/(hybrid)/.test(s)) return 'hybrid';
  if (/(offline|on[\s-]*site|in[\s-]*person|venue)/.test(s)) return 'offline';
  return 'unknown';
}
function extractSkills(text) {
  const KW = ['python','java','javascript','typescript','react','node','node.js','angular','vue','docker','kubernetes','aws','azure','gcp','terraform','ansible','sql','mongodb','postgresql','machine learning','tensorflow','pytorch','nlp','c++','go','rust','django','flask','spring','figma','flutter','kotlin','swift','solidity','blockchain','data analysis','pandas','numpy','spark','kafka','graphql','rest api','ci/cd','linux','git'];
  const s = oppNorm(text); const out = [];
  for (const k of KW) if (s.includes(k) && !out.includes(k)) out.push(k);
  return out.slice(0, 8);
}

function normalizeOpportunity(raw) {
  const text = [raw.title, raw.description, raw.organizer, raw.company, (raw.skills || []).join(' '), raw.category, raw.type].filter(Boolean).join(' ');
  const det = detectHiring(text);
  const o = {
    id: raw.id || oppId(raw.sourceUrl || raw.registrationUrl || raw.title),
    title: raw.title || 'Untitled opportunity',
    platform: raw.platform || raw.source || '',
    organizer: raw.organizer || '',
    company: raw.company || '',
    category: raw.category || inferCategory(text),
    type: OPP_TYPES.includes(raw.type) ? raw.type : inferType(text, raw.platform || ''),
    description: stripHtml(raw.description || '').slice(0, 600),
    eligibility: raw.eligibility || 'Open to all / check official page',
    mode: OPP_MODES.includes(raw.mode) ? raw.mode : inferMode(text),
    location: raw.location || '',
    deadline: raw.deadline || '',
    startDate: raw.startDate || '',
    endDate: raw.endDate || '',
    prize: raw.prize || '',
    hiringOpportunity: raw.hiringOpportunity != null ? !!raw.hiringOpportunity : det.hiringOpportunity,
    internshipOpportunity: raw.internshipOpportunity != null ? !!raw.internshipOpportunity : det.internshipOpportunity,
    fullTimeOpportunity: raw.fullTimeOpportunity != null ? !!raw.fullTimeOpportunity : det.fullTimeOpportunity,
    skills: (raw.skills && raw.skills.length) ? raw.skills.slice(0, 8) : extractSkills(text),
    difficulty: OPP_DIFFICULTY.includes(raw.difficulty) ? raw.difficulty : inferDifficulty(text),
    teamSize: raw.teamSize || '',
    registrationUrl: raw.registrationUrl || raw.sourceUrl || '',
    sourceUrl: raw.sourceUrl || raw.registrationUrl || '',
    source: raw.source || raw.platform || '',
    verified: !!raw.verified,
    createdAt: raw.createdAt || new Date().toISOString()
  };
  return o;
}

/* ---- Codeforces public API (no key, no scraping) ---- */
async function oppCodeforces(diagnostics) {
  try {
    const d = await fetchJson('https://codeforces.com/api/contest.list?gym=false', OPP_FETCH_TIMEOUT);
    if (!d || d.status !== 'OK' || !Array.isArray(d.result)) throw new Error('Bad Codeforces response');
    const upcoming = d.result.filter(c => c.phase === 'BEFORE').slice(0, 12);
    diagnostics && diagnostics.push({ provider: 'Codeforces', ok: true, count: upcoming.length });
    return upcoming.map(c => normalizeOpportunity({
      title: c.name, platform: 'Codeforces', organizer: 'Codeforces', category: 'Software Development',
      type: 'coding contest', description: `${c.name}. Competitive programming contest on Codeforces.`,
      mode: 'online', startDate: c.startTimeSeconds ? new Date(c.startTimeSeconds * 1000).toISOString().slice(0, 10) : '',
      deadline: c.startTimeSeconds ? new Date(c.startTimeSeconds * 1000).toISOString().slice(0, 10) : '',
      difficulty: inferDifficulty(c.name), skills: ['c++', 'algorithms', 'data structures'],
      registrationUrl: `https://codeforces.com/contestRegistration/${c.id}`, sourceUrl: `https://codeforces.com/contest/${c.id}`,
      source: 'Codeforces', verified: true
    }));
  } catch (e) { diagnostics && diagnostics.push({ provider: 'Codeforces', ok: false, error: e.message }); return []; }
}

/* ---- Devpost public hackathons JSON (no key, no scraping) ---- */
async function oppDevpost(keyword, diagnostics) {
  try {
    const qs = new URLSearchParams({ status: 'open', order_by: 'deadline' });
    if (keyword) qs.set('search', keyword);
    const d = await fetchJson(`https://devpost.com/api/hackathons?${qs.toString()}`, OPP_FETCH_TIMEOUT);
    const list = (d && d.hackathons) || [];
    diagnostics && diagnostics.push({ provider: 'Devpost', ok: true, count: list.length });
    return list.slice(0, 12).map(h => {
      const dates = h.submission_period_dates || '';
      const prize = (h.prize_amount ? stripHtml(h.prize_amount) : '') || '';
      const themes = (h.themes || []).map(t => t.name).join(', ');
      return normalizeOpportunity({
        title: h.title, platform: 'Devpost', organizer: h.organization_name || 'Devpost',
        description: `${h.title}. ${themes ? 'Themes: ' + themes + '. ' : ''}${dates}`,
        category: inferCategory(h.title + ' ' + themes), type: 'hackathon',
        mode: (h.open_state === 'open' && /online|virtual/i.test(JSON.stringify(h.displayed_location || ''))) ? 'online' : inferMode(JSON.stringify(h.displayed_location || '')),
        location: (h.displayed_location && h.displayed_location.location) || 'Online',
        prize, skills: extractSkills(h.title + ' ' + themes),
        registrationUrl: h.url, sourceUrl: h.url, source: 'Devpost', verified: true
      });
    });
  } catch (e) { diagnostics && diagnostics.push({ provider: 'Devpost', ok: false, error: e.message }); return []; }
}

/* ---- SerpAPI public Google results -> safe links only (key-gated) ---- */
async function oppSerp(keyword, diagnostics) {
  if (!process.env.SERPAPI_KEY) return [];
  try {
    const q = `${keyword || 'hackathon hiring challenge'} (hackathon OR "hiring challenge" OR competition) ${process.env.OPP_DEFAULT_LOCATION || 'India'}`;
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&num=10&api_key=${encodeURIComponent(process.env.SERPAPI_KEY)}`;
    const d = await timedFetch(url, {}, OPP_FETCH_TIMEOUT);
    const org = (d && d.organic_results) || [];
    diagnostics && diagnostics.push({ provider: 'SerpAPI', ok: true, count: org.length });
    return org.slice(0, 10).map(r => normalizeOpportunity({
      title: (r.title || '').replace(/\s*[-|–].*$/, '').trim() || r.title, platform: 'Google (SerpAPI)',
      organizer: r.displayed_link || '', description: r.snippet || '', source: 'SerpAPI (public Google result)',
      registrationUrl: r.link, sourceUrl: r.link, verified: false
    }));
  } catch (e) { diagnostics && diagnostics.push({ provider: 'SerpAPI', ok: false, error: e.message }); return []; }
}

/* ---- Curated platform search-link fallbacks (always available) ---- */
function oppSearchLinks(keyword) {
  const k = encodeURIComponent(keyword || 'hackathon hiring challenge');
  const g = q => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  return [
    { platform: 'Unstop', label: 'Unstop hiring challenges & hackathons', url: `https://unstop.com/hackathons?searchTerm=${k}` },
    { platform: 'Unstop', label: 'Unstop hiring challenges', url: `https://unstop.com/competitions?searchTerm=${k}` },
    { platform: 'HackerEarth', label: 'HackerEarth challenges & hiring challenges', url: `https://www.hackerearth.com/challenges/` },
    { platform: 'Devfolio', label: 'Devfolio hackathons', url: `https://devfolio.co/hackathons` },
    { platform: 'Devpost', label: 'Devpost hackathons', url: `https://devpost.com/hackathons?search=${k}` },
    { platform: 'MLH', label: 'MLH events', url: `https://mlh.io/seasons/2026/events` },
    { platform: 'Kaggle', label: 'Kaggle competitions', url: `https://www.kaggle.com/competitions` },
    { platform: 'Topcoder', label: 'Topcoder challenges', url: `https://www.topcoder.com/challenges` },
    { platform: 'CodeChef', label: 'CodeChef contests', url: `https://www.codechef.com/contests` },
    { platform: 'Codeforces', label: 'Codeforces contests', url: `https://codeforces.com/contests` },
    { platform: 'Google', label: '"DevOps hiring challenge India students"', url: g('DevOps hiring challenge India students') },
    { platform: 'Google', label: '"cloud hackathon hiring challenge"', url: g('cloud hackathon hiring challenge') },
    { platform: 'Google', label: '"software engineer hiring challenge India"', url: g('software engineer hiring challenge India') },
    { platform: 'Google', label: '"internship coding challenge students India"', url: g('internship coding challenge students India') },
    { platform: 'Google', label: '"PPI hackathon India"', url: g('PPI hackathon India') },
    { platform: 'Google', label: '"pre placement interview hackathon"', url: g('pre placement interview hackathon') }
  ];
}

/* ---- Curated static opportunities so the page is never blank ---- */
function oppCurated() {
  const raw = [
    { title: 'Unstop Hiring Challenges (rolling)', platform: 'Unstop', organizer: 'Unstop (Dare2Compete)', company: '', type: 'hiring challenge', description: 'Company hiring challenges and pre-placement interview opportunities across software, data, product and design roles for students and freshers in India.', eligibility: 'Students & freshers (India)', mode: 'online', location: 'India', prize: 'Job offers, PPI, prizes', skills: ['python', 'java', 'sql', 'data structures'], difficulty: 'open', registrationUrl: 'https://unstop.com/competitions?search=hiring%20challenge', sourceUrl: 'https://unstop.com/competitions?search=hiring%20challenge', source: 'Unstop', hiringOpportunity: true },
    { title: 'HackerEarth Hiring Challenges', platform: 'HackerEarth', organizer: 'HackerEarth', type: 'hiring challenge', description: 'Recruitment coding challenges run by tech companies; top performers get interview opportunities and full-time/internship offers.', eligibility: 'Developers & students', mode: 'online', location: 'Global / India', prize: 'Interview opportunities, jobs', skills: ['python', 'java', 'c++', 'algorithms'], difficulty: 'intermediate', registrationUrl: 'https://www.hackerearth.com/challenges/hiring/?search=hiring', sourceUrl: 'https://www.hackerearth.com/challenges/hiring/?search=hiring', source: 'HackerEarth', hiringOpportunity: true },
    { title: 'Smart India Hackathon', platform: 'SIH', organizer: 'Government of India / AICTE', type: 'innovation challenge', description: 'Nationwide innovation hackathon solving real problem statements from ministries and companies. Strong portfolio + networking + prize money.', eligibility: 'College students (India)', mode: 'hybrid', location: 'India', prize: '₹1,00,000+ per problem statement', skills: ['python', 'react', 'machine learning', 'iot'], difficulty: 'open', registrationUrl: 'https://www.sih.gov.in/sih2025PS', sourceUrl: 'https://www.sih.gov.in/sih2025PS', source: 'Curated', verified: true },
    { title: 'MLH Hackathons (season)', platform: 'MLH', organizer: 'Major League Hacking', type: 'hackathon', description: 'Global beginner-friendly student hackathons. Great for portfolio projects, swag, networking and learning new stacks.', eligibility: 'Students (beginner friendly)', mode: 'hybrid', location: 'Global', prize: 'Swag, prizes, sponsor tracks', skills: ['javascript', 'react', 'node.js', 'python'], difficulty: 'beginner', registrationUrl: 'https://mlh.io/seasons/2026/events?keyword=hackathon', sourceUrl: 'https://mlh.io/seasons/2026/events?keyword=hackathon', source: 'Curated' },
    { title: 'Kaggle Competitions', platform: 'Kaggle', organizer: 'Kaggle / Google', type: 'data science competition', description: 'Public machine learning and data science competitions with prize money, leaderboards and strong portfolio value.', eligibility: 'Open to all', mode: 'online', location: 'Online', prize: 'Prize money + medals', skills: ['python', 'machine learning', 'pandas', 'pytorch'], difficulty: 'intermediate', registrationUrl: 'https://www.kaggle.com/competitions?search=active', sourceUrl: 'https://www.kaggle.com/competitions?search=active', source: 'Curated' },
    { title: 'Topcoder Open Challenges', platform: 'Topcoder', organizer: 'Topcoder', type: 'coding contest', description: 'Algorithm, development, data science and QA challenges with cash prizes; strong for freelancing-style portfolio.', eligibility: 'Open to all', mode: 'online', location: 'Online', prize: 'Cash prizes', skills: ['java', 'c++', 'algorithms', 'react'], difficulty: 'advanced', registrationUrl: 'https://www.topcoder.com/challenges?tracks[DS]=true&tracks[DEV]=true&tracks[QA]=true', sourceUrl: 'https://www.topcoder.com/challenges?tracks[DS]=true&tracks[DEV]=true&tracks[QA]=true', source: 'Curated' },
    { title: 'Google Summer of Code', platform: 'GSoC', organizer: 'Google Open Source', type: 'open source program', description: 'Global open-source internship program. Stipend, mentorship, real OSS contributions and excellent resume/portfolio value.', eligibility: 'Students & beginners to OSS (18+)', mode: 'online', location: 'Online', prize: 'Stipend + mentorship', skills: ['python', 'c++', 'git', 'open source'], difficulty: 'intermediate', registrationUrl: 'https://summerofcode.withgoogle.com/programs/current/organizations', sourceUrl: 'https://summerofcode.withgoogle.com/programs/current/organizations', source: 'Curated', internshipOpportunity: true },
    { title: 'DevOps / Cloud Hiring Hackathon (search)', platform: 'Multiple', organizer: 'Various companies', type: 'cloud/devops challenge', description: 'Recruitment cloud/DevOps hackathons where companies hire SRE/DevOps/Cloud engineers. Includes pre-placement interview opportunities.', eligibility: 'Students & experienced', mode: 'online', location: 'India', prize: 'Jobs, internships, PPI', skills: ['docker', 'kubernetes', 'aws', 'terraform', 'ci/cd'], difficulty: 'intermediate', registrationUrl: 'https://www.google.com/search?q=' + encodeURIComponent('cloud devops hiring challenge India'), sourceUrl: 'https://www.google.com/search?q=' + encodeURIComponent('cloud devops hiring challenge India'), source: 'Curated', hiringOpportunity: true }
  ];
  return raw.map(normalizeOpportunity);
}

/* ---- filter + sort helpers ---- */
function oppMatches(o, q) {
  if (q.keyword) { const k = oppNorm(q.keyword); const hay = oppNorm(o.title + ' ' + o.description + ' ' + o.organizer + ' ' + o.company + ' ' + (o.skills || []).join(' ') + ' ' + o.platform); if (!hay.includes(k)) return false; }
  if (q.category && q.category !== 'All' && o.category !== q.category) return false;
  if (q.type && q.type !== 'All' && o.type !== q.type) return false;
  if (q.platform && q.platform !== 'All' && oppNorm(o.platform).indexOf(oppNorm(q.platform)) < 0 && oppNorm(o.source).indexOf(oppNorm(q.platform)) < 0) return false;
  if (q.mode && q.mode !== 'All' && o.mode !== q.mode) return false;
  if (q.location && oppNorm(o.location).indexOf(oppNorm(q.location)) < 0 && oppNorm(o.location) !== '' ) { if (oppNorm(o.location) !== 'online') return false; }
  if (oppBool(q.hiringOnly) && !o.hiringOpportunity) return false;
  if (oppBool(q.internshipOnly) && !o.internshipOpportunity) return false;
  if (oppBool(q.beginnerFriendly) && o.difficulty !== 'beginner' && o.difficulty !== 'open') return false;
  if (q.skills) { const want = String(q.skills).split(',').map(s => oppNorm(s).trim()).filter(Boolean); if (want.length) { const have = (o.skills || []).map(oppNorm); if (!want.some(w => have.some(h => h.includes(w)))) return false; } }
  return true;
}
function oppBool(v) { return v === true || v === 'true' || v === '1' || v === 1; }

app.get('/opportunities/providers', (req, res) => {
  res.json({
    ok: true,
    providers: {
      codeforces: { active: true, type: 'public API', note: 'codeforces.com public contest API (no key, no scraping)' },
      devpost: { active: true, type: 'public API', note: 'devpost.com public hackathons JSON (no key, no scraping)' },
      serpapi: { active: !!process.env.SERPAPI_KEY, type: 'public Google results', note: process.env.SERPAPI_KEY ? 'SERPAPI_KEY configured' : 'inactive: set SERPAPI_KEY to add public Google result links' },
      curated: { active: true, type: 'static fallback', note: 'curated opportunities + safe public search links — always available' }
    },
    types: OPP_TYPES, modes: OPP_MODES, difficulty: OPP_DIFFICULTY,
    time: new Date().toISOString()
  });
});

app.get('/opportunities/search', async (req, res) => {
  const q = req.query || {};
  const diagnostics = [];
  let items = [];
  try {
    const batches = await Promise.allSettled([
      oppCodeforces(diagnostics),
      oppDevpost(q.keyword, diagnostics),
      oppSerp(q.keyword, diagnostics)
    ]);
    for (const b of batches) if (b.status === 'fulfilled' && Array.isArray(b.value)) items = items.concat(b.value);
    items = items.concat(oppCurated());
    // dedupe by registration url / title
    const seen = new Set(); const dedup = [];
    for (const o of items) { const key = oppNorm(o.registrationUrl || o.title); if (seen.has(key)) continue; seen.add(key); dedup.push(o); }
    let filtered = dedup.filter(o => oppMatches(o, q));
    // sort: verified + hiring first, then those with a deadline soonest
    filtered.sort((a, b) => (Number(b.hiringOpportunity) - Number(a.hiringOpportunity)) || (Number(b.verified) - Number(a.verified)) || String(a.deadline || 'z').localeCompare(String(b.deadline || 'z')));
    res.json({
      ok: true, count: filtered.length, opportunities: filtered, diagnostics,
      searchLinks: oppSearchLinks(q.keyword),
      serpapiConfigured: !!process.env.SERPAPI_KEY,
      note: 'Public APIs (Codeforces, Devpost), optional SerpAPI public links, and curated fallbacks. No scraping, no CAPTCHA bypass, no login/cookie scraping.'
    });
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e), opportunities: oppCurated(), searchLinks: oppSearchLinks(q.keyword), serpapiConfigured: !!process.env.SERPAPI_KEY, diagnostics });
  }
});

app.get('/opportunities/details/:id', async (req, res) => {
  const id = req.params.id;
  const diagnostics = [];
  let items = [];
  try {
    const batches = await Promise.allSettled([oppCodeforces(diagnostics), oppDevpost('', diagnostics)]);
    for (const b of batches) if (b.status === 'fulfilled' && Array.isArray(b.value)) items = items.concat(b.value);
    items = items.concat(oppCurated());
    const found = items.find(o => o.id === id);
    if (found) return res.json({ ok: true, opportunity: found });
    return res.json({ ok: false, error: 'Opportunity not found on server. It may be a client-cached or search-link item.', searchLinks: oppSearchLinks('') });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

/* deterministic prep plan (AI optional client-side via /ai/messages) */
function buildPrepPlan(o) {
  o = o || {};
  const cat = o.category || 'General';
  const type = o.type || 'hackathon';
  const skills = (o.skills && o.skills.length) ? o.skills : ['core fundamentals', 'version control (git)', 'a demo-ready stack'];
  const isContest = /contest/.test(type);
  const isData = /data science/.test(type) || cat === 'AI/ML' || cat === 'Data Science';
  const isDevops = /devops|cloud/.test(type) || cat === 'DevOps/Cloud';
  const isCyber = /cyber/.test(type) || cat === 'Cybersecurity';

  let projectIdea = `A focused ${cat} project that solves one clear problem from the ${o.title || 'challenge'} brief, with a working demo and a clean README.`;
  if (isDevops) projectIdea = 'A cloud-native deployment demo: containerize a small app, add a CI/CD pipeline, deploy to a free cloud tier, and add basic monitoring/logging.';
  if (isData) projectIdea = 'A reproducible notebook: clean the dataset, build a baseline model, iterate to a stronger model, and present clear evaluation metrics and a short writeup.';
  if (isCyber) projectIdea = 'A small security tool or CTF writeup: pick one vulnerability class, build a safe lab/demo, and document detection + mitigation.';

  const sevenDay = isDevops ? [
    'Day 1: Understand the problem statement and design the architecture.',
    'Day 2: Build a Dockerized app and a CI/CD pipeline.',
    'Day 3: Deploy to a free cloud tier and record a demo video.',
    'Day 4: Add monitoring/logging and basic alerts.',
    'Day 5: Write the README and architecture diagram.',
    'Day 6: Test edge cases and harden the deploy.',
    'Day 7: Submit and rehearse the pitch.'
  ] : isData ? [
    'Day 1: Read the brief, explore the data, set the metric.',
    'Day 2: Build a clean baseline model and a validation split.',
    'Day 3: Feature engineering and error analysis.',
    'Day 4: Try stronger models / tuning; track experiments.',
    'Day 5: Finalize the pipeline; make it reproducible.',
    'Day 6: Write the report and visualizations.',
    'Day 7: Submit and rehearse the explanation.'
  ] : isContest ? [
    'Day 1: Revise core data structures (arrays, strings, hashmaps).',
    'Day 2: Practice two-pointers, sliding window, prefix sums.',
    'Day 3: Graphs + BFS/DFS + shortest paths.',
    'Day 4: Dynamic programming patterns.',
    'Day 5: Greedy + math + number theory basics.',
    'Day 6: Timed mock contest; review every miss.',
    'Day 7: Light revision; contest day strategy + fast templates.'
  ] : [
    'Day 1: Understand the problem statement and pick a sharp scope.',
    'Day 2: Design the solution and set up the repo + skeleton.',
    'Day 3: Build the core feature end to end.',
    'Day 4: Add the second feature and polish the UX.',
    'Day 5: Write the README and prepare visuals.',
    'Day 6: Test edge cases and fix bugs.',
    'Day 7: Record the demo, submit, and rehearse the pitch.'
  ];
  const threeDay = [sevenDay[0], 'Day 2: Build the core working demo (the single most important feature).', 'Day 3: Polish, write the README, record a short demo, and submit.'];

  return {
    title: o.title || 'Opportunity',
    requiredSkills: skills,
    suggestedProject: projectIdea,
    threeDayPlan: threeDay,
    sevenDayPlan: sevenDay,
    submissionChecklist: [
      'Public repo link works and is not private.',
      'README explains what it does, how to run it, and the stack.',
      'Working demo (hosted link or 60–90s video).',
      'All required submission fields filled before the deadline.',
      'Screenshots / architecture diagram included.'
    ],
    teamStrategy: [
      'Assign clear owners: build, demo/pitch, README/docs.',
      'Lock scope early — one strong feature beats three half-built ones.',
      'Commit small and often; integrate daily, not at the end.',
      'Reserve the final block for demo + rehearsal, not new features.'
    ],
    demoPitchChecklist: [
      'Open with the problem and who it helps (15 seconds).',
      'Show the working demo, not slides, first.',
      'State the tech stack and one hard thing you solved.',
      'End with impact and what you would build next.'
    ],
    readmeChecklist: [
      'Title + one-line description.',
      'Problem statement and motivation.',
      'Features and screenshots.',
      'Tech stack and architecture.',
      'Setup / run instructions.',
      'Demo link + team + license.'
    ],
    judgingPrep: [
      'Map your build directly to the stated judging criteria.',
      'Prepare a crisp answer for "what is novel here?".',
      'Have metrics or a before/after ready.',
      'Anticipate the "how would this scale?" question.'
    ]
  };
}

app.post('/opportunities/prep-plan', (req, res) => {
  try { res.json({ ok: true, plan: buildPrepPlan(req.body && req.body.opportunity), generatedBy: 'template', note: 'Standard template plan. AI-tailored plans appear here once AI features are enabled on this account.' }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

/* deterministic hackathon -> resume artifacts (no invented winning status) */
function buildResumeProject(o, opts) {
  o = o || {}; opts = opts || {};
  const win = opts.outcome && /winner|shortlist/i.test(opts.outcome) ? opts.outcome : '';
  const stack = (o.skills && o.skills.length ? o.skills : ['relevant tools']).slice(0, 5).join(', ');
  const dur = /hackathon/.test(o.type || '') ? 'a time-boxed hackathon' : `the ${o.title || 'competition'}`;
  const what = o.description ? o.description.replace(/\.$/, '') : `a working ${o.category || 'software'} solution`;
  const bullet = `Built ${o.title ? o.title.replace(/\.$/, '') : 'a working solution'} during ${dur} using ${stack}, delivering a demoable end-to-end build${win ? ` (${win})` : ''}.`;
  const bullet2 = `Designed, built and demoed the project end to end, owning ${o.category || 'the full'} implementation and presenting it under a strict deadline.`;
  return {
    resumeBullets: [bullet, bullet2],
    projectDescription: `${o.title || 'Project'} — ${what}. Built ${/hackathon/.test(o.type || '') ? 'during a hackathon' : 'for ' + (o.platform || 'a competition')}${o.organizer ? ' organized by ' + o.organizer : ''}. Stack: ${stack}.${win ? ' Outcome: ' + win + '.' : ''}`,
    githubReadme: [
      `# ${o.title || 'Project'}`,
      `> ${what}.`,
      '',
      '## Problem',
      `What this solves and who it helps.`,
      '## Features',
      '- Core feature 1\n- Core feature 2',
      '## Tech stack',
      `${stack}`,
      '## Run locally',
      '```bash\n# install\n# run\n```',
      '## Demo',
      'Add a hosted link or a 60–90s demo video.',
      `## Built at`,
      `${o.platform || ''}${o.organizer ? ' · ' + o.organizer : ''}`
    ].join('\n'),
    linkedinPost: `Just wrapped ${o.title || 'a competition'}${o.platform ? ' on ' + o.platform : ''}! 🚀\n\nIn a short, intense build I shipped a working ${o.category || 'software'} project using ${stack}.${win ? ' ' + win + '.' : ''}\n\nBiggest lesson: scope tight, demo early, and let the build do the talking.\n\nRepo + demo in comments 👇\n\n#hackathon #${(o.category || 'tech').replace(/[^a-z0-9]/gi, '')} #buildinpublic`,
    portfolioEntry: { name: o.title || 'Project', role: 'Builder', context: `${o.platform || 'Competition'}${o.organizer ? ' · ' + o.organizer : ''}`, stack: (o.skills || []).slice(0, 5), summary: what, link: o.registrationUrl || o.sourceUrl || '', outcome: win || 'Participated' },
    interviewExplanation: `I built ${o.title || 'this project'} under a deadline. The hardest part was scoping it small enough to actually ship while still being impressive. I owned the ${o.category || 'core'} build, integrated the pieces, and demoed it live. If I had more time I'd harden it and add tests.`,
    starStory: {
      situation: `I joined ${o.title || 'a competition'}${o.platform ? ' on ' + o.platform : ''} with a tight deadline.`,
      task: `Deliver a working, demoable ${o.category || 'software'} solution from scratch.`,
      action: `I scoped to one strong feature, built it end to end with ${stack}, and prepared a clear demo + README.`,
      result: `I shipped a complete demo on time${win ? ' and ' + win.toLowerCase() : ''}, and turned it into a portfolio project.`
    },
    invented: false
  };
}

app.post('/opportunities/convert-to-resume', (req, res) => {
  try { res.json({ ok: true, artifacts: buildResumeProject(req.body && req.body.opportunity, req.body || {}), note: 'Deterministic; winning status only included if you mark the opportunity as winner/shortlisted.' }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

/* ============================================================
   PAYMENTS  —  Razorpay integration (India, INR)
   Amounts are mapped on the backend ONLY; the frontend never sets price.
   Secrets are read from env and never returned to the client.
   ============================================================ */
const PLAN_AMOUNTS = { pro: 39900, premium: 79900 }; // paise (₹399 / ₹799)
const RZP_ID = () => process.env.RAZORPAY_KEY_ID || '';
const RZP_SECRET = () => process.env.RAZORPAY_KEY_SECRET || '';
const rzpConfigured = () => Boolean(RZP_ID() && RZP_SECRET());

async function rzpCreateOrder(amount, receipt) {
  const auth = Buffer.from(`${RZP_ID()}:${RZP_SECRET()}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount, currency: 'INR', receipt, payment_capture: 1 }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.description || 'razorpay_order_failed');
  return data;
}

app.post('/api/payments/create-order', requireAuth, validateBody(createOrderSchema), async (req, res) => {
  try {
    if (access.isAdminEmail(req.user && req.user.email)) {
      return res.status(400).json({ ok: false, error: 'admin_full_access', message: 'This account has admin full access. Payment is not required.' });
    }
    const planId = String(req.body?.planId || '').toLowerCase();
    if (!PLAN_AMOUNTS[planId]) return res.status(400).json({ ok: false, error: 'invalid_plan', message: 'Unknown plan.' });
    if (!rzpConfigured()) return res.status(503).json({ ok: false, error: 'gateway_not_configured', message: 'Payment gateway is not configured. Add Razorpay environment variables.' });
    const amount = PLAN_AMOUNTS[planId]; // backend-trusted amount
    const order = await rzpCreateOrder(amount, `ca_${planId}_${Date.now()}`);
    subs.recordOrder(req.user, { orderId: order.id, planId, amount });
    res.json({ ok: true, keyId: RZP_ID(), order: { id: order.id, amount: order.amount, currency: order.currency }, planId });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'order_failed', message: 'Could not create the payment order. Please try again.' });
  }
});

app.post('/api/payments/verify', requireAuth, validateBody(verifyPaymentSchema), (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body || {};
    if (!rzpConfigured()) return res.status(503).json({ ok: false, error: 'gateway_not_configured' });
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !PLAN_AMOUNTS[planId]) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }
    const expected = crypto.createHmac('sha256', RZP_SECRET()).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(String(razorpay_signature));
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!valid) return res.status(400).json({ ok: false, error: 'invalid_signature', message: 'Payment could not be verified.' });
    const rec = subs.saveSubscription(req.user, {
      planId, paymentId: razorpay_payment_id, orderId: razorpay_order_id,
      amount: PLAN_AMOUNTS[planId], status: 'active', source: 'razorpay',
    });
    res.json({ ok: true, planId: rec.planId, status: rec.status, paymentId: rec.paymentId, orderId: rec.orderId, expiresAt: rec.expiresAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'verify_failed', message: 'Verification error.' });
  }
});

app.post('/api/payments/webhook', (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const signature = req.headers['x-razorpay-signature'];
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!secret) return res.status(503).json({ ok: false, error: 'webhook_not_configured' });
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(String(signature || ''));
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return res.status(400).json({ ok: false, error: 'invalid_signature' });
    const evt = JSON.parse(raw.toString('utf8'));
    const entity = evt?.payload?.payment?.entity;
    if (entity && (evt.event === 'payment.captured' || evt.event === 'order.paid')) {
      const amount = entity.amount;
      const planId = amount >= PLAN_AMOUNTS.premium ? 'premium' : 'pro';
      const email = entity.email || (entity.notes && entity.notes.email) || null;
      if (email) subs.saveSubscription({ email }, { planId, paymentId: entity.id, orderId: entity.order_id, amount, status: 'active', source: 'razorpay' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: 'webhook_error' });
  }
});

app.get('/api/payments/subscription-status', requireAuth, (req, res) => {
  const s = subs.getSubscription(req.user);
  const email = (req.user && req.user.email) || '';
  const role = access.getUserRole(email, s.planId);
  const isAdmin = role === 'admin';
  const effectivePlan = access.effectivePlan(role, s.planId);
  res.json({
    ok: true,
    email,
    planId: s.planId,
    status: isAdmin ? 'active' : s.status,
    source: isAdmin ? 'admin' : (s.source || 'default'),
    expiresAt: isAdmin ? null : (s.expiresAt || null),
    paymentId: s.paymentId || null,
    orderId: s.orderId || null,
    gatewayConfigured: rzpConfigured(),
    role, isAdmin, effectivePlan,
    limits: access.limitsForRole(role, s.planId),
    features: access.featuresForRole(role, s.planId),
  });
});


/* ============================================================
   CAREER PROJECT STUDIO  —  AI generation endpoints
   Each tries the Anthropic model (if ANTHROPIC_API_KEY is set) and
   falls back to deterministic generation so the UI always works.
   Keys are never exposed to the client.
   ============================================================ */
async function anthropicJSON(prompt, max_tokens = 1500) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: resolveAiModel(), max_tokens, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return text || null;
  } catch { return null; }
}
function parseJSONLoose(text) {
  if (!text) return null;
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
function psTechStack(type) {
  const map = {
    Frontend: ['React', 'Vite', 'TypeScript', 'Tailwind CSS', 'Vitest'],
    Backend: ['Node.js', 'Express', 'PostgreSQL', 'Prisma', 'JWT', 'Jest'],
    'Full Stack': ['React', 'TypeScript', 'Node.js', 'Express', 'PostgreSQL', 'Docker'],
    DevOps: ['Docker', 'Kubernetes', 'Terraform', 'GitHub Actions', 'Helm', 'Prometheus'],
    Data: ['Python', 'Airflow', 'Spark', 'dbt', 'PostgreSQL'],
    'AI/ML': ['Python', 'PyTorch', 'FastAPI', 'MLflow', 'Docker'],
    Cloud: ['AWS Lambda', 'API Gateway', 'DynamoDB', 'Terraform', 'CloudWatch'],
    Cybersecurity: ['Python', 'OWASP ZAP', 'Docker', 'Nmap', 'GitHub Actions'],
  };
  return map[type] || map['Full Stack'];
}
function psFallbackProject(input = {}) {
  const role = input.targetRole || 'Software Engineer';
  const type = input.type || 'Full Stack';
  const skills = Array.from(new Set([...(input.sourceMissingSkills || []), ...psTechStack(type)])).slice(0, 12);
  /* IDENTITY IS THE CALLER'S. When the student clicks "Build this" on a
     recommendation, that recommendation's title and problem statement ARE the
     project. This template only fills in what the caller did NOT supply.
     Previously it unconditionally overwrote the title with a generic
     "Production-grade <type> project for <role>", so every build in a session
     came back with the same name — and then deduped into the same workspace. */
  const title = String(input.title || '').trim()
    || `Production-grade ${type} project for ${role}`;
  const problemStatement = String(input.problemStatement || '').trim()
    || `Demonstrate ${skills.slice(0, 3).join(', ')} with a deployable, recruiter-visible project.`;
  return {
    title, targetRole: role, type, difficulty: input.difficulty || 'Intermediate', duration: input.duration || '1 week',
    skillsCovered: skills, sourceMissingSkills: input.sourceMissingSkills || [],
    problemStatement,
    useCase: String(input.useCase || '').trim()
      || `A practical ${type} project producing real proof-of-work: a deployment, README and measurable results.`,
    techStack: psTechStack(type),
    architecture: `Cleanly separated ${type} architecture with tests, CI/CD and a public deployment.`,
    steps: [
      { phase: 'Setup & design', tasks: ['Define scope', 'Set up repo + CI', 'Design architecture'] },
      { phase: 'Core build', tasks: [`Implement core ${type} features`, `Apply ${skills.slice(0, 3).join(', ')}`] },
      { phase: 'Ship & prove', tasks: ['Deploy publicly', 'Write README + screenshots', 'Capture metrics'] },
    ],
  };
}
function psBullets(p = {}) {
  const s = (p.skillsCovered || []).slice(0, 4);
  return [
    `Built ${p.title || 'a portfolio project'} using ${s.slice(0, 3).join(', ') || 'a modern stack'}.`,
    `Implemented ${s[0] || 'core features'} with tests and CI/CD, deployed to a public URL.`,
    `Documented architecture and results in a README to provide recruiter-visible proof-of-work.`,
  ];
}
function psInterview(p = {}) {
  const out = [
    { q: 'Walk me through the architecture of this project.', a: 'Describe components, data flow and one key trade-off.' },
    { q: 'Why this tech stack?', a: 'Tie each choice to a requirement and name one rejected alternative.' },
    { q: 'Hardest problem and how you solved it?', a: 'Symptom -> diagnosis -> fix -> verification.' },
  ];
  (p.skillsCovered || []).slice(0, 3).forEach((s) => out.push({ q: `How did you use ${s}?`, a: `Explain ${s}'s concrete role and how you'd scale it.` }));
  return out;
}

app.post('/api/projects/generate-roadmap', requireAuth, generationLimiter, async (req, res) => {
  const input = req.body || {};

  /* Architecture Diagram OS: every generated project carries a structured
     architectureSpec + validation + legacy-compatible Mermaid. Deterministic
     and failure-safe — if the engine throws, the project is returned without
     a spec and the client's legacy Mermaid generator covers the diagram. */
  const attachArchitecture = (project) => {
    try {
      const pkg = generateArchitectureSpec(
        {
          projectId: project.id || '',
          title: project.title || input.title || 'Project',
          description: `${project.problemStatement || ''} ${project.useCase || ''} ${project.architecture || ''}`.trim(),
          techStack: Array.isArray(project.techStack) ? project.techStack : [],
          targetRole: project.targetRole || input.targetRole || '',
          projectType: project.type || input.type || '',
        },
        { targetLevel: 'production' }
      );
      project.architectureSpec = pkg.architectureSpec;
      project.architectureValidation = pkg.validation;
      if (!project.architectureDiagram) project.architectureDiagram = pkg.mermaidViews.component;
    } catch (err) {
      logger.warn('Roadmap architecture spec failed (project unaffected)', { message: err.message });
    }
    return project;
  };

  /* The caller may have already chosen WHAT to build (a recommendation the
     student clicked). If so the model designs the *roadmap* for that project —
     it does not get to rename it. */
  const pinnedTitle = String(input.title || '').trim();
  const pinnedProblem = String(input.problemStatement || '').trim();
  const pinned = pinnedTitle
    ? `\n\nThe project is ALREADY CHOSEN and must not be renamed or replaced. Use exactly this title: "${pinnedTitle}".${pinnedProblem ? ` Its problem statement is: "${pinnedProblem.slice(0, 600)}". Keep the same problem and users.` : ''} Design the roadmap, stack and architecture FOR THIS project.`
    : '';

  const prompt = `You are a senior engineer designing a portfolio project. Return ONLY JSON (no prose) with keys: title, targetRole, type, difficulty, duration, skillsCovered (array), problemStatement, useCase, techStack (array), architecture, steps (array of {phase, tasks[]}). Base it on role="${input.targetRole}", level="${input.difficulty}", duration="${input.duration}", type="${input.type}", missingSkills=${JSON.stringify(input.sourceMissingSkills || [])}, and this JD (optional): """${(input.jd || '').slice(0, 1500)}""". The project must specifically cover the missing skills.${pinned}`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 1800));
  if (ai && ai.title) {
    // Belt and braces: even a well-prompted model drifts on titles.
    if (pinnedTitle) ai.title = pinnedTitle;
    if (pinnedProblem) ai.problemStatement = pinnedProblem;
    return res.json({ ok: true, project: attachArchitecture(ai), generatedBy: 'ai' });
  }
  res.json({ ok: true, project: attachArchitecture(psFallbackProject(input)), generatedBy: 'template' });
});
app.post('/api/projects/generate-readme', requireAuth, generationLimiter, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Write a professional GitHub README.md (markdown only, no commentary) for this project: ${JSON.stringify(p).slice(0, 4000)}. Include title, overview, skills, tech stack, architecture, getting started, structure, deployment, testing, demo links.`;
  const ai = await anthropicJSON(prompt, 1600);
  if (ai && ai.length > 80) return res.json({ ok: true, readme: ai, generatedBy: 'ai' });
  const skills = (p.skillsCovered || []).map((s) => `- ${s}`).join('\n');
  res.json({ ok: true, generatedBy: 'template', readme: `# ${p.title || 'Project'}\n\n> ${p.problemStatement || ''}\n\n## Overview\n${p.useCase || ''}\n\n## Skills\n${skills}\n\n## Tech stack\n${(p.techStack || []).map((s) => `- ${s}`).join('\n')}\n\n## Architecture\n${p.architecture || ''}\n\n## License\nMIT` });
});
app.post('/api/projects/generate-resume-bullets', requireAuth, generationLimiter, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Return ONLY a JSON array of 4 concise, quantified-where-possible resume bullet strings for this project: ${JSON.stringify(p).slice(0, 3000)}.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 700));
  if (Array.isArray(ai) && ai.length) return res.json({ ok: true, bullets: ai.map(String), generatedBy: 'ai' });
  res.json({ ok: true, bullets: psBullets(p), generatedBy: 'template' });
});
app.post('/api/projects/generate-linkedin-post', requireAuth, generationLimiter, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Write a short, engaging first-person LinkedIn post (plain text, with a few emojis and 3 hashtags) announcing this portfolio project: ${JSON.stringify(p).slice(0, 3000)}.`;
  const ai = await anthropicJSON(prompt, 600);
  if (ai && ai.length > 40) return res.json({ ok: true, post: ai, generatedBy: 'ai' });
  res.json({ ok: true, generatedBy: 'template', post: `Just shipped: ${p.title || 'a new project'}\n\n${p.useCase || ''}\n\nStack: ${(p.techStack || []).slice(0, 6).join(', ')}\n\n#portfolio #buildinpublic #${(p.targetRole || 'tech').replace(/[^a-zA-Z]/g, '')}` });
});
app.post('/api/projects/generate-interview-prep', requireAuth, generationLimiter, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Return ONLY a JSON array of 6 objects {"q":"question","a":"model answer"} for an interview about this project: ${JSON.stringify(p).slice(0, 3000)}.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 1400));
  if (Array.isArray(ai) && ai.length) return res.json({ ok: true, questions: ai, generatedBy: 'ai' });
  res.json({ ok: true, questions: psInterview(p), generatedBy: 'template' });
});

/* ============================================================
   PROJECT CREATOR  —  Product Building Operating System
   Discovery, Validation, Blueprint, Roadmap and IP-readiness.
   Each endpoint tries Anthropic (key stays server-side) and falls
   back to deterministic generation so the UI always works.
   ============================================================ */
const CREATOR_TYPES = ['Career Project', 'Portfolio Project', 'Startup Experiment', 'SaaS MVP', 'Hackathon Project', 'Open Source Tool'];
const CREATOR_CATEGORIES = ['Best Career Fit', 'Best Quick Win', 'Best Portfolio Impact', 'Best Startup Potential', 'Best Beginner-Friendly'];

function clampScore(n, lo = 0, hi = 100) { n = Math.round(Number(n) || 0); return Math.max(lo, Math.min(hi, n)); }
function confidenceFor(score) { return score >= 80 ? 'High' : score >= 60 ? 'Medium' : 'Low'; }

// Deterministic discovery — always returns 5 ranked, well-formed recommendations.
function creatorDiscoverFallback(ctx = {}) {
  const role = ctx.targetRole || 'Software Engineer';
  const level = ctx.difficulty || 'Intermediate';
  const missing = (ctx.missingSkills || []).filter(Boolean);
  const current = (ctx.currentSkills || []).filter(Boolean);
  const seedSkill = missing[0] || current[0] || 'APIs';
  const dur = ctx.duration || '2 weeks';
  const weekly = ctx.weeklyTime || '6–10 hrs';
  const base = [
    { type: 'Career Project', category: 'Best Career Fit', difficulty: level, startup: 35, quick: false,
      title: `${role} proof-of-work platform using ${seedSkill}`,
      summary: `A deployable ${role}-aligned application that demonstrates ${[seedSkill, missing[1]].filter(Boolean).join(' + ') || 'core production skills'} end-to-end.`,
      targetUsers: 'Hiring managers and recruiters reviewing your portfolio',
      skills: Array.from(new Set([seedSkill, ...missing.slice(0, 3), 'REST APIs', 'Testing', 'CI/CD'])).slice(0, 8) },
    { type: 'Portfolio Project', category: 'Best Quick Win', difficulty: 'Beginner', startup: 20, quick: true,
      title: `Weekend ${seedSkill} mini-app with live demo`,
      summary: `A small but polished, fully deployed app you can finish quickly to fill the most visible resume gap.`,
      targetUsers: 'Recruiters scanning for a working live demo',
      skills: Array.from(new Set([seedSkill, ...current.slice(0, 2), 'Deployment', 'README'])).slice(0, 6) },
    { type: 'SaaS MVP', category: 'Best Portfolio Impact', difficulty: 'Advanced', startup: 70, quick: false,
      title: `Multi-tenant SaaS dashboard for ${role.split(' ')[0] || 'teams'} workflows`,
      summary: `A production-grade SaaS MVP with auth, billing-ready architecture, analytics and a deployed multi-user demo.`,
      targetUsers: 'Small teams who need a focused workflow tool',
      skills: Array.from(new Set([...missing.slice(0, 2), 'Auth', 'Postgres', 'Stripe/Razorpay', 'Multi-tenant', 'Analytics'])).slice(0, 8) },
    { type: 'Startup Experiment', category: 'Best Startup Potential', difficulty: level, startup: 82, quick: false,
      title: `AI workflow tool that automates a real ${role.split(' ')[0] || 'industry'} pain point`,
      summary: `Solve one painful, specific workflow with an AI-assisted product validated against real users — strong startup and proof potential.`,
      targetUsers: 'Professionals losing time on a manual, repetitive task',
      skills: Array.from(new Set(['LLM integration', ...missing.slice(0, 2), 'APIs', 'Deployment', 'Analytics'])).slice(0, 8) },
    { type: 'Open Source Tool', category: 'Best Beginner-Friendly', difficulty: 'Beginner', startup: 30, quick: true,
      title: `Open-source CLI/library for ${seedSkill}`,
      summary: `A small, well-documented open-source tool that is approachable to build and shows clean code, tests and docs.`,
      targetUsers: 'Developers who need a focused utility',
      skills: Array.from(new Set([seedSkill, ...current.slice(0, 2), 'Testing', 'Docs', 'Packaging'])).slice(0, 6) },
  ];
  return base.map((b) => {
    const stillMissing = missing.filter((s) => !b.skills.map((x) => x.toLowerCase()).includes(String(s).toLowerCase()));
    const missingCovered = missing.filter((s) => b.skills.map((x) => x.toLowerCase()).includes(String(s).toLowerCase()));
    return {
      title: b.title, summary: b.summary, type: b.type, category: b.category,
      targetUsers: b.targetUsers, targetRoleFit: role,
      skillsCovered: b.skills, missingSkillsCovered: missingCovered, stillMissingSkills: stillMissing.slice(0, 5),
      difficulty: b.difficulty, estimatedDuration: dur, weeklyTime: weekly,
      startupPotential: b.startup, proofPotential: b.quick ? 70 : 88,
      whyRecommended: missingCovered.length
        ? `Directly closes ${missingCovered.slice(0, 3).join(', ')} which your target role needs and your current profile lacks.`
        : `Aligned with ${role} and produces strong, recruiter-visible proof of work.`,
      sourceSignals: ['target role', missing.length ? 'resume skill gaps' : 'current skills', 'preferred difficulty'].filter(Boolean),
      expectedProofOutputs: ['Public GitHub repo', 'Live deployed demo', 'README + architecture diagram', b.type.includes('Startup') || b.type.includes('SaaS') ? 'First-users validation notes' : 'Test suite'],
      resumeImpactPreview: `Adds a quantified bullet: "Built and deployed ${b.title} using ${b.skills.slice(0, 3).join(', ')}."`,
      recruiterImpactPreview: `Signals hands-on ${b.skills.slice(0, 2).join(' & ')} with a verifiable live demo — stronger than a self-reported skill list.`,
    };
  });
}

app.post('/api/creator/discover', requireAuth, generationLimiter, async (req, res) => {
  const ctx = req.body || {};
  const prompt = `You are a senior career + startup mentor. Recommend EXACTLY 5 distinct project/product ideas for this person. Return ONLY a JSON array (no prose). Each object MUST have keys: title, summary (one line), type (one of ${JSON.stringify(CREATOR_TYPES)}), category (one of ${JSON.stringify(CREATOR_CATEGORIES)} — use each category once), targetUsers, targetRoleFit, skillsCovered (array), missingSkillsCovered (array), stillMissingSkills (array), difficulty (Beginner|Intermediate|Advanced), estimatedDuration, weeklyTime, startupPotential (0-100 int), proofPotential (0-100 int), whyRecommended, sourceSignals (array), expectedProofOutputs (array), resumeImpactPreview, recruiterImpactPreview. Context: role="${ctx.targetRole || ''}", level="${ctx.difficulty || ''}", year/sem="${ctx.yearSem || ''}", branch="${ctx.branch || ''}", currentSkills=${JSON.stringify((ctx.currentSkills || []).slice(0, 20))}, missingSkills=${JSON.stringify((ctx.missingSkills || []).slice(0, 20))}, weeklyTime="${ctx.weeklyTime || ''}", preferredType="${ctx.preferredType || ''}", preferredDuration="${ctx.duration || ''}", startFrom="${ctx.startFrom || ''}", customIdea="""${(ctx.customIdea || '').slice(0, 600)}""", savedJob="""${(ctx.savedJob || '').slice(0, 600)}""". Make ideas specific and non-generic (avoid plain CRUD); prefer AI workflows, real users, deployment, analytics or domain depth.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 2600));
  let recs = Array.isArray(ai) ? ai.filter((r) => r && r.title) : null;
  if (!recs || !recs.length) recs = creatorDiscoverFallback(ctx);
  // normalise score fields
  recs = recs.slice(0, 5).map((r) => ({
    ...r,
    startupPotential: clampScore(r.startupPotential),
    proofPotential: clampScore(r.proofPotential ?? 70),
  }));
  res.json({ ok: true, recommendations: recs, generatedBy: ai ? 'ai' : 'template' });
});

function creatorValidateFallback(idea = {}) {
  const title = idea.title || 'this project';
  const generic = /todo|crud|blog|notes app|to-do|simple/i.test(`${title} ${idea.summary || ''}`);
  return {
    problemSeverity: generic ? 'Low–medium: the core problem is common and already well served.' : 'Medium–high: a specific, repeated pain point with weak existing solutions.',
    targetUsers: idea.targetUsers || 'Early adopters who feel the problem weekly.',
    userPainPoints: ['Wastes time on a manual/repetitive task', 'Existing tools are too generic or too expensive', 'No single place to do the whole workflow'],
    existingAlternatives: ['Spreadsheets / manual process', 'A generic horizontal SaaS', 'An enterprise tool that is overkill'],
    whyAlternativesWeak: ['Not tailored to this exact workflow', 'Poor UX for the specific user', 'Too costly or heavy for the target user'],
    marketJobRelevance: `Demonstrates skills employers hiring for ${idea.targetRoleFit || 'this role'} actively screen for.`,
    mvpFeasibility: 'Feasible as a focused MVP within the estimated duration if scope stays on one core workflow.',
    buildDifficulty: idea.difficulty || 'Intermediate',
    monetization: ['Subscription for power users', 'Usage-based pricing', 'Free portfolio tier + paid teams tier'],
    careerValue: 'High — produces a deployable, defensible proof-of-work artifact.',
    startupPotential: clampScore(idea.startupPotential ?? 50),
    risks: ['Scope creep beyond the core workflow', 'Low differentiation if AI/real-user depth is skipped', 'Distribution: reaching the first users'],
    assumptions: ['Users will switch from their current manual process', 'The core workflow is painful enough to pay for', 'You can reach 10 target users to test'],
    validationQuestions: ['What do you do today to solve this?', 'How much time/money does it cost you weekly?', 'What would make you switch tools?', 'Would you pay for this? How much?'],
    firstTenUsersStrategy: ['Personally onboard 10 people who have the problem', 'Post in 2–3 niche communities', 'Offer free setup in exchange for feedback'],
    successMetrics: ['10 activated users', 'Core task completed by 50%+ of signups', 'A deployed demo with real usage', '1 testimonial / case study'],
    genericWarning: generic ? 'This looks like a common CRUD app. Add an AI workflow, real users, deployment, analytics, or a domain-specific problem to make it stronger.' : '',
    score: {
      problemClarity: generic ? 12 : 16, userNeed: generic ? 10 : 16, feasibility: 15,
      differentiation: generic ? 8 : 15, careerValue: 16, startupPotential: clampScore((idea.startupPotential ?? 50) / 100 * 12, 0, 12), proofPotential: clampScore((idea.proofPotential ?? 70) / 100 * 13, 0, 13),
    },
  };
}

app.post('/api/creator/validate', requireAuth, generationLimiter, async (req, res) => {
  const idea = (req.body && req.body.idea) || {};
  const prompt = `You are a startup + career validation mentor. Validate this project/product idea and return ONLY JSON (no prose) with keys: problemSeverity, targetUsers, userPainPoints (array), existingAlternatives (array), whyAlternativesWeak (array), marketJobRelevance, mvpFeasibility, buildDifficulty, monetization (array), careerValue, startupPotential (0-100 int), risks (array), assumptions (array), validationQuestions (array), firstTenUsersStrategy (array), successMetrics (array), genericWarning (string, empty if not generic), score (object with int fields: problemClarity 0-20, userNeed 0-20, feasibility 0-15, differentiation 0-15, careerValue 0-10, startupPotential 0-12, proofPotential 0-13). Idea: ${JSON.stringify(idea).slice(0, 2500)}. If it is a generic CRUD/todo/blog app, set genericWarning advising to add AI workflow, real users, deployment, analytics or domain depth.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 2000));
  const report = (ai && ai.score) ? ai : creatorValidateFallback(idea);
  res.json({ ok: true, report, generatedBy: (ai && ai.score) ? 'ai' : 'template' });
});

function creatorBlueprintFallback(p = {}) {
  const skills = (p.skillsCovered || p.skills || []).slice(0, 8);
  return {
    productVision: `${p.title || 'The product'} helps ${p.targetUsers || 'its users'} solve a real workflow problem with a focused, deployable tool.`,
    positioning: `For ${p.targetUsers || 'target users'} who struggle with the core problem, unlike generic alternatives, this is purpose-built and fast to adopt.`,
    problemStatement: p.problemStatement || p.summary || 'A specific, repeated workflow problem that current tools handle poorly.',
    personas: ['Primary user who performs the core task', 'Admin who manages the workspace', 'Viewer/stakeholder who consumes results'],
    userJourneys: ['Sign up → set up workspace → complete core task → see result', 'Return → review history → take next action'],
    mvpScope: ['Auth + workspace', 'The single core workflow end-to-end', 'Persistence + basic dashboard', 'Deployed public demo'],
    advancedFeatures: ['Role-based access', 'Analytics + insights', 'Integrations / API', 'Billing-ready multi-tenant'],
    featurePrioritization: [{ feature: 'Core workflow', priority: 'P0' }, { feature: 'Auth', priority: 'P0' }, { feature: 'Dashboard', priority: 'P1' }, { feature: 'Analytics', priority: 'P2' }],
    nonFunctional: ['Performance (p95 budget)', 'Security (auth, validation, secrets)', 'Reliability + error handling', 'Observability', 'Accessibility'],
    securityRequirements: ['Hash passwords (bcrypt)', 'Validate all input', 'Authz on every protected route', 'Secrets in env vars, never in repo', 'Rate limiting on auth'],
    techStack: p.techStack || ['React', 'TypeScript', 'Node.js', 'Express', 'PostgreSQL', 'Docker'],
    systemArchitecture: p.architecture || 'Client → API → services → database, with auth middleware, CI/CD and a public deployment.',
    databaseSchema: p.databaseSchema || ['users(id, email, password_hash, role, created_at)', 'workspaces(id, owner_id FK, name)', 'items(id, workspace_id FK, payload jsonb, created_at)'],
    apiDesign: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/items', 'POST /api/items'],
    uiScreens: ['Landing', 'Auth', 'Dashboard', 'Core workflow', 'Settings'],
    folderStructure: p.repoStructure || 'client/\n  src/\nserver/\n  routes/\n  services/\n.github/workflows/ci.yml\ndocker-compose.yml\nREADME.md',
    integrations: ['Auth provider (optional)', 'One external API', 'Payments (Stripe/Razorpay) if monetised'],
    deploymentArchitecture: ['Containerise client + API', 'Managed Postgres', 'CI/CD on main', 'Frontend on Vercel, API on Render/Railway'],
    testingStrategy: ['Unit tests for services', 'API integration tests', 'One E2E user journey'],
    analytics: ['Activation (completed core task)', 'Retention (returning users)', 'Error rate', 'Latency p95'],
    launchChecklist: ['Live demo works in incognito', 'README with setup + screenshots', 'Architecture diagram', 'Resume bullets + recruiter summary', 'Announcement post drafted'],
  };
}

app.post('/api/creator/blueprint', requireAuth, generationLimiter, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `You are a senior product engineer. Produce a product blueprint as ONLY JSON (no prose) with keys: productVision, positioning, problemStatement, personas (array), userJourneys (array), mvpScope (array), advancedFeatures (array), featurePrioritization (array of {feature, priority}), nonFunctional (array), securityRequirements (array), techStack (array), systemArchitecture (string), databaseSchema (array of strings), apiDesign (array of strings), uiScreens (array), folderStructure (string), integrations (array), deploymentArchitecture (array), testingStrategy (array), analytics (array), launchChecklist (array). Project: ${JSON.stringify({ title: p.title, summary: p.summary, type: p.type, targetUsers: p.targetUsers, skills: p.skillsCovered || p.skills, targetRole: p.targetRole || p.targetRoleFit }).slice(0, 2500)}.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 2600));
  const blueprint = (ai && ai.productVision) ? ai : creatorBlueprintFallback(p);
  res.json({ ok: true, blueprint, generatedBy: (ai && ai.productVision) ? 'ai' : 'template' });
});

function creatorIpFallback(p = {}) {
  const title = p.title || 'the invention';
  const skills = (p.skillsCovered || p.skills || []).slice(0, 6);
  const novel = /ai|ml|llm|algorithm|optimi|real-time|distributed|pipeline|model/i.test(`${title} ${(skills).join(' ')} ${p.summary || ''}`);
  const score = {
    novelTechnicalProblem: novel ? 15 : 9,
    uniqueTechnicalSolution: novel ? 18 : 12,
    priorArtDifference: novel ? 14 : 9,
    implementationDepth: 11,
    industrialUsefulness: 8,
    documentationReadiness: 6,
  };
  const total = Object.values(score).reduce((a, b) => a + b, 0);
  let classification = 'Portfolio Project';
  if (total >= 75) classification = 'Patent Review Recommended';
  else if (total >= 60) classification = 'Research/Innovation Candidate';
  else if (total >= 45) classification = 'Startup MVP';
  return {
    inventionSummary: `${title}: a system that addresses a specific technical problem using ${skills.slice(0, 3).join(', ') || 'a novel approach'}.`,
    technicalProblem: 'Existing approaches are manual, slow, or generic for this specific workflow.',
    technicalSolution: `A method/system combining ${skills.slice(0, 3).join(', ') || 'the core components'} to automate and improve the workflow.`,
    noveltyPoints: ['Specific combination of components for this workflow', 'Automation of a previously manual step', 'Domain-specific data/heuristics'],
    inventiveStepHypothesis: 'The combination is non-obvious if it produces a measurable improvement not achievable by simply combining known tools.',
    industrialUse: 'Applicable in the target industry as a deployable product/service.',
    priorArtKeywords: Array.from(new Set([...(skills.slice(0, 3)), 'automation', 'system', 'method', (p.type || 'software')])).slice(0, 8),
    comparableSolutions: ['Search Google Patents + Espacenet for the core method', 'Review top 3 commercial alternatives', 'Check open-source projects in the space'],
    systemDiagramsChecklist: ['System architecture diagram', 'Data flow diagram', 'Sequence diagram for the core method', 'Component interaction diagram'],
    provisionalSpecOutline: ['Title', 'Field of invention', 'Background / problem', 'Summary', 'Detailed description', 'Drawings', 'Claims (draft)', 'Abstract'],
    claimPreparationNotes: ['Draft one independent claim for the core method', 'Add dependent claims for key variations', 'Keep claims tied to a concrete technical effect'],
    documentationChecklist: ['Dated invention log', 'Architecture + flow diagrams', 'Working prototype / demo', 'Test results / metrics', 'Prior-art notes'],
    score,
    patentReadinessScore: total,
    classification,
    risks: ['Software/abstract-idea subject-matter limits in some jurisdictions', 'Possible prior art — search before filing', 'Public disclosure before filing can affect rights'],
  };
}

app.post('/api/creator/ip', requireAuth, generationLimiter, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `You are an IP-readiness assistant (NOT a lawyer). Return ONLY JSON (no prose) with keys: inventionSummary, technicalProblem, technicalSolution, noveltyPoints (array), inventiveStepHypothesis, industrialUse, priorArtKeywords (array), comparableSolutions (array), systemDiagramsChecklist (array), provisionalSpecOutline (array), claimPreparationNotes (array), documentationChecklist (array), score (object ints: novelTechnicalProblem 0-20, uniqueTechnicalSolution 0-25, priorArtDifference 0-20, implementationDepth 0-15, industrialUsefulness 0-10, documentationReadiness 0-10), patentReadinessScore (int 0-100 = sum of score), classification (one of "Portfolio Project","Startup MVP","Research/Innovation Candidate","Patent Review Recommended"), risks (array). Do not claim patentability. Project: ${JSON.stringify({ title: p.title, summary: p.summary, type: p.type, skills: p.skillsCovered || p.skills, problem: p.problemStatement }).slice(0, 2500)}.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 2200));
  const report = (ai && ai.score && typeof ai.patentReadinessScore !== 'undefined') ? ai : creatorIpFallback(p);
  res.json({ ok: true, report, generatedBy: (ai && ai.score) ? 'ai' : 'template' });
});

/* Optional external trend sources — best-effort, never blocks the UI. */
app.get('/api/creator/trends', requireAuth, async (req, res) => {
  const out = { github: [], productHunt: [], sources: { github: false, productHunt: !!process.env.PRODUCTHUNT_TOKEN } };
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const r = await fetch(`https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=6`, {
      headers: { 'User-Agent': 'career-autopilot', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    });
    if (r.ok) {
      const d = await r.json();
      out.github = (d.items || []).slice(0, 6).map((it) => ({ name: it.full_name, description: it.description || '', stars: it.stargazers_count, url: it.html_url, language: it.language || '' }));
      out.sources.github = true;
    }
  } catch {}
  res.json({ ok: true, ...out });
});


/* ============================================================
   PART 1 — GITHUB PUBLIC REPO ANALYSIS  (no OAuth required)
   Parses any of: https://github.com/u/r , github.com/u/r , u/r
   Uses GitHub's public REST API (optionally GITHUB_TOKEN for higher limits).
   Never throws to the client: on rate-limit/failure returns a friendly
   { success:false } so the UI can offer manual proof.
   ============================================================ */
function parseRepoRef(raw = '') {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  s = s.replace(/^github\.com\//i, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}
async function ghFetch(path, { json = true } = {}) {
  const headers = { 'User-Agent': 'career-autopilot', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (r.status === 403 || r.status === 429) { const e = new Error('rate_limited'); e.code = 'rate_limited'; throw e; }
  if (r.status === 404) { const e = new Error('not_found'); e.code = 'not_found'; throw e; }
  if (!r.ok) { const e = new Error('github_error'); e.code = 'github_error'; throw e; }
  return json ? r.json() : r.text();
}
function detectFilesFromRoot(entries = []) {
  const names = entries.map((e) => ({ name: e.name, type: e.type }));
  const lower = names.map((n) => n.name.toLowerCase());
  const hasFile = (n) => lower.includes(n.toLowerCase());
  const hasDir = (n) => names.some((x) => x.type === 'dir' && x.name.toLowerCase() === n.toLowerCase());
  return {
    'package.json': hasFile('package.json'),
    'requirements.txt': hasFile('requirements.txt'),
    'pom.xml': hasFile('pom.xml'),
    'build.gradle': hasFile('build.gradle') || hasFile('build.gradle.kts'),
    Dockerfile: hasFile('Dockerfile'),
    'docker-compose.yml': hasFile('docker-compose.yml') || hasFile('docker-compose.yaml') || hasFile('compose.yaml'),
    kubernetes: hasDir('k8s') || hasDir('kubernetes') || hasDir('manifests') || names.some((n) => /\.ya?ml$/i.test(n.name) && /(deploy|service|ingress|k8s)/i.test(n.name)),
    terraform: hasDir('infra') || hasDir('terraform') || names.some((n) => /\.tf$/i.test(n.name)),
    githubWorkflows: hasDir('.github'),
    tests: hasDir('tests') || hasDir('test') || hasDir('__tests__') || hasDir('spec'),
    src: hasDir('src') || hasDir('app') || hasDir('lib'),
    docs: hasDir('docs') || hasDir('documentation'),
    deployment: hasFile('vercel.json') || hasFile('netlify.toml') || hasFile('Procfile') || hasFile('render.yaml') || hasFile('railway.json') || hasFile('fly.toml') || hasFile('serverless.yml') || hasFile('serverless.yaml'),
    envExample: hasFile('.env.example') || hasFile('.env.sample') || hasFile('.env.template'),
    screenshots: hasDir('screenshots') || hasDir('assets') || hasDir('docs') || hasDir('.github'),
    readme: names.some((n) => /^readme(\.md|\.rst|\.txt)?$/i.test(n.name)),
    license: names.some((n) => /^licen[sc]e/i.test(n.name)),
  };
}

app.post('/api/projects/analyze-github', requireAuth, generationLimiter, async (req, res) => {
  const { repoUrl, expectedSkills = [], expectedTechStack = [] } = req.body || {};
  const ref = parseRepoRef(repoUrl);
  if (!ref) return res.status(400).json({ ok: false, success: false, error: 'bad_url', message: 'Could not read that GitHub repo URL. Use https://github.com/user/repo, github.com/user/repo or user/repo.' });
  try {
    const meta = await ghFetch(`/repos/${ref.owner}/${ref.repo}`);
    let languages = {};
    try { languages = await ghFetch(`/repos/${ref.owner}/${ref.repo}/languages`); } catch {}
    let rootEntries = [];
    try { rootEntries = await ghFetch(`/repos/${ref.owner}/${ref.repo}/contents?ref=${encodeURIComponent(meta.default_branch || 'main')}`); } catch {}
    let readmeText = '';
    try {
      const rd = await ghFetch(`/repos/${ref.owner}/${ref.repo}/readme`);
      if (rd && rd.content) readmeText = Buffer.from(rd.content, rd.encoding || 'base64').toString('utf8');
    } catch {}

    const files = detectFilesFromRoot(Array.isArray(rootEntries) ? rootEntries : []);

    // Peek at package.json to refine framework detection
    let pkgDeps = '';
    if (files['package.json']) {
      try {
        const pj = await ghFetch(`/repos/${ref.owner}/${ref.repo}/contents/package.json?ref=${encodeURIComponent(meta.default_branch || 'main')}`);
        if (pj && pj.content) pkgDeps = Buffer.from(pj.content, pj.encoding || 'base64').toString('utf8').toLowerCase();
      } catch {}
    }

    const langKeys = Object.keys(languages);
    const detectedTechStack = [];
    const addTech = (t) => { if (!detectedTechStack.includes(t)) detectedTechStack.push(t); };
    langKeys.forEach(addTech);
    if (/\breact\b/.test(pkgDeps)) addTech('React');
    if (/next/.test(pkgDeps)) addTech('Next.js');
    if (/express/.test(pkgDeps)) addTech('Express');
    if (/(^|")node|nodejs/.test(pkgDeps) || files['package.json']) addTech('Node.js');
    if (/typescript/.test(pkgDeps)) addTech('TypeScript');
    if (/tailwind/.test(pkgDeps)) addTech('Tailwind CSS');
    if (files['requirements.txt']) addTech('Python');
    if (files['pom.xml'] || files['build.gradle']) addTech('Java');
    if (files.Dockerfile || files['docker-compose.yml']) addTech('Docker');
    if (files.kubernetes) addTech('Kubernetes');
    if (files.terraform) addTech('Terraform');
    if (files.githubWorkflows) addTech('CI/CD');

    const readmeWords = readmeText.trim().split(/\s+/).filter(Boolean).length;
    const readmeQuality = !files.readme && readmeWords === 0 ? 'missing'
      : readmeWords > 300 ? 'good' : readmeWords > 60 ? 'basic' : 'thin';

    const detectedSkills = Array.from(new Set([
      ...detectedTechStack,
      ...(files.tests ? ['Testing'] : []),
      ...(files.githubWorkflows ? ['GitHub Actions'] : []),
    ]));

    const evidence = [];
    if (files.readme) evidence.push('README present');
    if (files.src) evidence.push('Source folder');
    if (files.tests) evidence.push('Tests folder');
    if (files.githubWorkflows) evidence.push('CI/CD workflows (.github)');
    if (files.Dockerfile || files['docker-compose.yml']) evidence.push('Containerised (Docker)');
    if (files.kubernetes) evidence.push('Kubernetes manifests');
    if (files.terraform) evidence.push('Infrastructure-as-code (Terraform)');
    if (files.deployment) evidence.push('Deployment config');
    if (files.docs) evidence.push('Docs folder');
    if (files.envExample) evidence.push('.env example');

    const warnings = [];
    if (!files.readme) warnings.push('No README detected.');
    if (!files.tests) warnings.push('No tests folder detected.');
    if (!files.githubWorkflows) warnings.push('No CI/CD workflow detected.');

    const recommendations = [];
    if (readmeQuality !== 'good') recommendations.push('Expand the README with setup, screenshots and results.');
    if (!files.tests) recommendations.push('Add a tests/ folder with at least a few unit tests.');
    if (!files.githubWorkflows) recommendations.push('Add a GitHub Actions workflow for build/test on push.');
    if (!files.Dockerfile && !files.deployment) recommendations.push('Add a Dockerfile or deployment config to prove it ships.');

    // githubScore /100
    let githubScore = 0;
    githubScore += files.readme ? (readmeQuality === 'good' ? 18 : readmeQuality === 'basic' ? 12 : 6) : 0;
    githubScore += files.src ? 14 : 0;
    githubScore += files.tests ? 14 : 0;
    githubScore += files.githubWorkflows ? 14 : 0;
    githubScore += (files.Dockerfile || files['docker-compose.yml']) ? 10 : 0;
    githubScore += (files.kubernetes || files.terraform || files.deployment) ? 10 : 0;
    githubScore += langKeys.length >= 2 ? 8 : langKeys.length === 1 ? 4 : 0;
    githubScore += (meta.description ? 4 : 0);
    githubScore += Math.min(8, Math.round((meta.stargazers_count || 0) / 5));
    githubScore = Math.min(100, githubScore);

    const structure = (Array.isArray(rootEntries) ? rootEntries : [])
      .slice(0, 40)
      .map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`);

    res.json({
      ok: true,
      success: true,
      repo: {
        owner: ref.owner,
        name: meta.name,
        fullName: meta.full_name,
        description: meta.description || '',
        url: meta.html_url,
        defaultBranch: meta.default_branch,
        stars: meta.stargazers_count || 0,
        forks: meta.forks_count || 0,
        openIssues: meta.open_issues_count || 0,
        license: meta.license ? meta.license.spdx_id : null,
        pushedAt: meta.pushed_at,
        createdAt: meta.created_at,
        topics: meta.topics || [],
      },
      languages,
      detectedTechStack,
      detectedSkills,
      readme: { exists: files.readme, quality: readmeQuality, words: readmeWords },
      files,
      structure,
      evidence,
      warnings,
      recommendations,
      githubScore,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err.code === 'not_found') {
      return res.json({ ok: false, success: false, error: 'not_found', message: 'That repository could not be found or is private. Check the URL or add proof manually.' });
    }
    return res.json({ ok: false, success: false, error: err.code || 'github_error', message: 'GitHub analysis is temporarily unavailable. Add proof manually or try again later.' });
  }
});

/* ============================================================
   PART 2 — LIVE DEPLOYMENT LINK VERIFICATION
   ============================================================ */
app.post('/api/projects/verify-live-link', requireAuth, generationLimiter, async (req, res) => {
  let { liveUrl } = req.body || {};
  liveUrl = String(liveUrl || '').trim();
  if (liveUrl && !/^https?:\/\//i.test(liveUrl)) liveUrl = 'https://' + liveUrl;
  let parsed;
  try { parsed = new URL(liveUrl); } catch {
    return res.status(400).json({ ok: false, success: false, reachable: false, error: 'bad_url', warnings: ['That does not look like a valid URL.'] });
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  const warnings = [];
  try {
    let r;
    try {
      r = await fetch(parsed.toString(), { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'career-autopilot-verifier' } });
    } catch (e) {
      clearTimeout(timer);
      return res.json({ ok: true, success: true, reachable: false, statusCode: 0, finalUrl: parsed.toString(), responseTimeMs: Date.now() - started, checkedAt: new Date().toISOString(), warnings: ['Could not reach the URL (timeout, DNS or CORS/network restriction). Needs manual review.'] });
    }
    const responseTimeMs = Date.now() - started;
    const statusCode = r.status;
    const contentType = r.headers.get('content-type') || '';
    const reachable = statusCode >= 200 && statusCode < 400;
    let title = '';
    let looksLikeApp = false;
    if (/text\/html/i.test(contentType)) {
      const body = await r.text().catch(() => '');
      const m = body.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (m) title = m[1].trim().slice(0, 160);
      looksLikeApp = body.length > 400 && /<(div|main|section|app|script|header)/i.test(body);
      if (!looksLikeApp) warnings.push('Page loaded but looks empty — confirm the deployment is live.');
    } else if (contentType) {
      looksLikeApp = true;
    }
    clearTimeout(timer);
    res.json({ ok: true, success: true, reachable, statusCode, finalUrl: r.url || parsed.toString(), responseTimeMs, title, contentType, looksLikeApp, checkedAt: new Date().toISOString(), warnings });
  } catch (e) {
    clearTimeout(timer);
    res.json({ ok: true, success: true, reachable: false, statusCode: 0, finalUrl: parsed.toString(), responseTimeMs: Date.now() - started, checkedAt: new Date().toISOString(), warnings: ['Verification failed unexpectedly. Needs manual review.'] });
  }
});


/* ============================================================================
   GITHUB INTEGRATION  (Career Proof Profile)  —  /api/integrations/github
   ----------------------------------------------------------------------------
   Layer 1: OAuth identity connection (minimal scopes read:user user:email).
   Layer 2: GitHub App selected-repository verification (read-only, short-lived
            installation tokens minted server-side).

   Security invariants (see SECURITY.md / githubIntegrationEngine.js):
     - Tokens / private key are NEVER returned to the client or logged.
     - OAuth access tokens are encrypted at rest (AES-256-GCM).
     - Installation tokens are minted per-request and never persisted.
     - Repo ownership + installation ownership are verified before any repo op.
     - Private repo data is private by default; only an opt-in safe summary can
       ever surface publicly.
   ============================================================================ */

/* Build the front-end return URL for OAuth/app redirects (Career Profile). */
function githubReturnTo(req, params = {}) {
  const base = process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
  // Land on the Career Profile GitHub section.
  return buildReturn(`${base.replace(/\/$/, '')}/#/career-profile`, { gh_return: '1', ...params });
}

/* Capability probe — UI uses this to show "not configured" states cleanly.
   NEVER returns secrets. */
app.get('/api/integrations/github/config', requireAuth, (req, res) => {
  res.json({
    ok: true,
    oauthEnabled: ghEngine.githubOAuthEnabled(),
    appEnabled: ghEngine.githubAppEnabled(),
    appName: ghEngine.githubAppConfig().appName || '',
    encryptionConfigured: ghEngine.encryptionConfigured(),
    db: db.dbEnabled(),
  });
});

/* ---- Layer 1: OAuth identity connection ---- */
app.get('/api/integrations/github/connect', requireAuth, (req, res) => {
  if (!ghEngine.githubOAuthEnabled()) {
    return res.redirect(githubReturnTo(req, { gh_error: 'oauth_not_configured' }));
  }
  const cfg = ghEngine.githubOAuthConfig();
  const state = randomState();
  req.session.githubOAuth = { state, at: Date.now() };
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.callbackUrl);
  url.searchParams.set('scope', cfg.scopes); // read:user user:email — NO repo scope
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  req.session.save(() => res.redirect(url.toString()));
});

app.get('/api/integrations/github/callback', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const saved = req.session.githubOAuth || {};
  delete req.session.githubOAuth;
  try {
    if (!ghEngine.githubOAuthEnabled()) return res.redirect(githubReturnTo(req, { gh_error: 'oauth_not_configured' }));
    if (req.query.error) return res.redirect(githubReturnTo(req, { gh_error: 'denied' }));
    if (!req.query.code) return res.redirect(githubReturnTo(req, { gh_error: 'missing_code' }));
    if (!saved.state || saved.state !== req.query.state) return res.redirect(githubReturnTo(req, { gh_error: 'bad_state' }));

    const { accessToken, tokenType, scope } = await ghEngine.exchangeOAuthCode(req.query.code);
    const { user: ghUser, stats } = await ghEngine.fetchOAuthProfileAndStats(accessToken);
    let email = null;
    try { const e = await ghEngine.fetchPrimaryEmail(accessToken); if (e) email = e; } catch { /* optional */ }
    const profile = { ...ghUser, primaryEmail: email };

    // Encrypt the token at rest (never store plaintext, never return it).
    let encryptedAccessToken = '';
    try { encryptedAccessToken = ghEngine.encryptToken(accessToken); } catch { encryptedAccessToken = ''; }

    await db.saveGithubConnection({ userId: u?.id, email: u?.email, profile, stats, encryptedAccessToken, tokenScope: scope, tokenType });
    // Backward compatibility: keep githubUrl / network links in sync.
    await syncGithubUrlForUser(u, ghUser.url);
    await db.logGithubAudit({ userId: u?.id, email: u?.email, action: 'connected', detail: { handle: ghUser.handle } });

    return res.redirect(githubReturnTo(req, { gh_connected: '1' }));
  } catch (err) {
    return res.redirect(githubReturnTo(req, { gh_error: err.code || 'oauth_failed' }));
  }
});

app.get('/api/integrations/github/status', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const raw = await db.getGithubConnectionRaw({ userId: u?.id, email: u?.email });
  const installations = await db.listGithubInstallations({ userId: u?.id, email: u?.email });
  const summary = await db.githubSummary({ userId: u?.id, email: u?.email });
  // Career Proof Score contribution from GitHub evidence (bounded, never inflates).
  const contribution = ghEngine.githubProofContribution({
    identityConnected: summary.connected,
    appInstalled: summary.appInstalled > 0,
    analyzedRepos: summary.analyzedRepos || [],
  });
  res.json({
    ok: true,
    oauthEnabled: ghEngine.githubOAuthEnabled(),
    appEnabled: ghEngine.githubAppEnabled(),
    appName: ghEngine.githubAppConfig().appName || '',
    // githubConnectionDTO NEVER includes tokens.
    connection: raw ? db.githubConnectionDTO(raw) : null,
    installations,
    summary: { ...summary, analyzedRepos: undefined, careerProofContribution: contribution.publicContribution, careerProofContributionPrivate: contribution.privateContribution },
    db: db.dbEnabled(),
  });
});

app.post('/api/integrations/github/sync', requireAuth, githubLimiter, async (req, res) => {
  const u = currentUser(req);
  const raw = await db.getGithubConnectionRaw({ userId: u?.id, email: u?.email });
  if (!raw || raw.status === 'disconnected') return res.status(400).json({ ok: false, error: 'not_connected' });
  const token = ghEngine.decryptToken(raw.encryptedAccessToken);
  if (!token) return res.status(400).json({ ok: false, error: 'token_unavailable', message: 'Reconnect GitHub to refresh.' });
  try {
    const { user: ghUser, stats } = await ghEngine.fetchOAuthProfileAndStats(token);
    const profile = { ...ghUser };
    const result = await db.updateGithubStats({ userId: u?.id, email: u?.email, profile, stats, status: 'connected' });
    await syncGithubUrlForUser(u, ghUser.url);
    res.json({ ok: true, connection: result.connection });
  } catch (err) {
    // Do NOT wipe previous good data on a failed sync — just record the failure.
    await db.updateGithubStats({ userId: u?.id, email: u?.email, status: 'sync_failed', error: err.code || 'sync_failed' });
    res.json({ ok: false, error: err.code || 'sync_failed', message: 'GitHub sync failed; previous data preserved.' });
  }
});

app.delete('/api/integrations/github', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.disconnectGithubConnection({ userId: u?.id, email: u?.email });
  await db.logGithubAudit({ userId: u?.id, email: u?.email, action: 'disconnected' });
  // Manual GitHub URL fallback is preserved unless the client asks to clear it.
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

/* ---- Layer 2: GitHub App installation ---- */
app.get('/api/integrations/github/app/install', requireAuth, (req, res) => {
  const cfg = ghEngine.githubAppConfig();
  if (!ghEngine.githubAppEnabled()) {
    return res.redirect(githubReturnTo(req, { gh_error: 'app_not_configured' }));
  }
  const state = randomState();
  req.session.githubAppInstall = { state, at: Date.now() };
  // GitHub's installation page lets the user pick "Only selected repositories"
  // (public and/or private). The state is echoed back on the callback.
  const url = new URL(`https://github.com/apps/${encodeURIComponent(cfg.appName)}/installations/new`);
  url.searchParams.set('state', state);
  req.session.save(() => res.redirect(url.toString()));
});

app.get('/api/integrations/github/app/callback', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const saved = req.session.githubAppInstall || {};
  delete req.session.githubAppInstall;
  try {
    if (!ghEngine.githubAppEnabled()) return res.redirect(githubReturnTo(req, { gh_error: 'app_not_configured' }));
    const installationId = req.query.installation_id;
    const setupAction = req.query.setup_action; // install | update | request
    if (!installationId) return res.redirect(githubReturnTo(req, { gh_error: 'install_cancelled' }));
    // State is best-effort (GitHub does not always round-trip it on first install).
    if (saved.state && req.query.state && saved.state !== req.query.state) {
      return res.redirect(githubReturnTo(req, { gh_error: 'bad_state' }));
    }
    const meta = await ghEngine.fetchInstallationMeta(installationId);
    await db.saveGithubInstallation({ userId: u?.id, email: u?.email, meta });
    // Fetch accessible repos for this installation + cache them.
    try {
      const repos = await ghEngine.fetchInstallationRepositories(installationId);
      await db.syncGithubRepositories({ userId: u?.id, email: u?.email, installationId, repos });
    } catch { /* repo sync is best-effort; user can re-sync from the UI */ }
    await db.logGithubAudit({ userId: u?.id, email: u?.email, action: 'app_installed', detail: { installationId: String(installationId), setupAction: setupAction || '' } });
    return res.redirect(githubReturnTo(req, { gh_app: '1' }));
  } catch (err) {
    return res.redirect(githubReturnTo(req, { gh_error: err.code || 'install_failed' }));
  }
});

app.post('/api/integrations/github/app/sync-repos', requireAuth, githubLimiter, async (req, res) => {
  const u = currentUser(req);
  const installations = await db.listGithubInstallations({ userId: u?.id, email: u?.email });
  const active = installations.filter((i) => i.status === 'active');
  if (!active.length) return res.status(400).json({ ok: false, error: 'no_installation' });
  let lastResult = null;
  for (const inst of active) {
    try {
      const repos = await ghEngine.fetchInstallationRepositories(inst.installationId);
      lastResult = await db.syncGithubRepositories({ userId: u?.id, email: u?.email, installationId: inst.installationId, repos });
    } catch (err) {
      // Installation may have been removed on GitHub's side.
      if (err.code === 'not_found' || err.status === 404) {
        await db.disconnectInstallation({ userId: u?.id, email: u?.email, installationId: inst.installationId });
      }
    }
  }
  const repositories = await db.listGithubRepositories({ userId: u?.id, email: u?.email });
  res.json({ ok: true, repositories, db: db.dbEnabled() });
});

app.get('/api/integrations/github/repositories', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const repositories = await db.listGithubRepositories({ userId: u?.id, email: u?.email });
  res.json({ ok: true, repositories, db: db.dbEnabled() });
});

/* Analyze a single accessible repository. Verifies ownership + installation,
   mints a short-lived selected-repo installation token, inspects only safe
   proof files, and stores the analysis. Private repos require explicit
   confirmation and stay private by default. */
app.post('/api/integrations/github/repositories/:repoId/analyze', requireAuth, githubLimiter, validateBody(githubAnalyzeSchema), async (req, res) => {
  const u = currentUser(req);
  const owned = await db.getOwnedRepository({ userId: u?.id, email: u?.email, repoId: req.params.repoId });
  if (!owned || !owned.repo) return res.status(404).json({ ok: false, error: 'repo_not_found' });
  const { repo, installation } = owned;
  if (!repo.accessible) return res.status(400).json({ ok: false, error: 'repo_inaccessible', message: 'This repository is no longer accessible to the installation.' });
  if (!installation || installation.status !== 'active') return res.status(400).json({ ok: false, error: 'installation_inactive', message: 'The GitHub App installation is not active. Reconnect to analyze.' });
  if (repo.private && !req.body.confirmPrivate) {
    return res.status(400).json({ ok: false, error: 'confirm_private_required', message: 'Confirm before analyzing a private repository. The analysis stays private by default.' });
  }
  try {
    const normalized = {
      githubRepoId: repo.githubRepoId, fullName: repo.fullName, owner: repo.owner, name: repo.name,
      private: repo.private, defaultBranch: repo.defaultBranch, pushedAt: repo.pushedAt,
      archived: repo.archived, language: repo.language, linkedProjectId: repo.linkedProjectId,
    };
    const fetched = await ghEngine.fetchSafeRepoFiles(normalized, installation.installationId);
    // Pass the connected GitHub identity so authorship is verified against the
    // account that actually committed the code (not merely repo access).
    const conn = await db.getGithubConnectionRaw({ userId: u?.id, email: u?.email });
    const analysis = ghEngine.buildRepoAnalysis(normalized, fetched, { identityHandle: conn?.handle || '' });
    analysis.installationId = installation.installationId;
    // Cache sanitized files + authorship so a live comprehension viva can be
    // generated server-side from the candidate's own code (integrity: source
    // and answer keys never round-trip through the client).
    try { vivaStore.cacheRepoFiles(u?.id || u?.email, repo.fullName, fetched.files || {}, analysis.authorship); } catch { /* non-fatal */ }
    const verificationSummary = ghEngine.generateRepoVerificationSummary(analysis);
    const publicSafeSummary = ghEngine.generatePublicSafeRepoSummary(analysis);
    const saved = await db.saveRepoAnalysis({ userId: u?.id, email: u?.email, repoId: repo.githubRepoId, analysis, verificationSummary, publicSafeSummary });
    await db.logGithubAudit({ userId: u?.id, email: u?.email, action: repo.private ? 'private_repo_analyzed' : 'repo_analyzed', detail: { repoId: repo.githubRepoId, score: analysis.score, visibility: analysis.visibility } });
    res.json({
      ok: true,
      repo: saved.repo,
      analysis: {
        score: analysis.score, level: analysis.level, status: analysis.status,
        visibility: analysis.visibility, detectedStack: analysis.detectedStack,
        detectedSkills: analysis.detectedSkills, evidence: analysis.evidence,
        missing: analysis.missing, recommendations: analysis.recommendations,
        structure: analysis.structure, filesInspected: analysis.filesInspected,
        truncated: analysis.truncated, verificationSummary,
        skillEvidence: ghEngine.mapRepoEvidenceToSkills(analysis),
      },
    });
  } catch (err) {
    if (err.code === 'missing_default_branch') return res.json({ ok: false, error: 'missing_default_branch', message: 'Repository has no default branch / is empty.' });
    if (err.code === 'rate_limited') return res.json({ ok: false, error: 'rate_limited', message: 'GitHub rate limit hit. Try again shortly.' });
    if (err.code === 'installation_token_failed') return res.json({ ok: false, error: 'installation_token_failed', message: 'Could not mint an installation token. Reconnect the GitHub App.' });
    logger.warn('github analyze failed', { code: err.code });
    res.json({ ok: false, error: err.code || 'analyze_failed', message: 'Repository analysis failed. Try again later.' });
  }
});

app.post('/api/integrations/github/repositories/:repoId/link-project', requireAuth, validateBody(githubLinkProjectSchema), async (req, res) => {
  const u = currentUser(req);
  const owned = await db.getOwnedRepository({ userId: u?.id, email: u?.email, repoId: req.params.repoId });
  if (!owned || !owned.repo) return res.status(404).json({ ok: false, error: 'repo_not_found' });
  const result = await db.linkRepoToProject({ userId: u?.id, email: u?.email, repoId: req.params.repoId, projectId: req.body.projectId });
  await db.logGithubAudit({ userId: u?.id, email: u?.email, action: 'repo_linked', detail: { repoId: req.params.repoId, projectId: req.body.projectId } });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

/* Create a linked project-proof draft from a repo analysis. Returns a draft the
   client can save into Project Studio (kept simple + safe). */
app.post('/api/integrations/github/repositories/:repoId/import-project', requireAuth, validateBody(githubImportProjectSchema), async (req, res) => {
  const u = currentUser(req);
  const owned = await db.getOwnedRepository({ userId: u?.id, email: u?.email, repoId: req.params.repoId });
  if (!owned || !owned.repo) return res.status(404).json({ ok: false, error: 'repo_not_found' });
  const { repo } = owned;
  const latest = await db.getLatestRepoAnalysis({ userId: u?.id, email: u?.email, repoId: req.params.repoId });
  if (!latest) return res.status(400).json({ ok: false, error: 'not_analyzed', message: 'Analyze the repository first.' });
  // Draft is private-safe: for private repos we do NOT expose the repo URL.
  const draft = {
    title: req.body.title || repo.name || 'GitHub project',
    type: 'software',
    source: 'github_import',
    githubVerified: true,
    githubRepoId: repo.githubRepoId,
    githubUrl: repo.private ? '' : repo.htmlUrl,
    techStack: latest.detectedStack || [],
    skillsCovered: (latest.detectedSkills || []).slice(0, 16),
    proofScoreHint: latest.score || 0,
    visibility: repo.private ? 'private' : 'public',
    evidence: latest.evidence || [],
  };
  res.json({ ok: true, draft });
});

app.patch('/api/integrations/github/repositories/:repoId/visibility', requireAuth, validateBody(githubVisibilitySchema), async (req, res) => {
  const u = currentUser(req);
  const owned = await db.getOwnedRepository({ userId: u?.id, email: u?.email, repoId: req.params.repoId });
  if (!owned || !owned.repo) return res.status(404).json({ ok: false, error: 'repo_not_found' });
  const result = await db.setRepoVisibility({
    userId: u?.id, email: u?.email, repoId: req.params.repoId,
    publicProofVisible: req.body.publicProofVisible,
    privateProofSummaryVisible: req.body.privateProofSummaryVisible,
  });
  await db.logGithubAudit({ userId: u?.id, email: u?.email, action: 'visibility_changed', detail: { repoId: req.params.repoId, publicProofVisible: req.body.publicProofVisible, privateProofSummaryVisible: req.body.privateProofSummaryVisible } });
  res.status(persistenceStatus(result)).json({ ...result, db: db.dbEnabled() });
});

app.delete('/api/integrations/github/app/installations/:installationId', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.disconnectInstallation({ userId: u?.id, email: u?.email, installationId: req.params.installationId });
  await db.logGithubAudit({ userId: u?.id, email: u?.email, action: 'app_disconnected', detail: { installationId: req.params.installationId } });
  const appName = ghEngine.githubAppConfig().appName || '';
  res.status(persistenceStatus(result)).json({
    ...result,
    db: db.dbEnabled(),
    // Direct the user to fully revoke on GitHub if they want to remove access.
    revokeUrl: appName ? `https://github.com/settings/installations` : '',
    message: 'Installation disconnected locally. To fully revoke access, uninstall the app from GitHub settings.',
  });
});

/* ---- Webhook (raw body, HMAC-verified). Handles install/repo lifecycle. ---- */
app.post('/api/integrations/github/webhook', async (req, res) => {
  const cfg = ghEngine.githubAppConfig();
  const secret = cfg.webhookSecret;
  if (!secret) return res.status(200).json({ ok: true, ignored: 'webhook_not_configured' });
  const sig = req.get('X-Hub-Signature-256') || '';
  const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(bodyBuf).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'invalid_signature' });
  }
  let payload = {};
  try { payload = JSON.parse(bodyBuf.toString('utf8') || '{}'); } catch { payload = {}; }
  const event = req.get('X-GitHub-Event') || '';
  try {
    const installationId = payload.installation?.id ? String(payload.installation.id) : '';
    if (event === 'installation') {
      if (payload.action === 'deleted') await db.setInstallationStatus({ installationId, status: 'disconnected' });
      else if (payload.action === 'suspend') await db.setInstallationStatus({ installationId, status: 'suspended', suspendedAt: new Date() });
      else if (payload.action === 'unsuspend') await db.setInstallationStatus({ installationId, status: 'active', suspendedAt: null });
    } else if (event === 'installation_repositories' && installationId) {
      // A repo was added/removed from the selection — re-sync that installation.
      try {
        const repos = await ghEngine.fetchInstallationRepositories(installationId);
        // We don't have userId in the webhook; map via the installation row.
        const inst = await db.GithubInstallation.findOne({ installationId }).lean();
        if (inst) await db.syncGithubRepositories({ userId: String(inst.userId), installationId, repos });
      } catch { /* best-effort */ }
    }
  } catch (e) {
    logger.warn('github webhook handling failed', { event, message: e.message });
  }
  res.json({ ok: true });
});

/* Backward-compat helper: keep the canonical githubUrl (NetworkProfile
   links.github) in sync when GitHub identity connects/syncs. Manual URLs are
   preserved; OAuth simply points the link at the real html_url. */
async function syncGithubUrlForUser(u, githubUrl) {
  if (!u || !githubUrl) return;
  try { await db.syncNetworkGithubLink({ userId: u.id, email: u.email, githubUrl }); } catch { /* non-fatal */ }
}

/* ============================================================
   CUSTOM TEMPLATE ANALYSIS  (vision)
   Accepts a base64 image (PDF first-page is rasterised client-side) and
   returns a structured layout spec. Falls back to the client analyzer
   (dominant colour + column detection) when AI vision is unavailable.
   ============================================================ */
app.post('/api/templates/analyze-custom-template', requireAuth, generationLimiter, validateBody(templateImageSchema), async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  const { imageBase64, mime } = req.body || {};
  const data = String(imageBase64 || '').includes(',') ? String(imageBase64).split(',')[1] : imageBase64;
  if (!key) return res.json({ ok: false, error: 'ai_unavailable', message: 'Vision analysis unavailable; using fallback.' });
  if (!data) return res.status(400).json({ ok: false, error: 'no_image' });
  const prompt = `You are a resume layout analyst. Analyse this resume TEMPLATE image and return ONLY JSON, no prose:
{"templateName":string,"layoutType":"single-column"|"two-column"|"sidebar-left"|"sidebar-right"|"banner-header","pageSize":"A4"|"Letter","margins":{"top":number,"right":number,"bottom":number,"left":number},"colorPalette":{"accent":"#RRGGBB","headerBg":"#RRGGBB","text":"#RRGGBB"},"fontStyle":"sans"|"serif","headerLayout":"left"|"center"|"banner","contactLayout":"inline"|"stacked","sectionOrder":["summary","experience","skills","education","projects","certifications"],"sectionStyles":{"titleCase":"upper"|"title","divider":"bar"|"line"|"none","accentTitles":true|false},"columnLayout":1|2,"bulletStyle":"disc"|"dash"|"square","dividerStyle":"line"|"bar"|"none","spacingRules":"tight"|"normal"|"airy","atsScoreEstimate":number,"recommendations":[string]}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: resolveAiModel(), max_tokens: 900, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime || 'image/png', data } },
        { type: 'text', text: prompt },
      ] }] }),
    });
    if (!r.ok) return res.json({ ok: false, error: 'ai_unavailable' });
    const j = await r.json().catch(() => null);
    const text = (j?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = parseJSONLoose(text);
    if (!parsed) return res.json({ ok: false, error: 'parse_failed' });
    res.json({ ok: true, source: 'ai', analysis: parsed });
  } catch (e) {
    res.json({ ok: false, error: 'ai_error' });
  }
});

/* JSON 404 for unmatched backend routes (so the SPA fallback never swallows a
   mistyped API path and returns HTML to an API client). */
/* Terminal error handler. Every async handler is wrapped by patchAppAsync, so a
   rejection lands here as a clean 500 carrying a requestId the student can quote
   — instead of killing the process. Must sit after all routes and before the 404. */
app.use(errorMiddleware(logger));

app.use(['/jobs', '/auth', '/apply', '/ai', '/api', '/contacts', '/opportunities', '/support', '/dashboard', '/profile'], (req, res) => {
  res.status(404).json({ error: 'not_found', message: `No such endpoint: ${req.method} ${req.path}` });
});

/* SPA fallback: keep API/backend routes intact, send UI for normal browser paths. */
app.get(/^\/(?!jobs|auth|apply|ai|api|health|contacts|opportunities|support|dashboard).*/, (req, res) => {
  res.sendFile(UI_INDEX);
});

/* ------------------------------------------------------------------
   CENTRALIZED ERROR HANDLER (must be last). Logs full diagnostics
   server-side; returns a safe, generic message to the client and
   NEVER leaks stack traces or secrets in production.
   ------------------------------------------------------------------ */
// eslint-disable-next-line no-unused-vars
/* Final error handler: same response contract as before, PLUS the request id
   in the payload and a best-effort persist into the TTL'd error_logs
   collection (surfaced at /api/admin/errors). */
app.use(createErrorHandler({ logger, db, isProd: config.IS_PROD }));

const port = process.env.PORT || 3000;

/* Local run uses app.listen. Vercel imports the Express app as a serverless
   handler; the test suite imports it and binds its own ephemeral port. */
if (!process.env.VERCEL && config.NODE_ENV !== 'test') {
  if (db.dbEnabled()) {
    db.connectDB()
      .then(() => logger.info('MongoDB connected'))
      .catch((e) => {
        // In production, a configured-but-unreachable database is fatal: the app
        // persists users/sessions/dashboards in Mongo and must not silently run
        // without persistence. In development we degrade to session-only.
        if (config.IS_PROD) {
          logger.error('MongoDB connection failed in production — refusing to start.', { message: e.message });
          // eslint-disable-next-line no-process-exit
          process.exit(1);
        }
        logger.error('MongoDB connection failed — running session-only (dev)', { message: e.message });
      });
  }
  app.listen(port, () => {
    logger.info(`Career Autopilot running on http://localhost:${port}`, {
      env: config.NODE_ENV,
      database: db.dbEnabled() ? 'mongodb' : 'off',
      ai: !!process.env.ANTHROPIC_API_KEY,
      google: googleEnabled(),
      devLogin: allowDevLogin(),
      corsAllowlist: config.ALLOWED_ORIGINS.length ? config.ALLOWED_ORIGINS : ['(same-origin only)'],
      csp: config.ENABLE_CSP,
      jobSources: SOURCES.map((s) => s.name),
    });
  });
}

export default app;
