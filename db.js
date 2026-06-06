/* ============================================================
   DATABASE LAYER  (MongoDB Atlas + Mongoose)
   - Serverless-safe: the connection promise is cached on globalThis so
     Vercel function invocations reuse one pool instead of reconnecting.
   - Fully optional: if MONGODB_URI is not set, every helper degrades to a
     safe no-op and the app keeps working with session/cookie-only auth.
   - Stores ONLY safe profile data. Never stores Google access tokens.
   ============================================================ */
import mongoose from 'mongoose';

const URI = process.env.MONGODB_URI || '';
export const dbEnabled = () => !!URI;

/* ---- cached connection (survives serverless warm starts) ---- */
let cached = globalThis.__careerDb;
if (!cached) cached = globalThis.__careerDb = { conn: null, promise: null };

export async function connectDB() {
  if (!URI) return null;
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose
      .connect(URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 })
      .then((m) => m)
      .catch((err) => { cached.promise = null; throw err; });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

/* ---- schemas ---- */
const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, index: true, sparse: true },
    email: { type: String, index: true, lowercase: true, trim: true },
    name: { type: String, trim: true },
    avatar: { type: String, default: null },
    provider: { type: String, default: 'google' },
    role: { type: String, default: 'user', enum: ['user', 'admin'] },
    lastLoginAt: { type: Date, default: Date.now },
    loginCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true } // createdAt + updatedAt
);

const ticketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    category: { type: String, default: 'general', trim: true },
    subject: { type: String, trim: true },
    message: { type: String, trim: true },
    status: { type: String, default: 'open', enum: ['open', 'pending', 'resolved', 'closed'] },
    priority: { type: String, default: 'normal', enum: ['low', 'normal', 'high', 'urgent'] },
  },
  { timestamps: true }
);

/* ---- per-user career data (all keyed by userId, never shared across users) ----
   These collections start EMPTY for a new user. The dashboard summary aggregates
   from them, so a fresh account naturally returns zeros and empty arrays — no
   demo/sample data is ever seeded into a real user's records. */
const resumeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fileName: { type: String, trim: true },
    score: { type: Number, default: null }, // ATS score 0–100
    delta: { type: Number, default: null },
  },
  { timestamps: true }
);

const applicationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    company: { type: String, trim: true },
    role: { type: String, trim: true },
    stage: { type: String, default: 'saved', enum: ['saved', 'applied', 'interview', 'offer', 'rejected'], index: true },
    recruiterReplied: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const outreachSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: String, trim: true },
    channel: { type: String, default: 'email', trim: true },
  },
  { timestamps: true }
);

const activitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, trim: true },
    tone: { type: String, default: 'cyan', trim: true },
  },
  { timestamps: true }
);


const userStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },
    resume: { type: mongoose.Schema.Types.Mixed, default: {} },
    projects: { type: [mongoose.Schema.Types.Mixed], default: [] },
    tracker: { type: mongoose.Schema.Types.Mixed, default: {} },
    xpSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

/* avoid OverwriteModelError on hot-reload / warm starts */
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const SupportTicket =
  mongoose.models.SupportTicket || mongoose.model('SupportTicket', ticketSchema);
export const Resume = mongoose.models.Resume || mongoose.model('Resume', resumeSchema);
export const Application =
  mongoose.models.Application || mongoose.model('Application', applicationSchema);
export const Outreach = mongoose.models.Outreach || mongoose.model('Outreach', outreachSchema);
export const Activity = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
export const UserState = mongoose.models.UserState || mongoose.model('UserState', userStateSchema);

/* ---- public shape (only safe fields ever leave the server) ---- */
export function publicUser(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id || doc.id),
    name: doc.name || null,
    email: doc.email || null,
    picture: doc.avatar || doc.picture || null,
    avatar: doc.avatar || doc.picture || null,
    provider: doc.provider || 'google',
    role: doc.role || 'user',
    createdAt: doc.createdAt || null,
    lastLoginAt: doc.lastLoginAt || null,
    loginCount: doc.loginCount || 0,
    isActive: doc.isActive !== false,
  };
}

/* ============================================================
   HELPERS — all are safe to call even when the DB is disabled.
   ============================================================ */

/* Upsert on every OAuth/dev login. Matches by googleId first, then email.
   Creates if missing, otherwise refreshes name/avatar/lastLoginAt/loginCount. */
