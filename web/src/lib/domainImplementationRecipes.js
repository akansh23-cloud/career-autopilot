// Project OS — Builder Mode v3: domain implementation recipes.
//
// Domain-specific, code-level knowledge the guide generator draws on to turn a
// task into realistic implementation guidance (request/response shapes, schema
// fields, business-logic steps, failure patterns). Pure data + small helpers;
// no code is generated here — only structured guidance.

const lc = (s) => String(s == null ? '' : s).toLowerCase();

/* ---------------- Kubernetes / DevOps failure intelligence ---------------- */
export const KUBERNETES_FAILURE_PATTERNS = [
  { pattern: 'CrashLoopBackOff', severity: 'high', probableCause: 'Container starts then crashes repeatedly (bad command, missing dependency, failed migration).', recommendedFix: 'Inspect container logs and the exit code; fix the entrypoint/command or the failing dependency, then redeploy.' },
  { pattern: 'ImagePullBackOff', severity: 'high', probableCause: 'Kubelet cannot pull the image (wrong tag, private registry without credentials).', recommendedFix: 'Verify the image name/tag and add an imagePullSecret for private registries.' },
  { pattern: 'ErrImagePull', severity: 'high', probableCause: 'Image pull failed outright (registry unreachable or image does not exist).', recommendedFix: 'Confirm the registry URL and that the image:tag exists; check network/registry auth.' },
  { pattern: 'OOMKilled', severity: 'high', probableCause: 'Container exceeded its memory limit and was killed.', recommendedFix: 'Raise the memory limit/request or fix the memory leak; profile peak usage.' },
  { pattern: 'Readiness probe failed', severity: 'medium', probableCause: 'Readiness probe never succeeds, so the pod never receives traffic.', recommendedFix: 'Check the probe path/port and initialDelaySeconds; ensure the app is actually ready at that endpoint.' },
  { pattern: 'Liveness probe failed', severity: 'medium', probableCause: 'Liveness probe fails, causing repeated restarts.', recommendedFix: 'Loosen the probe threshold/timeout or fix the unhealthy endpoint.' },
  { pattern: 'Pending pod', severity: 'medium', probableCause: 'Pod cannot be scheduled (insufficient CPU/memory, taints, no matching node).', recommendedFix: 'Check node capacity, requests/limits and tolerations; scale the cluster if needed.' },
  { pattern: 'Node pressure', severity: 'medium', probableCause: 'Node under memory/disk pressure is evicting pods.', recommendedFix: 'Free disk/memory on the node, add nodes, or set sensible eviction thresholds.' },
  { pattern: 'ConfigMap/Secret missing', severity: 'high', probableCause: 'Pod references a ConfigMap/Secret that does not exist.', recommendedFix: 'Create the referenced ConfigMap/Secret or fix the reference name/namespace.' },
  { pattern: 'Service selector mismatch', severity: 'medium', probableCause: 'Service selector does not match any pod labels, so it has no endpoints.', recommendedFix: 'Align the Service selector with the pod template labels.' },
];

export const ROOT_CAUSE_RULES_FILE = {
  path: 'server/services/rootCauseRules.js',
  purpose: 'Declarative rule table mapping Kubernetes failure patterns to probable cause + recommended fix.',
  responsibilities: ['Export an array of rules { pattern, severity, probableCause, recommendedFix }', 'Be the single source of truth the analyzer matches parsed signals against'],
  exports: ['ROOT_CAUSE_RULES'],
  imports: [],
  notes: 'Each rule: { pattern, severity, probableCause, recommendedFix }. Keep patterns matchable against raw log lines / pod events.',
};

