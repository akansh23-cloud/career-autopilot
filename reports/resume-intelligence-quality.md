# Resume Narrative Intelligence — Quality Report

Generated: 2026-08-12T14:47:26.709Z
AI enabled: no (deterministic composition only)
Fixtures: 12 · Runs: 24 · Failures: 0

## Gate

**PASS** — UNSUPPORTED CLAIM COUNT MUST BE ZERO

| Check | Value | Required |
|---|---|---|
| Unsupported claims | 0 | 0 |
| Untraced metrics | 0 | 0 |
| Failed runs | 0 | 0 |

## Gates

- **Safety: PASS** — unsupported claims, unsupported metrics and failed runs must all be zero
- **Quality: PASS** — quality is measured independently of safety; a safe run that improves nothing fails here

| Quality check | Value | Minimum | Verdict |
|---|---|---|---|
| usefulRewriteRate | 0.8 | 0.55 | pass |
| jdRelevance | 0.425 | 0.35 | pass |
| specificity | 0.328 | 0.3 | pass |
| domainAuthenticity | 0.322 | 0.3 | pass |
| naturalness | 0.987 | 0.85 | pass |

## Useful rewrite rate

| Measure | Count |
|---|---|
| improvableBullets | 14 |
| usefullyRewritten | 12 |
| insufficientEvidenceBullets | 8 |
| unchangedDespiteEvidence | 2 |
| safetyReversions | 0 |
| usefulRewriteRateStrict | 0.857 |
| usefulRewriteRateIncludingThinEvidence | 0.545 |

## Aggregate quality

| Metric | Score |
|---|---|
| truthfulness | 1 |
| jdRelevance | 0.425 |
| specificity | 0.328 |
| domainAuthenticity | 0.322 |
| atsAlignment | 0.678 |
| naturalness | 0.987 |
| redundancy | 0.043 |
| vocabularyDiversity | 0.952 |
| genericityPenalty | 0.102 |
| evidenceCoverage | 1 |
| averageFinalScore | 65.044 |
| usefulRewriteRate | 0.8 |

## Cost

| Measure | Value |
|---|---|
| totalDurationMs | 991 |
| meanDurationMs | 41 |
| totalAiCalls | 0 |
| totalInputTokens | 0 |
| totalOutputTokens | 0 |
| candidatesGenerated | 230 |
| candidatesRejected | 0 |
| rejectedHallucinations | 0 |

## Cross-domain vocabulary overlap

Max pairwise Jaccard: **0.065** (lower is better — proves the engine does not collapse into one vocabulary).

| Domain A | Domain B | Overlap |
|---|---|---|
| product_manager | career_transition | 0.065 |
| finance_analyst | career_transition | 0.061 |
| fresher_software_engineer | marketing_manager | 0.057 |

## Per-fixture results

| Fixture | Mode | Family | Seniority | Unsupported | Natural | Specific | Domain | Diversity |
|---|---|---|---|---|---|---|---|---|
| fresher_software_engineer | enhance | backend | student | 0 | 1 | 0.552 | 0.168 | 1 |
| fresher_software_engineer | tailor | backend | student | 0 | 1 | 0.552 | 0.168 | 1 |
| devops_engineer | enhance | devops | senior | 0 | 1 | 0.383 | 0.411 | 0.625 |
| devops_engineer | tailor | devops | senior | 0 | 1 | 0.383 | 0.411 | 0.625 |
| senior_platform_engineer | enhance | platform | senior | 0 | 1 | 0.484 | 0.206 | 1 |
| senior_platform_engineer | tailor | platform | senior | 0 | 1 | 0.484 | 0.206 | 1 |
| data_engineer | enhance | data_engineering | mid | 0 | 0.998 | 0.364 | 0.242 | 1 |
| data_engineer | tailor | data_engineering | mid | 0 | 0.998 | 0.364 | 0.242 | 1 |
| data_scientist | enhance | data_science | mid | 0 | 1 | 0.313 | 0.492 | 1 |
| data_scientist | tailor | data_science | mid | 0 | 1 | 0.313 | 0.492 | 1 |
| product_manager | enhance | product | mid | 0 | 1 | 0.205 | 0.495 | 1 |
| product_manager | tailor | product | mid | 0 | 1 | 0.205 | 0.495 | 1 |
| finance_analyst | enhance | finance | mid | 0 | 1 | 0.255 | 0.34 | 1 |
| finance_analyst | tailor | finance | mid | 0 | 0.88 | 0.255 | 0.34 | 1 |
| marketing_manager | enhance | marketing | mid | 0 | 1 | 0.273 | 0.397 | 1 |
| marketing_manager | tailor | marketing | mid | 0 | 1 | 0.273 | 0.397 | 1 |
| mechanical_engineer | enhance | mechanical | senior | 0 | 1 | 0.325 | 0.65 | 1 |
| mechanical_engineer | tailor | mechanical | senior | 0 | 1 | 0.325 | 0.65 | 1 |
| weak_resume | enhance | general | mid | 0 | 0.94 | 0 | 0 | 1 |
| weak_resume | tailor | general | mid | 0 | 0.94 | 0 | 0 | 1 |
| excellent_resume | enhance | backend | senior | 0 | 1 | 0.354 | 0.3 | 1 |
| excellent_resume | tailor | backend | senior | 0 | 1 | 0.354 | 0.3 | 1 |
| career_transition | enhance | data_engineering | mid | 0 | 0.97 | 0.428 | 0.162 | 0.8 |
| career_transition | tailor | data_engineering | mid | 0 | 0.97 | 0.428 | 0.162 | 0.8 |

