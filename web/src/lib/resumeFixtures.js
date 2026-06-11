/* ============================================================================
   resumeFixtures.js — sample resume fixtures for the Template Lab + tests
   ----------------------------------------------------------------------------
   Every template must render every fixture without overlap, cropping or
   broken page splits. These are deliberately varied: short fresher, mid-level,
   senior long, DevOps, project-heavy student, overlong skill dump, missing
   sections, and pathological long names/URLs.
   ========================================================================== */

export const RESUME_FIXTURES = [
  {
    id: 'fresher-short',
    name: 'Fresher — short resume',
    data: {
      personalInfo: { name: 'Aarav Sharma', title: 'Computer Science Graduate', email: 'aarav.sharma@email.com', phone: '+91 98765 43210', location: 'Pune, India', github: 'github.com/aaravs' },
      summary: 'Final-year CS student with hands-on full-stack projects and two hackathon wins, looking for an SDE-1 role.',
      skills: { languages: ['Python', 'JavaScript', 'C++'], frontend: ['React', 'HTML', 'CSS'], backend: ['Node.js', 'Express'], databases: ['MongoDB', 'MySQL'], tools: ['Git', 'Postman'] },
      experience: [],
      projects: [
        { name: 'CampusConnect', techStack: 'React, Node.js, MongoDB', link: '', bullets: ['Built a campus event platform used by 1,200+ students.', 'Implemented JWT auth and role-based access for organisers.'] },
        { name: 'ExpenseLens', techStack: 'Python, Flask', link: '', bullets: ['Created an OCR expense tracker that parses receipts with 92% accuracy.'] },
      ],
      education: [{ school: 'Savitribai Phule Pune University', degree: 'B.E. Computer Engineering — CGPA 8.7/10', dates: '2022 – 2026', details: [] }],
      certifications: ['AWS Cloud Practitioner (2025)'],
      achievements: ['Winner — Smart India Hackathon 2025', 'Runner-up — HackMIT online track'],
    },
  },
  {
    id: 'mid-developer',
    name: 'Mid-level software engineer',
    data: {
      personalInfo: { name: 'Priya Nair', title: 'Full-Stack Developer', email: 'priya.nair@email.com', phone: '+91 91234 56780', location: 'Bengaluru, India', linkedin: 'linkedin.com/in/priyanair', github: 'github.com/priyan' },
      summary: 'Full-stack developer with 4 years building SaaS products in React and Node.js. Shipped features used by 200k+ monthly users and cut page load times by 45%.',
      skills: { languages: ['JavaScript', 'TypeScript', 'SQL'], frontend: ['React', 'Next.js', 'Tailwind CSS'], backend: ['Node.js', 'Express', 'GraphQL'], cloud: ['AWS', 'S3', 'Lambda'], databases: ['PostgreSQL', 'Redis'], tools: ['Git', 'Jest', 'Playwright'] },
      experience: [
        { role: 'Software Engineer II', company: 'FlowDesk', location: 'Bengaluru', dates: 'Jun 2023 – Present', bullets: ['Led migration of the billing dashboard to Next.js, improving LCP from 4.1s to 1.8s.', 'Designed a GraphQL gateway consolidating 7 internal REST services.', 'Mentored 3 junior engineers; introduced PR review checklists that cut regressions 30%.'] },
        { role: 'Software Engineer', company: 'BrightCart', location: 'Remote', dates: 'Jul 2021 – May 2023', bullets: ['Built the seller analytics module (React + D3) used by 40k merchants.', 'Reduced API p95 latency from 900ms to 320ms with Redis caching.'] },
      ],
      projects: [{ name: 'OpenShelf', techStack: 'Next.js, Supabase', link: 'openshelf.dev', bullets: ['Open-source library inventory tool with 800+ GitHub stars.'] }],
      education: [{ school: 'NIT Calicut', degree: 'B.Tech Computer Science', dates: '2017 – 2021', details: [] }],
      certifications: ['AWS Solutions Architect Associate'],
      achievements: ['Speaker — React India 2025'],
    },
  },
  {
    id: 'devops-cloud',
    name: 'DevOps / Cloud engineer',
    data: {
      personalInfo: { name: 'Rahul Verma', title: 'DevOps Engineer', email: 'rahul.verma@email.com', phone: '+91 99887 76655', location: 'Hyderabad, India', linkedin: 'linkedin.com/in/rahulv' },
      summary: 'DevOps engineer with 5 years automating cloud infrastructure. Own CI/CD for 30+ services, manage multi-region Kubernetes clusters and led incident response for a 99.95% SLA platform.',
      skills: {
        cloud: ['AWS', 'EKS', 'S3', 'Lambda', 'CloudFormation', 'Route53'],
        devops: ['Docker', 'Kubernetes', 'Helm', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'ArgoCD', 'Prometheus', 'Grafana', 'Linux'],
        languages: ['Python', 'Bash', 'Go'],
        databases: ['PostgreSQL', 'Redis', 'DynamoDB'],
        other: ['Vault', 'IAM', 'Trivy'],
      },
      experience: [
        { role: 'Senior DevOps Engineer', company: 'SkyLattice', location: 'Hyderabad', dates: 'Mar 2023 – Present', bullets: ['Own release pipeline for 30+ microservices; deploy frequency up from weekly to 12/day.', 'Migrated workloads to EKS with Terraform + Helm, cutting infra cost 28%.', 'Built Prometheus/Grafana observability stack; MTTR down from 90 to 22 minutes.', 'Led incident command for SEV-1s; wrote postmortem playbooks adopted org-wide.'] },
        { role: 'DevOps Engineer', company: 'CloudMint', location: 'Remote', dates: 'Aug 2020 – Feb 2023', bullets: ['Automated environment provisioning with Ansible — onboarding time from 3 days to 2 hours.', 'Hardened CI with SAST/Trivy scans, blocking 40+ vulnerable builds per quarter.'] },
      ],
      projects: [{ name: 'kube-sentry', techStack: 'Go, Kubernetes operators', link: 'github.com/rahulv/kube-sentry', bullets: ['Open-source operator that auto-remediates crash-looping pods.'] }],
      education: [{ school: 'JNTU Hyderabad', degree: 'B.Tech Information Technology', dates: '2014 – 2018', details: [] }],
      certifications: ['CKA — Certified Kubernetes Administrator', 'AWS DevOps Engineer Professional'],
      achievements: [],
    },
  },
  {
    id: 'senior-long',
    name: 'Senior engineer — long resume',
    data: {
      personalInfo: { name: 'Meera Krishnan', title: 'Staff Software Engineer', email: 'meera.k@email.com', phone: '+91 90909 80808', location: 'Chennai, India', linkedin: 'linkedin.com/in/meerak', github: 'github.com/meerak' },
      summary: 'Staff engineer with 11 years across fintech and infrastructure. Designed systems handling 80M+ daily transactions, led teams of up to 12, and drove architecture decisions that saved $1.2M/yr. Deep in distributed systems, event-driven design and platform reliability.',
      skills: { languages: ['Java', 'Kotlin', 'Python', 'SQL'], backend: ['Spring Boot', 'Kafka', 'gRPC', 'Microservices'], cloud: ['AWS', 'GCP'], devops: ['Kubernetes', 'Terraform', 'Datadog'], databases: ['PostgreSQL', 'Cassandra', 'Redis'], aiMl: ['Feature stores', 'Vertex AI'], tools: ['Git', 'Bazel'] },
      experience: [
        { role: 'Staff Engineer — Payments Platform', company: 'FinEdge', location: 'Chennai', dates: '2022 – Present', bullets: ['Architected the ledger rewrite to event sourcing on Kafka — 80M tx/day at p99 under 120ms.', 'Led cross-team design reviews; established RFC process adopted by 9 teams.', 'Mentored 6 senior engineers; 3 promoted to staff/lead within 2 years.', 'Drove multi-region failover design; achieved RTO of 4 minutes in chaos drills.', 'Owned release governance for the payments domain, cutting change-failure rate 35%.'] },
        { role: 'Engineering Lead', company: 'PayOrbit', location: 'Bengaluru', dates: '2018 – 2022', bullets: ['Built and led a 12-person team owning settlement and reconciliation services.', 'Delivered UPI integration handling ₹400 crore monthly volume within regulatory deadlines.', 'Reduced infra spend 22% via workload right-sizing and spot adoption.', 'Introduced SLO-driven on-call; paging volume dropped 60%.'] },
        { role: 'Senior Software Engineer', company: 'TazzaPay', location: 'Chennai', dates: '2015 – 2018', bullets: ['Designed idempotent payment APIs that eliminated double-charge incidents.', 'Migrated monolith modules to services with zero-downtime cutovers.'] },
        { role: 'Software Engineer', company: 'Infonova', location: 'Chennai', dates: '2013 – 2015', bullets: ['Built telecom billing batch pipelines processing 5M records nightly.'] },
      ],
      projects: [
        { name: 'ledger-bench', techStack: 'Java, Kafka', link: 'github.com/meerak/ledger-bench', bullets: ['Benchmark harness for event-sourced ledgers, used in 2 conference talks.'] },
      ],
      education: [{ school: 'Anna University', degree: 'B.E. Computer Science', dates: '2009 – 2013', details: [] }],
      certifications: ['AWS Solutions Architect Professional'],
      achievements: ['Built architecture guild covering 60+ engineers', 'Keynote — Distributed Systems Conf India 2024', 'Filed 2 patents on settlement netting algorithms'],
      publications: ['“Exactly-once settlement at scale”, InfoQ, 2024'],
      patents: ['IN-4521xx — Netting engine for multi-rail settlement (pending)'],
    },
  },
  {
    id: 'student-project-heavy',
    name: 'Project-heavy student',
    data: {
      personalInfo: { name: 'Ishaan Patel', title: 'B.Tech Student — AI/ML', email: 'ishaan.p@email.com', phone: '+91 95555 12345', location: 'Ahmedabad, India', github: 'github.com/ishaanp' },
      summary: 'Third-year AI/ML student who ships projects: 7 deployed apps, 3 hackathon wins, 1 research internship.',
      skills: { languages: ['Python', 'JavaScript'], aiMl: ['PyTorch', 'scikit-learn', 'LangChain', 'OpenCV'], frontend: ['React'], backend: ['FastAPI'], databases: ['PostgreSQL'], tools: ['Git', 'Docker'] },
      experience: [{ role: 'Research Intern', company: 'IIT Gandhinagar — Vision Lab', location: 'Gandhinagar', dates: 'May 2025 – Jul 2025', bullets: ['Improved crowd-counting model MAE by 11% with density-aware augmentation.'] }],
      projects: [
        { name: 'SignSpeak', techStack: 'PyTorch, MediaPipe', link: 'signspeak.app', bullets: ['Real-time sign-language translator; 94% accuracy on 60-gesture set.', 'Won Smart India Hackathon 2025 (team of 4, led ML).'] },
        { name: 'AgriScan', techStack: 'FastAPI, OpenCV', link: '', bullets: ['Leaf-disease detector used in a 200-farmer pilot in Gujarat.'] },
        { name: 'NoteWeave', techStack: 'React, LangChain', link: 'github.com/ishaanp/noteweave', bullets: ['RAG note-search over personal PDFs; 1.1k GitHub stars.'] },
        { name: 'QuizForge', techStack: 'Next.js', link: '', bullets: ['Auto-generates quizzes from lecture slides; used by 2 professors.'] },
        { name: 'TrackMyBus', techStack: 'React Native', link: '', bullets: ['Live campus bus tracker with 900 daily users.'] },
      ],
      education: [{ school: 'Nirma University', degree: 'B.Tech CSE (AI/ML) — CGPA 9.1', dates: '2023 – 2027', details: [] }],
      certifications: ['DeepLearning.AI ML Specialization'],
      achievements: ['3× hackathon winner', 'Top 500 — Google Code Jam farewell round'],
    },
  },
  {
    id: 'overlong-skill-dump',
    name: 'Overlong resume — too many skills',
    data: {
      personalInfo: { name: 'Vikram Singh', title: 'Software Engineer', email: 'vikram.s@email.com', phone: '+91 90000 11111', location: 'Delhi, India' },
      summary: 'Highly motivated, hardworking, detail-oriented team player and results-driven dynamic professional passionate about technology, seeking a challenging role to leverage my extensive cross-functional multi-domain experience across the entire software development lifecycle including planning, analysis, design, development, testing, deployment, maintenance and support of enterprise applications.',
      skills: {
        languages: ['Java', 'Python', 'JavaScript', 'TypeScript', 'C', 'C++', 'C#', 'Go', 'Rust', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'Scala', 'Perl', 'R'],
        frontend: ['React', 'Angular', 'Vue', 'Svelte', 'jQuery', 'Bootstrap', 'Tailwind CSS', 'Material UI'],
        backend: ['Node.js', 'Express', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Rails', 'Laravel'],
        cloud: ['AWS', 'Azure', 'GCP', 'Heroku', 'DigitalOcean', 'Netlify', 'Vercel'],
        devops: ['Docker', 'Kubernetes', 'Jenkins', 'Terraform', 'Ansible', 'Puppet', 'Chef', 'Nagios'],
        databases: ['MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Cassandra', 'Oracle', 'SQLite', 'DynamoDB'],
        aiMl: ['TensorFlow', 'PyTorch', 'Keras', 'OpenCV'],
        tools: ['Git', 'SVN', 'Jira', 'Confluence', 'Postman', 'Figma'],
      },
      experience: [
        { role: 'Software Engineer', company: 'MegaCorp Solutions', location: 'Delhi', dates: '2019 – Present', bullets: ['Responsible for development of various modules.', 'Worked on bug fixing and improving application performance.', 'Involved in all phases of the project lifecycle.', 'Coordinated with cross-functional teams for timely delivery.', 'Participated in code reviews and team meetings.', 'Handled client communication and requirement gathering.', 'Prepared documentation for all delivered features.', 'Supported production issues and on-call rotations.'] },
        { role: 'Junior Developer', company: 'TechWave Infosystems', location: 'Noida', dates: '2017 – 2019', bullets: ['Worked on web application development.', 'Assisted senior developers in module implementation.', 'Performed unit testing of developed components.', 'Maintained legacy codebases across multiple clients.'] },
      ],
      projects: [],
      education: [{ school: 'Delhi Technological University', degree: 'B.Tech', dates: '2013 – 2017', details: [] }],
      certifications: ['Oracle Certified Java Programmer', 'Scrum Fundamentals', 'Azure Fundamentals AZ-900', 'Google Cloud Digital Leader'],
      achievements: ['Employee of the month (×3)', 'Best team award 2021', 'Spot award 2022', 'Star performer 2023'],
    },
  },
  {
    id: 'missing-sections',
    name: 'Missing-section resume',
    data: {
      personalInfo: { name: 'Neha Gupta', title: '', email: 'neha.g@email.com', phone: '', location: '', linkedin: '', github: '' },
      summary: '',
      skills: { languages: ['Python'], tools: ['Excel'] },
      experience: [{ role: 'Data Analyst', company: 'RetailIQ', location: '', dates: '2024 – Present', bullets: ['Built weekly sales dashboards for 3 regional teams.'] }],
      projects: [],
      education: [],
      certifications: [],
      achievements: [],
    },
  },
  {
    id: 'long-names-urls',
    name: 'Very long project names & URLs',
    data: {
      personalInfo: { name: 'Dr. Subrahmanyam Venkata Naga Sai Krishnamurthy Iyer-Raghunathan', title: 'Principal Research Engineer — Distributed Intelligent Systems', email: 'subrahmanyam.krishnamurthy.iyer.raghunathan@very-long-university-domain.ac.in', phone: '+91 98989 87878', location: 'Thiruvananthapuram, Kerala, India', portfolio: 'https://research-portfolio.very-long-university-domain.ac.in/~skiyer/projects/distributed-systems/publications-and-artifacts/index.html' },
      summary: 'Research engineer focused on planetary-scale coordination protocols and verifiable distributed machine learning systems.',
      skills: { languages: ['Rust', 'Python'], backend: ['gRPC'], aiMl: ['PyTorch'], tools: ['Git'] },
      experience: [{ role: 'Principal Research Engineer', company: 'Centre for Computational Systems and Verified Intelligence Infrastructure Research', location: 'Thiruvananthapuram', dates: '2020 – Present', bullets: ['Published 14 peer-reviewed papers on byzantine-fault-tolerant federated optimisation under partial synchrony assumptions with heterogeneous stragglers.'] }],
      projects: [
        { name: 'HeterogeneousByzantineFaultTolerantFederatedGradientCompressionFramework-Reference-Implementation', techStack: 'Rust, gRPC, PyTorch', link: 'https://github.com/skiyer-research-group/heterogeneous-byzantine-fault-tolerant-federated-gradient-compression-framework-reference-implementation', bullets: ['Reference implementation accompanying the NeurIPS 2025 paper; reproduces all 17 benchmark configurations.'] },
      ],
      education: [{ school: 'Indian Institute of Science, Bengaluru', degree: 'Ph.D. Distributed Systems', dates: '2012 – 2018', details: [] }],
      certifications: [],
      achievements: ['Best paper award — Symposium on Operating Systems Principles for Resource-Constrained Planetary-Scale Deployments, 2024'],
      publications: ['“Verifiable aggregation for stragglers”, NeurIPS 2025'],
    },
  },
];

export function getResumeFixture(id) {
  return RESUME_FIXTURES.find((f) => f.id === id) || RESUME_FIXTURES[0];
}
