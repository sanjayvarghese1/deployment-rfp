import { NextRequest, NextResponse } from "next/server";
import { openRouterChat, openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { geminiChat, geminiChatJSON, isGeminiAvailable } from "@/lib/gemini";
import { langfuse } from "@/config/langfuse";

export const maxDuration = 300; // Vercel Hobby plan max: 300 seconds. Pro plan allows 900.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chat_history, rfp_context, vendor_name, contract_title, mode, existing_proposal, section_to_edit, edit_instructions } = body;

    // Mode: "full" = generate entire proposal, "edit_section" = edit one section, "parse_upload" = parse uploaded proposal
    if (mode === "parse_upload") {
      const parsePrompt = `You are a proposal document parser. Parse the following uploaded proposal document into the 15-section vendor proposal structure.

DOCUMENT:
${existing_proposal}

Parse and return ONLY valid JSON in this exact format, no markdown:
{
  "sections": {
    "vendor_information": "<extracted vendor name, contact person, email, phone, address, years of experience — or empty string>",
    "company_profile": "<extracted services, industries, employees, certifications, description — or empty string>",
    "project_understanding": "<extracted understanding of requirements, problem statement, key requirements, desired outcomes — or empty string>",
    "proposed_solution": "<extracted solution overview, technologies, architecture, methodology — or empty string>",
    "deliverables": "<extracted deliverables list, modules, documentation — or empty string>",
    "project_timeline": "<extracted duration, milestones, phases, delivery dates — or empty string>",
    "cost_proposal": "<extracted total cost, breakdown, payment terms, currency — or empty string>",
    "team_details": "<extracted team members, roles, experience, project manager — or empty string>",
    "past_experience": "<extracted similar projects, client names, outcomes — or empty string>",
    "risk_management": "<extracted risks, mitigation strategies, contingency plans — or empty string>",
    "support_maintenance": "<extracted post-project support plan, duration, type — or empty string>",
    "graphs_visualizations": "<extracted chart/visualization descriptions — or empty string>",
    "terms_conditions": "<extracted warranty, IP ownership, confidentiality, termination terms — or empty string>",
    "document_uploads": "<extracted references to certificates, licenses, portfolio, case studies — or empty string>",
    "final_declaration": "<extracted accuracy confirmation, signatory, date — or empty string>"
  },
  "extracted_price": "<price if found or empty>",
  "extracted_timeline": "<timeline if found or empty>"
}

Map the content to the closest matching section. If a section isn't found, leave it as an empty string.`;

      // Agent: Requirement Extraction → Mistral (parse uploaded doc → JSON)
      const parsed = await openRouterChatJSON({
        model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
        messages: [
          { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object." },
          { role: "user", content: parsePrompt },
        ],
max_tokens: 4000,
        temperature: 0.2,
      });
      return NextResponse.json({ parsed_proposal: parsed });
    }

    if (mode === "edit_section") {
      const editPrompt = `You are a professional proposal writer. Edit the following section of a vendor proposal.

CONTRACT/RFP CONTEXT:
${rfp_context || "N/A"}

SECTION: ${section_to_edit}
CURRENT CONTENT:
${existing_proposal || "(empty)"}

EDIT INSTRUCTIONS: ${edit_instructions}

Rewrite this section professionally. Return ONLY the improved section text, no JSON or markdown wrappers. Make it compelling, specific, and aligned with the RFP requirements.`;

      // Agent: RFP Writing → Llama 3 (section rewrite)
      const edited = await openRouterChat({
        model: AGENT_MODEL.RFP_WRITING,
        messages: [{ role: "user", content: editPrompt }],
        max_tokens: 2048,
        temperature: 0.6,
      });
      return NextResponse.json({ edited_section: edited.trim() });
    }

    if (mode === "expand_section") {
      const { section_key, section_content, all_sections } = body;

      const otherContext = all_sections
        ? Object.entries(all_sections as Record<string, string>)
            .filter(([k]) => k !== section_key)
            .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 300) : ""}`)
            .join("\n")
        : "N/A";

      const expandPrompt = `Expand this proposal section into a detailed, professional chapter (500-800 words).

CONTRACT/RFP: ${rfp_context || "N/A"}

SECTION: ${section_to_edit || section_key}
CURRENT CONTENT:
${section_content || existing_proposal || "(empty)"}

OTHER SECTIONS FOR CROSS-REFERENCE:
${otherContext}

RULES:
- Preserve ALL existing data (names, numbers, dates, technologies)
- Use 3+ sub-headings formatted as "## Sub-heading"
- Include 1-2 data tables: | Header | Header | Header |
- Add bullet points with specific details
- Cross-reference other sections: "As detailed in Section 8 (Team Details)..."
- Write dense paragraphs (4-6 sentences each), no filler
- NO placeholders — use real data from the content

Return ONLY the expanded section text. No JSON, no markdown code blocks.`;

      let expanded = "";
      try {
          expanded = await openRouterChat({
          model: AGENT_MODEL.RFP_WRITING,
          messages: [
            { role: "system", content: "You are a professional proposal writer. Expand sections into detailed chapters with sub-headings, tables, and cross-references. Preserve all existing data." },
            { role: "user", content: expandPrompt },
          ],
          max_tokens: 4096,
          temperature: 0.65,
        });
      } catch {
        // Gemini fallback for expansion
        if (isGeminiAvailable()) {
          expanded = await geminiChat({
            systemInstruction: "You are a professional proposal writer. Expand sections into detailed chapters with sub-headings, tables, and cross-references. Preserve all existing data.",
            messages: [{ role: "user", content: expandPrompt }],
            maxOutputTokens: 4096,
            temperature: 0.65,
          });
        }
      }
      return NextResponse.json({ expanded_section: expanded.trim() || (section_content || "") });
    }

    // ─── Batch expand: expand multiple sections in parallel on the server ───
    if (mode === "batch_expand") {
      const { section_keys, all_sections } = body;
      if (!Array.isArray(section_keys) || !all_sections) {
        return NextResponse.json({ error: "section_keys array and all_sections required" }, { status: 400 });
      }

      const expandOne = async (sKey: string): Promise<{ key: string; content: string }> => {
        const sContent = (all_sections as Record<string, string>)[sKey] || "";
        const otherContext = Object.entries(all_sections as Record<string, string>)
          .filter(([k]) => k !== sKey)
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 300) : ""}`)
          .join("\n");

        const prompt = `Expand this proposal section into a detailed, professional chapter (500-800 words).

CONTRACT/RFP: ${rfp_context || "N/A"}

SECTION: ${sKey}
CURRENT CONTENT:
${sContent || "(empty)"}

OTHER SECTIONS FOR CROSS-REFERENCE:
${otherContext}

RULES:
- Preserve ALL existing data (names, numbers, dates, technologies)
- Use 3+ sub-headings formatted as "## Sub-heading"
- Include 1-2 data tables: | Header | Header | Header |
- Add bullet points with specific details
- Cross-reference other sections: "As detailed in Section 8 (Team Details)..."
- Write dense paragraphs (4-6 sentences each), no filler
- NO placeholders — use real data from the content

Return ONLY the expanded section text. No JSON, no markdown code blocks.`;

        let expanded = "";
        try {
          expanded = await openRouterChat({
            model: AGENT_MODEL.RFP_WRITING,
            messages: [
              { role: "system", content: "You are a professional proposal writer. Expand sections into detailed chapters with sub-headings, tables, and cross-references. Preserve all existing data." },
              { role: "user", content: prompt },
            ],
            max_tokens: 4096,
            temperature: 0.65,
          });
        } catch {
          if (isGeminiAvailable()) {
            try {
              expanded = await geminiChat({
                systemInstruction: "You are a professional proposal writer. Expand sections into detailed chapters with sub-headings, tables, and cross-references. Preserve all existing data.",
                messages: [{ role: "user", content: prompt }],
                maxOutputTokens: 4096,
                temperature: 0.65,
              });
            } catch { /* keep original */ }
          }
        }
        return { key: sKey, content: expanded.trim() || sContent };
      };

      // Run all requested sections in parallel
      const results = await Promise.all(section_keys.map((k: string) => expandOne(k)));
      const expandedMap: Record<string, string> = {};
      for (const r of results) expandedMap[r.key] = r.content;

      return NextResponse.json({ expanded_sections: expandedMap });
    }

    if (mode === "executive_summary") {
      const { all_sections } = body;
      const summaryPrompt = `You are a senior executive proposal consultant. Write a compelling Executive Summary for the following vendor proposal.

CONTRACT: ${contract_title || "N/A"}
VENDOR: ${vendor_name || "N/A"}

RFP CONTEXT:
${rfp_context || "N/A"}

FULL PROPOSAL SECTIONS:
${all_sections ? Object.entries(all_sections as Record<string, string>).map(([k, v]) => `### ${k}\n${typeof v === "string" ? v.slice(0, 500) : ""}`).join("\n\n") : "N/A"}

Write a 400-600 word executive summary that:
1. Opens with a compelling value proposition (why this vendor is the ideal choice)
2. Summarizes the key solution approach and methodology
3. Highlights core differentiators and competitive advantages
4. States the total investment and timeline
5. Closes with a confident call to action

Use sub-headings formatted as "## " for structure. Write in persuasive, executive-level language.
Return ONLY the summary text, no JSON or markdown code blocks.`;

      const summary = await openRouterChat({
        model: AGENT_MODEL.RFP_WRITING,
        messages: [
          { role: "system", content: "You are a C-suite executive communication specialist who writes compelling, concise executive summaries for major proposals. Use persuasive language, clear structure with ## sub-headings, and highlight ROI." },
          { role: "user", content: summaryPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.6,
      });
      return NextResponse.json({ executive_summary: summary.trim() });
    }

    // Mode: "full" - Generate complete proposal from chat history
    const chatContent = Array.isArray(chat_history)
      ? chat_history.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join("\n")
      : "";

    // ─── STEP 1: Extract all raw data points from the interview ───
    const extractionPrompt = `Carefully read the full interview transcript below and extract EVERY piece of information the vendor provided. Organize it by category.

INTERVIEW TRANSCRIPT:
${chatContent}

RFP/CONTRACT CONTEXT:
${rfp_context || "N/A"}

Extract and return ONLY valid JSON (no markdown, no explanations) in this format:
{
  "company": {
    "name": "",
    "contact_person": "",
    "email": "",
    "phone": "",
    "address": "",
    "years_in_business": "",
    "employees": "",
    "revenue": "",
    "certifications": [],
    "industries_served": [],
    "core_services": [],
    "mission": ""
  },
  "project": {
    "understanding": "",
    "problem_statement": "",
    "requirements": [],
    "goals": [],
    "solution_overview": "",
    "technologies": [],
    "methodology": "",
    "architecture": ""
  },
  "deliverables": [],
  "timeline": {
    "total_duration": "",
    "phases": [],
    "milestones": [],
    "start_date": ""
  },
  "cost": {
    "total_price": "",
    "currency": "",
    "breakdown": [],
    "payment_terms": ""
  },
  "team": {
    "members": [],
    "project_manager": "",
    "size": ""
  },
  "experience": {
    "past_projects": [],
    "client_names": [],
    "outcomes": []
  },
  "risks": {
    "identified_risks": [],
    "mitigation_strategies": [],
    "contingency": ""
  },
  "support": {
    "plan": "",
    "duration": "",
    "sla": "",
    "type": ""
  },
  "terms": {
    "warranty": "",
    "ip_ownership": "",
    "nda": "",
    "termination": ""
  },
  "visualizations_requested": [],
  "documents_referenced": [],
  "signatory": {
    "name": "",
    "title": "",
    "date": ""
  },
  "other_details": []
}

RULES:
- Extract EXACT values the vendor provided — names, numbers, dates, dollar amounts, percentages, durations.
- If the vendor mentioned something even briefly, capture it.
- If a field wasn't discussed, use "" or [].
- "other_details" should capture anything that doesn't fit the above categories.`;

    const extractedData = await openRouterChatJSON({
      model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
      messages: [
        { role: "system", content: "You are a precise data extraction engine. Extract every fact, number, name, and detail from the interview. Return ONLY raw JSON." },
        { role: "user", content: extractionPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    });

    const vendorData = JSON.stringify(extractedData, null, 2);

    // ─── STEP 2: Generate comprehensive proposal using extracted data ───
    const sectionKeys = [
      "vendor_information", "company_profile", "project_understanding",
      "proposed_solution", "deliverables", "project_timeline",
      "cost_proposal", "team_details", "past_experience",
      "risk_management", "support_maintenance", "graphs_visualizations",
      "terms_conditions", "document_uploads", "final_declaration",
    ];

    const fullPrompt = `Generate a professional vendor proposal using the data below.

CONTRACT: ${contract_title || "N/A"}
VENDOR: ${vendor_name || "N/A"}

RFP CONTEXT:
${rfp_context || "N/A"}

EXTRACTED VENDOR DATA:
${vendorData}

INTERVIEW TRANSCRIPT:
${chatContent}

Return ONLY valid JSON with this exact structure (no markdown, no extra text):
{
  "sections": {
    ${sectionKeys.map(k => `"${k}": "<professional content with ## sub-headings and | tables |>"`).join(",\n    ")}
  },
  "proposal_title": "Proposal for ${contract_title || "Project"} — ${vendor_name || "Vendor"}",
  "total_price": "<exact price from data>",
  "timeline_summary": "<timeline from data>"
}

RULES:
- Each section: 50-100 words of KEY FACTS only (names, numbers, dates, technologies)
- Do NOT write long paragraphs — just the essential data points per section
- Use ALL vendor data — names, numbers, technologies, dates, prices
- No empty strings — every section must have content`;

    // Try OpenRouter first, fall back to Gemini if it fails or returns empty
    let finalProposal: unknown = null;
    let openRouterError: string | null = null;

    try {
      // Agent: RFP Writing → Llama 3 (full proposal generation)
      const proposal = await openRouterChatJSON({
        model: AGENT_MODEL.RFP_WRITING,
        messages: [
          { role: "system", content: "You are a JSON-only API. Respond with ONLY valid JSON. Every section must have a short string value with key facts. No markdown fences." },
          { role: "user", content: fullPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.55,
      });

      // Validate sections are filled — normalize objects to strings
      const proposalObj = proposal as Record<string, unknown>;
      const rawSections = proposalObj?.sections as Record<string, unknown> | undefined;
      if (rawSections) {
        for (const key of Object.keys(rawSections)) {
          const val = rawSections[key];
          if (typeof val === "object" && val !== null) {
            // Flatten nested objects into readable text
            rawSections[key] = Object.entries(val as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
              .join("\n");
          } else if (typeof val !== "string") {
            rawSections[key] = String(val || "");
          }
        }
      }
      const sections = rawSections as Record<string, string> | undefined;
      const filledCount = sections
        ? Object.values(sections).filter(v => typeof v === "string" && v.trim().length > 0).length
        : 0;

      if (filledCount > 0) {
        console.log(`OpenRouter generated proposal with ${filledCount}/15 sections filled`);
        finalProposal = proposal;
      } else {
        openRouterError = "OpenRouter returned all empty sections";
        console.warn(openRouterError);
      }
    } catch (err) {
      openRouterError = err instanceof Error ? err.message : "OpenRouter proposal generation failed";
      console.warn("OpenRouter proposal generation failed, will try Gemini fallback:", openRouterError);
    }

    // ─── Gemini fallback if OpenRouter failed or returned empty ───
    if (!finalProposal && isGeminiAvailable()) {
      console.log("Falling back to Gemini API for proposal generation...");
      try {
        finalProposal = await geminiChatJSON({
          systemInstruction: "You are a JSON-only API that generates professional vendor proposals. Respond with ONLY a valid JSON object. Every section value must be a string with professional proposal content including ## sub-headings and | data | tables |. No markdown fences, no text outside JSON.",
          messages: [
            { role: "user", content: fullPrompt },
          ],
          maxOutputTokens: 8192,
          temperature: 0.55,
        });

        const geminiSections = (finalProposal as Record<string, unknown>)?.sections as Record<string, string> | undefined;
        const geminiFilledCount = geminiSections
          ? Object.values(geminiSections).filter(v => typeof v === "string" && v.trim().length > 0).length
          : 0;
        console.log(`Gemini fallback generated ${geminiFilledCount}/15 sections`);

        if (geminiFilledCount === 0) {
          return NextResponse.json({ error: "Both OpenRouter and Gemini failed to produce proposal content." }, { status: 502 });
        }
      } catch (geminiErr) {
        const geminiMsg = geminiErr instanceof Error ? geminiErr.message : "unknown error";
        console.error("Gemini fallback also failed:", geminiMsg);
        return NextResponse.json({
          error: `OpenRouter failed (${openRouterError}). Gemini fallback also failed (${geminiMsg}).`,
        }, { status: 502 });
      }
    } else if (!finalProposal) {
      return NextResponse.json({
        error: `Proposal generation failed: ${openRouterError}. Check OPENROUTER_API_KEY and model settings.`,
      }, { status: 502 });
    }

    // ─── STEP 3: Auto-expand each section for detailed 20-60 page output ───
    const proposalObj = finalProposal as Record<string, unknown>;
    const skeletonSections = proposalObj?.sections as Record<string, string> | undefined;
    if (skeletonSections) {
      const filledKeys = Object.keys(skeletonSections).filter(
        k => typeof skeletonSections[k] === "string" && skeletonSections[k].trim().length > 0
      );
      console.log(`Auto-expanding ${filledKeys.length} sections...`);

      const BATCH_SIZE = 3;
      for (let i = 0; i < filledKeys.length; i += BATCH_SIZE) {
        const batch = filledKeys.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async (sKey) => {
          const sContent = skeletonSections[sKey];
          const otherCtx = Object.entries(skeletonSections)
            .filter(([k]) => k !== sKey)
            .map(([k, v]) => `${k}: ${typeof v === "string" ? v.slice(0, 300) : ""}`)
            .join("\n");

          const expandPrompt = `Expand this proposal section into a detailed, professional chapter (500-800 words).

CONTRACT/RFP: ${rfp_context || "N/A"}

SECTION: ${sKey}
CURRENT CONTENT:
${sContent}

OTHER SECTIONS FOR CROSS-REFERENCE:
${otherCtx}

RULES:
- Preserve ALL existing data (names, numbers, dates, technologies)
- Use 3+ sub-headings formatted as "## Sub-heading"
- Include 1-2 data tables: | Header | Header | Header |
- Add bullet points with specific details
- Cross-reference other sections: "As detailed in Section 8 (Team Details)..."
- Write dense paragraphs (4-6 sentences each), no filler
- NO placeholders — use real data from the content

Return ONLY the expanded section text. No JSON, no markdown code blocks.`;

          let expanded = "";
          try {
            expanded = await openRouterChat({
              model: AGENT_MODEL.RFP_WRITING,
              messages: [
                { role: "system", content: "You are a professional proposal writer. Expand sections into detailed chapters with sub-headings, tables, and cross-references. Preserve all existing data." },
                { role: "user", content: expandPrompt },
              ],
              max_tokens: 4096,
              temperature: 0.65,
            });
          } catch {
            if (isGeminiAvailable()) {
              try {
                expanded = await geminiChat({
                  systemInstruction: "You are a professional proposal writer. Expand sections into detailed chapters with sub-headings, tables, and cross-references. Preserve all existing data.",
                  messages: [{ role: "user", content: expandPrompt }],
                  maxOutputTokens: 4096,
                  temperature: 0.65,
                });
              } catch { /* keep skeleton content */ }
            }
          }
          return { key: sKey, content: expanded.trim() || sContent };
        }));

        for (const r of results) {
          skeletonSections[r.key] = r.content;
        }
        console.log(`Expanded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(filledKeys.length / BATCH_SIZE)}`);
      }
    }

    return NextResponse.json({ proposal: finalProposal });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate proposal";
    console.error("Proposal generation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await langfuse.flushAsync();
  }
}
