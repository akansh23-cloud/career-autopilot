/* ============================================================
   CANONICAL LEGAL CONTENT  (rendered by LegalView at #/legal/*)
   ------------------------------------------------------------
   Written in plain language on purpose: students, TPOs and payment
   reviewers all read these pages. Contact details are NOT hardcoded
   here — LegalView merges them in from GET /api/legal so the
   deployment owner is always the named entity. Dates match the
   /api/legal policies block; bump both together.
   ============================================================ */

export const LEGAL_EFFECTIVE = '12 July 2026';

export const TERMS_SECTIONS = [
  {
    h: '1. What Career Autopilot is',
    p: [
      'Career Autopilot is a placement-readiness platform: students build and verify proof-of-work (projects, resumes, skills), and college placement cells that students consent to share with get visibility into cohort readiness. It provides estimates and tooling — it is not a placement agency, a recruiter, an examination body, or a law/IP firm.',
    ],
  },
  {
    h: '2. Accounts and eligibility',
    p: [
      'You sign in with a supported identity provider (e.g. Google). You are responsible for activity under your account. If you are under 18, DPDP requires verifiable guardian consent — typically collected by your college when it onboards you via its roster.',
      'Placement-cell (college admin) accounts are individually verified before activation, and colleges themselves are activated by a platform admin. We may refuse or revoke access for misuse.',
    ],
  },
  {
    h: '3. Acceptable use',
    p: [
      'Do not: impersonate others or another college; upload content you have no right to share; attempt to access data outside your account or your college scope; probe, overload or reverse-engineer the service; submit fabricated evidence for verification; or use exports to harass anyone.',
      'Verification exists to make claims trustworthy. Gaming it (fake repositories, plagiarized projects, keyword stuffing) can lead to removal of verified status or the account.',
    ],
  },
  {
    h: '4. Scores, verification and patent-readiness are estimates',
    p: [
      'Readiness scores, resume scores, ATS estimates and verification outcomes are deterministic, rule-based assessments — useful signals, not guarantees of employment, interview selection, or institutional outcomes.',
      'Patent-workspace outputs are explicitly positioned as estimates for faculty/IP-cell triage. They are not legal advice, not a patentability opinion, and not a substitute for a qualified patent professional.',
    ],
  },
  {
    h: '5. Your content and our licence to run the service',
    p: [
      'You own what you upload (resumes, projects, drafts). You grant us the limited licence needed to store, process, score, verify and display it per your consent choices — nothing more. Verified credentials we issue are signed attestations about your work; you may share them freely.',
    ],
  },
  {
    h: '6. College relationships',
    p: [
      'When you link a college and consent to visibility, its verified placement staff can view your readiness data as described in the Privacy Policy. The college is responsible for how its staff use that access and for institution-side obligations (including guardian consent for minors on its roster). You can leave a college or withdraw visibility at any time with immediate effect.',
    ],
  },
  {
    h: '7. Paid plans',
    p: [
      'Some features require a paid plan, billed through our payment provider (Razorpay). Prices and plan contents are shown at purchase. Taxes as applicable. Refunds and cancellation are governed by the Refund & Cancellation Policy on this page.',
    ],
  },
  {
    h: '8. Availability and changes',
    p: [
      'We aim for high availability but the service is provided "as is" without uptime warranties; features may evolve, and we may modify or discontinue components with reasonable notice for material changes. Data-rights features (export, deletion) will not be removed.',
    ],
  },
  {
    h: '9. Liability',
    p: [
      'To the maximum extent permitted by law, our aggregate liability for claims arising out of the service is limited to the amount you paid us in the twelve months before the claim (or ₹1,000 if you paid nothing). We are not liable for indirect or consequential losses, or for decisions employers, colleges or IP bodies make.',
    ],
  },
  {
    h: '10. Termination',
    p: [
      'You can delete your account any time (7-day grace window, then permanent cascade). We may suspend or terminate accounts that violate these terms; where practical we will say why, and your export right survives until deletion completes.',
    ],
  },
  {
    h: '11. Governing law and disputes',
    p: [
      'These terms are governed by the laws of India; courts at Pune, Maharashtra have exclusive jurisdiction, without prejudice to consumer-protection rights that mandate otherwise.',
    ],
  },
  {
    h: '12. Contact and grievance',
    p: [
      'Support and DPDP grievance contacts are listed on the Contact tab of this page and returned by the platform itself, so they are always current for this deployment. We respond to grievances within the committed window shown there.',
    ],
  },
];

export const REFUND_SECTIONS = [
  {
    h: 'Free tier and pilots',
    p: ['The core student experience and college pilot programmes are free — no payment, so nothing to refund. Paid plans only ever add capacity and premium features on top.'],
  },
  {
    h: 'Subscription cancellation',
    p: [
      'Cancel any time from Settings; access continues until the end of the paid period and the plan simply does not renew. No cancellation fee, no questions, no dark patterns.',
    ],
  },
  {
    h: 'Refunds',
    p: [
      'Duplicate charge, failed activation, or a payment captured without the plan unlocking: full refund, no debate — write to support with the payment id.',
      'First purchase of a plan: 7-day money-back window if the plan did not meet your expectation, provided usage was in good faith.',
      'Renewals and partial periods are otherwise non-refundable, except where required by law.',
      'Approved refunds are processed to the original payment method within 5–7 business days of approval (bank timelines may add a few days).',
    ],
  },
  {
    h: 'College contracts',
    p: ['Institutional agreements follow the refund and exit clauses in the signed order form; where none exist, the consumer terms above apply pro-rata.'],
  },
];

export const PRIVACY_SUMMARY = [
  {
    h: 'The short version',
    p: [
      'We store what the product needs to score and verify your placement readiness — profile, resumes and scores, projects and verification evidence, skill XP, activity, and your college membership. No ads, no selling data, no card numbers stored.',
      'Your college\'s placement cell sees your readiness only if you linked that college AND accepted the college-visibility consent — enforced in the database queries, not just the UI. Recruiter visibility is a separate opt-in, off by default.',
      'Your rights are product features: one-click full data export, account deletion with a 7-day grace window and a complete cascade, and consent you can withdraw at any time. Consent is versioned — a materially changed policy re-asks before it applies to you.',
      'Minors need verifiable guardian consent under the DPDP Act; colleges collect it when onboarding minors via roster.',
    ],
  },
  {
    h: 'The full policy',
    p: ['The complete policy — data table, retention periods, security posture, grievance timelines — ships with the application as docs/legal/PRIVACY_POLICY.md and is provided to every college in the data-handling pack. Ask us for a copy any time; it is the same document for everyone.'],
  },
];