/* ---------------- Domain entity field libraries ---------------- */
const ENTITY_FIELDS = {
  // Kubernetes / DevOps
  UploadedLog: ['projectId', 'fileName', 'rawContent', 'sizeBytes', 'source', 'createdAt'],
  Finding: ['uploadId', 'pattern', 'severity', 'probableCause', 'recommendedFix', 'createdAt'],
  // Resume / ATS
  ResumeAnalysis: ['userId', 'fileName', 'parsedText', 'skills', 'atsScore', 'createdAt'],
  JobDescription: ['userId', 'title', 'rawText', 'requiredSkills', 'createdAt'],
  KeywordGap: ['resumeId', 'jobDescriptionId', 'missingKeywords', 'matchedKeywords', 'createdAt'],
  Recommendation: ['resumeId', 'text', 'priority', 'createdAt'],
  Resume: ['userId', 'fileName', 'parsedText', 'skills', 'createdAt'],
  ScoreReport: ['resumeId', 'jobDescription', 'atsScore', 'missingKeywords', 'createdAt'],
  // Patent / Innovation
  InventionDisclosure: ['title', 'painPoint', 'noveltyAngle', 'inventors', 'createdAt'],
  PriorArtReference: ['disclosureId', 'source', 'reference', 'similarity', 'notes'],
  NoveltyGap: ['disclosureId', 'aspect', 'closestPriorArt', 'gapNotes'],
  IpReadinessScore: ['disclosureId', 'score', 'rationale', 'createdAt'],
  ClaimDraft: ['disclosureId', 'independentClaim', 'dependentClaims', 'createdAt'],
  EvidenceItem: ['disclosureId', 'type', 'description', 'attachedAt'],
  Disclosure: ['title', 'painPoint', 'noveltyAngle', 'inventors', 'createdAt'],
  PriorArtResult: ['disclosureId', 'source', 'reference', 'similarity', 'createdAt'],
  // Marketplace
  Listing: ['sellerId', 'title', 'price', 'description', 'category', 'createdAt'],
  SellerProfile: ['userId', 'storeName', 'rating', 'createdAt'],
  Order: ['buyerId', 'listingId', 'quantity', 'status', 'total', 'createdAt'],
  Review: ['listingId', 'buyerId', 'rating', 'comment', 'createdAt'],
  PaymentIntent: ['orderId', 'amount', 'currency', 'status', 'createdAt'],
  // Document analyzer
  Document: ['userId', 'fileName', 'rawText', 'createdAt'],
  Extraction: ['documentId', 'field', 'value', 'confidence'],
};

const ENTITY_RELATIONSHIPS = {
  Finding: 'belongs to one UploadedLog (uploadId) and indirectly to a Project.',
  UploadedLog: 'belongs to one Project (projectId); has many Findings.',
  KeywordGap: 'links a ResumeAnalysis to a JobDescription.',
  Order: 'references a Listing (listingId) and a buyer (buyerId).',
  Review: 'references a Listing (listingId) and a buyer (buyerId).',
  PriorArtReference: 'belongs to one InventionDisclosure (disclosureId).',
  Extraction: 'belongs to one Document (documentId).',
};

export function entityFields(name) {
  const key = Object.keys(ENTITY_FIELDS).find((k) => lc(k) === lc(name));
  return key ? ENTITY_FIELDS[key].slice() : null;
}
export function entityRelationship(name) {
  const key = Object.keys(ENTITY_RELATIONSHIPS).find((k) => lc(k) === lc(name));
  return key ? ENTITY_RELATIONSHIPS[key] : '';
}

