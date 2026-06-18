/* ============================================================
   GITHUB INTEGRATION ENGINE  (Career Proof Profile)
   ------------------------------------------------------------
   Two layers of GitHub verification, deterministic + backend-owned:

   Layer 1 — Identity connection (OAuth, minimal scopes read:user user:email)
     normalizeGitHubUser / calculateGitHubStats — public-safe profile + stats.

   Layer 2 — GitHub App selected-repository verification
     generateGitHubAppJwt / createInstallationToken — short-lived,
     server-side-only credentials. fetchInstallationRepositories,
     fetchSafeRepoFiles, sanitizeRepoFilesForAnalysis, detectRepoStack,
     detectRepoSkills, calculateRepoProofScore, generate*Summary,
     mapRepoEvidenceToSkills, filterPrivateRepoDataForPublicView.

   Security rules enforced here:
     - NEVER inspect secret-like files (.env, credentials, keys, tokens…).
     - NEVER return / log tokens or the App private key.
     - Installation tokens are minted server-side and are short-lived.
     - OAuth access tokens are encrypted at rest (AES-256-GCM).
     - Private-repo analysis output is filtered to a safe summary before it can
       ever reach a public / recruiter view, and is private by DEFAULT.

   No AI. Same inputs -> same decision. All network helpers fail soft so the
   profile UI never crashes when GitHub is unreachable or unconfigured.
   ============================================================ */
import crypto from 'crypto';

const GH_API = 'https://api.github.com';
const UA = 'career-autopilot-github-integration';

/* ------------------------------------------------------------------
   CONFIG / FEATURE-DETECTION
   The whole feature degrades to "not configured" instead of crashing
   when the relevant env vars are absent (important for local dev).
   ------------------------------------------------------------------ */
export function githubOAuthConfig() {
  return {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    callbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/integrations/github/callback',
    scopes: process.env.GITHUB_OAUTH_SCOPES || 'read:user user:email',
  };
}
export function githubAppConfig() {
  return {
    appId: process.env.GITHUB_APP_ID || '',
    appName: process.env.GITHUB_APP_NAME || '',
    clientId: process.env.GITHUB_APP_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET || '',
    privateKey: normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY || ''),
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET || '',
    installCallbackUrl: process.env.GITHUB_APP_INSTALLATION_CALLBACK_URL || 'http://localhost:3000/api/integrations/github/app/callback',
  };
}
const notPlaceholder = (v) => !!v && !/^paste-|^your-|^changeme/i.test(String(v));
export function githubOAuthEnabled() {
  const c = githubOAuthConfig();
  return notPlaceholder(c.clientId) && notPlaceholder(c.clientSecret);
}
export function githubAppEnabled() {
  const c = githubAppConfig();
  return notPlaceholder(c.appId) && notPlaceholder(c.privateKey) && notPlaceholder(c.appName);
}

/* GitHub App private keys are PEM blocks. When passed through an environment
   variable people often store them with literal "\n" escapes; turn those back
   into real newlines so crypto can read the key. */
export function normalizePrivateKey(raw = '') {
  let s = String(raw || '');
  if (!s) return '';
  if (s.includes('\\n')) s = s.replace(/\\n/g, '\n');
  return s.trim();
}

/* ------------------------------------------------------------------
   TOKEN ENCRYPTION AT REST  (AES-256-GCM)
   OAuth access tokens, if stored, must be encrypted. The key comes from
   OAUTH_TOKEN_ENCRYPTION_KEY (any string -> 32 bytes via SHA-256).
   Output is a self-describing string: v1:<iv>:<tag>:<ciphertext> (base64url).
   ------------------------------------------------------------------ */
function encryptionKey() {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || '';
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw)).digest();
}
export function encryptionConfigured() {
  return !!(process.env.OAUTH_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET);
}
export function encryptToken(plain) {
  const key = encryptionKey();
  if (!key) throw new Error('token_encryption_key_missing');
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join(':');
}
export function decryptToken(blob) {
  const key = encryptionKey();
  if (!key || !blob || typeof blob !== 'string') return null;
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------
   LOW-LEVEL GITHUB FETCH  (never throws raw; never logs tokens)
   ------------------------------------------------------------------ */
async function ghFetch(pathOrUrl, { token = '', accept = 'application/vnd.github+json', method = 'GET', timeout = 8000, raw = false } = {}) {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${GH_API}${pathOrUrl}`;
  const headers = { 'User-Agent': UA, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers, signal: ctrl.signal });
    if (r.status === 401) { const e = new Error('unauthorized'); e.code = 'unauthorized'; throw e; }
    if (r.status === 403 || r.status === 429) { const e = new Error('rate_limited'); e.code = 'rate_limited'; throw e; }
    if (r.status === 404) { const e = new Error('not_found'); e.code = 'not_found'; throw e; }
    if (!r.ok) { const e = new Error('github_error'); e.code = 'github_error'; e.status = r.status; throw e; }
    return raw ? r.text() : r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ============================================================
   LAYER 1 — IDENTITY + PUBLIC STATS
   ============================================================ */
export function normalizeGitHubUser(profile = {}) {
  return {
    providerUserId: profile.id != null ? String(profile.id) : '',
    handle: profile.login || '',
    name: profile.name || '',
    avatarUrl: profile.avatar_url || '',
    url: profile.html_url || (profile.login ? `https://github.com/${profile.login}` : ''),
    company: profile.company || '',
    blog: profile.blog || '',
    location: profile.location || '',
    bio: profile.bio || '',
    publicRepos: Number(profile.public_repos || 0),
    followers: Number(profile.followers || 0),
    following: Number(profile.following || 0),
    createdAt: profile.created_at || null,
    updatedAt: profile.updated_at || null,
  };
}

