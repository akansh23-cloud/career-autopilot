import express from 'express';
import cors from 'cors';
import session from 'express-session';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as db from './db.js';
import * as subs from './paymentsStore.js';
import * as access from './access.js';
import { FAQS, QUICK_ACTIONS, matchFaq } from './support-kb.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1); // honor X-Forwarded-Proto (Vercel/Render/etc.) so Secure cookies work

/* Cross-site cookies (SameSite=None; Secure) are needed ONLY when the frontend is
   served from a DIFFERENT origin than this backend, over HTTPS. For the normal setup
   (this server serves index.html → same origin) 'lax' is correct and works on plain http.
   Set COOKIE_CROSS_SITE=1 (HTTPS only) if you host the UI on a separate domain. */
const CROSS_SITE = process.env.COOKIE_CROSS_SITE === '1' || String(process.env.COOKIE_SAMESITE).toLowerCase() === 'none';
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || (CROSS_SITE ? 'none' : 'lax')).toLowerCase();
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' || CROSS_SITE || process.env.NODE_ENV === 'production';

app.use('/api/payments/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '12mb' }));
/* Reflect the caller's origin and allow credentials so the OAuth status fetch works
   whether the app is opened same-origin or from a configured frontend origin. */
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  name: 'career_autopilot.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: COOKIE_SAMESITE, secure: COOKIE_SECURE }
}));

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

const JOB_FETCH_TIMEOUT  = Number(process.env.JOB_FETCH_TIMEOUT  || 12000);
const JOB_VERIFY_TIMEOUT = Number(process.env.JOB_VERIFY_TIMEOUT || 9000);
const STRICT_JOB_VERIFICATION = process.env.STRICT_JOB_VERIFICATION === '1';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || process.env.X_RAPIDAPI_KEY || process.env.RAPID_API_KEY || '';
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'jsearch.p.rapidapi.com';

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
function maxFreshDaysFromQuery(v) { return v === '24h' ? 1 : v === '3d' ? 3 : 7; }

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
   GET /jobs/search  — fetch -> normalise -> freshness gate ->
   filter -> de-dupe -> verify URLs -> return only verified jobs
   query: role, location, mode, freshness(24h|3d|7d), limit, verify(0|1)
   ============================================================ */
