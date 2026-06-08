/* ============================================================
   REQUEST VALIDATION (zod)
   ------------------------------------------------------------
   Lightweight, targeted body validation for the important
   state-changing endpoints. Rejects malformed payloads, oversized
   fields, bad emails / URLs and unexpected structures with a clear
   400 before any handler logic runs.
   ============================================================ */
import { z } from 'zod';
import { logger } from './logger.js';

/** Express middleware factory: validates req.body against a zod schema. */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 8)
        .map((i) => ({ path: i.path.join('.'), message: i.message }));
      logger.debug('Validation failed', { path: req.path, issues });
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Some fields are missing or invalid.',
        issues,
      });
    }
    req.body = result.data; // normalized / trimmed values
    next();
  };
}

const email = z.string().trim().min(3).max(160).email('A valid email is required.');
const shortText = (max) => z.string().trim().max(max);
const url = z.string().trim().url('A valid URL is required.').max(2000);

/* ---- Support ---- */
export const supportChatSchema = z.object({
  message: z.string().trim().min(1, 'Message is required.').max(1000),
});

export const ticketSchema = z.object({
  name: shortText(120).optional().default(''),
  email,
  category: shortText(40).optional().default('general'),
  subject: z.string().trim().min(1, 'Subject is required.').max(200),
  message: z.string().trim().min(1, 'Message is required.').max(5000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
});

/* ---- User state / profile ---- */
export const userStatePatchSchema = z
  .object({
    profile: z.record(z.string(), z.any()).optional(),
    resume: z.record(z.string(), z.any()).optional(),
    projects: z.array(z.any()).max(200).optional(),
    tracker: z.record(z.string(), z.any()).optional(),
    xpSnapshot: z.record(z.string(), z.any()).optional(),
    creator: z.record(z.string(), z.any()).optional(),
  })
  .strict();

export const userProfileSchema = z.object({
  profile: z.record(z.string(), z.any()).optional(),
}).passthrough();

/* ---- Jobs ---- */
export const jobsSearchQuerySchema = z.object({
  role: shortText(120).optional(),
  location: shortText(120).optional(),
  mode: z.enum(['Any', 'Remote', 'Hybrid', 'On-site', 'Onsite']).optional(),
  freshness: z.enum(['24h', '3d', '7d', '30d', 'latest']).optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
  verify: z.enum(['0', '1']).optional(),
  strict: z.enum(['0', '1', 'true', 'false']).optional(),
  sources: shortText(300).optional(),
}).passthrough();

/* ---- Contacts ---- */
export const contactsFindSchema = z.object({
  company: shortText(160).optional(),
  domain: shortText(160).optional(),
  role: shortText(120).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
}).refine((d) => d.company || d.domain, {
  message: 'A company name or domain is required.',
});

/* ---- Payments ---- */
export const createOrderSchema = z.object({
  planId: z.string().trim().min(1).max(40),
});

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(120),
  razorpay_payment_id: z.string().trim().min(1).max(120),
  razorpay_signature: z.string().trim().min(1).max(256),
  planId: z.string().trim().min(1).max(40),
});

/* ---- Network ---- */
export const networkPostSchema = z.object({
  type: z.string().trim().min(1).max(40),
  fields: z.record(z.string(), z.any()).optional().default({}),
}).passthrough();

export const networkRequestSchema = z.object({
  toUserId: shortText(60).optional(),
  postId: shortText(60).optional(),
  kind: shortText(40).optional(),
  message: shortText(2000).optional(),
}).passthrough();

/* ---- AI passthrough (Anthropic message shape) — guard size/shape only ---- */
export const aiMessagesSchema = z.object({
  model: shortText(80).optional(),
  max_tokens: z.coerce.number().int().min(1).max(8192).optional(),
  system: z.union([z.string().max(40000), z.array(z.any())]).optional(),
  messages: z.array(z.any()).min(1).max(50),
}).passthrough();

