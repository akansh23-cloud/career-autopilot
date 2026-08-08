import { useMemo, useState } from 'react';
import { Building2, CheckCircle2, Clock3, ShieldCheck, UserSearch, XCircle } from 'lucide-react';
import { Account } from '../lib/api.js';
import { getProfile } from '../lib/userProfile.js';
import { refreshAccessContext, useAccountAccessContext } from '../lib/accessContext.js';
import { PageIntro, SectionCard } from './common.jsx';
import { Badge, Button, Input } from '../components/ui/kit.jsx';

function wantedType(profile) {
  return profile?.role === 'college_admin' ? 'college_admin' : 'recruiter';
}

function statusTone(status) {
  if (status === 'approved') return 'mint';
  if (status === 'rejected') return 'rose';
  if (status === 'pending') return 'amber';
  return 'default';
}

function statusIcon(status) {
  if (status === 'approved') return CheckCircle2;
  if (status === 'rejected') return XCircle;
  return Clock3;
}

export default function VerificationStatus({ go }) {
  const profile = getProfile();
  const accessState = useAccountAccessContext(true);
  const ctx = accessState.context || {};
  const requestedType = wantedType(profile);
  const isCollege = requestedType === 'college_admin';
  const [organizationId, setOrganizationId] = useState(profile.company || profile.companyEmail || ctx.organizationId || '');
  const [collegeId, setCollegeId] = useState(profile.college || profile.officialEmail || ctx.collegeId || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const status = ctx.verificationStatus || 'none';
  const verified = ctx.roleVerified && ctx.accountType === requestedType;
  const Icon = statusIcon(status);

  const title = isCollege ? 'Placement-cell verification' : 'Recruiter verification';
  const sub = isCollege
    ? 'Placement-cell tools unlock only after an admin verifies your official college access.'
    : 'Recruiter tools unlock only after an admin verifies your hiring organization.';

  const payload = useMemo(() => ({
    requestedType,
    organizationId: isCollege ? '' : organizationId,
    collegeId: isCollege ? collegeId : '',
  }), [requestedType, isCollege, organizationId, collegeId]);

  const submit = async () => {
    setBusy(true);
    setMessage('');
    try {
      await Account.requestVerification(payload);
      await refreshAccessContext();
      setMessage('Verification request submitted. Admin approval is required before this workspace unlocks.');
    } catch (e) {
      setMessage(e?.message || 'Could not submit verification request.');
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <>
        <PageIntro title={title} sub="Your verified access is active." />
        <SectionCard title="Access approved" action={<Badge tone="mint"><ShieldCheck size={11} /> Approved</Badge>}>
          <div className="flex flex-col gap-3 text-sm text-slate-300">
            <p>Your verified workspace is available.</p>
            <div><Button onClick={() => go?.(isCollege ? 'college' : 'recruiter')}>Open workspace</Button></div>
          </div>
        </SectionCard>
      </>
    );
  }

  return (
    <>
      <PageIntro title={title} sub={sub} />
      <SectionCard
        title="Verification status"
        action={<Badge tone={statusTone(status)}><Icon size={11} /> {status === 'none' ? 'Not requested' : status}</Badge>}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-slate-300">
            <p className="font-medium text-white">Access is locked until approval.</p>
            <p className="mt-1 text-slate-400">Your onboarding role is treated as intent only. Recruiter and placement-cell data require server-approved verification.</p>
          </div>

          {status === 'pending' ? (
            <div className="rounded-2xl border border-amber-glow/25 bg-amber-glow/10 p-4 text-sm text-amber-100">
              Your request is pending admin review. You can keep using the student/professional-safe workspace while approval is pending.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-[1fr,auto] md:items-end">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  {isCollege ? 'College ID / official college identifier' : 'Organization ID / company identifier'}
                </label>
                {isCollege ? (
                  <Input value={collegeId} onChange={(e) => setCollegeId(e.target.value)} placeholder="e.g. college slug / official domain" />
                ) : (
                  <Input value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} placeholder="e.g. company slug / official domain" />
                )}
              </div>
              <Button onClick={submit} disabled={busy || (isCollege ? !collegeId.trim() : !organizationId.trim())}>
                {isCollege ? <Building2 size={15} /> : <UserSearch size={15} />} {busy ? 'Submitting…' : 'Request verification'}
              </Button>
            </div>
          )}

          {status === 'rejected' && (
            <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
              Your previous request was rejected. Update the identifier above and submit again if needed.
            </div>
          )}
          {message && <p className="text-sm text-slate-300">{message}</p>}
        </div>
      </SectionCard>
    </>
  );
}