app.get('/jobs/search', async (req, res) => {
  try {
    const role = req.query.role || 'software engineer';
    const loc = req.query.location || '';
    const mode = req.query.mode || 'Any';
    const maxDays = maxFreshDaysFromQuery(req.query.freshness || '7d');
    const limit = Math.max(1, Math.min(40, Number(req.query.limit || 12)));
    const verify = req.query.verify !== '0';
    const strict = req.query.strict != null
      ? (req.query.strict === '1' || req.query.strict === 'true')
      : STRICT_JOB_VERIFICATION;
    const selected = requestedSources(req);
    const ctx = { role, location: loc, mode, freshness: req.query.freshness || '7d', selectedSources: selected, strict, diag: {} };

    const runnable = SOURCES.filter(s => !selected || sourceAllowed(s.name, selected) || ['SerpAPI','JSearch'].includes(s.name));
    const settled = await Promise.allSettled(runnable.map(s => s.fetch(role, ctx)));
    const configured = configuredSources();
    const sources = configured.map(x => ({ source: x.source, ok: false, count: 0, active: x.active, integration: x.integration, reason: x.reason || '' }));
    const sourceIndex = new Map(sources.map((s, i) => [sourceKey(s.source), i]));
    let jobs = [];
    runnable.forEach((src, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled') {
        const arr = (r.value || []).map(j => ({ ...j, source: inferSource(j, src.name) }));
        jobs.push(...arr);
        const grouped = new Map();
        arr.forEach(j => grouped.set(j.source, (grouped.get(j.source) || 0) + 1));
        for (const [name, count] of grouped) {
          const ix = sourceIndex.get(sourceKey(name));
          if (ix != null) { sources[ix].ok = true; sources[ix].active = true; sources[ix].count += count; sources[ix].reason = ''; }
          else sources.push({ source: name, ok: true, active: true, count, integration: src.name, reason: '' });
        }
        const pix = sourceIndex.get(sourceKey(src.name));
        if (pix != null && !grouped.size) { sources[pix].ok = true; sources[pix].active = true; }
      } else {
        const ix = sourceIndex.get(sourceKey(src.name));
        if (ix != null) { sources[ix].ok = false; sources[ix].active = true; sources[ix].error = r.reason?.message || String(r.reason); }
        else sources.push({ source: src.name, ok: false, active: true, count: 0, error: r.reason?.message || String(r.reason) });
      }
    });
    if (selected) jobs = jobs.filter(j => sourceAllowed(j.source, selected));

    const audit = [];
    const seen = new Set();
    let candidates = [];
    for (const j of jobs) {
      j.source = inferSource(j, j.source || sourceFromUrl(j.url));
      let reason = '';
      if (!j.title || !j.company) reason = 'missing title/company';
      else if (!j.url || !/^https?:\/\//i.test(j.url)) reason = 'missing direct job URL';
      else if (typeof j.postedDays !== 'number') { if (strict) reason = 'posted date missing (strict freshness on)'; }
      else if (j.postedDays > maxDays) reason = `too old (${j.postedDays}d > ${maxDays}d)`;
      else if (!validRoleMatch(j, role)) reason = 'role mismatch';
      else if (!validLocationMatch(j, loc)) reason = 'location mismatch';
      else if (!validModeMatch(j, mode)) reason = 'work mode mismatch';
      const k = jobKey(j);
      if (!reason && seen.has(k)) reason = 'duplicate';
      // One audit row per job, mutated in place later if it goes to verification.
      const row = {
        title: j.title || '—', company: j.company || '—', source: j.source || '—',
        postedDate: j.postedDate || '(none)', ageDays: typeof j.postedDays === 'number' ? j.postedDays : 'unknown',
        decision: reason ? 'EXCLUDED' : 'CANDIDATE', reason: reason || 'passed filters; pending URL verification'
      };
      audit.push(row);
      if (!reason) { seen.add(k); j._auditRow = row; candidates.push(j); }
    }

    // newest first, then balanced by source so RemoteOK/Remotive cannot dominate the returned set
    candidates.sort((a, b) => (a.postedDays ?? 99) - (b.postedDays ?? 99));
    const balanced = balancedBySource(candidates, limit * 2);
    const chosenKeys = new Set(balanced.map(j => jobKey(j)));
    const overflow = candidates.filter(j => !chosenKeys.has(jobKey(j)));
    overflow.forEach(j => { if (j._auditRow) { j._auditRow.decision = 'EXCLUDED'; j._auditRow.reason = `beyond balanced result cap (${limit})`; } });
    candidates = balanced;

    let kept = candidates;
    if (verify) {
      const checked = await verifyMany(candidates, 6);
      kept = [];
      for (const j of checked) {
        const row = j._auditRow;
        if (j.verified) {
          kept.push(j);
          if (row) { row.decision = 'INCLUDED'; row.reason = j.verifyLevel === 'live' ? 'verified open (URL reachable)' : 'source-listed active (URL not crawlable)'; }
        } else if (row) {
          row.decision = 'EXCLUDED'; row.reason = `URL verification failed: ${j.verifyReason}`;
        }
      }
    } else {
      candidates.forEach(j => { if (j._auditRow) { j._auditRow.decision = 'INCLUDED'; j._auditRow.reason = 'structured-source job (verification disabled)'; } });
    }

    kept.sort((a, b) => (a.postedDays ?? 99) - (b.postedDays ?? 99));
    kept = balancedBySource(kept, limit);
    // Provider-backed board targets are not direct API calls; do not label them as failed merely because
    // JSearch/SerpAPI did not return that exact board in this query.
    // Honest per-source status. A board is NEVER marked "ready"/active unless it
    // actually returned jobs in THIS search. Provider-backed boards that returned
    // nothing are reported as no_results, not ready.
    for (const s of sources) {
      if (s.ok && Number(s.count || 0) > 0) {
        s.status = 'fetched';
      } else if (s.error) {
        s.status = 'failed';
        s.reason = s.error;
      } else if (/SerpAPI|JSearch|search provider/i.test(s.integration || '')) {
        s.active = false;
        s.status = 'no_results';
        s.reason = 'No jobs from this board in this search (discovery runs via JSearch/SerpAPI, not a direct integration).';
      } else {
        s.active = false;
        s.status = 'inactive';
      }
    }
    // strip internal helper before returning
    kept.forEach(j => { delete j._auditRow; });

    res.json({
      jobs: kept, sources, audit, verified: verify,
      diagnostics: {
        apiKeyDetected: !!RAPIDAPI_KEY,
        host: RAPIDAPI_HOST,
        country: ctx.diag.country || jsearchCountry(loc),
        query: ctx.diag.query || `${role} jobs in ${loc}`,
        jsearchReachable: ctx.diag.reachable ?? null,
        statusCode: ctx.diag.statusCode ?? null,
        returnedCount: ctx.diag.returnedCount ?? 0,
        firstPublishers: ctx.diag.firstPublishers || [],
        strictFreshness: strict,
        errorCode: ctx.diag.errorCode || (!RAPIDAPI_KEY ? 'MISSING_KEY' : null),
        errorMessage: ctx.diag.errorMessage || (!RAPIDAPI_KEY ? 'RAPIDAPI_KEY not set. Add it in .env / Vercel env vars and subscribe to JSearch on RapidAPI.' : null)
      },
      sourceSummary: {
        active: sources.filter(s => s.active).map(s => s.source),
        inactive: sources.filter(s => !s.active).map(s => ({ source: s.source, reason: s.reason })),
        returned: Object.fromEntries([...new Set(kept.map(j => j.source))].map(src => [src, kept.filter(j => j.source === src).length]))
      },
      freshnessDays: maxDays, fetchedAt: new Date().toISOString(),
      note: verify ? 'Only structured-source jobs that passed URL verification are returned. No AI-generated jobs.'
                   : 'URL verification disabled (verify=0). Still structured-source only — no AI-generated jobs.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/* ============================================================
   GET /health
   ============================================================ */
app.get('/health', (req, res) => res.json({
  ok: true,
  ai: !!process.env.ANTHROPIC_API_KEY,
  sources: SOURCES.map(s => s.name),
  aiJobGeneration: false,
  strictJobVerification: STRICT_JOB_VERIFICATION,
  time: new Date().toISOString()
}));

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
app.post('/auth/dev-login', async (req, res) => {
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

/* Who am I + which sign-in methods this server offers. */
app.get('/auth/me', async (req, res) => {
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
    providers: { google: { enabled: googleEnabled() }, dev: { enabled: allowDevLogin() } }
  });
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
  res.json({ ok: true, state: state || { profile: {}, resume: {}, projects: [], tracker: {}, xpSnapshot: {} }, db: db.dbEnabled() });
});

app.patch('/api/user/state', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const body = req.body || {};
  const allowed = {};
  for (const k of ['profile', 'resume', 'projects', 'tracker', 'xpSnapshot']) {
    if (Object.prototype.hasOwnProperty.call(body, k)) allowed[k] = body[k];
  }
  const result = await db.patchUserState({ userId: u?.id, email: u?.email, patch: allowed });
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ok: result.ok, db: db.dbEnabled(), result });
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
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ok: result.ok, profile, db: db.dbEnabled(), result });
});

