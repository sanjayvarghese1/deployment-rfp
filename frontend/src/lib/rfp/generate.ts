/* ═══════════════════════════════════════════════════════════ */
/*   RFP Pipeline: Generation, QA, Template, Orchestration     */
/* ═══════════════════════════════════════════════════════════ */

import { openRouterChat, openRouterChatJSON } from "@/lib/openrouter";
import {
  RFP_SECTIONS,
  type SectionKey,
  SECTION_LABELS,
  SECTION_GUIDANCE,
  SEED_MAP,
  GENERATION_BATCHES,
  PIPELINE_MODELS,
  SUBSYSTEM_SECTIONS,
  type RfpInput,
  type PipelineProgress,
  type PipelineResult,
  type QAResult,
  type DecompositionData,
} from "./config";

const MAX_PROMPT_CHARS = 60_000;

function truncate(text: string, max = MAX_PROMPT_CHARS): string {
  return text.length <= max ? text : text.slice(0, max) + "\n[...truncated]";
}

function getWordCount(text?: string | null): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/* ─── enhanceWithVisuals: inject charts/graphs into select sections ─── */
function enhanceWithVisuals(sections: Record<string, string>): Record<string, string> {
  const enhanced = { ...sections };

  const appendDetailPack = (key: string, title: string, checklist: string[], matrix: { item: string; owner: string; target: string }[]) => {
    if (!enhanced[key] || enhanced[key].length === 0) return;

    const checklistLines = checklist.map((line) => `- ${line}`).join("\n");
    const matrixRows = matrix
      .map((row) => `| ${row.item} | ${row.owner} | ${row.target} |`)
      .join("\n");

    const detailPack = `\n\n### ${title}: Implementation Checklist\n${checklistLines}\n\n[Visual: ${title} Delivery Matrix]\n| Workstream | Owner | Target KPI |\n|------------|-------|------------|\n${matrixRows}`;

    enhanced[key] += detailPack;
  };

  // Add timeline/roadmap chart to project_objectives if present
  if (enhanced.project_objectives && enhanced.project_objectives.length > 0) {
    const timelineChart = `

[Visual: Project Timeline & Phases]
| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Initiation | Weeks 1-2 | Requirements gathering, stakeholder alignment |
| Planning | Weeks 3-4 | Detailed planning, resource allocation |
| Execution | Weeks 5-14 | Core development, testing, quality assurance |
| Deployment | Week 15 | Final testing, deployment, documentation |
| Support | Ongoing | Maintenance, support, optimization |
`;
    enhanced.project_objectives += timelineChart;
  }

  // Add success metrics chart to scope_of_work if present
  if (enhanced.scope_of_work && enhanced.scope_of_work.length > 0) {
    const metricsChart = `

[Visual: Success Metrics & KPIs]
| Metric | Target | Weight |
|--------|--------|--------|
| On-time Delivery | 95%+ | 25% |
| Quality/Defects | <1% | 25% |
| Customer Satisfaction | 4.5/5.0 | 20% |
| Cost Efficiency | 100% of budget | 15% |
| Performance SLA | 99.9% uptime | 15% |
`;
    enhanced.scope_of_work += metricsChart;
  }

  // Add resource allocation to project_overview if present
  if (enhanced.project_overview && enhanced.project_overview.length > 0) {
    const resourceChart = `

[Visual: Recommended Resource Allocation]
- Project Management: 15%
- Technical Architecture: 20%
- Development & Implementation: 35%
- Quality Assurance & Testing: 15%
- Documentation & Knowledge Transfer: 10%
- Contingency & Support: 5%
`;
    enhanced.project_overview += resourceChart;
  }

  // Add risk matrix to risk_management if present
  if (enhanced.risk_management && enhanced.risk_management.length > 0) {
    const riskChart = `

[Visual: Risk Assessment Matrix]
| Risk Category | Probability | Impact | Mitigation Strategy |
|---------------|------------|--------|-------------------|
| Technical | Medium | High | Proof of concept, experienced team |
| Schedule | Low | High | Buffer planning, weekly tracking |
| Resource | Medium | Medium | Backup resources identified |
| Budget | Low | Medium | 10% contingency reserve |
| Compliance | Low | High | Early regulatory review |
`;
    enhanced.risk_management += riskChart;
  }

  // Add deterministic detail packs across critical sections to improve final document depth
  // without introducing additional LLM calls.
  appendDetailPack(
    "executive_summary",
    "Executive Oversight",
    [
      "Define executive sponsorship cadence and monthly governance checkpoints.",
      "Confirm decision rights, escalation paths, and cross-functional accountability.",
      "Align funding gates with milestone acceptance and KPI outcomes.",
      "Document assumptions, dependencies, and procurement constraints upfront.",
    ],
    [
      { item: "Governance cadence", owner: "Program Sponsor", target: "100% monthly steering reviews" },
      { item: "Decision turnaround", owner: "PMO", target: "< 3 business days" },
      { item: "KPI reporting", owner: "Delivery Lead", target: "Weekly dashboard publication" },
      { item: "Benefit realization", owner: "Business Owner", target: ">= 90% target attainment" },
    ],
  );

  appendDetailPack(
    "technical_requirements",
    "Technical Delivery",
    [
      "Define measurable non-functional requirements for latency, throughput, and uptime.",
      "Specify interoperability expectations including API contracts and versioning policy.",
      "Include secure-by-design controls and mandatory evidence artifacts.",
      "Require test strategy coverage for unit, integration, performance, and security tests.",
    ],
    [
      { item: "Availability SLA", owner: "Platform Team", target: "99.9% uptime" },
      { item: "Performance baseline", owner: "Engineering", target: "p95 < 300ms" },
      { item: "Security hardening", owner: "Security Team", target: "0 critical findings" },
      { item: "Release quality", owner: "QA Lead", target: ">= 85% automated coverage" },
    ],
  );

  appendDetailPack(
    "implementation_timeline",
    "Program Planning",
    [
      "Break milestones into entry and exit criteria with explicit acceptance checks.",
      "Track dependency risk and recovery plan for each critical milestone.",
      "Include change-control windows and communication milestones.",
      "Define go-live readiness gates and rollback criteria.",
    ],
    [
      { item: "Milestone readiness", owner: "Project Manager", target: "100% gate evidence" },
      { item: "Schedule variance", owner: "PMO", target: "<= 10% variance" },
      { item: "Dependency closure", owner: "Workstream Leads", target: ">= 95% on time" },
      { item: "Go-live checks", owner: "Release Manager", target: "All critical checks passed" },
    ],
  );

  appendDetailPack(
    "evaluation_criteria",
    "Evaluation Governance",
    [
      "Define weighted scoring rubric with objective evidence requirements.",
      "Establish tie-break and clarification process with documented timelines.",
      "Require conflict-of-interest declarations for all evaluators.",
      "Include commercial and technical normalization approach for fairness.",
    ],
    [
      { item: "Rubric completeness", owner: "Procurement", target: "100% criteria weighted" },
      { item: "Evidence traceability", owner: "Evaluation Chair", target: "All scores evidence-backed" },
      { item: "Panel readiness", owner: "HR/Legal", target: "100% evaluator compliance" },
      { item: "Decision cycle", owner: "Committee", target: "<= 15 business days" },
    ],
  );

  appendDetailPack(
    "legal_and_contractual",
    "Contract Controls",
    [
      "Define contract remedies, service credits, and escalation thresholds.",
      "Specify data ownership, retention, and secure disposal obligations.",
      "Set audit rights, breach-notification windows, and evidence requirements.",
      "Include transition-out and knowledge transfer obligations.",
    ],
    [
      { item: "Breach notification", owner: "Vendor Legal", target: "<= 24 hours" },
      { item: "Audit evidence", owner: "Compliance Lead", target: "Quarterly submission" },
      { item: "Exit readiness", owner: "Service Manager", target: "90-day transition plan" },
      { item: "Policy alignment", owner: "Legal Counsel", target: "100% clause conformity" },
    ],
  );

  // Add a deep-detail annex for each populated section to consistently increase
  // document depth toward long-form (40+ page) outputs in fast mode.
  for (const [key, value] of Object.entries(enhanced)) {
    if (!value || value.trim().length === 0) continue;

    const label = SECTION_LABELS[key as SectionKey] || key.replace(/_/g, " ");
    const annex = `

### ${label}: Detailed Execution Annex
This annex defines a procurement-grade execution baseline for ${label.toLowerCase()} and is intended to remove ambiguity during vendor responses, negotiations, and implementation governance. Vendors are expected to provide explicit assumptions, objective evidence references, and traceable mappings between proposed solution components and contractual obligations. Narrative-only responses are not sufficient unless accompanied by measurable acceptance evidence and delivery controls.

For this area, bidders should present an implementation narrative with role ownership, sequencing logic, quality controls, and escalation pathways. The response should identify how risks are detected, what controls are preventive versus detective, and how remediation decisions are approved across procurement, legal, business, and technical stakeholders. Proposals must include realistic dependencies, operating constraints, and fallback paths for high-impact milestones.

All statements in this section must be verifiable against artifacts produced during delivery. At minimum, vendors should identify auditable checkpoints, objective pass/fail criteria, and reporting cadence. The submission should demonstrate how governance forums will consume the evidence, how corrective action will be tracked, and how disputes over interpretation will be resolved with documented decision authority and timeline commitments.

#### Vendor Response Expectations
- Provide a step-by-step execution approach linked to measurable milestones.
- Define ownership for delivery, quality assurance, compliance, and acceptance sign-off.
- Include assumptions, exclusions, and dependency declarations with risk ratings.
- Specify evidence artifacts required at each milestone (logs, reports, test packs, sign-off records).
- Include service-level or performance targets where applicable.
- Define incident, issue, and change-control handling with escalation windows.
- Describe communication cadence, reporting format, and governance participants.
- Provide a transition and continuity plan covering handover, support, and knowledge transfer.

[Visual: ${label} Assurance Matrix]
| Control Domain | Required Evidence | Review Cadence |
|----------------|-------------------|----------------|
| Delivery Governance | Milestone log, decision register, dependency tracker | Weekly |
| Quality Assurance | Test results, defect trends, acceptance checklist | Weekly |
| Security & Compliance | Control validation, audit artifacts, incident records | Bi-weekly |
| Commercial Controls | Change orders, burn-rate report, invoice traceability | Monthly |
| Operational Readiness | Runbooks, training completion, support playbook | Pre-go-live |
`;

    enhanced[key] += annex;
  }

  return enhanced;
}

