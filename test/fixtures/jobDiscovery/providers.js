/* ============================================================
   JOB DISCOVERY OS — PROVIDER FIXTURES  (§52)
   ------------------------------------------------------------
   Sanitized, hand-authored payloads in each provider's real
   response SHAPE. No network access is required by any test that
   uses them, and no live tenant is embedded as if it were a
   user-facing employer.

   Company names are deliberately fictional.
   ============================================================ */

/* ------------------------------ Greenhouse ------------------------------ */

export const greenhouseBoard = {
  jobs: [
    {
      id: 4118821,
      internal_job_id: 3011,
      title: 'Senior Platform Engineer',
      updated_at: '2026-08-12T09:14:02-04:00',
      first_published: '2026-08-11T10:00:00-04:00',
      requisition_id: 'REQ-8841',
      absolute_url: 'https://boards.greenhouse.io/northwindlabs/jobs/4118821',
      location: { name: 'Bengaluru, India' },
      offices: [{ id: 1, name: 'Bengaluru' }],
      departments: [{ id: 9, name: 'Infrastructure' }],
      metadata: [
        { id: 1, name: 'Employment Type', value: 'Full-time', value_type: 'single_select' },
        { id: 2, name: 'Remote', value: 'No', value_type: 'yes_no' },
      ],
      content: '&lt;p&gt;We are hiring a Senior Platform Engineer to own our Kubernetes platform, Terraform modules and internal developer tooling. You will run the CI/CD estate and the service mesh.&lt;/p&gt;&lt;p&gt;Requirements: 5+ years operating production Kubernetes, strong Terraform, Go or Python.&lt;/p&gt;',
    },
    {
      id: 4118822,
      title: 'Senior Platform Engineer',
      updated_at: '2026-08-12T09:14:02-04:00',
      first_published: '2026-08-11T10:00:00-04:00',
      requisition_id: 'REQ-8842',
      absolute_url: 'https://boards.greenhouse.io/northwindlabs/jobs/4118822',
      location: { name: 'London, United Kingdom' },
      offices: [{ id: 2, name: 'London' }],
      departments: [{ id: 9, name: 'Infrastructure' }],
      metadata: [],
      /* Deliberately IDENTICAL description to the Bengaluru role — the dedupe
         engine must still keep them separate (§20.1). */
      content: '&lt;p&gt;We are hiring a Senior Platform Engineer to own our Kubernetes platform, Terraform modules and internal developer tooling. You will run the CI/CD estate and the service mesh.&lt;/p&gt;&lt;p&gt;Requirements: 5+ years operating production Kubernetes, strong Terraform, Go or Python.&lt;/p&gt;',
    },
    {
      id: 4118823,
      title: 'Data Engineer',
      updated_at: '2026-08-13T11:00:00-04:00',
      /* No first_published — the board never stated a publication date.
         sourcePublishedAt MUST stay null (§3, §58). */
      first_published: null,
      requisition_id: null,
      absolute_url: 'https://boards.greenhouse.io/northwindlabs/jobs/4118823',
      location: { name: 'Remote - India' },
      offices: [],
      departments: [{ id: 4, name: 'Data' }],
      metadata: [{ id: 2, name: 'Remote', value: 'Yes', value_type: 'yes_no' }],
      content: '&lt;p&gt;Build and operate batch and streaming pipelines on Spark and Airflow. Own the warehouse models and the data quality checks.&lt;/p&gt;',
    },
  ],
  meta: { total: 3 },
};

/* -------------------------------- Lever -------------------------------- */

