import { NextRequest, NextResponse } from "next/server";
import { openRouterChat, AGENT_MODEL } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";

const MAX_FIELD_CHARS = 15000;
const REQUIRED_FIELDS = ["project_title", "organization_name"];

function sanitizeField(input: any): string {
  if (input === null || input === undefined) return "";
  let s = String(input);
  s = s.replace(/\b(ignore|disregard) (previous|above) instructions\b/ig, "");
  if (s.length > MAX_FIELD_CHARS) s = s.slice(0, MAX_FIELD_CHARS);
  return s.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    for (const f of REQUIRED_FIELDS) {
      if (!body?.[f]) {
        return NextResponse.json({ error: `${f} is required` }, { status: 400 });
      }
    }

    // Accept ALL intake fields (both metadata and sections)
    const metadata = {
      organization_name: sanitizeField(body.organization_name),
      project_title: sanitizeField(body.project_title),
      category: sanitizeField(body.category || "other"),
    };

    // Collect all provided sections/fields
    const userSections: Record<string, string> = {};
    const allIntakeFields = [
      "organization_background", "project_overview", "project_objectives",
      "scope_of_work", "detailed_project_description", "technical_requirements",
      "deliverables", "vendor_qualifications", "implementation_timeline",
      "budget_framework", "evaluation_criteria", "risk_management",
      "cybersecurity_compliance", "legal_and_contractual",
      "submission_instructions", "contact_information",
      // Also accept simple field names that might be sent
      "description", "budget", "deadline", "industry", "required_certifications",
      "mission_objective", "additional_details"
    ];

    for (const field of allIntakeFields) {
      if (body[field]) {
        const sanitized = sanitizeField(body[field]);
        if (sanitized) {
          // Map simple field names to section keys if needed
          const sectionKey = field === "mission_objective" ? "project_objectives" :
                           field === "description" ? "project_overview" :
                           field === "industry" ? "category" :
                           field === "required_certifications" ? "cybersecurity_compliance" :
                           field;
          userSections[sectionKey] = sanitized;
        }
      }
    }

    // Format user data for inclusion in prompt
    const userDataDisplay = Object.entries(userSections)
      .filter(([_, v]) => v && v.length > 0)
      .map(([k, v]) => `${k.replace(/_/g, " ").toUpperCase()}:\n${v}`)
      .join("\n\n---\n\n");

    const system = `You are an expert procurement consultant. Your task is to generate professional RFP sections that PRESERVE and EXPAND user-provided intake data.

CRITICAL RULES:
1. PRESERVE all user-provided intake data EXACTLY as given
2. EXPAND it with professional detail, standards, metrics, and best practices
3. Structure each response as: [User Input] + [Professional Context] + [Standards/Metrics]
4. NEVER invent contact info, names, numbers, dates, or budget details
5. If a field is missing, write a professional placeholder explaining what vendors must provide
6. Use formal RFP/procurement language throughout
7. Return valid markdown with clear section headings`;

    const userContent = `You are generating an RFP document.

AVAILABLE USER INTAKE DATA:
${userDataDisplay || "(Minimal user data provided - use as foundation)"}

---

ORG: ${metadata.organization_name}
PROJECT: ${metadata.project_title}
CATEGORY: ${metadata.category}

TASK: Generate all 25 RFP sections. For each section:
- If user data exists for that topic, START with it and expand professionally
- If user data is sparse, synthesize from related fields and add professional detail
- Use ### headings for subsections
- Include metrics, standards, compliance requirements
- Keep formal, contract-ready tone
- Make sections 300-500 words each
- NO invented names, contact details, or confidential data

SECTIONS TO WRITE (in order):
1. Executive Summary - strategic overview and business case
2. Organization Background - company history and capabilities
3. Vision & Strategy - strategic alignment with goals
4. Project Overview - high-level description and context
5. Project Objectives - SMART goals and success metrics
6. Scope of Work - in-scope and out-of-scope
7. System Architecture - technical design and patterns
8. Infrastructure Requirements - hardware, cloud, networking
9. Software Platform Requirements - OS, databases, APIs
10. AI & Data Analytics - ML capabilities and data pipelines
11. Cybersecurity & Compliance - security standards and controls
12. Data Governance - data classification and retention
13. Integration Requirements - system integrations and APIs
14. Deployment Strategy - phased rollout and environments
15. Technical Requirements - functional and non-functional specs
16. Deliverables - all project deliverables and acceptance
17. Implementation Timeline - phases, milestones, and dependencies
18. Vendor Qualifications - required experience and certifications
19. Support & Maintenance - SLA and warranty terms
20. Risk Management - risks, mitigation, contingencies
21. Budget Framework - cost breakdown and payment terms
22. Evaluation Criteria - scoring methodology and weights
23. Legal & Contractual - terms, IP, NDA, liability
24. Submission Instructions - format, deadline, requirements
25. Contact Information - primary contacts and details

For each, use this format:
### [Section Title]
[User input if available, or placeholder]

[Professional expansion with standards, metrics, examples, best practices]

Start writing all 25 sections now:`;

    console.log("[RFP-Gen] Request received with intake data:", {
      organization_name: metadata.organization_name,
      project_title: metadata.project_title,
      category: metadata.category,
      collected_sections: Object.keys(userSections),
      user_data_preview: userDataDisplay.slice(0, 200),
    });

    const rfpContent = await openRouterChat({
      model: AGENT_MODEL.RFP_WRITING,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      max_tokens: 8000,
      temperature: 0.2,
      top_p: 0.9,
    });

    console.log("[RFP-Gen] RFP content generated, length:", rfpContent?.length || 0);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate RFP";
    console.error("RFP generation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await langfuse.flushAsync();
  }
}
