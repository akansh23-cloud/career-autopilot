# Narrative Intelligence V2

Companion to `RESUME-TAILORING-ARCHITECTURE.md`. That document describes the
execution path and the guarantees. This one describes how sentences are
actually produced, and why the quality problem the audit found was where it
was.

---

## The problem V2 was built to solve

The V1 audit reported the engine as **safe but too conservative**:

> Strong DevOps candidate, 8 existing bullets → ~2 substantive rewrites.
> Partial DevOps candidate, 6 existing bullets → 0 substantive rewrites.

Truth protection was strong. Usefulness was not. Three root causes were found
during Phase 2, and none of them was the one the brief predicted.

### Root cause 1 — the composer wasn't the bottleneck

Seven composition families already existed. They all reused the same verb and
the same object, so every candidate was a near-duplicate and the winner was
always a synonym swap. Adding more families would not have helped; adding a
*structurally different* transformation did.

### Root cause 2 — the scorer punished good rewriting

`scoreEvidence()` traced candidate words to evidence by **exact substring
match**. So:

- evidence contains `configuration`
- candidate contains `configured`
- → not traced → penalised

The engine was measuring *lexical identity* while claiming to measure
*traceability*, and the practical effect was that every morphological rewrite
scored worse than leaving the sentence alone. Fixed with a small deterministic
stemmer; tracing now accepts a stem match or a literal substring.

### Root cause 3 — candidates were truncated before they were scored

Depth's `alternativesPerBullet` was applied in the composer, which cut the
candidate list by **generation order**. The de-nominalised family is built
last, so in standard depth it was discarded before the reranker ever saw it —
the best sentence in the set never competed. Selection now belongs entirely to
the reranker; the composer returns every truth-passing candidate. The set is
bounded by construction (one per family), so there is still no unbounded
expansion.

---

## De-nominalisation

The highest-value edit a human resume writer makes, and a purely structural
one — no fact is added, removed or altered, because the verb was already the
candidate's own word wearing a noun costume.

```
Responsible for deployment configuration of Java 17 services
              across OpenShift environments using Helm and ConfigMaps.
   ↓
Configured Java 17 service deployments
              spanning OpenShift environments using Helm and ConfigMaps.
```

Implementation notes that matter:

- **Head-anchored.** The buried verb must be at the head of the phrase.
  Without this guard, *"GitLab CI pipelines for build, test and deployment of
  banking services"* matches on the trailing `deployment of …` and returns
  *"banking service GitLab CI pipelines for build, test and deployments"* —
  worse than the input in every respect. A nominalisation behind a
  `for`/`and`/comma clause belongs to a subordinate phrase.
- **Mass nouns.** `accesses`, `softwares`, `infrastructures` are the tell that
  a machine wrote the sentence. An uncountable-noun set suppresses them.
- **Ceiling-bound.** A `managed` recovered from `management` is an ownership
  word and is withheld from candidates whose evidence tops out below it.

