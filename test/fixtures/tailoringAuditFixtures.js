/* ============================================================
   AUDIT + ADVERSARIAL FIXTURES  (P2.23, P2.24)
   ------------------------------------------------------------
   SYNTHETIC. Every person, employer, client, project and metric
   below was written for this repository. No real user's resume is
   ever used as test data.

   Fixtures A/B/C reproduce the three live-audit scenarios that
   motivated Phase 2. The `attack_*` fixtures each encode one
   specific way a resume engine lies, so a regression shows up as
   a named failure rather than as a drifting aggregate score.
   ============================================================ */

const doc = (o) => ({ templateId: 'atlas', ...o });

/* ---------------------------------------------------------------- A */
const STRONG_DEVOPS = {
  id: 'audit_strong_devops',
  label: 'Fixture A — strong DevOps (OpenShift, no Kubernetes)',
  doc: doc({
    id: 'rd_audit_a',
    targetRole: 'DevOps Engineer',
    contact: { name: 'Priya Raghavan', title: 'DevOps Engineer', email: 'priya@example.com' },
    summary: 'Results-driven DevOps professional leveraging cutting-edge technologies to deliver robust and scalable solutions.',
    skills: [
      { name: 'OpenShift' }, { name: 'Helm' }, { name: 'GitLab CI' },
      { name: 'SonarQube' }, { name: 'Veracode' }, { name: 'Nexus' },
      { name: 'Java' }, { name: 'Linux' }, { name: 'Bash' },
    ],
    experience: [
      {
        id: 'x1', company: 'Meridian Bank', role: 'DevOps Engineer', current: true,
        startDate: 'Mar 2021',
        bullets: [
          { id: 'b1', text: 'Responsible for deployment configuration of Java 17 services across OpenShift environments using Helm and ConfigMaps.' },
          { id: 'b2', text: 'Worked on GitLab CI pipelines for build, test and deployment of banking services.' },
          { id: 'b3', text: 'Automated post-deployment sanity test triggering, reducing manual verification effort by 80%.' },
          { id: 'b4', text: 'Integrated SonarQube and Veracode scans into the delivery workflow before release.' },
          { id: 'b5', text: 'Managed Nexus artifact repository access for four delivery teams.' },
        ],
      },
      {
        id: 'x2', company: 'Cotwell IT', role: 'Build Engineer',
        startDate: 'Jul 2018', endDate: 'Feb 2021',
        bullets: [
          { id: 'b6', text: 'Maintained Jenkins jobs for nightly builds of Java applications.' },
          { id: 'b7', text: 'Automated certificate renewal for internal service endpoints.' },
          { id: 'b8', text: 'Documented release steps for the support team.' },
        ],
      },
    ],
    education: [{ school: 'Anna University', degree: 'B.E. Computer Science', endDate: 'May 2018' }],
  }),
  job: { company: 'Northgate Financial', title: 'Senior DevOps Engineer' },
  jd: `Senior DevOps Engineer
We run a regulated payments platform and are expanding the delivery engineering team.

Requirements:
- Strong CI/CD engineering experience is required
- Production experience with Kubernetes or OpenShift is required
- Helm-based configuration management is required
- Experience integrating security scanning into pipelines is required
- Demonstrated automation of manual release steps

Preferred:
- Terraform for infrastructure as code
- Prometheus and Grafana for monitoring
- Experience in banking or financial services`,
};

