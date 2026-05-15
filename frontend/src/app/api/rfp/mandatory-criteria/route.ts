import { NextRequest, NextResponse } from "next/server";
import { openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";
import type { MandatoryCriteriaRecommendation } from "@/lib/rfp/config";

export const runtime = "nodejs";
export const maxDuration = 60;

interface MandatoryCriteriaRequestBody {
  organizationName?: string;
  projectTitle?: string;
  category?: string;
  selectedSubsystems?: string[];
  summary?: string;
  decomposition?: Record<string, string>;
}

function normalizeSubsystemName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function fallbackCriteria(labelPrefix: string): Array<{ label: string; value: number; recommendedValue: number; notes: string }> {
  return [
    { label: `${labelPrefix} completeness`, value: 80, recommendedValue: 80, notes: "Baseline coverage expectation" },
    { label: `${labelPrefix} technical fit`, value: 75, recommendedValue: 75, notes: "Match the selected subsystem scope" },
    { label: `${labelPrefix} compliance fit`, value: 70, recommendedValue: 70, notes: "Mandatory policy and standards alignment" },
  ];
}

function fallbackRecommendation(body: MandatoryCriteriaRequestBody): MandatoryCriteriaRecommendation {
  const selectedSubsystems = Array.isArray(body.selectedSubsystems) ? body.selectedSubsystems.filter(Boolean) : [];
  const normalizedSubsystems = selectedSubsystems.length > 0 ? selectedSubsystems : ["full_rfp"];

  return {
    fullRfp: normalizedSubsystems.includes("full_rfp") ? fallbackCriteria("Full RFP") : undefined,
    subsystems: Object.fromEntries(
      normalizedSubsystems
        .filter((name) => name !== "full_rfp")
        .map((name) => [name, fallbackCriteria(name.replace(/_/g, " "))]),
    ),
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as MandatoryCriteriaRequestBody;
  const selectedSubsystems = Array.isArray(body.selectedSubsystems)
    ? body.selectedSubsystems.map((name) => name.trim()).filter(Boolean)
    : [];

  try {
    const response = await openRouterChatJSON<MandatoryCriteriaRecommendation>({
      model: AGENT_MODEL.QUALITY_ASSURANCE,
      messages: [
        {
          role: "system",
          content:
            "You are a procurement workflow assistant. Return JSON only. Recommend a small set of mandatory criteria with starting slider values from 0 to 100. Keep the labels short, practical, and editable by the user.",
        },
        {
          role: "user",
          content: `Recommend mandatory criteria for the next RFP review phase.

Organization: ${body.organizationName || "Not provided"}
Project: ${body.projectTitle || "Not provided"}
Category: ${body.category || "other"}
Selected subsystems: ${selectedSubsystems.length > 0 ? selectedSubsystems.join(", ") : "full RFP"}
Project summary: ${body.summary || "Not provided"}
Subsystem notes: ${body.decomposition ? JSON.stringify(body.decomposition).slice(0, 4000) : "Not provided"}

Return JSON in this exact shape:
{
  "fullRfp": [{"label":"string","value":0,"recommendedValue":0,"notes":"string"}],
  "subsystems": {
    "subsystem_name": [{"label":"string","value":0,"recommendedValue":0,"notes":"string"}]
  }
}

Rules:
- Use 3 to 5 criteria per target subsystem.
- Each criterion must be measurable and procurement-relevant.
- The "value" field should match the recommended starting slider value.
- If a selected subsystem already has a clear scope, tailor the labels to that scope.
- If no subsystem list is provided, return a fullRfp set only.
- Do not include markdown or explanations.
- Keep labels concise enough to fit in a form row.
`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1800,
    });

    const normalized: MandatoryCriteriaRecommendation = {
      fullRfp: Array.isArray(response.fullRfp)
        ? response.fullRfp.map((item) => ({
            label: String(item.label || "Criteria"),
            value: Math.max(0, Math.min(100, Math.round(Number(item.value ?? item.recommendedValue ?? 50)))),
            recommendedValue: Math.max(0, Math.min(100, Math.round(Number(item.recommendedValue ?? item.value ?? 50)))),
            notes: typeof item.notes === "string" ? item.notes : undefined,
          }))
        : undefined,
      subsystems: Object.fromEntries(
        Object.entries(response.subsystems || {}).map(([name, items]) => [
          name,
          Array.isArray(items)
            ? items.map((item) => ({
                label: String(item.label || "Criteria"),
                value: Math.max(0, Math.min(100, Math.round(Number(item.value ?? item.recommendedValue ?? 50)))),
                recommendedValue: Math.max(0, Math.min(100, Math.round(Number(item.recommendedValue ?? item.value ?? 50)))),
                notes: typeof item.notes === "string" ? item.notes : undefined,
              }))
            : [],
        ]),
      ),
    };

    const normalizedSubsystemKeys = Object.keys(normalized.subsystems);
    if (normalizedSubsystemKeys.length === 0 && selectedSubsystems.length > 0) {
      for (const subsystem of selectedSubsystems) {
        normalized.subsystems[normalizeSubsystemName(subsystem)] = fallbackCriteria(subsystem.replace(/_/g, " "));
      }
    }

    if (!normalized.fullRfp && selectedSubsystems.length === 0) {
      normalized.fullRfp = fallbackCriteria("Full RFP");
    }

    return NextResponse.json(normalized);
  } catch (error: unknown) {
    console.warn("Mandatory criteria recommendation failed:", error);
    return NextResponse.json(fallbackRecommendation({ selectedSubsystems, organizationName: body.organizationName, projectTitle: body.projectTitle, category: body.category }), { status: 200 });
  } finally {
    await langfuse.flushAsync();
  }
}
