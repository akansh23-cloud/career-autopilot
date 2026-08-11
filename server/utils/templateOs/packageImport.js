/* ============================================================
   TEMPLATE OS — TEMPLATE PACKAGE INGESTION (.zip)
   ------------------------------------------------------------
   template-package/
     template.json     required — the DSL definition
     styles.css        optional — CSS CUSTOM PROPERTIES ONLY
     metadata.json     optional — author/source notes
     LICENSE           optional — license text
     preview.webp      optional — author-supplied preview image
     assets/…          optional — images only

   Security posture: a package is DATA. No JavaScript, no HTML, no
   SVG (script-carrying), no path traversal, no symlink-ish paths,
   no remote references. styles.css cannot introduce selectors or
   at-rules — only a fixed allowlist of --tpl-* variables, each
   value re-validated. Security-sensitive entries fail the package closed; harmless
   unknown format files are reported separately as ignored.
   ============================================================ */
import JSZip from 'jszip';
import { sanitizeTemplateDefinition, validateTemplateDefinition } from '../../../web/src/lib/templateOs/dsl.js';
import { PRIMITIVES } from '../../../web/src/lib/templateOs/primitives.js';
import { sanitizePackageCss, sanitizePackageMetadata, sanitizePackageText, unsafePackagePath, imageSignatureMatches, PACKAGE_SECURITY_VERSION } from './packageSecurity.js';
export { sanitizePackageCss } from './packageSecurity.js';

export const PACKAGE_IMPORT_VERSION = 'template-package-v2-strict';

export const PACKAGE_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,      // 2 MB compressed
  maxEntries: 40,
  maxUncompressedBytes: 8 * 1024 * 1024,
  maxAssetBytes: 512 * 1024,
  maxCssBytes: 8 * 1024,
  maxJsonBytes: 256 * 1024,
});

const ALLOWED_IMAGE = /\.(png|jpe?g|webp)$/i;
const BANNED_EXT = /\.(js|mjs|cjs|ts|jsx|tsx|html?|htm|svg|xml|sh|bat|exe|wasm|php|py|rb)$/i;

const CSS_TO_DEF = { '--tpl-accent': 'accent', '--tpl-rule': 'rule', '--tpl-side': 'sidebarBg', '--tpl-text': 'text', '--tpl-muted': 'muted' };

/**
 * Read + validate a template package.
 * @param {Buffer|Uint8Array|ArrayBuffer} bytes zip archive
 */