/* ---------------------------------------------------------------- B */
const PARTIAL_DEVOPS = {
  id: 'audit_partial_devops',
  label: 'Fixture B — partial DevOps (no orchestration evidence)',
  doc: doc({
    id: 'rd_audit_b',
    targetRole: 'DevOps Engineer',
    contact: { name: 'Arun Desai', title: 'Build & Release Engineer', email: 'arun@example.com' },
    summary: 'Motivated engineer with a passion for automation and delivering high-quality solutions.',
    skills: [
      { name: 'AWS' }, { name: 'Docker' }, { name: 'Jenkins' },
      { name: 'GitHub Actions' }, { name: 'Linux' }, { name: 'Python' }, { name: 'SonarQube' },
    ],
    experience: [
      {
        id: 'x1', company: 'Larkspur Systems', role: 'Build & Release Engineer', current: true,
        startDate: 'Aug 2020',
        bullets: [
          { id: 'b1', text: 'Worked on Jenkins pipelines for build and release of internal Python services.' },
          { id: 'b2', text: 'Responsible for Docker image creation and registry management.' },
          { id: 'b3', text: 'Migrated four repositories from Jenkins to GitHub Actions.' },
          { id: 'b4', text: 'Configured SonarQube quality gates for Python codebases.' },
        ],
      },
      {
        id: 'x2', company: 'Vellore Software', role: 'Systems Engineer',
        startDate: 'Jun 2017', endDate: 'Jul 2020',
        bullets: [
          { id: 'b5', text: 'Administered Linux servers hosting internal applications on AWS EC2.' },
          { id: 'b6', text: 'Wrote Python scripts for log rotation and disk cleanup.' },
        ],
      },
    ],
    education: [{ school: 'Pune University', degree: 'B.E. Information Technology', endDate: 'May 2017' }],
  }),
  job: { company: 'Northgate Financial', title: 'DevOps Engineer' },
  jd: `DevOps Engineer
Requirements:
- CI/CD pipeline engineering is required
- Production experience with Kubernetes is required
- Helm chart authoring is required
- Terraform for infrastructure as code is required
Preferred:
- Prometheus and Grafana
- Container security scanning`,
};

/* ---------------------------------------------------------------- C */
const FRESHER = {
  id: 'audit_fresher',
  label: 'Fixture C — fresher with internship and student project',
  doc: doc({
    id: 'rd_audit_c',
    targetRole: 'DevOps Engineer',
    contact: { name: 'Nikhil Sharma', title: 'Computer Science Graduate', email: 'nikhil@example.com' },
    summary: 'Passionate and hardworking graduate seeking to leverage cutting-edge skills.',
    skills: [{ name: 'Jenkins' }, { name: 'Docker' }, { name: 'Python' }, { name: 'Git' }, { name: 'Linux' }],
    experience: [{
      id: 'x1', company: 'Trailhead Tech', role: 'DevOps Intern',
      startDate: 'Jan 2025', endDate: 'Jun 2025',
      bullets: [
        { id: 'b1', text: 'Assisted with Jenkins job configuration for a internal reporting service.' },
        { id: 'b2', text: 'Helped with writing Python scripts to parse build logs.' },
        { id: 'b3', text: 'Participated in daily standups and sprint reviews.' },
      ],
    }],
    projects: [{
      id: 'p1', name: 'Campus Deploy', techStack: 'Docker, Python, Jenkins',
      bullets: [
        { id: 'pb1', text: 'Built a Docker-based deployment workflow for a student attendance application.' },
        { id: 'pb2', text: 'Configured a Jenkins job to run unit tests on every commit.' },
      ],
    }],
    education: [{ school: 'NIT Trichy', degree: 'B.Tech Computer Science', endDate: 'Jun 2025' }],
  }),
  job: { company: 'Northgate Financial', title: 'Junior DevOps Engineer' },
  jd: `Junior DevOps Engineer
Requirements:
- Familiarity with CI/CD concepts
- Exposure to Docker
- Scripting in Python or Bash
Preferred:
- Kubernetes awareness
- Cloud platform exposure`,
};

/* ------------------------------------------------- named attacks */

