/* ============================================================
   Innovation memory — store
   ------------------------------------------------------------
   Registers the InnovationMemoryChunk model on the SHARED mongoose
   connection (db.js untouched). Cross-user retrieval is limited to
   public_safe / anonymized_global chunks — a user's private
   invention details are NEVER exposed to other users. Degrades
   safely when the DB is disabled.
   ============================================================ */
import mongoose from 'mongoose';
import { connectDB, dbEnabled, User } from '../../../db.js';

const isObjectId = (id) => id && mongoose.isValidObjectId(id);
const cleanEmail = (e) => (e ? String(e).trim().toLowerCase() : '');

async function resolveUserId({ userId, email }) {
  if (isObjectId(userId)) return new mongoose.Types.ObjectId(userId);
  const em = cleanEmail(email);
  if (!em) return null;
  const u = await User.findOne({ email: em }).select('_id').lean();
  return u?._id || null;
}

const chunkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  collegeId: { type: String, default: '', index: true },
  sourceType: { type: String, index: true }, // problem_signal | discussion_signal | problem_cluster | generated_project | patent_idea | prior_art | disclosure | faculty_feedback | prototype_evidence
  sourcePlatform: { type: String, default: '' },
  sourceId: { type: String, default: '' },
  sourceUrl: { type: String, default: '' },
  visibility: { type: String, default: 'private', index: true }, // private | team | faculty | college | public_safe | anonymized_global
  title: String,
  text: String,            // safe text only
  safeSummary: String,
  domain: { type: String, index: true }, technology: String,
  skills: { type: [String], default: [] }, tags: { type: [String], default: [] },
  painPoints: { type: [String], default: [] }, constraints: { type: [String], default: [] },
  currentWorkarounds: { type: [String], default: [] }, requestedFeatures: { type: [String], default: [] },
  sourceQualityScore: { type: Number, default: 0 }, privacyRisk: { type: String, default: 'low' },
  confidence: { type: String, default: 'low' }, outcome: { type: String, default: '' },
  keywords: { type: [String], default: [], index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  embedding: { type: [Number], default: null },
  fingerprint: { type: String, index: true },
}, { timestamps: true });

export const InnovationMemoryChunk = mongoose.models.InnovationMemoryChunk || mongoose.model('InnovationMemoryChunk', chunkSchema);

const out = (d) => (d ? { ...d, id: String(d._id) } : d);
const CROSS_USER_VISIBILITY = ['public_safe', 'anonymized_global'];

export async function saveChunks({ userId, email, collegeId = '', chunks = [] }) {
  if (!dbEnabled() || !chunks.length) return { ok: false, reason: 'db_disabled_or_empty', saved: 0 };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found', saved: 0 };
    let saved = 0;
    for (const c of chunks) {
      await InnovationMemoryChunk.findOneAndUpdate(
        { userId: uid, fingerprint: c.fingerprint, sourceType: c.sourceType },
        { $set: { ...c, userId: uid, collegeId } },
        { upsert: true, setDefaultsOnInsert: true },
      );
      saved++;
    }
    return { ok: true, saved };
  } catch (err) { console.error('[innovationMemory.store] saveChunks:', err.message); return { ok: false, reason: 'db_error', saved: 0, error: err.message }; }
}

/* Candidate chunks for similarity: the user's own + cross-user public_safe. */
export async function candidateChunks({ userId, email, collegeId = '', sourceTypes = [], limit = 400 }) {
  if (!dbEnabled()) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    const or = [{ visibility: { $in: CROSS_USER_VISIBILITY } }];
    if (uid) or.push({ userId: uid });
    if (collegeId) or.push({ collegeId, visibility: { $in: ['college', 'faculty', ...CROSS_USER_VISIBILITY] } });
    const q = { $or: or };
    if (sourceTypes.length) q.sourceType = { $in: sourceTypes };
    const docs = await InnovationMemoryChunk.find(q).sort({ updatedAt: -1 }).limit(limit).lean();
    return docs.map(out);
  } catch (err) { console.error('[innovationMemory.store] candidateChunks:', err.message); return []; }
}

export async function countChunks({ userId, email }) {
  if (!dbEnabled()) return 0;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return 0;
    return InnovationMemoryChunk.countDocuments({ userId: uid });
  } catch { return 0; }
}

export async function deleteUserChunks({ userId, email }) {
  if (!dbEnabled()) return { ok: false, deleted: 0 };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, deleted: 0 };
    const r = await InnovationMemoryChunk.deleteMany({ userId: uid });
    return { ok: true, deleted: r.deletedCount || 0 };
  } catch (err) { return { ok: false, deleted: 0, error: err.message }; }
}

export default { InnovationMemoryChunk, saveChunks, candidateChunks, countChunks, deleteUserChunks };