export async function readTemplatePackage(bytes) {
  const size = bytes?.byteLength ?? bytes?.length ?? 0;
  if (!size) return { ok: false, error: 'empty_package' };
  if (size > PACKAGE_LIMITS.maxBytes) return { ok: false, error: 'package_too_large', limit: PACKAGE_LIMITS.maxBytes, size };

  let zip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { return { ok: false, error: 'not_a_zip' }; }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > PACKAGE_LIMITS.maxEntries) return { ok: false, error: 'too_many_entries', count: entries.length };
  const declaredUncompressed = entries.reduce((sum, e) => sum + (Number(e?._data?.uncompressedSize) || 0), 0);
  if (declaredUncompressed > PACKAGE_LIMITS.maxUncompressedBytes) return { ok: false, error: 'package_expands_too_large' };

  /* tolerate a single wrapping folder (template-package/…) */
  const names = entries.map((e) => e.name);
  const root = names.every((n) => n.includes('/')) && new Set(names.map((n) => n.split('/')[0])).size === 1
    ? `${names[0].split('/')[0]}/` : '';
  const rel = (n) => (root && n.startsWith(root) ? n.slice(root.length) : n);

  const rejected = [];
  const securityRejected = [];
  const assets = [];
  let templateJson = null; let stylesCss = null; let metadata = null; let license = null;
  let uncompressed = 0;

  for (const entry of entries) {
    const name = rel(entry.name);
    if (!name || name.startsWith('.') || name.includes('__MACOSX')) { rejected.push({ name, reason: 'ignored path' }); continue; }
    if (unsafePackagePath(name)) { securityRejected.push({ name, reason: 'unsafe path' }); continue; }
    if (BANNED_EXT.test(name)) { securityRejected.push({ name, reason: 'executable or markup content is not allowed in packages' }); continue; }

    // eslint-disable-next-line no-await-in-loop
    const buf = await entry.async('uint8array');
    uncompressed += buf.length;
    if (uncompressed > PACKAGE_LIMITS.maxUncompressedBytes) return { ok: false, error: 'package_expands_too_large' };

    const text = () => new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if ((name === 'template.json' || name === 'metadata.json') && buf.length > PACKAGE_LIMITS.maxJsonBytes) return { ok: false, error: 'package_json_too_large', name };
    if (name === 'styles.css' && buf.length > PACKAGE_LIMITS.maxCssBytes) return { ok: false, error: 'package_css_too_large' };
    if (name === 'template.json') templateJson = text();
    else if (name === 'styles.css') stylesCss = text();
    else if (name === 'metadata.json') metadata = text();
    else if (/^LICENSE(\.txt|\.md)?$/i.test(name)) license = text();
    else if (name === 'preview.webp' || (name.startsWith('assets/') && ALLOWED_IMAGE.test(name))) {
      if (buf.length > PACKAGE_LIMITS.maxAssetBytes) { securityRejected.push({ name, reason: 'asset too large' }); continue; }
      if (!imageSignatureMatches(name, buf)) { securityRejected.push({ name, reason: 'image signature does not match allowed file type' }); continue; }
      assets.push({ name, bytes: buf.length });
    } else rejected.push({ name, reason: 'not part of the package format' });
  }

  if (securityRejected.length) return { ok: false, error: 'unsafe_package_entries', rejected: [...rejected, ...securityRejected] };
  if (!templateJson) return { ok: false, error: 'missing_template_json', rejected };

  let parsed;
  try { parsed = JSON.parse(templateJson); }
  catch { return { ok: false, error: 'template_json_unparseable', rejected }; }

  const sane = sanitizeTemplateDefinition(parsed, { primitives: PRIMITIVES });
  if (!sane.ok) return { ok: false, error: 'unsafe_definition', rejectedRules: sane.rejected, rejected };
  const def = sane.def;

  /* styles.css may only tint the palette */
  let cssReport = { accepted: {}, rejected: [] };
  if (stylesCss) {
    cssReport = sanitizePackageCss(stylesCss);
    if (!cssReport.ok) return { ok: false, error: 'unsafe_styles_css', rejectedRules: cssReport.rejected, rejected };
    const colors = { ...(def.colors || {}) };
    for (const [varName, value] of Object.entries(cssReport.accepted)) colors[CSS_TO_DEF[varName]] = value;
    def.colors = colors;
  }

  let meta = null;
  if (metadata) {
    let parsedMeta;
    try { parsedMeta = JSON.parse(metadata); }
    catch { return { ok: false, error: 'unsafe_metadata_json', rejectedRules: [{ field: 'metadata', reason: 'unparseable JSON' }], rejected }; }
    const metaReport = sanitizePackageMetadata(parsedMeta);
    if (!metaReport.ok) return { ok: false, error: 'unsafe_metadata_json', rejectedRules: metaReport.rejected, rejected };
    meta = metaReport.value;
  }

  const licenseReport = license == null ? { ok: true, value: '' } : sanitizePackageText(String(license), { maxChars: 4000 });
  if (!licenseReport.ok) return { ok: false, error: 'unsafe_license_text', rejectedRules: [{ field: 'LICENSE', reason: licenseReport.reason }], rejected };

  /* a package can never grant itself production rights */
  def.license = {
    licenseStatus: 'LICENSE_PENDING',
    source: meta?.source || 'imported package',
    licenseName: meta?.licenseName || '',
    licenseNotice: licenseReport.value,
    productionEnabled: false,
  };
  def.status = 'DRAFT';

  const validation = validateTemplateDefinition(def, { primitives: PRIMITIVES });
  return {
    ok: validation.ok,
    version: PACKAGE_IMPORT_VERSION,
    securityVersion: PACKAGE_SECURITY_VERSION,
    error: validation.ok ? null : 'invalid_definition',
    definition: def,
    validation,
    metadata: meta,
    hasLicenseFile: !!license,
    assets,
    css: cssReport,
    rejected,
  };
}

export default { PACKAGE_IMPORT_VERSION, PACKAGE_LIMITS, readTemplatePackage };