export function normalizeGitHubRepo(repo = {}) {
  const ownerLogin = repo.owner?.login || (repo.full_name ? repo.full_name.split('/')[0] : '');
  return {
    githubRepoId: repo.id != null ? String(repo.id) : '',
    owner: ownerLogin,
    name: repo.name || '',
    fullName: repo.full_name || (ownerLogin && repo.name ? `${ownerLogin}/${repo.name}` : ''),
    private: !!repo.private,
    htmlUrl: repo.html_url || '',
    defaultBranch: repo.default_branch || 'main',
    description: repo.description || '',
    topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 20) : [],
    language: repo.language || '',
    fork: !!repo.fork,
    archived: !!repo.archived,
    stargazersCount: Number(repo.stargazers_count || 0),
    forksCount: Number(repo.forks_count || 0),
    pushedAt: repo.pushed_at || null,
    repoUpdatedAt: repo.updated_at || null,
    createdAt: repo.created_at || null,
  };
}

export function calculateGitHubStats(user = {}, repos = []) {
  const list = Array.isArray(repos) ? repos : [];
  const now = Date.now();
  const sixMonths = 1000 * 60 * 60 * 24 * 182;
  let totalStars = 0, totalForks = 0, activeRepoCount = 0;
  const langCount = {};
  for (const r of list) {
    totalStars += Number(r.stargazersCount || 0);
    totalForks += Number(r.forksCount || 0);
    if (r.pushedAt && now - new Date(r.pushedAt).getTime() <= sixMonths) activeRepoCount += 1;
    if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
  }
  const topLanguages = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));
  const recentRepos = [...list]
    .filter((r) => !r.fork)
    .sort((a, b) => new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0))
    .slice(0, 5)
    .map((r) => ({ name: r.name, fullName: r.fullName, language: r.language, stars: r.stargazersCount, pushedAt: r.pushedAt, private: !!r.private }));
  return {
    publicRepoCount: Number(user.publicRepos || list.filter((r) => !r.private).length || 0),
    activeRepoCount,
    followers: Number(user.followers || 0),
    following: Number(user.following || 0),
    totalStars,
    totalForks,
    topLanguages,
    recentRepos,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function fetchOAuthProfileAndStats(token) {
  const profile = await ghFetch('/user', { token });
  const user = normalizeGitHubUser(profile);
  let repos = [];
  try {
    const raw = await ghFetch('/user/repos?per_page=100&sort=pushed&type=owner', { token });
    if (Array.isArray(raw)) repos = raw.map(normalizeGitHubRepo);
  } catch { /* stats are best-effort */ }
  const stats = calculateGitHubStats(user, repos);
  return { user, stats };
}

export async function fetchPrimaryEmail(token) {
  try {
    const emails = await ghFetch('/user/emails', { token });
    if (!Array.isArray(emails)) return null;
    const primary = emails.find((e) => e.primary) || emails.find((e) => e.verified) || emails[0];
    if (!primary) return null;
    return { email: primary.email || null, verified: !!primary.verified, primary: !!primary.primary };
  } catch {
    return null;
  }
}

export async function exchangeOAuthCode(code) {
  const cfg = githubOAuthConfig();
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.callbackUrl,
    }).toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    const e = new Error('token_exchange_failed');
    e.code = 'token_exchange_failed';
    throw e;
  }
  return { accessToken: data.access_token, tokenType: data.token_type || 'bearer', scope: data.scope || '' };
}

/* ============================================================
   LAYER 2 — GITHUB APP  (JWT + installation tokens, server-side only)
   ============================================================ */
