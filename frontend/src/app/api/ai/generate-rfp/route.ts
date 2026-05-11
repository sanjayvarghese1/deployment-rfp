import { NextRequest, NextResponse } from "next/server";
import { openRouterChat, AGENT_MODEL } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { project_title, description, budget, deadline, industry, required_certifications, mission_objective } = body;

    if (!mission_objective) {
      return NextResponse.json({ error: "mission_objective is required" }, { status: 400 });
    }

    const prompt = `You are a procurement specialist. Generate a professional RFP (Request for Proposal) document based on the following project details:

Project Title: ${project_title || "N/A"}
Description: ${description || "N/A"}
Budget: $${budget || "N/A"}
Deadline: ${deadline || "N/A"}
Industry: ${industry || "N/A"}
Required Certifications: ${required_certifications || "N/A"}
Mission Objective: ${mission_objective}

Generate a structured RFP with the following sections:

1. Project Overview
2. Scope of Work
3. Technical Requirements
4. Deliverables
5. Timeline Expectations
6. Vendor Qualifications
7. Evaluation Criteria
8. Submission Instructions

Make it professional, detailed, and ready for vendor review. Use clear section headers and bullet points where appropriate.`;

    // Agent: RFP Writing → Llama 3 (document generation)
    const rfp = await openRouterChat({
      model: AGENT_MODEL.RFP_WRITING,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8000,
      temperature: 0.7,
    }) || "Failed to generate RFP.";
    return NextResponse.json({ rfp });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate RFP";
    console.error("RFP generation error:", message);
    return NextResponse.json({ error: "Failed to generate RFP" }, { status: 500 });
  } finally {
    await langfuse.flushAsync();
  }
}
