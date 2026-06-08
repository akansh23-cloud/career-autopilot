import crypto from 'crypto';
import { normalizeRole } from './normalizeResumeText.js';

/* sha256(normalizedResumeText + "|" + targetRole + "|" + scoringVersion) */
export function hashResume(normalizedText, targetRole, scoringVersion) {
  return crypto
    .createHash('sha256')
    .update(`${normalizedText}|${normalizeRole(targetRole)}|${scoringVersion}`)
    .digest('hex');
}

export default { hashResume };
