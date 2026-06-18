import { useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, BadgeCheck, GitCommitHorizontal, UserCheck, Clock, Ban } from 'lucide-react';
import { Badge, Button, Modal, EmptyState } from '../ui/kit.jsx';
import { Verification, confidenceMeta, methodLabel, isCountable, isHumanGrade, summarize } from '../../lib/verification.js';

/* A single skill credential rendered as a recruiter-readable badge. Colour and
   label come from the credential's CONFIDENCE, clamped server-side to the
   method ceiling — a self-claim can never render as "Verified", and only a
   human/assessment-corroborated credential renders HIGH. */
export function CredentialBadge({ credential }) {
  if (!credential) return null;
  const meta = confidenceMeta(credential.confidence);
  const human = isHumanGrade(credential.methodKind) || credential.confidence === 'high';
  return (
    <Badge tone={meta.tone} className="gap-1">
      {human ? <UserCheck size={11} /> : <GitCommitHorizontal size={11} />}
      {credential.claim}
      <span className="opacity-60">· {meta.label}</span>
    </Badge>
  );
}

function resultTone(r) {
  if (r.valid) return 'mint';
  if (r.tampered) return 'rose';
  if (r.revoked) return 'rose';
  return 'amber';
}
function ResultIcon({ r }) {
  if (r.valid) return <ShieldCheck size={14} className="text-[#A7F2CE]" />;
  if (r.tampered || r.revoked) return <ShieldAlert size={14} className="text-rose-300" />;
  return <ShieldQuestion size={14} className="text-[#FFE0A0]" />;
}
function resultLabel(r) {
  if (r.valid) return 'Authentic';
  if (r.revoked) return 'Revoked';
  if (r.expired) return 'Expired';
  if (r.tampered) return 'Tampered';
  return 'Unconfirmed';
}
function reasonText(reason) {
  return ({
    ok: 'Signature valid — authentic and untampered.',
    signature_mismatch: 'Signature does not match — this credential was altered.',
    confidence_exceeds_method: 'Confidence is higher than the method allows — tampered.',
    evidence_mismatch: 'Underlying evidence was changed after issuance.',
    expired: 'This credential has passed its expiry date.',
    revoked: 'This credential was revoked by the issuer (e.g. after a fraud finding).',
    key_mismatch: 'Signed by a different (rotated) key — verify against that key.',
    signing_not_configured: 'Verification key is not configured on this server.',
    unknown_version: 'Unrecognised credential version.',
    unknown_alg: 'Unrecognised signature algorithm.',
    no_credential: 'No credential provided.',
  })[reason] || reason;
}

/* The recruiter trust surface: lists a candidate's skill credentials and lets
   the recruiter RE-VERIFY them in one click. Signatures are Ed25519 — the same
   check can be run offline against the published public key, so the checkmark
   is not taken on our word. */
export function VerificationReport({ open, onClose, credentials = [], subjectName = 'Candidate' }) {
  const [busy, setBusy] = useState(false);
  const [byId, setById] = useState({});
  const [error, setError] = useState('');

  const list = Array.isArray(credentials) ? credentials : [];
  const sum = summarize(list);

  async function verifyAll() {
    if (!list.length) return;
    setBusy(true); setError('');
    try {
      const res = await Verification.verify({ credentials: list });
      const map = {};
      for (const r of (res.results || [])) {
        const id = r.credential?.credentialId || Math.random().toString(36);
        map[id] = r;
      }
      setById(map);
    } catch {
      setError('Could not reach the verification service. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Verification report — ${subjectName}`} width="max-w-2xl">
      {!list.length ? (
        <EmptyState
          icon={ShieldQuestion}
          title="No verified credentials yet"
          hint="This candidate has no skills backed by a live viva, authored code, a verified deployment, or human review."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <Badge tone="mint"><ShieldCheck size={11} /> {sum.countable} verifiable</Badge>
            {sum.human > 0
              ? <Badge tone="mint"><UserCheck size={11} /> {sum.human} human-verified</Badge>
              : <Badge tone="amber">0 human-verified</Badge>}
            <span className="text-slate-500">of {sum.total} total</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Each credential is Ed25519-signed. <span className="text-slate-200">Re-verify all</span> recomputes
            every signature now — anything altered, expired, or revoked is flagged. The same check runs offline
            against the published public key, so you don't have to take our word for it. Only medium-or-higher
            credentials count; <span className="text-slate-200">Verified (HIGH)</span> means a live viva/assessment
            or human review, not just an uploaded repo.
          </p>

          <div className="flex items-center gap-2">
            <Button onClick={verifyAll} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {busy ? 'Verifying…' : 'Re-verify all'}
            </Button>
            {error && <span className="text-xs text-rose-300">{error}</span>}
          </div>

          <ul className="space-y-2">
            {list.map((c, i) => {
              const id = c.credentialId || String(i);
              const meta = confidenceMeta(c.confidence);
              const human = isHumanGrade(c.methodKind) || c.confidence === 'high';
              const r = byId[id];
              return (
                <li key={id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">{c.claim}</span>
                        <Badge tone={meta.tone}>{human ? <UserCheck size={10} /> : <BadgeCheck size={10} />}{meta.label}</Badge>
                        {!isCountable(c.confidence) && <Badge tone="default">does not count</Badge>}
                        {c.expiresAt && <Badge tone="default"><Clock size={10} /> expires {new Date(c.expiresAt).toLocaleDateString()}</Badge>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {methodLabel(c.method)}{c.issuedAt ? ` · ${new Date(c.issuedAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    {r && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <ResultIcon r={r} />
                        <Badge tone={resultTone(r)}>{resultLabel(r)}</Badge>
                      </div>
                    )}
                  </div>
                  {r && !r.valid && <p className="mt-1.5 text-[11px] text-slate-400">{reasonText(r.reason)}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export default { CredentialBadge, VerificationReport };
