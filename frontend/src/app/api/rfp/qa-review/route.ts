import { NextRequest, NextResponse } from "next/server";
import { openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { FINAL_INTAKE_KEY, RFP_QUESTIONS, SECTION_LABELS, getFinalIntakeQuestionLabel, type QAResult, type PdfTemplate } from "@/lib/rfp/config";

interface QaReviewRequestBody {
  answers?: Record<string, string>;
  selectedTemplate?: PdfTemplate;
  selectedSubsystems?: string[];
  mandatorySections?: string[];
  projectTitle?: string;
  organizationName?: string;
  category?: string;
  additionalDetails?: string;
}

interface QaReviewResponse {
  qa: QAResult;
  missingRequired: string[];
  missingQuestionKey: string | null;
  missingQuestionLabel: string | null;
}

interface SmartQaResult {
  overallScore: number;
  dimensionScores: {
    completeness: number;
    specificity: number;
    feasibility: number;
    compliance: number;
    vendorReadiness: number;
  };
  fieldAnalysis: Array<{
    field: string;
    status: "strong" | "weak" | "missing";
    issue?: string;
    suggestion?: string;
  }>;
  missingSections: string[];
  improvements: string[];
  mentorFeedback: string;
  readinessLevel: "ready" | "needs_minor_edits" | "needs_major_revisions";
  executiveSummary: string;
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getQuestionLabel(key: string): string {
  const q = RFP_QUESTIONS.find((item) => item.key === key);
  if (q) return q.label.replace(/ \(or type "auto"\)/g, "");
  if (key === FINAL_INTAKE_KEY) return getFinalIntakeQuestionLabel();
  return key;
}

function normalizeSectionKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Applies a completeness multiplier to cap the max possible score
 * based on how many fields were actually answered vs skipped/empty.
 *
 * Formula: final = rawScore × 0.35 + completionRatio × 100 × 0.65
 *
 * Examples:
 *  2/20 answered → raw 70 → 70×0.35 + 10×0.65  = 24.5 + 6.5  = 31
 * 10/20 answered → raw 70 → 70×0.35 + 50×0.65  = 24.5 + 32.5 = 57
 * 20/20 answered → raw 90 → 90×0.35 + 100×0.65 = 31.5 + 65   = 97
 */
function applyCompletionPenalty(rawScore: number, answeredCount: number, totalCount: number): number {
  const ratio = totalCount > 0 ? answeredCount / totalCount : 0;
  return Math.max(0, Math.min(100, Math.round(rawScore * 0.35 + ratio * 100 * 0.65)));
}

function deriveReadiness(score: number): QAResult["readinessLevel"] {
  if (score >= 72) return "ready";
  if (score >= 42) return "needs_minor_edits";
  return "needs_major_revisions";
}

function normalizeScore(raw: unknown, fallback = 50): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const scaled = n <= 10 ? n * 10 : n;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as QaReviewRequestBody;
  const answers = body.answers ?? {};
  const mandatorySections = Array.isArray(body.mandatorySections)
    ? body.mandatorySections.map(normalizeSectionKey).filter(Boolean)
    : [];

  // ─── Completeness accounting ─────────────────────────────────────────────
  const totalRfpFields = RFP_QUESTIONS.length; // 20
  const answeredFields   = RFP_QUESTIONS.filter((q) => normalize(answers[q.key]));
  const emptyFields      = RFP_QUESTIONS.filter((q) => !normalize(answers[q.key]));
  const missingRequired  = emptyFields.map((q) => q.key);

  if (!normalize(answers[FINAL_INTAKE_KEY])) missingRequired.push(FINAL_INTAKE_KEY);

  const missingQuestionKey   = missingRequired[0] ?? null;
  const missingQuestionLabel = missingQuestionKey ? getQuestionLabel(missingQuestionKey) : null;

  // ─── Build answered-fields snapshot for the LLM ──────────────────────────
  // Give the LLM the FULL answer text (up to 300 chars per field) so it can
  // evaluate quality/depth, not just presence.
  const answeredSummary = answeredFields.length > 0
    ? answeredFields
        .map((q) => `  • ${getQuestionLabel(q.key)}: "${normalize(answers[q.key]).slice(0, 300)}${normalize(answers[q.key]).length > 300 ? "…" : ""}"`)
        .join("\n")
    : "  (none — no fields were answered)";

  const missingFieldLines = emptyFields.length > 0
    ? emptyFields
        .map((q) => `  • ${getQuestionLabel(q.key)}`)
        .join("\n")
    : "  (none — all fields answered)";

  const completionNote = `${answeredFields.length} of ${totalRfpFields} intake fields answered.`;

  // ─── Smart LLM call ──────────────────────────────────────────────────────
  try {
    const smartQa = await openRouterChatJSON<SmartQaResult>({
      model: AGENT_MODEL.QUALITY_ASSURANCE,
      messages: [
        {
          role: "system",
          content: `You are an elite procurement mentor and QA specialist who has reviewed thousands of RFPs. You analyse both WHAT is provided AND the QUALITY/DEPTH of each answer.

YOUR MAIN JOB — quality analysis of the intake content:
1. Read every answered field and judge its quality: Is it vague? Missing specific numbers/metrics/standards? Could a vendor misunderstand it? Does it leave ambiguity?
2. "fieldAnalysis": ONLY include "weak" and "missing" fields (skip all "strong" fields to keep the response concise). For each weak/missing field include the issue and a concrete suggestion. Phrase all suggestions as friendly, constructive recommendations to include/add more details rather than command-style instructions (like "Add...", "Provide...").
3. "improvements" — max 6 suggestions, PRIORITISED BY IMPACT:
   - At least 3–4 suggestions must be about IMPROVING QUALITY of weak answered fields (e.g. add specific numbers, define standards, clarify scope). These are most valuable.
   - Only the last 1–2 suggestions should address truly missing fields if any.
   - Each suggestion must quote the actual answer and explain what specifically is missing from it.
   - Format: Phrase all suggestions as gentle suggestions to add, include, or consider expanding more stuff rather than saying and ordering to add (e.g. use "Consider including...", "You could add...", "It would be beneficial to specify...", "To make this section stronger for vendors, you might want to add..." instead of "Add...", "Provide...", "Define...").
   - Format template: "[Field Name]: Your answer says '[quote]'. You could include [specific detail, e.g. metric/standard/number] to provide more depth for vendors."
4. "mentorFeedback" — a 3–5 sentence paragraph like a real mentor reading the intake: what reads well/professionally, what is too vague or underdeveloped, what gaps hurt vendors most. Reference actual answer content.
5. "executiveSummary" — 1–2 sentence honest verdict.

CRITICAL: Do NOT just list missing fields as suggestions. Weak quality in answered fields is MORE important to flag. Give suggestions that make the RFP more competitive and clear for vendors.

Return ONLY valid JSON:
{
  "overallScore": number,
  "dimensionScores": { "completeness": number, "specificity": number, "feasibility": number, "compliance": number, "vendorReadiness": number },
  "fieldAnalysis": [{ "field": "label", "status": "weak|missing", "issue": "what is weak", "suggestion": "what to add" }],
  "missingSections": ["string"],
  "improvements": ["string — concrete, field-specific"],
  "mentorFeedback": "string",
  "readinessLevel": "ready|needs_minor_edits|needs_major_revisions",
  "executiveSummary": "string"
}`,
        },
        {
          role: "user",
          content: `Evaluate this RFP intake. Focus especially on the QUALITY and DEPTH of each answered field. Identify weak answers that need more specifics, metrics, or clarity.

PROJECT: ${normalize(body.projectTitle) || "Not provided"}
ORGANIZATION: ${normalize(body.organizationName) || "Not provided"}
CATEGORY: ${normalize(body.category) || "other"}
TEMPLATE: ${body.selectedTemplate ?? "not selected"}
SUBSYSTEMS: ${(body.selectedSubsystems ?? []).join(", ") || "full RFP"}
${mandatorySections.length > 0 ? `MANDATORY SECTIONS: ${mandatorySections.join(", ")}` : ""}

── ANSWERED FIELDS (${answeredFields.length}/${totalRfpFields}) — Analyse each for quality/depth ──────────
${answeredSummary}

── MISSING/EMPTY FIELDS (${emptyFields.length}) ────────────────────────────────────────
${missingFieldLines}

── HOW TO SCORE ──────────────────────────────────────
- completeness:    % of fields actually filled. 0 missing = near 100.
- specificity:     Are answered fields detailed? Numbers, standards, deadlines, measurable goals? Vague = low.
- feasibility:     Is scope/timeline/budget realistic and internally consistent?
- compliance:      Are security/legal/regulatory/contractual requirements specific and present?
- vendorReadiness: Can a vendor write a precise, competitive proposal from this intake alone?

── WHAT MAKES A SUGGESTION GREAT ────────────────────
BAD: "Provide budget framework — this is needed for vendors" (too generic)
BAD: "Budget Framework: Your answer says 'Estimated budget: TBD'. Specify a range and milestones." (too commanding/direct)
GOOD: "Budget Framework: Your answer says 'Estimated budget: TBD'. Consider specifying a budget range (e.g., USD 200K–400K) and outlining payment milestones (e.g., 30% on kickoff, 40% on beta, 30% on production handoff) to make this clear for vendors."

BAD: "Add project objectives" (too generic)
BAD: "Project Objectives: Add 3 SMART KPIs." (too commanding/direct)
GOOD: "Project Objectives: Your answer mentions 'improve efficiency' with no metric. You could include 3 SMART KPIs such as: 'Reduce processing time by 35% within 90 days', 'Achieve 99.5% uptime SLA from month 3', or 'Train all staff within 4 weeks of go-live' to help vendors understand success criteria."

Always quote the user's actual answer, specify exactly what is missing, and phrase it as a friendly recommendation to include or add more details.
${mandatorySections.length > 0 ? `\nIMPORTANT: Treat mandatory sections (${mandatorySections.join(", ")}) as high-priority. Flag if any lack sufficient detail.` : ""}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });

    // ─── Normalise scores ─────────────────────────────────────────────────
    const rawLlmScore = normalizeScore(smartQa.overallScore);
    const penalisedScore = applyCompletionPenalty(rawLlmScore, answeredFields.length, totalRfpFields);

    const dims = smartQa.dimensionScores ?? {};
    const scoreBreakdown = {
      completeness:    normalizeScore(dims.completeness,    50),
      specificity:     normalizeScore(dims.specificity,     50),
      vendorReadiness: normalizeScore(dims.vendorReadiness, 50),
      compliance:      normalizeScore(dims.compliance,      50),
    };

    // ─── Build improvements from fieldAnalysis when improvements list is thin ─
    let improvements: string[] = (Array.isArray(smartQa.improvements) ? smartQa.improvements : []).slice(0, 6);
    if (improvements.length < 2 && Array.isArray(smartQa.fieldAnalysis)) {
      const fromFields = smartQa.fieldAnalysis
        .filter((f) => (f.status === "missing" || f.status === "weak") && f.suggestion)
        .map((f) => f.suggestion as string)
        .slice(0, 6);
      improvements = [...new Set([...improvements, ...fromFields])];
    }

    // ─── Add mandatory section warnings if provided ───────────────────────
    const mandatoryMissingSections = mandatorySections
      .map((key) => SECTION_LABELS[key as keyof typeof SECTION_LABELS] || key)
      .filter((label) => !(smartQa.missingSections ?? []).includes(label));
    const allMissingSections = [...new Set([...(smartQa.missingSections ?? []), ...mandatoryMissingSections])];

    const response: QaReviewResponse = {
      qa: {
        overallScore: penalisedScore,
        missingSections: allMissingSections,
        improvements,
        strengths: [smartQa.mentorFeedback || smartQa.executiveSummary || ""],
        readinessLevel: deriveReadiness(penalisedScore),
        scoreExplanation: smartQa.executiveSummary ?? "",
        scoreBreakdown,
      },
      missingRequired,
      missingQuestionKey,
      missingQuestionLabel,
    };

    return NextResponse.json(response);

  } catch (error: unknown) {
    // ─── Graceful fallback ────────────────────────────────────────────────
    const message = error instanceof Error ? error.message : String(error);
    const fallbackRaw = Math.round(30 + (answeredFields.length / totalRfpFields) * 40);
    const fallbackScore = applyCompletionPenalty(fallbackRaw, answeredFields.length, totalRfpFields);

    const fallbackImprovements = emptyFields.slice(0, 5).map((q) => {
      const label = getQuestionLabel(q.key);
      return `Consider providing details for ${label} — this would help vendors prepare a more competitive response.`;
    });
    if (fallbackImprovements.length === 0) {
      fallbackImprovements.push("QA review could not be completed. Please review the intake manually.");
    }

    const fallback: QaReviewResponse = {
      qa: {
        overallScore: fallbackScore,
        missingSections: [...missingRequired.map(getQuestionLabel), ...mandatorySections.map((k) => SECTION_LABELS[k as keyof typeof SECTION_LABELS] || k)],
        improvements: fallbackImprovements,
        strengths: answeredFields.length > 0
          ? [`Your intake has ${answeredFields.length} out of ${totalRfpFields} fields answered. While this is a good start, there are missing sections that need to be addressed. Review the suggestions below to improve completeness.`]
          : ["No intake content was provided. Please go back to the intake step and fill out the questions so I can analyze your project details and guide you."],
        readinessLevel: deriveReadiness(fallbackScore),
        scoreExplanation: `Auto-scored: ${answeredFields.length}/${totalRfpFields} fields answered. QA review failed: ${message}`,
      },
      missingRequired,
      missingQuestionKey,
      missingQuestionLabel,
    };

    return NextResponse.json({ ...fallback, error: message }, { status: 200 });
  }
}