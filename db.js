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
    // ---- Admin-managed account metadata (added for the Admin User Directory) ----
    // Both are optional with safe defaults so existing user documents keep
    // working without any migration: a missing field simply reads as the default.
    adminNotes: { type: String, default: '' },        // internal admin-only notes
    featuredTalent: { type: Boolean, default: false }, // admin "featured talent" flag
    // ---- DPDP basics (additive, safe defaults — no migration needed) ----
    consentAt: { type: Date, default: null },          // when the account holder consented (set at signup)
    deletedAt: { type: Date, default: null },          // soft-delete marker (account deletion requested)
    deleteScheduledFor: { type: Date, default: null }, // deletedAt + 7-day grace; cascade runs after this
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

/* ---- Full deterministic resume analysis (one document per unique
   resumeHash + targetRole + scoringVersion, per user). This is the cache
   that guarantees the same resume + role + version always returns the same
   score. We store the entire breakdown, not just the headline number. */
const resumeAnalysisSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    fileName: { type: String, trim: true, default: '' },
    targetRole: { type: String, trim: true, default: 'General' },
    score: { type: Number, default: 0 },
    ats: { type: Number, default: 0 },
    impact: { type: Number, default: 0 },
    clarity: { type: Number, default: 0 },
    breakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    matchedKeywords: { type: [String], default: [] },
    missingKeywords: { type: [String], default: [] },
    summary: { type: String, default: '' },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    recommendedRole: { type: String, trim: true, default: '' },
    resumeHash: { type: String, index: true, required: true },
    scoringVersion: { type: String, default: '', index: true },
  },
  { timestamps: true } // createdAt + updatedAt
);
// One cached analysis per (user, resume content, role, scoring version).
resumeAnalysisSchema.index({ userId: 1, resumeHash: 1, targetRole: 1, scoringVersion: 1 }, { unique: true });

/* ---- Saved resume versions (base / role-specific / job-specific) ---- */
const resumeVersionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    title: { type: String, trim: true, default: 'Untitled version' },
    kind: { type: String, default: 'base', enum: ['base', 'role', 'job'] },
    targetRole: { type: String, trim: true, default: '' },
    jobId: { type: String, trim: true, default: '' },
    jobDescription: { type: String, default: '' },
    resumeText: { type: String, default: '' },
    structuredResume: { type: mongoose.Schema.Types.Mixed, default: {} },
    resumeScore: { type: Number, default: null },
    jobFitScore: { type: Number, default: null },
    matchedKeywords: { type: [String], default: [] },
    missingKeywords: { type: [String], default: [] },
    changeLog: { type: [String], default: [] },
    fabricationRisks: { type: [mongoose.Schema.Types.Mixed], default: [] },
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
    creator: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

/* ---- Verified Skills + XP ----
   SkillXp: one row per (user, skill). verifiedXp only ever increases via
   verified project submissions; pendingXp tracks unverified claims. Users
   cannot edit verifiedXp directly — only the verification flow / admin can. */
const skillXpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    skillName: { type: String, trim: true, lowercase: true, required: true },
    verifiedXp: { type: Number, default: 0 },
    pendingXp: { type: Number, default: 0 },
    rejectedXp: { type: Number, default: 0 },
    level: { type: String, default: 'Beginner' },
    verifiedProjectIds: { type: [String], default: [] },
    pendingProjectIds: { type: [String], default: [] },
    // Audit of (projectId|skill) pairs already counted, to prevent duplicates.
    countedKeys: { type: [String], default: [] },
  },
  { timestamps: true }
);
skillXpSchema.index({ userId: 1, skillName: 1 }, { unique: true });

const projectSubmissionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    title: { type: String, trim: true, default: '' },
    description: { type: String, default: '' },
    roleInProject: { type: String, default: '' },
    technologies: { type: [String], default: [] },
    githubUrl: { type: String, default: '' },
    liveDemoUrl: { type: String, default: '' },
    proofUrls: { type: [String], default: [] },
    certificateUrl: { type: String, default: '' },
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },
    complexityLevel: { type: String, default: 'intermediate' },
    contributionType: { type: String, default: '' },
    outcome: { type: String, default: '' },
    claimedSkills: { type: [String], default: [] },
    // Verification outputs (backend-owned).
    verificationStatus: { type: String, default: 'pending', enum: ['pending', 'verified', 'rejected', 'needs_review'] },
    verifiedSkills: { type: [String], default: [] },
    pendingSkills: { type: [String], default: [] },
    rejectedSkills: { type: [String], default: [] },
    xpAwarded: { type: Number, default: 0 },
    xpPending: { type: Number, default: 0 },
    skillXpBreakdown: { type: [mongoose.Schema.Types.Mixed], default: [] },
    verificationNotes: { type: [String], default: [] },
    githubAnalysis: { type: mongoose.Schema.Types.Mixed, default: null },
    liveLinkCheck: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

/* ---- Project Marketplace ----
   A MarketplaceListing optionally links to a ProjectSubmission (projectId).
   Idea/roadmap listings have no project. marketplaceScore + verificationStatus
   are backend-owned and recomputed server-side; the client never sets them. */
const marketplaceListingSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerEmail: { type: String, lowercase: true, trim: true, index: true },
    ownerName: { type: String, trim: true, default: '' },
    projectId: { type: String, default: '', index: true },
    listingType: { type: String, default: 'project_idea', index: true },
    title: { type: String, trim: true, default: '' },
    summary: { type: String, default: '' },
    description: { type: String, default: '' },
    problemStatement: { type: String, default: '' },
    category: { type: String, trim: true, default: '', index: true },
    tags: { type: [String], default: [] },
    targetRole: { type: String, trim: true, default: '', index: true },
    difficulty: { type: String, trim: true, default: 'Intermediate' },
    duration: { type: String, trim: true, default: '' },
    techStack: { type: [String], default: [] },
    claimedSkills: { type: [String], default: [] },
    verifiedSkills: { type: [String], default: [] },
    githubUrl: { type: String, default: '' },
    liveDemoUrl: { type: String, default: '' },
    proofUrls: { type: [String], default: [] },
    architecture: { type: mongoose.Schema.Types.Mixed, default: null },
    milestones: { type: [mongoose.Schema.Types.Mixed], default: [] },
    resumeBullets: { type: [String], default: [] },
    openRoles: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, default: 'published', enum: ['draft', 'published', 'archived'], index: true },
    visibility: { type: String, default: 'public', enum: ['public', 'unlisted', 'private'] },
    verificationStatus: { type: String, default: 'none' },
    moderationStatus: { type: String, default: 'pending', enum: ['pending', 'approved', 'flagged', 'hidden'], index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    isRecruiterReady: { type: Boolean, default: false, index: true },
    viewCount: { type: Number, default: 0 },
    saveCount: { type: Number, default: 0 },
    cloneCount: { type: Number, default: 0 },
    cloneCompletedCount: { type: Number, default: 0 },
    applicationCount: { type: Number, default: 0 },
    shortlistCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
    marketplaceScore: { type: Number, default: 0, index: true },
    marketplaceScoreParts: { type: mongoose.Schema.Types.Mixed, default: {} },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const savedListingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    listingId: { type: String, required: true, index: true },
  },
  { timestamps: true }
);
savedListingSchema.index({ userId: 1, listingId: 1 }, { unique: true });

const collaborationApplicationSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, index: true },
    applicantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    applicantEmail: { type: String, lowercase: true, trim: true },
    applicantName: { type: String, default: '' },
    roleApplied: { type: String, default: '' },
    message: { type: String, default: '' },
    status: { type: String, default: 'applied', enum: ['applied', 'accepted', 'declined'] },
  },
  { timestamps: true }
);

const projectCloneSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true }
);
projectCloneSchema.index({ listingId: 1, userId: 1 }, { unique: true });

const projectReviewSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, index: true },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewerName: { type: String, default: '' },
    rating: { type: Number, default: 0 },
    comment: { type: String, default: '' },
  },
  { timestamps: true }
);

const projectEngagementSchema = new mongoose.Schema(
  {
    listingId: { type: String, required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    kind: { type: String, default: 'view', enum: ['view', 'shortlist', 'contact', 'report'] },
  },
  { timestamps: true }
);

/* ---- Live Inspiration Engine ----
   Cached, ranked inspirations from external sources (or seed fallback).
   Scores are backend-computed by the inspiration engine. */
const inspirationSchema = new mongoose.Schema(
  {
    source: { type: String, index: true },
    sourceId: { type: String, index: true },
    sourceUrl: { type: String, default: '' },
    sourceTitle: { type: String, default: '' },
    sourceDescription: { type: String, default: '' },
    title: { type: String, default: '' },
    summary: { type: String, default: '' },
    problemStatement: { type: String, default: '' },
    buildableProjectIdea: { type: String, default: '' },
    businessAngle: { type: String, default: '' },
    targetRoles: { type: [String], default: [] },
    suggestedSkills: { type: [String], default: [] },
    difficulty: { type: String, default: 'Intermediate' },
    estimatedDuration: { type: String, default: '' },
    category: { type: String, default: 'General', index: true },
    tags: { type: [String], default: [] },
    freshnessScore: { type: Number, default: 0 },
    trendScore: { type: Number, default: 0 },
    buildabilityScore: { type: Number, default: 0 },
    resumeImpactScore: { type: Number, default: 0 },
    marketplaceScore: { type: Number, default: 0, index: true },
    status: { type: String, default: 'active', enum: ['active', 'featured', 'hidden'], index: true },
    fetchedAt: { type: Date, default: Date.now },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);
inspirationSchema.index({ source: 1, sourceId: 1 }, { unique: true });

/* ---- Patent Engine ---- */
const patentRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    projectId: { type: String, default: '', index: true },
    patentTitle: { type: String, default: '' },
    inventors: { type: [String], default: [] },
    assignee: { type: String, default: '' },
    jurisdiction: { type: String, default: '' },
    applicationNumber: { type: String, default: '' },
    publicationNumber: { type: String, default: '' },
    grantNumber: { type: String, default: '' },
    filingDate: { type: String, default: '' },
    publicationDate: { type: String, default: '' },
    grantDate: { type: String, default: '' },
    status: { type: String, default: 'idea_identified', index: true },
    attorney: { type: String, default: '' },
    notes: { type: String, default: '' },
    // Assessment + disclosure snapshots (backend-computed).
    readinessScore: { type: Number, default: null },
    readinessBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    classification: { type: String, default: '' },
    priorArt: { type: [mongoose.Schema.Types.Mixed], default: [] },
    disclosure: { type: mongoose.Schema.Types.Mixed, default: null },
    deadlines: { type: [mongoose.Schema.Types.Mixed], default: [] },
    badge: { type: String, default: 'not_assessed' },
  },
  { timestamps: true }
);

/* ---- Patent OS (invention intelligence) ---- */
const patentIdeaSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    title: { type: String, default: '' },
    domain: { type: String, default: '', index: true },
    targetUser: { type: String, default: '' },
    problem: { type: String, default: '' },
    existingSolutions: { type: String, default: '' },
    proposedSolution: { type: String, default: '' },
    technicalMechanism: { type: String, default: '' },
    inputData: { type: String, default: '' },
    processingLogic: { type: String, default: '' },
    outputResult: { type: String, default: '' },
    feedbackLoop: { type: String, default: '' },
    noveltyAngle: { type: String, default: '' },
    marketUseCase: { type: String, default: '' },
    implementationPlan: { type: String, default: '' },
    tags: { type: [String], default: [] },
    status: { type: String, default: 'raw_idea', index: true },
    source: { type: String, default: '' },
    score: { type: mongoose.Schema.Types.Mixed, default: {} }, // factors+overall+grade+riskLevel
    riskWarnings: { type: [String], default: [] },
    strengtheningSuggestions: { type: [String], default: [] },
    priorArtSearchPlan: { type: mongoose.Schema.Types.Mixed, default: {} },
    synthesis: { type: mongoose.Schema.Types.Mixed, default: null }, // synthesis-intelligence input layer (build brief, blueprint, evidence, quality)
    versionHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    linkedProjectId: { type: String, default: '' },
    linkedProjectPlan: { type: mongoose.Schema.Types.Mixed, default: null },
    disclosureId: { type: String, default: '' },
    generationWhy: { type: String, default: '' },
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

const priorArtRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ideaId: { type: String, required: true, index: true },
    source: { type: String, default: '' },
    title: { type: String, default: '' },
    link: { type: String, default: '' },
    summary: { type: String, default: '' },
    overlap: { type: String, default: '' },
    differences: { type: String, default: '' },
    riskLevel: { type: String, default: 'Medium' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const patentDisclosureSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ideaId: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }, // full structured disclosure
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const patentFeedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ideaId: { type: String, required: true, index: true },
    feedbackType: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const patentActivitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ideaId: { type: String, default: '' },
    type: { type: String, default: '' },
    message: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const projectRoadmapSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    inspirationId: { type: String, default: '' },
    title: { type: String, default: '' },
    problemStatement: { type: String, default: '' },
    targetRole: { type: String, default: '' },
    difficulty: { type: String, default: 'Intermediate' },
    techStack: { type: [String], default: [] },
    architecturePreview: { type: String, default: '' },
    milestones: { type: [mongoose.Schema.Types.Mixed], default: [] },
    skillOutcomes: { type: [String], default: [] },
    proofRequirements: { type: [String], default: [] },
    verificationChecklist: { type: [mongoose.Schema.Types.Mixed], default: [] },
    resumeBullets: { type: [String], default: [] },
    interviewTalkingPoints: { type: [String], default: [] },
    suggestedSkills: { type: [String], default: [] },
    category: { type: String, default: 'General' },
    estimatedDuration: { type: String, default: '' },
    status: { type: String, default: 'roadmap_created' },
  },
  { timestamps: true }
);

/* ---- Architecture Diagram OS: versioned architecture specs per project ----
   Additive collection. The whole feature degrades gracefully when the DB is
   disabled (every helper below returns a safe value), so nothing here is a
   hard dependency of architecture generation. */
const projectArchitectureSpecSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    projectId: { type: String, default: '', index: true },
    title: { type: String, default: '' },
    provider: { type: String, default: 'generic' },
    targetLevel: { type: String, default: 'production' },
    version: { type: Number, default: 1 },
    architectureSpec: { type: mongoose.Schema.Types.Mixed, default: null },
    mermaidViews: { type: mongoose.Schema.Types.Mixed, default: {} },
    validationScore: { type: Number, default: null },
    checks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    refinementInstruction: { type: String, default: '' },
  },
  { timestamps: true }
);
projectArchitectureSpecSchema.index({ userId: 1, projectId: 1, version: -1 });

/* ---- Index audit (Market-Readiness Gap Sprint) ----
   Each index below backs a hot list endpoint that sorts the user's rows by
   recency. Registered BEFORE model compilation so Mongoose creates them.
   - PatentIdea: listPatentIdeas → find({userId}).sort({updatedAt:-1})   */
patentIdeaSchema.index({ userId: 1, updatedAt: -1 });
/* - PatentActivity: per-user analytics feed → find({userId}).sort({createdAt:-1}) */
patentActivitySchema.index({ userId: 1, createdAt: -1 });
/* - ProjectSubmission: listProjectSubmissions → find({userId}).sort({updatedAt:-1}) */
projectSubmissionSchema.index({ userId: 1, updatedAt: -1 });
/* - ResumeVersion: listResumeVersions → find({userId}).sort({updatedAt:-1}) */
resumeVersionSchema.index({ userId: 1, updatedAt: -1 });
/* - PatentRecord: listPatentRecords → find({userId}).sort({updatedAt:-1}) */
patentRecordSchema.index({ userId: 1, updatedAt: -1 });

/* avoid OverwriteModelError on hot-reload / warm starts */
export const User = mongoose.models.User || mongoose.model('User', userSchema);export const SupportTicket =
  mongoose.models.SupportTicket || mongoose.model('SupportTicket', ticketSchema);
