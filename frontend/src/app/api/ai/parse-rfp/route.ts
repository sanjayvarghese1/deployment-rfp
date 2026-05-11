import { NextRequest, NextResponse } from "next/server";
import { openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rfp_text, contract_title, contract_description, contract_budget, contract_deadline, contract_industry } = body;

    if (!rfp_text && !contract_description) {
      return NextResponse.json({ error: "RFP text or contract description is required" }, { status: 400 });
    }

    const prompt = `You are an expert RFP (Request for Proposal) analyst. Analyze the following RFP/contract and extract structured parameters that a vendor would need to address in their proposal.

Contract Title: ${contract_title || "N/A"}
Contract Description: ${contract_description || "N/A"}
Budget: $${contract_budget || "N/A"}
Deadline: ${contract_deadline || "N/A"}
Industry: ${contract_industry || "N/A"}

RFP Document:
${rfp_text || "No RFP document provided. Use the contract description above."}

Extract and return ONLY valid JSON in this exact format, no markdown:
{
  "summary": "<2-3 sentence summary of what the RFP is looking for>",
  "key_requirements": ["<requirement 1>", "<requirement 2>", "..."],
  "technical_requirements": ["<tech req 1>", "<tech req 2>", "..."],
  "deliverables": ["<deliverable 1>", "<deliverable 2>", "..."],
  "evaluation_criteria": ["<criteria 1>", "<criteria 2>", "..."],
  "required_certifications": ["<cert 1>", "..."],
  "budget_range": "<budget info>",
  "timeline_expectations": "<timeline info>",
  "submission_requirements": ["<format/submission req 1>", "..."],
  "questions_for_vendor": ["<question the RFP implies vendors should answer 1>", "<question 2>", "...up to 8 targeted questions>"]
}

The "questions_for_vendor" should be specific, actionable questions that a chatbot should ask a vendor to gather all information needed for a winning proposal. Make them specific to THIS RFP, not generic.`;

    // Agent: Requirement Extraction → Mistral (structured JSON output)
    const parsed = await openRouterChatJSON({
      model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
      messages: [
        { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object." },
        { role: "user", content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
    });
    return NextResponse.json({ rfp_analysis: parsed });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to parse RFP";
    console.error("RFP parse error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