app.post('/api/resume/save-analysis', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const resume = req.body?.resume || req.body || {};
  const result = await db.saveResumeSnapshot({ userId: u?.id, email: u?.email, resume });
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ok: result.ok, db: db.dbEnabled(), result });
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
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ...result, db: db.dbEnabled() });
});

/* Public / recruiter-safe view of a profile (privacy enforced server-side). */
app.get('/api/network/profile/:userId', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.getNetworkProfile({ viewerUserId: u?.id, targetUserId: req.params.userId });
  res.json({ ...result, db: db.dbEnabled() });
});

/* Leaderboard source: all eligible (public / published / open-to-recruiter) profiles. */
app.get('/api/network/leaderboards', requireAuth, async (req, res) => {
  const profiles = await db.listNetworkProfiles({ forRecruiter: false });
  res.json({ ok: true, profiles, db: db.dbEnabled() });
});

/* Recruiter candidate discovery (respects visibility + open-to-recruiters). */
app.get('/api/network/candidates', requireAuth, async (req, res) => {
  const profiles = await db.listNetworkProfiles({ forRecruiter: true });
  res.json({ ok: true, profiles, db: db.dbEnabled() });
});

/* Referral exchange + community feed posts. */
app.get('/api/network/posts', requireAuth, async (req, res) => {
  const posts = await db.listReferralPosts({ type: req.query.type || undefined });
  res.json({ ok: true, posts, db: db.dbEnabled() });
});
app.post('/api/network/posts', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const body = req.body || {};
  if (!body.type) return res.status(400).json({ ok: false, error: 'type_required' });
  const result = await db.createReferralPost({
    userId: u?.id, email: u?.email, name: u?.name, picture: u?.picture,
    type: String(body.type), fields: body.fields || {},
  });
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ...result, db: db.dbEnabled() });
});
app.delete('/api/network/posts/:id', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const result = await db.deleteReferralPost({ userId: u?.id, email: u?.email, postId: req.params.id });
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ...result, db: db.dbEnabled() });
});
app.post('/api/network/posts/:id/report', requireAuth, async (req, res) => {
  const result = await db.reportReferralPost({ postId: req.params.id });
  res.json({ ...result, db: db.dbEnabled() });
});

