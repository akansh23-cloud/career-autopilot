/* ============================================================
   SUPPORT KNOWLEDGE BASE
   Ground truth for the support chatbot. The bot answers from THIS first
   and only falls back to the AI model (grounded on these same entries)
   when nothing matches — so it never hallucinates platform behaviour.
   ============================================================ */

export const FAQS = [
  { id: 'signin', category: 'Account', q: 'How do I sign in?',
    a: 'Click "Sign in with Google" on the landing page or the top-right of the app. You\'ll be redirected to Google, choose your account, and you\'re back in — signed in. A demo sign-in is also available when Google OAuth isn\'t configured.',
    keywords: ['sign in', 'signin', 'login', 'log in', 'google sign'] },
  { id: 'signout', category: 'Account', q: 'How do I sign out?',
    a: 'Open the profile menu in the top-right (your avatar) and choose "Sign out". This clears your session immediately.',
    keywords: ['sign out', 'signout', 'logout', 'log out'] },
  { id: 'google-login-fail', category: 'Account', q: 'Why is Google login not working?',
    a: 'Three common causes: (1) the server is missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, (2) the redirect URI in Google Cloud Console doesn\'t exactly match GOOGLE_REDIRECT_URI, or (3) third-party cookies are blocked in your browser. Check those in order. The redirect URI must match character-for-character including https and the /auth/google/callback path.',
    keywords: ['google login', 'login not working', 'oauth fail', 'cant sign in', 'cannot login'] },
  { id: 'blank-page', category: 'Deployment', q: 'Why am I seeing a blank page after deployment?',
    a: 'A white page on Vercel almost always means the built frontend (dist/) isn\'t being served as static files, so /assets/*.js returns HTML and the browser throws "Unexpected token <". Use a dual-build vercel.json: one @vercel/static-build for the frontend (distDir: dist) and one @vercel/node for server.js, then route only API prefixes to server.js, handle the filesystem, and SPA-fallback everything else to /index.html. This project already ships that config.',
    keywords: ['blank page', 'white page', 'white screen', 'unexpected token', 'assets 404', 'deployment blank'] },
  { id: 'upload-resume', category: 'Resume', q: 'How do I upload my resume?',
    a: 'Go to the Resume tab and either drag-and-drop your file onto the upload box or click it to browse. The text is parsed in your browser, then you can run the ATS analysis. You can also paste resume text directly instead of uploading.',
    keywords: ['upload resume', 'add resume', 'resume upload', 'drop resume'] },
  { id: 'resume-formats', category: 'Resume', q: 'What resume formats are supported?',
    a: 'PDF, DOCX, TXT and Markdown. PDFs and DOCX are parsed locally in your browser. Old .doc files aren\'t supported — export them as PDF or DOCX first.',
    keywords: ['resume format', 'file format', 'pdf docx', 'supported formats', 'doc support'] },
  { id: 'ats', category: 'Resume', q: 'How does ATS score work?',
    a: 'The ATS score (0–100) estimates how well an applicant-tracking system would parse and rank your resume for a target role. It weighs keyword coverage, measurable impact, formatting clarity and relevance, and lists missing keywords plus concrete fixes. Add a target role for a sharper score.',
    keywords: ['ats score', 'ats', 'resume score', 'applicant tracking'] },
  { id: 'job-match', category: 'Jobs', q: 'How does job matching work?',
    a: 'Job search pulls real, currently-open listings from verified sources, filters them by your role, location, work mode and freshness window, verifies the links, and ranks the newest first. Listings are never AI-generated.',
    keywords: ['job match', 'matching', 'how jobs work', 'job search work'] },
  { id: 'jobs-not-loading', category: 'Jobs', q: 'Why are jobs not loading?',
    a: 'Make sure you\'re signed in (job search is a protected feature), then try a broader role, clear the location, or widen the "posted within" window. If a specific country returns little, remember country filtering now excludes roles tied to other regions — switch to a worldwide/remote-friendly search to see more.',
    keywords: ['jobs not loading', 'no jobs', 'empty jobs', 'jobs blank', 'cant find jobs'] },
  { id: 'linkedin', category: 'Jobs', q: 'How do I connect LinkedIn?',
    a: 'Open Settings and add your LinkedIn profile URL. The optional LinkedIn connector (for richer integrations) is only active if the server has LinkedIn OAuth credentials configured.',
    keywords: ['connect linkedin', 'linkedin', 'link linkedin'] },
  { id: 'linkedin-dev', category: 'Jobs', q: 'Do I need a LinkedIn developer account?',
    a: 'No — adding your LinkedIn profile URL needs nothing. A LinkedIn developer app (client ID/secret) is only required if the operator wants to enable the deeper LinkedIn OAuth connector, which is optional.',
    keywords: ['linkedin developer', 'developer account', 'linkedin api'] },
  { id: 'recruiters', category: 'Outreach', q: 'How do I contact recruiters?',
    a: 'Use the Outreach tab: enter a company name or domain to find hiring contacts, then let the AI draft a personalised outreach message you can copy and send.',
    keywords: ['contact recruiter', 'recruiters', 'outreach', 'find contacts', 'hiring contact'] },
  { id: 'data-stored', category: 'Privacy', q: 'How is my data stored?',
    a: 'Your sign-in identity (name, email, avatar, provider) is stored securely in the database when configured. We store only safe profile fields — never your Google password or access tokens. Resume text you paste/upload is processed for analysis and is not sold or shared.',
    keywords: ['data stored', 'how data', 'where data', 'store my data'] },
  { id: 'resume-safe', category: 'Privacy', q: 'Is my resume data safe?',
    a: 'Resume files are parsed in your browser; the extracted text is sent only to the AI analysis endpoint to score it. We don\'t sell or share your resume. You can request deletion of your stored data anytime from Settings → Data & Privacy.',
    keywords: ['resume safe', 'data safe', 'is my data secure', 'privacy resume'] },
  { id: 'delete-account', category: 'Privacy', q: 'How do I delete my account/data?',
    a: 'Go to Settings → Data & Privacy and click "Request data deletion". That opens a pre-filled support ticket; once submitted, your record is deactivated and queued for removal. You\'ll get a confirmation.',
    keywords: ['delete account', 'delete data', 'remove account', 'erase data', 'gdpr'] },
  { id: 'ai-slow', category: 'AI', q: 'Why is the AI response slow?',
    a: 'AI features call a hosted model, so responses take a few seconds — longer for big resumes or long job descriptions. If it stalls, shorten the input or retry. Slowness usually means a busy upstream model, not an error.',
    keywords: ['ai slow', 'slow response', 'taking long', 'ai lag'] },
  { id: 'api-keys', category: 'Setup', q: 'How do I update API keys?',
    a: 'Server-side keys (ANTHROPIC_API_KEY, etc.) live in your .env file or your Vercel project Environment Variables. Update them there and redeploy/restart. Never commit keys to git or paste them into chat.',
    keywords: ['api key', 'update key', 'anthropic key', 'change key'] },
  { id: 'deploy-vercel', category: 'Deployment', q: 'How do I deploy on Vercel?',
    a: 'Push the repo to GitHub and import it in Vercel. Keep the included vercel.json (dual build: static frontend + Express function). Set Environment Variables (MONGODB_URI, SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI, FRONTEND_ORIGIN, ANTHROPIC_API_KEY). Build command is the default — vercel.json handles the rest. Then add your Vercel callback URL to Google Cloud Console.',
    keywords: ['deploy vercel', 'vercel deploy', 'how to deploy', 'hosting'] },
  { id: 'oauth-mismatch', category: 'Deployment', q: 'Why am I seeing OAuth redirect mismatch?',
    a: 'Google returns "redirect_uri_mismatch" when the URI it receives isn\'t in your Google Cloud Console "Authorized redirect URIs". Add the exact callback — e.g. https://your-app.vercel.app/auth/google/callback — and set the same value as GOOGLE_REDIRECT_URI on the server. It must match exactly: scheme, host, and path.',
    keywords: ['redirect mismatch', 'redirect_uri_mismatch', 'oauth redirect', 'redirect uri'] },
  { id: 'report-bug', category: 'Support', q: 'How do I report a bug?',
    a: 'Use this support chat — pick "Contact support" or create a ticket with the steps to reproduce, what you expected, and what happened. Screenshots help. We\'ll track it by ticket ID.',
    keywords: ['report bug', 'bug', 'something broke', 'error', 'found a bug'] },
  { id: 'feature-request', category: 'Support', q: 'How do I request a new feature?',
    a: 'Create a support ticket with category "Feature request" describing what you\'d like and why. Feature ideas are reviewed regularly.',
    keywords: ['feature request', 'request feature', 'suggest', 'new feature', 'idea'] },
];

