import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_MODELS } from "@/lib/rfp/config";
import { openRouterChatJSON } from "@/lib/openrouter";
import type { RfpInput, DecompositionData } from "@/lib/rfp/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const DECOMPOSITION_SYSTEM_PROMPT = `You are an expert procurement document analyst and project decomposition specialist.

Your task is to analyze documents and understand every aspect of the project.

Analyze thoroughly and provide ONLY a valid JSON object with the keys listed below. NO other text.

Return your analysis as a JSON object with these exact keys:
- "projectType": string
- "decomposition": object (keys are subsystem names, values are STRING descriptions — MAXIMUM 5 entries)
- "inferredRequirements": string[] (10-20 inferred requirements)`;

interface DecompositionAnalysis {
  projectType?: string;
  decomposition?: Record<string, string>;
  inferredRequirements?: string[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as RfpInput;

    const sectionPairs = Object.entries(body.sections)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const userPrompt = `Analyze the following document. Identify and decompose the project into logical subsystems.

---BEGIN DOCUMENT---
Project: ${body.project_title}
Organization: ${body.organization_name}
Category: ${body.category}

${sectionPairs}
${body.detailed_project_description ? `\nDetailed Description: ${body.detailed_project_description}` : ""}
${body.additional_details ? `\nAdditional Details: ${body.additional_details}` : ""}
---END DOCUMENT---

Provide your analysis as a JSON object.`;

    const result = await openRouterChatJSON<DecompositionAnalysis>(
      {
        model: PIPELINE_MODELS.documentAnalysis,
        messages: [
          { role: "system", content: DECOMPOSITION_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }
    );

    const decomposition: Record<string, string> = {};
    if (result.decomposition && typeof result.decomposition === "object") {
      Object.entries(result.decomposition).forEach(([key, value]) => {
        decomposition[key] = String(value);
      });
    }

    const response: DecompositionData = {
      subsystems: decomposition,
      inferredRequirements: Array.isArray(result.inferredRequirements) ? result.inferredRequirements : [],
      needsDecomposition: Object.keys(decomposition).length >= 2,
      subsystemPdfs: [],
      subsystemDrafts: [],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Decomposition analysis failed:", error);
    return NextResponse.json(
      { error: "Decomposition analysis failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