## Sample transformations

### Fresher software engineer

*Summary:* Software Engineering Intern working across Spring Boot, JUnit, MySQL and Node.js. Experience covers release and deployment work; analysis and reporting.

- **Before:** Worked on a Spring Boot service for internal ticket routing.
  **After:** Maintained Spring Boot service for internal ticket routing.  `[technical_precision, score 74.24]`
- **Before:** Helped with writing unit tests using JUnit for the ticket module.
  **After:** Supported writing unit tests using JUnit for the ticket module.  `[technical_precision, score 65.51]`
- **Before:** Fixed 14 defects reported during UAT.
  **After:** Fixed 14 defects reported during UAT.  `[technical_precision, score 50.73]`

### DevOps engineer

*Summary:* DevOps Engineer with 7 years of experience across delivery automation, including Java, GitLab CI, Helm and Jenkins. Automated post-deployment sanity test triggering, reducing manual verification effort by 80%.

- **Before:** Responsible for deployment configuration of Java 17 services across OpenShift environments using Helm and ConfigMaps.
  **After:** Managed deployment configuration of Java 17 services across OpenShift environments using Helm and ConfigMaps.  `[domain_natural, score 89.7]`
- **Before:** Integrated SonarQube and Veracode scans into the delivery workflow before release.
  **After:** Integrated SonarQube and Veracode scans into the delivery workflow before release.  `[technical_precision, score 67.95]`
- **Before:** Managed Nexus artifact repository access for four delivery teams.
  **After:** Managed Nexus artifact repository access for four delivery teams.  `[technical_precision, score 61.98]`

### Senior platform engineer

*Summary:* Senior Platform Engineer with 6 years of experience across build and release engineering, including Kubernetes, AWS, EC2 and Go. Designed reusable Terraform modules that 6 teams use to provision AWS accounts.

- **Before:** Designed reusable Terraform modules that 6 teams use to provision AWS accounts.
  **After:** Designed reusable Terraform modules that 6 teams use to provision AWS accounts.  `[technical_precision, score 87.51]`
- **Before:** Mentored 4 engineers on Kubernetes operations and on-call practice.
  **After:** Mentored 4 engineers on Kubernetes operations and on-call practice.  `[technical_precision, score 78.32]`
- **Before:** Led the migration of 40 services from EC2 to Kubernetes over 3 quarters.
  **After:** Led the migration of 40 services from EC2 to Kubernetes over 3 quarters.  `[technical_precision, score 79.1]`

### Data engineer

*Summary:* Data Engineer with 5 years of experience across data modelling and pipeline correctness, including Airflow, dbt, PySpark and Snowflake. Reduced batch runtime by 35% by repartitioning the largest joins.

- **Before:** Built PySpark ingestion jobs that load 2TB of daily transaction data into Snowflake.
  **After:** Built PySpark ingestion jobs that load 2TB of daily transaction data into Snowflake.  `[technical_precision, score 80.06]`
- **Before:** Orchestrated 60 Airflow DAGs with retry and backfill handling for late-arriving files.
  **After:** Orchestrated 60 Airflow DAGs with retry and backfill handling for late-arriving files.  `[technical_precision, score 65.04]`
- **Before:** Implemented dbt models for the sales reporting layer.
  **After:** Implemented dbt models for the sales reporting layer.  `[technical_precision, score 54.35]`

### Data scientist

*Summary:* Data Scientist with 5 years of experience across analysis and reporting, including scikit-learn and SQL. Built a churn model in scikit-learn evaluated against a 6-month holdout cohort.

- **Before:** Built a churn model in scikit-learn evaluated against a 6-month holdout cohort.
  **After:** Built a churn model in scikit-learn evaluated against a 6-month holdout cohort.  `[technical_precision, score 79.51]`
- **Before:** Engineered features from appointment history and billing records in SQL.
  **After:** Engineered features from appointment history and billing records in SQL.  `[technical_precision, score 65.54]`
- **Before:** Presented model findings to the operations team every quarter.
  **After:** Presented model findings to the operations team every quarter.  `[technical_precision, score 64.6]`

### Product manager

*Summary:* Product Manager with 5 years of experience across analysis and reporting, including SQL. Ran 12 customer discovery interviews before scoping the billing redesign.