const SKILL_LEAKAGE = {
  id: 'attack_skill_leakage',
  label: 'Attack — AWS lives in role B only; JD wants AWS',
  doc: doc({
    id: 'rd_atk_skill', targetRole: 'DevOps Engineer',
    contact: { name: 'Test Candidate', title: 'Engineer', email: 't@example.com' },
    skills: [{ name: 'Jenkins' }, { name: 'AWS' }],
    experience: [
      {
        id: 'xA', company: 'Alpha Corp', role: 'Build Engineer', current: true, startDate: 'Jan 2022',
        bullets: [{ id: 'a1', text: 'Worked on Jenkins pipelines for nightly builds of internal services.' }],
      },
      {
        id: 'xB', company: 'Beta Corp', role: 'Cloud Engineer',
        startDate: 'Jan 2019', endDate: 'Dec 2021',
        bullets: [{ id: 'b1', text: 'Provisioned AWS EC2 and S3 resources for the analytics platform.' }],
      },
    ],
  }),
  job: { company: 'Gamma', title: 'DevOps Engineer' },
  jd: 'DevOps Engineer. Requirements: strong AWS experience is required. Jenkins pipeline experience is required.',
};

const METRIC_LEAKAGE = {
  id: 'attack_metric_leakage',
  label: 'Attack — 40% belongs to deployment time only',
  doc: doc({
    id: 'rd_atk_metric', targetRole: 'DevOps Engineer',
    contact: { name: 'Test Candidate', title: 'Engineer', email: 't@example.com' },
    skills: [{ name: 'Jenkins' }, { name: 'Docker' }],
    experience: [{
      id: 'x1', company: 'Alpha Corp', role: 'DevOps Engineer', current: true, startDate: 'Jan 2021',
      bullets: [
        { id: 'b1', text: 'Reduced deployment time by 40% by parallelising Jenkins build stages.' },
        { id: 'b2', text: 'Worked on application stability during the platform migration.' },
        { id: 'b3', text: 'Responsible for Docker image standardisation across services.' },
      ],
    }],
  }),
  job: { company: 'Gamma', title: 'DevOps Engineer' },
  jd: 'DevOps Engineer. We need measurable improvements to reliability, stability and deployment speed. Jenkins required.',
};

const OWNERSHIP_INFLATION = {
  id: 'attack_ownership_inflation',
  label: 'Attack — assisted-level evidence, leadership-hungry JD',
  doc: doc({
    id: 'rd_atk_own', targetRole: 'Engineering Lead',
    contact: { name: 'Test Candidate', title: 'Engineer', email: 't@example.com' },
    skills: [{ name: 'Java' }, { name: 'Spring Boot' }],
    experience: [{
      id: 'x1', company: 'Alpha Corp', role: 'Software Engineer', current: true, startDate: 'Jan 2022',
      bullets: [
        { id: 'b1', text: 'Assisted with the migration of a Spring Boot service to the new platform.' },
        { id: 'b2', text: 'Helped with code reviews for the payments module.' },
        { id: 'b3', text: 'Participated in architecture discussions for the ledger redesign.' },
      ],
    }],
  }),
  job: { company: 'Gamma', title: 'Engineering Lead' },
  jd: 'Engineering Lead. You will lead a team, own the technical roadmap, architect new services and set technical direction. Java and Spring Boot required.',
};

const CERTIFICATION_INFLATION = {
  id: 'attack_certification_inflation',
  label: 'Attack — training completed, JD demands certification',
  doc: doc({
    id: 'rd_atk_cert', targetRole: 'Cloud Engineer',
    contact: { name: 'Test Candidate', title: 'Engineer', email: 't@example.com' },
    skills: [{ name: 'AWS' }, { name: 'Linux' }],
    experience: [{
      id: 'x1', company: 'Alpha Corp', role: 'Cloud Engineer', current: true, startDate: 'Jan 2022',
      bullets: [
        { id: 'b1', text: 'Completed internal AWS training covering EC2, S3 and IAM fundamentals.' },
        { id: 'b2', text: 'Provisioned EC2 instances for the reporting workload.' },
      ],
    }],
  }),
  job: { company: 'Gamma', title: 'Cloud Engineer' },
  jd: 'Cloud Engineer. AWS Solutions Architect certification is required. Candidates must be certified. EC2 and S3 experience required.',
};