export async function upsertUser({ googleId, email, name, avatar, provider }) {
  if (!URI) return null;
  try {
    await connectDB();
    const or = [];
    if (googleId) or.push({ googleId });
    if (email) or.push({ email: String(email).toLowerCase() });
    let user = or.length ? await User.findOne({ $or: or }) : null;

    if (user) {
      if (googleId && !user.googleId) user.googleId = googleId;
      if (name) user.name = name;
      if (avatar) user.avatar = avatar;
      if (provider) user.provider = provider;
      user.lastLoginAt = new Date();
      user.loginCount = (user.loginCount || 0) + 1;
      user.isActive = true;
      await user.save();
    } else {
      user = await User.create({
        googleId: googleId || undefined,
        email: email ? String(email).toLowerCase() : undefined,
        name, avatar: avatar || null, provider: provider || 'google',
        lastLoginAt: new Date(), loginCount: 1,
      });
    }
    return publicUser(user);
  } catch (err) {
    console.error('[db] upsertUser failed:', err.message);
    return null; // never block login on a DB hiccup
  }
}

export async function createTicket(payload) {
  if (!URI) return { ok: false, stored: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const t = await SupportTicket.create({
      userId: payload.userId || null,
      name: payload.name, email: payload.email,
      category: payload.category || 'general',
      subject: payload.subject, message: payload.message,
      priority: payload.priority || 'normal',
    });
    return {
      ok: true, stored: true,
      ticket: { id: String(t._id), subject: t.subject, category: t.category, status: t.status, priority: t.priority, createdAt: t.createdAt },
    };
  } catch (err) {
    console.error('[db] createTicket failed:', err.message);
    return { ok: false, stored: false, reason: 'db_error', error: err.message };
  }
}

export async function ticketsByUser({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const or = [];
    if (userId) or.push({ userId });
    if (email) or.push({ email: String(email).toLowerCase() });
    if (!or.length) return [];
    const rows = await SupportTicket.find({ $or: or }).sort({ createdAt: -1 }).limit(50).lean();
    return rows.map((t) => ({
      id: String(t._id), subject: t.subject, category: t.category, message: t.message,
      status: t.status, priority: t.priority, createdAt: t.createdAt, updatedAt: t.updatedAt,
    }));
  } catch (err) {
    console.error('[db] ticketsByUser failed:', err.message);
    return [];
  }
}


function isObjectId(id) { return id && mongoose.isValidObjectId(id); }
function cleanEmail(email) { return email ? String(email).trim().toLowerCase() : ''; }
async function resolveUserId({ userId, email }) {
  if (isObjectId(userId)) return new mongoose.Types.ObjectId(userId);
  const em = cleanEmail(email);
  if (!em) return null;
  const u = await User.findOne({ email: em }).select('_id').lean();
  return u?._id || null;
}

export async function getUserState({ userId, email }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const doc = await UserState.findOne({ userId: uid }).lean();
    if (!doc) return { profile: {}, resume: {}, projects: [], tracker: {}, xpSnapshot: {} };
    return {
      profile: doc.profile || {},
      resume: doc.resume || {},
      projects: Array.isArray(doc.projects) ? doc.projects : [],
      tracker: doc.tracker || {},
      xpSnapshot: doc.xpSnapshot || {},
      updatedAt: doc.updatedAt || null,
    };
  } catch (err) {
    console.error('[db] getUserState failed:', err.message);
    return null;
  }
}

