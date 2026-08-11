/* ============================================================
   TEMPLATE OS — CERTIFICATION + QUALITY SCORECARD
   ------------------------------------------------------------
   Every definition earns its labels: fixtures are compiled and
   rendered to HTML, text is extracted, field recovery and
   semantic reading order are MEASURED, geometry is estimated,
   and constraint floors are enforced. The ATS level is the
   measurement's verdict, never an assertion — and the honest
   phrase is "Career Autopilot parse checks passed", not
   "guaranteed ATS".
   ============================================================ */
import { compileTemplate, buildLayoutHTML, estimateGeometry, CANONICAL_ORDER } from './compiler.js';
import { TEMPLATE_FIXTURES, scoreReadingOrder } from './shape.js';
import { extractTextFromHtml } from '../../../../server/utils/resume/atsParseSimulator.js';
import { validateRenderedPdf } from './pdfValidation.js';
import { auditOwnedPdfAcrossParsers, MULTI_PARSER_ATS_VERSION, ATS_PARSER_PROFILES } from './multiParserAts.js';

export const TEMPLATE_CERTIFICATION_VERSION = 'template-os-cert-v2-multi-parser';

const CRITICAL_FIELDS = ['name', 'email'];

function fieldRecovery(structured, text) {
  const hay = text.toLowerCase();
  const has = (v) => !!v && hay.includes(String(v).toLowerCase());
  const checks = {
    name: has(structured.personalInfo?.name),
    email: has(structured.personalInfo?.email),
    phone: has(structured.personalInfo?.phone),
    experienceRoles: (structured.experience || []).every((e) => has(e.role)),
    companies: (structured.experience || []).every((e) => has(e.company)),
    dates: (structured.experience || []).every((e) => has(e.dates)),
    skills: (structured.skills || []).every((g) => (g.items || []).slice(0, 3).every((i) => has(i))),
    projects: (structured.projects || []).every((p) => has(p.name)),
    education: (structured.education || []).every((e) => has(e.school)),
    certifications: (structured.certifications || []).slice(0, 3).every((c) => has(c)),
  };
  const keys = Object.keys(checks);
  const passed = keys.filter((k) => checks[k]);
  const criticalOk = CRITICAL_FIELDS.every((k) => checks[k]);
  return { checks, integrity: Math.round((passed.length / keys.length) * 100), criticalOk };
}

export function certifyDefinition(def, { sizeIds = ['a4', 'letter'] } = {}) {
  const compiled = compileTemplate(def);
  if (!compiled.ok) {
    return { version: TEMPLATE_CERTIFICATION_VERSION, templateId: def?.id, ok: false, reason: 'invalid_definition', errors: compiled.validation.errors };
  }
  const order = compiled.tree.sections.map((s) => s.key);
  const runs = [];
  for (const fixture of TEMPLATE_FIXTURES) {
    for (const sizeId of sizeIds) {
      const html = buildLayoutHTML(compiled, fixture.structured, { sizeId });
      const text = extractTextFromHtml(html);
      const recovery = fieldRecovery(fixture.structured, text);
      const orderScore = scoreReadingOrder(fixture.structured, text, order.length ? order : CANONICAL_ORDER);
      const geometry = estimateGeometry(compiled, fixture.structured, { sizeId });
      runs.push({ fixture: fixture.id, sizeId, integrity: recovery.integrity, criticalOk: recovery.criticalOk, orderScore: orderScore.score, pageCount: geometry.pageCount, overflowLines: geometry.overflowLines });
    }
  }
  const minIntegrity = Math.min(...runs.map((r) => r.integrity));
  const minOrder = Math.min(...runs.map((r) => r.orderScore));
  const allCritical = runs.every((r) => r.criticalOk);
  const maxPages = Math.max(...runs.map((r) => r.pageCount));

  /* MEASURED ATS level */
  let atsLevel = 'DESIGN_FORWARD';
  if (allCritical && minIntegrity >= 90 && minOrder >= 92) atsLevel = compiled.tree.layoutType === 'single-column' ? 'VERY_HIGH' : 'HIGH';
  else if (allCritical && minIntegrity >= 80 && minOrder >= 80) atsLevel = 'BALANCED';

  /* quality scorecard — only measurable dimensions */
  const bucket = (fid) => runs.filter((r) => r.fixture === fid);
  const avgIntegrity = (rs) => (rs.length ? Math.round(rs.reduce((s, r) => s + r.integrity, 0) / rs.length) : 0);
  const overflowFree = runs.filter((r) => r.overflowLines === 0 || r.pageCount <= 2).length;
  const scorecard = {
    atsParse: minIntegrity,
    sectionOrderIntegrity: minOrder,
    fitReliability: Math.round((overflowFree / runs.length) * 100),
    overflowResistance: Math.round((runs.filter((r) => r.overflowLines === 0).length / runs.length) * 100),
    longContent: avgIntegrity(bucket('two-page')),
    shortContent: avgIntegrity(bucket('short-fresher')),
    technicalResume: avgIntegrity(bucket('senior-technical')),
    skillsHeavy: avgIntegrity(bucket('skills-heavy')),
    certificationHeavy: avgIntegrity(bucket('certification-heavy')),
    longStrings: avgIntegrity(bucket('long-names')),
    international: avgIntegrity(bucket('international')),
    multiPageStability: maxPages <= 2 ? 100 : 0,
    typographySafety: 100, /* enforced by validation floors; a failing def never reaches here */
  };

  const certified = allCritical && minIntegrity >= 90 && minOrder >= 85;
  return {
    version: TEMPLATE_CERTIFICATION_VERSION,
    templateId: def.id, templateVersion: def.version,
    ok: true, certified, atsLevel,
    minIntegrity, minOrderScore: minOrder, maxPages,
    scorecard, runs,
    label: certified ? 'Career Autopilot parse checks passed' : 'Parse checks not passed',
  };
}