export const Resume = mongoose.models.Resume || mongoose.model('Resume', resumeSchema);
export const Application =
  mongoose.models.Application || mongoose.model('Application', applicationSchema);
export const Outreach = mongoose.models.Outreach || mongoose.model('Outreach', outreachSchema);
export const Activity = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
export const UserState = mongoose.models.UserState || mongoose.model('UserState', userStateSchema);
export const ResumeAnalysis = mongoose.models.ResumeAnalysis || mongoose.model('ResumeAnalysis', resumeAnalysisSchema);
export const ResumeVersion = mongoose.models.ResumeVersion || mongoose.model('ResumeVersion', resumeVersionSchema);
export const SkillXp = mongoose.models.SkillXp || mongoose.model('SkillXp', skillXpSchema);
export const ProjectSubmission = mongoose.models.ProjectSubmission || mongoose.model('ProjectSubmission', projectSubmissionSchema);
export const MarketplaceListing = mongoose.models.MarketplaceListing || mongoose.model('MarketplaceListing', marketplaceListingSchema);
export const SavedListing = mongoose.models.SavedListing || mongoose.model('SavedListing', savedListingSchema);
export const CollaborationApplication = mongoose.models.CollaborationApplication || mongoose.model('CollaborationApplication', collaborationApplicationSchema);
export const ProjectClone = mongoose.models.ProjectClone || mongoose.model('ProjectClone', projectCloneSchema);
export const ProjectReview = mongoose.models.ProjectReview || mongoose.model('ProjectReview', projectReviewSchema);
export const ProjectEngagement = mongoose.models.ProjectEngagement || mongoose.model('ProjectEngagement', projectEngagementSchema);
export const Inspiration = mongoose.models.Inspiration || mongoose.model('Inspiration', inspirationSchema);
export const ProjectRoadmap = mongoose.models.ProjectRoadmap || mongoose.model('ProjectRoadmap', projectRoadmapSchema);
export const PatentRecord = mongoose.models.PatentRecord || mongoose.model('PatentRecord', patentRecordSchema);
export const PatentIdea = mongoose.models.PatentIdea || mongoose.model('PatentIdea', patentIdeaSchema);
export const PriorArtRecord = mongoose.models.PriorArtRecord || mongoose.model('PriorArtRecord', priorArtRecordSchema);
export const PatentDisclosure = mongoose.models.PatentDisclosure || mongoose.model('PatentDisclosure', patentDisclosureSchema);
export const PatentFeedback = mongoose.models.PatentFeedback || mongoose.model('PatentFeedback', patentFeedbackSchema);
export const PatentActivity = mongoose.models.PatentActivity || mongoose.model('PatentActivity', patentActivitySchema);
export const ProjectArchitectureSpec = mongoose.models.ProjectArchitectureSpec || mongoose.model('ProjectArchitectureSpec', projectArchitectureSpecSchema);

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
      // DPDP: signing back in during the 7-day grace window cancels the pending deletion.
      if (user.deletedAt) { user.deletedAt = null; user.deleteScheduledFor = null; }
      await user.save();
    } else {
      user = await User.create({
        googleId: googleId || undefined,
        email: email ? String(email).toLowerCase() : undefined,
        name, avatar: avatar || null, provider: provider || 'google',
        lastLoginAt: new Date(), loginCount: 1,
        consentAt: new Date(), // DPDP: consent recorded at account creation (signup)
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
    const allowed = ['profile', 'resume', 'projects', 'tracker', 'xpSnapshot', 'creator'];
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

/* Look up an existing deterministic analysis by its content hash. This is the
   cache hit that makes "same resume + same role + same version => same score"
   true across uploads and devices. Returns null when the DB is off or no
   matching analysis exists. */
export async function findResumeAnalysis({ userId, email, resumeHash, targetRole, scoringVersion }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !resumeHash) return null;
    const doc = await ResumeAnalysis.findOne({
      userId: uid,
      resumeHash,
      targetRole: targetRole || 'General',
      scoringVersion: scoringVersion || '',
    }).lean();
    if (!doc) return null;
    return {
      score: doc.score, ats: doc.ats, impact: doc.impact, clarity: doc.clarity,
      breakdown: doc.breakdown || {},
      matchedKeywords: doc.matchedKeywords || [],
      missingKeywords: doc.missingKeywords || [],
      summary: doc.summary || '',
      strengths: doc.strengths || [],
      improvements: doc.improvements || [],
      recommendedRole: doc.recommendedRole || '',
      fileName: doc.fileName || '',
      targetRole: doc.targetRole || 'General',
      resumeHash: doc.resumeHash,
      scoringVersion: doc.scoringVersion || '',
      createdAt: doc.createdAt || null,
    };
  } catch (err) {
    console.error('[db] findResumeAnalysis failed:', err.message);
    return null;
  }
}

/* Persist a full deterministic analysis (idempotent on the unique hash key).
   Also keeps the legacy Resume/Activity rows + UserState.resume snapshot in
   sync so dashboards and the rest of the app keep working unchanged. */
export async function saveResumeAnalysis({ userId, email, analysis }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const a = analysis || {};
    const targetRole = a.targetRole || 'General';
    const score = Math.max(0, Math.min(100, Math.round(Number(a.score) || 0)));
    const doc = {
      userId: uid, email: cleanEmail(email),
      fileName: a.fileName || '', targetRole, score,
      ats: Math.round(Number(a.ats) || 0),
      impact: Math.round(Number(a.impact) || 0),
      clarity: Math.round(Number(a.clarity) || 0),
      breakdown: a.breakdown || {},
      matchedKeywords: Array.isArray(a.matchedKeywords) ? a.matchedKeywords.slice(0, 60) : [],
      missingKeywords: Array.isArray(a.missingKeywords) ? a.missingKeywords.slice(0, 60) : [],
      summary: String(a.summary || '').slice(0, 1000),
      strengths: Array.isArray(a.strengths) ? a.strengths.slice(0, 20) : [],
      improvements: Array.isArray(a.improvements) ? a.improvements.slice(0, 20) : [],
      recommendedRole: a.recommendedRole || '',
      resumeHash: a.resumeHash || '',
      scoringVersion: a.scoringVersion || '',
    };
    await ResumeAnalysis.updateOne(
      { userId: uid, resumeHash: doc.resumeHash, targetRole, scoringVersion: doc.scoringVersion },
      { $set: doc },
      { upsert: true }
    );
    // Keep legacy dashboard signals in sync (best-effort, non-fatal).
    try {
      await Resume.create({ userId: uid, fileName: doc.fileName, score, delta: null });
      await Activity.create({ userId: uid, text: `Analyzed resume${targetRole ? ` for ${targetRole}` : ''} — score ${score}/100`, tone: score >= 75 ? 'mint' : 'cyan' });
    } catch { /* legacy rows are non-critical */ }
    return { ok: true };
  } catch (err) {
    console.error('[db] saveResumeAnalysis failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* ---- Resume version manager ---- */
export async function listResumeVersions({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await ResumeVersion.find({ userId: uid }).sort({ updatedAt: -1 }).limit(100).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch (err) {
    console.error('[db] listResumeVersions failed:', err.message);
    return [];
  }
}

export async function saveResumeVersion({ userId, email, version }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const v = version || {};
    const doc = {
      userId: uid, email: cleanEmail(email),
      title: String(v.title || 'Untitled version').slice(0, 160),
      kind: ['base', 'role', 'job'].includes(v.kind) ? v.kind : 'base',
      targetRole: v.targetRole || '', jobId: v.jobId || '', jobDescription: String(v.jobDescription || '').slice(0, 40000),
      resumeText: String(v.resumeText || '').slice(0, 60000),
      structuredResume: v.structuredResume || {},
      resumeScore: v.resumeScore == null ? null : Math.round(Number(v.resumeScore)),
      jobFitScore: v.jobFitScore == null ? null : Math.round(Number(v.jobFitScore)),
      matchedKeywords: Array.isArray(v.matchedKeywords) ? v.matchedKeywords.slice(0, 200) : [],
      missingKeywords: Array.isArray(v.missingKeywords) ? v.missingKeywords.slice(0, 200) : [],
      changeLog: Array.isArray(v.changeLog) ? v.changeLog.slice(0, 200) : [],
      fabricationRisks: Array.isArray(v.fabricationRisks) ? v.fabricationRisks.slice(0, 100) : [],
    };
    if (isObjectId(v.id)) {
      await ResumeVersion.updateOne({ _id: v.id, userId: uid }, { $set: doc });
      return { ok: true, version: { ...doc, id: v.id } };
    }
    const created = await ResumeVersion.create(doc);
    return { ok: true, version: { ...doc, id: String(created._id) } };
  } catch (err) {
    console.error('[db] saveResumeVersion failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function deleteResumeVersion({ userId, email, id }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  if (!isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = await ResumeVersion.deleteOne({ _id: id, userId: uid });
    return { ok: r.deletedCount > 0, reason: r.deletedCount ? undefined : 'not_found' };
  } catch (err) {
    console.error('[db] deleteResumeVersion failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* ---- Verified Skills + XP ----
   Applies a verification result to the user's per-skill XP ledger.
   Duplicate-safe: each (projectId|skill) pair is counted at most once for
   verified XP. levelForXp is supplied by the caller (engine owns thresholds). */
export async function applySkillVerification({ userId, email, projectId, result, levelForXp }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const em = cleanEmail(email);
    const pid = String(projectId || '');
    const breakdown = Array.isArray(result?.skillXpBreakdown) ? result.skillXpBreakdown : [];

    for (const row of breakdown) {
      const skillName = String(row.skill || '').toLowerCase().trim();
      if (!skillName) continue;
      const key = `${pid}|${skillName}`;
      const doc = await SkillXp.findOne({ userId: uid, skillName });
      const existing = doc || new SkillXp({ userId: uid, email: em, skillName });
      // Duplicate guard: never double-count the same project+skill.
      if (existing.countedKeys?.includes(key)) continue;

      if (row.status === 'verified') {
        existing.verifiedXp += Number(row.xp) || 0;
        if (pid && !existing.verifiedProjectIds.includes(pid)) existing.verifiedProjectIds.push(pid);
        existing.pendingProjectIds = existing.pendingProjectIds.filter((p) => p !== pid);
      } else if (row.status === 'pending') {
        existing.pendingXp += Number(row.xp) || 0;
        if (pid && !existing.pendingProjectIds.includes(pid)) existing.pendingProjectIds.push(pid);
      } else if (row.status === 'rejected') {
        existing.rejectedXp += Number(row.xp) || 0;
      }
      existing.countedKeys = Array.from(new Set([...(existing.countedKeys || []), key]));
      existing.level = typeof levelForXp === 'function' ? levelForXp(existing.verifiedXp) : existing.level;
      existing.email = em;
      await existing.save();
    }
    return { ok: true };
  } catch (err) {
    console.error('[db] applySkillVerification failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function saveProjectSubmission({ userId, email, submission, result }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const s = submission || {}; const r = result || {};
    const doc = {
      userId: uid, email: cleanEmail(email),
      title: String(s.title || '').slice(0, 200),
      description: String(s.description || '').slice(0, 8000),
      roleInProject: String(s.roleInProject || '').slice(0, 200),
      technologies: Array.isArray(s.technologies) ? s.technologies.slice(0, 60) : [],
      githubUrl: String(s.githubUrl || '').slice(0, 500),
      liveDemoUrl: String(s.liveDemoUrl || '').slice(0, 500),
      proofUrls: Array.isArray(s.proofUrls) ? s.proofUrls.slice(0, 20) : [],
      certificateUrl: String(s.certificateUrl || '').slice(0, 500),
      startDate: String(s.startDate || ''), endDate: String(s.endDate || ''),
      complexityLevel: String(s.complexityLevel || 'intermediate'),
      contributionType: String(s.contributionType || '').slice(0, 200),
      outcome: String(s.outcome || '').slice(0, 4000),
      claimedSkills: Array.isArray(s.claimedSkills) ? s.claimedSkills.slice(0, 60) : [],
      verificationStatus: r.projectVerificationStatus || 'pending',
      verifiedSkills: r.verifiedSkills || [], pendingSkills: r.pendingSkills || [], rejectedSkills: r.rejectedSkills || [],
      xpAwarded: r.xpAwarded || 0, xpPending: r.xpPending || 0,
      skillXpBreakdown: r.skillXpBreakdown || [], verificationNotes: r.verificationNotes || [],
      githubAnalysis: s.githubAnalysis || null, liveLinkCheck: s.liveLinkCheck || null,
    };
    if (isObjectId(s.id)) {
      await ProjectSubmission.updateOne({ _id: s.id, userId: uid }, { $set: doc });
      return { ok: true, id: s.id };
    }
    const created = await ProjectSubmission.create(doc);
    return { ok: true, id: String(created._id) };
  } catch (err) {
    console.error('[db] saveProjectSubmission failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listProjectSubmissions({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await ProjectSubmission.find({ userId: uid }).sort({ updatedAt: -1 }).limit(200).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch (err) {
    console.error('[db] listProjectSubmissions failed:', err.message);
    return [];
  }
}

export async function getProjectSubmission({ userId, email, id }) {
  if (!URI || !isObjectId(id)) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const d = await ProjectSubmission.findOne({ _id: id, userId: uid }).lean();
    return d ? { ...d, id: String(d._id) } : null;
  } catch (err) {
    console.error('[db] getProjectSubmission failed:', err.message);
    return null;
  }
}

/* Per-skill XP summary. verifiedOnly=true returns only skills with verified XP
   (used by resume/job/recruiter/placement features — pending never counts). */
export async function getSkillXpSummary({ userId, email, verifiedOnly = false }) {
  const empty = { totalVerifiedXp: 0, totalPendingXp: 0, totalRejectedXp: 0, skills: [], verifiedSkills: [] };
  if (!URI) return empty;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return empty;
    const rows = await SkillXp.find({ userId: uid }).sort({ verifiedXp: -1 }).lean();
    let tv = 0, tp = 0, tr = 0;
    const skills = rows.map((r) => {
      tv += r.verifiedXp || 0; tp += r.pendingXp || 0; tr += r.rejectedXp || 0;
      return {
        skillName: r.skillName, verifiedXp: r.verifiedXp || 0, pendingXp: r.pendingXp || 0, rejectedXp: r.rejectedXp || 0,
        level: r.level || 'Beginner',
        verifiedProjectIds: r.verifiedProjectIds || [], pendingProjectIds: r.pendingProjectIds || [],
        lastUpdated: r.updatedAt || null,
      };
    });
    const verifiedSkills = skills.filter((s) => s.verifiedXp > 0).map((s) => s.skillName);
    const out = { totalVerifiedXp: tv, totalPendingXp: tp, totalRejectedXp: tr, skills, verifiedSkills };
    if (verifiedOnly) out.skills = skills.filter((s) => s.verifiedXp > 0);
    return out;
  } catch (err) {
    console.error('[db] getSkillXpSummary failed:', err.message);
    return empty;
  }
}

/* Verified skills only — the canonical list downstream features may count. */
export async function getVerifiedSkills({ userId, email }) {
  const s = await getSkillXpSummary({ userId, email });
  return s.verifiedSkills || [];
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
    funnel: { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 },
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

/* ============================================================
   GITHUB INTEGRATION  (Career Proof Profile)
   ------------------------------------------------------------
   Four collections, all scoped by userId:
     - GithubConnection    : one per user — OAuth identity, ENCRYPTED token.
     - GithubInstallation  : GitHub App installations (selected-repo access).
     - GithubRepository    : per-user cache of accessible repos + analysis state.
     - GithubRepoAnalysis  : full analysis records (proof evidence).

   Security properties:
     - The encrypted OAuth token + the raw installation id are NEVER part of any
       public DTO. githubConnectionDTO() / githubRepoDTO() are the ONLY shapes
       that leave the server, and they never carry tokens.
     - Private repo analysis is private by default; a public-safe summary is only
       exposed when the owner explicitly opts in (publicProofVisible /
       privateProofSummaryVisible).
     - All reads degrade to safe empty results when the DB is off.
   ============================================================ */
const githubConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    providerUserId: { type: String, default: '' },
    handle: { type: String, default: '' },
    url: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    encryptedAccessToken: { type: String, default: '' }, // AES-256-GCM, never returned to client
    tokenScope: { type: String, default: '' },
    tokenType: { type: String, default: 'bearer' },
    status: { type: String, default: 'connected', enum: ['connected', 'sync_failed', 'disconnected'] },
    publicVisible: { type: Boolean, default: true },
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, default: '' },
    connectedAt: { type: Date, default: Date.now },
    lastSyncedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

const githubInstallationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    installationId: { type: String, required: true, index: true },
    accountLogin: { type: String, default: '' },
    accountId: { type: String, default: '' },
    accountType: { type: String, default: '' },
    repositorySelection: { type: String, default: 'selected' },
    permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'active', enum: ['active', 'suspended', 'disconnected'] },
    installedAt: { type: Date, default: Date.now },
    suspendedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);
githubInstallationSchema.index({ userId: 1, installationId: 1 }, { unique: true });

const githubRepositorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    installationId: { type: String, default: '', index: true },
    githubRepoId: { type: String, default: '', index: true },
    owner: { type: String, default: '' },
    name: { type: String, default: '' },
    fullName: { type: String, default: '' },
    private: { type: Boolean, default: false },
    htmlUrl: { type: String, default: '' },
    defaultBranch: { type: String, default: 'main' },
    language: { type: String, default: '' },
    topics: { type: [String], default: [] },
    description: { type: String, default: '' },
    fork: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    stargazersCount: { type: Number, default: 0 },
    forksCount: { type: Number, default: 0 },
    pushedAt: { type: Date, default: null },
    repoUpdatedAt: { type: Date, default: null },
    accessible: { type: Boolean, default: true },
    selectedForVerification: { type: Boolean, default: false },
    publicProofVisible: { type: Boolean, default: false },
    privateProofSummaryVisible: { type: Boolean, default: false },
    lastAnalyzedAt: { type: Date, default: null },
    analysisStatus: { type: String, default: 'none', enum: ['none', 'partial', 'complete', 'error'] },
    proofScore: { type: Number, default: 0 },
    proofLevel: { type: String, default: '' },
    detectedSkills: { type: [String], default: [] },
    evidence: { type: mongoose.Schema.Types.Mixed, default: [] },
    linkedProjectId: { type: String, default: '' },
  },
  { timestamps: true, minimize: false }
);
githubRepositorySchema.index({ userId: 1, githubRepoId: 1 }, { unique: true });

const githubRepoAnalysisSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    githubRepoId: { type: String, default: '', index: true },
    installationId: { type: String, default: '' },
    projectId: { type: String, default: '' },
    repoFullName: { type: String, default: '' },
    visibility: { type: String, default: 'public' },
    analyzedAt: { type: Date, default: Date.now },
    status: { type: String, default: 'complete' },
    score: { type: Number, default: 0 },
    detectedStack: { type: [String], default: [] },
    detectedSkills: { type: [String], default: [] },
    evidence: { type: mongoose.Schema.Types.Mixed, default: [] },
    filesInspected: { type: Number, default: 0 },
    commitSignals: { type: mongoose.Schema.Types.Mixed, default: {} },
    qualitySignals: { type: mongoose.Schema.Types.Mixed, default: {} },
    securityWarnings: { type: [String], default: [] },
    verificationSummary: { type: String, default: '' },
    publicSafeSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
    analysisErrors: { type: [String], default: [] },
  },
  { timestamps: true, minimize: false }
);
githubRepoAnalysisSchema.index({ userId: 1, githubRepoId: 1 });

