/* ═══════════════════════════════════════════════════════════ */
/*         RFP Pipeline Configuration & Types                  */
/* ═══════════════════════════════════════════════════════════ */

export const RFP_SECTIONS = [
  "executive_summary",
  "organization_background",
  "vision_and_strategy",
  "project_overview",
  "project_objectives",
  "scope_of_work",
  "system_architecture",
  "infrastructure_requirements",
  "software_platform_requirements",
  "ai_data_analytics",
  "cybersecurity_compliance",
  "data_governance",
  "integration_requirements",
  "deployment_strategy",
  "technical_requirements",
  "deliverables",
  "implementation_timeline",
  "vendor_qualifications",
  "support_and_maintenance",
  "risk_management",
  "budget_framework",
  "evaluation_criteria",
  "legal_and_contractual",
  "submission_instructions",
  "contact_information",
] as const;

export type SectionKey = (typeof RFP_SECTIONS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  executive_summary: "Executive Summary",
  organization_background: "Organization Background",
  vision_and_strategy: "Vision & Strategy",
  project_overview: "Project Overview",
  project_objectives: "Project Objectives",
  scope_of_work: "Scope of Work",
  system_architecture: "System Architecture",
  infrastructure_requirements: "Infrastructure Requirements",
  software_platform_requirements: "Software Platform Requirements",
  ai_data_analytics: "AI & Data Analytics",
  cybersecurity_compliance: "Cybersecurity & Compliance",
  data_governance: "Data Governance",
  integration_requirements: "Integration Requirements",
  deployment_strategy: "Deployment Strategy",
  technical_requirements: "Technical Requirements",
  deliverables: "Deliverables",
  implementation_timeline: "Implementation Timeline",
  vendor_qualifications: "Vendor Qualifications",
  support_and_maintenance: "Support & Maintenance",
  risk_management: "Risk Management",
  budget_framework: "Budget Framework",
  evaluation_criteria: "Evaluation Criteria",
  legal_and_contractual: "Legal & Contractual",
  submission_instructions: "Submission Instructions",
  contact_information: "Contact Information",
};

export const SECTION_GUIDANCE: Record<SectionKey, string> = {
  executive_summary:
    "Strategic overview, business case, expected ROI, risk factors, success metrics. End with a PROJECT SUMMARY TABLE.",
  organization_background:
    "Company history, core capabilities, certifications, past achievements. End with a CAPABILITIES TABLE.",
  vision_and_strategy:
    "Strategic vision, alignment with organizational goals, long-term roadmap, innovation drivers.",
  project_overview:
    "High-level project description, problem statement, proposed solution, key stakeholders.",
  project_objectives:
    "SMART objectives (Specific, Measurable, Achievable, Relevant, Time-bound). Include KPIs and success criteria.",
  scope_of_work:
    "In-scope vs out-of-scope items, work breakdown, acceptance criteria. End with a DELIVERABLES TABLE.",
  system_architecture:
    "Scalability, redundancy, integration patterns, technology stack decisions. End with a TECH STACK TABLE.",
  infrastructure_requirements:
    "Hardware, networking, cloud/on-premises decisions, capacity planning, disaster recovery.",
  software_platform_requirements:
    "Operating systems, databases, middleware, APIs, third-party platforms, licensing.",
  ai_data_analytics:
    "AI/ML capabilities, data pipelines, analytics dashboards, data quality requirements.",
  cybersecurity_compliance:
    "OWASP, SOC2, ISO 27001, GDPR, encryption, access controls, audit trail. End with a COMPLIANCE TABLE.",
  data_governance:
    "Data classification, retention policies, privacy controls, data lifecycle management.",
  integration_requirements:
    "System integrations, APIs, data exchange formats, middleware, migration plan.",
  deployment_strategy:
    "Phased rollout, environments (dev/staging/prod), CI/CD, rollback procedures.",
  technical_requirements:
    "Functional and non-functional requirements, performance benchmarks, SLAs.",
  deliverables:
    "All deliverables with acceptance criteria, formats, and delivery schedule.",
  implementation_timeline:
    "Project phases, milestones, dependencies, Gantt-style overview. End with a TIMELINE TABLE.",
  vendor_qualifications:
    "Required experience, certifications, team composition, references, financial stability.",
  support_and_maintenance:
    "SLA tiers, response times, warranty, knowledge transfer, training plan.",
  risk_management:
    "Risk identification, probability, impact, mitigation strategies. End with a RISK MATRIX TABLE.",
  budget_framework:
    "Cost breakdown, payment milestones, budget contingency, total cost of ownership.",
  evaluation_criteria:
    "Scoring methodology, weights per criterion, selection process, committee.",
  legal_and_contractual:
    "Contract terms, IP ownership, NDA, liability, termination clauses, governing law.",
  submission_instructions:
    "Proposal format, page limits, submission deadline, required documents, Q&A process.",
  contact_information:
    "Primary contact, procurement officer, technical contact, mailing address.",
};

