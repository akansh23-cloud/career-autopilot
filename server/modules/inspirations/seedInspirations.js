/* Fallback seed ideas — ONLY used when every external source fails or returns
   nothing. Ported from the original static Sandbox ideas, shaped like a raw
   source item so the same normalize/rank pipeline applies. Marked source:
   'seed' so the UI can label it clearly. */
export const SEED_INSPIRATIONS = [
  {
    source: 'seed', sourceId: 'seed-campus-skill-market',
    sourceUrl: '', sourceTitle: 'Campus Skill Exchange Marketplace',
    sourceDescription: 'Students have skills but no structured way to trade help, form teams, and prove contributions across projects. React, Node.js, MongoDB, matching algorithm, payments.',
    topics: ['react', 'node.js', 'mongodb', 'payments'], createdAt: null,
  },
  {
    source: 'seed', sourceId: 'seed-local-business-ai',
    sourceUrl: '', sourceTitle: 'AI CRM for Local Shops and Clinics',
    sourceDescription: 'Small businesses lose repeat customers because they do not track follow-ups, reminders, service history or leads. Auth, CRM, WhatsApp, analytics, AI summaries.',
    topics: ['ai', 'crm', 'analytics', 'backend'], createdAt: null,
  },
  {
    source: 'seed', sourceId: 'seed-devops-cost-guard',
    sourceUrl: '', sourceTitle: 'Cloud Cost Guardrail Dashboard',
    sourceDescription: 'Students and startups deploy cloud projects but do not understand cost, idle resources, alerts or budget limits. AWS, Docker, CI/CD, Terraform, monitoring.',
    topics: ['aws', 'docker', 'ci/cd', 'terraform', 'monitoring'], createdAt: null,
  },
  {
    source: 'seed', sourceId: 'seed-placement-os',
    sourceUrl: '', sourceTitle: 'Placement Readiness Operating System',
    sourceDescription: 'Students do random learning without a measurable path from projects to resume to interviews to recruiter discovery. Roadmaps, XP, resume, analytics, recruiter console.',
    topics: ['react', 'node.js', 'analytics', 'full stack'], createdAt: null,
  },
  {
    source: 'seed', sourceId: 'seed-rag-knowledge',
    sourceUrl: '', sourceTitle: 'RAG Knowledge Assistant for Internal Docs',
    sourceDescription: 'Teams cannot find answers buried across wikis, PDFs and chat. Build a retrieval-augmented assistant with embeddings, a vector store and source citations. LLM, RAG, vector db, python.',
    topics: ['ai', 'llm', 'rag', 'python'], createdAt: null,
  },
  {
    source: 'seed', sourceId: 'seed-realtime-analytics',
    sourceUrl: '', sourceTitle: 'Real-time Event Analytics Pipeline',
    sourceDescription: 'Product teams want live funnels and alerts. Build an ingestion pipeline with a queue, stream processing and a dashboard. Kafka, postgres, analytics, dashboard.',
    topics: ['data', 'analytics', 'kafka', 'dashboard'], createdAt: null,
  },
];

export default { SEED_INSPIRATIONS };