export function generateGitHubAppJwt() {
  const cfg = githubAppConfig();
  if (!cfg.appId || !cfg.privateKey) throw new Error('github_app_not_configured');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 30, exp: now + 8 * 60, iss: cfg.appId };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(cfg.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export async function createInstallationToken(installationId, repositoryIds = null) {
  if (!installationId) throw new Error('installation_id_required');
  const jwt = generateGitHubAppJwt();
  const body = {};
  if (Array.isArray(repositoryIds) && repositoryIds.length) {
    body.repository_ids = repositoryIds.map((n) => Number(n)).filter(Boolean);
  }
  const r = await fetch(`${GH_API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(Object.keys(body).length ? { 'Content-Type': 'application/json' } : {}),
    },
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = new Error('installation_token_failed');
    e.code = 'installation_token_failed';
    e.status = r.status;
    throw e;
  }
  return r.json(); // { token, expires_at, permissions, repository_selection }
}

export async function fetchInstallationMeta(installationId) {
  const jwt = generateGitHubAppJwt();
  const data = await ghFetch(`/app/installations/${encodeURIComponent(installationId)}`, { token: jwt });
  return {
    installationId: String(data.id),
    accountLogin: data.account?.login || '',
    accountId: data.account?.id != null ? String(data.account.id) : '',
    accountType: data.account?.type || '',
    repositorySelection: data.repository_selection || 'selected',
    permissions: data.permissions || {},
    suspendedAt: data.suspended_at || null,
  };
}

export async function fetchInstallationRepositories(installationId, { maxPages = 5 } = {}) {
  const tokenData = await createInstallationToken(installationId);
  const token = tokenData.token;
  const out = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await ghFetch(`/installation/repositories?per_page=100&page=${page}`, { token });
    const repos = data.repositories || [];
    out.push(...repos.map(normalizeGitHubRepo));
    if (repos.length < 100) break;
  }
  return out;
}

/* ============================================================
   SAFE FILE INSPECTION
   ============================================================ */
const ALLOWED_FILES = [
  'readme.md', 'readme.rst', 'readme.txt', 'readme',
  'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'requirements.txt', 'pyproject.toml', 'pipfile', 'setup.py',
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yaml',
  'jenkinsfile', 'go.mod', 'cargo.toml', 'composer.json', 'gemfile',
  'vercel.json', 'netlify.toml', 'procfile', 'serverless.yml', 'serverless.yaml',
  'main.py', 'app.py', 'server.js', 'app.js', 'index.js', 'manage.py',
];

const SECRET_PATTERNS = [
  /(^|\/)\.env($|\.|\/)/i,
  /(^|\/)\.env\.[\w.-]+$/i,
  /secrets?\./i,
  /credentials?\./i,
  /(^|\/)id_rsa($|\.)/i,
  /(^|\/)id_dsa($|\.)/i,
  /(^|\/)id_ecdsa($|\.)/i,
  /(^|\/)id_ed25519($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
  /(^|\/)gcloud/i,
  /service[-_]?account.*\.json$/i,
  /(token|password|passwd|apikey|api[-_]key|secret)/i,
];

export function isSecretLikePath(p = '') {
  const s = String(p || '').toLowerCase();
  if (!s) return false;
  return SECRET_PATTERNS.some((re) => re.test(s));
}
export function isAllowedProofFile(p = '') {
  const s = String(p || '').toLowerCase();
  if (!s) return false;
  if (isSecretLikePath(s)) return false;
  const base = s.split('/').pop();
  if (ALLOWED_FILES.includes(base)) return true;
  if (/^\.github\/workflows\/.+\.ya?ml$/.test(s)) return true;
  if (/\.tf$/.test(s) && (s.startsWith('terraform/') || s.startsWith('infra/') || s.split('/').length <= 2)) return true;
  if (/(^|\/)(k8s|kubernetes|helm)\/.+\.ya?ml$/.test(s)) return true;
  return false;
}

export function sanitizeRepoFilesForAnalysis(files = {}) {
  const clean = {};
  for (const [name, content] of Object.entries(files || {})) {
    if (isSecretLikePath(name)) continue;
    clean[name] = content;
  }
  return clean;
}

export const ANALYSIS_LIMITS = {
  maxFilesInspected: 12,
  maxFileBytes: 64 * 1024,
  maxTreeEntries: 4000,
};

export async function fetchSafeRepoFiles(repo, installationId) {
  const out = { files: {}, structure: [], filesInspected: 0, truncated: false, commitSignals: {} };
  if (!repo || !repo.fullName) return out;
  const tokenData = await createInstallationToken(installationId, repo.githubRepoId ? [repo.githubRepoId] : null);
  const token = tokenData.token;
  const [owner, name] = repo.fullName.split('/');
  const branch = repo.defaultBranch || 'main';

  let tree = [];
  try {
    const data = await ghFetch(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { token });
    tree = Array.isArray(data.tree) ? data.tree : [];
    if (data.truncated || tree.length > ANALYSIS_LIMITS.maxTreeEntries) out.truncated = true;
  } catch (e) {
    if (e.code === 'not_found') { const err = new Error('missing_default_branch'); err.code = 'missing_default_branch'; throw err; }
    throw e;
  }

  const blobs = tree.filter((t) => t.type === 'blob');
  const topLevel = new Set();
  for (const t of tree) {
    const seg = String(t.path || '').split('/');
    if (seg.length === 1) topLevel.add(`${t.type === 'tree' ? '📁' : '📄'} ${seg[0]}`);
    else topLevel.add(`📁 ${seg[0]}`);
  }
  out.structure = Array.from(topLevel).slice(0, 40);

  const candidates = blobs
    .filter((b) => isAllowedProofFile(b.path))
    .filter((b) => Number(b.size || 0) <= ANALYSIS_LIMITS.maxFileBytes)
    .slice(0, ANALYSIS_LIMITS.maxFilesInspected);

  for (const c of candidates) {
    try {
      const content = await ghFetch(`/repos/${owner}/${name}/contents/${encodeURIComponent(c.path)}?ref=${encodeURIComponent(branch)}`, { token });
      if (content && content.content) {
        const text = Buffer.from(content.content, content.encoding || 'base64').toString('utf8');
        out.files[c.path] = text.slice(0, ANALYSIS_LIMITS.maxFileBytes);
        out.filesInspected += 1;
      }
    } catch { /* skip unreadable file */ }
  }

  try {
    const commits = await ghFetch(`/repos/${owner}/${name}/commits?per_page=30`, { token });
    if (Array.isArray(commits) && commits.length) {
      // Per-login authored-commit counts. `c.author.login` is the GitHub
      // account GitHub matched to the commit (not just the free-text git
      // author), which is what lets us prove the connected identity actually
      // wrote the code rather than merely having repo access.
      const authorCounts = {};
      for (const c of commits) {
        const login = String(c.author?.login || '').toLowerCase();
        if (login) authorCounts[login] = (authorCounts[login] || 0) + 1;
      }
      out.commitSignals = {
        recentCommits: commits.length,
        lastCommitDate: commits[0]?.commit?.author?.date || commits[0]?.commit?.committer?.date || null,
        contributors: new Set(commits.map((c) => c.author?.login || c.commit?.author?.email).filter(Boolean)).size,
        authorCounts,
      };
    }
  } catch { /* commit signals optional */ }

  out.files = sanitizeRepoFilesForAnalysis(out.files);
  return out;
}

/* ============================================================
   STACK / SKILL DETECTION + PROOF SCORE
   ============================================================ */
function fileSet(files = {}) {
  const names = Object.keys(files || {}).map((n) => n.toLowerCase());
  const findKey = (lower) => Object.keys(files || {}).find((k) => k.toLowerCase() === lower);
  return {
    names,
    has: (base) => names.some((n) => n === base || n.endsWith('/' + base)),
    hasGlob: (re) => names.some((n) => re.test(n)),
    readme: names.find((n) => /(^|\/)readme(\.md|\.rst|\.txt)?$/.test(n)),
    pkg: files[findKey('package.json') || ''] || '',
    py: (files[findKey('requirements.txt') || ''] || files[findKey('pyproject.toml') || ''] || files[findKey('pipfile') || ''] || '') + '',
    content: (lower) => files[findKey(lower) || ''] || '',
  };
}

export function detectRepoStack(files = {}, metadata = {}) {
  const fs = fileSet(files);
  const pkg = String(fs.pkg || '').toLowerCase();
  const py = String(fs.py || '').toLowerCase();
  const stack = [];
  const add = (t) => { if (t && !stack.includes(t)) stack.push(t); };

  if (metadata.language) add(metadata.language);

  if (fs.has('package.json')) add('Node.js');
  if (/\breact\b/.test(pkg)) add('React');
  if (/\bvite\b/.test(pkg)) add('Vite');
  if (/next/.test(pkg)) add('Next.js');
  if (/express/.test(pkg)) add('Express');
  if (/@nestjs|nestjs/.test(pkg)) add('NestJS');
  if (/fastify/.test(pkg)) add('Fastify');
  if (/typescript/.test(pkg)) add('TypeScript');
  if (/tailwind/.test(pkg)) add('Tailwind CSS');

  if (fs.has('requirements.txt') || fs.has('pyproject.toml') || fs.has('pipfile') || fs.has('main.py') || fs.has('app.py') || fs.has('manage.py')) add('Python');
  if (/fastapi/.test(py)) add('FastAPI');
  if (/django/.test(py) || fs.has('manage.py')) add('Django');
  if (/flask/.test(py)) add('Flask');

  if (fs.has('pom.xml') || fs.has('build.gradle') || fs.has('build.gradle.kts')) add('Java');
  if (/spring/.test(String(fs.content('pom.xml') || fs.content('build.gradle') || '').toLowerCase())) add('Spring Boot');
  if (fs.has('go.mod')) add('Go');
  if (fs.has('cargo.toml')) add('Rust');

  if (fs.has('dockerfile') || fs.has('docker-compose.yml') || fs.has('docker-compose.yaml') || fs.has('compose.yaml')) add('Docker');
  if (fs.hasGlob(/(^|\/)(k8s|kubernetes|helm)\/.+\.ya?ml$/)) add('Kubernetes');
  if (fs.hasGlob(/(^|\/)helm\//)) add('Helm');
  if (fs.hasGlob(/\.tf$/)) add('Terraform');
  if (fs.has('jenkinsfile')) add('Jenkins');
  if (fs.hasGlob(/^\.github\/workflows\/.+\.ya?ml$/)) add('GitHub Actions');

  return stack;
}

export function detectRepoSkills(files = {}, metadata = {}) {
  const fs = fileSet(files);
  const pkg = String(fs.pkg || '').toLowerCase();
  const py = String(fs.py || '').toLowerCase();
  const skills = new Set();
  const add = (...xs) => xs.forEach((x) => x && skills.add(x));

  if (fs.has('dockerfile') || fs.has('docker-compose.yml') || fs.has('docker-compose.yaml') || fs.has('compose.yaml')) add('Docker', 'Containerization');
  if (fs.hasGlob(/(^|\/)(k8s|kubernetes)\/.+\.ya?ml$/)) add('Kubernetes', 'Container Orchestration');
  if (fs.hasGlob(/(^|\/)helm\//)) add('Helm');
  if (fs.hasGlob(/\.tf$/)) add('Terraform', 'Infrastructure as Code');
  if (fs.has('jenkinsfile')) add('Jenkins', 'CI/CD');
  if (fs.hasGlob(/^\.github\/workflows\/.+\.ya?ml$/)) add('GitHub Actions', 'CI/CD Pipeline Design');
  if (/\breact\b/.test(pkg) || /\bvite\b/.test(pkg)) add('React', 'Frontend Development');
  if (/express|@nestjs|nestjs|fastify/.test(pkg)) add('Node.js', 'REST API Development');
  if (fs.has('pom.xml') || fs.has('build.gradle') || fs.has('build.gradle.kts')) add('Java', 'Spring Boot', 'Backend Development');
  if (/fastapi|django|flask/.test(py) || fs.has('manage.py')) add('Python', 'Backend Development');
  if (fs.hasGlob(/(^|\/)(tests?|__tests__|spec)\//)) add('Testing', 'Test Automation');
  if (fs.readme && String(fs.content(fs.readme) || '').length > 200) add('Documentation', 'Project Communication');

  if (metadata.language && !skills.has(metadata.language)) add(metadata.language);
  return Array.from(skills);
}

export function calculateRepoProofScore(repo = {}, files = {}, commitSignals = {}) {
  const fs = fileSet(files);
  let score = 0;
  const factors = {};

  const readmeContent = fs.readme ? String(fs.content(fs.readme) || '') : '';
  const readmeWords = readmeContent.trim().split(/\s+/).filter(Boolean).length;
  const readmeGood = readmeWords > 250;
  factors.readme = fs.readme ? (readmeGood ? 16 : 9) : 0;
  score += factors.readme;

  const hasDeps = fs.has('package.json') || fs.has('requirements.txt') || fs.has('pyproject.toml') || fs.has('pom.xml') || fs.has('build.gradle') || fs.has('go.mod') || fs.has('cargo.toml');
  factors.dependencies = hasDeps ? 10 : 0;
  score += factors.dependencies;

  const hasSource = fs.hasGlob(/(^|\/)(src|app|lib)\//) || fs.has('main.py') || fs.has('server.js') || fs.has('app.js') || fs.has('index.js');
  factors.sourceStructure = hasSource ? 12 : 0;
  score += factors.sourceStructure;

  const hasTests = fs.hasGlob(/(^|\/)(tests?|__tests__|spec)\//);
  factors.tests = hasTests ? 12 : 0;
  score += factors.tests;

  const hasCI = fs.hasGlob(/^\.github\/workflows\/.+\.ya?ml$/) || fs.has('jenkinsfile');
  factors.cicd = hasCI ? 12 : 0;
  score += factors.cicd;

  const hasDeploy = fs.has('dockerfile') || fs.has('docker-compose.yml') || fs.has('docker-compose.yaml') || fs.has('vercel.json') || fs.has('netlify.toml') || fs.has('procfile') || fs.has('serverless.yml');
  factors.deployment = hasDeploy ? 10 : 0;
  score += factors.deployment;

  const hasInfra = fs.hasGlob(/\.tf$/) || fs.hasGlob(/(^|\/)(k8s|kubernetes|helm)\//);
  factors.infrastructure = hasInfra ? 8 : 0;
  score += factors.infrastructure;

  const pushedAt = repo.pushedAt ? new Date(repo.pushedAt).getTime() : 0;
  const ageDays = pushedAt ? (Date.now() - pushedAt) / 86400000 : 9999;
  factors.recentActivity = ageDays <= 90 ? 8 : ageDays <= 365 ? 4 : 0;
  score += factors.recentActivity;

  const commits = Number(commitSignals.recentCommits || 0);
  factors.commitHistory = commits >= 10 ? 6 : commits >= 3 ? 3 : 0;
  score += factors.commitHistory;

  factors.notArchived = repo.archived ? -8 : 0;
  score += factors.notArchived;
  const empty = Object.keys(files || {}).length === 0;
  factors.notEmpty = empty ? -10 : 0;
  score += factors.notEmpty;

  factors.linkedProject = repo.linkedProjectId ? 4 : 0;
  score += factors.linkedProject;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 85 ? 'Strong proof' : score >= 70 ? 'Good proof' : score >= 50 ? 'Partial proof' : 'Weak proof';
  return { score, level, factors };
}

/* ============================================================
   AUTHORSHIP VERIFICATION
   ------------------------------------------------------------
   The difference between "this repo contains Kubernetes manifests" and
   "this person wrote Kubernetes manifests" is the whole ballgame for a
   recruiter. Repo access (an install) proves neither ownership nor authorship
   — a fork or a repo someone was added to looks identical to original work at
   the file level. This classifies the connected identity's relationship to the
   repo from objective signals only:

     authored      — connected identity owns the repo OR authored the majority
                      of recent commits. -> credential method github_commit_authored (high ceiling)
     contributor   — connected identity authored some, but not most, commits.
                      -> github_contributor (medium ceiling)
     fork           — repo is a fork and identity has no authored commits.
                      Skills here must NOT be presented as the user's work.
     unverified    — no identity supplied, or identity authored nothing we
                      can see. -> github_repo_detected (medium, NOT authorship)

   Deterministic. No network. Same inputs -> same classification.
   ============================================================ */
export function verifyRepoAuthorship({ repo = {}, commitSignals = {}, identityHandle = '' } = {}) {
  const handle = String(identityHandle || '').toLowerCase().trim();
  const owner = String(repo.owner || '').toLowerCase().trim();
  const counts = commitSignals.authorCounts || {};
  const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
  const mine = handle ? Number(counts[handle] || 0) : 0;
  const share = total > 0 ? mine / total : 0;
  const isOwner = !!handle && handle === owner;

  // Deterministic risk flags: patterns consistent with a copied or AI-dumped
  // repo rather than genuine iterative authorship. These cap confidence even
  // when commits are attributed to the identity.
  const riskFlags = [];
  if (repo.fork) riskFlags.push('fork');
  if (total > 0 && total <= 2) riskFlags.push('single_burst');      // whole project in 1-2 commits
  if (commitSignals.recentCommits != null && commitSignals.recentCommits < 3) riskFlags.push('shallow_history');

  let classification;
  let method;
  if (!handle) {
    classification = 'unverified';
    method = 'github_repo_detected';
  } else if (isOwner && !repo.fork) {
    classification = 'authored';
    method = 'github_commit_authored';
  } else if (mine > 0 && share >= 0.5) {
    classification = 'authored';
    method = 'github_commit_authored';
  } else if (mine > 0) {
    classification = 'contributor';
    method = 'github_contributor';
  } else if (repo.fork) {
    classification = 'fork';
    method = 'github_repo_detected';
  } else {
    classification = 'unverified';
    method = 'github_repo_detected';
  }

  return {
    classification,
    method,
    isOwner,
    isFork: !!repo.fork,
    authoredCommitShare: Math.round(share * 100) / 100,
    authoredCommits: mine,
    observedCommits: total,
    identityHandle: handle || null,
    riskFlags,
    // True when authorship is claimed but the commit pattern looks like a dump
    // (a copied/AI-generated repo committed in one shot) rather than iterative
    // work. Downstream scoring uses this to refuse HIGH confidence on artifacts.
    lowAuthorshipConfidence: riskFlags.length > 0,
    authorshipVerified: (classification === 'authored' || classification === 'contributor') && riskFlags.length === 0,
  };
}

/* ============================================================
   ANALYSIS ASSEMBLY + SUMMARIES + PUBLIC-SAFE FILTER
   ============================================================ */
export function buildRepoAnalysis(repo = {}, fetched = {}, opts = {}) {
  const files = sanitizeRepoFilesForAnalysis(fetched.files || {});
  const detectedStack = detectRepoStack(files, repo);
  const detectedSkills = detectRepoSkills(files, repo);
  const { score, level, factors } = calculateRepoProofScore(repo, files, fetched.commitSignals || {});

  // Authorship is computed whenever we know who the connected identity is. When
  // unknown it degrades to a non-authorship "detected" classification — the
  // analysis still works, the skills just can't claim authorship.
  const authorship = verifyRepoAuthorship({
    repo,
    commitSignals: fetched.commitSignals || {},
    identityHandle: opts.identityHandle || '',
  });

  const fs = fileSet(files);
  const evidence = [];
  const push = (key, label, present) => evidence.push({ key, label, present: !!present });
  push('readme', 'README detected', !!fs.readme);
  push('dependencies', 'Dependency manifest detected', fs.has('package.json') || fs.has('requirements.txt') || fs.has('pyproject.toml') || fs.has('pom.xml') || fs.has('build.gradle') || fs.has('go.mod') || fs.has('cargo.toml'));
  push('source', 'Source structure detected', fs.hasGlob(/(^|\/)(src|app|lib)\//) || fs.has('main.py') || fs.has('server.js') || fs.has('app.js'));
  push('tests', 'Tests detected', fs.hasGlob(/(^|\/)(tests?|__tests__|spec)\//));
  push('cicd', 'CI/CD workflow detected', fs.hasGlob(/^\.github\/workflows\/.+\.ya?ml$/) || fs.has('jenkinsfile'));
  push('docker', 'Dockerfile detected', fs.has('dockerfile') || fs.has('docker-compose.yml') || fs.has('docker-compose.yaml'));
  push('kubernetes', 'Kubernetes manifests detected', fs.hasGlob(/(^|\/)(k8s|kubernetes|helm)\/.+\.ya?ml$/));
  push('terraform', 'Terraform / IaC detected', fs.hasGlob(/\.tf$/));
  push('commits', 'Recent commits detected', Number(fetched.commitSignals?.recentCommits || 0) > 0);

  const missing = evidence.filter((e) => !e.present).map((e) => e.label);
  const recommendations = [];
  if (!fs.readme) recommendations.push('Add a README with setup, usage and results.');
  if (!evidence.find((e) => e.key === 'tests')?.present) recommendations.push('Add a tests/ folder with at least a few tests.');
  if (!evidence.find((e) => e.key === 'cicd')?.present) recommendations.push('Add a CI workflow (GitHub Actions / Jenkins) for build + test.');
  if (!evidence.find((e) => e.key === 'docker')?.present) recommendations.push('Add a Dockerfile or deploy config to prove it ships.');

  return {
    repoFullName: repo.fullName,
    visibility: repo.private ? 'private' : 'public',
    analyzedAt: new Date().toISOString(),
    status: fetched.truncated ? 'partial' : 'complete',
    score,
    level,
    detectedStack,
    detectedSkills,
    evidence,
    missing,
    recommendations,
    filesInspected: Number(fetched.filesInspected || Object.keys(files).length),
    structure: fetched.structure || [],
    commitSignals: fetched.commitSignals || {},
    qualitySignals: factors,
    securityWarnings: [],
    truncated: !!fetched.truncated,
    authorship,
  };
}

export function generateRepoVerificationSummary(analysis = {}) {
  const stack = (analysis.detectedStack || []).slice(0, 6).join(', ') || 'general code';
  const present = (analysis.evidence || []).filter((e) => e.present).length;
  return `${analysis.repoFullName || 'Repository'} — ${analysis.level || 'analysis complete'} (${analysis.score || 0}/100). Detected ${stack}. ${present} proof signal(s) found across README, source, tests, CI/CD and deployment.`;
}

export function generatePublicSafeRepoSummary(analysis = {}) {
  const isPrivate = analysis.visibility === 'private';
  const categories = (analysis.evidence || []).filter((e) => e.present).map((e) => e.label);
  return {
    verified: true,
    visibility: analysis.visibility || 'public',
    label: isPrivate ? 'Private repository verified' : 'Public repository verified',
    proofScore: analysis.score || 0,
    proofLevel: analysis.level || '',
    detectedSkills: (analysis.detectedSkills || []).slice(0, 12),
    evidenceCategories: categories,
    repoName: isPrivate ? null : (analysis.repoFullName || null),
  };
}

export function mapRepoEvidenceToSkills(analysis = {}) {
  const skills = analysis.detectedSkills || [];
  const authorship = analysis.authorship || {};
  // The verification method (and therefore the confidence ceiling) a skill can
  // claim is dictated by authorship, NOT by mere detection. Authored repo ->
  // the skill can be a high-confidence authored credential. Detected-only ->
  // medium "detected" at best. A fork the user didn't commit to -> the skill is
  // surfaced but explicitly NOT attributed as their work.
  const method = authorship.method || 'github_repo_detected';
  const attributable = authorship.classification !== 'fork' && authorship.classification !== 'unverified'
    ? true
    : authorship.classification === 'unverified'; // unverified can still be "detected", forks cannot be attributed
  return skills.map((name) => ({
    skill: name,
    source: 'github_repo',
    repoFullName: analysis.visibility === 'private' ? null : (analysis.repoFullName || null),
    visibility: analysis.visibility || 'public',
    proofScore: analysis.score || 0,
    method,
    authorshipClassification: authorship.classification || 'unverified',
    attributable,
    status: authorship.authorshipVerified ? 'authorship_verified' : 'evidence_detected',
  }));
}

export function filterPrivateRepoDataForPublicView(analysis = {}, repoFlags = {}) {
  const isPrivate = analysis.visibility === 'private';
  if (isPrivate) {
    if (!repoFlags.privateProofSummaryVisible) return null;
    return generatePublicSafeRepoSummary(analysis);
  }
  if (!repoFlags.publicProofVisible) return null;
  return {
    ...generatePublicSafeRepoSummary(analysis),
    repoName: analysis.repoFullName || null,
    htmlUrl: repoFlags.htmlUrl || null,
  };
}

/* ============================================================
   CAREER PROOF SCORE CONTRIBUTION FROM GITHUB EVIDENCE
   ============================================================ */
export function githubProofContribution({ identityConnected = false, appInstalled = false, analyzedRepos = [] } = {}) {
  let publicPoints = 0;
  let privatePoints = 0;
  const detail = {};

  detail.identity = identityConnected ? 6 : 0;
  publicPoints += detail.identity;

  detail.app = appInstalled ? 4 : 0;
  publicPoints += detail.app;

  const repos = Array.isArray(analyzedRepos) ? analyzedRepos : [];
  const publicAnalyzed = repos.filter((r) => r.visibility !== 'private');
  const privateAnalyzed = repos.filter((r) => r.visibility === 'private');

  const repoPoints = (list) => Math.min(15, list.reduce((s, r) => s + Math.round((Number(r.score || 0) / 100) * 5), 0));
  detail.publicRepos = repoPoints(publicAnalyzed);
  detail.privateRepos = repoPoints(privateAnalyzed);
  publicPoints += detail.publicRepos;
  privatePoints += detail.privateRepos + detail.publicRepos;

  const distinctSkills = new Set(repos.flatMap((r) => r.detectedSkills || [])).size;
  detail.skillBreadth = Math.min(5, Math.round(distinctSkills / 2));
  publicPoints += detail.skillBreadth;
  privatePoints += detail.skillBreadth;

  // Authorship bonus: provably-authored repos are worth more than repos we
  // could only detect, because that is exactly the distinction a recruiter
  // cares about. Repos with no authorship metadata contribute nothing here, so
  // this is purely additive and never lowers an existing score. The overall
  // cap still bounds the result.
  const authoredCount = repos.filter((r) => r.authorship?.authorshipVerified || r.authorship?.classification === 'authored').length;
  detail.authoredRepos = authoredCount;
  detail.authorshipBonus = Math.min(6, authoredCount * 3);
  publicPoints += detail.authorshipBonus;
  privatePoints += detail.authorshipBonus;

  const TOTAL_CAP = 30;
  return {
    publicContribution: Math.min(TOTAL_CAP, publicPoints),
    privateContribution: Math.min(TOTAL_CAP, privatePoints + detail.identity + detail.app),
    cap: TOTAL_CAP,
    detail,
  };
}

export default {
  githubOAuthConfig, githubAppConfig, githubOAuthEnabled, githubAppEnabled, normalizePrivateKey,
  encryptionConfigured, encryptToken, decryptToken,
  normalizeGitHubUser, normalizeGitHubRepo, calculateGitHubStats,
  fetchOAuthProfileAndStats, fetchPrimaryEmail, exchangeOAuthCode,
  generateGitHubAppJwt, createInstallationToken, fetchInstallationMeta, fetchInstallationRepositories,
  isSecretLikePath, isAllowedProofFile, sanitizeRepoFilesForAnalysis, fetchSafeRepoFiles, ANALYSIS_LIMITS,
  detectRepoStack, detectRepoSkills, calculateRepoProofScore, buildRepoAnalysis,
  verifyRepoAuthorship,
  generateRepoVerificationSummary, generatePublicSafeRepoSummary, mapRepoEvidenceToSkills,
  filterPrivateRepoDataForPublicView, githubProofContribution,
};