/* ─── Seed synthesis map ─── */
export const SEED_MAP: Record<string, string[]> = {
  executive_summary: ["project_overview", "scope_of_work", "budget_framework"],
  vision_and_strategy: ["project_objectives", "project_overview"],
  system_architecture: ["technical_requirements", "detailed_project_description"],
  infrastructure_requirements: ["technical_requirements", "scope_of_work"],
  software_platform_requirements: ["technical_requirements", "detailed_project_description"],
  ai_data_analytics: ["technical_requirements", "project_overview"],
  data_governance: ["cybersecurity_compliance", "technical_requirements"],
  integration_requirements: ["technical_requirements", "scope_of_work"],
  deployment_strategy: ["implementation_timeline", "scope_of_work"],
  support_and_maintenance: ["vendor_qualifications", "implementation_timeline"],
  risk_management: ["cybersecurity_compliance", "budget_framework"],
};

/* ─── Generation batches (5 sections per batch for speed) ─── */
export const GENERATION_BATCHES: SectionKey[][] = [
  ["executive_summary", "organization_background", "vision_and_strategy", "project_overview", "project_objectives"],
  ["scope_of_work", "system_architecture", "infrastructure_requirements", "software_platform_requirements", "ai_data_analytics"],
  ["cybersecurity_compliance", "data_governance", "integration_requirements", "deployment_strategy", "technical_requirements"],
  ["deliverables", "implementation_timeline", "vendor_qualifications", "support_and_maintenance", "risk_management"],
  ["budget_framework", "evaluation_criteria", "legal_and_contractual", "submission_instructions", "contact_information"],
];

/* ─── Model config ─── */
export const PIPELINE_MODELS = {
  documentAnalysis: "qwen/qwen-plus",
  rfpGeneration: "qwen/qwen-plus-2025-01-25",
  templateSelection: "deepseek/deepseek-chat",
  qualityAssurance: "qwen/qwen-plus",
};

/* ─── Pipeline types ─── */
export interface RfpInput {
  organization_name: string;
  project_title: string;
  category: string;
  sections: Record<string, string>;
  detailed_project_description: string;
  additional_details?: string;
  selected_template?: PdfTemplate;
  selectedSubsystems?: string[]; // "full" or subsystem names
  qaReview?: QAResult;
  qaRevisionNotes?: string;
  skipDecomposition?: boolean;
  fastMode?: boolean;
  precomputedDecomposition?: {
    subsystems: Record<string, string>;
    inferredRequirements: string[];
    needsDecomposition: boolean;
  };
}

export type PdfTemplate = "software" | "manufacturing" | "consulting" | "government";

export interface PipelineProgress {
  stage: string;
  stageIndex: number;
  totalStages: number;
  message: string;
  percent: number;
}

export interface QAResult {
  overallScore: number;
  missingSections: string[];
  improvements: string[];
  strengths: string[];
  readinessLevel: string;
  scoreExplanation?: string;
  scoreBreakdown?: {
    completeness?: number;
    specificity?: number;
    vendorReadiness?: number;
    compliance?: number;
  };
}

export interface SubsystemPdf {
  name: string;
  pdfBase64: string;
}

export interface SubsystemDraft {
  name: string;
  metadata: { organization_name: string; project_title: string; category: string; date: string };
  sections: Record<string, string>;
  sectionLabels: Record<string, string>;
  template: PdfTemplate;
  pdfBase64: string;
}

export interface DecompositionData {
  subsystems: Record<string, string>;
  inferredRequirements: string[];
  needsDecomposition: boolean;
  subsystemPdfs: SubsystemPdf[];
  subsystemDrafts: SubsystemDraft[];
}

export interface PipelineResult {
  sections: Record<string, string>;
  sectionLabels: Record<string, string>;
  metadata: { organization_name: string; project_title: string; category: string; date: string };
  qa: QAResult;
  template: string;
  pdfBase64: string;
  decomposition: DecompositionData;
}

/* ─── Subsystem RFP sections (10 per subsystem) ─── */
export const SUBSYSTEM_SECTIONS = [
  "executive_summary",
  "project_overview",
  "scope_of_work",
  "technical_requirements",
  "system_architecture",
  "deliverables",
  "implementation_timeline",
  "vendor_qualifications",
  "evaluation_criteria",
  "budget_framework",
] as const;

export type SubsystemSectionKey = (typeof SUBSYSTEM_SECTIONS)[number];

/* ─── Chatbot question flow (19 questions) ─── */
export interface RfpQuestion {
  key: string;
  label: string;
  placeholder: string;
  isMetadata?: boolean;
  isTextarea?: boolean;
  options?: string[];
}

export const FINAL_INTAKE_KEY = "additional_details";
export const MANDATORY_SECTIONS_KEY = "mandatory_rfp_requirements";