/* Referral requests — anti-spam weekly limit by plan. */
app.post('/api/network/requests', requireAuth, async (req, res) => {
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
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ...result, limit, db: db.dbEnabled() });
});

/* Recruiter shortlists. */
app.get('/api/network/shortlists', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const shortlists = await db.listShortlists({ recruiterUserId: u?.id, recruiterEmail: u?.email });
  res.json({ ok: true, shortlists, db: db.dbEnabled() });
});
app.post('/api/network/shortlists', requireAuth, async (req, res) => {
  const u = currentUser(req);
  const body = req.body || {};
  const result = await db.shortlistCandidate({
    recruiterUserId: u?.id, recruiterEmail: u?.email,
    candidateUserId: body.candidateUserId, note: body.note,
  });
  res.status(result.ok || !db.dbEnabled() ? 200 : 500).json({ ...result, db: db.dbEnabled() });
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

app.post('/contacts/find', async (req, res) => {
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

app.post('/contacts/referrals', async (req, res) => {
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
app.post('/ai/messages', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ error: { message: 'ANTHROPIC_API_KEY is not set on the server. Add it to .env or paste a key in Settings.' } });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body || {})
    });
    const data = await r.json().catch(() => ({ error: { message: 'Bad upstream response' } }));
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: err.message || 'AI proxy failed' } });
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

