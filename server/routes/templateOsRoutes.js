/* ============================================================
   TEMPLATE OS — API
   ------------------------------------------------------------
   /api/template-os/*
   Everything deterministic; no AI anywhere in this surface.
   Publishing/status changes are admin-only. Imports are
   sanitized (no scripts/eval/urls), validated against the DSL,
   certified against fixtures, and stored as drafts — imported
   or generated templates NEVER auto-publish.
   ============================================================ */
import { z } from 'zod';
import {
  validateTemplateDefinition, sanitizeTemplateDefinition, TEMPLATE_OS_VERSIONS,
  compileTemplate, normalizeResumeDensityToTemplateMode, buildLayoutHTML, estimateGeometry, analyzeResumeShape,
  certifyDefinition, certifyDefinitionDeep, generateTemplateCandidates, PRIMITIVES,
  adaptTreeToShape, balancePageComposition, renderTemplatePdf, buildTemplateThumbnail,
  TEMPLATE_LIFECYCLE_VERSION, canTransitionTemplate, templateLifecycleSummary,
} from '../../web/src/lib/templateOs/index.js';
import { makeTemplateStore } from '../utils/templateOs/store.js';
import { BUILTIN_CERTIFICATION } from '../../web/src/lib/templateOs/builtins.js';
import { readTemplatePackage, PACKAGE_LIMITS } from '../utils/templateOs/packageImport.js';
import { normalizeResumeDocument, toRendererStructured } from '../utils/resume/resumeDocument.js';
import { sanitizeDocumentTrust } from '../utils/resume/trustBoundary.js';
import { renderResumePdf } from '../services/resumeRender/resumeRenderService.js';
import { safeFilename } from '../services/resumeRender/renderUtils.js';
import {
  TEMPLATE_ADMIN_AUTH_VERSION, TEMPLATE_ADMIN_CAPABILITIES, isRuntimeCatalogRequest,
  isProductionLicenseCleared, isProductionPublishedTemplate, publicTemplateProjection, safeTemplateAudit,
} from '../utils/templateOs/adminPolicy.js';