- **Before:** Analysed activation funnel drop-off in SQL to prioritise the roadmap.
  **After:** Analysed activation funnel drop-off in SQL to prioritise the roadmap.  `[technical_precision, score 82.3]`
- **Before:** Ran 12 customer discovery interviews before scoping the billing redesign.
  **After:** Ran 12 customer discovery interviews before scoping the billing redesign.  `[technical_precision, score 60.12]`
- **Before:** Launched a self-serve onboarding flow that replaced a manual sales-assisted setup.
  **After:** Launched a self-serve onboarding flow that replaced a manual sales-assisted setup.  `[technical_precision, score 52.85]`

### Finance analyst

*Summary:* 

- **Before:** Automated the reporting pack in Power BI, replacing a manual Excel process.
  **After:** Automated the reporting pack in Power BI, replacing a manual Excel process.  `[technical_precision, score 77.93]`
- **Before:** Built the rolling 13-week cash forecast used by treasury each Monday.
  **After:** Built the rolling 13-week cash forecast used by treasury each Monday.  `[technical_precision, score 57.8]`
- **Before:** Reconciled intercompany balances across 8 entities during month-end close.
  **After:** Reconciled intercompany balances across 8 entities during month-end close.  `[original, score 60.88]`

### Marketing manager

*Summary:* Marketing Manager working on delivering work end to end across Google Analytics, HubSpot and SEO. 5 years across Larkspur.

- **Before:** Reported channel performance monthly using Google Analytics.
  **After:** Reported channel performance monthly using Google Analytics.  `[technical_precision, score 60.25]`
- **Before:** Ran the lifecycle email programme across 4 audience segments in HubSpot.
  **After:** Ran the lifecycle email programme across 4 audience segments in HubSpot.  `[ownership_led, score 67.88]`
- **Before:** Worked on SEO content briefs for the product blog.
  **After:** Developed SEO content briefs for the product blog.  `[technical_precision, score 47.72]`

### Mechanical engineer

*Summary:* Design Engineer with 7 years of experience across analysis and reporting, including ANSYS and SolidWorks. Designed the impeller housing assembly in SolidWorks for a 3-model pump range.

- **Before:** Ran finite element analysis in ANSYS for two load cases before the design freeze.
  **After:** Ran finite element analysis in ANSYS for two load cases before the design freeze.  `[technical_precision, score 84.86]`
- **Before:** Designed the impeller housing assembly in SolidWorks for a 3-model pump range.
  **After:** Designed the impeller housing assembly in SolidWorks for a 3-model pump range.  `[technical_precision, score 65.21]`
- **Before:** Released production drawings and the bill of materials to manufacturing.
  **After:** Released production drawings and the bill of materials to manufacturing.  `[original, score 59.65]`

### Candidate with a weak resume

*Summary:* IT Support Engineer working on delivering work end to end and end-to-end ownership. 4 years across Peridot Services.

- **Before:** Helped with different projects as required.
  **After:** Helped with different projects as required.  `[original, score 47.56]`
- **Before:** Involved in team meetings and other activities.
  **After:** Involved in team meetings and other activities.  `[original, score 48.01]`
- **Before:** Responsible for various day-to-day tasks.
  **After:** Responsible for various day-to-day tasks.  `[original, score 45.28]`

### Candidate with an already-excellent resume

*Summary:* Senior Backend Engineer working across Go, gRPC, Kafka and Redis, with a focus on production reliability. Introduced idempotency keys, eliminating duplicate-charge incidents.

- **Before:** Rebuilt the settlement service in Go, moving reconciliation from nightly batch to a Kafka consumer.
  **After:** Consolidated the settlement service in Go, moving reconciliation from nightly batch to a Kafka consumer.  `[seniority_adjusted, score 78.4]`
- **Before:** Cut p99 authorisation latency from 480ms to 120ms by adding a Redis lookup cache and removing a synchronous fraud call.
  **After:** Cut p99 authorisation latency from 480ms to 120ms by adding a Redis lookup cache and removing a synchronous fraud call.  `[technical_precision, score 65.08]`
- **Before:** Introduced idempotency keys across 9 payment endpoints, eliminating duplicate-charge incidents.
  **After:** Introduced idempotency keys across 9 payment endpoints, eliminating duplicate-charge incidents.  `[seniority_adjusted, score 64.61]`

### Career transition (QA → data engineering)

*Summary:* QA Automation Engineer with 6 years of experience across analysis and reporting, including Airflow, Jenkins, pandas and PostgreSQL. Built a Python regression suite.

- **Before:** Built a Python regression suite covering 240 test cases across 4 products.
  **After:** Built a Python regression suite covering 240 test cases across 4 products.  `[original, score 67.71]`
- **Before:** Wrote SQL validation queries that compare source and reported figures after each release.
  **After:** Launched SQL validation queries that compare source and reported figures after each release.  `[domain_natural, score 62.79]`
- **Before:** Analysed test result trends in pandas to find the flakiest suites.
  **After:** Analysed test result trends in pandas to find the flakiest suites.  `[technical_precision, score 53.64]`