export const GithubConnection = mongoose.models.GithubConnection || mongoose.model('GithubConnection', githubConnectionSchema);
export const GithubInstallation = mongoose.models.GithubInstallation || mongoose.model('GithubInstallation', githubInstallationSchema);
export const GithubRepository = mongoose.models.GithubRepository || mongoose.model('GithubRepository', githubRepositorySchema);
export const GithubRepoAnalysis = mongoose.models.GithubRepoAnalysis || mongoose.model('GithubRepoAnalysis', githubRepoAnalysisSchema);

const githubAuditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    action: { type: String, default: '' },
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
export const GithubAudit = mongoose.models.GithubAudit || mongoose.model('GithubAudit', githubAuditSchema);

export async function logGithubAudit({ userId, email, action, detail = {} }) {
  if (!URI) return;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return;
    await GithubAudit.create({ userId: uid, action: String(action || '').slice(0, 60), detail });
  } catch { /* audit is best-effort, never blocks the request */ }
}

export async function listGithubAudit({ userId, email, limit = 30 }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const rows = await GithubAudit.find({ userId: uid }).sort({ createdAt: -1 }).limit(limit).lean();
    return rows.map((r) => ({ action: r.action, detail: r.detail || {}, at: r.createdAt }));
  } catch { return []; }
}

export function githubConnectionDTO(doc) {
  if (!doc) return null;
  return {
    connected: doc.status === 'connected',
    status: doc.status,
    handle: doc.handle || '',
    url: doc.url || '',
    avatarUrl: doc.avatarUrl || '',
    providerUserId: doc.providerUserId || '',
    publicVisible: !!doc.publicVisible,
    profile: doc.profile || {},
    stats: doc.stats || {},
    connectionType: 'oauth',
    syncSupported: true,
    lastSyncedAt: doc.lastSyncedAt || null,
    connectedAt: doc.connectedAt || null,
    error: doc.status === 'sync_failed' ? (doc.error || 'sync_failed') : '',
  };
}

export function githubRepoDTO(doc, { isOwner = true } = {}) {
  if (!doc) return null;
  const base = {
    repoId: doc.githubRepoId,
    fullName: doc.private && !isOwner ? null : doc.fullName,
    name: doc.private && !isOwner ? null : doc.name,
    owner: doc.owner,
    private: !!doc.private,
    language: doc.language || '',
    topics: doc.topics || [],
    description: doc.private && !isOwner ? '' : (doc.description || ''),
    archived: !!doc.archived,
    fork: !!doc.fork,
    htmlUrl: doc.private ? '' : (doc.htmlUrl || ''),
    defaultBranch: doc.defaultBranch || 'main',
    pushedAt: doc.pushedAt || null,
    accessible: doc.accessible !== false,
    selectedForVerification: !!doc.selectedForVerification,
    analysisStatus: doc.analysisStatus || 'none',
    proofScore: doc.proofScore || 0,
    proofLevel: doc.proofLevel || '',
    detectedSkills: doc.detectedSkills || [],
    evidence: Array.isArray(doc.evidence) ? doc.evidence : [],
    linkedProjectId: doc.linkedProjectId || '',
    lastAnalyzedAt: doc.lastAnalyzedAt || null,
    publicProofVisible: !!doc.publicProofVisible,
    privateProofSummaryVisible: !!doc.privateProofSummaryVisible,
  };
  if (isOwner) {
    base.fullName = doc.fullName;
    base.name = doc.name;
    base.description = doc.description || '';
    base.htmlUrl = doc.htmlUrl || '';
  }
  return base;
}

/* ---- CONNECTION ---- */
export async function getGithubConnectionRaw({ userId, email }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    return await GithubConnection.findOne({ userId: uid }).lean();
  } catch { return null; }
}

export async function saveGithubConnection({ userId, email, profile = {}, stats = {}, encryptedAccessToken, tokenScope, tokenType }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const set = {
      email: cleanEmail(email),
      providerUserId: profile.providerUserId || '',
      handle: profile.handle || '',
      url: profile.url || '',
      avatarUrl: profile.avatarUrl || '',
      status: 'connected',
      profile, stats,
      tokenScope: tokenScope || '',
      tokenType: tokenType || 'bearer',
      lastSyncedAt: new Date(),
      revokedAt: null,
      error: '',
    };
    if (encryptedAccessToken != null) set.encryptedAccessToken = encryptedAccessToken;
    await GithubConnection.updateOne({ userId: uid }, { $set: set, $setOnInsert: { connectedAt: new Date() } }, { upsert: true });
    const doc = await GithubConnection.findOne({ userId: uid }).lean();
    return { ok: true, connection: githubConnectionDTO(doc) };
  } catch (err) {
    console.error('[db] saveGithubConnection failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function updateGithubStats({ userId, email, profile, stats, status = 'connected', error = '' }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const set = { status };
    if (status === 'connected') {
      if (profile) set.profile = profile;
      if (stats) set.stats = stats;
      set.lastSyncedAt = new Date();
      set.error = '';
      if (profile?.handle) set.handle = profile.handle;
      if (profile?.url) set.url = profile.url;
      if (profile?.avatarUrl) set.avatarUrl = profile.avatarUrl;
    } else {
      set.error = String(error || 'sync_failed').slice(0, 200);
    }
    const r = await GithubConnection.updateOne({ userId: uid }, { $set: set });
    if (!r.matchedCount) return { ok: false, reason: 'not_connected' };
    const doc = await GithubConnection.findOne({ userId: uid }).lean();
    return { ok: true, connection: githubConnectionDTO(doc) };
  } catch (err) {
    console.error('[db] updateGithubStats failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function disconnectGithubConnection({ userId, email }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    await GithubConnection.updateOne(
      { userId: uid },
      { $set: { status: 'disconnected', encryptedAccessToken: '', stats: {}, revokedAt: new Date() } }
    );
    return { ok: true };
  } catch (err) {
    console.error('[db] disconnectGithubConnection failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* ---- INSTALLATIONS ---- */
export async function saveGithubInstallation({ userId, email, meta = {} }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const set = {
      email: cleanEmail(email),
      accountLogin: meta.accountLogin || '',
      accountId: meta.accountId || '',
      accountType: meta.accountType || '',
      repositorySelection: meta.repositorySelection || 'selected',
      permissions: meta.permissions || {},
      status: meta.suspendedAt ? 'suspended' : 'active',
      suspendedAt: meta.suspendedAt || null,
    };
    await GithubInstallation.updateOne(
      { userId: uid, installationId: String(meta.installationId) },
      { $set: set, $setOnInsert: { installedAt: new Date(), installationId: String(meta.installationId) } },
      { upsert: true }
    );
    const doc = await GithubInstallation.findOne({ userId: uid, installationId: String(meta.installationId) }).lean();
    return { ok: true, installation: { installationId: doc.installationId, accountLogin: doc.accountLogin, accountType: doc.accountType, repositorySelection: doc.repositorySelection, status: doc.status } };
  } catch (err) {
    console.error('[db] saveGithubInstallation failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listGithubInstallations({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await GithubInstallation.find({ userId: uid }).lean();
    return docs.map((d) => ({ installationId: d.installationId, accountLogin: d.accountLogin, accountType: d.accountType, repositorySelection: d.repositorySelection, status: d.status, installedAt: d.installedAt }));
  } catch { return []; }
}

export async function getOwnedInstallation({ userId, email, installationId }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    return await GithubInstallation.findOne({ userId: uid, installationId: String(installationId) }).lean();
  } catch { return null; }
}

export async function setInstallationStatus({ installationId, status, suspendedAt = null }) {
  if (!URI) return { ok: false };
  try {
    await connectDB();
    const set = { status };
    if (suspendedAt !== undefined) set.suspendedAt = suspendedAt;
    await GithubInstallation.updateMany({ installationId: String(installationId) }, { $set: set });
    if (status === 'disconnected') {
      await GithubRepository.updateMany({ installationId: String(installationId) }, { $set: { accessible: false } });
    }
    return { ok: true };
  } catch (err) {
    console.error('[db] setInstallationStatus failed:', err.message);
    return { ok: false, reason: 'db_error' };
  }
}

export async function disconnectInstallation({ userId, email, installationId }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = await GithubInstallation.updateOne({ userId: uid, installationId: String(installationId) }, { $set: { status: 'disconnected' } });
    if (!r.matchedCount) return { ok: false, reason: 'not_found' };
    await GithubRepository.updateMany({ userId: uid, installationId: String(installationId) }, { $set: { accessible: false } });
    return { ok: true };
  } catch (err) {
    console.error('[db] disconnectInstallation failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* ---- REPOSITORIES ---- */
export async function syncGithubRepositories({ userId, email, installationId, repos = [] }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const seen = new Set();
    for (const r of repos) {
      if (!r.githubRepoId) continue;
      seen.add(String(r.githubRepoId));
      await GithubRepository.updateOne(
        { userId: uid, githubRepoId: String(r.githubRepoId) },
        {
          $set: {
            installationId: String(installationId),
            owner: r.owner, name: r.name, fullName: r.fullName, private: !!r.private,
            htmlUrl: r.htmlUrl, defaultBranch: r.defaultBranch, language: r.language || '',
            topics: r.topics || [], description: r.description || '', fork: !!r.fork, archived: !!r.archived,
            stargazersCount: r.stargazersCount || 0, forksCount: r.forksCount || 0,
            pushedAt: r.pushedAt ? new Date(r.pushedAt) : null,
            repoUpdatedAt: r.repoUpdatedAt ? new Date(r.repoUpdatedAt) : null,
            accessible: true,
          },
          $setOnInsert: { email: cleanEmail(email), githubRepoId: String(r.githubRepoId), selectedForVerification: false },
        },
        { upsert: true }
      );
    }
    if (seen.size) {
      await GithubRepository.updateMany(
        { userId: uid, installationId: String(installationId), githubRepoId: { $nin: [...seen] } },
        { $set: { accessible: false } }
      );
    }
    const docs = await GithubRepository.find({ userId: uid }).sort({ pushedAt: -1 }).lean();
    return { ok: true, repositories: docs.map((d) => githubRepoDTO(d, { isOwner: true })) };
  } catch (err) {
    console.error('[db] syncGithubRepositories failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listGithubRepositories({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await GithubRepository.find({ userId: uid }).sort({ pushedAt: -1 }).lean();
    return docs.map((d) => githubRepoDTO(d, { isOwner: true }));
  } catch { return []; }
}

export async function getOwnedRepository({ userId, email, repoId }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const repo = await GithubRepository.findOne({ userId: uid, githubRepoId: String(repoId) }).lean();
    if (!repo) return null;
    const inst = await GithubInstallation.findOne({ userId: uid, installationId: repo.installationId }).lean();
    return { repo, installation: inst };
  } catch { return null; }
}

export async function saveRepoAnalysis({ userId, email, repoId, analysis = {}, verificationSummary = '', publicSafeSummary = {} }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    await GithubRepoAnalysis.create({
      userId: uid, githubRepoId: String(repoId), installationId: analysis.installationId || '',
      repoFullName: analysis.repoFullName || '', visibility: analysis.visibility || 'public',
      analyzedAt: new Date(), status: analysis.status || 'complete', score: analysis.score || 0,
      detectedStack: analysis.detectedStack || [], detectedSkills: analysis.detectedSkills || [],
      evidence: analysis.evidence || [], filesInspected: analysis.filesInspected || 0,
      commitSignals: analysis.commitSignals || {}, qualitySignals: analysis.qualitySignals || {},
      securityWarnings: analysis.securityWarnings || [], verificationSummary,
      publicSafeSummary, analysisErrors: analysis.analysisErrors || [],
    });
    await GithubRepository.updateOne(
      { userId: uid, githubRepoId: String(repoId) },
      { $set: {
        analysisStatus: analysis.status || 'complete',
        proofScore: analysis.score || 0,
        proofLevel: analysis.level || '',
        detectedSkills: analysis.detectedSkills || [],
        evidence: analysis.evidence || [],
        selectedForVerification: true,
        lastAnalyzedAt: new Date(),
      } }
    );
    const doc = await GithubRepository.findOne({ userId: uid, githubRepoId: String(repoId) }).lean();
    return { ok: true, repo: githubRepoDTO(doc, { isOwner: true }) };
  } catch (err) {
    console.error('[db] saveRepoAnalysis failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function getLatestRepoAnalysis({ userId, email, repoId }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const d = await GithubRepoAnalysis.findOne({ userId: uid, githubRepoId: String(repoId) }).sort({ analyzedAt: -1 }).lean();
    return d ? { ...d, id: String(d._id) } : null;
  } catch { return null; }
}

export async function setRepoVisibility({ userId, email, repoId, publicProofVisible, privateProofSummaryVisible }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const repo = await GithubRepository.findOne({ userId: uid, githubRepoId: String(repoId) });
    if (!repo) return { ok: false, reason: 'not_found' };
    if (typeof publicProofVisible === 'boolean') {
      repo.publicProofVisible = repo.private ? false : publicProofVisible;
    }
    if (typeof privateProofSummaryVisible === 'boolean') {
      repo.privateProofSummaryVisible = repo.private ? privateProofSummaryVisible : false;
    }
    await repo.save();
    return { ok: true, repo: githubRepoDTO(repo.toObject(), { isOwner: true }) };
  } catch (err) {
    console.error('[db] setRepoVisibility failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function linkRepoToProject({ userId, email, repoId, projectId }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = await GithubRepository.updateOne(
      { userId: uid, githubRepoId: String(repoId) },
      { $set: { linkedProjectId: String(projectId || '') } }
    );
    if (!r.matchedCount) return { ok: false, reason: 'not_found' };
    await GithubRepoAnalysis.updateMany({ userId: uid, githubRepoId: String(repoId) }, { $set: { projectId: String(projectId || '') } });
    const doc = await GithubRepository.findOne({ userId: uid, githubRepoId: String(repoId) }).lean();
    return { ok: true, repo: githubRepoDTO(doc, { isOwner: true }) };
  } catch (err) {
    console.error('[db] linkRepoToProject failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function githubSummary({ userId, email }) {
  const empty = { connected: false, connectionType: 'none', appInstalled: 0, repositoriesAccessible: 0, repositoriesAnalyzed: 0, privateReposAnalyzed: 0, evidenceSkills: 0, analyzedRepos: [] };
  if (!URI) return empty;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return empty;
    const [conn, installs, repos] = await Promise.all([
      GithubConnection.findOne({ userId: uid }).lean(),
      GithubInstallation.find({ userId: uid, status: 'active' }).lean(),
      GithubRepository.find({ userId: uid }).lean(),
    ]);
    const accessible = repos.filter((r) => r.accessible !== false);
    const analyzed = accessible.filter((r) => r.analysisStatus === 'complete' || r.analysisStatus === 'partial');
    const skillSet = new Set(analyzed.flatMap((r) => r.detectedSkills || []));
    return {
      connected: !!(conn && conn.status === 'connected'),
      connectionType: conn && conn.status === 'connected' ? 'oauth' : 'none',
      handle: conn?.handle || '',
      appInstalled: installs.length,
      repositoriesAccessible: accessible.length,
      privateReposAccessible: accessible.filter((r) => r.private).length,
      publicReposAccessible: accessible.filter((r) => !r.private).length,
      repositoriesAnalyzed: analyzed.length,
      privateReposAnalyzed: analyzed.filter((r) => r.private).length,
      evidenceSkills: skillSet.size,
      analyzedRepos: analyzed.map((r) => ({ score: r.proofScore || 0, visibility: r.private ? 'private' : 'public', detectedSkills: r.detectedSkills || [] })),
    };
  } catch (err) {
    console.error('[db] githubSummary failed:', err.message);
    return empty;
  }
}

/* Backward-compat: mirror the OAuth GitHub html_url into the NetworkProfile
   links.github so existing UI that reads links.github keeps working. Never
   clobbers a non-empty manual link with an empty value. */
export async function syncNetworkGithubLink({ userId, email, githubUrl }) {
  if (!URI || !githubUrl) return { ok: false };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false };
    const np = await NetworkProfile.findOne({ userId: uid });
    if (!np) return { ok: false, reason: 'no_network_profile' };
    const links = { ...(np.links || {}) };
    links.github = githubUrl;
    np.links = links;
    await np.save();
    return { ok: true };
  } catch (err) {
    console.error('[db] syncNetworkGithubLink failed:', err.message);
    return { ok: false, reason: 'db_error' };
  }
}

export async function githubPublicProof({ targetUserId, targetEmail, filterFn }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId: targetUserId, email: targetEmail });
    if (!uid) return null;
    const conn = await GithubConnection.findOne({ userId: uid }).lean();
    const repos = await GithubRepository.find({ userId: uid, accessible: { $ne: false } }).lean();
    const out = { handle: '', publicStats: null, repos: [] };
    if (conn && conn.status === 'connected' && conn.publicVisible) {
      out.handle = conn.handle || '';
      out.publicStats = {
        publicRepoCount: conn.stats?.publicRepoCount || 0,
        followers: conn.stats?.followers || 0,
        topLanguages: (conn.stats?.topLanguages || []).slice(0, 5),
      };
    }
    for (const r of repos) {
      if (r.analysisStatus !== 'complete' && r.analysisStatus !== 'partial') continue;
      const analysis = await GithubRepoAnalysis.findOne({ userId: uid, githubRepoId: r.githubRepoId }).sort({ analyzedAt: -1 }).lean();
      if (!analysis) continue;
      const safe = typeof filterFn === 'function'
        ? filterFn(analysis, { publicProofVisible: r.publicProofVisible, privateProofSummaryVisible: r.privateProofSummaryVisible, htmlUrl: r.private ? '' : r.htmlUrl })
        : null;
      if (safe) out.repos.push(safe);
    }
    return out;
  } catch (err) {
    console.error('[db] githubPublicProof failed:', err.message);
    return null;
  }
}


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