export const leverPostings = [
  {
    id: 'a7f3c9d1-2b44-4e0a-9c11-6f2d8e5b7a31',
    text: 'Backend Engineer, Payments',
    hostedUrl: 'https://jobs.lever.co/harborstack/a7f3c9d1-2b44-4e0a-9c11-6f2d8e5b7a31',
    applyUrl: 'https://jobs.lever.co/harborstack/a7f3c9d1-2b44-4e0a-9c11-6f2d8e5b7a31/apply',
    createdAt: 1786406400000,
    workplaceType: 'hybrid',
    categories: { commitment: 'Full-time', department: 'Engineering', team: 'Payments', location: 'Pune, India' },
    descriptionPlain: 'Design and build payment services in Java and Spring Boot. Own reliability, idempotency and reconciliation for high-volume flows.',
    description: '<p>Design and build payment services in Java and Spring Boot.</p>',
    additionalPlain: 'Requirements: 4+ years Java, Spring Boot, PostgreSQL, Kafka.',
    salaryRange: { min: 2500000, max: 4000000, currency: 'INR', interval: 'per-year-salary' },
  },
  {
    id: 'b8e4d0c2-3c55-4f1b-8d22-7a3e9f6c8b42',
    text: 'Site Reliability Engineer',
    hostedUrl: 'https://jobs.lever.co/harborstack/b8e4d0c2-3c55-4f1b-8d22-7a3e9f6c8b42',
    applyUrl: 'https://jobs.lever.co/harborstack/b8e4d0c2-3c55-4f1b-8d22-7a3e9f6c8b42/apply',
    createdAt: 1786233600000,
    workplaceType: 'remote',
    categories: { commitment: 'Full-time', department: 'Engineering', team: 'Platform', location: 'Remote - US' },
    descriptionPlain: 'Own SLOs, incident response and the observability stack. Reduce toil through automation.',
    additionalPlain: 'This role is open to candidates located in the United States only.',
  },
];

/* -------------------------------- Ashby -------------------------------- */

export const ashbyBoard = {
  organizationName: 'Vellum Systems',
  jobs: [
    {
      id: 'e1a2b3c4-d5e6-4f70-8901-234567890abc',
      title: 'DevOps Engineer',
      location: 'Remote, India',
      secondaryLocations: [],
      department: 'Engineering',
      team: 'Infrastructure',
      isListed: true,
      isRemote: true,
      employmentType: 'FullTime',
      publishedAt: '2026-08-13T06:30:00.000Z',
      jobUrl: 'https://jobs.ashbyhq.com/vellumsystems/e1a2b3c4-d5e6-4f70-8901-234567890abc',
      applyUrl: 'https://jobs.ashbyhq.com/vellumsystems/e1a2b3c4-d5e6-4f70-8901-234567890abc/application',
      descriptionPlain: 'Run our CI/CD pipelines, Kubernetes clusters and Terraform estate. Improve deployment frequency and reduce change failure rate.',
      descriptionHtml: '<p>Run our CI/CD pipelines, Kubernetes clusters and Terraform estate.</p>',
      compensation: {
        compensationTierSummary: '₹18L – ₹28L',
        compensationTiers: [{
          id: 't1',
          title: 'India',
          components: [{
            compensationType: 'Salary', interval: 'YEAR',
            currencyCode: 'INR', minValue: 1800000, maxValue: 2800000,
          }],
        }],
      },
    },
    {
      id: 'f2b3c4d5-e6f7-4081-9012-345678901bcd',
      title: 'Product Manager, Growth',
      location: 'Bengaluru',
      department: 'Product',
      isListed: true,
      isRemote: false,
      employmentType: 'FullTime',
      publishedAt: '2026-08-09T08:00:00.000Z',
      jobUrl: 'https://jobs.ashbyhq.com/vellumsystems/f2b3c4d5-e6f7-4081-9012-345678901bcd',
      applyUrl: 'https://jobs.ashbyhq.com/vellumsystems/f2b3c4d5-e6f7-4081-9012-345678901bcd/application',
      descriptionPlain: 'Own the activation and retention roadmap. Partner with design and data to run experiments end to end.',
    },
    {
      id: 'unlisted-0000-0000-0000-000000000000',
      title: 'Confidential Search',
      location: 'Bengaluru',
      isListed: false,
      jobUrl: 'https://jobs.ashbyhq.com/vellumsystems/unlisted',
      descriptionPlain: 'Should never be ingested — the board marks it unlisted.',
    },
  ],
};

/* ------------------------------- Workable ------------------------------- */