app.post('/support/chat', async (req, res) => {
  try {
    const message = String((req.body && req.body.message) || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: 'empty_message' });

    const { best, score, related } = matchFaq(message);

    // Strong, confident FAQ hit → answer directly from the knowledge base.
    if (best && score >= 2) {
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
            model: 'claude-sonnet-4-20250514',
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

app.post('/support/tickets', async (req, res) => {
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
  try { res.json({ ok: true, plan: buildPrepPlan(req.body && req.body.opportunity), generatedBy: 'template', note: 'Deterministic template. Configure ANTHROPIC_API_KEY and use the in-app AI button for a tailored plan.' }); }
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

app.post('/api/payments/create-order', requireAuth, async (req, res) => {
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

app.post('/api/payments/verify', requireAuth, (req, res) => {
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
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens, messages: [{ role: 'user', content: prompt }] }),
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
  const title = `Production-grade ${type} project for ${role}`;
  return {
    title, targetRole: role, type, difficulty: input.difficulty || 'Intermediate', duration: input.duration || '1 week',
    skillsCovered: skills, sourceMissingSkills: input.sourceMissingSkills || [],
    problemStatement: `Demonstrate ${skills.slice(0, 3).join(', ')} with a deployable, recruiter-visible project.`,
    useCase: `A practical ${type} project producing real proof-of-work: a deployment, README and measurable results.`,
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

app.post('/api/projects/generate-roadmap', requireAuth, async (req, res) => {
  const input = req.body || {};
  const prompt = `You are a senior engineer designing a portfolio project. Return ONLY JSON (no prose) with keys: title, targetRole, type, difficulty, duration, skillsCovered (array), problemStatement, useCase, techStack (array), architecture, steps (array of {phase, tasks[]}). Base it on role="${input.targetRole}", level="${input.difficulty}", duration="${input.duration}", type="${input.type}", missingSkills=${JSON.stringify(input.sourceMissingSkills || [])}, and this JD (optional): """${(input.jd || '').slice(0, 1500)}""". The project must specifically cover the missing skills.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 1800));
  if (ai && ai.title) return res.json({ ok: true, project: ai, generatedBy: 'ai' });
  res.json({ ok: true, project: psFallbackProject(input), generatedBy: 'template' });
});
app.post('/api/projects/generate-readme', requireAuth, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Write a professional GitHub README.md (markdown only, no commentary) for this project: ${JSON.stringify(p).slice(0, 4000)}. Include title, overview, skills, tech stack, architecture, getting started, structure, deployment, testing, demo links.`;
  const ai = await anthropicJSON(prompt, 1600);
  if (ai && ai.length > 80) return res.json({ ok: true, readme: ai, generatedBy: 'ai' });
  const skills = (p.skillsCovered || []).map((s) => `- ${s}`).join('\n');
  res.json({ ok: true, generatedBy: 'template', readme: `# ${p.title || 'Project'}\n\n> ${p.problemStatement || ''}\n\n## Overview\n${p.useCase || ''}\n\n## Skills\n${skills}\n\n## Tech stack\n${(p.techStack || []).map((s) => `- ${s}`).join('\n')}\n\n## Architecture\n${p.architecture || ''}\n\n## License\nMIT` });
});
app.post('/api/projects/generate-resume-bullets', requireAuth, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Return ONLY a JSON array of 4 concise, quantified-where-possible resume bullet strings for this project: ${JSON.stringify(p).slice(0, 3000)}.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 700));
  if (Array.isArray(ai) && ai.length) return res.json({ ok: true, bullets: ai.map(String), generatedBy: 'ai' });
  res.json({ ok: true, bullets: psBullets(p), generatedBy: 'template' });
});
app.post('/api/projects/generate-linkedin-post', requireAuth, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Write a short, engaging first-person LinkedIn post (plain text, with a few emojis and 3 hashtags) announcing this portfolio project: ${JSON.stringify(p).slice(0, 3000)}.`;
  const ai = await anthropicJSON(prompt, 600);
  if (ai && ai.length > 40) return res.json({ ok: true, post: ai, generatedBy: 'ai' });
  res.json({ ok: true, generatedBy: 'template', post: `Just shipped: ${p.title || 'a new project'}\n\n${p.useCase || ''}\n\nStack: ${(p.techStack || []).slice(0, 6).join(', ')}\n\n#portfolio #buildinpublic #${(p.targetRole || 'tech').replace(/[^a-zA-Z]/g, '')}` });
});
app.post('/api/projects/generate-interview-prep', requireAuth, async (req, res) => {
  const p = (req.body && req.body.project) || {};
  const prompt = `Return ONLY a JSON array of 6 objects {"q":"question","a":"model answer"} for an interview about this project: ${JSON.stringify(p).slice(0, 3000)}.`;
  const ai = parseJSONLoose(await anthropicJSON(prompt, 1400));
  if (Array.isArray(ai) && ai.length) return res.json({ ok: true, questions: ai, generatedBy: 'ai' });
  res.json({ ok: true, questions: psInterview(p), generatedBy: 'template' });
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

app.post('/api/projects/analyze-github', requireAuth, async (req, res) => {
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
app.post('/api/projects/verify-live-link', requireAuth, async (req, res) => {
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

/* ============================================================
   PROJECT RECOMMENDATION ENGINE — external source discovery (Part 5/6/10)
   Sources are INSPIRATION only; we convert them into original idea seeds and
   never tell the user to clone a repo. Every connector degrades gracefully to
   curated ideas, and results are cached (6h) so we don't hammer external APIs.
   Secrets (KAGGLE_KEY, PRODUCTHUNT_TOKEN, GITHUB_TOKEN) stay on the server.
   ============================================================ */
const discoverCache = new Map(); // key -> { at, data }
const DISCOVER_TTL = 6 * 60 * 60 * 1000;
function cacheGet(key) { const e = discoverCache.get(key); if (e && Date.now() - e.at < DISCOVER_TTL) return e.data; return null; }
function cacheSet(key, data) { discoverCache.set(key, { at: Date.now(), data }); return data; }
const lc = (s) => String(s || '').trim().toLowerCase();

function roleToTopics(role = '', projectType = '', skills = []) {
  const hay = (lc(role) + ' ' + lc(projectType) + ' ' + skills.map(lc).join(' '));
  if (/devops|sre|platform/.test(hay)) return ['devops', 'kubernetes', 'terraform'];
  if (/cloud/.test(hay)) return ['serverless', 'aws', 'terraform'];
  if (/front[\s-]?end/.test(hay)) return ['react', 'frontend', 'data-visualization'];
  if (/back[\s-]?end/.test(hay)) return ['nodejs', 'api', 'express'];
  if (/machine learning|ai\/ml|\bml\b|data scien/.test(hay)) return ['machine-learning', 'deep-learning', 'mlops'];
  if (/data analyst|\bdata\b|analytics/.test(hay)) return ['data-visualization', 'data-engineering', 'sql'];
  if (/cyber|security/.test(hay)) return ['security', 'pentesting', 'owasp'];
  return ['full-stack', 'mern', 'react'];
}
const TOPIC_SKILLS = {
  devops: ['Docker', 'Kubernetes', 'CI/CD', 'Monitoring'], kubernetes: ['Kubernetes', 'Helm', 'Docker'], terraform: ['Terraform', 'IaC', 'Cloud'],
  serverless: ['AWS Lambda', 'API Gateway', 'IaC'], aws: ['AWS', 'Cloud', 'IAM'],
  react: ['React', 'State Management', 'API Integration'], frontend: ['Responsive UI', 'Accessibility', 'Deployment'], 'data-visualization': ['Visualization', 'Dashboard', 'Insights'],
  nodejs: ['Node.js', 'API', 'Auth'], api: ['REST', 'API', 'Validation'], express: ['Express', 'Node.js', 'Middleware'],
  'machine-learning': ['Dataset', 'Model', 'Evaluation'], 'deep-learning': ['Model', 'Training', 'Evaluation'], mlops: ['MLflow', 'Deployment', 'Monitoring'],
  'data-engineering': ['ETL', 'Pipeline', 'SQL'], sql: ['SQL', 'Insights', 'Reporting'],
  security: ['Auth', 'Scanning', 'Security Controls'], pentesting: ['Scanning', 'Threat Model', 'Logs'], owasp: ['OWASP', 'Security Controls', 'Auth'],
  'full-stack': ['Frontend', 'Backend', 'Database'], mern: ['React', 'Node.js', 'MongoDB'],
};
function typeForTopics(topics = []) {
  const t = topics.join(' ');
  if (/devops|kubernetes|terraform/.test(t)) return 'DevOps';
  if (/serverless|aws/.test(t)) return 'Cloud';
  if (/machine|deep|mlops/.test(t)) return 'AI/ML';
  if (/data-eng|data-vis|sql/.test(t)) return 'Data';
  if (/security|pentest|owasp/.test(t)) return 'Cybersecurity';
  if (/react|frontend/.test(t) && !/full-stack|mern|api|node/.test(t)) return 'Frontend';
  if (/node|api|express/.test(t)) return 'Backend';
  return 'Full Stack';
}

async function discoverGithub(body = {}) {
  const { targetRole, skills = [], projectType, difficulty } = body;
  const topics = roleToTopics(targetRole, projectType, skills);
  const key = 'gh:' + topics.join(',');
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };
  const out = [];
  try {
    for (const topic of topics.slice(0, 3)) {
      const stars = /terraform|owasp|pentest|mlops|data-eng/.test(topic) ? 20 : 50;
      const q = encodeURIComponent(`topic:${topic} stars:>${stars}`);
      let data;
      try { data = await ghFetch(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=4`); }
      catch (e) { if (e.code === 'rate_limited') throw e; else continue; }
      for (const repo of (data.items || []).slice(0, 3)) {
        const type = typeForTopics([topic]);
        const skillsCovered = Array.from(new Set([...(TOPIC_SKILLS[topic] || []), ...(repo.topics || []).slice(0, 3).map((t) => t.replace(/-/g, ' '))])).slice(0, 8);
        out.push({
          sourceType: 'github', sourceLabel: 'GitHub trending', sourceUrl: repo.html_url,
          title: `Build your own ${topic.replace(/-/g, ' ')} ${type === 'Full Stack' ? 'platform' : 'project'}`,
          summary: `Inspired by trending open-source work in ${topic.replace(/-/g, ' ')} (${(repo.stargazers_count || 0).toLocaleString()}★). Build an ORIGINAL ${type} project applying the same patterns — do not clone the repo.`,
          detectedSkills: skillsCovered, techStack: skillsCovered, projectType: type,
          difficulty: difficulty || 'Intermediate', estimatedDuration: '2 weeks',
          inspirationSignals: [`${repo.stargazers_count || 0}★`, repo.language].filter(Boolean),
          startupPotential: 0.5, proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment', 'tests'],
        });
      }
    }
    return cacheSet(key, { ok: true, candidates: dedupeByTitle(out), source: 'github' });
  } catch (e) {
    return { ok: false, error: e.code === 'rate_limited' ? 'rate_limited' : 'github_error', candidates: [], message: 'GitHub is rate-limited or unavailable — using curated inspiration.' };
  }
}
function dedupeByTitle(rows) { const seen = new Set(); return rows.filter((r) => { const k = lc(r.title); if (seen.has(k)) return false; seen.add(k); return true; }); }

const KAGGLE_IDEAS = [
  { title: 'Customer Churn Prediction Service', summary: 'Use a public churn dataset to train, evaluate and serve a churn model behind an API with a small dashboard.', detectedSkills: ['Dataset', 'Model', 'Evaluation', 'Python', 'API'], projectType: 'AI/ML', difficulty: 'Intermediate', estimatedDuration: '1 month', startupPotential: 0.6, proofOutputs: ['GitHub repo', 'README', 'live demo', 'tests'] },
  { title: 'Retail Sales Forecasting Dashboard', summary: 'Forecast sales from a time-series dataset and present results in an interactive dashboard with insights.', detectedSkills: ['Dataset', 'Model', 'Visualization', 'Python', 'Insights'], projectType: 'Data', difficulty: 'Intermediate', estimatedDuration: '2 weeks', startupPotential: 0.5, proofOutputs: ['GitHub repo', 'README', 'screenshots', 'live demo'] },
];
const PRODUCTHUNT_IDEAS = [
  { title: 'AI Meeting Notes & Action Items SaaS', summary: 'A trending product category: turn meeting transcripts into summaries and tracked action items. Build a simplified student version.', detectedSkills: ['API', 'AI', 'Auth', 'Frontend', 'Deployment'], projectType: 'Full Stack', difficulty: 'Intermediate', estimatedDuration: '1 month', businessUseCase: 'Productivity SaaS for teams.', startupPotential: 0.9, proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment'] },
  { title: 'No-code Form → Workflow Automation', summary: 'Inspired by trending automation products — let users build forms that trigger simple workflows/notifications.', detectedSkills: ['Backend', 'API', 'Database', 'Frontend', 'Deployment'], projectType: 'Full Stack', difficulty: 'Advanced', estimatedDuration: '1 month', businessUseCase: 'SMB automation SaaS.', startupPotential: 0.85, proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment', 'tests'] },
];
const DEVPOST_IDEAS = [
  { title: 'Disaster Relief Resource Matching App', summary: 'Hackathon-style build: match people who need help with nearby resources/volunteers in real time.', detectedSkills: ['Full Stack', 'Geolocation', 'API', 'Database', 'Deployment'], projectType: 'Full Stack', difficulty: 'Intermediate', estimatedDuration: '2 weeks', businessUseCase: 'Civic-tech / NGO tool.', startupPotential: 0.6, proofOutputs: ['GitHub repo', 'README', 'live demo', 'deployment'] },
  { title: 'Accessibility Checker Browser Tool', summary: 'Hackathon-style build: scan a page for accessibility issues and suggest fixes — a strong, demoable proof piece.', detectedSkills: ['Frontend', 'Accessibility', 'API Integration', 'Deployment'], projectType: 'Frontend', difficulty: 'Intermediate', estimatedDuration: '1 week', startupPotential: 0.5, proofOutputs: ['GitHub repo', 'README', 'live demo', 'screenshots'] },
];

app.post('/api/projects/discover/github', requireAuth, async (req, res) => {
  const r = await discoverGithub(req.body || {});
  res.json(r.ok ? r : { ok: true, candidates: [], warning: r.message, error: r.error });
});
app.post('/api/projects/discover/kaggle', requireAuth, (req, res) => {
  const configured = Boolean(process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY);
  // We do not proxy Kaggle's authenticated API here; curated dataset/project ideas
  // are returned either way so the feature always works.
  res.json({ ok: true, configured, source: configured ? 'kaggle' : 'curated', candidates: KAGGLE_IDEAS.map((i) => ({ ...i, sourceType: 'kaggle', sourceLabel: 'Kaggle' })), message: configured ? 'Using Kaggle-style data project ideas.' : 'Kaggle integration not configured. Using curated data project ideas.' });
});
app.post('/api/projects/discover/producthunt', requireAuth, (req, res) => {
  const configured = Boolean(process.env.PRODUCTHUNT_TOKEN);
  res.json({ ok: true, configured, source: configured ? 'producthunt' : 'curated', candidates: PRODUCTHUNT_IDEAS.map((i) => ({ ...i, sourceType: 'producthunt', sourceLabel: 'Product Hunt' })), message: configured ? 'Using Product Hunt trend-style ideas.' : 'Product Hunt token not configured. Using curated startup/product ideas.' });
});
app.post('/api/projects/discover/devpost', requireAuth, (req, res) => {
  res.json({ ok: true, configured: false, source: 'curated', candidates: DEVPOST_IDEAS.map((i) => ({ ...i, sourceType: 'devpost', sourceLabel: 'Hackathon' })), message: 'Using curated hackathon-style ideas.' });
});

app.post('/api/projects/recommend', requireAuth, async (req, res) => {
  const body = req.body || {};
  const allowed = Array.isArray(body.allowedSources) ? body.allowedSources : ['github', 'curated'];
  const candidates = [];
  const signalsUsed = { github: false, kaggle: false, productHunt: false, devpost: false, curated: true };
  const warnings = [];

  if (allowed.includes('github')) {
    const gh = await discoverGithub(body);
    if (gh.ok && gh.candidates.length) { candidates.push(...gh.candidates); signalsUsed.github = true; }
    else if (gh.message) warnings.push(gh.message);
  }
  if (allowed.includes('kaggle') && /ai|ml|data|machine/i.test(`${body.targetRole} ${body.projectType}`)) {
    candidates.push(...KAGGLE_IDEAS.map((i) => ({ ...i, sourceType: 'kaggle', sourceLabel: 'Kaggle' }))); signalsUsed.kaggle = true;
    if (!process.env.KAGGLE_KEY) warnings.push('Kaggle not configured — using curated data project ideas.');
  }
  if (allowed.includes('producthunt')) {
    candidates.push(...PRODUCTHUNT_IDEAS.map((i) => ({ ...i, sourceType: 'producthunt', sourceLabel: 'Product Hunt' }))); signalsUsed.productHunt = true;
    if (!process.env.PRODUCTHUNT_TOKEN) warnings.push('Product Hunt token not configured — using curated startup ideas.');
  }
  if (allowed.includes('devpost')) {
    candidates.push(...DEVPOST_IDEAS.map((i) => ({ ...i, sourceType: 'devpost', sourceLabel: 'Hackathon' }))); signalsUsed.devpost = true;
  }

  res.json({
    ok: true,
    candidates: dedupeByTitle(candidates),
    signalsUsed,
    warnings,
    explanation: `Collected ${candidates.length} inspiration candidates from ${[signalsUsed.github && 'GitHub', signalsUsed.kaggle && 'Kaggle', signalsUsed.productHunt && 'Product Hunt', signalsUsed.devpost && 'hackathons'].filter(Boolean).join(', ') || 'curated sources'}. Scoring happens against your profile, resume gaps and matched jobs.`,
  });
});

/* ============================================================
   CUSTOM TEMPLATE ANALYSIS  (vision)
   Accepts a base64 image (PDF first-page is rasterised client-side) and
   returns a structured layout spec. Falls back to the client analyzer
   (dominant colour + column detection) when AI vision is unavailable.
   ============================================================ */
app.post('/api/templates/analyze-custom-template', requireAuth, async (req, res) => {
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
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 900, messages: [{ role: 'user', content: [
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

/* SPA fallback: keep API/backend routes intact, send UI for normal browser paths. */
app.get(/^\/(?!jobs|auth|apply|ai|api|health|contacts|opportunities|support|dashboard).*/, (req, res) => {
  res.sendFile(UI_INDEX);
});

const port = process.env.PORT || 3000;

/* Local run uses app.listen. Vercel imports the Express app as a serverless handler. */
if (!process.env.VERCEL) {
  if (db.dbEnabled()) {
    db.connectDB()
      .then(() => console.log('  • MongoDB: connected'))
      .catch((e) => console.log(`  • MongoDB: connection FAILED (${e.message}) — running session-only`));
  }
  app.listen(port, () => {
    console.log(`Career Autopilot running on http://localhost:${port}`);
    console.log(`  • Frontend served from this origin`);
    console.log(`  • Database: ${db.dbEnabled() ? 'MongoDB (MONGODB_URI set)' : 'OFF (session/cookie only — set MONGODB_URI to persist users & tickets)'}`);
    console.log(`  • Support: FAQ + chatbot + tickets enabled`);
    console.log(`  • Job sources: ${SOURCES.map(s => s.name).join(', ')} (structured, verified — no AI-generated jobs)`);
    console.log(`  • AI proxy: ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'OFF (set ANTHROPIC_API_KEY)'} — used for resume/tailoring/interview only`);
    console.log(`  • Google sign-in: ${googleEnabled() ? 'enabled' : 'OFF (set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)'}${allowDevLogin() ? '  |  demo sign-in: ON' : ''}`);
  });
}

export default app;