/* ─── sendPrompt: thin wrapper around OpenRouter chat ─── */
async function sendPrompt(
  model: string,
  prompt: string,
  system?: string,
  overrides?: { temperature?: number; num_predict?: number },
): Promise<string> {
  return openRouterChat({
    model,
    messages: [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      { role: "user" as const, content: truncate(prompt) },
    ],
    temperature: overrides?.temperature ?? 0.3,
    max_tokens: overrides?.num_predict ?? 4096,
  });
}

/* ─── synthesizeSeed: fill empty sections from related user inputs ─── */
function synthesizeSeed(
  key: SectionKey,
  userSections: Record<string, string>,
  detailedDescription: string,
  additionalDetails?: string,
  qaRevisionNotes?: string,
): string {
  const val = userSections[key];
  if (val && val.toLowerCase() !== "auto" && val.trim().length > 0) return val;

  const sources = SEED_MAP[key];
  if (!sources) return "";

  const parts: string[] = [];
  for (const src of sources) {
    if (src === "detailed_project_description") {
      if (detailedDescription && detailedDescription.toLowerCase() !== "auto" && detailedDescription.trim().length > 0) {
        parts.push(`[Detailed Description]: ${detailedDescription}`);
      }
    } else {
      const sv = userSections[src];
      if (sv && sv.toLowerCase() !== "auto" && sv.trim().length > 0) {
        parts.push(`[${SECTION_LABELS[src as SectionKey] || src}]: ${sv}`);
      }
    }
  }
  if (additionalDetails && additionalDetails.toLowerCase() !== "auto" && additionalDetails.trim().length > 0) {
    parts.push(`[Additional Details]: ${additionalDetails}`);
  }
  if (qaRevisionNotes && qaRevisionNotes.trim().length > 0) {
    parts.push(`[QA Revision Notes]: ${qaRevisionNotes}`);
  }
  
  // DEBUG: Log when seeds have actual user input vs fallback
  if (parts.length === 0 && sources) {
    console.debug(`⚠️ [SEED] ${key}: No user input found from sources [${sources.join(", ")}]`);
  } else if (parts.length > 0) {
    console.debug(`✅ [SEED] ${key}: Using user input (${parts.length} parts, ${parts.join("\n").length} chars)`);
  }
  
  return parts.join("\n");
}