export const QUICK_ACTIONS = [
  { label: 'Login issue', seed: 'Why is Google login not working?' },
  { label: 'Resume upload', seed: 'How do I upload my resume?' },
  { label: 'Job search', seed: 'Why are jobs not loading?' },
  { label: 'Deployment issue', seed: 'Why am I seeing a blank page after deployment?' },
  { label: 'Data privacy', seed: 'How is my data stored?' },
  { label: 'Contact support', seed: '__ticket__' },
];

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'do', 'how', 'why', 'i', 'my', 'to', 'of', 'in', 'on', 'and', 'for', 'with', 'me', 'it', 'you', 'your', 'what', 'can', 'does']);
function toks(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
}

/* Score a user message against each FAQ; return best match + related. */
export function matchFaq(message) {
  const qt = toks(message);
  if (!qt.length) return { best: null, score: 0, related: [] };
  const scored = FAQS.map((f) => {
    const hay = (f.q + ' ' + f.keywords.join(' ') + ' ' + f.a).toLowerCase();
    let score = 0;
    for (const t of qt) if (hay.includes(t)) score += 1;
    // strong boost when a full keyword phrase appears in the message
    for (const k of f.keywords) if (message.toLowerCase().includes(k)) score += 3;
    return { f, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const related = scored.slice(1, 4).filter((s) => s.score > 0).map((s) => s.f);
  return { best: best.score > 0 ? best.f : null, score: best.score, related };
}