/* ---- Resume analysis (deterministic scoring) ---- */
export const resumeAnalyzeSchema = z.object({
  resumeText: z.string().trim().min(1, 'Resume text is required.').max(60000),
  fileName: shortText(260).optional().default(''),
  targetRole: shortText(120).optional().default(''),
}).passthrough();

export const resumeTailorSchema = z.object({
  resumeText: z.string().trim().min(1, 'Resume text is required.').max(60000),
  jobDescription: z.string().trim().min(1, 'Job description is required.').max(40000),
  fileName: shortText(260).optional().default(''),
  targetRole: shortText(120).optional().default(''),
  mode: z.enum(['conservative', 'balanced', 'aggressive']).optional().default('balanced'),
}).passthrough();

export const resumeVersionSchema = z.object({
  id: shortText(60).optional(),
  title: z.string().trim().min(1, 'A version title is required.').max(160),
  kind: z.enum(['base', 'role', 'job']).optional().default('base'),
  targetRole: shortText(120).optional().default(''),
  jobId: shortText(120).optional().default(''),
  jobDescription: shortText(40000).optional().default(''),
  resumeText: shortText(60000).optional().default(''),
  structuredResume: z.record(z.string(), z.any()).optional(),
  resumeScore: z.coerce.number().min(0).max(100).optional(),
  jobFitScore: z.coerce.number().min(0).max(100).optional(),
  matchedKeywords: z.array(z.string()).max(200).optional().default([]),
  missingKeywords: z.array(z.string()).max(200).optional().default([]),
  changeLog: z.array(z.string()).max(200).optional().default([]),
  fabricationRisks: z.array(z.any()).max(100).optional().default([]),
}).passthrough();

/* ---- Project submission for skill verification ---- */
export const projectSubmissionSchema = z.object({
  id: shortText(60).optional(),
  title: z.string().trim().min(1, 'A project title is required.').max(200),
  description: shortText(8000).optional().default(''),
  roleInProject: shortText(200).optional().default(''),
  technologies: z.array(z.string()).max(60).optional().default([]),
  githubUrl: shortText(500).optional().default(''),
  liveDemoUrl: shortText(500).optional().default(''),
  proofUrls: z.array(z.string()).max(20).optional().default([]),
  certificateUrl: shortText(500).optional().default(''),
  startDate: shortText(40).optional().default(''),
  endDate: shortText(40).optional().default(''),
  complexityLevel: z.enum(['beginner', 'basic', 'intermediate', 'advanced', 'expert']).optional().default('intermediate'),
  contributionType: shortText(200).optional().default(''),
  outcome: shortText(4000).optional().default(''),
  claimedSkills: z.array(z.string()).max(60).optional().default([]),
  githubAnalysis: z.any().optional(),
  liveLinkCheck: z.any().optional(),
}).passthrough();

export const adminVerifySchema = z.object({
  status: z.enum(['verified', 'rejected', 'needs_review', 'pending']).optional(),
  skills: z.record(z.string(), z.enum(['verified', 'rejected'])).optional(),
}).passthrough();

/* ---- Project Marketplace ---- */
export const marketplaceListingSchema = z.object({
  projectId: shortText(60).optional().default(''),
  listingType: z.enum([
    'published_project', 'project_idea', 'build_roadmap', 'collaboration_request',
    'mentor_reviewed', 'recruiter_ready', 'template_starter', 'hackathon_team', 'college_capstone',
  ]).optional().default('project_idea'),
  title: z.string().trim().min(1, 'A title is required.').max(200),
  summary: shortText(600).optional().default(''),
  description: shortText(8000).optional().default(''),
  problemStatement: shortText(4000).optional().default(''),
  category: shortText(80).optional().default(''),
  tags: z.array(z.string()).max(40).optional().default([]),
  targetRole: shortText(120).optional().default(''),
  difficulty: shortText(40).optional().default('Intermediate'),
  duration: shortText(60).optional().default(''),
  techStack: z.array(z.string()).max(40).optional().default([]),
  claimedSkills: z.array(z.string()).max(60).optional().default([]),
  githubUrl: shortText(500).optional().default(''),
  liveDemoUrl: shortText(500).optional().default(''),
  proofUrls: z.array(z.string()).max(20).optional().default([]),
  milestones: z.array(z.any()).max(40).optional().default([]),
  resumeBullets: z.array(z.string()).max(20).optional().default([]),
  openRoles: z.array(z.any()).max(20).optional().default([]),
  visibility: z.enum(['public', 'unlisted', 'private']).optional().default('public'),
}).passthrough();

