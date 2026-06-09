/* ============================================================
   Innovation OS — persistence layer
   ------------------------------------------------------------
   Registers its own Mongoose models on the SHARED singleton
   connection (reusing connectDB/dbEnabled from db.js) so db.js
   stays untouched. Every function degrades safely when the DB
   is disabled. All rows are scoped to userId — users never see
   each other's signals/clusters/projects.
   ============================================================ */
import mongoose from 'mongoose';
import { connectDB, dbEnabled, User } from '../../../db.js';
import { INNOVATION_STATUSES } from './config.js';

const isObjectId = (id) => id && mongoose.isValidObjectId(id);
const cleanEmail = (e) => (e ? String(e).trim().toLowerCase() : '');

async function resolveUserId({ userId, email }) {
  if (isObjectId(userId)) return new mongoose.Types.ObjectId(userId);
  const em = cleanEmail(email);
  if (!em) return null;
  const u = await User.findOne({ email: em }).select('_id').lean();
  return u?._id || null;
}

/* ---- schemas ---- */
const M = mongoose.Schema.Types.Mixed;
const citationSchema = new mongoose.Schema({ source: String, title: String, url: String }, { _id: false });

const problemSignalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  source: { type: String, index: true }, sourceUrl: String, sourceId: String,
  title: String, contentSummary: String, rawTextHash: { type: String, index: true },
  tags: { type: [String], default: [] }, engagement: { type: M, default: {} },
  sourceCreatedAt: Date, lastActivityAt: Date,
  extractedPainPoints: { type: [String], default: [] },
  domain: String, technology: String, targetUser: String,
  runId: { type: String, index: true },
}, { timestamps: true });

const problemClusterSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: String, summary: String, domain: { type: String, index: true }, technology: String, targetUser: String,
  signalIds: { type: [String], default: [] }, keywords: { type: [String], default: [] },
  signalCount: { type: Number, default: 0 }, sources: { type: [String], default: [] },
  topSources: { type: [citationSchema], default: [] },
  evidenceStrengthScore: Number, severityScore: Number, trendScore: Number,
  buildFeasibilityScore: Number, portfolioValueScore: Number, researchPotentialScore: Number,
  patentPotentialScore: Number, recommendedRoute: String,
  dedupeFingerprint: { type: String, index: true }, runId: { type: String, index: true },
}, { timestamps: true });

const generatedProjectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clusterId: { type: String, index: true },
  title: String, painPoint: String, affectedUsers: String, currentWorkaround: String,
  whyExistingSolutionsFail: String, whyNow: String, proposedSolution: String, noveltyAngle: String,
  framing: { type: M, default: {} },
  mvpScope: { type: [String], default: [] }, requiredSkills: { type: [String], default: [] },
  domain: String, technology: String, targetUser: String, purpose: String, difficulty: String,
  sourceBacked: Boolean, badge: String, sourcesUsed: Number, evidenceStrength: Number,
  confidence: String, aiProvider: String, sourceCitations: { type: [citationSchema], default: [] },
  buildBlueprint: { type: M, default: null }, costEstimate: { type: M, default: null },
  ipReadiness: { type: M, default: null }, disclosureDraft: { type: M, default: null },
  // ---- Patent OS world-class upgrade ----
  simplified: { type: M, default: null }, priorArtSearchPlan: { type: M, default: null },
  claimDirections: { type: M, default: null }, evidenceChecklist: { type: M, default: null },
  diagramPlan: { type: M, default: null }, experimentPlan: { type: M, default: null },
  indiaCri: { type: M, default: null },
  evidence: { type: [M], default: [] }, prototypeEvidenceScore: { type: Number, default: 0 },
  linkedGithubRepoId: { type: String, default: '' }, githubProofSummary: { type: M, default: null },
  contributionScore: { type: Number, default: 0 }, repoMaturityScore: { type: Number, default: 0 },
  sourceMix: { type: M, default: null }, communitySignalsCount: { type: Number, default: 0 },
  confidentialityStatus: { type: String, default: 'private' }, // private | shared_with_faculty | shared_with_ip_cell | public_safe
  publicDisclosureStatus: { type: String, default: 'unknown' }, // none | planned | already_disclosed | unknown
  disclosureDate: { type: String, default: '' }, disclosureChannel: { type: String, default: '' },
  fingerprint: { type: String, index: true },
  status: { type: String, default: 'source_backed_problem', enum: INNOVATION_STATUSES },
  proofRef: { type: M, default: null }, // application/publication/grant proof
  convertedProjectId: { type: String, default: '' }, convertedPatentIdeaId: { type: String, default: '' },
}, { timestamps: true });

const priorArtSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: String, required: true, index: true },
  sourceType: String, title: String, sourceUrl: String, summary: String,
  similarityRisk: String, technicalOverlap: String, differentiator: String, blockingRisk: String,
  reviewedBy: String,
}, { timestamps: true });

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
export const ProblemSignal = model('InnovationProblemSignal', problemSignalSchema);
export const ProblemCluster = model('InnovationProblemCluster', problemClusterSchema);
export const GeneratedInnovationProject = model('GeneratedInnovationProject', generatedProjectSchema);
export const InnovationPriorArtRecord = model('InnovationPriorArtRecord', priorArtSchema);

const out = (d) => (d ? { ...d, id: String(d._id) } : d);

/* ---- persistence (all safe when DB disabled) ---- */
export async function saveDiscovery({ userId, email, runId, signals = [], clusters = [] }) {
  if (!dbEnabled()) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };

    // Persist signals; map rawTextHash -> stored id so clusters can reference them.
    const hashToId = {};
    for (const s of signals) {
      const doc = await ProblemSignal.findOneAndUpdate(
        { userId: uid, rawTextHash: s.rawTextHash },
        { $set: { ...stripSignal(s), userId: uid, runId } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      hashToId[s.rawTextHash] = String(doc._id);
    }

    const savedClusters = [];
    for (const c of clusters) {
      const signalIds = (c.signals || []).map((s) => hashToId[s.rawTextHash]).filter(Boolean);
      // Dedupe by fingerprint per user: update in place if it exists.
      const doc = await ProblemCluster.findOneAndUpdate(
        { userId: uid, dedupeFingerprint: c.dedupeFingerprint },
        { $set: { ...stripCluster(c), userId: uid, runId, signalIds } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      savedClusters.push(out(doc.toObject()));
    }
    return { ok: true, clusters: savedClusters };
  } catch (err) {
    console.error('[innovation.store] saveDiscovery failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listClusters({ userId, email, limit = 60 }) {
  if (!dbEnabled()) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await ProblemCluster.find({ userId: uid }).sort({ updatedAt: -1 }).limit(limit).lean();
    return docs.map(out);
  } catch (err) { console.error('[innovation.store] listClusters:', err.message); return []; }
}

export async function getCluster({ userId, email, id }) {
  if (!dbEnabled() || !isObjectId(id)) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const c = await ProblemCluster.findOne({ _id: id, userId: uid }).lean();
    if (!c) return null;
    const signals = await ProblemSignal.find({ _id: { $in: (c.signalIds || []).filter(isObjectId) }, userId: uid }).lean();
    return { ...out(c), signals: signals.map(out) };
  } catch (err) { console.error('[innovation.store] getCluster:', err.message); return null; }
}

export async function saveProject({ userId, email, project }) {
  if (!dbEnabled()) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    // Dedupe by fingerprint: return existing instead of creating a duplicate.
    const existing = await GeneratedInnovationProject.findOne({ userId: uid, fingerprint: project.fingerprint }).lean();
    if (existing) return { ok: true, project: out(existing), duplicate: true };
    const doc = await GeneratedInnovationProject.create({ ...project, userId: uid });
    return { ok: true, project: out(doc.toObject()), duplicate: false };
  } catch (err) { console.error('[innovation.store] saveProject:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function getProject({ userId, email, id }) {
  if (!dbEnabled() || !isObjectId(id)) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const d = await GeneratedInnovationProject.findOne({ _id: id, userId: uid }).lean();
    return d ? out(d) : null;
  } catch (err) { console.error('[innovation.store] getProject:', err.message); return null; }
}

export async function updateProject({ userId, email, id, patch = {} }) {
  if (!dbEnabled() || !isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const allowed = ['buildBlueprint', 'costEstimate', 'ipReadiness', 'disclosureDraft', 'status', 'proofRef', 'convertedProjectId', 'convertedPatentIdeaId',
      'simplified', 'priorArtSearchPlan', 'claimDirections', 'evidenceChecklist', 'diagramPlan', 'experimentPlan', 'indiaCri',
      'evidence', 'prototypeEvidenceScore', 'linkedGithubRepoId', 'githubProofSummary', 'contributionScore', 'repoMaturityScore',
      'sourceMix', 'communitySignalsCount', 'confidentialityStatus', 'publicDisclosureStatus', 'disclosureDate', 'disclosureChannel'];
    const set = {};
    for (const k of allowed) if (k in patch) set[k] = patch[k];
    const d = await GeneratedInnovationProject.findOneAndUpdate({ _id: id, userId: uid }, { $set: set }, { new: true }).lean();
    if (!d) return { ok: false, reason: 'not_found' };
    return { ok: true, project: out(d) };
  } catch (err) { console.error('[innovation.store] updateProject:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function listProjects({ userId, email, limit = 100 }) {
  if (!dbEnabled()) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await GeneratedInnovationProject.find({ userId: uid }).sort({ updatedAt: -1 }).limit(limit).lean();
    return docs.map(out);
  } catch (err) { console.error('[innovation.store] listProjects:', err.message); return []; }
}

export async function addPriorArt({ userId, email, projectId, record }) {
  if (!dbEnabled() || !isObjectId(projectId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const doc = await InnovationPriorArtRecord.create({ ...record, userId: uid, projectId });
    return { ok: true, record: out(doc.toObject()) };
  } catch (err) { console.error('[innovation.store] addPriorArt:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function listPriorArt({ userId, email, projectId }) {
  if (!dbEnabled() || !isObjectId(projectId)) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await InnovationPriorArtRecord.find({ userId: uid, projectId }).sort({ createdAt: -1 }).lean();
    return docs.map(out);
  } catch (err) { console.error('[innovation.store] listPriorArt:', err.message); return []; }
}

function stripSignal(s) {
  const { signals, ...rest } = s; // never store nested arrays of other signals
  return {
    source: s.source, sourceUrl: s.sourceUrl, sourceId: s.sourceId, title: s.title,
    contentSummary: s.contentSummary, rawTextHash: s.rawTextHash, tags: s.tags || [],
    engagement: s.engagement || {}, sourceCreatedAt: s.sourceCreatedAt || null,
    lastActivityAt: s.lastActivityAt || null, extractedPainPoints: s.extractedPainPoints || [],
    domain: s.domain || '', technology: s.technology || '', targetUser: s.targetUser || '',
  };
}

function stripCluster(c) {
  return {
    title: c.title, summary: c.summary, domain: c.domain, technology: c.technology, targetUser: c.targetUser,
    keywords: c.keywords || [], signalCount: c.signalCount || 0, sources: c.sources || [],
    topSources: c.topSources || [],
    evidenceStrengthScore: c.evidenceStrengthScore, severityScore: c.severityScore, trendScore: c.trendScore,
    buildFeasibilityScore: c.buildFeasibilityScore, portfolioValueScore: c.portfolioValueScore,
    researchPotentialScore: c.researchPotentialScore, patentPotentialScore: c.patentPotentialScore,
    recommendedRoute: c.recommendedRoute, dedupeFingerprint: c.dedupeFingerprint,
  };
}

export default {
  saveDiscovery, listClusters, getCluster, saveProject, getProject, updateProject,
  listProjects, addPriorArt, listPriorArt,
};
