#!/usr/bin/env node
/* ============================================================
   SAFE PACKAGER  (npm run package)
   ------------------------------------------------------------
   Produces career-autopilot-YYYYMMDD.zip for sharing/deploying,
   with a hard exclusion list so secrets and junk can NEVER ride
   along again (.env once shipped inside a review zip — this
   script exists so that never repeats). Fails loudly if zip is
   missing or if a forbidden file somehow lands in the archive.
   ============================================================ */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const out = path.join(ROOT, `career-autopilot-${stamp}.zip`);

const EXCLUDES = [
  '.env', '.env.*', '*.env',           // secrets — the whole reason this script exists
  '.git/*', '.git',                    // history (squash separately if you want to share it)
  'node_modules/*', 'web/node_modules/*',
  'dist/*',                            // rebuilt on deploy: npm run build
  'career-autopilot-*.zip',            // no zip-inside-zip
  '.data/*',                           // local runtime state (demo verifications etc.)
  '*.log', '.DS_Store',
];

try { execSync('zip -v', { stdio: 'ignore' }); }
catch { console.error('zip is not installed. On Ubuntu: sudo apt-get install zip'); process.exit(1); }

if (existsSync(out)) execSync(`rm -f ${JSON.stringify(out)}`);

const exclArgs = EXCLUDES.map((e) => `-x ${JSON.stringify(e)}`).join(' ');
console.log(`Packaging → ${path.basename(out)}`);
execSync(`cd ${JSON.stringify(ROOT)} && zip -qr ${JSON.stringify(out)} . ${exclArgs}`, { stdio: 'inherit' });

// Post-flight: refuse to bless an archive containing any env file.
const listing = execSync(`unzip -l ${JSON.stringify(out)}`).toString();
if (/(^|\s|\/)\.env(\s|$|\.)/m.test(listing)) {
  console.error('ABORT: an .env file made it into the archive. Deleting it.');
  execSync(`rm -f ${JSON.stringify(out)}`);
  process.exit(1);
}
const files = (listing.match(/\n\s+\d+\s/g) || []).length;
console.log(`OK: ${files} files, secrets excluded. Rebuild the frontend after unzip: npm install && npm run build`);
