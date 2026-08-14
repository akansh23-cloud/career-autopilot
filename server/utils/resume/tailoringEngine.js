/* ============================================================
   LEGACY RESUME TAILOR ADAPTER
   ------------------------------------------------------------
   Historical callers imported tailorResume() from this module. The old
   independent string-rewriting implementation has been retired. This adapter
   delegates to the canonical Resume OS application service so there is only
   one authoritative content engine.

   New code should import from server/services/resumeOs instead.
   ============================================================ */

import { tailorForJob as canonicalTailorForJob } from '../../services/resumeOs/resumeOsApplicationService.js';
import { toPlainText } from './resumeDocument.js';

export const LEGACY_TAILORING_ADAPTER_VERSION = 'legacy-tailor-adapter-v1';

export async function tailorResume({
  resumeText = '',
  jobDescription = '',
  targetRole = '',
  mode = 'balanced',
  context = {},
} = {}) {
  const core = await canonicalTailorForJob({
    resumeText,
    jobDescription,
    targetRole,
    mode,
    context,
    aiPolish: false,
  });

  const text = core?.resumeDocument ? toPlainText(core.resumeDocument) : String(resumeText || '');
  return {
    ok: !!core?.ok,
    mode,
    version: LEGACY_TAILORING_ADAPTER_VERSION,
    canonical: true,
    tailoredResume: {
      text,
      document: core?.resumeDocument || null,
    },
    changeLog: core?.changeLedger || [],
    quality: core?.quality || null,
    truth: core?.truth || null,
    aiCalls: core?.aiPolish?.calls || 0,
  };
}

export default { tailorResume };
