export const ROLE_GROUPS = {
  'Software & Data': [
    'Software Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Developer',
    'Mobile Developer', 'DevOps Engineer', 'Cloud Engineer', 'Platform Engineer',
    'Site Reliability Engineer (SRE)', 'Data Analyst', 'Data Scientist',
    'Machine Learning Engineer', 'QA / Test Engineer', 'Security Engineer'
  ],
  'Product & Design': [
    'Product Manager', 'Associate Product Manager', 'UX Designer', 'UI / Visual Designer',
    'Product Designer', 'UX Researcher'
  ],
  'Business & Operations': [
    'Business Analyst', 'Operations Manager', 'Project Manager', 'Program Manager',
    'Management Consultant'
  ],
  'Marketing & Sales': [
    'Digital Marketing Specialist', 'Content Writer / Marketer', 'SEO Specialist',
    'Social Media Manager', 'Sales Executive', 'Business Development'
  ],
  'Finance & HR': [
    'Financial Analyst', 'Accountant', 'Investment Analyst', 'HR Executive / Recruiter',
    'Customer Success Manager'
  ],
  'Internships / Entry-level': [
    'Software Engineering Intern', 'Data Analyst Intern', 'Marketing Intern',
    'Design Intern', 'Finance Intern'
  ],
};

export const ALL_ROLES = Object.values(ROLE_GROUPS).flat();

export function inferRoleFromResume(text = '') {
  const s = text.toLowerCase();
  const signals = [
    ['DevOps Engineer', ['devops', 'jenkins', 'gitlab', 'openshift', 'kubernetes', 'docker', 'terraform', 'ansible', 'ci/cd', 'cicd']],
    ['Cloud Engineer', ['aws', 'azure', 'gcp', 'cloud', 'eks', 'aks', 'ec2', 'lambda']],
    ['Frontend Engineer', ['react', 'frontend', 'vite', 'redux', 'tailwind', 'javascript', 'typescript']],
    ['Backend Engineer', ['node.js', 'express', 'spring boot', 'java', 'backend', 'api', 'postgresql', 'mongodb']],
    ['Full Stack Developer', ['full stack', 'mern', 'react', 'node', 'express', 'mongodb']],
    ['Data Analyst', ['data analyst', 'power bi', 'tableau', 'sql', 'excel', 'dashboard']],
    ['Data Scientist', ['data science', 'python', 'pandas', 'numpy', 'model', 'statistics']],
    ['Machine Learning Engineer', ['machine learning', 'deep learning', 'tensorflow', 'pytorch', 'llm', 'model training']],
    ['QA / Test Engineer', ['selenium', 'automation testing', 'test cases', 'qa', 'cypress']],
    ['Security Engineer', ['security', 'sast', 'dast', 'veracode', 'trivy', 'vulnerability']],
    ['Product Manager', ['product manager', 'roadmap', 'stakeholder', 'user research']],
    ['Business Analyst', ['business analyst', 'requirements', 'brd', 'stakeholder analysis']],
  ];
  let best = { role: '', score: 0 };
  for (const [role, words] of signals) {
    const score = words.reduce((n, w) => n + (s.includes(w) ? 1 : 0), 0);
    if (score > best.score) best = { role, score };
  }
  return best.score > 0 ? best.role : '';
}