export const collaborationApplySchema = z.object({
  roleApplied: shortText(120).optional().default(''),
  message: shortText(2000).optional().default(''),
}).passthrough();

export const listingReviewSchema = z.object({
  rating: z.coerce.number().min(0).max(5).optional().default(0),
  comment: shortText(2000).optional().default(''),
}).passthrough();

/* ---- Architecture generator ---- */
export const architectureSchema = z.object({
  title: shortText(200).optional().default(''),
  description: shortText(8000).optional().default(''),
  techStack: z.array(z.string()).max(60).optional().default([]),
  targetRole: shortText(120).optional().default(''),
  difficulty: shortText(40).optional().default(''),
  teamSize: z.coerce.number().min(0).max(10000).optional(),
  level: z.enum(['mvp', 'production', 'enterprise', 'college_saas']).optional().default('production'),
  enrich: z.boolean().optional().default(false),
}).passthrough();

/* ---- Patent OS ---- */
export const patentIdeaGenerateSchema = z.object({
  domain: shortText(80).optional().default(''),
  targetUser: shortText(120).optional().default(''),
  problem: shortText(4000).optional().default(''),
  existingSolutions: shortText(4000).optional().default(''),
  technology: shortText(60).optional().default(''),
  goal: shortText(120).optional().default(''),
  count: z.coerce.number().min(1).max(10).optional().default(6),
  creativity: z.enum(['Conservative', 'Balanced', 'Bold']).optional().default('Balanced'),
  useAI: z.boolean().optional().default(true),
}).passthrough();

export const patentIdeaPatchSchema = z.object({
  title: shortText(200).optional(),
  domain: shortText(80).optional(),
  targetUser: shortText(120).optional(),
  problem: shortText(4000).optional(),
  existingSolutions: shortText(4000).optional(),
  proposedSolution: shortText(4000).optional(),
  technicalMechanism: shortText(4000).optional(),
  inputData: shortText(2000).optional(),
  processingLogic: shortText(2000).optional(),
  outputResult: shortText(2000).optional(),
  feedbackLoop: shortText(2000).optional(),
  noveltyAngle: shortText(2000).optional(),
  marketUseCase: shortText(2000).optional(),
  implementationPlan: shortText(2000).optional(),
  tags: z.array(z.string()).max(12).optional(),
  status: z.enum(['raw_idea', 'shortlisted', 'refining', 'prior_art_review', 'poc_planned', 'disclosure_drafted', 'attorney_ready', 'filed', 'published', 'granted', 'abandoned']).optional(),
  archived: z.boolean().optional(),
}).passthrough();

export const patentIdeaSaveSchema = z.object({
  idea: z.object({}).passthrough(),
}).passthrough();

export const priorArtRecordSchema = z.object({
  source: shortText(200).optional().default(''),
  title: shortText(300).optional().default(''),
  link: shortText(500).optional().default(''),
  summary: shortText(2000).optional().default(''),
  overlap: shortText(1000).optional().default(''),
  differences: shortText(1000).optional().default(''),
  riskLevel: z.enum(['Low', 'Medium', 'High']).optional().default('Medium'),
  notes: shortText(1000).optional().default(''),
}).passthrough();

export const patentFeedbackSchema = z.object({
  feedbackType: z.enum(['useful', 'not useful', 'too generic', 'already exists', 'technically weak', 'commercially strong', 'patent-worthy', 'needs refinement']),
  notes: shortText(1000).optional().default(''),
}).passthrough();

