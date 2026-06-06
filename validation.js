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
  freshness: z.enum(['24h', '3d', '7d']).optional(),
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

/* ---- Template image analysis (base64) ---- */
export const templateImageSchema = z.object({
  imageBase64: z.string().min(8, 'Image data is required.').max(5_000_000, 'Image is too large (max ~3.5MB).'),
  mime: z.enum(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']).optional().default('image/png'),
});

export { email, url };
