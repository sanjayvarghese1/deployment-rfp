import { NextRequest, NextResponse } from "next/server";
import { callOllamaGenerate, resolvePreferredModel, safeParseJson, isOllamaRunning } from "@/lib/ai/ollamaApi";

export const runtime = "nodejs";

const OLLAMA_OPTIONS = {
  num_predict: 1024,
  temperature: 0.3,
  top_p: 0.9,
  repeat_penalty: 1.1,
};

interface RequirementMappingItem {
  requirement: string;
  vendor_capability: string;
  status: "MATCH" | "PARTIAL" | "GAP";
  value_score: number;
  rationale: string;
}

interface PricingBreakdownItem {
  label: string;
  amount: number | string;
  reason: string;
}

interface ValueAnalysisPayload {
  executive_summary: string;
  requirement_mapping: RequirementMappingItem[];
  pricing_breakdown: PricingBreakdownItem[];
  value_justification: string;
  timeline: string;
  risk_mitigation: string[];
  stage_errors: string[];
}

function toVendorProfileText(vendorProfile: unknown): string {
  if (!vendorProfile || typeof vendorProfile !== "object") return "{}";
  return JSON.stringify(vendorProfile, null, 2);
}

async function runStage<T>(stageName: string, prompt: string): Promise<T> {
  console.time(`generate-vendor-response:${stageName}`);
  try {
    const model = await resolvePreferredModel();
    if (!model) throw new Error("Ollama not running");
    const response = await callOllamaGenerate({
      model,
      prompt,
      options: OLLAMA_OPTIONS,
      timeoutMs: 60_000,
    });
    return safeParseJson<T>(response, {} as T);
  } finally {
    console.timeEnd(`generate-vendor-response:${stageName}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rfpContent, vendorProfile, contractId } = body ?? {};

    if (!rfpContent || typeof rfpContent !== "string") {
      return NextResponse.json({ error: "rfpContent is required" }, { status: 400 });
    }
    if (!vendorProfile || typeof vendorProfile !== "object") {
      return NextResponse.json({ error: "vendorProfile is required" }, { status: 400 });
    }

    if (!(await isOllamaRunning())) {
      return NextResponse.json({ error: "Ollama not running", hint: "Run: ollama serve" }, { status: 503 });
    }

    const vendorProfileText = toVendorProfileText(vendorProfile);
    const baseContext = `Contract ID: ${String(contractId ?? "N/A")}\n\nRFP CONTENT:\n${rfpContent}\n\nVENDOR PROFILE:\n${vendorProfileText}`;
    const stageErrors: string[] = [];

    const [requirements, capabilityMap, pricing] = await Promise.all([
      runStage<{
        executive_summary: string;
        must_haves: string[];
        nice_to_haves: string[];
        risk_notes: string[];
      }>(
        "requirements",
        `Think internally and return only JSON. Parse the RFP and identify hard requirements vs nice-to-haves.\n\n${baseContext}\n\nReturn JSON:\n{\n  "executive_summary": "1-2 sentence summary of the deal",\n  "must_haves": ["hard requirement"],\n  "nice_to_haves": ["optional feature"],\n  "risk_notes": ["scope or compliance risk"]\n}`,
      ).catch((error) => {
        stageErrors.push(`requirements: ${error instanceof Error ? error.message : String(error)}`);
        return { executive_summary: "", must_haves: [], nice_to_haves: [], risk_notes: [] };
      }),
      runStage<{ requirement_mapping: RequirementMappingItem[]; capability_gaps: string[] }>(
        "capability_mapping",
        `Think internally and return only JSON. Map the vendor's capabilities to each RFP requirement and score each fit. Use statuses MATCH, PARTIAL, or GAP.\n\n${baseContext}\n\nReturn JSON:\n{\n  "requirement_mapping": [\n    {\n      "requirement": "...",\n      "vendor_capability": "...",\n      "status": "MATCH",\n      "value_score": 0,\n      "rationale": "..."\n    }\n  ],\n  "capability_gaps": ["gap"]\n}`,
      ).catch((error) => {
        stageErrors.push(`capability_mapping: ${error instanceof Error ? error.message : String(error)}`);
        return { requirement_mapping: [], capability_gaps: [] };
      }),
      runStage<{
        pricing_breakdown: PricingBreakdownItem[];
        value_justification: string;
        timeline: string;
        risk_mitigation: string[];
      }>(
        "pricing_strategy",
        `Think internally and return only JSON. Build a pricing strategy using price-to-value framing. Quantify ROI for the buyer and explain why the price is justified. Use the vendor profile and RFP requirements to assign value to each major requirement.\n\n${baseContext}\n\nReturn JSON:\n{\n  "pricing_breakdown": [\n    {"label": "Implementation", "amount": 0, "reason": "..."}\n  ],\n  "value_justification": "Explain ROI and why the proposed price is defensible.",\n  "timeline": "Concise delivery timeline with milestones.",\n  "risk_mitigation": ["risk mitigation action"]\n}`,
      ).catch((error) => {
        stageErrors.push(`pricing_strategy: ${error instanceof Error ? error.message : String(error)}`);
        return { pricing_breakdown: [], value_justification: "", timeline: "", risk_mitigation: [] };
      }),
    ]);

    const response: ValueAnalysisPayload = {
      executive_summary: requirements.executive_summary || `Tailored vendor response for contract ${String(contractId ?? "N/A")}.`,
      requirement_mapping: capabilityMap.requirement_mapping || [],
      pricing_breakdown: pricing.pricing_breakdown || [],
      value_justification: pricing.value_justification || "",
      timeline: pricing.timeline || "",
      risk_mitigation: Array.from(new Set([...(pricing.risk_mitigation || []), ...(requirements.risk_notes || []), ...(capabilityMap.capability_gaps || [])])),
      stage_errors: stageErrors,
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Ollama not running|connect|ECONNREFUSED|fetch failed/i.test(message)) {
      return NextResponse.json({ error: "Ollama not running", hint: "Run: ollama serve" }, { status: 503 });
    }
    return NextResponse.json({ error: message || "Failed to generate vendor response" }, { status: 500 });
  }
}