export function registerTemplateOsRoutes(app, { requireAuth, requireRole, currentUser, generationLimiter, db, observe = () => {} }) {
  const dbOn = () => !!process.env.MONGODB_URI;
  const store = makeTemplateStore(db, dbOn);
  const requireTemplateAdmin = requireRole('admin');
  const requireAdminUnlessRuntimeCatalog = (req, res, next) => isRuntimeCatalogRequest(req) ? next() : requireTemplateAdmin(req, res, next);
  const safeAdminFailure = (res, error, status = 500) => res.status(status).json({ ok: false, error });
  const validate = (schema) => (req, res, next) => {
    const r = schema.safeParse(req.body || {});
    if (!r.success) return res.status(400).json({ ok: false, error: 'invalid_request', issues: r.error.issues.slice(0, 5) });
    req.body = r.data; return next();
  };

  app.get('/api/template-os/versions', requireAuth, (_req, res) => res.json({ ok: true, versions: { ...TEMPLATE_OS_VERSIONS, templateAdminAuthVersion: TEMPLATE_ADMIN_AUTH_VERSION } }));

  app.get('/api/template-os/admin/access', requireAuth, requireTemplateAdmin, (req, res) => {
    observe('template.admin_access', safeTemplateAudit({ action: 'access' }));
    res.json({ ok: true, admin: true, version: TEMPLATE_ADMIN_AUTH_VERSION, capabilities: TEMPLATE_ADMIN_CAPABILITIES });
  });

  app.get('/api/template-os/templates', requireAuth, requireAdminUnlessRuntimeCatalog, async (req, res) => {
    try {
      const all = await store.list({ includeDrafts: true });
      const isAdmin = req.isAdmin === true || !isRuntimeCatalogRequest(req);
      const publishedOnly = isRuntimeCatalogRequest(req);
      const catalog = isRuntimeCatalogRequest(req);
      /* Runtime catalog is ALWAYS published-only, even for admins. The normal
         builder listing still lets admins inspect drafts. */
      const visible = all.filter((t) => {
        const productionPublished = isProductionPublishedTemplate(t);
        return publishedOnly ? productionPublished : (isAdmin || productionPublished);
      });
      res.json({
        ok: true,
        catalogVersion: catalog ? 'runtime-template-catalog-v1' : null,
        templates: visible.map((t) => {
          const certification = t.certification || BUILTIN_CERTIFICATION[t.templateId] || t.definition?.certification || null;
          const base = {
            templateId: t.templateId, version: t.version, status: t.status, source: t.source,
            name: t.definition?.name, category: t.definition?.category, layout: t.definition?.layout?.type,
            atsLevel: certification?.atsLevel || t.definition?.atsLevel || null,
            license: t.definition?.license || null,
          };
          return catalog ? { ...base, definition: t.definition, certification } : { ...base, certification, baseVersion: t.baseVersion || null, changeNote: t.changeNote || '', lifecycle: t.lifecycle || null, lifecycleSummary: templateLifecycleSummary(t) };
        }),
        db: dbOn(),
      });
    } catch (err) { res.status(500).json({ ok: false, error: 'list_failed', message: err.message }); }
  });

  app.get('/api/template-os/templates/:templateId/history', requireAuth, requireTemplateAdmin, async (req, res) => {
    try {
      const rows = await store.history(req.params.templateId);
      const versions = rows.map((row) => ({
        templateId: row.templateId, version: row.version, status: row.status, source: row.source,
        name: row.definition?.name || row.templateId, baseVersion: row.baseVersion || null,
        changeNote: row.changeNote || '', createdBy: row.createdBy || '', updatedAt: row.updatedAt || null,
        certification: row.certification ? {
          certified: !!row.certification.certified, evidence: row.certification.evidence || null,
          atsLevel: row.certification.atsLevel || null, minIntegrity: row.certification.minIntegrity ?? null,
          minOrderScore: row.certification.minOrderScore ?? null,
        } : null,
        license: row.definition?.license || null,
        lifecycle: row.lifecycle || null,
        lifecycleSummary: templateLifecycleSummary(row),
      }));
      res.json({ ok: true, templateId: req.params.templateId, lifecycleVersion: TEMPLATE_LIFECYCLE_VERSION, versions });
    } catch { return safeAdminFailure(res, 'history_failed'); }
  });

  app.get('/api/template-os/templates/:templateId', requireAuth, async (req, res) => {
    try {
      const row = await store.get(req.params.templateId, { version: req.query.version ? Number(req.query.version) : null });
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      if (isProductionPublishedTemplate(row)) return res.json({ ok: true, template: publicTemplateProjection(row) });
      return requireTemplateAdmin(req, res, () => res.json({ ok: true, template: row }));
    } catch { return safeAdminFailure(res, 'get_failed'); }
  });

  const docSchema = z.object({ doc: z.object({}).passthrough() }).passthrough();
  app.post('/api/template-os/shape', requireAuth, validate(docSchema), (req, res) => {
    try {
      const doc = normalizeResumeDocument(req.body.doc);
      res.json({ ok: true, shape: analyzeResumeShape(doc, { targetRole: req.body.targetRole || doc.targetRole, atsPriority: req.body.atsPriority || 'high', preferredPageCount: req.body.preferredPageCount || 1 }) });
    } catch (err) { res.status(500).json({ ok: false, error: 'shape_failed', message: err.message }); }
  });

  const defSchema = z.object({ definition: z.object({}).passthrough() }).passthrough();
  app.post('/api/template-os/validate', requireAuth, requireTemplateAdmin, validate(defSchema), (req, res) => {
    const sane = sanitizeTemplateDefinition(req.body.definition, { primitives: PRIMITIVES });
    if (!sane.ok) return res.status(400).json({ ok: false, error: 'unsafe_definition', rejected: sane.rejected });
    const v = validateTemplateDefinition(sane.def, { primitives: PRIMITIVES });
    res.json({ ok: v.ok, validation: v });
  });

  /* BUILDER SAVE: every content change creates a NEW immutable DRAFT version.
     baseVersion records where the edit came from (especially published forks).
     External imports use /import and remain LICENSE_PENDING. */
  app.post('/api/template-os/save', requireAuth, requireTemplateAdmin, generationLimiter, validate(defSchema), async (req, res) => {
    try {
      const sane = sanitizeTemplateDefinition(req.body.definition, { primitives: PRIMITIVES });
      if (!sane.ok) return res.status(400).json({ ok: false, error: 'unsafe_definition', rejected: sane.rejected });
      const def = sane.def;
      const baseVersion = req.body.baseVersion ? Number(req.body.baseVersion) : null;
      let baseRow = null;
      if (baseVersion) {
        baseRow = await store.get(def.id, { version: baseVersion });
        if (!baseRow) return res.status(409).json({ ok: false, error: 'base_version_unavailable', baseVersion });
      }
      const licenseState = String(def.license?.licenseStatus || 'LICENSE_PENDING');
      def.license = { ...def.license, productionEnabled: isProductionLicenseCleared({ license: { ...def.license, licenseStatus: licenseState } }) };
      def.status = 'DRAFT';
      const v = validateTemplateDefinition(def, { primitives: PRIMITIVES });
      if (!v.ok) return res.status(400).json({ ok: false, error: 'invalid_definition', validation: v });
      const cert = certifyDefinition(def);
      const storedDefinition = { ...def, atsLevel: cert.atsLevel };
      const actor = currentUser(req)?.email || '';
      const changeNote = String(req.body.changeNote || (baseVersion ? `Edited from v${baseVersion}` : 'Builder draft')).slice(0, 240);
      const saved = await store.save({
        definition: storedDefinition, status: 'DRAFT', source: 'builder', certification: cert,
        createdBy: actor, baseVersion, changeNote,
      });
      const row = await store.get(def.id, { version: saved.version });
      observe('template.saved', { ...safeTemplateAudit({ action: 'save', templateId: def.id, version: saved.version, source: 'builder' }), shallowCertified: cert.certified, baseVersion });
      res.json({
        ok: true, saved, definition: { ...storedDefinition, version: saved.version, status: 'DRAFT' },
        forkedFrom: baseVersion ? { templateId: def.id, version: baseVersion, status: baseRow?.status || null } : null,
        requiresDeepCertification: true,
        certification: { certified: cert.certified, evidence: cert.evidence || 'html-estimate' },
        lifecycle: templateLifecycleSummary(row || { status: 'DRAFT', definition: storedDefinition, certification: cert }),
      });
    } catch { return safeAdminFailure(res, 'save_failed'); }
  });

  /* IMPORT: sanitize → validate → certify → store as DRAFT (never published) */
  app.post('/api/template-os/import', requireAuth, requireTemplateAdmin, generationLimiter, validate(defSchema), async (req, res) => {
    try {
      const sane = sanitizeTemplateDefinition(req.body.definition, { primitives: PRIMITIVES });
      if (!sane.ok) return res.status(400).json({ ok: false, error: 'unsafe_definition', rejected: sane.rejected });
      const def = sane.def;
      /* imports can never claim production clearance for themselves */
      def.license = { ...def.license, licenseStatus: 'LICENSE_PENDING', productionEnabled: false };
      def.status = 'DRAFT';
      const v = validateTemplateDefinition(def, { primitives: PRIMITIVES });
      if (!v.ok) return res.status(400).json({ ok: false, error: 'invalid_definition', validation: v });
      const cert = certifyDefinition(def);
      const saved = await store.save({ definition: { ...def, atsLevel: cert.atsLevel }, status: 'DRAFT', source: 'import', certification: cert, createdBy: currentUser(req)?.email || '' });
      observe('template.imported', { ...safeTemplateAudit({ action: 'import', templateId: def.id, source: 'import' }), certified: cert.certified });
      res.json({ ok: true, saved, certification: { certified: cert.certified, atsLevel: cert.atsLevel, minIntegrity: cert.minIntegrity, minOrderScore: cert.minOrderScore, label: cert.label } });
    } catch { return safeAdminFailure(res, 'import_failed'); }
  });

  /* DETERMINISTIC GENERATION: goal → ranked candidates stored as GENERATED drafts */
  const goalSchema = z.object({
    targetRoles: z.array(z.string().max(60)).max(6).default([]),
    visualStyle: z.string().max(80).optional().default(''),
    atsPriority: z.enum(['high', 'balanced', 'design']).optional().default('high'),
    layoutPreference: z.enum(['sidebar', 'single-column', 'two-column']).nullish(),
    careerStage: z.enum(['student', 'early', 'mid', 'senior', 'executive']).optional().default('mid'),
    density: z.enum(['compact', 'balanced', 'spacious']).optional().default('balanced'),
    limit: z.number().int().min(1).max(12).optional().default(6),
    persist: z.boolean().optional().default(false),
  }).passthrough();
  app.post('/api/template-os/generate', requireAuth, requireTemplateAdmin, generationLimiter, validate(goalSchema), async (req, res) => {
    try {
      const out = generateTemplateCandidates(req.body, { limit: req.body.limit });
      let stored = [];
      if (req.body.persist) {
        for (const c of out.candidates.slice(0, 3)) {
          const saved = await store.save({ definition: c.def, status: 'GENERATED', source: 'generator', certification: c.cert, createdBy: currentUser(req)?.email || '' });
          stored.push(saved);
        }
      }
      observe('template.generated', { ...safeTemplateAudit({ action: 'generate', source: 'generator' }), targetRoleCount: req.body.targetRoles.length, kept: out.kept });
      res.json({ ok: true, versions: TEMPLATE_OS_VERSIONS, family: out.family, generated: out.generated, kept: out.kept, diversity: out.diversity, candidates: out.candidates.map((c) => ({ score: c.score, diversityScore: c.diversityScore, archetype: c.archetype, rationale: c.rationale, signature: c.signature, definition: c.def, certification: { certified: c.cert.certified, atsLevel: c.cert.atsLevel, minIntegrity: c.cert.minIntegrity, minOrderScore: c.cert.minOrderScore } })), stored });
    } catch { return safeAdminFailure(res, 'generate_failed'); }
  });

  /* CERTIFY on demand. Deep production certification owns the
     DRAFT → VALIDATING → CERTIFIED transition for an exact stored version. */
  app.post('/api/template-os/certify', requireAuth, requireTemplateAdmin, generationLimiter, validate(defSchema), async (req, res) => {
    try {
      let definition = req.body.definition;
      let bound = null;
      let row = null;
      const deep = req.body.deep !== false;
      if (req.body.templateId && req.body.version) {
        row = await store.get(String(req.body.templateId), { version: Number(req.body.version) });
        if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
        if (deep && ['CERTIFIED', 'APPROVED', 'PUBLISHED', 'DISABLED'].includes(String(row.status))) {
          return res.status(409).json({ ok: false, error: 'immutable_version_requires_fork', status: row.status, message: 'This stored version has already left draft validation. Fork it to a new draft before changing or recertifying content.' });
        }
        definition = row.definition;
        bound = { templateId: row.templateId, version: row.version };
      }
      const sane = sanitizeTemplateDefinition(definition, { primitives: PRIMITIVES });
      if (!sane.ok) return res.status(400).json({ ok: false, error: 'unsafe_definition' });
      const actor = currentUser(req)?.email || '';
      if (bound && deep) {
        const startRow = row.status === 'VALIDATING' ? row : row;
        if (row.status !== 'VALIDATING') {
          const transition = canTransitionTemplate(startRow, 'VALIDATING');
          if (!transition.ok) return res.status(409).json({ ok: false, error: transition.error, from: transition.from, to: transition.to, blockers: transition.blockers });
          await store.setStatus({ ...bound, status: 'VALIDATING', actor, reason: 'deep_certification_started' });
          row = { ...row, status: 'VALIDATING' };
        }
      }
      const certification = deep
        ? await certifyDefinitionDeep(sane.def, { sizeIds: req.body.sizeIds || ['a4'] })
        : certifyDefinition(sane.def);
      if (bound && deep) {
        await store.setCertification({ ...bound, certification });
        const withCert = { ...row, certification };
        if (certification.certified && certification.evidence === 'real-pdf-text-layer') {
          const transition = canTransitionTemplate(withCert, 'CERTIFIED');
          if (!transition.ok) return res.status(409).json({ ok: false, error: transition.error, blockers: transition.blockers, certification });
          await store.setStatus({ ...bound, status: 'CERTIFIED', actor, reason: 'deep_certification_passed' });
          row = { ...withCert, status: 'CERTIFIED' };
        } else {
          await store.setStatus({ ...bound, status: 'DRAFT', actor, reason: 'deep_certification_failed' });
          row = { ...withCert, status: 'DRAFT' };
        }
      }
      observe('template.certified', { ...safeTemplateAudit({ action: 'certify', ...(bound || {}) }), deep, certified: certification.certified });
      res.json({ ok: true, certification, boundTo: bound, status: row?.status || null, lifecycle: row ? templateLifecycleSummary(row) : null });
    } catch { return safeAdminFailure(res, 'certify_failed'); }
  });

  /* THUMBNAIL: deterministic SVG wireframe, no rasterization */
  app.post('/api/template-os/thumbnail', requireAuth, requireTemplateAdmin, validate(defSchema), (req, res) => {
    try {
      const sane = sanitizeTemplateDefinition(req.body.definition, { primitives: PRIMITIVES });
      if (!sane.ok) return res.status(400).json({ ok: false, error: 'unsafe_definition' });
      res.json({ ok: true, svg: buildTemplateThumbnail(sane.def) });
    } catch { return safeAdminFailure(res, 'thumbnail_failed'); }
  });

  /* PACKAGE IMPORT (.zip): data-only archive → sanitized draft */
  const pkgSchema = z.object({ packageBase64: z.string().min(4).max(3_500_000) }).passthrough();
  app.post('/api/template-os/import-package', requireAuth, requireTemplateAdmin, generationLimiter, validate(pkgSchema), async (req, res) => {
    try {
      let bytes;
      try { bytes = Buffer.from(req.body.packageBase64, 'base64'); }
      catch { return res.status(400).json({ ok: false, error: 'invalid_base64' }); }
      const pkg = await readTemplatePackage(bytes);
      if (!pkg.ok) return res.status(400).json({ ok: false, error: pkg.error, limits: PACKAGE_LIMITS, validation: pkg.validation || null, rejected: pkg.rejected || [], rejectedRules: pkg.rejectedRules || [] });
      const cert = await certifyDefinitionDeep(pkg.definition, { sizeIds: ['a4'] });
      const saved = await store.save({ definition: { ...pkg.definition, atsLevel: cert.atsLevel, certification: { certified: cert.certified, atsLevel: cert.atsLevel, atsLevelMultiPage: cert.atsLevelMultiPage, minIntegrity: cert.minIntegrity, minOrderScore: cert.minOrderScore, evidence: cert.evidence } }, status: 'DRAFT', source: 'package', certification: cert, createdBy: currentUser(req)?.email || '' });
      observe('template.package_imported', { ...safeTemplateAudit({ action: 'import-package', templateId: pkg.definition.id, source: 'package' }), certified: cert.certified });
      res.json({
        ok: true, saved,
        certification: { certified: cert.certified, atsLevel: cert.atsLevel, atsLevelMultiPage: cert.atsLevelMultiPage, minIntegrity: cert.minIntegrity, minOrderScore: cert.minOrderScore, label: cert.label, evidence: cert.evidence },
        package: { assets: pkg.assets, hasLicenseFile: pkg.hasLicenseFile, css: pkg.css, rejected: pkg.rejected, metadata: pkg.metadata },
        note: 'Imported as a DRAFT with LICENSE_PENDING. An admin must clear the license and publish it.',
      });
    } catch { return safeAdminFailure(res, 'package_import_failed'); }
  });

  /* CANONICAL PDF EXPORT: same ResumeRenderService used by Resume OS.
     Auto selects the ATS vector writer for compatible content and Chromium
     when Unicode preservation requires it. */
  const pdfSchema = z.object({ templateId: z.string().min(1).max(80), templateVersion: z.number().int().min(1).optional().nullable().default(null), doc: z.object({}).passthrough(), sizeId: z.enum(['a4', 'letter']).optional().default('a4'), provider: z.enum(['auto','vector','chromium','weasyprint']).optional().default('auto') }).passthrough();
  app.post('/api/template-os/export/pdf', requireAuth, validate(pdfSchema), async (req, res) => {
    try {
      const requestedVersion = req.body.templateVersion || req.body.doc?.templateVersion || null;
      const row = await store.get(req.body.templateId, { version: requestedVersion });
      if (!row) return res.status(404).json({ ok: false, error: requestedVersion ? 'template_version_unavailable' : 'not_found', templateVersion: requestedVersion });
      if (!isProductionPublishedTemplate(row)) return res.status(404).json({ ok: false, error: 'not_found' });
      const doc = normalizeResumeDocument(sanitizeDocumentTrust(req.body.doc, {}).doc);
      const out = await renderResumePdf({ doc, definition: row.definition, sizeId: req.body.sizeId, provider: req.body.provider });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(doc.title || 'resume')}.pdf"`);
      res.setHeader('X-Template-Pages', String(out.pageCount));
      res.setHeader('X-Resume-Render-Provider', out.selectedProvider);
      res.setHeader('X-Resume-Render-Engine', out.engine || out.selectedProvider);
      res.setHeader('X-Resume-Render-Signature', out.renderSignature);
      res.setHeader('X-Resume-Text-Layer', out.validation?.selectableText ? '1' : '0');
      res.send(out.bytes);
    } catch (err) {
      const code = err?.code || 'pdf_export_failed';
      const status = code === 'chromium_renderer_unavailable' || code === 'vector_renderer_cannot_preserve_unicode' ? 503 : 500;
      res.status(status).json({ ok: false, error: code, message: err.message, recommendedProvider: err?.recommendedProvider || null });
    }
  });

  /* RENDER a document through a stored definition (server-side HTML) */
  const renderSchema = z.object({ templateId: z.string().min(1).max(80), templateVersion: z.number().int().min(1).optional().nullable().default(null), doc: z.object({}).passthrough(), sizeId: z.enum(['a4', 'letter']).optional().default('a4') }).passthrough();
  app.post('/api/template-os/render', requireAuth, validate(renderSchema), async (req, res) => {
    try {
      const requestedVersion = req.body.templateVersion || req.body.doc?.templateVersion || null;
      const row = await store.get(req.body.templateId, { version: requestedVersion });
      if (!row) return res.status(404).json({ ok: false, error: requestedVersion ? 'template_version_unavailable' : 'not_found', templateVersion: requestedVersion });
      if (!isProductionPublishedTemplate(row)) return res.status(404).json({ ok: false, error: 'not_found' });
      const doc = sanitizeDocumentTrust(req.body.doc, {}).doc; // fail-closed without server ctx; render is layout-only
      const normalizedDoc = normalizeResumeDocument(doc);
      const structured = toRendererStructured(normalizedDoc);
      const compiled = compileTemplate(row.definition, { density: normalizeResumeDensityToTemplateMode(normalizedDoc.density) });
      if (!compiled.ok) return res.status(400).json({ ok: false, error: 'invalid_definition', validation: compiled.validation });
      const shaped = adaptTreeToShape(compiled, analyzeResumeShape(normalizedDoc));
      const composed = balancePageComposition(shaped, structured, { sizeId: req.body.sizeId });
      const html = buildLayoutHTML(composed, structured, { sizeId: req.body.sizeId });
      const geometry = estimateGeometry(composed, structured, { sizeId: req.body.sizeId });
      res.json({ ok: true, html, geometry, adaptation: composed.adaptation || { moves: [] }, composition: composed.composition || null, templateVersion: row.version });
    } catch (err) { res.status(500).json({ ok: false, error: 'render_failed', message: err.message }); }
  });

  /* STATUS transitions — exact-version lifecycle state machine.
     Deep certification is owned by /certify; approval is explicit; publishing
     cannot skip APPROVED. Published content can only be disabled, never edited
     in place. */
  const statusSchema = z.object({
    templateId: z.string().min(1).max(80), version: z.number().int().min(1),
    status: z.enum(['DRAFT', 'GENERATED', 'VALIDATING', 'CERTIFIED', 'APPROVED', 'DISABLED', 'LICENSE_PENDING', 'PUBLISHED']),
    reason: z.string().max(240).optional().default(''),
  }).passthrough();
  app.post('/api/template-os/status', requireAuth, requireTemplateAdmin, validate(statusSchema), async (req, res) => {
    try {
      const row = await store.get(req.body.templateId, { version: req.body.version });
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const transition = canTransitionTemplate(row, req.body.status);
      if (!transition.ok) {
        if (transition.error === 'deep_certification_required') {
          return res.status(422).json({ ok: false, error: 'not_deep_certified', lifecycleError: transition.error, from: transition.from, to: transition.to, blockers: transition.blockers, lifecycle: templateLifecycleSummary(row) });
        }
        const code = transition.error === 'license_clearance_required' ? 422 : 409;
        return res.status(code).json({ ok: false, error: transition.error, from: transition.from, to: transition.to, blockers: transition.blockers, lifecycle: templateLifecycleSummary(row) });
      }
      if (transition.noop) return res.json({ ok: true, persisted: true, status: row.status, lifecycle: templateLifecycleSummary(row), noop: true });
      const actor = currentUser(req)?.email || '';
      const out = await store.setStatus({ ...req.body, actor, reason: req.body.reason || `admin_${String(req.body.status).toLowerCase()}` });
      const updated = { ...row, status: req.body.status };
      observe('template.status', safeTemplateAudit({ action: 'status', ...req.body }));
      res.json({ ok: out.ok, persisted: out.persisted, status: req.body.status, lifecycle: templateLifecycleSummary(updated), event: out.event });
    } catch { return safeAdminFailure(res, 'status_failed'); }
  });

}

export default { registerTemplateOsRoutes };