/* ---------------------------------------------------------------
   MULTI-PARSER CERTIFICATION — dependency-free, actual owned PDF.
   This complements pdfjs deep certification with multiple extraction order
   models. It never labels the profiles as specific commercial ATS vendors.
   --------------------------------------------------------------- */
export const MULTI_PARSER_CERTIFICATION_VERSION = 'template-os-multi-parser-cert-v1';

export function certifyDefinitionMultiParser(def, { sizeIds = ['a4'], fixtureIds = null } = {}) {
  const compiled = compileTemplate(def);
  if (!compiled.ok) return { version: MULTI_PARSER_CERTIFICATION_VERSION, templateId: def?.id, ok: false, certified: false, reason: 'invalid_definition' };
  const fixtures = fixtureIds ? TEMPLATE_FIXTURES.filter((f) => fixtureIds.includes(f.id)) : TEMPLATE_FIXTURES;
  const runs = [];
  for (const fixture of fixtures) for (const sizeId of sizeIds) {
    const audit = auditOwnedPdfAcrossParsers(compiled, fixture.structured, { sizeId });
    runs.push({ fixture: fixture.id, sizeId, ...audit });
  }

  const summarize = (subset) => {
    if (!subset.length) return null;
    const parserSummary = ATS_PARSER_PROFILES.map((profile) => {
      const rows = subset.map((r) => r.parsers.find((p) => p.id === profile.id)).filter(Boolean);
      return {
        id: profile.id, label: profile.label,
        minIntegrity: rows.length ? Math.min(...rows.map((x) => x.integrity)) : 0,
        minOrderScore: rows.length ? Math.min(...rows.map((x) => x.orderScore)) : 0,
        allCritical: rows.every((x) => x.criticalOk),
      };
    });
    const semantic = parserSummary.find((x) => x.id === 'semantic-stream');
    return {
      runs: subset.length,
      parserSummary,
      semantic,
      minIntegrity: Math.min(...parserSummary.map((x) => x.minIntegrity)),
      minOrderScore: Math.min(...parserSummary.map((x) => x.minOrderScore)),
      allCritical: parserSummary.every((x) => x.allCritical),
    };
  };

  const overall = summarize(runs);
  const onePage = summarize(runs.filter((r) => r.pageCount === 1));
  const multiPage = summarize(runs.filter((r) => r.pageCount > 1));
  const parserSummary = overall?.parserSummary || [];
  const semantic = overall?.semantic;
  const minIntegrity = overall?.minIntegrity ?? 0;
  const minOrderScore = overall?.minOrderScore ?? 0;
  const allCritical = overall?.allCritical ?? false;

  /* Certification is regime-aware. A multi-column PDF may have a different
     visual reading order once it spans pages; that risk is reported rather
     than hidden. Production certification requires strong semantic-stream
     behavior on one-page resumes and at least balanced semantic extraction on
     multi-page resumes. Alternate spatial models may score lower, but they may
     never lose a critical field. */
  const onePageOk = !onePage || (
    onePage.allCritical
    && (onePage.semantic?.minIntegrity || 0) >= 90
    && (onePage.semantic?.minOrderScore || 0) >= (compiled.tree.layoutType === 'single-column' ? 90 : 80)
    && onePage.minIntegrity >= 80
  );
  const multiPageOk = !multiPage || (
    multiPage.allCritical
    && (multiPage.semantic?.minIntegrity || 0) >= 90
    && (multiPage.semantic?.minOrderScore || 0) >= 65
    && multiPage.minIntegrity >= 80
  );
  const certified = allCritical && onePageOk && multiPageOk;
  const rank = { DESIGN_FORWARD: 0, BALANCED: 1, HIGH: 2, VERY_HIGH: 3 };
  const worstRobustness = runs.reduce((worst, r) => rank[r.robustness] < rank[worst] ? r.robustness : worst, 'VERY_HIGH');
  return {
    version: MULTI_PARSER_CERTIFICATION_VERSION,
    parserEngineVersion: MULTI_PARSER_ATS_VERSION,
    templateId: def.id, templateVersion: def.version,
    ok: true, certified, minIntegrity, minOrderScore, allCritical, worstRobustness,
    parserSummary, onePage, multiPage, runs,
    label: certified ? 'Career Autopilot multi-parser PDF checks passed' : 'Multi-parser PDF checks not passed',
    note: 'Profiles model extraction strategies and do not claim behavior of named ATS vendors. One-page and multi-page reading-order regimes are reported separately.',
  };
}

