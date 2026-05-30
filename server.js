import express from 'express';
import cors from 'cors';
import session from 'express-session';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '12mb' }));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true, credentials: true }));
app.use(session({
  name: 'career_autopilot.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));

/* Serve the frontend so the whole tool runs from one origin (no CORS for same-origin calls). */
app.use(express.static(__dirname));

/* Explicit root route for platforms like Vercel where static index serving can be skipped. */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const JOB_FETCH_TIMEOUT  = Number(process.env.JOB_FETCH_TIMEOUT  || 12000);
const JOB_VERIFY_TIMEOUT = Number(process.env.JOB_VERIFY_TIMEOUT || 9000);
const STRICT_JOB_VERIFICATION = process.env.STRICT_JOB_VERIFICATION !== '0';

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
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(t); }
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

if (process.env.RAPIDAPI_KEY) {
  SOURCES.push({
    name: 'JSearch',
    home: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    description: 'JSearch/RapidAPI jobs API. Expands coverage across LinkedIn, Indeed, Naukri and other publishers when available.',
    requiresKey: true,
    fetch: async (role, ctx = {}) => {
      const loc = ctx.location || process.env.DEFAULT_JOB_LOCATION || 'India';
      const queries = [
        `${role || 'software engineer'} ${loc}`,
        `${role || 'software engineer'} LinkedIn ${loc}`,
        `${role || 'software engineer'} Indeed ${loc}`,
        `${role || 'software engineer'} Naukri ${loc}`,
        `${role || 'software engineer'} Instahyre Cutshort Hirist ${loc}`
      ];
      const calls = queries.map(q => fetchJson(`https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&date_posted=week&num_pages=1`, JOB_FETCH_TIMEOUT, {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }));
      const settled = await Promise.allSettled(calls);
      const out = [];
      for (const r of settled) if (r.status === 'fulfilled') out.push(...(r.value.data || []));
      return out.map(x => {
        const url = x.job_apply_link || x.job_google_link || '';
        const publisher = x.job_publisher || sourceFromUrl(url) || 'JSearch';
        const src = inferSource({ url, source: publisher }, 'JSearch');
        return {
          title: x.job_title,
          company: x.employer_name,
          location: [x.job_city, x.job_state, x.job_country].filter(Boolean).join(', ') || '—',
          mode: x.job_is_remote ? 'Remote' : 'On-site/Hybrid',
          experience: '',
          salary: '',
          companyType: x.employer_company_type || '',
          source: src,
          sourceProvider: 'JSearch',
          postedDate: isoDate(x.job_posted_at_datetime_utc || x.job_posted_at_timestamp),
          postedDays: ageDays(x.job_posted_at_datetime_utc || x.job_posted_at_timestamp),
          url,
          summary: stripHtml(x.job_description).slice(0, 260),
          requiredSkills: (x.job_required_skills || []).slice(0, 12)
        };
      }).filter(j => j.url);
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
      active = !!(process.env.SERPAPI_KEY || process.env.RAPIDAPI_KEY);
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
  if (!q) return true;
  if (/remote/i.test(job.mode || '') || /remote/i.test(job.location || '')) return true;   // remote satisfies any location
  return normText(`${job.location} ${job.summary}`).includes(q.split(' ')[0]);
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
    const selected = requestedSources(req);
    const ctx = { role, location: loc, mode, freshness: req.query.freshness || '7d', selectedSources: selected };

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
      else if (typeof j.postedDays !== 'number') reason = 'posted date missing';
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
    // strip internal helper before returning
    kept.forEach(j => { delete j._auditRow; });

    res.json({
      jobs: kept, sources, audit, verified: verify,
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

function requireProvider(req, res, next) {
  const p = req.params.provider;
  if (!providers[p]) return res.status(404).json({ error: 'Unknown provider' });
  if (!providers[p].clientId || !providers[p].clientSecret)
    return res.status(400).json({ error: `${p} OAuth credentials are not configured on the server` });
  next();
}
function randomState() { return crypto.randomBytes(24).toString('hex'); }

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
  res.redirect(url.toString());
});

app.get('/auth/:provider/callback', requireProvider, async (req, res) => {
  const p = req.params.provider;
  const cfg = providers[p];
  const saved = req.session.oauth?.[p];
  const returnTo = saved?.returnTo || process.env.FRONTEND_ORIGIN || '/';

  if (!req.query.code) return res.redirect(`${returnTo}?oauth_return=${p}&error=missing_code`);
  if (!saved || saved.state !== req.query.state) return res.redirect(`${returnTo}?oauth_return=${p}&error=bad_state`);

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
    res.redirect(`${returnTo}?oauth_return=${p}&connected=1`);
  } catch (err) {
    res.redirect(`${returnTo}?oauth_return=${p}&error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/auth/status', (req, res) => {
  const tokens = req.session.tokens || {};
  const result = { providers: {} };
  for (const p of Object.keys(providers)) {
    const t = tokens[p];
    result.providers[p] = {
      connected: !!t?.access_token,
      profile: t?.profile ? {
        name: t.profile.name || [t.profile.given_name, t.profile.family_name].filter(Boolean).join(' ') || null,
        email: t.profile.email || null
      } : null,
      scopes: t?.scope ? String(t.scope).split(/[ ,]+/).filter(Boolean) : []
    };
  }
  res.json(result);
});

app.post('/auth/:provider/logout', (req, res) => {
  const p = req.params.provider;
  if (req.session.tokens) delete req.session.tokens[p];
  res.json({ ok: true });
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

/* SPA fallback: keep API/backend routes intact, send UI for normal browser paths. */
app.get(/^\/(?!jobs|auth|apply|ai|health).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = process.env.PORT || 3000;

/* Local run uses app.listen. Vercel imports the Express app as a serverless handler. */
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Career Autopilot running on http://localhost:${port}`);
    console.log(`  • Frontend served from this origin`);
    console.log(`  • Job sources: ${SOURCES.map(s => s.name).join(', ')} (structured, verified — no AI-generated jobs)`);
    console.log(`  • AI proxy: ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'OFF (set ANTHROPIC_API_KEY)'} — used for resume/tailoring/interview only`);
  });
}

export default app;
