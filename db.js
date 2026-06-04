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

/* avoid OverwriteModelError on hot-reload / warm starts */
export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const SupportTicket =
  mongoose.models.SupportTicket || mongoose.model('SupportTicket', ticketSchema);

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