/* ============================================================
   ADMIN USER DIRECTORY  /  TALENT INTELLIGENCE
   ------------------------------------------------------------
   Powers the admin-only User Directory screen. Everything here is
   gated behind requireAuth + requireAdmin in server.js — these
   helpers never check roles themselves, they assume the caller has
   already proven admin authority server-side.

   Key safety properties:
   - adminUserDTO() is the ONLY shape that ever leaves the server.
     It NEVER includes googleId, OAuth tokens, sessions, raw resume
     files, API keys or any secret. Adding a new field to a schema
     does not auto-expose it; it must be explicitly mapped here.
   - The filter / sort / paginate / stats helpers are PURE functions
     of already-safe DTOs, so they are unit-testable without a DB and
     can never leak an unmapped field.
   - All DB reads degrade to a safe empty result when the DB is off.
   ============================================================ */

// Hard cap on how many user docs we hydrate per directory request. The platform
// targets students / early-career applicants, so this is comfortably above any
// realistic single-view size while bounding memory + query cost. When the user
// base outgrows this, switch to an indexed aggregation pipeline (see README).
const ADMIN_DIRECTORY_FETCH_CAP = 2000;

const lc = (s) => String(s == null ? '' : s).trim().toLowerCase();

/* Normalize a user's "type" for the directory. Admin wins (via the email
   allowlist resolved server-side, or a persisted User.role === 'admin'),
   otherwise we use the onboarding persona role, otherwise 'user'. */
function resolveUserType({ email, dbRole, profileRole, adminEmailSet }) {
  if ((adminEmailSet && adminEmailSet.has(lc(email))) || dbRole === 'admin') return 'admin';
  const persona = String(profileRole || '').trim();
  const ALLOWED = ['student', 'professional', 'recruiter', 'college_admin'];
  return ALLOWED.includes(persona) ? persona : 'user';
}

/* Map a (User, NetworkProfile, UserState, appStats) tuple to the safe directory
   DTO. NEVER returns secrets. Missing pieces fall back to safe defaults so a user
   with only a User record (no network profile yet) still renders cleanly. */