/* ---- Application Package Generator ---- */
export const appPackageSchema = z.object({
  resumeText: z.string().trim().min(1, 'Resume text is required.').max(60000),
  jobDescription: z.string().trim().min(1, 'Job description is required.').max(40000),
  targetRole: shortText(120).optional().default(''),
  applicantName: shortText(120).optional().default(''),
  enrich: z.boolean().optional().default(false),
}).passthrough();

/* ---- Patent Engine ---- */
export const patentAssessSchema = z.object({
  projectId: shortText(60).optional().default(''),
  title: shortText(200).optional().default(''),
  problemStatement: shortText(8000).optional().default(''),
  technicalSolution: shortText(8000).optional().default(''),
  description: shortText(8000).optional().default(''),
  summary: shortText(2000).optional().default(''),
  techStack: z.array(z.string()).max(60).optional().default([]),
  skills: z.array(z.string()).max(60).optional().default([]),
  category: shortText(80).optional().default(''),
  inventors: z.array(z.string()).max(20).optional().default([]),
  githubUrl: shortText(500).optional().default(''),
  liveDemoUrl: shortText(500).optional().default(''),
  verificationStatus: shortText(40).optional().default(''),
  enrich: z.boolean().optional().default(false),
}).passthrough();

export const patentRecordSchema = z.object({
  id: shortText(60).optional(),
  projectId: shortText(60).optional().default(''),
  patentTitle: shortText(200).optional().default(''),
  inventors: z.array(z.string()).max(20).optional().default([]),
  assignee: shortText(200).optional().default(''),
  jurisdiction: shortText(120).optional().default(''),
  applicationNumber: shortText(80).optional().default(''),
  publicationNumber: shortText(80).optional().default(''),
  grantNumber: shortText(80).optional().default(''),
  filingDate: shortText(40).optional().default(''),
  publicationDate: shortText(40).optional().default(''),
  grantDate: shortText(40).optional().default(''),
  status: z.enum([
    'idea_identified', 'invention_disclosure_drafted', 'prior_art_search_started',
    'prior_art_reviewed', 'patent_attorney_review', 'provisional_filed',
    'non_provisional_filed', 'published', 'office_action', 'granted',
    'rejected_abandoned', 'licensed_commercialized',
  ]).optional().default('idea_identified'),
  attorney: shortText(200).optional().default(''),
  notes: shortText(4000).optional().default(''),
  readinessScore: z.coerce.number().min(0).max(100).optional(),
  readinessBreakdown: z.record(z.string(), z.any()).optional(),
  classification: shortText(80).optional().default(''),
  priorArt: z.array(z.any()).max(50).optional().default([]),
  disclosure: z.any().optional(),
  deadlines: z.array(z.any()).max(50).optional().default([]),
  badge: shortText(40).optional().default('not_assessed'),
}).passthrough();

/* ---- Template image analysis (base64) ---- */
export const templateImageSchema = z.object({
  imageBase64: z.string().min(8, 'Image data is required.').max(5_000_000, 'Image is too large (max ~3.5MB).'),
  mime: z.enum(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']).optional().default('image/png'),
});

/* ---- GitHub integration (Career Proof Profile) ---- */
export const githubLinkProjectSchema = z.object({
  projectId: shortText(80).min(1, 'A project id is required.'),
});
export const githubVisibilitySchema = z.object({
  publicProofVisible: z.boolean().optional(),
  privateProofSummaryVisible: z.boolean().optional(),
  confirmPrivate: z.boolean().optional(),
}).refine(
  (v) => v.publicProofVisible !== undefined || v.privateProofSummaryVisible !== undefined,
  { message: 'Provide at least one visibility flag.' }
);
export const githubAnalyzeSchema = z.object({
  // Confirmation gate for analyzing a private repo (UX safety).
  confirmPrivate: z.boolean().optional().default(false),
}).passthrough();
export const githubImportProjectSchema = z.object({
  title: shortText(200).optional(),
}).passthrough();

export { email, url };
