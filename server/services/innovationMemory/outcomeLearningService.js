/* ============================================================
   Innovation memory — outcome learning (foundation)
   ------------------------------------------------------------
   Records lightweight outcomes (built / shelved / filed / faculty
   feedback) on memory chunks so future generation can prefer
   patterns that worked and warn on patterns that didn't. Kept
   intentionally small — this is a foundation, not a full ML loop.
   ============================================================ */
import mongoose from 'mongoose';
import { connectDB, dbEnabled } from '../../../db.js';
import { InnovationMemoryChunk } from './memoryStore.js';

const VALID_OUTCOMES = ['built', 'shelved', 'duplicate', 'filed', 'rejected', 'faculty_positive', 'faculty_negative', 'recruiter_shown'];

export async function recordOutcome({ chunkId, outcome }) {
  if (!dbEnabled()) return { ok: false, reason: 'db_disabled' };
  if (!mongoose.isValidObjectId(chunkId) || !VALID_OUTCOMES.includes(outcome)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const d = await InnovationMemoryChunk.findByIdAndUpdate(chunkId, { $set: { outcome } }, { new: true }).lean();
    return { ok: !!d, outcome };
  } catch (err) { return { ok: false, reason: 'db_error', error: err.message }; }
}

/* Aggregate signal: how have similar past ideas turned out? Used as a soft hint. */
export function summarizeOutcomes(chunks = []) {
  const counts = {};
  for (const c of chunks) if (c.outcome) counts[c.outcome] = (counts[c.outcome] || 0) + 1;
  const shelved = (counts.shelved || 0) + (counts.duplicate || 0) + (counts.rejected || 0);
  const positive = (counts.built || 0) + (counts.filed || 0) + (counts.faculty_positive || 0);
  let hint = '';
  if (shelved > positive && shelved >= 2) hint = 'Similar past ideas were often shelved or duplicated — validate novelty carefully before committing.';
  else if (positive >= 2) hint = 'Similar past ideas were built/advanced successfully — this pattern tends to work.';
  return { counts, hint };
}

export const VALID_OUTCOME_TYPES = VALID_OUTCOMES;
export default { recordOutcome, summarizeOutcomes, VALID_OUTCOME_TYPES };