export const CATEGORY_QUESTION_TEMPLATES: Record<string, Partial<Record<string, string>>> = {
  software: {
    project_overview: "What software product, platform, or workflow is being built or improved?",
    technical_requirements: 'What software stack, integrations, security, and performance requirements should be included? (or type "auto")',
    deliverables: 'What software deliverables are expected, such as source code, documentation, deployments, or training? (or type "auto")',
    risk_management: 'What software risks, technical dependencies, and mitigation plans should be addressed? (or type "auto")',
  },
  logistics: {
    project_overview: "What logistics operation or supply chain process is being improved?",
    technical_requirements: 'What routing, tracking, warehouse, fleet, or integration requirements should be included? (or type "auto")',
    deliverables: 'What logistics deliverables are expected, such as dashboards, SLAs, operational reports, or process changes? (or type "auto")',
    risk_management: 'What logistics risks, service disruptions, compliance issues, and mitigation plans should be addressed? (or type "auto")',
  },
  manufacturing: {
    project_overview: "What manufacturing process, plant, or production capability is being addressed?",
    technical_requirements: 'What equipment, process, quality, safety, and integration requirements should be included? (or type "auto")',
    deliverables: 'What manufacturing deliverables are expected, such as process specs, equipment lists, testing plans, or training? (or type "auto")',
    risk_management: 'What manufacturing risks, downtime concerns, quality issues, and mitigation plans should be addressed? (or type "auto")',
  },
  construction: {
    project_overview: "What construction project, site, or facility work is being planned?",
    technical_requirements: 'What design, safety, materials, permits, and site requirements should be included? (or type "auto")',
    deliverables: 'What construction deliverables are expected, such as drawings, schedules, inspections, or handover documents? (or type "auto")',
    risk_management: 'What construction risks, site constraints, safety issues, and mitigation plans should be addressed? (or type "auto")',
  },
  other: {
    project_overview: "What kind of project is this and what outcome should the RFP support?",
    technical_requirements: 'What technical or operational requirements should be included? (or type "auto")',
    deliverables: 'What deliverables or outputs are expected? (or type "auto")',
    risk_management: 'What key risks or constraints should be addressed? (or type "auto")',
  },
};

export function getCategoryQuestionLabel(category: string | undefined, key: string, fallback: string): string {
  const normalized = (category || "other").trim().toLowerCase();
  return CATEGORY_QUESTION_TEMPLATES[normalized]?.[key] || fallback;
}

export function getFinalIntakeQuestionLabel(): string {
  return "Any additional details or optional notes beyond the mandatory requirements?";
}

export const RFP_QUESTIONS: RfpQuestion[] = [
  { key: "organization_name", label: "What is the name of your organization?", placeholder: "e.g., Acme Corporation", isMetadata: true },
  { key: "project_title", label: "What is the project title?", placeholder: "e.g., Enterprise Cloud Migration", isMetadata: true },
  { key: "category", label: "What is the project category?", placeholder: "Select a category", isMetadata: true, options: ["software", "manufacturing", "logistics", "construction", "other"] },
  { key: "organization_background", label: 'Describe your organization background (or type "auto")', placeholder: "Company history, capabilities...", isTextarea: true },
  { key: "project_overview", label: 'Provide a project overview (or type "auto")', placeholder: "High-level project description...", isTextarea: true },
  { key: "project_objectives", label: 'What are the project objectives? (or type "auto")', placeholder: "Key goals and success criteria...", isTextarea: true },
  { key: "scope_of_work", label: 'Describe the scope of work (or type "auto")', placeholder: "In-scope and out-of-scope items...", isTextarea: true },
  { key: "detailed_project_description", label: 'Provide a detailed project description (or type "auto")', placeholder: "Comprehensive technical and business details...", isTextarea: true },
  { key: "technical_requirements", label: 'What are the technical requirements? (or type "auto")', placeholder: "Functional and non-functional requirements...", isTextarea: true },
  { key: "deliverables", label: 'List the expected deliverables (or type "auto")', placeholder: "All project deliverables...", isTextarea: true },
  { key: "vendor_qualifications", label: 'What vendor qualifications are required? (or type "auto")', placeholder: "Experience, certifications, team size...", isTextarea: true },
  { key: "implementation_timeline", label: 'What is the implementation timeline? (or type "auto")', placeholder: "Project phases and milestones...", isTextarea: true },
  { key: "budget_framework", label: 'Describe the budget framework (or type "auto")', placeholder: "Budget range, payment terms...", isTextarea: true },
  { key: "evaluation_criteria", label: 'What are the evaluation criteria? (or type "auto")', placeholder: "Scoring methodology, weights...", isTextarea: true },
  { key: "risk_management", label: 'What are the risk management requirements? (or type "auto")', placeholder: "Risks, mitigation, contingencies...", isTextarea: true },
  { key: "cybersecurity_compliance", label: 'What cybersecurity & compliance requirements? (or type "auto")', placeholder: "Standards, certifications needed...", isTextarea: true },
  { key: "legal_and_contractual", label: 'Any legal & contractual requirements? (or type "auto")', placeholder: "Contract terms, IP, NDA...", isTextarea: true },
  { key: "submission_instructions", label: 'Submission instructions for vendors? (or type "auto")', placeholder: "Format, deadline, required documents...", isTextarea: true },
  { key: "contact_information", label: 'Provide contact information (or type "auto")', placeholder: "Name, email, phone, address...", isTextarea: true },
  { key: MANDATORY_SECTIONS_KEY, label: "Which RFP sections are mandatory for vendors to address? (or type \"auto\")", placeholder: "List the section names or leave blank for auto-detection...", isTextarea: true },
];