export function adminUserDTO({ user = {}, network = null, state = null, appStats = null, adminEmailSet = null } = {}) {
  const metrics = (network && network.metrics) || {};
  const profile = (state && state.profile) || {};

  // Skills: prefer the derived network skillNames; fall back to the comma-separated
  // onboarding skills string. De-duplicated, trimmed, never null.
  const skillNames = Array.isArray(metrics.skillNames) && metrics.skillNames.length
    ? metrics.skillNames
    : String(profile.skills || profile.skillsHiring || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const skills = [...new Set(skillNames.map((s) => String(s).trim()).filter(Boolean))];

  const topSkills = Array.isArray(metrics.topSkills)
    ? metrics.topSkills.map((s) => ({ name: String(s.name || ''), xp: Number(s.xp || 0), level: s.level || null })).filter((s) => s.name)
    : skills.slice(0, 6).map((name) => ({ name, xp: 0, level: null }));

  const visibility = network?.visibility || 'private';
  const recruiterVisible = !!(network && network.openToRecruiters);
  // Last active = the most recent of login and profile-sync timestamps.
  const loginAt = user.lastLoginAt ? new Date(user.lastLoginAt).getTime() : 0;
  const netAt = network?.updatedAt ? new Date(network.updatedAt).getTime() : 0;
  const lastActiveMs = Math.max(loginAt, netAt);

  return {
    id: String(user._id || user.id || ''),
    name: user.name || network?.name || 'Member',
    email: user.email || network?.email || null,
    avatar: user.avatar || network?.picture || null,
    userType: resolveUserType({ email: user.email, dbRole: user.role, profileRole: network?.role || profile.role, adminEmailSet }),
    currentRole: network?.currentCompany || profile.currentRole || '',
    targetRole: network?.targetRole || profile.targetRole || profile.hiringRole || '',
    speciality: network?.track || '',
    location: network?.location || profile.location || '',
    xp: Number(metrics.careerXP || 0),
    experienceLevel: metrics.level || 'Beginner',
    skills,
    topSkills,
    verifiedSkillsCount: Number(metrics.verifiedBadges || 0),
    badgeCount: Number(metrics.badgeCount || 0),
    completedProjectsCount: Number(metrics.publishedCount || 0),
    totalProjectsCount: Array.isArray(state?.projects) ? state.projects.length : Number(metrics.publishedCount || 0),
    savedJobsCount: Number(appStats?.saved || 0),
    appliedJobsCount: Number(appStats?.applied || 0),
    profileCompletion: Number(network?.completeness || 0),
    readiness: Number(metrics.readiness || 0),
    trustScore: Number(network?.trustScore || 0),
    trustLevel: network?.trustLevel || 'New',
    visibility,
    recruiterVisible,
    visibilityStatus: recruiterVisible ? 'recruiter-visible' : (visibility === 'public' ? 'public' : 'private'),
    featuredTalent: !!user.featuredTalent,
    adminNotes: typeof user.adminNotes === 'string' ? user.adminNotes : '',
    isActive: user.isActive !== false,
    loginCount: Number(user.loginCount || 0),
    lastActiveAt: lastActiveMs ? new Date(lastActiveMs).toISOString() : (user.lastLoginAt || null),
    createdAt: user.createdAt || null,
  };
}

/* ---- pure query helpers over already-safe DTOs (unit-testable, no DB) ---- */

const ACTIVE_WINDOW_MS = 30 * 86400000; // a user is "active" if seen in the last 30 days
export function isActiveDTO(dto, now = Date.now()) {
  if (dto.isActive === false) return false;
  if (!dto.lastActiveAt) return false;
  return now - new Date(dto.lastActiveAt).getTime() <= ACTIVE_WINDOW_MS;
}

export function filterAdminUsers(rows = [], filters = {}) {
  const q = lc(filters.q);
  const skill = lc(filters.skill);
  const speciality = lc(filters.speciality);
  const targetRole = lc(filters.targetRole);
  const experienceLevel = lc(filters.experienceLevel);
  const location = lc(filters.location);
  const userType = lc(filters.userType);
  const minCompletion = Number(filters.minCompletion || 0);
  const projectStatus = lc(filters.projectStatus); // '', 'completed', 'none'
  const recruiterVisibleOnly = filters.recruiterVisible === true || filters.recruiterVisible === 'true';
  const activity = lc(filters.activity); // '', 'active', 'inactive'
  const now = Date.now();

  return rows.filter((u) => {
    if (q) {
      const hay = `${u.name} ${u.email || ''} ${u.skills.join(' ')} ${u.targetRole} ${u.speciality}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (skill && !u.skills.some((s) => lc(s).includes(skill))) return false;
    if (speciality && !lc(u.speciality).includes(speciality)) return false;
    if (targetRole && !lc(u.targetRole).includes(targetRole)) return false;
    if (experienceLevel && lc(u.experienceLevel) !== experienceLevel) return false;
    if (location && !lc(u.location).includes(location)) return false;
    if (userType && lc(u.userType) !== userType) return false;
    if (minCompletion && Number(u.profileCompletion) < minCompletion) return false;
    if (projectStatus === 'completed' && Number(u.completedProjectsCount) <= 0) return false;
    if (projectStatus === 'none' && Number(u.completedProjectsCount) > 0) return false;
    if (recruiterVisibleOnly && !u.recruiterVisible) return false;
    if (activity === 'active' && !isActiveDTO(u, now)) return false;
    if (activity === 'inactive' && isActiveDTO(u, now)) return false;
    return true;
  });
}

const SORTERS = {
  xp: (a, b) => b.xp - a.xp,
  active: (a, b) => new Date(b.lastActiveAt || 0) - new Date(a.lastActiveAt || 0),
  completion: (a, b) => b.profileCompletion - a.profileCompletion,
  projects: (a, b) => b.completedProjectsCount - a.completedProjectsCount,
  created: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
};
export function sortAdminUsers(rows = [], sort = 'xp') {
  const fn = SORTERS[sort] || SORTERS.xp;
  return rows.slice().sort(fn);
}

export function paginateAdminUsers(rows = [], page = 1, pageSize = 24) {
  const total = rows.length;
  const size = Math.max(1, Math.min(100, Number(pageSize) || 24));
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.max(1, Math.min(totalPages, Number(page) || 1));
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), total, page: p, pageSize: size, totalPages };
}

export function adminDirectoryStats(rows = []) {
  const now = Date.now();
  const skillCounts = new Map();
  let active = 0, recruiterVisible = 0, completedProjectUsers = 0, featured = 0;
  for (const u of rows) {
    if (isActiveDTO(u, now)) active += 1;
    if (u.recruiterVisible) recruiterVisible += 1;
    if (Number(u.completedProjectsCount) > 0) completedProjectUsers += 1;
    if (u.featuredTalent) featured += 1;
    for (const s of u.skills) {
      const k = String(s).trim();
      if (k) skillCounts.set(k, (skillCounts.get(k) || 0) + 1);
    }
  }
  let topSkill = null, topSkillCount = 0;
  for (const [k, v] of skillCounts) if (v > topSkillCount) { topSkill = k; topSkillCount = v; }
  return {
    totalUsers: rows.length,
    activeUsers: active,
    recruiterVisibleUsers: recruiterVisible,
    completedProjectUsers,
    featuredUsers: featured,
    topSkill,
    topSkillCount,
  };
}

/* ---- DB-backed directory functions ---- */

async function loadAppStatsByUser(ids) {
  // saved vs applied (anything past "saved") application counts, per user.
  try {
    const rows = await Application.aggregate([
      { $match: { userId: { $in: ids } } },
      { $group: {
        _id: '$userId',
        saved: { $sum: { $cond: [{ $eq: ['$stage', 'saved'] }, 1, 0] } },
        applied: { $sum: { $cond: [{ $ne: ['$stage', 'saved'] }, 1, 0] } },
      } },
    ]);
    const map = new Map();
    for (const r of rows) map.set(String(r._id), { saved: r.saved || 0, applied: r.applied || 0 });
    return map;
  } catch {
    return new Map();
  }
}

/* List users for the admin directory. `adminEmailSet` is a Set<string> of
   lower-cased admin emails resolved server-side (never trusts the client). */
export async function adminListUsers({ filters = {}, sort = 'xp', page = 1, pageSize = 24, adminEmailSet = null } = {}) {
  if (!URI) {
    return { ok: true, db: false, users: [], total: 0, page: 1, pageSize: Number(pageSize) || 24, totalPages: 1, stats: adminDirectoryStats([]) };
  }
  try {
    await connectDB();
    const users = await User.find({}).limit(ADMIN_DIRECTORY_FETCH_CAP).lean();
    const ids = users.map((u) => u._id);
    const [networks, states, appStats] = await Promise.all([
      NetworkProfile.find({ userId: { $in: ids } }).lean(),
      UserState.find({ userId: { $in: ids } }).select('userId profile projects').lean(),
      loadAppStatsByUser(ids),
    ]);
    const netByUser = new Map(networks.map((n) => [String(n.userId), n]));
    const stateByUser = new Map(states.map((s) => [String(s.userId), s]));

    const allDtos = users.map((u) => adminUserDTO({
      user: u,
      network: netByUser.get(String(u._id)) || null,
      state: stateByUser.get(String(u._id)) || null,
      appStats: appStats.get(String(u._id)) || null,
      adminEmailSet,
    }));

    // Stats reflect the WHOLE platform (independent of the active filter).
    const stats = adminDirectoryStats(allDtos);
    const filtered = sortAdminUsers(filterAdminUsers(allDtos, filters), sort);
    const paged = paginateAdminUsers(filtered, page, pageSize);
    return { ok: true, db: true, ...paged, stats };
  } catch (err) {
    console.error('[db] adminListUsers failed:', err.message);
    return { ok: false, db: true, error: 'db_error', users: [], total: 0, page: 1, pageSize: 24, totalPages: 1, stats: adminDirectoryStats([]) };
  }
}

/* Detailed safe view of a single user for the drawer. Adds grouped skills,
   a safe projects subset and activity — still NEVER any secret. */
export async function adminGetUserDetail({ id, adminEmailSet = null } = {}) {
  if (!URI) return { ok: false, db: false, reason: 'db_disabled' };
  if (!isObjectId(id)) return { ok: false, db: true, reason: 'bad_request' };
  try {
    await connectDB();
    const user = await User.findById(id).lean();
    if (!user) return { ok: false, db: true, reason: 'not_found' };
    const [network, state, appStats, activity] = await Promise.all([
      NetworkProfile.findOne({ userId: user._id }).lean(),
      UserState.findOne({ userId: user._id }).select('userId profile projects').lean(),
      loadAppStatsByUser([user._id]),
      Activity.find({ userId: user._id }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const dto = adminUserDTO({ user, network, state, appStats: appStats.get(String(user._id)) || null, adminEmailSet });

    // Safe projects subset (titles + proof links only, no raw file contents).
    const projects = Array.isArray(state?.projects)
      ? state.projects.slice(0, 20).map((p) => ({
          id: String(p.id || ''),
          title: String(p.title || 'Untitled project'),
          type: p.type || '',
          published: !!p.published,
          github: p.githubUrl ? true : false,
          live: p.liveDemoUrl ? true : false,
          skills: Array.isArray(p.skillsCovered) ? p.skillsCovered.slice(0, 6) : [],
          updatedAt: p.updatedAt || p.createdAt || null,
        }))
      : [];

    // Skills grouped by state when the network snapshot carries it; otherwise a
    // single "tracked" group from the derived skill names (never fabricated).
    const grouped = { verified: [], completed: [], in_progress: [], recommended: [] };
    const metrics = (network && network.metrics) || {};
    const ts = Array.isArray(metrics.topSkills) ? metrics.topSkills : [];
    for (const s of ts) {
      const item = { name: String(s.name || ''), xp: Number(s.xp || 0), level: s.level || null };
      if (!item.name) continue;
      // Heuristic from earned XP/level — coarse but honest (no invented states).
      if ((item.xp || 0) >= 500) grouped.verified.push(item);
      else if ((item.xp || 0) >= 200) grouped.completed.push(item);
      else grouped.in_progress.push(item);
    }

    return { ok: true, db: true, user: dto, projects, skillGroups: grouped, activity: activity.map((a) => ({ text: a.text, tone: a.tone || 'cyan', at: a.createdAt })) };
  } catch (err) {
    console.error('[db] adminGetUserDetail failed:', err.message);
    return { ok: false, db: true, reason: 'db_error' };
  }
}

/* Admin toggles a user's recruiter visibility. This sets the existing opt-in
   flag on the user's network profile. Recruiter-facing discovery already
   requires openToRecruiters, so this is the single source of truth. */
export async function adminSetVisibility({ id, recruiterVisible }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  if (!isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const want = !!recruiterVisible;
    const set = { openToRecruiters: want };
    // When enabling, lift visibility out of 'private' so the profile can actually
    // surface to recruiters; never force it all the way to fully 'public'.
    const update = want
      ? [{ $set: { openToRecruiters: true, visibility: { $cond: [{ $eq: ['$visibility', 'private'] }, 'published_only', '$visibility'] } } }]
      : { $set: set };
    const r = await NetworkProfile.updateOne({ userId: id }, update);
    if (!r.matchedCount) return { ok: false, reason: 'no_network_profile' };
    return { ok: true, recruiterVisible: want };
  } catch (err) {
    console.error('[db] adminSetVisibility failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function adminSetNotes({ id, adminNotes }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  if (!isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const notes = String(adminNotes || '').slice(0, 4000);
    const r = await User.updateOne({ _id: id }, { $set: { adminNotes: notes } });
    if (!r.matchedCount) return { ok: false, reason: 'not_found' };
    return { ok: true, adminNotes: notes };
  } catch (err) {
    console.error('[db] adminSetNotes failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function adminSetFeatured({ id, featuredTalent }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  if (!isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const want = !!featuredTalent;
    const r = await User.updateOne({ _id: id }, { $set: { featuredTalent: want } });
    if (!r.matchedCount) return { ok: false, reason: 'not_found' };
    return { ok: true, featuredTalent: want };
  } catch (err) {
    console.error('[db] adminSetFeatured failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* ============================================================
   PROJECT MARKETPLACE
   ------------------------------------------------------------
   marketplaceScore + verificationStatus are recomputed server-side via the
   marketplace engine (passed in as computeScore) so the client can never set
   ranking. Owner credibility is read from the verified-skill XP ledger.
   ============================================================ */
async function ownerCredibility(uid) {
  try {
    const rows = await SkillXp.find({ userId: uid }).select('verifiedXp verifiedProjectIds').lean();
    const xp = rows.reduce((s, r) => s + (r.verifiedXp || 0), 0);
    const projects = new Set(rows.flatMap((r) => r.verifiedProjectIds || [])).size;
    return { ownerVerifiedXp: xp, ownerVerifiedProjects: projects };
  } catch { return { ownerVerifiedXp: 0, ownerVerifiedProjects: 0 }; }
}

export async function createMarketplaceListing({ userId, email, name, listing, computeScore }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const l = listing || {};
    // If linked to a project submission the user owns, inherit verification + proof.
    let verificationStatus = 'none', verifiedSkills = [], githubUrl = l.githubUrl || '', liveDemoUrl = l.liveDemoUrl || '', proofUrls = l.proofUrls || [];
    if (isObjectId(l.projectId)) {
      const proj = await ProjectSubmission.findOne({ _id: l.projectId, userId: uid }).lean();
      if (proj) {
        verificationStatus = proj.verificationStatus || 'none';
        verifiedSkills = proj.verifiedSkills || [];
        githubUrl = githubUrl || proj.githubUrl || '';
        liveDemoUrl = liveDemoUrl || proj.liveDemoUrl || '';
        proofUrls = proofUrls.length ? proofUrls : (proj.proofUrls || []);
      }
    }
    const cred = await ownerCredibility(uid);
    const base = {
      ownerId: uid, ownerEmail: cleanEmail(email), ownerName: name || '',
      projectId: isObjectId(l.projectId) ? String(l.projectId) : '',
      listingType: String(l.listingType || 'project_idea'),
      title: String(l.title || '').slice(0, 200), summary: String(l.summary || '').slice(0, 600),
      description: String(l.description || '').slice(0, 8000), problemStatement: String(l.problemStatement || '').slice(0, 4000),
      category: String(l.category || '').slice(0, 80), tags: (l.tags || []).slice(0, 40),
      targetRole: String(l.targetRole || '').slice(0, 120), difficulty: String(l.difficulty || 'Intermediate'),
      duration: String(l.duration || ''), techStack: (l.techStack || []).slice(0, 40),
      claimedSkills: (l.claimedSkills || []).slice(0, 60), verifiedSkills,
      githubUrl, liveDemoUrl, proofUrls,
      architecture: l.architecture || null, milestones: (l.milestones || []).slice(0, 40),
      resumeBullets: (l.resumeBullets || []).slice(0, 20), openRoles: (l.openRoles || []).slice(0, 20),
      status: 'published', visibility: ['public', 'unlisted', 'private'].includes(l.visibility) ? l.visibility : 'public',
      verificationStatus, moderationStatus: 'pending',
      isRecruiterReady: l.listingType === 'recruiter_ready' || verificationStatus === 'verified',
      publishedAt: new Date(),
    };
    const scoreInput = { ...base, ...cred };
    const { score, parts } = typeof computeScore === 'function' ? computeScore(scoreInput, {}) : { score: 0, parts: {} };
    base.marketplaceScore = score; base.marketplaceScoreParts = parts;
    const created = await MarketplaceListing.create(base);
    return { ok: true, id: String(created._id), listing: { ...base, id: String(created._id) } };
  } catch (err) {
    console.error('[db] createMarketplaceListing failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listMarketplaceListings({ filters = {}, viewer = {}, computeScore }) {
  if (!URI) return [];
  try {
    await connectDB();
    const q = { status: 'published', moderationStatus: { $ne: 'hidden' } };
    if (filters.listingType) q.listingType = filters.listingType;
    if (filters.category) q.category = filters.category;
    if (filters.targetRole) q.targetRole = filters.targetRole;
    if (filters.difficulty) q.difficulty = filters.difficulty;
    if (filters.verificationStatus) q.verificationStatus = filters.verificationStatus;
    if (filters.recruiterReady) q.isRecruiterReady = true;
    if (filters.featured) q.isFeatured = true;
    if (filters.hasGithub) q.githubUrl = { $ne: '' };
    if (filters.hasLiveDemo) q.liveDemoUrl = { $ne: '' };
    if (filters.ownerId && isObjectId(filters.ownerId)) q.ownerId = new mongoose.Types.ObjectId(filters.ownerId);
    if (filters.skill) q.tags = { $in: [String(filters.skill).toLowerCase()] };
    let docs = await MarketplaceListing.find(q).limit(300).lean();
    // Recompute marketplaceScore against THIS viewer (role relevance is viewer-specific).
    if (typeof computeScore === 'function') {
      docs = docs.map((d) => {
        const { score, parts } = computeScore(d, viewer);
        return { ...d, id: String(d._id), marketplaceScore: score, marketplaceScoreParts: parts, _proof: parts.proof || 0 };
      });
    } else {
      docs = docs.map((d) => ({ ...d, id: String(d._id) }));
    }
    return docs;
  } catch (err) {
    console.error('[db] listMarketplaceListings failed:', err.message);
    return [];
  }
}

export async function getMarketplaceListing({ id, incrementView = false }) {
  if (!URI || !isObjectId(id)) return null;
  try {
    await connectDB();
    if (incrementView) await MarketplaceListing.updateOne({ _id: id }, { $inc: { viewCount: 1 } });
    const d = await MarketplaceListing.findById(id).lean();
    return d ? { ...d, id: String(d._id) } : null;
  } catch (err) {
    console.error('[db] getMarketplaceListing failed:', err.message);
    return null;
  }
}

export async function deleteMarketplaceListing({ userId, email, id }) {
  if (!URI || !isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = await MarketplaceListing.deleteOne({ _id: id, ownerId: uid });
    return { ok: r.deletedCount > 0, reason: r.deletedCount ? undefined : 'not_found' };
  } catch (err) {
    console.error('[db] deleteMarketplaceListing failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function toggleSavedListing({ userId, email, listingId }) {
  if (!URI || !isObjectId(listingId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const existing = await SavedListing.findOne({ userId: uid, listingId });
    if (existing) {
      await SavedListing.deleteOne({ _id: existing._id });
      await MarketplaceListing.updateOne({ _id: listingId }, { $inc: { saveCount: -1 } });
      return { ok: true, saved: false };
    }
    await SavedListing.create({ userId: uid, listingId });
    await MarketplaceListing.updateOne({ _id: listingId }, { $inc: { saveCount: 1 } });
    return { ok: true, saved: true };
  } catch (err) {
    console.error('[db] toggleSavedListing failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listSavedListings({ userId, email, computeScore, viewer = {} }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const saved = await SavedListing.find({ userId: uid }).lean();
    const ids = saved.map((s) => s.listingId).filter(isObjectId).map((i) => new mongoose.Types.ObjectId(i));
    if (!ids.length) return [];
    let docs = await MarketplaceListing.find({ _id: { $in: ids } }).lean();
    docs = docs.map((d) => {
      const r = typeof computeScore === 'function' ? computeScore(d, viewer) : { score: d.marketplaceScore, parts: {} };
      return { ...d, id: String(d._id), marketplaceScore: r.score, saved: true };
    });
    return docs;
  } catch (err) {
    console.error('[db] listSavedListings failed:', err.message);
    return [];
  }
}

export async function cloneListing({ userId, email, listingId }) {
  if (!URI || !isObjectId(listingId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const existing = await ProjectClone.findOne({ listingId, userId: uid });
    if (!existing) {
      await ProjectClone.create({ listingId, userId: uid });
      await MarketplaceListing.updateOne({ _id: listingId }, { $inc: { cloneCount: 1 } });
    }
    const listing = await MarketplaceListing.findById(listingId).lean();
    return { ok: true, roadmap: listing ? { title: listing.title, problemStatement: listing.problemStatement, techStack: listing.techStack, milestones: listing.milestones, targetRole: listing.targetRole, difficulty: listing.difficulty } : null };
  } catch (err) {
    console.error('[db] cloneListing failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function applyToCollaborate({ userId, email, name, listingId, roleApplied, message }) {
  if (!URI || !isObjectId(listingId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    await CollaborationApplication.create({ listingId, applicantId: uid, applicantEmail: cleanEmail(email), applicantName: name || '', roleApplied: String(roleApplied || '').slice(0, 120), message: String(message || '').slice(0, 2000) });
    await MarketplaceListing.updateOne({ _id: listingId }, { $inc: { applicationCount: 1 } });
    return { ok: true };
  } catch (err) {
    console.error('[db] applyToCollaborate failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function reviewListing({ userId, email, name, listingId, rating, comment }) {
  if (!URI || !isObjectId(listingId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    await ProjectReview.create({ listingId, reviewerId: uid, reviewerName: name || '', rating: Math.max(0, Math.min(5, Math.round(Number(rating) || 0))), comment: String(comment || '').slice(0, 2000) });
    return { ok: true };
  } catch (err) {
    console.error('[db] reviewListing failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listReviews({ listingId }) {
  if (!URI || !isObjectId(listingId)) return [];
  try {
    await connectDB();
    const docs = await ProjectReview.find({ listingId }).sort({ createdAt: -1 }).limit(50).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch { return []; }
}

export async function recordEngagement({ userId, email, listingId, kind }) {
  if (!URI || !isObjectId(listingId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    await ProjectEngagement.create({ listingId, actorId: uid || null, kind: ['view', 'shortlist', 'contact', 'report'].includes(kind) ? kind : 'view' });
    const inc = {};
    if (kind === 'shortlist') inc.shortlistCount = 1;
    else if (kind === 'report') inc.reportCount = 1;
    if (Object.keys(inc).length) await MarketplaceListing.updateOne({ _id: listingId }, { $inc: inc });
    if (kind === 'report') {
      const doc = await MarketplaceListing.findById(listingId).select('reportCount').lean();
      if (doc && doc.reportCount >= 3) await MarketplaceListing.updateOne({ _id: listingId }, { $set: { moderationStatus: 'flagged' } });
    }
    return { ok: true };
  } catch (err) {
    console.error('[db] recordEngagement failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* Admin moderation: feature / hide / approve a listing. */
export async function adminModerateListing({ id, action }) {
  if (!URI || !isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const set = {};
    if (action === 'feature') set.isFeatured = true;
    else if (action === 'unfeature') set.isFeatured = false;
    else if (action === 'hide') set.moderationStatus = 'hidden';
    else if (action === 'approve') set.moderationStatus = 'approved';
    else return { ok: false, reason: 'bad_action' };
    const r = await MarketplaceListing.updateOne({ _id: id }, { $set: set });
    return { ok: r.matchedCount > 0, reason: r.matchedCount ? undefined : 'not_found', applied: set };
  } catch (err) {
    console.error('[db] adminModerateListing failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

/* ============================================================
   LIVE INSPIRATION ENGINE
   ------------------------------------------------------------
   Cache freshly-built inspirations (upsert by source+sourceId), read them
   back ranked, and persist "Build this" roadmaps. Scores come from the
   engine; the client never sets them.
   ============================================================ */
export async function cacheInspirations({ inspirations = [] }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    for (const it of inspirations) {
      await Inspiration.updateOne(
        { source: it.source, sourceId: it.sourceId },
        { $set: { ...it, fetchedAt: new Date(), status: 'active' } },
        { upsert: true }
      );
    }
    return { ok: true, count: inspirations.length };
  } catch (err) {
    console.error('[db] cacheInspirations failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listInspirations({ filters = {}, limit = 40 } = {}) {
  if (!URI) return [];
  try {
    await connectDB();
    const q = { status: { $ne: 'hidden' } };
    if (filters.category) q.category = filters.category;
    if (filters.source) q.source = filters.source;
    if (filters.difficulty) q.difficulty = filters.difficulty;
    if (filters.featured) q.status = 'featured';
    const docs = await Inspiration.find(q).sort({ status: -1, marketplaceScore: -1, fetchedAt: -1 }).limit(limit).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch (err) {
    console.error('[db] listInspirations failed:', err.message);
    return [];
  }
}

export async function getInspiration({ id }) {
  if (!URI || !isObjectId(id)) return null;
  try {
    await connectDB();
    const d = await Inspiration.findById(id).lean();
    return d ? { ...d, id: String(d._id) } : null;
  } catch { return null; }
}

export async function adminModerateInspiration({ id, action }) {
  if (!URI || !isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const status = action === 'feature' ? 'featured' : action === 'hide' ? 'hidden' : action === 'unhide' ? 'active' : null;
    if (!status) return { ok: false, reason: 'bad_action' };
    const r = await Inspiration.updateOne({ _id: id }, { $set: { status } });
    return { ok: r.matchedCount > 0, reason: r.matchedCount ? undefined : 'not_found', status };
  } catch (err) {
    console.error('[db] adminModerateInspiration failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function saveProjectRoadmap({ userId, email, roadmap, inspirationId }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = roadmap || {};
    const doc = {
      userId: uid, email: cleanEmail(email), inspirationId: inspirationId || '',
      title: String(r.title || '').slice(0, 200), problemStatement: String(r.problemStatement || '').slice(0, 4000),
      targetRole: r.targetRole || '', difficulty: r.difficulty || 'Intermediate',
      techStack: (r.techStack || []).slice(0, 40), architecturePreview: String(r.architecturePreview || '').slice(0, 2000),
      milestones: (r.milestones || []).slice(0, 40), skillOutcomes: (r.skillOutcomes || []).slice(0, 20),
      proofRequirements: (r.proofRequirements || []).slice(0, 20), verificationChecklist: (r.verificationChecklist || []).slice(0, 20),
      resumeBullets: (r.resumeBullets || []).slice(0, 20), interviewTalkingPoints: (r.interviewTalkingPoints || []).slice(0, 20),
      suggestedSkills: (r.suggestedSkills || []).slice(0, 40), category: r.category || 'General',
      estimatedDuration: r.estimatedDuration || '', status: r.status || 'roadmap_created',
    };
    const created = await ProjectRoadmap.create(doc);
    return { ok: true, id: String(created._id), roadmap: { ...doc, id: String(created._id) } };
  } catch (err) {
    console.error('[db] saveProjectRoadmap failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listProjectRoadmaps({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await ProjectRoadmap.find({ userId: uid }).sort({ updatedAt: -1 }).limit(100).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch (err) {
    console.error('[db] listProjectRoadmaps failed:', err.message);
    return [];
  }
}

/* ============================================================
   PATENT ENGINE
   ============================================================ */
export async function savePatentRecord({ userId, email, record }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = record || {};
    const doc = {
      userId: uid, email: cleanEmail(email), projectId: r.projectId || '',
      patentTitle: String(r.patentTitle || r.title || '').slice(0, 200),
      inventors: (r.inventors || []).slice(0, 20), assignee: String(r.assignee || '').slice(0, 200),
      jurisdiction: String(r.jurisdiction || '').slice(0, 120),
      applicationNumber: String(r.applicationNumber || '').slice(0, 80),
      publicationNumber: String(r.publicationNumber || '').slice(0, 80),
      grantNumber: String(r.grantNumber || '').slice(0, 80),
      filingDate: String(r.filingDate || ''), publicationDate: String(r.publicationDate || ''), grantDate: String(r.grantDate || ''),
      status: r.status || 'idea_identified', attorney: String(r.attorney || '').slice(0, 200),
      notes: String(r.notes || '').slice(0, 4000),
      readinessScore: r.readinessScore == null ? null : Math.round(Number(r.readinessScore)),
      readinessBreakdown: r.readinessBreakdown || {}, classification: r.classification || '',
      priorArt: (r.priorArt || []).slice(0, 50), disclosure: r.disclosure || null,
      deadlines: (r.deadlines || []).slice(0, 50), badge: r.badge || 'not_assessed',
    };
    if (isObjectId(r.id)) { await PatentRecord.updateOne({ _id: r.id, userId: uid }, { $set: doc }); return { ok: true, id: r.id }; }
    const created = await PatentRecord.create(doc);
    return { ok: true, id: String(created._id) };
  } catch (err) {
    console.error('[db] savePatentRecord failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listPatentRecords({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await PatentRecord.find({ userId: uid }).sort({ updatedAt: -1 }).limit(200).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch (err) { console.error('[db] listPatentRecords failed:', err.message); return []; }
}

export async function deletePatentRecord({ userId, email, id }) {
  if (!URI || !isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = await PatentRecord.deleteOne({ _id: id, userId: uid });
    return { ok: r.deletedCount > 0, reason: r.deletedCount ? undefined : 'not_found' };
  } catch (err) { console.error('[db] deletePatentRecord failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

/* Dashboard rollups for the Patent Engine. */
export async function patentDashboard({ userId, email }) {
  const empty = { totalAssessed: 0, patentReady: 0, disclosuresDrafted: 0, filed: 0, granted: 0, upcomingDeadlines: [], highPriorArtRisk: 0 };
  if (!URI) return empty;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return empty;
    const docs = await PatentRecord.find({ userId: uid }).lean();
    const filedStatuses = ['provisional_filed', 'non_provisional_filed', 'published', 'office_action'];
    const out = {
      totalAssessed: docs.filter((d) => d.readinessScore != null).length,
      patentReady: docs.filter((d) => d.badge === 'patent_ready' || (d.readinessScore || 0) >= 75).length,
      disclosuresDrafted: docs.filter((d) => d.disclosure || d.status === 'invention_disclosure_drafted').length,
      filed: docs.filter((d) => filedStatuses.includes(d.status)).length,
      granted: docs.filter((d) => d.status === 'granted').length,
      highPriorArtRisk: docs.filter((d) => (d.readinessBreakdown?.priorArtRisk ?? 15) <= 5).length,
      upcomingDeadlines: docs.flatMap((d) => (d.deadlines || []).map((x) => ({ ...x, patent: d.patentTitle }))).slice(0, 20),
    };
    return out;
  } catch (err) { console.error('[db] patentDashboard failed:', err.message); return empty; }
}

/* ============================================================
   READINESS / RECRUITER VIEW  (verified-only aggregates)
   ------------------------------------------------------------
   Pulls a user's VERIFIED skill XP + verified project counts so the
   readiness engine (in the route) can score them. Pending never counts.
   ============================================================ */
export async function readinessInputsFor({ userId, email }) {
  const empty = { verifiedSkills: [], totalVerifiedXp: 0, verifiedProjectCount: 0, recruiterReadyProjectCount: 0, resumeScore: null };
  if (!URI) return empty;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return empty;
    const xpRows = await SkillXp.find({ userId: uid }).select('skillName verifiedXp').lean();
    const verifiedSkills = xpRows.filter((r) => (r.verifiedXp || 0) > 0).map((r) => r.skillName);
    const totalVerifiedXp = xpRows.reduce((s, r) => s + (r.verifiedXp || 0), 0);
    const subs = await ProjectSubmission.find({ userId: uid }).select('verificationStatus githubUrl liveDemoUrl').lean();
    const verifiedProjectCount = subs.filter((s) => s.verificationStatus === 'verified').length;
    const recruiterReadyProjectCount = subs.filter((s) => s.verificationStatus === 'verified' && (s.githubUrl || s.liveDemoUrl)).length;
    let resumeScore = null;
    try {
      const latest = await ResumeAnalysis.findOne({ userId: uid }).sort({ updatedAt: -1 }).select('score').lean();
      if (latest) resumeScore = latest.score;
    } catch { /* optional */ }
    return { verifiedSkills, totalVerifiedXp, verifiedProjectCount, recruiterReadyProjectCount, resumeScore };
  } catch (err) {
    console.error('[db] readinessInputsFor failed:', err.message);
    return empty;
  }
}

/* Recruiter: candidates ranked by verified signals. computeReadiness passed in. */
export async function recruiterCandidates({ filters = {}, computeReadiness, limit = 50 }) {
  if (!URI) return [];
  try {
    await connectDB();
    // Candidate pool = users who have at least one verified-XP skill row.
    const xpRows = await SkillXp.find({ verifiedXp: { $gt: 0 } }).select('userId skillName verifiedXp').lean();
    const byUser = new Map();
    for (const r of xpRows) {
      const k = String(r.userId);
      if (!byUser.has(k)) byUser.set(k, { skills: [], xp: 0 });
      const e = byUser.get(k); e.skills.push(r.skillName); e.xp += r.verifiedXp || 0;
    }
    const userIds = Array.from(byUser.keys()).map((id) => new mongoose.Types.ObjectId(id));
    if (!userIds.length) return [];
    const users = await User.find({ _id: { $in: userIds } }).select('name email targetRole').lean();
    const subs = await ProjectSubmission.find({ userId: { $in: userIds }, verificationStatus: 'verified' }).select('userId githubUrl liveDemoUrl').lean();
    const subsByUser = new Map();
    for (const s of subs) { const k = String(s.userId); if (!subsByUser.has(k)) subsByUser.set(k, []); subsByUser.get(k).push(s); }

    let out = users.map((u) => {
      const k = String(u._id);
      const agg = byUser.get(k) || { skills: [], xp: 0 };
      const us = subsByUser.get(k) || [];
      const inputs = {
        verifiedSkills: agg.skills, totalVerifiedXp: agg.xp,
        verifiedProjectCount: us.length,
        recruiterReadyProjectCount: us.filter((s) => s.githubUrl || s.liveDemoUrl).length,
        resumeScore: null,
      };
      const r = typeof computeReadiness === 'function' ? computeReadiness(inputs) : { score: 0, category: 'Not Ready' };
      return {
        id: k, name: u.name || '', email: u.email || '', targetRole: u.targetRole || '',
        verifiedSkills: agg.skills, verifiedProjectCount: us.length,
        readinessScore: r.score, readinessCategory: r.category,
      };
    });
    if (filters.skill) out = out.filter((c) => c.verifiedSkills.some((s) => s.includes(String(filters.skill).toLowerCase())));
    if (filters.category) out = out.filter((c) => c.readinessCategory === filters.category);
    if (filters.minScore) out = out.filter((c) => c.readinessScore >= Number(filters.minScore));
    out.sort((a, b) => b.readinessScore - a.readinessScore);
    return out.slice(0, limit);
  } catch (err) {
    console.error('[db] recruiterCandidates failed:', err.message);
    return [];
  }
}

/* Project verification queue (admin): submissions needing review. */
export async function verificationQueue({ limit = 100 }) {
  if (!URI) return [];
  try {
    await connectDB();
    const docs = await ProjectSubmission.find({ verificationStatus: { $in: ['pending', 'needs_review'] } }).sort({ updatedAt: -1 }).limit(limit).lean();
    return docs.map((d) => ({ id: String(d._id), userId: String(d.userId), email: d.email, title: d.title, verificationStatus: d.verificationStatus, claimedSkills: d.claimedSkills, githubUrl: d.githubUrl, liveDemoUrl: d.liveDemoUrl, xpPending: d.xpPending }));
  } catch (err) {
    console.error('[db] verificationQueue failed:', err.message);
    return [];
  }
}

/* ============================================================
   PATENT OS  (ideas, prior-art, disclosures, feedback, activity)
   All scoped to the owning user. Pipeline/dashboard are derived server-side.
   ============================================================ */
const PATENT_LOCKED = ['filed', 'published', 'granted']; // delete -> archive only

async function logPatentActivity(uid, ideaId, type, message, metadata = {}) {
  try { await PatentActivity.create({ userId: uid, ideaId: ideaId || '', type, message, metadata }); } catch { /* non-fatal */ }
}

export async function createPatentIdeas({ userId, email, ideas = [], generationWhy = '' }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const docs = [];
    for (const i of ideas) {
      const score = i.score || (i.scoreSummary ? { overall: i.scoreSummary.overall, grade: i.scoreSummary.grade, riskLevel: i.scoreSummary.riskLevel } : {});
      const doc = await PatentIdea.create({
        userId: uid, email: cleanEmail(email),
        title: String(i.title || '').slice(0, 200), domain: i.domain || '', targetUser: i.targetUser || '',
        problem: String(i.problem || '').slice(0, 3000), existingSolutions: String(i.existingSolutions || '').slice(0, 3000),
        proposedSolution: String(i.proposedSolution || '').slice(0, 4000), technicalMechanism: String(i.technicalMechanism || '').slice(0, 4000),
        inputData: String(i.inputData || '').slice(0, 2000), processingLogic: String(i.processingLogic || '').slice(0, 2000),
        outputResult: String(i.outputResult || '').slice(0, 2000), feedbackLoop: String(i.feedbackLoop || '').slice(0, 2000),
        noveltyAngle: String(i.noveltyAngle || '').slice(0, 2000), marketUseCase: String(i.marketUseCase || '').slice(0, 2000),
        implementationPlan: String(i.implementationPlan || '').slice(0, 2000), tags: (i.tags || []).slice(0, 12),
        status: 'raw_idea', source: i.source || 'generated', score,
        riskWarnings: i.riskWarnings || [], strengtheningSuggestions: i.strengtheningSuggestions || [],
        synthesis: i.synthesis && typeof i.synthesis === 'object' ? i.synthesis : null,
        generationWhy: generationWhy || '',
        versionHistory: [{ version: 1, at: new Date(), change: 'Idea generated', scoreOverall: score.overall || 0 }],
      });
      docs.push({ ...doc.toObject(), id: String(doc._id) });
      await logPatentActivity(uid, String(doc._id), 'idea_generated', `Idea generated: ${doc.title}`);
    }
    return { ok: true, ideas: docs };
  } catch (err) {
    console.error('[db] createPatentIdeas failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function listPatentIdeas({ userId, email, filters = {} }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const q = { userId: uid };
    if (filters.status) q.status = filters.status;
    if (filters.domain) q.domain = filters.domain;
    if (filters.archived === true) q.archived = true; else if (filters.archived !== 'all') q.archived = { $ne: true };
    let docs = await PatentIdea.find(q).sort({ updatedAt: -1 }).limit(300).lean();
    if (filters.minScore) docs = docs.filter((d) => (d.score?.overall || 0) >= Number(filters.minScore));
    if (filters.search) {
      const s = String(filters.search).toLowerCase();
      docs = docs.filter((d) => `${d.title} ${d.problem} ${(d.tags || []).join(' ')}`.toLowerCase().includes(s));
    }
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch (err) { console.error('[db] listPatentIdeas failed:', err.message); return []; }
}

export async function getPatentIdea({ userId, email, id }) {
  if (!URI || !isObjectId(id)) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const d = await PatentIdea.findOne({ _id: id, userId: uid }).lean();
    return d ? { ...d, id: String(d._id) } : null;
  } catch { return null; }
}

export async function updatePatentIdea({ userId, email, id, patch = {}, versionNote = '' }) {
  if (!URI || !isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const idea = await PatentIdea.findOne({ _id: id, userId: uid });
    if (!idea) return { ok: false, reason: 'not_found' };
    const allowed = ['title', 'domain', 'targetUser', 'problem', 'existingSolutions', 'proposedSolution', 'technicalMechanism', 'inputData', 'processingLogic', 'outputResult', 'feedbackLoop', 'noveltyAngle', 'marketUseCase', 'implementationPlan', 'tags', 'status', 'score', 'riskWarnings', 'strengtheningSuggestions', 'priorArtSearchPlan', 'linkedProjectId', 'linkedProjectPlan', 'disclosureId', 'archived'];
    for (const k of allowed) if (k in patch) idea[k] = patch[k];
    if (versionNote) {
      const v = (idea.versionHistory?.length || 0) + 1;
      idea.versionHistory = [...(idea.versionHistory || []), { version: v, at: new Date(), change: versionNote, scoreOverall: idea.score?.overall || 0 }];
    }
    await idea.save();
    if (patch.status) await logPatentActivity(uid, id, 'status_changed', `Status → ${patch.status}`);
    return { ok: true, idea: { ...idea.toObject(), id: String(idea._id) } };
  } catch (err) { console.error('[db] updatePatentIdea failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function deletePatentIdea({ userId, email, id }) {
  if (!URI || !isObjectId(id)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const idea = await PatentIdea.findOne({ _id: id, userId: uid });
    if (!idea) return { ok: false, reason: 'not_found' };
    if (PATENT_LOCKED.includes(idea.status)) { // filed/published/granted -> archive only
      idea.archived = true; await idea.save();
      return { ok: true, archived: true };
    }
    await PatentIdea.deleteOne({ _id: id, userId: uid });
    await logPatentActivity(uid, id, 'idea_deleted', `Idea deleted: ${idea.title}`);
    return { ok: true, deleted: true };
  } catch (err) { console.error('[db] deletePatentIdea failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function recordIdeaVersion({ userId, email, id, note, scoreOverall }) {
  return updatePatentIdea({ userId, email, id, patch: {}, versionNote: note || `Updated (score ${scoreOverall ?? '—'})` });
}

export async function addPriorArtRecord({ userId, email, ideaId, record }) {
  if (!URI || !isObjectId(ideaId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const owns = await PatentIdea.exists({ _id: ideaId, userId: uid });
    if (!owns) return { ok: false, reason: 'not_found' };
    const r = record || {};
    const doc = await PriorArtRecord.create({
      userId: uid, ideaId, source: String(r.source || '').slice(0, 200), title: String(r.title || '').slice(0, 300),
      link: String(r.link || '').slice(0, 500), summary: String(r.summary || '').slice(0, 2000),
      overlap: String(r.overlap || '').slice(0, 1000), differences: String(r.differences || '').slice(0, 1000),
      riskLevel: ['Low', 'Medium', 'High'].includes(r.riskLevel) ? r.riskLevel : 'Medium', notes: String(r.notes || '').slice(0, 1000),
    });
    await logPatentActivity(uid, ideaId, 'prior_art_added', `Prior-art added: ${doc.title || doc.source}`);
    return { ok: true, id: String(doc._id), record: { ...doc.toObject(), id: String(doc._id) } };
  } catch (err) { console.error('[db] addPriorArtRecord failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function listPriorArtRecords({ userId, email, ideaId }) {
  if (!URI || !isObjectId(ideaId)) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await PriorArtRecord.find({ userId: uid, ideaId }).sort({ createdAt: -1 }).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch { return []; }
}

export async function deletePriorArtRecord({ userId, email, recordId }) {
  if (!URI || !isObjectId(recordId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const r = await PriorArtRecord.deleteOne({ _id: recordId, userId: uid });
    return { ok: r.deletedCount > 0, reason: r.deletedCount ? undefined : 'not_found' };
  } catch (err) { return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function savePatentDisclosure({ userId, email, ideaId, payload }) {
  if (!URI || !isObjectId(ideaId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const idea = await PatentIdea.findOne({ _id: ideaId, userId: uid });
    if (!idea) return { ok: false, reason: 'not_found' };
    const prev = await PatentDisclosure.findOne({ userId: uid, ideaId }).sort({ version: -1 });
    const version = (prev?.version || 0) + 1;
    const doc = await PatentDisclosure.create({ userId: uid, ideaId, payload, version });
    idea.disclosureId = String(doc._id);
    if (idea.status === 'raw_idea' || idea.status === 'shortlisted' || idea.status === 'refining') idea.status = 'disclosure_drafted';
    await idea.save();
    await logPatentActivity(uid, ideaId, 'disclosure_generated', `Disclosure v${version} generated`);
    return { ok: true, id: String(doc._id), version, disclosure: { ...doc.toObject(), id: String(doc._id) } };
  } catch (err) { console.error('[db] savePatentDisclosure failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function getPatentDisclosure({ userId, email, ideaId }) {
  if (!URI || !isObjectId(ideaId)) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return null;
    const d = await PatentDisclosure.findOne({ userId: uid, ideaId }).sort({ version: -1 }).lean();
    return d ? { ...d, id: String(d._id) } : null;
  } catch { return null; }
}

export async function listPatentDisclosures({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await PatentDisclosure.find({ userId: uid }).sort({ updatedAt: -1 }).limit(200).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch { return []; }
}

export async function recordPatentFeedback({ userId, email, ideaId, feedbackType, notes }) {
  if (!URI || !isObjectId(ideaId)) return { ok: false, reason: 'bad_request' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const owns = await PatentIdea.exists({ _id: ideaId, userId: uid });
    if (!owns) return { ok: false, reason: 'not_found' };
    await PatentFeedback.create({ userId: uid, ideaId, feedbackType: String(feedbackType || '').slice(0, 60), notes: String(notes || '').slice(0, 1000) });
    await logPatentActivity(uid, ideaId, 'feedback_added', `Feedback: ${feedbackType}`);
    return { ok: true };
  } catch (err) { console.error('[db] recordPatentFeedback failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function listPatentFeedback({ userId, email }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await PatentFeedback.find({ userId: uid }).sort({ createdAt: -1 }).limit(500).lean();
    return docs.map((d) => ({ ...d, id: String(d._id), ideaId: String(d.ideaId) }));
  } catch { return []; }
}

export async function listPatentActivity({ userId, email, limit = 30 }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await PatentActivity.find({ userId: uid }).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch { return []; }
}

export async function patentOsDashboard({ userId, email }) {
  const empty = { totals: {}, pipeline: {}, topIdea: null, topDomain: null };
  if (!URI) return empty;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return empty;
    const ideas = await PatentIdea.find({ userId: uid, archived: { $ne: true } }).lean();
    const STATUSES = ['raw_idea', 'shortlisted', 'refining', 'prior_art_review', 'poc_planned', 'disclosure_drafted', 'attorney_ready', 'filed', 'published', 'granted', 'abandoned'];
    const pipeline = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const domainCount = {};
    let top = null;
    let disclosureReady = 0, underReview = 0, filedReady = 0, strong = 0;
    for (const i of ideas) {
      pipeline[i.status] = (pipeline[i.status] || 0) + 1;
      if (i.domain) domainCount[i.domain] = (domainCount[i.domain] || 0) + 1;
      const ov = i.score?.overall || 0;
      if (ov >= 70) strong++;
      if (i.disclosureId) disclosureReady++;
      if (i.status === 'prior_art_review') underReview++;
      if (['attorney_ready', 'filed'].includes(i.status)) filedReady++;
      if (!top || ov > (top.score?.overall || 0)) top = i;
    }
    const topDomain = Object.entries(domainCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return {
      totals: { totalIdeas: ideas.length, strongCandidates: strong, disclosureReady, underPriorArtReview: underReview, attorneyOrFiled: filedReady },
      pipeline,
      topIdea: top ? { id: String(top._id), title: top.title, score: top.score?.overall || 0, grade: top.score?.grade || '' } : null,
      topDomain,
    };
  } catch (err) { console.error('[db] patentOsDashboard failed:', err.message); return empty; }
}

/* ============================================================
   ARCHITECTURE DIAGRAM OS — versioned specs per project.
   All helpers are safe to call when the DB is disabled.
   ============================================================ */
export async function saveArchitectureSpec({ userId, email, spec, mermaidViews, validationScore, checks, refinementInstruction }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const s = spec || {};
    const projectId = String(s.projectId || '').slice(0, 120);
    if (!projectId) return { ok: false, reason: 'no_project_id' };
    const last = await ProjectArchitectureSpec.findOne({ userId: uid, projectId }).sort({ version: -1 }).select('version').lean();
    const version = (last?.version || 0) + 1;
    const created = await ProjectArchitectureSpec.create({
      userId: uid, email: cleanEmail(email), projectId,
      title: String(s.title || '').slice(0, 200),
      provider: String(s.provider || 'generic').slice(0, 20),
      targetLevel: String(s.targetLevel || 'production').slice(0, 30),
      version,
      architectureSpec: { ...s, version },
      mermaidViews: mermaidViews || {},
      validationScore: Number.isFinite(validationScore) ? validationScore : null,
      checks: (checks || []).slice(0, 60),
      refinementInstruction: String(refinementInstruction || '').slice(0, 500),
    });
    return { ok: true, id: String(created._id), version };
  } catch (err) {
    console.error('[db] saveArchitectureSpec failed:', err.message);
    return { ok: false, reason: 'db_error', error: err.message };
  }
}

export async function getLatestArchitectureSpec({ userId, email, projectId }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !projectId) return null;
    const doc = await ProjectArchitectureSpec.findOne({ userId: uid, projectId: String(projectId) }).sort({ version: -1 }).lean();
    return doc ? { ...doc, id: String(doc._id) } : null;
  } catch (err) {
    console.error('[db] getLatestArchitectureSpec failed:', err.message);
    return null;
  }
}

export async function listArchitectureSpecVersions({ userId, email, projectId }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const q = { userId: uid };
    if (projectId) q.projectId = String(projectId);
    const docs = await ProjectArchitectureSpec.find(q)
      .sort({ updatedAt: -1 }).limit(50)
      .select('projectId title provider targetLevel version validationScore createdAt updatedAt')
      .lean();
    return docs.map((d) => ({ ...d, id: String(d._id) }));
  } catch (err) {
    console.error('[db] listArchitectureSpecVersions failed:', err.message);
    return [];
  }
}

/* ============================================================
   GUIDED PROJECT WORKSPACE — one workspace plan per (user, project).
   All helpers degrade safely when the DB is disabled; the client keeps
   a copy of the plan on the project object (user-state) as a fallback,
   so the feature stays usable without MongoDB.
   ============================================================ */
const projectWorkspaceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    projectId: { type: String, required: true, index: true },
    workspacePlan: { type: mongoose.Schema.Types.Mixed, default: {} },
    currentTab: { type: String, default: 'overview' },
    selectedItem: { type: mongoose.Schema.Types.Mixed, default: null },
    starterPack: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
projectWorkspaceSchema.index({ userId: 1, projectId: 1 }, { unique: true });
export const ProjectWorkspace = mongoose.models.ProjectWorkspace || mongoose.model('ProjectWorkspace', projectWorkspaceSchema);

export async function getProjectWorkspace({ userId, email, projectId }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !projectId) return null;
    const doc = await ProjectWorkspace.findOne({ userId: uid, projectId: String(projectId) }).lean();
    return doc ? { ...doc, id: String(doc._id) } : null;
  } catch (err) { console.error('[db] getProjectWorkspace failed:', err.message); return null; }
}

export async function saveProjectWorkspace({ userId, email, projectId, workspacePlan }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    if (!projectId) return { ok: false, reason: 'no_project_id' };
    const doc = await ProjectWorkspace.findOneAndUpdate(
      { userId: uid, projectId: String(projectId) },
      { $set: { workspacePlan: workspacePlan || {}, email: cleanEmail(email) } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return { ok: true, id: String(doc._id) };
  } catch (err) { console.error('[db] saveProjectWorkspace failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function saveWorkspaceUiState({ userId, email, projectId, currentTab, selectedItem }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !projectId) return { ok: false, reason: 'not_found' };
    const set = {};
    if (currentTab != null) set.currentTab = String(currentTab).slice(0, 40);
    if (selectedItem !== undefined) set.selectedItem = selectedItem;
    await ProjectWorkspace.updateOne({ userId: uid, projectId: String(projectId) }, { $set: set });
    return { ok: true };
  } catch (err) { console.error('[db] saveWorkspaceUiState failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

export async function saveWorkspaceStarterPackMeta({ userId, email, projectId, starterPack }) {
  if (!URI) return { ok: false, reason: 'db_disabled' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !projectId) return { ok: false, reason: 'not_found' };
    await ProjectWorkspace.updateOne(
      { userId: uid, projectId: String(projectId) },
      { $set: { starterPack: starterPack || {}, 'workspacePlan.starterPack': starterPack || {} } }
    );
    return { ok: true };
  } catch (err) { console.error('[db] saveWorkspaceStarterPackMeta failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

/* ============================================================
   SERVER-OWNED PROJECT STORE  (Market-Readiness Gap Sprint, Phase 1)
   ------------------------------------------------------------
   One document per (user, project). The client keeps localStorage as a
   cache; this collection is the source of truth when the DB is on. Every
   helper degrades to a safe value when MONGODB_URI is not set, exactly
   like the rest of this file.
   Indexes:
   - {userId, projectId} unique → point lookups + upserts on save/progress.
   - {userId, updatedAt}        → listUserProjects sorted by recency, and
                                  the updatedAt-based sync merge.
   ============================================================ */
const userProjectSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    projectId: { type: String, required: true, index: true },
    project: { type: mongoose.Schema.Types.Mixed, default: {} },       // full client project object
    workspacePlan: { type: mongoose.Schema.Types.Mixed, default: null },
    taskProgress: { type: mongoose.Schema.Types.Mixed, default: {} },  // taskId -> status/notes
    status: { type: String, default: 'active', enum: ['active', 'archived', 'deleted'] },
    clientUpdatedAt: { type: Date, default: null }, // the client's own updatedAt — drives last-write-wins
  },
  { timestamps: true }
);
userProjectSchema.index({ userId: 1, projectId: 1 }, { unique: true });
userProjectSchema.index({ userId: 1, updatedAt: -1 });
export const UserProject = mongoose.models.UserProject || mongoose.model('UserProject', userProjectSchema);

const projDoc = (d) => d ? ({
  id: String(d._id), projectId: d.projectId, project: d.project || {},
  workspacePlan: d.workspacePlan || null, taskProgress: d.taskProgress || {},
  status: d.status || 'active', clientUpdatedAt: d.clientUpdatedAt || null,
  createdAt: d.createdAt, updatedAt: d.updatedAt,
}) : null;

export async function saveUserProject({ userId, email, projectId, project, workspacePlan, taskProgress, clientUpdatedAt }) {
  if (!URI) return { ok: false, reason: 'db_off' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const pid = String(projectId || project?.id || '').trim();
    if (!pid) return { ok: false, reason: 'no_project_id' };
    const set = { email: cleanEmail(email), status: 'active' };
    if (project !== undefined) set.project = project || {};
    if (workspacePlan !== undefined) set.workspacePlan = workspacePlan;
    if (taskProgress !== undefined) set.taskProgress = taskProgress || {};
    set.clientUpdatedAt = clientUpdatedAt ? new Date(clientUpdatedAt) : new Date();
    const doc = await UserProject.findOneAndUpdate(
      { userId: uid, projectId: pid },
      { $set: set },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return { ok: true, id: String(doc._id), record: projDoc(doc) };
  } catch (err) { console.error('[db] saveUserProject failed:', err.message); return { ok: false, reason: 'db_error', error: err.message }; }
}

export async function getUserProject({ userId, email, projectId }) {
  if (!URI) return null;
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !projectId) return null;
    const doc = await UserProject.findOne({ userId: uid, projectId: String(projectId), status: { $ne: 'deleted' } }).lean();
    return projDoc(doc);
  } catch (err) { console.error('[db] getUserProject failed:', err.message); return null; }
}

export async function listUserProjects({ userId, email, limit = 200 }) {
  if (!URI) return [];
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return [];
    const docs = await UserProject.find({ userId: uid, status: { $ne: 'deleted' } })
      .sort({ updatedAt: -1 }).limit(Math.min(limit, 500)).lean();
    return docs.map(projDoc);
  } catch (err) { console.error('[db] listUserProjects failed:', err.message); return []; }
}

export async function updateUserProjectProgress({ userId, email, projectId, taskProgress, taskPatch }) {
  if (!URI) return { ok: false, reason: 'db_off' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !projectId) return { ok: false, reason: 'not_found' };
    const update = {};
    if (taskProgress !== undefined) update.$set = { taskProgress: taskProgress || {} };
    else if (taskPatch && typeof taskPatch === 'object') {
      update.$set = {};
      for (const [taskId, v] of Object.entries(taskPatch)) {
        update.$set[`taskProgress.${String(taskId).replace(/[.$]/g, '_').slice(0, 120)}`] = v;
      }
    } else return { ok: false, reason: 'no_patch' };
    const doc = await UserProject.findOneAndUpdate(
      { userId: uid, projectId: String(projectId), status: { $ne: 'deleted' } },
      update, { new: true }
    ).lean();
    if (!doc) return { ok: false, reason: 'not_found' };
    return { ok: true, record: projDoc(doc) };
  } catch (err) { console.error('[db] updateUserProjectProgress failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

export async function deleteUserProject({ userId, email, projectId }) {
  if (!URI) return { ok: false, reason: 'db_off' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid || !projectId) return { ok: false, reason: 'not_found' };
    // Soft mark so a stale client sync can't resurrect it accidentally.
    const r = await UserProject.updateOne({ userId: uid, projectId: String(projectId) }, { $set: { status: 'deleted' } });
    return { ok: r.matchedCount > 0, reason: r.matchedCount > 0 ? undefined : 'not_found' };
  } catch (err) { console.error('[db] deleteUserProject failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

/* Merge the client's local projects array with the server set.
   Last-write-wins PER PROJECT by the client-side updatedAt timestamp.
   Returns the full merged set so the client can replace its cache. */
export async function syncUserProjects({ userId, email, projects = [] }) {
  if (!URI) return { ok: false, reason: 'db_off' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const incoming = (Array.isArray(projects) ? projects : []).filter((p) => p && p.id).slice(0, 300);
    const existing = await UserProject.find({ userId: uid }).lean();
    const byId = new Map(existing.map((d) => [d.projectId, d]));
    let uploaded = 0, kept = 0;
    for (const p of incoming) {
      const pid = String(p.id);
      const cur = byId.get(pid);
      const clientAt = p.updatedAt ? new Date(p.updatedAt) : new Date(0);
      const serverAt = cur?.clientUpdatedAt ? new Date(cur.clientUpdatedAt) : new Date(0);
      if (!cur || clientAt > serverAt) {
        await UserProject.findOneAndUpdate(
          { userId: uid, projectId: pid },
          { $set: { email: cleanEmail(email), project: p, status: 'active', clientUpdatedAt: clientAt } },
          { upsert: true, setDefaultsOnInsert: true }
        );
        uploaded++;
      } else kept++;
    }
    const docs = await UserProject.find({ userId: uid, status: { $ne: 'deleted' } }).sort({ updatedAt: -1 }).limit(500).lean();
    return { ok: true, uploaded, kept, projects: docs.map((d) => d.project).filter(Boolean) };
  } catch (err) { console.error('[db] syncUserProjects failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

/* ============================================================
   ERROR LOGS  (capped collection — observability, Phase 5)
   ============================================================ */
const errorLogSchema = new mongoose.Schema(
  {
    requestId: { type: String, default: '' },
    method: { type: String, default: '' },
    path: { type: String, default: '' },
    status: { type: Number, default: 500 },
    message: { type: String, default: '' },
    stack: { type: String, default: '' },
    userEmail: { type: String, default: '' },
  },
  { timestamps: true, capped: { size: 5 * 1024 * 1024, max: 5000 } } // bounded: never grows unchecked
);
/* createdAt index → paginated admin error feed (newest first). */
errorLogSchema.index({ createdAt: -1 });
export const ErrorLog = mongoose.models.ErrorLog || mongoose.model('ErrorLog', errorLogSchema);

export async function saveErrorLog(entry = {}) {
  if (!URI) return { ok: false, reason: 'db_off' };
  try {
    await connectDB();
    await ErrorLog.create({
      requestId: String(entry.requestId || '').slice(0, 64),
      method: String(entry.method || '').slice(0, 10),
      path: String(entry.path || '').slice(0, 300),
      status: Number(entry.status) || 500,
      message: String(entry.message || '').slice(0, 1000),
      stack: String(entry.stack || '').slice(0, 4000),
      userEmail: String(entry.userEmail || '').slice(0, 200),
    });
    return { ok: true };
  } catch (err) { console.error('[db] saveErrorLog failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

export async function listErrorLogs({ page = 1, pageSize = 50 } = {}) {
  if (!URI) return { ok: false, reason: 'db_off', errors: [], total: 0 };
  try {
    await connectDB();
    const ps = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const pg = Math.max(Number(page) || 1, 1);
    const [errors, total] = await Promise.all([
      ErrorLog.find({}).sort({ createdAt: -1 }).skip((pg - 1) * ps).limit(ps).lean(),
      ErrorLog.estimatedDocumentCount(),
    ]);
    return { ok: true, errors: errors.map((e) => ({ ...e, id: String(e._id) })), total, page: pg, pageSize: ps };
  } catch (err) { console.error('[db] listErrorLogs failed:', err.message); return { ok: false, reason: 'db_error', errors: [], total: 0 }; }
}

/* ============================================================
   USAGE COUNTERS  (per-plan daily quotas, Phase 5)
   ------------------------------------------------------------
   One doc per (user, bucket, UTC day). Unique index makes $inc upserts
   atomic and the daily reset implicit (new day → new doc).
   ============================================================ */
const usageCounterSchema = new mongoose.Schema(
  {
    userKey: { type: String, required: true },  // user id or lowercased email
    bucket: { type: String, required: true },   // 'generation' | 'aiCalls' | 'syncs' | 'exports'
    day: { type: String, required: true },      // 'YYYY-MM-DD' UTC
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);
/* Unique {userKey, bucket, day} → atomic findOneAndUpdate($inc) per request. */
usageCounterSchema.index({ userKey: 1, bucket: 1, day: 1 }, { unique: true });
export const UsageCounter = mongoose.models.UsageCounter || mongoose.model('UsageCounter', usageCounterSchema);

export async function incrementDailyUsage({ userKey, bucket, day }) {
  if (!URI) return null; // caller falls back to its in-memory counter
  try {
    await connectDB();
    const doc = await UsageCounter.findOneAndUpdate(
      { userKey: String(userKey).slice(0, 200), bucket: String(bucket).slice(0, 40), day: String(day).slice(0, 10) },
      { $inc: { count: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return doc.count;
  } catch (err) { console.error('[db] incrementDailyUsage failed:', err.message); return null; }
}

/* ============================================================
   DPDP BASICS  (account export + soft delete + cascade, Phase 5)
   ------------------------------------------------------------
   EXPORT_SOURCES is the single declarative list of every user-keyed
   collection. Both the export and the delete cascade iterate it, so the
   two can never drift apart (tested in test/hardening.test.js).
   ============================================================ */
export const EXPORT_SOURCES = [
  { name: 'profile',            model: () => User,                    key: '_id' },
  { name: 'userState',          model: () => UserState,               key: 'userId' },
  { name: 'resumes',            model: () => Resume,                  key: 'userId' },
  { name: 'resumeAnalyses',     model: () => ResumeAnalysis,          key: 'userId' },
  { name: 'resumeVersions',     model: () => ResumeVersion,           key: 'userId' },
  { name: 'applications',       model: () => Application,             key: 'userId' },
  { name: 'outreach',           model: () => Outreach,                key: 'userId' },
  { name: 'activities',         model: () => Activity,                key: 'userId' },
  { name: 'skillXp',            model: () => SkillXp,                 key: 'userId' },
  { name: 'projectSubmissions', model: () => ProjectSubmission,       key: 'userId' },
  { name: 'projects',           model: () => UserProject,             key: 'userId' },
  { name: 'projectWorkspaces',  model: () => ProjectWorkspace,        key: 'userId' },
  { name: 'projectRoadmaps',    model: () => ProjectRoadmap,          key: 'userId' },
  { name: 'architectureSpecs',  model: () => ProjectArchitectureSpec, key: 'userId' },
  { name: 'marketplaceListings',model: () => MarketplaceListing,      key: 'userId' },
  { name: 'savedListings',      model: () => SavedListing,            key: 'userId' },
  { name: 'collaborationApplications', model: () => CollaborationApplication, key: 'userId' },
  { name: 'projectClones',      model: () => ProjectClone,            key: 'userId' },
  { name: 'projectReviews',     model: () => ProjectReview,           key: 'userId' },
  { name: 'projectEngagements', model: () => ProjectEngagement,       key: 'userId' },
  { name: 'patentRecords',      model: () => PatentRecord,            key: 'userId' },
  { name: 'patentIdeas',        model: () => PatentIdea,              key: 'userId' },
  { name: 'priorArtRecords',    model: () => PriorArtRecord,          key: 'userId' },
  { name: 'patentDisclosures',  model: () => PatentDisclosure,        key: 'userId' },
  { name: 'patentFeedback',     model: () => PatentFeedback,          key: 'userId' },
  { name: 'patentActivities',   model: () => PatentActivity,          key: 'userId' },
  { name: 'networkProfile',     model: () => NetworkProfile,          key: 'userId' },
  { name: 'referralPosts',      model: () => ReferralPost,            key: 'userId' },
  { name: 'referralRequests',   model: () => ReferralRequest,         key: 'userId' },
  { name: 'githubConnection',   model: () => GithubConnection,        key: 'userId' },
  { name: 'githubRepositories', model: () => GithubRepository,        key: 'userId' },
  { name: 'githubRepoAnalyses', model: () => GithubRepoAnalysis,      key: 'userId' },
  { name: 'githubAudits',       model: () => GithubAudit,             key: 'userId' },
  { name: 'supportTickets',     model: () => SupportTicket,           key: 'userId' },
];

/* Full JSON export of everything stored for one user. */
export async function exportUserData({ userId, email }) {
  if (!URI) return { ok: false, reason: 'db_off', collections: {} };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found', collections: {} };
    const collections = {};
    for (const src of EXPORT_SOURCES) {
      try {
        const Model = src.model();
        const q = src.key === '_id' ? { _id: uid } : { [src.key]: uid };
        const docs = await Model.find(q).limit(2000).lean();
        collections[src.name] = docs.map((d) => { const { __v, ...rest } = d; return rest; });
      } catch { collections[src.name] = []; }
    }
    return { ok: true, exportedAt: new Date().toISOString(), userId: String(uid), collections };
  } catch (err) { console.error('[db] exportUserData failed:', err.message); return { ok: false, reason: 'db_error', collections: {} }; }
}

/* Soft delete: mark the account; the cascade runs only after the grace window. */
export const DELETE_GRACE_DAYS = 7;
export async function softDeleteAccount({ userId, email }) {
  if (!URI) return { ok: false, reason: 'db_off' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const now = new Date();
    const scheduledFor = new Date(now.getTime() + DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    await User.updateOne({ _id: uid }, { $set: { deletedAt: now, deleteScheduledFor: scheduledFor, isActive: false } });
    return { ok: true, deletedAt: now.toISOString(), deleteScheduledFor: scheduledFor.toISOString(), graceDays: DELETE_GRACE_DAYS };
  } catch (err) { console.error('[db] softDeleteAccount failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

/* Hard cascade: remove every user-keyed document, then the user itself.
   Iterates EXPORT_SOURCES so deletion always covers exactly what export covers. */
export async function cascadeDeleteUser({ userId, email }) {
  if (!URI) return { ok: false, reason: 'db_off' };
  try {
    await connectDB();
    const uid = await resolveUserId({ userId, email });
    if (!uid) return { ok: false, reason: 'user_not_found' };
    const removed = {};
    for (const src of EXPORT_SOURCES) {
      if (src.key === '_id') continue; // user doc deleted last
      try {
        const r = await src.model().deleteMany({ [src.key]: uid });
        removed[src.name] = r.deletedCount || 0;
      } catch { removed[src.name] = 0; }
    }
    await User.deleteOne({ _id: uid });
    removed.profile = 1;
    return { ok: true, removed };
  } catch (err) { console.error('[db] cascadeDeleteUser failed:', err.message); return { ok: false, reason: 'db_error' }; }
}

/* Sweep accounts whose grace window has expired. Safe to call from any
   request path or a cron — it is idempotent and bounded. */
export async function purgeExpiredDeletions({ limit = 10 } = {}) {
  if (!URI) return { ok: false, reason: 'db_off', purged: 0 };
  try {
    await connectDB();
    const due = await User.find({ deletedAt: { $ne: null }, deleteScheduledFor: { $lte: new Date() } })
      .select('_id email').limit(Math.min(limit, 50)).lean();
    let purged = 0;
    for (const u of due) {
      const r = await cascadeDeleteUser({ userId: String(u._id) });
      if (r.ok) purged++;
    }
    return { ok: true, purged };
  } catch (err) { console.error('[db] purgeExpiredDeletions failed:', err.message); return { ok: false, reason: 'db_error', purged: 0 }; }
}