export const workableAccount = {
  name: 'Corvid Analytics',
  description: 'Analytics for logistics.',
  jobs: [
    {
      id: 9001,
      shortcode: 'A1B2C3D4E5',
      code: 'CA-DE-2026-14',
      title: 'Data Engineer',
      employment_type: 'Full-time',
      telecommuting: true,
      department: 'Engineering',
      url: 'https://apply.workable.com/corvidanalytics/j/A1B2C3D4E5/',
      application_url: 'https://apply.workable.com/corvidanalytics/j/A1B2C3D4E5/apply/',
      published_on: '2026-08-10',
      created_at: '2026-08-08',
      country: 'India',
      city: 'Remote',
      state: '',
      description: '<p>Build ELT pipelines with dbt and Snowflake. Own data contracts with upstream services.</p>',
      requirements: '<p>3+ years SQL and Python. Airflow experience preferred.</p>',
      benefits: '<p>Remote-first within India.</p>',
    },
    {
      id: 9002,
      shortcode: 'F6G7H8I9J0',
      title: 'Marketing Manager',
      employment_type: 'Full-time',
      telecommuting: false,
      department: 'Marketing',
      url: 'https://apply.workable.com/corvidanalytics/j/F6G7H8I9J0/',
      published_on: '2026-07-28',
      country: 'India',
      city: 'Mumbai',
      description: '<p>Own demand generation across paid, lifecycle and content. Report on pipeline contribution.</p>',
    },
  ],
};

/* --------------------------- SmartRecruiters --------------------------- */

export const smartRecruitersPostings = {
  offset: 0,
  limit: 100,
  totalFound: 1,
  content: [
    {
      id: 'sr-7f4e2a10-9c3b-4d51-8e26-1a2b3c4d5e6f',
      name: 'Java Backend Engineer',
      refNumber: 'SR-2026-4471',
      releasedDate: '2026-08-12T11:45:00.000Z',
      company: { identifier: 'FernwoodTech', name: 'Fernwood Tech' },
      location: { city: 'Bengaluru', region: 'Karnataka', country: 'in', remote: false },
      typeOfEmployment: { id: 'PERMANENT', label: 'Full-time' },
      department: { label: 'Engineering' },
      applyUrl: 'https://jobs.smartrecruiters.com/FernwoodTech/sr-7f4e2a10-9c3b-4d51-8e26-1a2b3c4d5e6f',
      ref: 'https://jobs.smartrecruiters.com/FernwoodTech/sr-7f4e2a10-9c3b-4d51-8e26-1a2b3c4d5e6f',
      jobAd: {
        sections: {
          jobDescription: { title: 'Job Description', text: '<p>Build Spring Boot microservices for our lending platform. Own service design, testing and rollout.</p>' },
          qualifications: { title: 'Qualifications', text: '<p>4+ years Java, Spring Boot, JPA, Kafka.</p>' },
        },
      },
    },
  ],
};

/* --------------------------- career-site HTML --------------------------- */

export const jsonLdCareerPage = `<!doctype html>
<html><head>
<title>Careers — Alderman Foods</title>
<link rel="canonical" href="https://careers.aldermanfoods.example/jobs/support-engineer-1042" />
<meta property="og:site_name" content="Alderman Foods" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Remote Support Engineer",
  "identifier": { "@type": "PropertyValue", "name": "AF", "value": "AF-1042" },
  "datePosted": "2026-08-12",
  "validThrough": "2026-09-30",
  "employmentType": "FULL_TIME",
  "jobLocationType": "TELECOMMUTE",
  "applicantLocationRequirements": { "@type": "Country", "name": "India" },
  "hiringOrganization": { "@type": "Organization", "name": "Alderman Foods", "sameAs": "https://aldermanfoods.example" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Pune", "addressRegion": "MH", "addressCountry": "IN" } },
  "baseSalary": { "@type": "MonetaryAmount", "currency": "INR", "value": { "@type": "QuantitativeValue", "minValue": 600000, "maxValue": 900000, "unitText": "YEAR" } },
  "description": "<p>Support our restaurant partners on the ordering platform. Triage incidents, own escalations and write runbooks.</p>"
}
</script>
</head><body><h1>Remote Support Engineer</h1></body></html>`;