/* ---------------- API contract recipes ---------------- */
// Keyed by a path fragment; returns request/response/validation/errors.
const API_RECIPES = [
  {
    match: /logs\/upload/, method: 'POST',
    requestBody: 'multipart/form-data — file: a .txt or .log file; projectId: string',
    responseBody: '{ "uploadId": "string", "fileName": "deployment.log", "status": "uploaded" }',
    validationRules: ['Reject when no file is attached', 'Reject unsupported extensions (allow .txt/.log)', 'Reject files larger than the configured size limit', 'Require a non-empty projectId'],
    errorCases: ['400 when the file is missing', '400 when the extension is invalid', '413 when the file is too large', '500 when the database write fails'],
    businessLogicSteps: ['Read the uploaded file metadata (name, size, mime).', 'Validate the extension and size.', 'Persist the raw content (or a storage reference).', 'Create an UploadedLog record.', 'Return the generated uploadId.'],
  },
  {
    match: /deployments\/analyze|analyze/, method: 'POST',
    requestBody: '{ "uploadId": "string" }',
    responseBody: '{ "uploadId": "string", "findings": [ { "pattern": "CrashLoopBackOff", "severity": "high", "rootCause": "...", "recommendation": "..." } ] }',
    validationRules: ['Require a valid uploadId that exists', 'Reject when the referenced log has no content'],
    errorCases: ['404 when the uploadId is unknown', '422 when the log cannot be parsed', '500 on analyzer failure'],
    businessLogicSteps: ['Load the UploadedLog by uploadId.', 'Run the log parser to extract signals (pod events, error strings).', 'Match signals against ROOT_CAUSE_RULES.', 'Rank findings by severity.', 'Persist Findings and return them.'],
  },
  {
    match: /findings/, method: 'GET',
    requestBody: 'none (path param :uploadId)',
    responseBody: '{ "findings": [ { "pattern": "...", "severity": "...", "rootCause": "...", "recommendation": "..." } ] }',
    validationRules: ['Require a valid uploadId path param'],
    errorCases: ['404 when no findings exist for the uploadId'],
    businessLogicSteps: ['Read findings for the uploadId.', 'Return them ordered by severity.'],
  },
  {
    match: /resume\/upload/, method: 'POST',
    requestBody: 'multipart/form-data — file: a PDF/DOCX resume; userId: string',
    responseBody: '{ "resumeId": "string", "skills": ["..."], "status": "parsed" }',
    validationRules: ['Reject when no file is attached', 'Allow only .pdf/.docx', 'Require userId'],
    errorCases: ['400 when the file is missing or unsupported', '422 when parsing fails'],
    businessLogicSteps: ['Accept the file.', 'Extract text (pdf/docx parser).', 'Pull out skills/sections.', 'Save a ResumeAnalysis.', 'Return resumeId + parsed skills.'],
  },
  {
    match: /resume\/score/, method: 'POST',
    requestBody: '{ "resumeId": "string", "jobDescription": "string" }',
    responseBody: '{ "atsScore": 72, "missingKeywords": ["..."], "matchedKeywords": ["..."] }',
    validationRules: ['Require an existing resumeId', 'Require a non-empty jobDescription'],
    errorCases: ['404 when resumeId is unknown', '400 when jobDescription is empty'],
    businessLogicSteps: ['Load the parsed resume.', 'Tokenise the job description.', 'Compute keyword overlap + an ATS score.', 'Persist a ScoreReport.', 'Return score + gaps.'],
  },
  {
    match: /jobs\/match/, method: 'POST',
    requestBody: '{ "resumeId": "string", "jobDescription": "string" }',
    responseBody: '{ "matchedKeywords": ["..."], "missingKeywords": ["..."], "matchScore": 0.64 }',
    validationRules: ['Require resumeId + jobDescription'],
    errorCases: ['404 when resumeId is unknown'],
    businessLogicSteps: ['Load the resume keywords.', 'Extract required skills from the JD.', 'Diff matched vs missing.', 'Return the match result.'],
  },
  {
    match: /disclosures/, method: 'POST',
    requestBody: '{ "title": "string", "painPoint": "string", "noveltyAngle": "string", "inventors": ["..."] }',
    responseBody: '{ "disclosureId": "string", "status": "captured" }',
    validationRules: ['Require title + painPoint', 'noveltyAngle recommended'],
    errorCases: ['400 when title/painPoint missing'],
    businessLogicSteps: ['Validate the disclosure fields.', 'Create an InventionDisclosure record.', 'Return the disclosureId.'],
  },
  {
    match: /prior-art\/search/, method: 'POST',
    requestBody: '{ "disclosureId": "string", "query": "string" }',
    responseBody: '{ "references": [ { "source": "...", "reference": "...", "similarity": 0.42 } ] }',
    validationRules: ['Require an existing disclosureId', 'Require a query'],
    errorCases: ['404 when disclosureId is unknown'],
    businessLogicSteps: ['Build a query from the disclosure + input.', 'Call the search provider (or a local index).', 'Score similarity.', 'Persist PriorArtReferences.', 'Return ranked references.'],
  },
  {
    match: /ip-readiness\/score/, method: 'POST',
    requestBody: '{ "disclosureId": "string" }',
    responseBody: '{ "score": 68, "rationale": "..." }',
    validationRules: ['Require an existing disclosureId with evidence'],
    errorCases: ['404 when disclosureId is unknown', '422 when there is no evidence to score'],
    businessLogicSteps: ['Load disclosure + evidence + prior art.', 'Apply the readiness rubric.', 'Persist an IpReadinessScore.', 'Return score + rationale.'],
  },
  {
    match: /listings/, method: 'POST',
    requestBody: '{ "title": "string", "price": 0, "description": "string", "category": "string" }',
    responseBody: '{ "listingId": "string", "status": "active" }',
    validationRules: ['Require title + non-negative price', 'Require an authenticated seller'],
    errorCases: ['400 on invalid price', '401 when not authenticated'],
    businessLogicSteps: ['Validate listing fields.', 'Attach the seller from the session.', 'Create a Listing.', 'Return the listingId.'],
  },
  {
    match: /orders/, method: 'POST',
    requestBody: '{ "listingId": "string", "quantity": 1 }',
    responseBody: '{ "orderId": "string", "status": "pending", "total": 0 }',
    validationRules: ['Require an existing listingId', 'quantity >= 1'],
    errorCases: ['404 when listingId is unknown', '409 when out of stock'],
    businessLogicSteps: ['Load the listing.', 'Compute the total.', 'Create an Order (status pending).', 'Return the orderId.'],
  },
  {
    match: /checkout/, method: 'POST',
    requestBody: '{ "orderId": "string" }',
    responseBody: '{ "paymentIntentId": "string", "status": "requires_payment" }',
    validationRules: ['Require an existing pending orderId'],
    errorCases: ['404 when orderId is unknown', '409 when already paid'],
    businessLogicSteps: ['Load the order.', 'Create a PaymentIntent placeholder.', 'Return the intent (no real charge in the MVP).'],
  },
  {
    match: /documents\/upload/, method: 'POST',
    requestBody: 'multipart/form-data — file: a document; userId: string',
    responseBody: '{ "documentId": "string", "status": "stored" }',
    validationRules: ['Reject when no file is attached', 'Require userId'],
    errorCases: ['400 when the file is missing'],
    businessLogicSteps: ['Accept the file.', 'Store raw text/reference.', 'Create a Document.', 'Return documentId.'],
  },
  {
    match: /documents\/analyze|documents\//, method: 'POST',
    requestBody: '{ "documentId": "string" }',
    responseBody: '{ "documentId": "string", "extractions": [ { "field": "...", "value": "...", "confidence": 0.9 } ] }',
    validationRules: ['Require an existing documentId'],
    errorCases: ['404 when documentId is unknown', '422 when extraction fails'],
    businessLogicSteps: ['Load the document text.', 'Run extraction.', 'Persist Extractions.', 'Return them.'],
  },
];