A matching **nominalisation-density penalty** was added to naturalness
(P2.10's "awkward noun phrases"), with `of`-linked nominals counted double.
This is what lets the un-buried sentence win on merit rather than by
weight-fiddling.

---

## Seniority and ownership

Ownership bias may only ever **lower** the effective ceiling:

```js
effectiveCeiling = max(0, ownershipCeiling + min(0, ownershipBias))
```

`leadership-focus` mode has `ownershipBias: +1`. That does **not** raise the
ceiling — it only prefers ownership-family verbs among candidates the evidence
already permits. `fresher` mode has `-1`, which genuinely lowers it.

`assisted` cannot become `led`. `worked on` cannot become `architected`.
`responsible for` cannot become `owned` without ownership evidence.

---

## Summary composition (P2.17)

The V1 summary was factually safe and mechanical:

> DevOps Engineer working on automating manual delivery steps; release and
> deployment work across Java, GitLab CI and Helm. 7 years across Meridian
> Bank and Cotwell IT.

V2 adds **outcome-carrying structures**: identity + domain + tooling, then one
proven outcome.

> DevOps Engineer with 8 years of experience across delivery automation,
> including Java, GitLab CI, Helm and Jenkins. Automated post-deployment
> sanity test triggering, reducing manual verification effort by 80%.

Three things made this work:

1. **The metric had to be given to the summary's evidence record.** The
   summary is validated against a synthetic evidence record built from the
   graph. That record did not carry the headline achievement's metric, so the
   truth gate correctly rejected every structure that quoted it. The fix was
   to give the record the evidence — *never* to loosen the gate.
2. **Metric binding survives.** Only the single strongest quantified
   achievement is carried, and it is carried *with the clause it belongs to*.
   The number cannot be re-pointed at a different claim because the claim
   travels with it.
3. **Two registers for the same fact.** Intent phrases are gerund-shaped
   (`automating manual delivery steps`) and read wrongly after "across". A
   parallel noun-phrase map (`delivery automation`, `build and release
   engineering`) supplies the right register for that slot. Summary prose also
   never semicolon-splices — it says less instead.

Structures that need an achievement return nothing when there isn't one,
rather than padding. Fixture B (partial DevOps, no quantified achievements)
correctly gets no achievement sentence.

---

## Measuring usefulness (P2.22)

`changed / total` is the wrong metric: a strong, specific, already-quantified
bullet **should** come back untouched, and counting that as a failure pushes
the engine toward gratuitous churn.

A bullet enters the denominator only if it has **both**:

- a weakness — weak opener, vague nouns, over-length, or a buried verb; **and**
- enough evidence to fix it honestly — a concrete anchor, method, scope or
  outcome.

Bullets with a weakness and no material are reported separately as
`INSUFFICIENT_EVIDENCE_FOR_STRONGER_BULLET`, with structured prompts the UI
can surface ("Which tool did you use?", "What changed as a result?"). They are
**refusals, not misses**, and folding them into the rate would create pressure
to fabricate.

**Both denominators are published**, because publishing only the flattering
one is exactly the benchmark-cheating P2.25 forbids:

```
strict                 0.857  (12 / 14 improvable)
including thin-evidence 0.545  (12 / 22)
```

The numerator is identical in both.

---

## Two gates, not one (P2.21)

Safety and quality answer different questions. A run that invents nothing but
improves nothing is a **safety pass and a quality fail**, and collapsing them
into one green tick is how an engine ships that is honest and useless.

| Gate | Rule |
|---|---|
| Safety | unsupported claims, untraced metrics, failed runs all zero |
| Quality | useful rewrite rate ≥ 0.55, JD relevance ≥ 0.35, specificity ≥ 0.30, domain ≥ 0.30, naturalness ≥ 0.85 |

---

## Regression fixtures

`test/fixtures/tailoringAuditFixtures.js` — all synthetic.

| Fixture | Encodes |
|---|---|
| A `audit_strong_devops` | OpenShift satisfies `Kubernetes OR OpenShift`; Kubernetes never claimed; 80% stays bound |
| B `audit_partial_devops` | Docker/Jenkins present, no orchestration; adjacency must not become a claim |
| C `audit_fresher` | internship + student project; no seniority, ownership or production language |
| `attack_skill_leakage` | AWS in role B must not enter role A |
| `attack_metric_leakage` | 40% deployment reduction cannot become 40% reliability |
| `attack_ownership_inflation` | `assisted` cannot become `led` |
| `attack_certification_inflation` | completed training is not certification |
| `attack_company_knowledge` | employer's Kafka is not candidate experience |
| `attack_project_merging` | two projects' metrics stay separate |
| `attack_incomplete_dates` | tenure computed from usable dates only |

---

## Deliberate test changes

Two pre-existing tests asserted behaviour V2 deliberately changed. Both are
flagged in-code so a reviewer sees the contract move rather than a silent
rewrite:

1. `skills: semantic normalisation and implication` → now
   `claimable implication vs non-claimable substrate`. Previously asserted
   `expandImplied('aws eks').includes('kubernetes')`. Now asserts the
   opposite, plus `substrateOf('openshift').includes('kubernetes')` — the
   relationship is still known, it is just not claimable.
2. `hardening` quota mapping → `/api/resume/tailor` now maps to `tailoring`,
   not `aiCalls`.

Neither weakened a truth check; both tightened one.
