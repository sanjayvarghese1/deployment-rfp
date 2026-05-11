import { NextRequest, NextResponse } from "next/server";
import { openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sections, rfp_context, mode } = body;
    // mode: "critique" | "refine_all" | "extract_data"

    if (mode === "extract_data") {
      // Agent 4: Data Extraction — parse proposal sections for chart-worthy data
      const dataPrompt = `You are a data visualization expert. Analyze this vendor proposal and extract structured data suitable for charts and graphs.

PROPOSAL SECTIONS:
${JSON.stringify(sections, null, 2)}

Extract and return ONLY valid JSON (no markdown) in this exact format:
{
  "cost_breakdown": [
    { "label": "<phase/item name>", "value": <numeric dollar amount>, "color": "<hex color>" }
  ],
  "timeline_phases": [
    { "label": "<phase name>", "start_week": <number>, "duration_weeks": <number>, "color": "<hex color>" }
  ],
  "team_structure": [
    { "name": "<person/role>", "role": "<title>", "experience_years": <number> }
  ],
  "risk_matrix": [
    { "risk": "<risk name>", "probability": "<High|Medium|Low>", "impact": "<High|Medium|Low>" }
  ],
  "deliverables_progress": [
    { "name": "<deliverable>", "weight": <percentage 0-100> }
  ],
  "budget_total": <number or 0>,
  "timeline_total_weeks": <number or 0>
}

Parse real numbers from the text. If a cost says "$45,000" parse as 45000. If timeline says "3 months" parse as 12 weeks. Use professional hex colors (blues, greens, violets). If data isn't available for a chart, return an empty array for that field.`;

      // Agent: Requirement Extraction → Mistral (structured data extraction)
      const chartData = await openRouterChatJSON({
        model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
        messages: [
          { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object." },
          { role: "user", content: dataPrompt },
        ],
        max_tokens: 8000,
        temperature: 0.2,
      });
      return NextResponse.json({ chart_data: chartData });
    }

    if (mode === "critique") {
      // Agent 5: Critic — reviews the proposal and gives section-by-section scores + suggestions
      const critiquePrompt = `You are a senior procurement evaluator and proposal critic. Review this vendor proposal critically and provide actionable feedback.

RFP CONTEXT:
${rfp_context || "N/A"}

PROPOSAL SECTIONS:
${JSON.stringify(sections, null, 2)}

Evaluate each section and return ONLY valid JSON (no markdown):
{
  "overall_score": <number 0-100>,
  "overall_grade": "<A+|A|B+|B|C+|C|D|F>",
  "summary": "<2-3 sentence overall assessment>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"],
  "section_scores": {
    "vendor_information": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "company_profile": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "project_understanding": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "proposed_solution": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "deliverables": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "project_timeline": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "cost_proposal": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "team_details": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "past_experience": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "risk_management": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "support_maintenance": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "graphs_visualizations": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "terms_conditions": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "document_uploads": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" },
    "final_declaration": { "score": <0-100>, "feedback": "<specific feedback>", "priority": "<high|medium|low>" }
  },
  "top_improvements": [
    { "section": "<section_key>", "action": "<specific improvement action>" },
    { "section": "<section_key>", "action": "<specific improvement action>" },
    { "section": "<section_key>", "action": "<specific improvement action>" }
  ]
}

Be specific, actionable, and honest. Score empty sections as 0. Consider RFP alignment, professionalism, completeness, and persuasiveness.`;

      // Agent: Quality Assurance → Llama 3 (critique & scoring)
      const critique = await openRouterChatJSON({
        model: AGENT_MODEL.QUALITY_ASSURANCE,
        messages: [
          { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object." },
          { role: "user", content: critiquePrompt },
        ],
        max_tokens: 12000,
        temperature: 0.4,
      });
      return NextResponse.json({ critique });
    }

    if (mode === "refine_all") {
      // Agent 6: Auto-Refiner — takes critique + sections and improves the weakest sections
      const { critique, sections: currentSections } = body;

      const refinePrompt = `You are an expert proposal writer. Based on the critique feedback below, improve the 3 weakest sections of this proposal.

RFP CONTEXT:
${rfp_context || "N/A"}

CRITIQUE:
${JSON.stringify(critique, null, 2)}

CURRENT SECTIONS:
${JSON.stringify(currentSections, null, 2)}

Improve ONLY the 3 sections identified in "top_improvements". Return ONLY valid JSON (no markdown):
{
  "improved_sections": {
    "<section_key_1>": "<fully rewritten improved section text>",
    "<section_key_2>": "<fully rewritten improved section text>",
    "<section_key_3>": "<fully rewritten improved section text>"
  },
  "changes_summary": "<brief summary of what was improved>"
}

Make improvements specific, professional, and aligned with the RFP requirements. Add detail where lacking, improve structure, and make the proposal more compelling.`;

      // Agent: RFP Writing → Llama 3 (proposal refinement)
      const refined = await openRouterChatJSON({
        model: AGENT_MODEL.RFP_WRITING,
        messages: [
          { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object." },
          { role: "user", content: refinePrompt },
        ],
        max_tokens: 16000,
        temperature: 0.6,
      });
      return NextResponse.json({ refined });
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to refine proposal";
    console.error("Proposal refine error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await langfuse.flushAsync();
  }
}