/* ------------------------------------------------------------------ */
/* DEEP CERTIFICATION — measured on a REAL PDF text layer              */
/* Slower (generates + parses PDFs), so it never runs during typing:   */
/* it runs in tests, on demand from the admin builder, and before      */
/* publishing. When PDF evidence exists it OVERRIDES the HTML estimate */
/* for the ATS level, because the PDF is what a recruiter receives.    */
/* ------------------------------------------------------------------ */
export const PDF_CERTIFICATION_VERSION = 'template-os-pdf-cert-v1';

export async function certifyDefinitionDeep(def, { sizeIds = ['a4', 'letter'], fixtureIds = null } = {}) {
  const html = certifyDefinition(def, { sizeIds });
  if (!html.ok) return { ...html, pdf: null };
  const compiled = compileTemplate(def);
  const fixtures = fixtureIds ? TEMPLATE_FIXTURES.filter((f) => fixtureIds.includes(f.id)) : TEMPLATE_FIXTURES;
  const multiParser = certifyDefinitionMultiParser(def, { sizeIds, fixtureIds });

  const runs = [];
  for (const fixture of fixtures) {
    for (const sizeId of sizeIds) {
      // eslint-disable-next-line no-await-in-loop
      const r = await validateRenderedPdf(compiled, fixture.structured, { sizeId });
      runs.push({ fixture: fixture.id, ...r });
    }
  }
  const roundTripOk = runs.every((r) => r.roundTripOk);
  const maxPages = Math.max(...runs.map((r) => r.pageCount));

  /* Page regimes are measured separately and reported separately.
     A rail that reads perfectly on one page necessarily interleaves once
     content spills onto a second page (page 1's rail precedes page 2's
     narrative in ANY document's text layer). Averaging the two would hide
     that; reporting both tells the user exactly what they're choosing. */
  const regime = (list) => {
    if (!list.length) return null;
    const integrity = Math.min(...list.map((r) => r.integrity));
    const order = Math.min(...list.map((r) => r.orderScore));
    const critical = list.every((r) => r.criticalOk);
    let level = 'DESIGN_FORWARD';
    if (critical && integrity >= 90 && order >= 92) level = compiled.tree.layoutType === 'single-column' ? 'VERY_HIGH' : 'HIGH';
    else if (critical && integrity >= 80 && order >= 80) level = 'BALANCED';
    return { integrity, order, critical, level, runs: list.length };
  };
  const onePage = regime(runs.filter((r) => r.pageCount === 1));
  const multiPage = regime(runs.filter((r) => r.pageCount > 1));

  const atsLevel = onePage?.level || multiPage?.level || 'DESIGN_FORWARD';
  const RANK = { DESIGN_FORWARD: 0, BALANCED: 1, HIGH: 2, VERY_HIGH: 3 };
  const certified = !!onePage && onePage.critical && onePage.integrity >= 90 && onePage.order >= 85
    && (!multiPage || (multiPage.critical && RANK[multiPage.level] >= RANK.BALANCED))
    && roundTripOk && multiParser.certified;

  return {
    ...html,
    version: PDF_CERTIFICATION_VERSION,
    certified,
    atsLevel,
    atsLevelMultiPage: multiPage?.level || null,
    evidence: 'real-pdf-text-layer',
    htmlOnly: { certified: html.certified, atsLevel: html.atsLevel, minIntegrity: html.minIntegrity, minOrderScore: html.minOrderScore },
    minIntegrity: onePage?.integrity ?? multiPage?.integrity ?? 0,
    minOrderScore: onePage?.order ?? multiPage?.order ?? 0,
    maxPages,
    scorecard: {
      ...html.scorecard,
      pdfParse: onePage?.integrity ?? 0,
      pdfSectionOrder: onePage?.order ?? 0,
      pdfSectionOrderMultiPage: multiPage?.order ?? null,
      pdfPagination: roundTripOk ? 100 : 0,
      multiParserFieldRecovery: multiParser.minIntegrity,
      multiParserOrderFloor: multiParser.minOrderScore,
    },
    multiParser,
    pdf: { runs, roundTripOk, maxPages, onePage, multiPage },
    label: certified ? 'Career Autopilot PDF parse checks passed' : 'PDF parse checks not passed',
  };
}

export default { TEMPLATE_CERTIFICATION_VERSION, PDF_CERTIFICATION_VERSION, MULTI_PARSER_CERTIFICATION_VERSION, certifyDefinition, certifyDefinitionMultiParser, certifyDefinitionDeep };
