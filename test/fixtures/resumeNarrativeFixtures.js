/* ============================================================
   GOLDEN FIXTURES — synthetic candidates + job descriptions
   ------------------------------------------------------------
   SYNTHETIC. Every person, employer, project and metric here was
   written for this repository. No real user's resume is ever used
   as test data, a corpus, or generation context.

   The set deliberately spans domains, seniorities and quality
   levels so the benchmark can prove the engine does NOT collapse
   into one vocabulary:

   `expectedSeniority` may be an array where tenure drifts with wall-clock
   time — a fixture with a current role gains years every month, so more than
   one reading stays correct.

     1  fresher software engineer      7  finance analyst
     2  devops engineer                8  marketing manager
     3  senior platform engineer       9  mechanical engineer
     4  data engineer                 10  weak resume
     5  data scientist                11  excellent resume
     6  product manager               12  career transition
   ============================================================ */

const doc = (o) => ({ templateId: 'atlas', ...o });

export const FIXTURES = [
  /* ---------------------------------------------------------------- 1 */
  {
    id: 'fresher_software_engineer',
    label: 'Fresher software engineer',
    expectedFamily: 'backend',
    expectedSeniority: 'student',
    doc: doc({
      id: 'rd_fx1', targetRole: 'Software Engineer',
      contact: { name: 'Ravi Menon', title: 'Software Engineering Graduate', email: 'ravi@example.com' },
      summary: 'Highly motivated and results-driven computer science graduate with a passion for cutting-edge technologies.',
      skills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'MySQL' }, { name: 'Git' }, { name: 'React' }],
      experience: [{
        id: 'x1', company: 'Nimbus Labs', role: 'Software Engineering Intern',
        startDate: 'Jan 2024', endDate: 'Jun 2024',
        bullets: [
          { id: 'b1', text: 'Worked on a Spring Boot service for internal ticket routing.' },
          { id: 'b2', text: 'Helped with writing unit tests using JUnit for the ticket module.' },
          { id: 'b3', text: 'Fixed 14 defects reported during UAT.' },
        ],
      }],
      projects: [{
        id: 'p1', name: 'Campus Marketplace', techStack: 'React, Node.js, MySQL',
        bullets: [
          { id: 'pb1', text: 'Built a React and Node.js marketplace where students list and search second-hand books.' },
          { id: 'pb2', text: 'Implemented MySQL schema with indexed search across 3 tables.' },
        ],
      }],
      education: [{ school: 'VIT Vellore', degree: 'B.Tech Computer Science', endDate: 'May 2024' }],
    }),
    jd: `Graduate Software Engineer
We are hiring graduate engineers to join our backend platform team.
Requirements:
- Bachelor's degree in Computer Science or related field
- Strong fundamentals in Java and object-oriented design
- Familiarity with Spring Boot and REST API development
- Understanding of SQL databases
Nice to have:
- Exposure to unit testing frameworks such as JUnit
- Any experience with Git and code review
What you'll do:
- Build and ship features in our Java services
- Write unit tests and participate in code review`,
    job: { company: 'Northwind Systems', title: 'Graduate Software Engineer' },
  },

  /* ---------------------------------------------------------------- 2 */
  {
    id: 'devops_engineer',
    label: 'DevOps engineer',
    expectedFamily: 'devops',
    /* Tenure crosses the mid/senior threshold as time passes; both are correct
       readings of this evidence. */
    expectedSeniority: ['mid', 'senior'],
    doc: doc({
      id: 'rd_fx2', targetRole: 'DevOps Engineer',
      contact: { name: 'Priya Nair', title: 'DevOps Engineer' },
      summary: 'Results-driven DevOps professional leveraging cutting-edge technologies to deliver robust and scalable solutions.',
      skills: [{ name: 'OpenShift' }, { name: 'Helm' }, { name: 'GitLab CI' }, { name: 'Jenkins' }, { name: 'SonarQube' }, { name: 'Veracode' }, { name: 'Nexus' }, { name: 'Java' }],
      experience: [{
        id: 'x1', company: 'Meridian Bank', role: 'DevOps Engineer',
        startDate: 'Mar 2021', current: true,
        bullets: [
          { id: 'b1', text: 'Responsible for deployment configuration of Java 17 services across OpenShift environments using Helm and ConfigMaps.' },
          { id: 'b2', text: 'Worked on GitLab CI pipelines for build, test and deployment of banking services.' },
          { id: 'b3', text: 'Integrated SonarQube and Veracode scans into the delivery workflow before release.' },
          { id: 'b4', text: 'Automated post-deployment sanity test triggering, reducing manual verification effort by 80%.' },
          { id: 'b5', text: 'Automated certificate renewal for internal service endpoints.' },
          { id: 'b6', text: 'Managed Nexus artifact repository access for four delivery teams.' },
        ],
      }, {
        id: 'x2', company: 'Cotwell IT', role: 'Build Engineer',
        startDate: 'Jul 2019', endDate: 'Feb 2021',
        bullets: [
          { id: 'b7', text: 'Maintained Jenkins jobs for nightly builds of Java applications.' },
          { id: 'b8', text: 'Documented release steps for the support team.' },
        ],
      }],
      education: [{ school: 'Pune University', degree: 'B.E. Information Technology', endDate: 'Jun 2019' }],
    }),
    jd: `Senior DevOps Engineer — Payments Platform
About the role:
You will own the delivery pipeline for our payments services running on Kubernetes.
Must have:
- 4+ years of hands-on experience with CI/CD pipelines
- Strong experience with Kubernetes or OpenShift in production
- Experience with Helm and configuration management
- Familiarity with security scanning in the delivery pipeline
Preferred:
- Experience with Terraform
- Exposure to Prometheus and Grafana for monitoring
Responsibilities:
- Automate manual release steps across environments
- Support production deployments and respond to incidents
- Work closely with development teams on release readiness`,
    job: { company: 'Kestrel Payments', title: 'Senior DevOps Engineer' },
  },

  /* ---------------------------------------------------------------- 3 */
  {
    id: 'senior_platform_engineer',
    label: 'Senior platform engineer',
    expectedFamily: 'platform',
    expectedSeniority: 'senior',
    doc: doc({
      id: 'rd_fx3', targetRole: 'Senior Platform Engineer',
      contact: { name: 'Daniel Okoye', title: 'Senior Platform Engineer' },
      summary: '',
      skills: [{ name: 'Terraform' }, { name: 'Kubernetes' }, { name: 'AWS' }, { name: 'Go' }, { name: 'ArgoCD' }, { name: 'Prometheus' }],
      experience: [{
        id: 'x1', company: 'Latchfield', role: 'Senior Platform Engineer',
        startDate: 'Feb 2020', current: true,
        bullets: [
          { id: 'b1', text: 'Designed reusable Terraform modules that 6 teams use to provision AWS accounts.' },
          { id: 'b2', text: 'Led the migration of 40 services from EC2 to Kubernetes over 3 quarters.' },
          { id: 'b3', text: 'Built a Go CLI that generates service scaffolding with monitoring and CI wired in.' },
          { id: 'b4', text: 'Established the review process for infrastructure changes across the platform team.' },
          { id: 'b5', text: 'Mentored 4 engineers on Kubernetes operations and on-call practice.' },
        ],
      }],
      education: [{ school: 'University of Lagos', degree: 'B.Sc. Computer Engineering' }],
    }),
    jd: `Staff Platform Engineer
You will set the technical direction for our internal developer platform.
Requirements:
- Deep experience with Terraform and infrastructure as code
- Production Kubernetes experience at scale
- Experience designing self-service developer tooling
- Track record of mentoring engineers and setting standards
Responsibilities:
- Design systems and make architectural decisions
- Lead or mentor other engineers
- Improve reliability and reduce operational toil`,
    job: { company: 'Corvid Cloud', title: 'Staff Platform Engineer' },
  },

  /* ---------------------------------------------------------------- 4 */
  {
    id: 'data_engineer',
    label: 'Data engineer',
    expectedFamily: 'data_engineering',
    expectedSeniority: ['mid', 'senior'],
    doc: doc({
      id: 'rd_fx4', targetRole: 'Data Engineer',
      contact: { name: 'Ana Duarte', title: 'Data Engineer' },
      summary: 'Experienced data professional with a proven track record of delivering scalable solutions.',
      skills: [{ name: 'PySpark' }, { name: 'Airflow' }, { name: 'Snowflake' }, { name: 'SQL' }, { name: 'AWS' }, { name: 'dbt' }],
      experience: [{
        id: 'x1', company: 'Volterra Retail', role: 'Data Engineer',
        startDate: 'Aug 2021', current: true,
        bullets: [
          { id: 'b1', text: 'Built PySpark ingestion jobs that load 2TB of daily transaction data into Snowflake.' },
          { id: 'b2', text: 'Orchestrated 60 Airflow DAGs with retry and backfill handling for late-arriving files.' },
          { id: 'b3', text: 'Reduced batch runtime by 35% by repartitioning the largest joins.' },
          { id: 'b4', text: 'Implemented dbt models for the sales reporting layer.' },
          { id: 'b5', text: 'Worked on data quality checks for the customer dimension.' },
        ],
      }],
      education: [{ school: 'Universidade do Porto', degree: 'M.Sc. Data Science' }],
    }),
    jd: `Data Engineer — Analytics Platform
Must have:
- Strong SQL and Python
- Hands-on experience with Spark or PySpark
- Experience with a cloud data warehouse (Snowflake, BigQuery or Redshift)
- Experience building and orchestrating data pipelines (Airflow preferred)
Preferred:
- dbt experience
- Understanding of data quality and data contracts
Responsibilities:
- Own data quality and correctness for the reporting layer
- Build and ship pipelines that serve analytics consumers`,
    job: { company: 'Halcyon Analytics', title: 'Data Engineer' },
  },

  /* ---------------------------------------------------------------- 5 */
  {
    id: 'data_scientist',
    label: 'Data scientist',
    expectedFamily: 'data_science',
    expectedSeniority: ['mid', 'senior'],
    doc: doc({
      id: 'rd_fx5', targetRole: 'Data Scientist',
      contact: { name: 'Wei Zhang', title: 'Data Scientist' },
      summary: '',
      skills: [{ name: 'Python' }, { name: 'scikit-learn' }, { name: 'pandas' }, { name: 'SQL' }, { name: 'PyTorch' }],
      experience: [{
        id: 'x1', company: 'Ondra Health', role: 'Data Scientist',
        startDate: 'Sep 2020', current: true,
        bullets: [
          { id: 'b1', text: 'Built a churn model in scikit-learn evaluated against a 6-month holdout cohort.' },
          { id: 'b2', text: 'Engineered features from appointment history and billing records in SQL.' },
          { id: 'b3', text: 'Ran an offline experiment comparing gradient boosting against the existing rules baseline.' },
          { id: 'b4', text: 'Presented model findings to the operations team every quarter.' },
        ],
      }],
      education: [{ school: 'Tsinghua University', degree: 'M.Sc. Statistics' }],
    }),
    jd: `Data Scientist — Retention
Requirements:
- Strong Python and SQL
- Experience building and evaluating machine learning models
- Comfortable with feature engineering and model evaluation
- Able to communicate findings to non-technical stakeholders
Nice to have:
- Experience with deep learning frameworks such as PyTorch`,
    job: { company: 'Brightwater', title: 'Data Scientist' },
  },

  /* ---------------------------------------------------------------- 6 */
  {
    id: 'product_manager',
    label: 'Product manager',
    expectedFamily: 'product',
    expectedSeniority: ['mid', 'senior'],
    doc: doc({
      id: 'rd_fx6', targetRole: 'Product Manager',
      contact: { name: 'Sofia Marchetti', title: 'Product Manager' },
      summary: 'Dynamic professional with a proven track record of driving innovative solutions.',
      skills: [{ name: 'Jira' }, { name: 'SQL' }, { name: 'A/B testing' }, { name: 'Figma' }],
      experience: [{
        id: 'x1', company: 'Tessella', role: 'Product Manager',
        startDate: 'Jan 2021', current: true,
        bullets: [
          { id: 'b1', text: 'Launched a self-serve onboarding flow that replaced a manual sales-assisted setup.' },
          { id: 'b2', text: 'Ran 12 customer discovery interviews before scoping the billing redesign.' },
          { id: 'b3', text: 'Defined acceptance criteria with engineering for each release.' },
          { id: 'b4', text: 'Analysed activation funnel drop-off in SQL to prioritise the roadmap.' },
        ],
      }],
      education: [{ school: 'Bocconi', degree: 'B.Sc. Economics' }],
    }),
    jd: `Product Manager — Growth
Requirements:
- 3+ years of product management experience
- Comfortable analysing product data and running experiments
- Experience with customer discovery and requirement definition
- Strong stakeholder communication
Responsibilities:
- Own the roadmap for the activation funnel
- Work with stakeholders and communicate outcomes`,
    job: { company: 'Fernpath', title: 'Product Manager, Growth' },
  },

  /* ---------------------------------------------------------------- 7 */
  {
    id: 'finance_analyst',
    label: 'Finance analyst',
    expectedFamily: 'finance',
    expectedSeniority: ['mid', 'senior'],
    doc: doc({
      id: 'rd_fx7', targetRole: 'Financial Analyst',
      contact: { name: 'Grace Whitfield', title: 'Financial Analyst' },
      summary: '',
      skills: [{ name: 'Excel' }, { name: 'SQL' }, { name: 'Power BI' }],
      experience: [{
        id: 'x1', company: 'Calder Group', role: 'Financial Analyst',
        startDate: 'Apr 2020', current: true,
        bullets: [
          { id: 'b1', text: 'Built the rolling 13-week cash forecast used by treasury each Monday.' },
          { id: 'b2', text: 'Reconciled intercompany balances across 8 entities during month-end close.' },
          { id: 'b3', text: 'Analysed variance between budget and actuals for three cost centres.' },
          { id: 'b4', text: 'Automated the reporting pack in Power BI, replacing a manual Excel process.' },
        ],
      }],
      education: [{ school: 'University of Leeds', degree: 'BA Accounting and Finance' }],
    }),
    jd: `Financial Analyst — FP&A
Requirements:
- Strong Excel modelling skills
- Experience with month-end close and reconciliations
- Variance analysis and budgeting experience
- Ability to present findings to business stakeholders
Preferred:
- SQL or Power BI experience`,
    job: { company: 'Rowan Industrial', title: 'Financial Analyst' },
  },

  /* ---------------------------------------------------------------- 8 */
  {
    id: 'marketing_manager',
    label: 'Marketing manager',
    expectedFamily: 'marketing',
    expectedSeniority: ['mid', 'senior'],
    doc: doc({
      id: 'rd_fx8', targetRole: 'Marketing Manager',
      contact: { name: 'Tom Alvarez', title: 'Marketing Manager' },
      summary: 'Results-driven marketing professional passionate about game-changing campaigns.',
      skills: [{ name: 'SEO' }, { name: 'Google Analytics' }, { name: 'HubSpot' }],
      experience: [{
        id: 'x1', company: 'Larkspur', role: 'Marketing Manager',
        startDate: 'Feb 2021', current: true,
        bullets: [
          { id: 'b1', text: 'Ran the lifecycle email programme across 4 audience segments in HubSpot.' },
          { id: 'b2', text: 'Rebuilt the pricing landing page and A/B tested three headline variants.' },
          { id: 'b3', text: 'Worked on SEO content briefs for the product blog.' },
          { id: 'b4', text: 'Reported channel performance monthly using Google Analytics.' },
        ],
      }],
      education: [{ school: 'Universidad de Sevilla', degree: 'BA Marketing' }],
    }),
    jd: `Marketing Manager — Demand Generation
Requirements:
- Experience running lifecycle and email campaigns
- Landing page optimisation and A/B testing
- Comfortable reporting on channel performance
Nice to have:
- SEO content experience
- HubSpot or similar marketing automation platform`,
    job: { company: 'Quillon', title: 'Marketing Manager' },
  },

  /* ---------------------------------------------------------------- 9 */
  {
    id: 'mechanical_engineer',
    label: 'Mechanical engineer',
    expectedFamily: 'mechanical',
    expectedSeniority: ['mid', 'senior'],
    doc: doc({
      id: 'rd_fx9', targetRole: 'Mechanical Design Engineer',
      contact: { name: 'Ishaan Batra', title: 'Mechanical Design Engineer' },
      summary: '',
      skills: [{ name: 'SolidWorks' }, { name: 'AutoCAD' }, { name: 'ANSYS' }],
      experience: [{
        id: 'x1', company: 'Vanguard Pumps', role: 'Design Engineer',
        startDate: 'Jul 2019', current: true,
        bullets: [
          { id: 'b1', text: 'Designed the impeller housing assembly in SolidWorks for a 3-model pump range.' },
          { id: 'b2', text: 'Ran finite element analysis in ANSYS for two load cases before the design freeze.' },
          { id: 'b3', text: 'Released production drawings and the bill of materials to manufacturing.' },
          { id: 'b4', text: 'Resolved a tolerance stack-up issue that was causing assembly rework.' },
        ],
      }],
      education: [{ school: 'NIT Trichy', degree: 'B.Tech Mechanical Engineering' }],
    }),
    jd: `Mechanical Design Engineer
Requirements:
- Proficiency in SolidWorks or equivalent 3D CAD
- Experience producing production drawings and BOMs
- Familiarity with FEA and tolerance analysis
- Experience working with manufacturing teams`,
    job: { company: 'Arden Flow', title: 'Mechanical Design Engineer' },
  },

  /* --------------------------------------------------------------- 10 */
  {
    id: 'weak_resume',
    label: 'Candidate with a weak resume',
    expectedFamily: 'general',
    expectedSeniority: ['early', 'mid'],
    doc: doc({
      id: 'rd_fx10', targetRole: 'IT Support Engineer',
      contact: { name: 'Marcus Reed', title: 'IT Support' },
      summary: 'Hard-working team player with excellent communication skills and a passion for technology.',
      skills: [{ name: 'Windows' }, { name: 'Active Directory' }],
      experience: [{
        id: 'x1', company: 'Peridot Services', role: 'IT Support Engineer',
        startDate: 'Jun 2022', current: true,
        bullets: [
          { id: 'b1', text: 'Responsible for various day-to-day tasks.' },
          { id: 'b2', text: 'Helped with different projects as required.' },
          { id: 'b3', text: 'Worked on tickets.' },
          { id: 'b4', text: 'Involved in team meetings and other activities.' },
        ],
      }],
      education: [{ school: 'Leeds City College', degree: 'HND Computing' }],
    }),
    jd: `IT Support Engineer
Requirements:
- Experience supporting Windows desktops
- Active Directory user administration
- Ticket queue management and SLA awareness
- Good communication with non-technical users`,
    job: { company: 'Grendon Facilities', title: 'IT Support Engineer' },
  },

  /* --------------------------------------------------------------- 11 */
  {
    id: 'excellent_resume',
    label: 'Candidate with an already-excellent resume',
    expectedFamily: 'backend',
    expectedSeniority: 'senior',
    doc: doc({
      id: 'rd_fx11', targetRole: 'Senior Backend Engineer',
      contact: { name: 'Helena Brandt', title: 'Senior Backend Engineer' },
      summary: 'Backend engineer working on high-throughput payment services in Go and Java, with a focus on transaction correctness and API contracts.',
      skills: [{ name: 'Go' }, { name: 'Java' }, { name: 'PostgreSQL' }, { name: 'Kafka' }, { name: 'gRPC' }, { name: 'Redis' }],
      experience: [{
        id: 'x1', company: 'Ostara Pay', role: 'Senior Backend Engineer',
        startDate: 'Mar 2019', current: true,
        bullets: [
          { id: 'b1', text: 'Rebuilt the settlement service in Go, moving reconciliation from nightly batch to a Kafka consumer.' },
          { id: 'b2', text: 'Introduced idempotency keys across 9 payment endpoints, eliminating duplicate-charge incidents.' },
          { id: 'b3', text: 'Cut p99 authorisation latency from 480ms to 120ms by adding a Redis lookup cache and removing a synchronous fraud call.' },
          { id: 'b4', text: 'Designed the gRPC contract between the ledger and settlement services, including versioning rules.' },
          { id: 'b5', text: 'Led incident response for two production settlement failures and wrote both postmortems.' },
        ],
      }],
      education: [{ school: 'TU Munich', degree: 'M.Sc. Informatics' }],
    }),
    jd: `Senior Backend Engineer — Payments
Must have:
- Strong Go or Java in production
- Experience with distributed systems and event streaming (Kafka)
- API design experience including versioning
- Experience with PostgreSQL at scale
Responsibilities:
- Design systems and make architectural decisions
- Operate and support production systems, including on-call
- Improve reliability and performance`,
    job: { company: 'Solvent Rails', title: 'Senior Backend Engineer' },
  },

  /* --------------------------------------------------------------- 12 */
  {
    id: 'career_transition',
    label: 'Career transition (QA → data engineering)',
    /* Vocabulary follows the TARGET — the reader is hiring a data engineer.
       The QA history is still exactly what the sentences are built from. */
    expectedFamily: 'data_engineering',
    expectedEvidenceFamily: 'qa',
    expectedSeniority: 'mid',
    doc: doc({
      id: 'rd_fx12', targetRole: 'Data Engineer',
      contact: { name: 'Nadia Farouk', title: 'QA Automation Engineer' },
      summary: '',
      skills: [{ name: 'Python' }, { name: 'SQL' }, { name: 'Selenium' }, { name: 'Jenkins' }, { name: 'pandas' }],
      experience: [{
        id: 'x1', company: 'Aldergate Software', role: 'QA Automation Engineer',
        startDate: 'May 2020', current: true,
        bullets: [
          { id: 'b1', text: 'Built a Python regression suite covering 240 test cases across 4 products.' },
          { id: 'b2', text: 'Wrote SQL validation queries that compare source and reported figures after each release.' },
          { id: 'b3', text: 'Automated nightly test execution in Jenkins with failure reporting to Slack.' },
          { id: 'b4', text: 'Analysed test result trends in pandas to find the flakiest suites.' },
        ],
      }],
      projects: [{
        id: 'p1', name: 'Retail Sales Pipeline', techStack: 'Python, SQL, Airflow',
        bullets: [{ id: 'pb1', text: 'Built an Airflow pipeline that loads a public retail dataset into PostgreSQL and produces a daily summary table.' }],
      }],
      education: [{ school: 'Cairo University', degree: 'B.Sc. Computer Science' }],
    }),
    jd: `Data Engineer
Must have:
- Strong SQL and Python
- Experience building data pipelines
- Understanding of data quality and validation
Preferred:
- Airflow experience
- Experience with a cloud data warehouse such as Snowflake
- Spark experience`,
    job: { company: 'Northgate Data', title: 'Data Engineer' },
  },
];

export function fixtureById(id) {
  return FIXTURES.find((f) => f.id === id) || null;
}

export default { FIXTURES, fixtureById };