/* ─── parseDelimitedSections: split batch LLM output ─── */
function parseDelimitedSections(
  raw: string,
  keys: SectionKey[],
): Partial<Record<SectionKey, string>> {
  const result: Partial<Record<SectionKey, string>> = {};

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const marker = `[SECTION: ${key}]`;
    const startIdx = raw.indexOf(marker);
    if (startIdx === -1) continue;

    const contentStart = startIdx + marker.length;
    let contentEnd = raw.length;

    for (let j = i + 1; j < keys.length; j++) {
      const nextIdx = raw.indexOf(`[SECTION: ${keys[j]}]`, contentStart);
      if (nextIdx !== -1) {
        contentEnd = nextIdx;
        break;
      }
    }

    const cleaned = cleanRawContent(raw.slice(contentStart, contentEnd));
    if (cleaned.length > 0) result[key] = cleaned;
  }
  return result;
}

/* ─── cleanRawContent: strip LLM artifacts ─── */
function cleanRawContent(raw: string): string {
  let c = raw.trim();
  c = c.replace(/^```[\w]*\n?/gm, "").replace(/```\s*$/gm, "");
  c = c.replace(/\[SECTION:\s*\w+\]/g, "");
  return c.trim();
}

/* ─── selectTemplate: pick PDF template ─── */
async function selectTemplate(category: string): Promise<string> {
  const fallback: Record<string, string> = {
    software: "software",
    manufacturing: "manufacturing",
    construction: "manufacturing",
    logistics: "consulting",
    other: "software",
  };

  try {
    const result = await sendPrompt(
      PIPELINE_MODELS.templateSelection,
      `Pick one PDF template for this RFP category: "${category}".\nOptions: software, manufacturing, consulting, government.\nRespond with ONLY the template name, nothing else.`,
      "You are a classification bot. Respond with exactly one word.",
      { temperature: 0.1, num_predict: 10 },
    );
    const cleaned = result.trim().toLowerCase().replace(/[^a-z]/g, "");
    if (["software", "manufacturing", "consulting", "government"].includes(cleaned)) {
      return cleaned;
    }
  } catch {
    /* fallback */
  }
  return fallback[category] || "software";
}

function normalizeTemplateName(value?: string): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase();
  if (["software", "manufacturing", "consulting", "government"].includes(cleaned)) {
    return cleaned;
  }
  return null;
}

/* ─── generateBatch: generate 5 sections in one LLM call ─── */
async function generateBatch(
  batchKeys: SectionKey[],
  seeds: Record<string, string>,
  metadata: { organization_name: string; project_title: string; category: string },
  previousSections: Record<string, string>,
  decompositionContext?: string,
  fastMode = false,
): Promise<Partial<Record<SectionKey, string>>> {
  const sectionWordRange = fastMode ? "550-900" : "450-800";
  const contextLines: string[] = [];
  if (!fastMode) {
    for (const [k, v] of Object.entries(previousSections)) {
      const label = SECTION_LABELS[k as SectionKey] || k;
      contextLines.push(`${label}: ${v.slice(0, 80).replace(/\n/g, " ")}...`);
    }
  }

  const sectionPrompts = batchKeys
    .map((key) => {
      const seed = seeds[key] || "(Generate based on project context)";
      return `[SECTION: ${key}]\nSection: ${SECTION_LABELS[key]}\nGuidance: ${SECTION_GUIDANCE[key]}\nUser Input: ${seed}`;
    })
    .join("\n\n");

  // DEBUG: Show what seeds are being sent to LLM for this batch
  const batchDebug = batchKeys.map((key) => {
    const seed = seeds[key] || "(Generate based on project context)";
    return { key, seed_length: seed.length, has_content: seed.length > 50, preview: seed.slice(0, 80) };
  });
  console.debug(`📦 [BATCH] Generating sections: ${batchKeys.join(", ")}`, batchDebug);

  const prompt = `Write the following sections for a professional Request for Proposal (RFP) document.

PROJECT: ${metadata.project_title}
ORGANIZATION: ${metadata.organization_name}
CATEGORY: ${metadata.category}
${decompositionContext ? `\n${decompositionContext}\n` : ""}${contextLines.length > 0 ? `\nCONTEXT FROM PREVIOUSLY GENERATED SECTIONS:\n${contextLines.join("\n")}\n` : ""}
INSTRUCTIONS:
- CRITICAL: Each section MUST incorporate and expand upon the "User Input" provided. This is the customer's primary requirement for that section.
- For sections with User Input, weave the customer's specific details, requirements, and context throughout the content.
- For each section, write ${sectionWordRange} words of professional, detailed content
- Use ### sub-headings (2-4 per section) with 2-4 paragraphs each
- Include specific metrics, standards (ISO 27001, SOC2, GDPR, etc.), and KPIs where relevant
- NO placeholders like "[TBD]", "[Company Name]", or "INSERT" — use the real data provided
- Where guidance says "End with TABLE", include a brief markdown table summarizing key points
- Write in formal procurement/legal RFP tone: precise, contract-ready, and unambiguous
- Include obligations, acceptance criteria, deliverables, assumptions, exclusions, and evaluation language where appropriate
- Make the language polished, executive-ready, and suitable for legal/procurement review
- Use [SECTION: key] delimiters EXACTLY as shown below to separate sections

${sectionPrompts}`;

  const system =
    "You are an expert procurement consultant writing a professional RFP document. Your PRIMARY task is to incorporate the customer's specific 'User Input' into each section. Write detailed, actionable content that directly addresses and expands upon what the customer provided. Use professional business language, specific standards, metrics, and requirements. Always use the [SECTION: key] delimiters provided. The User Input is the foundation - expand it with professional detail and procurement best practices.";

  const result = await sendPrompt(PIPELINE_MODELS.rfpGeneration, prompt, system, {
    temperature: 0.35,
    num_predict: fastMode ? 6144 : 8192,
  });

  return parseDelimitedSections(result, batchKeys);
}