export const nextDataCareerPage = `<!doctype html>
<html><head><title>Jobs | Pelican Freight</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"openings":[
 {"id":"pf-201","title":"Frontend Engineer","location":"Hyderabad, India","department":"Engineering","url":"https://pelicanfreight.example/careers/pf-201","descriptionHtml":"<p>Build the shipper dashboard in React and TypeScript.</p>","publishedAt":"2026-08-11T00:00:00Z","isRemote":false},
 {"id":"pf-202","title":"QA Engineer","location":"Remote","department":"Engineering","url":"https://pelicanfreight.example/careers/pf-202","descriptionHtml":"<p>Own the end-to-end regression suite in Playwright.</p>","publishedAt":"2026-08-06T00:00:00Z","isRemote":true}
]}},"page":"/careers"}
</script>
</body></html>`;

export const plainHtmlCareerPage = `<!doctype html>
<html><head><title>Work with us — Thornbury Retail</title></head>
<body>
<ul>
  <li><a href="/careers/jobs/store-systems-analyst">Store Systems Analyst</a></li>
  <li><a href="/careers/jobs/warehouse-supervisor">Warehouse Supervisor</a></li>
  <li><a href="/about">About us</a></li>
</ul>
</body></html>`;

export const plainHtmlDetailPage = `<!doctype html>
<html><head>
<title>Store Systems Analyst — Thornbury Retail</title>
<meta name="description" content="Support and improve point-of-sale systems across 120 stores." />
<link rel="canonical" href="https://thornburyretail.example/careers/jobs/store-systems-analyst" />
<meta property="og:site_name" content="Thornbury Retail" />
</head><body></body></html>`;

/* Greenhouse-embedded careers page — used by the ATS-detection tests. */
export const greenhouseEmbeddedPage = `<!doctype html>
<html><head><title>Careers — Northwind Labs</title></head>
<body>
<div id="grnhse_app"></div>
<script src="https://boards.greenhouse.io/embed/job_board/js?for=northwindlabs"></script>
</body></html>`;

export const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://thornburyretail.example/careers/jobs/store-systems-analyst</loc></url>
  <url><loc>https://thornburyretail.example/careers/jobs/warehouse-supervisor</loc></url>
  <url><loc>https://thornburyretail.example/about</loc></url>
</urlset>`;

export const robotsTxt = `User-agent: *
Disallow: /admin/
Disallow: /internal/
Allow: /careers/
Crawl-delay: 2

User-agent: BadBot
Disallow: /

Sitemap: https://thornburyretail.example/sitemap.xml`;

export const robotsDenyAll = `User-agent: *
Disallow: /`;

/* --------------------------- aggregator payload --------------------------- */

/* Shape emitted by the EXISTING server.js SOURCES adapters. */
export const aggregatorJobs = [
  {
    title: 'DevOps Engineer',
    company: 'Vellum Systems',
    location: 'Remote',
    mode: 'Remote',
    experience: 'Full-time',
    salary: '',
    companyType: 'Remote',
    source: 'Remotive',
    postedDate: '2026-08-13',
    url: 'https://remotive.example/remote-jobs/devops/devops-engineer-vellum-systems-991',
    summary: 'Run our CI/CD pipelines, Kubernetes clusters and Terraform estate.',
    requiredSkills: ['kubernetes', 'terraform', 'ci/cd'],
  },
  {
    title: 'Senior Platform Engineer',
    company: 'Northwind Labs',
    location: 'Bengaluru, India',
    mode: 'On-site/Hybrid',
    source: 'Jobicy',
    postedDate: '2026-08-11',
    url: 'https://jobicy.example/jobs/northwind-labs-senior-platform-engineer',
    summary: 'We are hiring a Senior Platform Engineer to own our Kubernetes platform, Terraform modules and internal developer tooling.',
    requiredSkills: ['kubernetes', 'terraform'],
  },
];

export default {
  greenhouseBoard, leverPostings, ashbyBoard, workableAccount, smartRecruitersPostings,
  jsonLdCareerPage, nextDataCareerPage, plainHtmlCareerPage, plainHtmlDetailPage,
  greenhouseEmbeddedPage, sitemapXml, robotsTxt, robotsDenyAll, aggregatorJobs,
};
