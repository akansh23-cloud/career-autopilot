/* ============================================================
   Career Intelligence — persistence layer
   ------------------------------------------------------------
   Registers its own Mongoose models on the SHARED singleton
   connection (same pattern as problemIntelligence/store.js —
   db.js stays untouched). Every function degrades safely when
   the DB is disabled; nothing here throws to callers.

   Collections: externalKnowledge, intelligenceReports,
   sourceUsageLogs, ideaSignals, researchReferences,
   publicDatasets, marketValidationReports.
   ============================================================ */
import mongoose from 'mongoose';
import { connectDB, dbEnabled, User } from '../../../db.js';

const M = mongoose.Schema.Types.Mixed;
const isObjectId = (id) => id && mongoose.isValidObjectId(id);
const cleanEmail = (e) => (e ? String(e).trim().toLowerCase() : '');

async function resolveUserId({ userId, email }) {
  if (isObjectId(userId)) return new mongoose.Types.ObjectId(userId);
  const em = cleanEmail(email);
  if (!em) return null;
  const u = await User.findOne({ email: em }).select('_id').lean();
  return u?._id || null;
}

/* Shared evidence sub-shape (normalized form only — never raw API dumps). */
const evidenceSchema = new mongoose.Schema({
  id: String, source: String, sourceType: String, title: String, summary: String,
  url: String, publishedDate: String, author: String,
  rawScore: Number, relevanceScore: Number, freshnessScore: Number, trustScore: Number,
  tags: { type: [String], default: [] }, domain: String, evidenceType: String,
  excerpt: String, metadata: { type: M, default: {} }, keywords: { type: [String], default: [] },
}, { _id: false });

const model = (name, schema, collection) => mongoose.models[name] || mongoose.model(name, schema, collection);

export const ExternalKnowledge = model('CIExternalKnowledge', new mongoose.Schema({
  fingerprint: { type: String, index: true },
  evidence: evidenceSchema,
  intent: String, domain: { type: String, index: true },
  quality: { type: Number, default: 0 },
}, { timestamps: true }), 'externalKnowledge');

export const IntelligenceReport = model('CIIntelligenceReport', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  query: String, sanitizedQuery: String, intent: String, mode: String,
  report: { type: M, default: {} },
  sourcesChecked: { type: [M], default: [] },
}, { timestamps: true }), 'intelligenceReports');

export const SourceUsageLog = model('CISourceUsageLog', new mongoose.Schema({
  source: { type: String, index: true }, ok: Boolean, cached: Boolean,
  itemCount: Number, error: String, ms: Number,
}, { timestamps: true }), 'sourceUsageLogs');

export const IdeaSignal = model('CIIdeaSignal', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  title: String, intent: String, domain: String,
  scores: { type: M, default: {} }, evidenceIds: { type: [String], default: [] },
}, { timestamps: true }), 'ideaSignals');

export const ResearchReference = model('CIResearchReference', new mongoose.Schema({
  fingerprint: { type: String, index: true }, evidence: evidenceSchema, domain: String,
}, { timestamps: true }), 'researchReferences');

export const PublicDataset = model('CIPublicDataset', new mongoose.Schema({
  fingerprint: { type: String, index: true }, evidence: evidenceSchema, domain: String,
}, { timestamps: true }), 'publicDatasets');

export const MarketValidationReport = model('CIMarketValidationReport', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  query: String, domain: String, signals: { type: [evidenceSchema], default: [] },
  summary: { type: M, default: {} },
}, { timestamps: true }), 'marketValidationReports');

/* ---- best-effort writers (never throw) ---- */

export async function logSourceUsage(entries = []) {
  if (!dbEnabled() || !entries.length) return;
  try { await connectDB(); await SourceUsageLog.insertMany(entries.map((e) => ({ ...e, error: String(e.error || '').slice(0, 200) })), { ordered: false }); } catch { /* best-effort */ }
}

/* Stores high-quality normalized evidence so the knowledge base improves
   over time (storing, indexing and reusing verified public data — NOT
   self-training). Routes research/datasets into their typed collections too. */
export async function storeKnowledge({ evidence = [], intent = '', domain = '' } = {}) {
  if (!dbEnabled() || !evidence.length) return { stored: 0 };
  try {
    await connectDB();
    let stored = 0;
    for (const e of evidence.slice(0, 40)) {
      if ((e.trustScore || 0) < 50 || (e.relevanceScore || 0) < 30) continue; // only keep high-quality items
      const fingerprint = e.id;
      await ExternalKnowledge.updateOne({ fingerprint }, { $set: { fingerprint, evidence: e, intent, domain, quality: Math.round(((e.trustScore || 0) + (e.relevanceScore || 0)) / 2) } }, { upsert: true });
      if (e.sourceType === 'research_paper') await ResearchReference.updateOne({ fingerprint }, { $set: { fingerprint, evidence: e, domain } }, { upsert: true });
      if (e.sourceType === 'public_dataset' || e.sourceType === 'government_data') await PublicDataset.updateOne({ fingerprint }, { $set: { fingerprint, evidence: e, domain } }, { upsert: true });
      stored++;
    }
    return { stored };
  } catch { return { stored: 0 }; }
}

export async function saveReport({ userId, email, query = '', sanitizedQuery = '', intent = '', mode = 'auto', report = {}, sourcesChecked = [] } = {}) {
  if (!dbEnabled()) return { ok: false, id: '' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, id: '' };
    const doc = await IntelligenceReport.create({ userId: uid, query: sanitizedQuery || query, sanitizedQuery, intent, mode, report, sourcesChecked });
    return { ok: true, id: String(doc._id) };
  } catch { return { ok: false, id: '' }; }
}

export async function saveIdeaSignal({ userId, email, idea = {}, intent = '', domain = '' } = {}) {
  if (!dbEnabled()) return { ok: false };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false };
    await IdeaSignal.create({ userId: uid, title: String(idea.title || '').slice(0, 200), intent, domain, scores: idea.scores || {}, evidenceIds: (idea.evidenceIds || []).slice(0, 20) });
    return { ok: true };
  } catch { return { ok: false }; }
}

export async function saveMarketReport({ userId, email, query = '', domain = '', signals = [], summary = {} } = {}) {
  if (!dbEnabled()) return { ok: false };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false };
    await MarketValidationReport.create({ userId: uid, query: String(query).slice(0, 300), domain, signals: signals.slice(0, 20), summary });
    return { ok: true };
  } catch { return { ok: false }; }
}

/* Reuse: pull previously stored high-quality knowledge matching keywords. */
export async function recallKnowledge({ keywords = [], domain = '', limit = 6 } = {}) {
  if (!dbEnabled() || !keywords.length) return [];
  try {
    await connectDB();
    const rx = keywords.slice(0, 5).map((k) => new RegExp(String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    const q = { $or: [{ 'evidence.title': { $in: rx } }, { 'evidence.keywords': { $in: keywords.slice(0, 8) } }] };
    if (domain) q.domain = domain;
    const docs = await IntelligenceReport.db.models.CIExternalKnowledge.find(q).sort({ quality: -1, updatedAt: -1 }).limit(limit).lean();
    return docs.map((d) => d.evidence).filter(Boolean);
  } catch { return []; }
}

export default { logSourceUsage, storeKnowledge, saveReport, saveIdeaSignal, saveMarketReport, recallKnowledge };