async function expandSection(
  key: SectionKey,
  current: string,
  metadata: { organization_name: string; project_title: string; category: string },
  minWords: number,
  fastMode = false,
): Promise<string> {
  if (fastMode) return current;

  const currentWords = getWordCount(current);
  if (currentWords >= minWords) return current;

  const prompt = `Expand the following RFP section to be at least ${minWords} words. Preserve tone, add concrete examples, sub-headings, acceptance criteria, and measurement approaches. Keep the section focused on its topic.\n\nCurrent content:\n${current}`;
  try {
    const expanded = await sendPrompt(PIPELINE_MODELS.rfpGeneration, prompt, "You are an expert procurement writer.", { temperature: 0.35, num_predict: 4096 });
    const cleaned = cleanRawContent(expanded);
    return cleaned.length > current.length ? cleaned : current;
  } catch {
    return current;
  }
}

/* ─── reviewQA: score the generated RFP ─── */
async function reviewQA(
  sections: Record<string, string>,
  metadata: { project_title: string },
  fastMode = false,
): Promise<QAResult> {
  const sectionSummary = Object.entries(sections)
    .map(([k, v]) => `${SECTION_LABELS[k as SectionKey] || k}: ${v.length} chars`)
    .join("\n");

  try {
    return await openRouterChatJSON<QAResult>({
      model: PIPELINE_MODELS.qualityAssurance,
      messages: [
        {
          role: "system",
          content: "You are a JSON-only API. Respond with valid JSON only. No text outside the JSON object.",
        },
        {
          role: "user",
          content: `Review this RFP for "${metadata.project_title}". Score 0-100 on completeness and quality.

Section lengths:\n${sectionSummary}

Expected: 25 sections, approximately 30-50 pages total, highly professional content.

Return JSON: {"overallScore":number,"missingSections":string[],"improvements":string[],"strengths":string[],"readinessLevel":"ready|needs_minor_edits|needs_major_revisions"}`,
        },
      ],
      temperature: 0.2,
      max_tokens: fastMode ? 900 : 1500,
    });
  } catch {
    return {
      overallScore: 50,
      missingSections: [],
      improvements: ["QA review could not be completed — manual review recommended"],
      strengths: [],
      readinessLevel: "needs_minor_edits",
    };
  }
}

/* ═══════════════════════════════════════════════════════════ */
/*            DECOMPOSITION ANALYSIS                           */
/* ═══════════════════════════════════════════════════════════ */

interface DecompositionAnalysis {
  projectType: string;
  projectIntent: string;
  stakeholders: string[];
  budgetIndicator: string;
  timelineIndicator: string;
  complexityLevel: string;
  isExistingRfp: boolean;
  keyFindings: string[];
  decomposition: Record<string, string>;
  inferredRequirements: string[];
}

