import { useEffect, useState } from 'react';
import { Account } from './api.js';

export const ACCESS_CONTEXT_EVENT = 'career-access-context-updated';

const EMPTY_CONTEXT = Object.freeze({
  ok: false,
  loaded: false,
  isAdmin: false,
  privileged: false,
  accountType: '',
  role: '',
  roleVerified: false,
  verificationStatus: 'none',
  organizationId: '',
  collegeId: '',
});

let state = {
  loaded: false,
  loading: false,
  error: null,
  context: null,
};

function emit() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCESS_CONTEXT_EVENT, { detail: getAccessContextState() }));
  }
}

export function normalizeAccessContext(raw = {}) {
  const accountType = String(raw.accountType || '').trim();
  const roleVerified = raw.roleVerified === true;
  const isAdmin = raw.isAdmin === true || raw.role === 'admin';
  const verifiedPrivileged = roleVerified && ['recruiter', 'college_admin'].includes(accountType);
  return {
    ...EMPTY_CONTEXT,
    ok: raw.ok !== false,
    loaded: true,
    isAdmin,
    privileged: isAdmin || verifiedPrivileged,
    accountType,
    role: isAdmin ? 'admin' : verifiedPrivileged ? accountType : String(raw.role || accountType || ''),
    roleVerified,
    verificationStatus: String(raw.verificationStatus || (roleVerified ? 'approved' : 'none')),
    organizationId: String(raw.organizationId || ''),
    collegeId: String(raw.collegeId || ''),
  };
}

export function getAccessContext() {
  return state.context;
}

export function getAccessContextState() {
  return { ...state, context: state.context || EMPTY_CONTEXT };
}

export function setAccessContext(raw) {
  state = { loaded: true, loading: false, error: null, context: normalizeAccessContext(raw || {}) };
  emit();
  return state.context;
}

export function clearAccessContext() {
  state = { loaded: false, loading: false, error: null, context: null };
  emit();
}

export async function refreshAccessContext() {
  if (state.loading) return state.context || EMPTY_CONTEXT;
  state = { ...state, loading: true, error: null };
  emit();
  try {
    const data = await Account.accessContext();
    state = { loaded: true, loading: false, error: null, context: normalizeAccessContext(data || {}) };
    emit();
    return state.context;
  } catch (error) {
    // Fail closed: a failed context fetch never grants recruiter / college UI.
    state = { loaded: true, loading: false, error, context: normalizeAccessContext({ ok: false }) };
    emit();
    return state.context;
  }
}

export function useAccountAccessContext(enabled = true) {
  const [snapshot, setSnapshot] = useState(() => getAccessContextState());
  useEffect(() => {
    const update = () => setSnapshot(getAccessContextState());
    if (typeof window !== 'undefined') window.addEventListener(ACCESS_CONTEXT_EVENT, update);
    if (enabled && !state.loaded && !state.loading) refreshAccessContext();
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener(ACCESS_CONTEXT_EVENT, update);
    };
  }, [enabled]);
  return snapshot;
}
