/* ============================================================
   TEMPLATE OS — public entry point + engine versions
   ============================================================ */
export { TEMPLATE_DSL_VERSION, TEMPLATE_SECURITY_VERSION, TEMPLATE_SECURITY_LIMITS, TEMPLATE_LICENSE_STATES, TEMPLATE_STATUSES, ATS_LEVELS, LAYOUT_TYPES, SECTION_KEYS, DENSITY_MODES, READABILITY_FLOORS, validateTemplateDefinition, sanitizeTemplateDefinition, extendTemplate } from './dsl.js';
export { PRIMITIVES, PRIMITIVES_VERSION } from './primitives.js';
export { LAYOUT_COMPILER_VERSION, DENSITY_ENGINE_VERSION, PAGE_COMPOSITION_VERSION, normalizeTemplateDensity, normalizeResumeDensityToTemplateMode, compileTemplate, adaptTreeToShape, balancePageComposition, buildLayoutHTML, layoutCSS, estimateGeometry, CANONICAL_ORDER } from './compiler.js';
export { RESUME_SHAPE_VERSION, READING_ORDER_VERSION, analyzeResumeShape, scoreReadingOrder, expectedOrderAnchors, TEMPLATE_FIXTURES } from './shape.js';
export { TEMPLATE_CERTIFICATION_VERSION, PDF_CERTIFICATION_VERSION, MULTI_PARSER_CERTIFICATION_VERSION, certifyDefinition, certifyDefinitionMultiParser, certifyDefinitionDeep } from './certification.js';
export { PDF_WRITER_VERSION, OWNED_PAGINATION_VERSION, renderTemplatePdf, pdfEncodeText, wrapText, textWidth } from './pdfWriter.js';
export { RENDER_DESIGN_VERSION, resolveRenderDesign, CSS_PX_TO_PT, MM_TO_PT, PAGE_DIMENSIONS } from './renderDesign.js';
export { PDF_VALIDATION_VERSION, extractPdfText, pdfFieldRecovery, validateRenderedPdf } from './pdfValidation.js';
export { MULTI_PARSER_ATS_VERSION, ATS_PARSER_PROFILES, parseOwnedPdfTextItems, auditOwnedPdfAcrossParsers } from './multiParserAts.js';
export { TEMPLATE_SYNTHESIS_VERSION, TEMPLATE_GENERATOR_DIVERSITY_VERSION, generateTemplateCandidates, templateStructuralSignature, templateStructuralDistance } from './synthesis.js';
export { TEMPLATE_ADAPTER_VERSION, fromLegacyTemplate, toRegistryCard, classifyLegacyTemplate } from './adapter.js';
export { THUMBNAIL_VERSION, buildTemplateThumbnail, thumbnailDataUri } from './thumbnail.js';
export { TEMPLATE_PREVIEW_CACHE_VERSION, TEMPLATE_PREVIEW_WIDTH, TEMPLATE_PREVIEW_HEIGHT, cachedTemplatePreviewUrl, fallbackPreviewOnError } from './previewAssets.js';
export { TEMPLATE_PREVIEW_FIXTURE_VERSION, previewFixtureIdForTemplate, getTemplatePreviewStructured, toLegacyEditorPreviewData } from './previewFixtures.js';
export { MEASURE_VERSION, measureLayoutGeometry, canMeasure } from './measure.js';
export { TEMPLATE_OS_BUILTINS, TECHNICAL_SIDEBAR_BASE, BUILTIN_CERTIFICATION } from './builtins.js';
export { TEMPLATE_LIFECYCLE_VERSION, TEMPLATE_LIFECYCLE_STATUSES, TEMPLATE_PRIMARY_LIFECYCLE, isDeepCertified, isLifecycleLicenseCleared, lifecycleBlockers, canTransitionTemplate, templateLifecycleSummary, templateDefinitionFingerprint, lifecycleEvent } from './lifecycle.js';

import { TEMPLATE_DSL_VERSION, TEMPLATE_SECURITY_VERSION } from './dsl.js';
import { PRIMITIVES_VERSION } from './primitives.js';
import { LAYOUT_COMPILER_VERSION, DENSITY_ENGINE_VERSION } from './compiler.js';
import { RESUME_SHAPE_VERSION, READING_ORDER_VERSION } from './shape.js';
import { TEMPLATE_CERTIFICATION_VERSION, PDF_CERTIFICATION_VERSION, MULTI_PARSER_CERTIFICATION_VERSION } from './certification.js';
import { PDF_WRITER_VERSION, OWNED_PAGINATION_VERSION } from './pdfWriter.js';
import { RENDER_DESIGN_VERSION } from './renderDesign.js';
import { PDF_VALIDATION_VERSION } from './pdfValidation.js';
import { MULTI_PARSER_ATS_VERSION } from './multiParserAts.js';
import { TEMPLATE_SYNTHESIS_VERSION, TEMPLATE_GENERATOR_DIVERSITY_VERSION } from './synthesis.js';
import { TEMPLATE_ADAPTER_VERSION } from './adapter.js';
import { THUMBNAIL_VERSION } from './thumbnail.js';
import { TEMPLATE_PREVIEW_CACHE_VERSION } from './previewAssets.js';
import { TEMPLATE_PREVIEW_FIXTURE_VERSION } from './previewFixtures.js';
import { MEASURE_VERSION } from './measure.js';
import { TEMPLATE_LIFECYCLE_VERSION } from './lifecycle.js';

export const TEMPLATE_OS_VERSIONS = Object.freeze({
  templateDslVersion: TEMPLATE_DSL_VERSION,
  templateSecurityVersion: TEMPLATE_SECURITY_VERSION,
  primitivesVersion: PRIMITIVES_VERSION,
  layoutCompilerVersion: LAYOUT_COMPILER_VERSION,
  densityEngineVersion: DENSITY_ENGINE_VERSION,
  resumeShapeVersion: RESUME_SHAPE_VERSION,
  readingOrderVersion: READING_ORDER_VERSION,
  templateCertificationVersion: TEMPLATE_CERTIFICATION_VERSION,
  pdfCertificationVersion: PDF_CERTIFICATION_VERSION,
  multiParserCertificationVersion: MULTI_PARSER_CERTIFICATION_VERSION,
  pdfWriterVersion: PDF_WRITER_VERSION,
  ownedPaginationVersion: OWNED_PAGINATION_VERSION,
  renderDesignVersion: RENDER_DESIGN_VERSION,
  pdfValidationVersion: PDF_VALIDATION_VERSION,
  multiParserAtsVersion: MULTI_PARSER_ATS_VERSION,
  templateSynthesisVersion: TEMPLATE_SYNTHESIS_VERSION,
  templateGeneratorDiversityVersion: TEMPLATE_GENERATOR_DIVERSITY_VERSION,
  templateAdapterVersion: TEMPLATE_ADAPTER_VERSION,
  thumbnailVersion: THUMBNAIL_VERSION,
  previewCacheVersion: TEMPLATE_PREVIEW_CACHE_VERSION,
  previewFixtureVersion: TEMPLATE_PREVIEW_FIXTURE_VERSION,
  layoutMeasureVersion: MEASURE_VERSION,
  templateLifecycleVersion: TEMPLATE_LIFECYCLE_VERSION,
});