const DECOMPOSITION_SYSTEM_PROMPT = `You are an expert procurement document analyst and project decomposition specialist.

Your task is to analyze documents and understand every aspect of the project.

STAGE 1 — INPUT ANALYSIS:
Determine the following from the document:
1. Project type and domain (software, manufacturing, consulting, government, infrastructure, smart city, etc.)
2. Government or enterprise stakeholders involved
3. Infrastructure components (hardware, sensors, cameras, networks)
4. Software platform components (cloud, APIs, databases)
5. Data collection sources and data engineering needs
6. AI/ML capabilities required
7. Security and compliance requirements
8. Integration with existing systems
9. Deployment scale and geographic scope
10. Timeline constraints and budget expectations
11. Operational goals and success metrics
12. Overall project intent and purpose

STAGE 2 — PROJECT DECOMPOSITION:
Break the project into HIGH-LEVEL subsystem categories. You MUST follow these strict rules:

MAXIMUM SUBSYSTEMS: 5. NEVER return more than 5 subsystems.

DECOMPOSITION PHILOSOPHY — only separate when domains are FUNDAMENTALLY DIFFERENT:
- A "subsystem" means a domain requiring a COMPLETELY DIFFERENT vendor skillset
- Frontend + Backend + Database + DevOps = ONE subsystem called "Software Platform" (same vendor builds all)
- Testing, training, deployment, monitoring = activities WITHIN a subsystem, NOT separate subsystems
- Only create separate subsystems for genuinely UNRELATED technical domains

VALID EXAMPLES:
- Smart City: "Infrastructure & IoT Hardware" + "Software Platform" + "AI/ML Analytics" (3 subsystems)
- E-commerce site: "Software Platform" (1 subsystem — NO decomposition)
- Manufacturing + Software: "Industrial Systems" + "Software Platform" (2 subsystems)
- Large enterprise IoT: "Physical Infrastructure" + "IoT & Edge Computing" + "Cloud Platform" + "AI Analytics" (4 subsystems)

INVALID — DO NOT DO THIS:
- Separating Frontend, Backend, Database, DevOps, Testing as different subsystems
- Creating more than 5 subsystems
- Making subsystems for project management, training, or deployment activities
- Treating security/compliance as a separate subsystem (it belongs in each subsystem)

WHEN TO DECOMPOSE (2+ subsystems):
- Project involves BOTH physical infrastructure AND software
- Project involves BOTH hardware/IoT AND cloud/AI
- Project spans 2+ genuinely unrelated engineering disciplines

WHEN NOT TO DECOMPOSE (1 subsystem):
- Standard web/mobile application (even if complex)
- Pure software project with typical layers (frontend, backend, database)
- Single-domain consulting or services engagement

COMPLEXITY GUIDELINES:
- "low": Single-purpose tool, script, or simple application
- "medium": Multi-technology project with clear scope (most software projects)
- "high": Enterprise/government project spanning physical + digital domains

For each subsystem, provide a detailed 2-3 sentence STRING description of what it entails.

Return your analysis as a JSON object with these exact keys:
- "projectType": string (software | manufacturing | consulting | government | infrastructure | other)
- "projectIntent": string (3-5 sentence comprehensive summary)
- "stakeholders": string[] (list of all stakeholder roles)
- "budgetIndicator": string (any budget/cost info found, or "Not specified")
- "timelineIndicator": string (any timeline info found, or "Not specified")
- "complexityLevel": string (low | medium | high)
- "isExistingRfp": boolean
- "keyFindings": string[] (5-10 key observations)
- "decomposition": object (keys are subsystem names, values are STRING descriptions — MAXIMUM 5 entries)
- "inferredRequirements": string[] (10-20 inferred requirements)

Return ONLY valid JSON. No markdown, no extra text.`;

