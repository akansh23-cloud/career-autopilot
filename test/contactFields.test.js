// Contact details regression tests:
//  - job-board/ATS domains are rejected as company domains,
//  - employer domains from provider fields are preserved,
//  - emails are found regardless of which provider field carries them,
//  - the no-email case yields a clear reason instead of a silently empty card.
// Pure imports only — runs under `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  JOB_BOARD_DOMAINS, cleanDomainName, isJobBoardDomain, resolveCompanyDomain,
  extractContactEmail, extractContactLinkedin, normalizeContact,
} from '../web/src/lib/contactFields.js';

test('every required job-board domain is rejected as a company domain', () => {
  const required = [
    'linkedin.com', 'indeed.com', 'naukri.com', 'foundit.in', 'monster.com',
    'google.com', 'jobs.google.com', 'serpapi.com', 'remoteok.com', 'remotive.com',
    'arbeitnow.com', 'jobicy.com', 'greenhouse.io', 'lever.co', 'workable.com',
    'smartrecruiters.com',
  ];
  for (const d of required) {
    assert.ok(isJobBoardDomain(d), `${d} must be rejected`);
    assert.ok(JOB_BOARD_DOMAINS.includes(d.replace(/^jobs\./, '')) || JOB_BOARD_DOMAINS.includes(d), `${d} listed`);
  }
  // subdomains of boards are also rejected
  assert.ok(isJobBoardDomain('in.linkedin.com'));
  assert.ok(isJobBoardDomain('boards.greenhouse.io'));
  // real employer domains are NOT
  assert.equal(isJobBoardDomain('acme.com'), false);
  assert.equal(isJobBoardDomain('careers.acme.com'), false);
  assert.equal(isJobBoardDomain('tcs.co.in'), false);
});

test('cleanDomainName normalizes URLs and rejects garbage', () => {
  assert.equal(cleanDomainName('https://www.Acme.com/careers?x=1'), 'acme.com');
  assert.equal(cleanDomainName('acme.com'), 'acme.com');
  assert.equal(cleanDomainName('not a domain'), '');
  assert.equal(cleanDomainName(''), '');
});

test('resolveCompanyDomain prefers employer fields and never returns a board domain', () => {
  // JSearch-style job: employer website present, apply link on LinkedIn
  const j1 = { companyWebsite: 'https://www.acme.com', url: 'https://www.linkedin.com/jobs/view/123', applyUrl: 'https://www.linkedin.com/jobs/view/123' };
  assert.equal(resolveCompanyDomain(j1), 'acme.com');
  // No employer field, apply link on a board -> NO domain (never the board)
  const j2 = { url: 'https://in.indeed.com/viewjob?jk=abc' };
  assert.equal(resolveCompanyDomain(j2), '');
  const j3 = { url: 'https://boards.greenhouse.io/acme/jobs/1' };
  assert.equal(resolveCompanyDomain(j3), '');
  // Direct careers-site apply link IS a legitimate employer domain
  const j4 = { url: 'https://careers.acme.com/jobs/1' };
  assert.equal(resolveCompanyDomain(j4), 'acme.com');
  // companyDomain field set to a board (bad upstream data) is also rejected
  const j5 = { companyDomain: 'linkedin.com', companyWebsite: 'https://acme.io' };
  assert.equal(resolveCompanyDomain(j5), 'acme.io');
  assert.equal(resolveCompanyDomain({}), '');
});

test('extractContactEmail finds an email in every known provider shape', () => {
  const shapes = [
    { email: 'a@acme.com' },
    { workEmail: 'b@acme.com' },
    { professionalEmail: 'c@acme.com' },
    { businessEmail: 'd@acme.com' },
    { emails: [{ value: 'e@acme.com' }] },
    { emails: [{ email: 'f@acme.com' }] },
    { emails: ['g@acme.com'] },
    { contact: { email: 'h@acme.com' } },
    { work_email: 'i@acme.com' },
  ];
  for (const s of shapes) {
    const e = extractContactEmail(s);
    assert.ok(/@acme\.com$/.test(e), `missed email in ${JSON.stringify(s)}`);
  }
  assert.equal(extractContactEmail({ email: 'not-an-email' }), '');
  assert.equal(extractContactEmail({}), '');
});

test('extractContactLinkedin normalizes linkedin field variants', () => {
  assert.ok(extractContactLinkedin({ linkedin: 'https://linkedin.com/in/x' }).includes('linkedin.com/in/x'));
  assert.ok(extractContactLinkedin({ linkedin_url: 'https://www.linkedin.com/in/y' }).includes('/in/y'));
  assert.ok(extractContactLinkedin({ profileUrl: 'https://linkedin.com/in/z' }).includes('/in/z'));
  assert.equal(extractContactLinkedin({}), '');
});

test('normalizeContact: email present in ANY field -> shown with a status', () => {
  const c = normalizeContact({ name: 'Riya', workEmail: 'riya@acme.com', verified: true });
  assert.equal(c.email, 'riya@acme.com');
  assert.equal(c.emailStatus, 'verified');
  const p = normalizeContact({ name: 'Dev', emails: [{ value: 'dev@acme.com' }], probable: true });
  assert.equal(p.email, 'dev@acme.com');
  assert.equal(p.emailStatus, 'probable');
  const s = normalizeContact({ name: 'Sam', email: 'sam@acme.com' });
  assert.equal(s.emailStatus, 'source');
});

test('normalizeContact: no email -> explicit reason, never a silent blank', () => {
  const noDomain = normalizeContact({ name: 'A' }, { domainUsed: '', providersConfigured: true });
  assert.equal(noDomain.email, '');
  assert.equal(noDomain.emailStatus, 'none');
  assert.ok(/missing company domain/i.test(noDomain.noEmailReason));

  const noProvider = normalizeContact({ name: 'B' }, { domainUsed: 'acme.com', providersConfigured: false });
  assert.ok(/no contact provider configured/i.test(noProvider.noEmailReason));

  const providerEmpty = normalizeContact({ name: 'C' }, { domainUsed: 'acme.com', providersConfigured: true });
  assert.ok(/no email/i.test(providerEmpty.noEmailReason));

  const locked = normalizeContact({ name: 'D', emailLocked: true }, { domainUsed: 'acme.com', providersConfigured: true });
  assert.ok(/locked/i.test(locked.noEmailReason));
});