export function apiRecipe(method, path) {
  const p = lc(path);
  const m = String(method || '').toUpperCase();
  const found = API_RECIPES.find((r) => r.match.test(p) && (!r.method || r.method === m));
  return found || null;
}

/* ---------------- Component (frontend/service) recipes ---------------- *
 * Domain-scoped so a name like "Recommendation Engine" gets the right guidance
 * for the project's domain (Resume vs Kubernetes). componentRecipe() searches
 * the project's domain bucket first, then falls back to the kubernetes/generic
 * bucket (which holds cross-cutting services like log parsers).             */
const SERVICE_RECIPES = {
  kubernetes: {
    'root cause analyzer': {
      kind: 'service', file: 'server/services/rootCauseAnalyzer.js',
      functions: ['analyzeFailureSignals(signals)'],
      input: 'parsed signals (array of { type, message, podEvent })',
      output: 'ranked findings (array of { pattern, severity, probableCause, recommendedFix })',
      businessLogicSteps: ['Normalise the incoming signals.', 'Match each signal against ROOT_CAUSE_RULES (rootCauseRules.js).', 'Deduplicate and rank findings by severity.', 'Return the ranked findings.'],
      edgeCases: ['Missing/empty logs → return an empty findings list with a clear message.', 'Unknown error string → emit a generic "uncategorised failure" finding.', 'Multiple root causes → keep all, ordered by severity.'],
      sampleFields: ['pattern', 'severity', 'probableCause', 'recommendedFix'],
      testIdeas: ['Feed a CrashLoopBackOff signal → expect a high-severity finding.', 'Feed empty signals → expect an empty list.'],
    },
    'log parser': {
      kind: 'service', file: 'server/services/logParser.js',
      functions: ['parseLog(rawContent)'],
      input: 'raw log/text content',
      output: 'array of signals { type, message, podEvent }',
      businessLogicSteps: ['Split the log into lines/events.', 'Extract pod events and error strings.', 'Tag known Kubernetes patterns.', 'Return structured signals.'],
      edgeCases: ['Binary/garbled content → skip non-text lines.', 'Very large files → stream/limit lines.'],
      testIdeas: ['Parse a sample log and assert the expected signal count.'],
    },
    'failure pattern detector': {
      kind: 'service', file: 'server/services/failurePatternDetector.js',
      functions: ['detectPatterns(signals)'],
      input: 'parsed signals',
      output: 'matched failure patterns with counts',
      businessLogicSteps: ['Scan signals for each known pattern (CrashLoopBackOff, ImagePullBackOff, OOMKilled, probe failures, …).', 'Count occurrences.', 'Return matched patterns.'],
      edgeCases: ['No matches → return empty list.'],
    },
    'recommendation engine': {
      kind: 'service', file: 'server/services/recommendationEngine.js',
      functions: ['recommend(findings)'], input: 'ranked findings', output: 'actionable recommendations',
      businessLogicSteps: ['For each finding, map to a recommended fix.', 'Order by severity/impact.', 'Return recommendations.'],
      edgeCases: ['No findings → return a "healthy / no action" message.'],
    },
  },
  resume: {
    'resume parser': {
      kind: 'service', file: 'server/services/resumeParser.js', functions: ['parseResume(fileBuffer, mime)'],
      input: 'an uploaded resume file (PDF/DOCX)', output: 'a ResumeAnalysis { parsedText, skills, sections }',
      businessLogicSteps: ['Detect the file type.', 'Extract raw text (pdf/docx).', 'Segment into sections (experience, skills, education).', 'Extract a skills list.', 'Persist a ResumeAnalysis.'],
      edgeCases: ['Unsupported/corrupt file → 422 with a clear message.', 'Image-only PDF → flag that OCR is required.', 'Empty resume → return empty skills, not an error.'],
      sampleFields: ['userId', 'fileName', 'parsedText', 'skills', 'atsScore'], testIdeas: ['Parse a known resume → assert the skills array contains expected tokens.'],
    },
    'ats scoring': {
      kind: 'service', file: 'server/services/atsScoringService.js', functions: ['scoreResume(resume, jobDescription)'],
      input: 'a parsed ResumeAnalysis + a JobDescription', output: 'an atsScore (0–100) + matched/missing keywords',
      businessLogicSteps: ['Tokenise the job description into required keywords.', 'Compare against the resume skills/text.', 'Compute coverage → ATS score.', 'Collect missing + matched keywords.', 'Persist a ScoreReport.'],
      edgeCases: ['Empty job description → 400.', 'No overlap → score 0 with all keywords missing.'],
      sampleFields: ['resumeId', 'jobDescription', 'atsScore', 'missingKeywords'], testIdeas: ['Identical JD and resume → high score; unrelated JD → low score.'],
    },
    'keyword gap': {
      kind: 'service', file: 'server/services/keywordGapAnalyzer.js', functions: ['analyzeGaps(resume, jobDescription)'],
      input: 'resume keywords + job description', output: 'a KeywordGap { missingKeywords, matchedKeywords }',
      businessLogicSteps: ['Extract required keywords from the JD.', 'Diff against resume keywords.', 'Return matched + missing.'],
      edgeCases: ['No JD keywords → return empty gap.'], sampleFields: ['resumeId', 'jobDescriptionId', 'missingKeywords', 'matchedKeywords'],
      testIdeas: ['Resume missing a required skill → it appears in missingKeywords.'],
    },
    'job description matcher': {
      kind: 'service', file: 'server/services/jobDescriptionMatcher.js', functions: ['match(resume, jobDescription)'],
      input: 'resume + job description', output: 'a match score + matched/missing keywords',
      businessLogicSteps: ['Extract required skills from the JD.', 'Score overlap with the resume.', 'Return a normalised match score.'],
      edgeCases: ['Unknown resumeId → 404.'], sampleFields: ['resumeId', 'matchScore', 'matchedKeywords'], testIdeas: ['Strong overlap → score near 1.'],
    },
    'recommendation engine': {
      kind: 'service', file: 'server/services/resumeRecommendationService.js', functions: ['recommend(scoreReport)'],
      input: 'a ScoreReport with keyword gaps', output: 'prioritised resume improvement recommendations',
      businessLogicSteps: ['For each missing keyword, suggest where to add it.', 'Prioritise by frequency/importance in the JD.', 'Return ordered recommendations.'],
      edgeCases: ['No gaps → return a "well matched" message.'], sampleFields: ['resumeId', 'text', 'priority'], testIdeas: ['A gap produces at least one recommendation.'],
    },
  },
  patent: {
    'ip readiness': {
      kind: 'service', file: 'server/services/ipReadinessScoringService.js', functions: ['scoreReadiness(disclosure, evidence, priorArt)'],
      input: 'an InventionDisclosure + EvidenceItems + PriorArtReferences', output: 'an IpReadinessScore { score, rationale }',
      businessLogicSteps: ['Check the disclosure completeness (pain point, novelty angle).', 'Weigh evidence strength.', 'Factor prior-art closeness (closer art lowers readiness).', 'Apply the rubric → score + rationale.', 'Persist an IpReadinessScore.'],
      edgeCases: ['No evidence → 422 (cannot score).', 'Very close prior art → readiness drops sharply.'],
      sampleFields: ['disclosureId', 'score', 'rationale'], testIdeas: ['Strong evidence + distant prior art → high score.'],
    },
    'prior art': {
      kind: 'service', file: 'server/services/priorArtWorkspace.js', functions: ['search(disclosure, query)'],
      input: 'an InventionDisclosure + a query', output: 'ranked PriorArtReferences { source, reference, similarity }',
      businessLogicSteps: ['Build a query from the disclosure + input.', 'Search a provider/local index.', 'Score similarity.', 'Persist + return ranked references.'],
      edgeCases: ['No results → return an empty list, not an error.'], sampleFields: ['disclosureId', 'source', 'reference', 'similarity'],
      testIdeas: ['A near-duplicate reference ranks highest.'],
    },
    'novelty': {
      kind: 'service', file: 'server/services/noveltyComparisonModule.js', functions: ['compare(disclosure, priorArt)'],
      input: 'a disclosure + prior-art references', output: 'NoveltyGaps { aspect, closestPriorArt, gapNotes }',
      businessLogicSteps: ['Break the disclosure into technical aspects.', 'Find the closest prior art per aspect.', 'Record the novelty gap + a technical-effect note.'],
      edgeCases: ['No prior art → every aspect is "novel (unverified)".'], sampleFields: ['disclosureId', 'aspect', 'closestPriorArt', 'gapNotes'],
      testIdeas: ['An aspect with close prior art is flagged as low-novelty.'],
    },
    'claim direction': {
      kind: 'service', file: 'server/services/claimDirectionSummary.js', functions: ['summariseClaims(disclosure, novelty)'],
      input: 'a disclosure + novelty gaps', output: 'a ClaimDraft { independentClaim, dependentClaims }',
      businessLogicSteps: ['Identify the strongest novel aspect.', 'Draft an independent claim direction.', 'Suggest dependent claim angles.', 'Add a technical-effect checklist.'],
      edgeCases: ['Weak novelty → recommend strengthening evidence first.'], sampleFields: ['disclosureId', 'independentClaim', 'dependentClaims'],
      testIdeas: ['A disclosure with a clear novel aspect yields a claim direction.'],
    },
    'disclosure': {
      kind: 'service', file: 'server/services/disclosureExport.js', functions: ['exportDisclosure(disclosureId)'],
      input: 'a disclosureId', output: 'an export package (disclosure + evidence + prior art + claim direction)',
      businessLogicSteps: ['Load the disclosure + related records.', 'Assemble an evidence checklist.', 'Render an export document/payload.'],
      edgeCases: ['Missing evidence → mark items as outstanding in the checklist.'], sampleFields: ['disclosureId', 'type', 'description'],
      testIdeas: ['Export includes the evidence checklist.'],
    },
  },
  marketplace: {
    'listing': {
      kind: 'service', file: 'server/services/listingService.js', functions: ['createListing(seller, data)', 'searchListings(query)'],
      input: 'a seller + listing data (title, price, description)', output: 'a Listing record / search results',
      businessLogicSteps: ['Validate the listing fields + price.', 'Attach the seller.', 'Set lifecycle status (draft → active → sold/closed).', 'Persist + index for search.'],
      edgeCases: ['Negative price → 400.', 'Unauthenticated seller → 401.'], sampleFields: ['sellerId', 'title', 'price', 'status'],
      testIdeas: ['A created listing is searchable; status transitions are valid.'],
    },
    'order': {
      kind: 'service', file: 'server/services/orderService.js', functions: ['placeOrder(buyer, listingId, qty)'],
      input: 'a buyer + listingId + quantity', output: 'an Order with a state',
      businessLogicSteps: ['Load the listing + check availability.', 'Compute the total.', 'Create the Order (pending → paid → shipped → completed/cancelled).', 'Return the order.'],
      edgeCases: ['Out of stock → 409.', 'Unknown listing → 404.'], sampleFields: ['buyerId', 'listingId', 'quantity', 'status', 'total'],
      testIdeas: ['Placing an order moves it to pending; invalid qty rejected.'],
    },
    'payment': {
      kind: 'service', file: 'server/services/paymentPlaceholder.js', functions: ['createPaymentIntent(order)'],
      input: 'an order', output: 'a PaymentIntent placeholder { status: requires_payment }',
      businessLogicSteps: ['Create a placeholder PaymentIntent (no real charge in the MVP).', 'Mark the order as awaiting payment.', 'Return the intent id.'],
      edgeCases: ['Already paid → 409.'], sampleFields: ['orderId', 'amount', 'currency', 'status'],
      testIdeas: ['Checkout creates a requires_payment intent.'],
    },
    'review': {
      kind: 'service', file: 'server/services/reviewService.js', functions: ['addReview(buyer, listingId, rating, comment)'],
      input: 'a buyer + listing + rating + comment', output: 'a Review record',
      businessLogicSteps: ['Validate the rating (1–5).', 'Ensure the buyer purchased the listing.', 'Persist the review.', 'Recompute the listing rating.'],
      edgeCases: ['Rating out of range → 400.', 'Reviewer never purchased → 403.'], sampleFields: ['listingId', 'buyerId', 'rating', 'comment'],
      testIdeas: ['A valid review updates the aggregate rating.'],
    },
    'moderation': {
      kind: 'service', file: 'server/services/moderationQueue.js', functions: ['enqueue(item)', 'moderate(itemId, decision)'],
      input: 'a flagged listing/review', output: 'a ModerationItem with a status',
      businessLogicSteps: ['Add flagged content to the queue.', 'Let an admin approve/reject.', 'Apply the decision to the underlying record.'],
      edgeCases: ['Already moderated → ignore duplicate decisions.'], sampleFields: ['targetType', 'targetId', 'status', 'reason'],
      testIdeas: ['Rejecting a listing hides it from search.'],
    },
  },
  document: {
    'text extraction': {
      kind: 'service', file: 'server/services/textExtractionService.js', functions: ['extractText(documentId)'],
      input: 'a stored document', output: 'ExtractedText { rawText, pages }',
      businessLogicSteps: ['Validate the file type/size.', 'Extract text (pdf/docx/plain).', 'Persist ExtractedText.'],
      edgeCases: ['Scanned image → flag OCR needed.', 'Unsupported type → 415.'], sampleFields: ['documentId', 'rawText'],
      testIdeas: ['A text PDF extracts non-empty text.'],
    },
    'analysis': {
      kind: 'service', file: 'server/services/analysisEngine.js', functions: ['analyze(extractedText)'],
      input: 'extracted text', output: 'AnalysisFindings { field, value, confidence }[]',
      businessLogicSteps: ['Run extraction rules / model over the text.', 'Produce structured findings with confidence.', 'Persist AnalysisFindings.'],
      edgeCases: ['Empty text → return empty findings.', 'Low confidence → still return, flagged.'], sampleFields: ['documentId', 'field', 'value', 'confidence'],
      testIdeas: ['Known input yields the expected field/value.'],
    },
    'summary': {
      kind: 'service', file: 'server/services/summaryService.js', functions: ['summarise(documentId)'],
      input: 'a document + its findings', output: 'a Summary { text, highlights }',
      businessLogicSteps: ['Aggregate findings.', 'Generate a concise summary.', 'Persist a Summary.'],
      edgeCases: ['No findings → "nothing notable" summary.'], sampleFields: ['documentId', 'text'], testIdeas: ['Summary references the top findings.'],
    },
    'report': {
      kind: 'service', file: 'server/services/reportExport.js', functions: ['exportReport(documentId)'],
      input: 'a document + findings + summary', output: 'a Report export payload/file',
      businessLogicSteps: ['Assemble findings + summary.', 'Render a report (md/pdf/json).', 'Return the export.'],
      edgeCases: ['Missing summary → generate one first.'], sampleFields: ['documentId', 'format'], testIdeas: ['Report includes findings + summary.'],
    },
  },
};

export function componentRecipe(name, domain) {
  const n = lc(name);
  const bucketKeys = [];
  if (domain && SERVICE_RECIPES[domain]) bucketKeys.push(domain);
  // Always allow the kubernetes/generic bucket as a fallback for cross-cutting
  // services (log parser, etc.), but only AFTER the domain bucket.
  if (domain !== 'kubernetes') bucketKeys.push('kubernetes');
  for (const bk of bucketKeys) {
    const bucket = SERVICE_RECIPES[bk];
    const key = Object.keys(bucket).find((k) => n.includes(k));
    if (key) return bucket[key];
  }
  return null;
}

/* ---------------- Domain detection ---------------- */
export function detectDomain(project = {}, patternId = '') {
  const id = lc(patternId);
  if (/kubernetes|devops/.test(id)) return 'kubernetes';
  if (/resume|ats/.test(id)) return 'resume';
  if (/patent|innovation/.test(id)) return 'patent';
  if (/marketplace/.test(id)) return 'marketplace';
  if (/document/.test(id)) return 'document';
  return 'generic';
}

export default {
  KUBERNETES_FAILURE_PATTERNS, ROOT_CAUSE_RULES_FILE,
  entityFields, entityRelationship, apiRecipe, componentRecipe, detectDomain,
};