async function analyzeForDecomposition(input: RfpInput): Promise<DecompositionAnalysis> {
  const sectionPairs = Object.entries(input.sections)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const userPrompt = `Analyze the following document thoroughly. Identify the project domain, all stakeholders, technical components, and decompose the project into logical subsystems.

---BEGIN DOCUMENT---
Project: ${input.project_title}
Organization: ${input.organization_name}
Category: ${input.category}

${sectionPairs}
${input.detailed_project_description ? `\nDetailed Description: ${input.detailed_project_description}` : ""}
${input.additional_details ? `\nAdditional Details: ${input.additional_details}` : ""}
---END DOCUMENT---

Provide your comprehensive analysis and decomposition as a JSON object.`;

  try {
    const result = await openRouterChatJSON<DecompositionAnalysis>({
      model: PIPELINE_MODELS.documentAnalysis,
      messages: [
        { role: "system", content: DECOMPOSITION_SYSTEM_PROMPT },
        { role: "user", content: truncate(userPrompt) },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    });

    return {
      projectType: result.projectType || "other",
      projectIntent: result.projectIntent || "",
      stakeholders: Array.isArray(result.stakeholders) ? result.stakeholders : [],
      budgetIndicator: result.budgetIndicator || "Not specified",
      timelineIndicator: result.timelineIndicator || "Not specified",
      complexityLevel: result.complexityLevel || "medium",
      isExistingRfp: !!result.isExistingRfp,
      keyFindings: Array.isArray(result.keyFindings) ? result.keyFindings : [],
      decomposition: result.decomposition && typeof result.decomposition === "object" ? result.decomposition : {},
      inferredRequirements: Array.isArray(result.inferredRequirements) ? result.inferredRequirements : [],
    };
  } catch (err) {
    console.error("Decomposition analysis failed:", err);
    return {
      projectType: "other",
      projectIntent: "",
      stakeholders: [],
      budgetIndicator: "Not specified",
      timelineIndicator: "Not specified",
      complexityLevel: "medium",
      isExistingRfp: false,
      keyFindings: [],
      decomposition: {},
      inferredRequirements: [],
    };
  }
}

/* ═══════════════════════════════════════════════════════════ */
/*            SUBSYSTEM RFP GENERATION                         */
/* ═══════════════════════════════════════════════════════════ */

async function generateSubsystemRfp(
  subsystemName: string,
  subsystemDescription: string,
  metadata: { organization_name: string; project_title: string; category: string },
  inferredRequirements: string[],
): Promise<Record<string, string>> {
  const reqsStr = inferredRequirements
    .slice(0, 8)
    .map((r) => `- ${r}`)
    .join("\n");

  const sectionsList = SUBSYSTEM_SECTIONS.map((s) => `- "${s}"`).join("\n");

  const prompt = `Generate these 10 sections for a STANDALONE subsystem RFP. Create DETAILED, COMPREHENSIVE sections (each 400-800 words).

PARENT PROJECT: ${metadata.project_title}
ORGANIZATION: ${metadata.organization_name}
SUBSYSTEM: ${subsystemName}
DESCRIPTION: ${subsystemDescription}

KEY REQUIREMENTS:
${reqsStr}

SECTIONS:
${sectionsList}

Use this exact format:
[SECTION: executive_summary]
(essay content)

[SECTION: project_overview]
(essay content)
... and so on for each section.

RULES:
- Each section: 600-1200 words, 4-6 detailed paragraphs with ### sub-headings
- ELABORATE extensively on the subsystem description in professional procurement language
- Include detailed standards, protocols, compliance requirements, certifications for "${subsystemName}"
- Include implementation approaches, best practices, and industry standards
- Keep the language formal, legal, and contract-ready
- Include detailed obligations, scope boundaries, assumptions, risks, mitigation, and acceptance criteria
- Add performance metrics, success criteria, and measurement approaches where relevant
- Do NOT wrap in JSON or code blocks.
- Aim for substantive, detailed professional content appropriate for a formal procurement document
`;

  const system =
    "Procurement writer creating a subsystem RFP. Use [SECTION: key] markers. Write essay paragraphs with ### sub-headings. Do NOT use JSON or code blocks.";

  const rawResponse = await sendPrompt(PIPELINE_MODELS.rfpGeneration, prompt, system, {
    temperature: 0.35,
    num_predict: 6000,
  });

  const parsedSections: Record<string, string> = {};

  for (const sectionKey of SUBSYSTEM_SECTIONS) {
    const pattern = "\\[SECTION:\\s*" + sectionKey + "\\s*\\]";
    const marker = new RegExp(pattern, "i");
    const match = rawResponse.match(marker);
    if (!match || match.index === undefined) continue;

    const start = match.index + match[0].length;
    const nextMarker = rawResponse.substring(start).match(/\[SECTION:\s*\w+\s*\]/i);
    const end = nextMarker?.index !== undefined ? start + nextMarker.index : rawResponse.length;
    const content = rawResponse.substring(start, end).trim();

    if (content.length >= 100) {
      parsedSections[sectionKey] = content;
    }
  }

  return parsedSections;
}

/* ═══════════════════════════════════════════════════════════ */
/*            PIPELINE ORCHESTRATOR                            */
/* ═══════════════════════════════════════════════════════════ */

export async function runGeneratePipeline(
  input: RfpInput,
  onProgress: (p: PipelineProgress) => void,
): Promise<PipelineResult> {
  const fastMode = !!input.fastMode;
  const skipDecomposition = !!input.skipDecomposition;
  // Decomposition adds: 1 analysis call + up to 5 subsystem calls
  const baseStages = GENERATION_BATCHES.length + 3; // batches + template + QA + PDF
  let totalStages = skipDecomposition ? baseStages : baseStages + 1; // +1 for decomposition analysis unless skipped
  let stageIndex = 0;

  const progress = (stage: string, message: string) => {
    stageIndex++;
    onProgress({
      stage,
      stageIndex,
      totalStages,
      message,
      percent: Math.round((stageIndex / totalStages) * 100),
    });
  };

  // Initialize decomposition data
  const decompositionData: DecompositionData = {
    subsystems: {},
    inferredRequirements: [],
    needsDecomposition: false,
    subsystemPdfs: [],
    subsystemDrafts: [],
  };

  // 0. Decomposition Analysis
  if (skipDecomposition) {
    progress("Project Analysis", "Using posted RFP content directly...");
  } else {
    progress("Project Analysis", "Analyzing project for decomposition...");
  }
  
  let analysis;
  if (skipDecomposition) {
    analysis = {
      decomposition: {},
      inferredRequirements: [],
    };
  } else if (input.precomputedDecomposition) {
    // Use precomputed decomposition from initial analysis
    console.log("✅ Using precomputed decomposition data (skipping re-analysis)");
    analysis = {
      decomposition: input.precomputedDecomposition.subsystems,
      inferredRequirements: input.precomputedDecomposition.inferredRequirements || [],
    };
  } else {
    // Perform decomposition analysis
    analysis = await analyzeForDecomposition(input);
  }

  const subsystemCount = Object.keys(analysis.decomposition).length;
  // Decompose whenever we have 2+ subsystems identified (regardless of complexity level)
  const shouldDecompose = subsystemCount >= 2;

  let decompositionContext = "";

  if (shouldDecompose) {
    // Cap at 5 subsystems
    const entries = Object.entries(analysis.decomposition).slice(0, 5);
    decompositionData.subsystems = Object.fromEntries(entries);
    decompositionData.inferredRequirements = analysis.inferredRequirements || [];
    decompositionData.needsDecomposition = true;

    // Update totalStages to include subsystem generation
    totalStages = baseStages + 1 + entries.length; // +1 analysis + N subsystem calls

    decompositionContext = "PROJECT DECOMPOSITION ANALYSIS:\n";
    for (const [name, desc] of entries) {
      decompositionContext += `- ${name}: ${desc}\n`;
    }
  } else {
    decompositionContext = "PROJECT CONTEXT:\n";
    decompositionContext += analysis.projectIntent || input.project_title;
    if (subsystemCount > 0) {
      decompositionContext += "\nIdentified components:\n";
      for (const [name, desc] of Object.entries(analysis.decomposition)) {
        decompositionContext += `- ${name}: ${desc}\n`;
      }
    }
  }

  if (analysis.inferredRequirements.length > 0) {
    decompositionContext += "\nINFERRED REQUIREMENTS:\n";
    for (const req of analysis.inferredRequirements) {
      decompositionContext += `- ${req}\n`;
    }
  }

  // 1. Synthesize seeds for all 25 sections
  const seeds: Record<string, string> = {};
  for (const key of RFP_SECTIONS) {
    seeds[key] = synthesizeSeed(
      key,
      input.sections,
      input.detailed_project_description,
      input.additional_details,
      input.qaRevisionNotes,
    );
  }

  // DEBUG: Log seed generation to verify user inputs are used
  console.log("📋 [SEED GENERATION] Synthesized seeds for all RFP sections:", {
    sections_count: Object.keys(input.sections).length,
    sections_with_values: Object.entries(input.sections).filter(([, v]) => v && v.toLowerCase() !== "auto").length,
    has_detailed_description: !!input.detailed_project_description && input.detailed_project_description.toLowerCase() !== "auto",
    has_additional_details: !!input.additional_details && input.additional_details.toLowerCase() !== "auto",
    seeds_generated: Object.entries(seeds)
      .map(([key, seed]) => ({ key, length: seed.length, preview: seed.slice(0, 100) }))
      .sort((a, b) => b.length - a.length),
  });

  const metadata = {
    organization_name: input.organization_name,
    project_title: input.project_title,
    category: input.category,
  };

  const presetTemplate = normalizeTemplateName((input as RfpInput & { selected_template?: string }).selected_template);

  // 2. Start template selection in parallel with first content batch
  const templatePromise = presetTemplate ? Promise.resolve(presetTemplate) : selectTemplate(input.category);

  // 3. Generate content in batches (5 sections per batch, 5 batches)
  const allSections: Record<string, string> = {};
  let consecutiveErrors = 0;

  if (fastMode) {
    progress("Content Generation", "Generating all sections in parallel draft mode...");
    const batchResults = await Promise.all(
      GENERATION_BATCHES.map(async (batchKeys, batchIndex) => {
        const batchLabels = batchKeys.map((k) => SECTION_LABELS[k]).join(", ");
        try {
          const batchResult = await generateBatch(batchKeys, seeds, metadata, {}, decompositionContext, true);
          return { batchIndex, batchKeys, batchLabels, batchResult };
        } catch (err) {
          console.error(`Batch ${batchIndex + 1} failed in fast mode:`, err);
          return { batchIndex, batchKeys, batchLabels, batchResult: {} as Partial<Record<SectionKey, string>> };
        }
      }),
    );

    for (const { batchKeys, batchResult } of batchResults.sort((left, right) => left.batchIndex - right.batchIndex)) {
      for (const key of batchKeys) {
        if (batchResult[key] && batchResult[key]!.length >= 100) {
          allSections[key] = batchResult[key]!;
        } else {
          const base = seeds[key] || `Content for ${SECTION_LABELS[key]} will be developed in consultation with stakeholders.`;
          allSections[key] = base;
        }
      }
    }
  } else {
    for (let i = 0; i < GENERATION_BATCHES.length; i++) {
      const batchKeys = GENERATION_BATCHES[i];
      const batchLabels = batchKeys.map((k) => SECTION_LABELS[k]).join(", ");
      progress("Content Generation", `Batch ${i + 1}/${GENERATION_BATCHES.length}: ${batchLabels}`);

      try {
        const batchResult = await generateBatch(batchKeys, seeds, metadata, allSections, decompositionContext);

        for (const key of batchKeys) {
          if (batchResult[key] && batchResult[key]!.length >= 100) {
            allSections[key] = batchResult[key]!;
          } else {
            const base = seeds[key] || `Content for ${SECTION_LABELS[key]} will be developed in consultation with stakeholders.`;
            allSections[key] = base;
          }
        }
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        console.error(`Batch ${i + 1} failed:`, err);

        for (const key of batchKeys) {
          allSections[key] = seeds[key] || `Content for ${SECTION_LABELS[key]} will be developed in consultation with stakeholders.`;
        }

        if (consecutiveErrors >= 3) {
          console.error("3 consecutive failures — aborting remaining. OpenRouter may be unavailable.");
          for (let j = i + 1; j < GENERATION_BATCHES.length; j++) {
            for (const key of GENERATION_BATCHES[j]) {
              allSections[key] = seeds[key] || `Content for ${SECTION_LABELS[key]} will be developed in consultation with stakeholders.`;
            }
          }
          break;
        }
      }
    }
  }

  // 4. Wait for template selection (ran in parallel with batch 1)
  progress("Template Selection", presetTemplate ? "Using selected PDF template..." : "Selecting PDF template...");
  const template = await templatePromise;

  // 5. QA Review
  progress("QA Review", "Reviewing RFP quality...");
  const qa = input.qaReview || (fastMode
    ? {
        overallScore: 50,
        missingSections: [],
        improvements: ["Fast mode used for background generation; run the full review for a polished final pass."],
        strengths: [],
        readinessLevel: "needs_minor_edits",
      }
    : await reviewQA(allSections, metadata));

  // 5.5 Expand short sections to meet word-count targets (only if significantly short)
  progress("Content Expansion", "Ensuring minimum section lengths...");
  const MIN_WORDS = 350; // Reduced threshold to skip more sections
  if (!fastMode) {
    for (const key of Object.keys(allSections) as SectionKey[]) {
      const wordCount = getWordCount(allSections[key]);
      if (wordCount < MIN_WORDS) {
        try {
          const expanded = await expandSection(key, allSections[key], metadata, MIN_WORDS);
          allSections[key] = expanded;
        } catch (e) {
          // ignore expansion failures
        }
      }
    }
  }

  // 6. PDF Generation (main RFP)
  progress("PDF Generation", "Generating PDF document...");
  const { generateRfpPdf } = await import("./pdf");
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  
  // Enhance sections with visual elements before PDF generation
  const enhancedSections = enhanceWithVisuals(allSections);
  
  const pdfBuffer: Uint8Array = await generateRfpPdf(
    { ...metadata, date: dateStr },
    enhancedSections,
    template as "software" | "manufacturing" | "consulting" | "government",
  );
  const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

  // 7. Subsystem RFP generation (only when decomposition is needed AND user selected subsystems)
  console.log("\n🔍 [SUBSYSTEM GENERATION START]");
  console.log("Decomposition data:", {
    needsDecomposition: decompositionData.needsDecomposition,
    subsystemCount: Object.keys(decompositionData.subsystems).length,
    subsystemNames: Object.keys(decompositionData.subsystems),
  });
  console.log("User input:", {
    selectedSubsystems: input.selectedSubsystems,
    selectedLength: (input.selectedSubsystems || []).length,
  });

  if (decompositionData.needsDecomposition && Object.keys(decompositionData.subsystems).length > 0) {
    const selectedSubsystems = input.selectedSubsystems || [];
    const shouldGenerateSubsystems = selectedSubsystems.length > 0 && !selectedSubsystems.includes("full");

    console.log("Decision logic:", {
      hasSelectedSubsystems: selectedSubsystems.length > 0,
      isNotFullOnly: !selectedSubsystems.includes("full"),
      shouldGenerateSubsystems,
    });

    if (shouldGenerateSubsystems) {
      console.log("Filtering subsystems...");
      const subsystemEntries = Object.entries(decompositionData.subsystems)
        .filter(([name]) => {
          const matches = selectedSubsystems.includes(name);
          console.log(`  Check subsystem "${name}": ${matches ? "✓ INCLUDED" : "✗ NOT IN SELECTION"}`);
          return matches;
        });

      console.log("Filter result:", {
        available: Object.keys(decompositionData.subsystems),
        selected: selectedSubsystems,
        matched: subsystemEntries.map(([name]) => name),
        matchCount: subsystemEntries.length,
      });

      progress(
        "Subsystem RFPs",
        `Generating ${subsystemEntries.length} subsystem RFP(s) in parallel…`,
      );

      // Generate all subsystems in parallel (3-4 at a time) instead of sequential
      const subsystemPromises = subsystemEntries.map(async ([subsystemName, subsystemDesc], idx) => {
        try {
          let parsedSections = await generateSubsystemRfp(
            subsystemName,
            subsystemDesc,
            metadata,
            decompositionData.inferredRequirements,
          );

          // Fallback 1: if fewer than 5 valid sections, copy from main RFP
          if (Object.keys(parsedSections).length < 5) {
            console.warn(`Subsystem "${subsystemName}" got <5 sections, falling back to main RFP sections`);
            parsedSections = {};
            for (const sKey of SUBSYSTEM_SECTIONS) {
              if (allSections[sKey]) {
                parsedSections[sKey] = allSections[sKey];
              }
            }
          }

          // Build subsystem PDF
          const sectionEntries = Object.entries(parsedSections)
            .filter(([, v]) => v.trim().length > 0)
            .map(([key, value]) => ({
              key,
              heading: SECTION_LABELS[key as SectionKey] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              body: value,
            }));

          const subsystemSectionsMap = Object.fromEntries(sectionEntries.map((e) => [e.key, e.body]));
          const subsystemSectionLabels = Object.fromEntries(sectionEntries.map((e) => [e.key, e.heading]));
          const enhancedSubsystemSections = enhanceWithVisuals(subsystemSectionsMap);
          const subsystemMetadata = {
            organization_name: metadata.organization_name,
            project_title: `${metadata.project_title} — ${subsystemName}`,
            category: metadata.category,
            date: dateStr,
          };

          const subPdfBuffer: Uint8Array = await generateRfpPdf(
            subsystemMetadata,
            enhancedSubsystemSections,
            template as "software" | "manufacturing" | "consulting" | "government",
          );

          decompositionData.subsystemDrafts.push({
            name: subsystemName,
            metadata: subsystemMetadata,
            sections: subsystemSectionsMap,
            sectionLabels: subsystemSectionLabels,
            template: template as "software" | "manufacturing" | "consulting" | "government",
            pdfBase64: Buffer.from(subPdfBuffer).toString("base64"),
          });

          decompositionData.subsystemPdfs.push({
            name: subsystemName,
            pdfBase64: Buffer.from(subPdfBuffer).toString("base64"),
          });
          console.log(`✓ Subsystem PDF created: "${subsystemName}" (${subPdfBuffer.length} bytes)`);
          return { success: true };
        } catch (err) {
          console.error(`❌ Failed subsystem "${subsystemName}":`, err);
          try {
            // Fallback 2: build from main RFP sections
            const fallbackSections: Record<string, string> = {};
            for (const sKey of SUBSYSTEM_SECTIONS) {
              if (allSections[sKey]) fallbackSections[sKey] = allSections[sKey];
            }

            const enhancedFallbackSections = enhanceWithVisuals(fallbackSections);
            const fallbackMetadata = {
              organization_name: metadata.organization_name,
              project_title: `${metadata.project_title} — ${subsystemName}`,
              category: metadata.category,
              date: dateStr,
            };

            const subPdfBuffer: Uint8Array = await generateRfpPdf(
              fallbackMetadata,
              enhancedFallbackSections,
              template as "software" | "manufacturing" | "consulting" | "government",
            );

            decompositionData.subsystemDrafts.push({
              name: subsystemName,
              metadata: fallbackMetadata,
              sections: fallbackSections,
              sectionLabels: Object.fromEntries(Object.keys(fallbackSections).map((key) => [key, SECTION_LABELS[key as SectionKey] ?? key])),
              template: template as "software" | "manufacturing" | "consulting" | "government",
              pdfBase64: Buffer.from(subPdfBuffer).toString("base64"),
            });

            decompositionData.subsystemPdfs.push({
              name: subsystemName,
              pdfBase64: Buffer.from(subPdfBuffer).toString("base64"),
            });
            return { success: true };
          } catch (fallbackErr) {
            console.error(`Fallback also failed for "${subsystemName}":`, fallbackErr);
            // Skip this subsystem — don't crash the pipeline
            return { success: false };
          }
        }
      });

      // Wait for all subsystems to complete in parallel
      await Promise.all(subsystemPromises);
    }
  }

  console.log("\n📊 [SUBSYSTEM GENERATION COMPLETE]", {
    subsystemPdfsGenerated: decompositionData.subsystemPdfs.length,
    subsystemNames: decompositionData.subsystemPdfs.map(p => p.name),
  });

  return {
    sections: allSections,
    sectionLabels: SECTION_LABELS as unknown as Record<string, string>,
    metadata: { ...metadata, date: dateStr },
    qa,
    template,
    pdfBase64,
    decomposition: decompositionData,
  };
}
