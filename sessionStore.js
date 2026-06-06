/* ============================================================
   SESSION STORE  (Mongoose-backed — no extra dependency)
   ------------------------------------------------------------
   express-session defaults to an in-memory MemoryStore, which leaks
   memory and does not survive restarts or scale across instances — it
   prints a warning and is explicitly "not designed for a production
   environment". This store persists sessions in MongoDB using the
   connection db.js already manages, so production never falls back to
   MemoryStore. It is only wired up when a MongoDB URI is configured.

   A TTL index on `expires` lets MongoDB purge stale sessions for us.
   ============================================================ */
import mongoose from 'mongoose';

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export function createMongooseSessionStore(session, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const Store = session.Store;

  const schema = new mongoose.Schema(
    {
      _id: { type: String },
      session: { type: mongoose.Schema.Types.Mixed },
      expires: { type: Date },
    },
    { versionKey: false, minimize: false }
  );
  // MongoDB auto-removes a document once `expires` is in the past.
  schema.index({ expires: 1 }, { expireAfterSeconds: 0 });

  const SessionModel = mongoose.models.Session || mongoose.model('Session', schema);

  const expiryFor = (sess) => {
    const ms = sess?.cookie?.maxAge;
    return new Date(Date.now() + (typeof ms === 'number' && ms > 0 ? ms : ttlMs));
  };

  class MongooseStore extends Store {
    get(sid, cb) {
      SessionModel.findById(sid)
        .lean()
        .then((doc) => {
          if (!doc) return cb(null, null);
          if (doc.expires && doc.expires.getTime() <= Date.now()) {
            // Lazily drop an expired session if the TTL monitor hasn't yet.
            return SessionModel.deleteOne({ _id: sid }).then(() => cb(null, null)).catch(() => cb(null, null));
          }
          return cb(null, doc.session || null);
        })
        .catch((err) => cb(err));
    }

    set(sid, sess, cb = () => {}) {
      SessionModel.updateOne(
        { _id: sid },
        { $set: { session: sess, expires: expiryFor(sess) } },
        { upsert: true }
      )
        .then(() => cb(null))
        .catch((err) => cb(err));
    }

    destroy(sid, cb = () => {}) {
      SessionModel.deleteOne({ _id: sid })
        .then(() => cb(null))
        .catch((err) => cb(err));
    }

    touch(sid, sess, cb = () => {}) {
      SessionModel.updateOne({ _id: sid }, { $set: { expires: expiryFor(sess) } })
        .then(() => cb(null))
        .catch((err) => cb(err));
    }

    clear(cb = () => {}) {
      SessionModel.deleteMany({}).then(() => cb(null)).catch((err) => cb(err));
    }

    length(cb = () => {}) {
      SessionModel.countDocuments({}).then((n) => cb(null, n)).catch((err) => cb(err));
    }
  }

  return new MongooseStore();
}
