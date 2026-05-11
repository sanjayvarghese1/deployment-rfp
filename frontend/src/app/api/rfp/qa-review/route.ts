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

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getQuestionLabel(key: string): string {
  const question = RFP_QUESTIONS.find((item) => item.key === key);
  if (question) return question.label;
  if (key === FINAL_INTAKE_KEY) return getFinalIntakeQuestionLabel();
  return key;
}

function normalizeSectionKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeQaScore(rawScore: unknown): number {
  const parsed = typeof rawScore === "number" ? rawScore : Number(rawScore);
  if (!Number.isFinite(parsed)) return 50;
  const scaled = parsed <= 10 ? parsed * 10 : parsed;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function normalizeQaResult(qa: QAResult, mandatorySections: string[]): QAResult {
  const missingSections = Array.from(
    new Set([
      ...(qa.missingSections || []),
      ...mandatorySections.map((key) => SECTION_LABELS[key as keyof typeof SECTION_LABELS] || key),
    ]),
  );

  return {
    ...qa,
    overallScore: normalizeQaScore(qa.overallScore),
    missingSections,
    improvements: (qa.improvements || []).slice(0, 6),
    strengths: (qa.strengths || []).slice(0, 4),
    scoreBreakdown: qa.scoreBreakdown,
  };
}

function buildScoreExplanation(_qa: QAResult, _mandatorySections: string[], _missingRequired: string[]): string {
  // Suppress human-readable score descriptions; explanation intentionally empty.
  return "";
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as QaReviewRequestBody;
  const answers = body.answers || {};
  const mandatorySections = Array.isArray(body.mandatorySections)
    ? body.mandatorySections.map(normalizeSectionKey).filter(Boolean)
    : [];

  const missingRequired = RFP_QUESTIONS
    .map((question) => question.key)
    .filter((key) => !normalize(answers[key]));

  if (!normalize(answers[FINAL_INTAKE_KEY])) {
    missingRequired.push(FINAL_INTAKE_KEY);
  }

  const missingQuestionKey = missingRequired[0] || null;
  const missingQuestionLabel = missingQuestionKey ? getQuestionLabel(missingQuestionKey) : null;

  try {
    const qa = await openRouterChatJSON<QAResult>(
      {
        model: AGENT_MODEL.QUALITY_ASSURANCE,
        messages: [
          {
            role: "system",
            content:
              "You are a senior procurement QA scorer. Evaluate completeness, specificity, feasibility, compliance coverage, and vendor-readiness. Return JSON only. Scores must be on a 0-100 scale, where 100 is excellent and 0 is unusable.",
          },
          {
            role: "user",
            content: `Review the user's RFP intake before generation.

Project title: ${normalize(body.projectTitle) || "Not provided"}
Organization: ${normalize(body.organizationName) || "Not provided"}
Category: ${normalize(body.category) || "other"}
Template: ${body.selectedTemplate || "not selected"}
Selected subsystems: ${(body.selectedSubsystems || []).join(", ") || "full RFP"}
Organization mandatory sections for QA: ${mandatorySections.length > 0 ? mandatorySections.join(", ") : "none specified"}

Answers:
${JSON.stringify(answers, null, 2)}

Focus on whether the intake is complete, whether the answer set is specific enough for generation, and what the user should improve before generation.

If organization mandatory sections are provided, treat them as higher-priority QA focus areas and mention them in missingSections when the current intake does not give enough detail to support them.

Use short, concrete, point-wise suggestions. Prefer measurable improvements and explicit examples.

Return JSON with this exact shape:
{"overallScore":number,"missingSections":string[],"improvements":string[],"strengths":string[],"readinessLevel":"ready|needs_minor_edits|needs_major_revisions"}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      }
    );

    const response: QaReviewResponse = {
      qa: {
        ...normalizeQaResult(qa, mandatorySections),
        scoreExplanation: buildScoreExplanation(qa, mandatorySections, missingRequired),
      },
      missingRequired,
      missingQuestionKey,
      missingQuestionLabel,
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback: QaReviewResponse = {
      qa: {
        overallScore: 50,
        missingSections: Array.from(new Set([...missingRequired, ...mandatorySections.map(getQuestionLabel)])),
        improvements: ["QA review could not be completed. Please review the intake manually."],
        strengths: [],
        readinessLevel: "needs_minor_edits",
        scoreExplanation: buildScoreExplanation({ overallScore: 50, missingSections: [], improvements: [], strengths: [], readinessLevel: "needs_minor_edits" }, mandatorySections, missingRequired),
      },
      missingRequired,
      missingQuestionKey,
      missingQuestionLabel,
    };

    return NextResponse.json({ ...fallback, error: message }, { status: 200 });
  }
}