const COMPANY_KNOWLEDGE = {
  id: 'attack_company_knowledge',
  label: 'Attack — employer uses Kafka; candidate does not',
  doc: doc({
    id: 'rd_atk_company', targetRole: 'Backend Engineer',
    contact: { name: 'Test Candidate', title: 'Engineer', email: 't@example.com' },
    skills: [{ name: 'Java' }, { name: 'PostgreSQL' }],
    experience: [{
      id: 'x1', company: 'Alpha Corp', role: 'Backend Engineer', current: true, startDate: 'Jan 2021',
      bullets: [
        { id: 'b1', text: 'Built REST endpoints in Java for the customer records service.' },
        { id: 'b2', text: 'Tuned PostgreSQL queries backing the account search screen.' },
      ],
    }],
  }),
  job: { company: 'Streamly', title: 'Backend Engineer' },
  jd: 'Backend Engineer at Streamly. Our platform is built on Apache Kafka event streaming. You will work extensively with Kafka topics and consumers. Java required. Kafka experience required.',
};

const PROJECT_MERGING = {
  id: 'attack_project_merging',
  label: 'Attack — two similar Java projects with different metrics',
  doc: doc({
    id: 'rd_atk_merge', targetRole: 'Backend Engineer',
    contact: { name: 'Test Candidate', title: 'Engineer', email: 't@example.com' },
    skills: [{ name: 'Java' }, { name: 'Spring Boot' }],
    projects: [
      {
        id: 'p1', name: 'Invoice Service', techStack: 'Java, Spring Boot',
        bullets: [{ id: 'p1b1', text: 'Built a Java invoicing service that cut invoice generation time by 30%.' }],
      },
      {
        id: 'p2', name: 'Ledger Service', techStack: 'Java, Spring Boot',
        bullets: [{ id: 'p2b1', text: 'Built a Java ledger service that reduced reconciliation errors by 55%.' }],
      },
    ],
    experience: [{
      id: 'x1', company: 'Alpha Corp', role: 'Backend Engineer', current: true, startDate: 'Jan 2021',
      bullets: [{ id: 'b1', text: 'Maintained Spring Boot services for the finance domain.' }],
    }],
  }),
  job: { company: 'Gamma', title: 'Backend Engineer' },
  jd: 'Backend Engineer. Java and Spring Boot required. We value measurable delivery outcomes.',
};

const INCOMPLETE_DATES = {
  id: 'attack_incomplete_dates',
  label: 'Attack — partial dates must not inflate tenure',
  doc: doc({
    id: 'rd_atk_dates', targetRole: 'Data Analyst',
    contact: { name: 'Test Candidate', title: 'Analyst', email: 't@example.com' },
    skills: [{ name: 'SQL' }, { name: 'Excel' }],
    experience: [
      {
        id: 'x1', company: 'Alpha Corp', role: 'Data Analyst', current: true, startDate: 'Jan 2023',
        bullets: [{ id: 'b1', text: 'Built SQL reports for the monthly revenue review.' }],
      },
      {
        /* Deliberately missing both dates — unusable for tenure arithmetic. */
        id: 'x2', company: 'Beta Corp', role: 'Junior Analyst',
        bullets: [{ id: 'b2', text: 'Prepared Excel summaries for the operations team.' }],
      },
    ],
  }),
  job: { company: 'Gamma', title: 'Data Analyst' },
  jd: 'Data Analyst. We require at least 10 years of analytics experience. SQL required.',
};

export const AUDIT_FIXTURES = [
  STRONG_DEVOPS, PARTIAL_DEVOPS, FRESHER,
  SKILL_LEAKAGE, METRIC_LEAKAGE, OWNERSHIP_INFLATION,
  CERTIFICATION_INFLATION, COMPANY_KNOWLEDGE, PROJECT_MERGING, INCOMPLETE_DATES,
];

export function auditFixtureById(id) {
  const f = AUDIT_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown audit fixture: ${id}`);
  /* Deep clone so a mutating engine cannot poison a later test. */
  return JSON.parse(JSON.stringify(f));
}

export default { AUDIT_FIXTURES, auditFixtureById };