export async function patchUserState({ userId, email, patch }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const em = cleanEmail(email);
    const allowed = ['profile', 'resume', 'projects', 'tracker', 'xpSnapshot'];
    const set = { email: em };
    for (const k of allowed) if (Object.prototype.hasOwnProperty.call(patch || {}, k)) set[k] = patch[k];
    await UserState.updateOne({ userId: uid }, { $set: set }, { upsert: true });
    return { ok: true };
  } catch (err) {
    console.error('[db] patchUserState failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function saveResumeSnapshot({ userId, email, resume }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const score = Number(resume?.analysis?.score ?? resume?.analysis?.ats ?? NaN);
    await patchUserState({ userId: uid, email, patch: { resume } });
    if (!Number.isNaN(score)) {
      await Resume.create({ userId: uid, fileName: resume?.fileName || '', score: Math.max(0, Math.min(100, Math.round(score))), delta: null });
      await Activity.create({ userId: uid, text: `Analyzed resume${resume?.targetRole ? ` for ${resume.targetRole}` : ''} — ATS score ${Math.round(score)}/100`, tone: score >= 75 ? 'mint' : 'cyan' });
    }
    return { ok: true };
  } catch (err) {
    console.error('[db] saveResumeSnapshot failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* The canonical "new user" dashboard shape: every metric zeroed, every list empty.
   Used as the baseline and returned verbatim when the DB is off or the user has
   no records yet. Guarantees a fresh account never sees fabricated stats. */
export function emptyDashboardSummary() {
  return {
    resumeScore: null,
    resumeDelta: null,
    liveApplications: 0,
    recruiterReplies: 0,
    outreachSent: 0,
    funnel: { saved: 0, applied: 0, interview: 0, offer: 0 },
    weekly: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [0, 0, 0, 0, 0, 0, 0] },
    activity: [],   // [{ text, when, tone }]
    matches: [],    // populated only after the user runs a real job search
  };
}

/* Build a user-specific dashboard summary purely from that user's own records.
   No cross-user reads, no global/sample data. New user with no records → zeros. */
export async function dashboardSummary({ userId }) {
  const summary = emptyDashboardSummary();
  if (!URI || !userId || !mongoose.isValidObjectId(userId)) return summary;
  try {
    await connectDB();
    const uid = new mongoose.Types.ObjectId(userId);

    const [latestResume, apps, recruiterReplies, outreachSent, recentActivity] = await Promise.all([
      Resume.findOne({ userId: uid }).sort({ createdAt: -1 }).lean(),
      Application.find({ userId: uid }).select('stage createdAt').lean(),
      Application.countDocuments({ userId: uid, recruiterReplied: true }),
      Outreach.countDocuments({ userId: uid }),
      Activity.find({ userId: uid }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);

    if (latestResume && typeof latestResume.score === 'number') {
      summary.resumeScore = latestResume.score;
      summary.resumeDelta = typeof latestResume.delta === 'number' ? latestResume.delta : null;
    }

    for (const a of apps) {
      if (summary.funnel[a.stage] != null) summary.funnel[a.stage] += 1;
    }
    // "Live" = anything actively in the pipeline (excludes saved + rejected).
    summary.liveApplications = summary.funnel.applied + summary.funnel.interview + summary.funnel.offer;
    summary.recruiterReplies = recruiterReplies || 0;
    summary.outreachSent = outreachSent || 0;

    // Weekly application activity (Mon→Sun of the current week, user's records only).
    const now = new Date();
    const day = (now.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - day);
    for (const a of apps) {
      const created = a.createdAt ? new Date(a.createdAt) : null;
      if (!created || created < monday) continue;
      const idx = Math.floor((created - monday) / 86400000);
      if (idx >= 0 && idx < 7) summary.weekly.values[idx] += 1;
    }

    const rel = (d) => {
      const diff = Date.now() - new Date(d).getTime();
      const h = Math.floor(diff / 3600000);
      if (h < 1) return 'Just now';
      if (h < 24) return `${h}h ago`;
      const days = Math.floor(h / 24);
      return days === 1 ? 'Yesterday' : `${days}d ago`;
    };
    summary.activity = recentActivity.map((a) => ({ text: a.text, when: rel(a.createdAt), tone: a.tone || 'cyan' }));

    return summary;
  } catch (err) {
    console.error('[db] dashboardSummary failed:', err.message);
    return summary; // degrade to the empty (zeroed) shape — never fabricate
  }
}

/* Fetch a single user (enriches /auth/me with role + dates after cold starts). */
export async function getUser({ id, googleId, email }) {
  if (!URI) return null;
  try {
    await connectDB();
    const or = [];
    if (id && mongoose.isValidObjectId(id)) or.push({ _id: id });
    if (googleId) or.push({ googleId });
    if (email) or.push({ email: String(email).toLowerCase() });
    if (!or.length) return null;
    const doc = await User.findOne({ $or: or }).lean();
    return doc ? publicUser(doc) : null;
  } catch (err) {
    console.error('[db] getUser failed:', err.message);
    return null;
  }
}

/* Soft-delete / deactivate a user's record (used by privacy data-deletion flow). */
export async function deactivateUser({ userId, email }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const q = userId ? { _id: userId } : email ? { email: String(email).toLowerCase() } : null;
    if (!q) return { ok: false, reason: 'no_identifier' };
    await User.updateOne(q, { $set: { isActive: false } });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* ============================================================
   CAREER PROOF NETWORK  (proof-based career network layer)
   ------------------------------------------------------------
   Cross-user collections that power the recruiter-visible profiles,
   segmented leaderboards, structured referral exchange and community
   feed. All are keyed by userId and degrade to safe no-ops when the
   DB is disabled (the frontend then falls back to user-scoped local
   storage). Trust score is ALWAYS recomputed server-side from objective
   inputs — the client can never set it directly.
   ============================================================ */

const networkProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    name: { type: String, trim: true },
    picture: { type: String, default: null },
    role: { type: String, default: 'student' },
    targetRole: { type: String, trim: true, default: '' },
    track: { type: String, default: '', index: true },         // derived leaderboard bucket
    yearSem: { type: String, default: '' },
    location: { type: String, default: '' },
    college: { type: String, default: '' },
    company: { type: String, default: '' },
    currentCompany: { type: String, default: '' },
    experience: { type: String, default: '' },
    links: { type: mongoose.Schema.Types.Mixed, default: {} },          // {github, linkedin, portfolio}
    visibility: { type: String, default: 'private', enum: ['private', 'published_only', 'public'] },
    openToRecruiters: { type: Boolean, default: false },
    openToReferrals: { type: Boolean, default: false },
    openToCollaboration: { type: Boolean, default: false },
    openToInternships: { type: Boolean, default: false },
    openToJobs: { type: Boolean, default: false },
    showEmail: { type: Boolean, default: false },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },        // derived snapshot (XP/proof/badges/readiness/streak/projects)
    engagement: { type: mongoose.Schema.Types.Mixed, default: { shortlistCount: 0, contactCount: 0, referralSuccess: 0, spamReports: 0, fakeReports: 0 } },
    trustScore: { type: Number, default: 0 },                  // recomputed server-side only
    trustLevel: { type: String, default: 'New' },
    completeness: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false }
);

const referralPostSchema = new mongoose.Schema(
  {
    authorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, trim: true },
    authorPicture: { type: String, default: null },
    authorTrust: { type: Number, default: 0 },
    type: { type: String, required: true, index: true },       // need_referral | offering_referral | mutual | interview_exp | hiring_alert | collab | showcase | startup_idea
    fields: { type: mongoose.Schema.Types.Mixed, default: {} },
    reports: { type: Number, default: 0 },
    status: { type: String, default: 'open', enum: ['open', 'closed', 'flagged'] },
  },
  { timestamps: true, minimize: false }
);

const referralRequestSchema = new mongoose.Schema(
  {
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReferralPost', default: null },
    kind: { type: String, default: 'request' },                // request | offer
    message: { type: String, trim: true, default: '' },
    status: { type: String, default: 'sent', enum: ['sent', 'accepted', 'declined'] },
  },
  { timestamps: true }
);

const shortlistSchema = new mongoose.Schema(
  {
    recruiterUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    candidateUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);
shortlistSchema.index({ recruiterUserId: 1, candidateUserId: 1 }, { unique: true });

export const NetworkProfile = mongoose.models.NetworkProfile || mongoose.model('NetworkProfile', networkProfileSchema);
export const ReferralPost = mongoose.models.ReferralPost || mongoose.model('ReferralPost', referralPostSchema);
export const ReferralRequest = mongoose.models.ReferralRequest || mongoose.model('ReferralRequest', referralRequestSchema);
export const Shortlist = mongoose.models.Shortlist || mongoose.model('Shortlist', shortlistSchema);

/* ---- trust score (objective inputs only, recomputed server-side) ---- */
export function computeTrust(metrics = {}, engagement = {}, completeness = 0) {
  let s = 0;
  if (completeness >= 70) s += 20; else if (completeness >= 40) s += 10;
  if (metrics.hasGithub) s += 20;
  if (metrics.hasLinkedinOrPortfolio) s += 10;
  if ((metrics.verifiedBadges || 0) > 0) s += Math.min(20, (metrics.verifiedBadges || 0) * 7);
  if ((engagement.referralSuccess || 0) > 0) s += Math.min(20, (engagement.referralSuccess || 0) * 10);
  if ((engagement.shortlistCount || 0) + (engagement.contactCount || 0) > 0) s += 10;
  s -= (engagement.spamReports || 0) * 8;
  s -= (engagement.fakeReports || 0) * 12;
  const score = Math.max(0, Math.min(100, Math.round(s)));
  const level = score >= 80 ? 'Highly Trusted' : score >= 55 ? 'Trusted' : score >= 25 ? 'Building Trust' : 'New';
  return { score, level };
}

function networkPublicView(doc, { isOwner = false, isRecruiter = false } = {}) {
  if (!doc) return null;
  const links = doc.links || {};
  const base = {
    userId: String(doc.userId), name: doc.name || 'Member', picture: doc.picture || null,
    role: doc.role, targetRole: doc.targetRole || '', track: doc.track || '',
    visibility: doc.visibility, openToRecruiters: !!doc.openToRecruiters,
    openToReferrals: !!doc.openToReferrals, openToCollaboration: !!doc.openToCollaboration,
    openToInternships: !!doc.openToInternships, openToJobs: !!doc.openToJobs,
    location: doc.visibility === 'public' || isOwner ? (doc.location || '') : '',
    college: doc.college || '', company: doc.company || '',
    links: { github: links.github || '', linkedin: links.linkedin || '', portfolio: links.portfolio || '' },
    metrics: doc.metrics || {},
    trustScore: doc.trustScore || 0, trustLevel: doc.trustLevel || 'New',
    completeness: doc.completeness || 0,
    updatedAt: doc.updatedAt || null,
  };
  if (isOwner) {
    base.email = doc.email || '';
    base.showEmail = !!doc.showEmail;
    base.experience = doc.experience || '';
    base.currentCompany = doc.currentCompany || '';
    base.yearSem = doc.yearSem || '';
  } else if (doc.showEmail) {
    base.email = doc.email || '';
  }
  return base;
}

export async function upsertNetworkProfile({ userId, email, payload = {} }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const existing = await NetworkProfile.findOne({ userId: uid });
    const engagement = (existing && existing.engagement) || { shortlistCount: 0, contactCount: 0, referralSuccess: 0, spamReports: 0, fakeReports: 0 };
    const metrics = payload.metrics || {};
    const completeness = Math.max(0, Math.min(100, Number(payload.completeness || 0)));
    const trust = computeTrust(metrics, engagement, completeness);
    const set = {
      email: cleanEmail(email),
      name: payload.name, picture: payload.picture || null, role: payload.role || 'student',
      targetRole: payload.targetRole || '', track: payload.track || '',
      yearSem: payload.yearSem || '', location: payload.location || '',
      college: payload.college || '', company: payload.company || '',
      currentCompany: payload.currentCompany || '', experience: payload.experience || '',
      links: payload.links || {}, visibility: ['private', 'published_only', 'public'].includes(payload.visibility) ? payload.visibility : 'private',
      openToRecruiters: !!payload.openToRecruiters, openToReferrals: !!payload.openToReferrals,
      openToCollaboration: !!payload.openToCollaboration, openToInternships: !!payload.openToInternships,
      openToJobs: !!payload.openToJobs, showEmail: !!payload.showEmail,
      metrics, completeness, engagement,
      trustScore: trust.score, trustLevel: trust.level,
    };
    await NetworkProfile.updateOne({ userId: uid }, { $set: set }, { upsert: true });
    const doc = await NetworkProfile.findOne({ userId: uid }).lean();
    return { ok: true, profile: networkPublicView(doc, { isOwner: true }) };
  } catch (err) {
    console.error('[db] upsertNetworkProfile failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function getNetworkProfile({ viewerUserId, targetUserId, targetEmail }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const tid = await resolveUserId({ userId: targetUserId, email: targetEmail });
    if (!tid) return { ok: false, reason: 'not_found' };
    const doc = await NetworkProfile.findOne({ userId: tid }).lean();
    if (!doc) return { ok: false, reason: 'not_found' };
    const isOwner = viewerUserId && String(viewerUserId) === String(tid);
    if (!isOwner && doc.visibility === 'private') {
      return { ok: true, private: true, profile: { userId: String(tid), name: doc.name || 'Member', visibility: 'private' } };
    }
    return { ok: true, profile: networkPublicView(doc, { isOwner }) };
  } catch (err) {
    console.error('[db] getNetworkProfile failed:', err.message);
    return { ok: false, reason: 'db_error' };
  }
}

export async function listNetworkProfiles({ forRecruiter = false } = {}) {
  if (!URI) return [];
  try {
    await connectDB();
    const or = [{ visibility: 'public' }, { visibility: 'published_only' }];
    if (forRecruiter) or.push({ openToRecruiters: true });
    const docs = await NetworkProfile.find({ $or: or }).limit(500).lean();
    return docs.map((d) => networkPublicView(d, { isRecruiter: forRecruiter }));
  } catch (err) {
    console.error('[db] listNetworkProfiles failed:', err.message);
    return [];
  }
}

export async function createReferralPost({ userId, email, name, picture, type, fields }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const np = await NetworkProfile.findOne({ userId: uid }).select('trustScore').lean();
    const doc = await ReferralPost.create({
      authorUserId: uid, authorName: name || 'Member', authorPicture: picture || null,
      authorTrust: np?.trustScore || 0, type, fields: fields || {},
    });
    return { ok: true, post: serializeReferralPost(doc) };
  } catch (err) {
    console.error('[db] createReferralPost failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

function serializeReferralPost(d) {
  return {
    id: String(d._id), authorUserId: String(d.authorUserId), authorName: d.authorName,
    authorPicture: d.authorPicture || null, authorTrust: d.authorTrust || 0,
    type: d.type, fields: d.fields || {}, reports: d.reports || 0, status: d.status,
    createdAt: d.createdAt,
  };
}

export async function listReferralPosts({ type } = {}) {
  if (!URI) return [];
  try {
    await connectDB();
    const q = { status: { $ne: 'flagged' } };
    if (type) q.type = type;
    const docs = await ReferralPost.find(q).sort({ createdAt: -1 }).limit(300).lean();
    return docs.map(serializeReferralPost);
  } catch (err) {
    console.error('[db] listReferralPosts failed:', err.message);
    return [];
  }
}

export async function deleteReferralPost({ userId, email, postId }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !isObjectId(postId)) return { ok: false, reason: 'bad_request' };
    await ReferralPost.deleteOne({ _id: postId, authorUserId: uid });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function reportReferralPost({ postId }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    if (!isObjectId(postId)) return { ok: false, reason: 'bad_request' };
    const doc = await ReferralPost.findByIdAndUpdate(postId, { $inc: { reports: 1 } }, { new: true });
    if (doc && doc.reports >= 3 && doc.status === 'open') { doc.status = 'flagged'; await doc.save(); }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function countRecentReferralRequests({ userId, email, sinceMs }) {
  if (!URI) return 0;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return 0;
    return await ReferralRequest.countDocuments({ fromUserId: uid, createdAt: { $gte: new Date(Date.now() - sinceMs) } });
  } catch { return 0; }
}

export async function createReferralRequest({ userId, email, toUserId, postId, kind, message }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const doc = await ReferralRequest.create({
      fromUserId: uid, toUserId: isObjectId(toUserId) ? toUserId : null,
      postId: isObjectId(postId) ? postId : null, kind: kind === 'offer' ? 'offer' : 'request',
      message: String(message || '').slice(0, 2000),
    });
    return { ok: true, request: { id: String(doc._id), kind: doc.kind, status: doc.status, createdAt: doc.createdAt } };
  } catch (err) {
    console.error('[db] createReferralRequest failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function shortlistCandidate({ recruiterUserId, recruiterEmail, candidateUserId, note }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const rid = await resolveUserId({ userId: recruiterUserId, email: recruiterEmail });
    if (!rid || !isObjectId(candidateUserId)) return { ok: false, reason: 'bad_request' };
    await Shortlist.updateOne(
      { recruiterUserId: rid, candidateUserId },
      { $set: { note: String(note || '').slice(0, 500) } },
      { upsert: true }
    );
    const np = await NetworkProfile.findOne({ userId: candidateUserId });
    if (np) {
      const eng = np.engagement || {};
      eng.shortlistCount = (eng.shortlistCount || 0) + 1;
      np.engagement = eng;
      const trust = computeTrust(np.metrics || {}, eng, np.completeness || 0);
      np.trustScore = trust.score; np.trustLevel = trust.level;
      await np.save();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listShortlists({ recruiterUserId, recruiterEmail }) {
  if (!URI) return [];
  try {
    await connectDB();
    const rid = await resolveUserId({ userId: recruiterUserId, email: recruiterEmail });
    if (!rid) return [];
    const rows = await Shortlist.find({ recruiterUserId: rid }).sort({ createdAt: -1 }).limit(200).lean();
    return rows.map((s) => ({ candidateUserId: String(s.candidateUserId), note: s.note || '', createdAt: s.createdAt }));
  } catch { return []; }
}
