import { NextRequest, NextResponse } from "next/server";
import { openRouterChat, openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";
import { saveProposalAnalysisResult } from "@/services/aiService";
import type { ProposalAnalysis, JudgeResult } from "@/services/aiService";

export const maxDuration = 240; // Conservative limit for Vercel Hobby (max 300)

/* ═══════════════════════════════════════════════════════════════════
   Agent 1 — Extractor
   Reads messy text and converts it into clean structured Markdown
   focused only on evaluation-relevant content.
   ═══════════════════════════════════════════════════════════════════ */
async function runExtractor(docType: "RFP" | "Vendor Proposal", text: string): Promise<string> {
  const prompt = `You are Agent 1: The Extractor.
Your job is to read a messy procurement document and convert it into a clean structured Markdown extraction focused only on evaluation-relevant content.

Ignore:
- legal boilerplate
- generic terms and conditions
- repeated headers/footers
- signatures
- annexure text unless it contains scoring-relevant details
- non-evaluative fluff

Extract only the information needed for vendor evaluation.

OUTPUT FORMAT:
Return clean Markdown only.

# Document Type
${docType}

# Core Summary
A 3-6 line plain-English summary of what this document is about.

# Evaluation-Relevant Fields

## Contract / RFP Details
- Contract Title:
- Contract Description:
- Budget:
- Required Deliverables:
- Required Technical Specs:
- Required Timeline:
- Mandatory Compliance Requirements:
- Desired Experience / Qualification Requirements:
- Special Constraints / Risks:

## Vendor Proposal Details
- Vendor Name:
- Proposed Price:
- Proposed Timeline:
- Proposed Solution Summary:
- Relevant Experience Claimed:
- Deliverables Mentioned:
- Technical Specs Mentioned:
- Compliance / Certifications Mentioned:
- Assumptions / Dependencies:
- Risks / Omissions:

# Criteria Extraction
List only the criteria that matter for downstream scoring:
- Price
- Timeline
- Technical Fit Signals
- Experience Signals
- Compliance & Completeness Signals

# Missing / Unclear Information
List all important missing, ambiguous, or unreadable information.

RULES:
- Do not invent values.
- If something is not present, write "Not found".
- Normalize noisy text into concise readable bullets.
- Preserve numeric values, dates, durations, currencies, percentages, and technical requirements exactly when found.
- If multiple conflicting values appear, mention them under "Missing / Unclear Information".

---
DOCUMENT TO EXTRACT:
${text}`;

  const response = await openRouterChat({
    model: AGENT_MODEL.DOCUMENT_ANALYSIS,
    messages: [
      { role: "system", content: "You are a document extraction specialist. Output clean Markdown only. No JSON, no code fences." },
      { role: "user", content: prompt },
    ],
    max_tokens: 4000,
    temperature: 0,
  });
  return response;
}

/* ═══════════════════════════════════════════════════════════════════
   Agent 2 — Scorer
   Scores ONE vendor proposal against ONE RFP using weighted criteria.
   ═══════════════════════════════════════════════════════════════════ */
async function runScorer(rfpMarkdown: string, vendorMarkdown: string, vendorName: string): Promise<ProposalAnalysis> {
  const prompt = `You are Agent 2: The Scorer.
Your task is to evaluate ONE vendor proposal against ONE RFP.
You must score the vendor independently against the contract requirements using these weighted criteria:
- Technical Fit: 30%
- Cost Efficiency: 20%
- Relevant Experience: 20%
- Timeline Fit: 15%
- Compliance & Completeness: 15%

SCORING DEFINITIONS

1. Technical Fit (30%)
Does the vendor proposal match the contract scope, requirements, technical expectations, and deliverables?
Reward direct relevance, specificity, feasibility, and solution suitability.
Do not reward verbosity alone.

2. Cost Efficiency (20%)
Is the proposed price reasonable relative to the contract budget and the value offered?
Cheaper does NOT automatically mean better if the proposal is weak or risky.

3. Relevant Experience (20%)
Does the vendor show relevant prior work for this exact type of contract?
Prefer directly relevant project experience over generic experience.

4. Timeline Fit (15%)
Is the proposed timeline realistic and aligned with the contract needs?
Missing or vague timelines should reduce the score.

5. Compliance & Completeness (15%)
Is the proposal structured, complete, procurement-ready, and aligned with mandatory requirements?
Check for scope clarity, deliverables, assumptions, support, risks, constraints, and completeness.

INPUTS

RFP EXTRACT:
${rfpMarkdown}

VENDOR EXTRACT:
${vendorMarkdown}

INSTRUCTIONS
- First compare the vendor proposal against the RFP requirements.
- Score each criterion from 0 to 100.
- Then compute:
overall_score = (technical_fit * 0.30) + (cost_efficiency * 0.20) + (relevant_experience * 0.20) + (timeline_fit * 0.15) + (compliance_completeness * 0.15)

RECOMMENDATION SCALE
- 85-100: Strongly Recommended
- 70-84: Recommended
- 55-69: Consider
- 40-54: Risky
- Below 40: Not Recommended

RISK RULES
Flag risks such as:
- price materially above budget
- weak technical alignment
- vague or missing timeline
- insufficient relevant experience
- incomplete proposal
- missing compliance information
- unclear deliverables or assumptions

AUDIT REQUIREMENT
You may reason internally in detail, but the final output must be strict JSON only.
Keep each "reason" field to 1 sentence (under 30 words). Keep strengths/weaknesses/risk_flags to short phrases.

RETURN STRICT JSON:
{
  "vendor_name": "${vendorName}",
  "overall_score": <number>,
  "independent_recommendation": "<Strongly Recommended|Recommended|Consider|Risky|Not Recommended>",
  "criterion_scores": {
    "technical_fit": { "score": <number>, "reason": "<string>" },
    "cost_efficiency": { "score": <number>, "reason": "<string>" },
    "relevant_experience": { "score": <number>, "reason": "<string>" },
    "timeline_fit": { "score": <number>, "reason": "<string>" },
    "compliance_completeness": { "score": <number>, "reason": "<string>" }
  },
  "strengths": ["<string>"],
  "weaknesses": ["<string>"],
  "risk_flags": ["<string>"],
  "analysis_summary": "<string>"
}`;

  try {
    return await openRouterChatJSON({
      model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
      messages: [
        { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object. Keep all string values concise (under 30 words each)." },
        { role: "user", content: prompt },
      ],
      max_tokens: 6000,
      temperature: 0,
    });
  } catch (err) {
    // If the model returned non-JSON, attempt a JSON-fix pass: ask the model to convert its previous output into the required JSON.
    const rawErrMsg = err instanceof Error ? err.message : String(err);
    console.warn(`Scorer JSON parse failed for ${vendorName}:`, rawErrMsg.slice(0, 200));

    try {
      // Get the raw textual response from the model (best-effort)
      const raw = await openRouterChat({
        model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
        messages: [
          { role: "system", content: "You are an analysis assistant. Provide the full raw analysis output." },
          { role: "user", content: prompt },
        ],
        max_tokens: 6000,
        temperature: 0,
      });

      // Re-prompt a JSON fixer: convert the raw analysis into strict JSON matching the schema.
      const fixerPrompt = `You are a JSON fixer. Convert the following analysis output into strict JSON matching this schema:\n${JSON.stringify({ vendor_name: "", overall_score: 0, independent_recommendation: "", criterion_scores: { technical_fit: { score: 0, reason: "" }, cost_efficiency: { score: 0, reason: "" }, relevant_experience: { score: 0, reason: "" }, timeline_fit: { score: 0, reason: "" }, compliance_completeness: { score: 0, reason: "" } }, strengths: [], weaknesses: [], risk_flags: [], analysis_summary: "" }, null, 2)}\n\nHere is the raw analysis:\n\n${raw}`;

      return await openRouterChatJSON({
        model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
        messages: [
          { role: "system", content: "You are a JSON-only API. Extract valid JSON only, no surrounding text." },
          { role: "user", content: fixerPrompt },
        ],
        max_tokens: 6000,
        temperature: 0,
      });
    } catch (fixErr) {
      console.error(`Scorer JSON fixer failed for ${vendorName}:`, fixErr instanceof Error ? fixErr.message : String(fixErr));
      // rethrow original error to be handled by caller
      throw err;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   Agent 3 — Judge
   Compares multiple scored vendors and selects the best one.
   ═══════════════════════════════════════════════════════════════════ */
async function runJudge(rfpMarkdown: string, vendorScores: ProposalAnalysis[]): Promise<JudgeResult> {
  const buildFallbackJudge = (): JudgeResult => {
    const ranking = [...vendorScores]
      .sort((left, right) => (right.overall_score || 0) - (left.overall_score || 0))
      .map((vendor, index) => {
        const score = vendor.overall_score || 0;
        return {
          vendor_name: vendor.vendor_name || `Vendor ${index + 1}`,
          final_score: score,
          comparative_recommendation:
            score >= 85 ? "Best Fit"
              : score >= 70 ? "Strong Candidate"
              : score >= 55 ? "Qualified but Weaker Fit"
              : score >= 40 ? "High Risk"
              : "Not Recommended",
          strengths: (vendor.strengths || []).slice(0, 3),
          weaknesses: (vendor.weaknesses || []).slice(0, 3),
          why: vendor.analysis_summary || "Fallback ranking generated because the judge model failed.",
        };
      });

    const bestVendor = ranking[0]?.vendor_name || "Unknown";
    const runnerUp = ranking[1]?.vendor_name;

    return {
      comparative_analysis: {
        best_vendor: bestVendor,
        selection_summary: runnerUp
          ? `${bestVendor} ranked highest in the fallback analysis, with ${runnerUp} next.`
          : `${bestVendor} ranked highest in the fallback analysis.`,
        ranking,
      },
      final_recommendation_view: {
        recommended_vendor: bestVendor,
        headline: `Fallback recommendation for ${bestVendor}`,
        summary: "The judge model could not complete, so this ranking is based on the vendor scores already calculated.",
        why_this_vendor_won: bestVendor
          ? [`Highest overall score among the analyzed vendors.`]
          : ["No vendors were available for comparison."],
        key_tradeoffs: runnerUp ? [`${runnerUp} may still be worth reviewing as a backup option.`] : ["No direct tradeoff data available."],
        other_vendors_snapshot: ranking.slice(1, 4).map((vendor) => ({
          vendor_name: vendor.vendor_name,
          label: vendor.comparative_recommendation,
          score: vendor.final_score,
          note: vendor.why,
        })),
      },
    };
  };

  const prompt = `You are Agent 3: The Judge.

Your task is to compare multiple vendor evaluations for the same contract and select the best vendor.

IMPORTANT RULES
- Do not automatically choose the cheapest vendor.
- Choose the vendor with the best overall fit for the contract.
- Strong technical alignment matters most.
- Relevant experience is preferred over generic experience.
- Vague, incomplete, or risky proposals must be penalized.
- Vendors with major red flags should be downgraded even if they are cheap.

INPUTS

RFP EXTRACT:
${rfpMarkdown}

SCORED VENDORS JSON:
${JSON.stringify(vendorScores, null, 2)}

COMPARATIVE LABELS
- Best Fit
- Strong Candidate
- Qualified but Weaker Fit
- High Risk
- Not Recommended

YOUR TASK
1. Compare vendors head-to-head using their scored outputs.
2. Rank all vendors from best to worst.
3. Select the final best vendor.
4. Produce a final recommendation view suitable for UX.

OUTPUT REQUIREMENTS
The UI should show only one clear answer first:
- recommended vendor
- headline
- concise summary
- why this vendor won
- key tradeoffs
- short snapshot of other vendors

At the same time, include the comparative ranking for drill-down.
Keep all string fields concise — 1-2 sentences max. Keep array items to short phrases.

RETURN STRICT JSON:
{
  "comparative_analysis": {
    "best_vendor": "<string>",
    "selection_summary": "<string>",
    "ranking": [
      {
        "vendor_name": "<string>",
        "final_score": <number>,
        "comparative_recommendation": "<Best Fit|Strong Candidate|Qualified but Weaker Fit|High Risk|Not Recommended>",
        "strengths": ["<string>"],
        "weaknesses": ["<string>"],
        "why": "<string>"
      }
    ]
  },
  "final_recommendation_view": {
    "recommended_vendor": "<string>",
    "headline": "<string>",
    "summary": "<string>",
    "why_this_vendor_won": ["<string>"],
    "key_tradeoffs": ["<string>"],
    "other_vendors_snapshot": [
      {
        "vendor_name": "<string>",
        "label": "<string>",
        "score": <number>,
        "note": "<string>"
      }
    ]
  }
}`;

  try {
    return await openRouterChatJSON({
      model: AGENT_MODEL.QUALITY_ASSURANCE,
      messages: [
        { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object. Keep all string values concise." },
        { role: "user", content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0,
    });
  } catch (error) {
    console.warn("Judge model failed, using fallback ranking:", error instanceof Error ? error.message : String(error));
    return buildFallbackJudge();
  }
}

function buildVendorText(input: {
  vendorName?: string;
  price?: string;
  timeline?: string;
  experience?: string;
  proposalData?: unknown;
}): string {
  const base = [
    `## Vendor Information`,
    `Vendor Name: ${input.vendorName || "Unknown"}`,
    `Proposed Price: $${input.price || "N/A"}`,
    `Proposed Timeline: ${input.timeline || "N/A"}`,
    `Vendor Experience: ${input.experience || "N/A"}`,
  ];

  if (!input.proposalData) {
    return base.join("\n");
  }

  const raw = typeof input.proposalData === "string" ? input.proposalData.trim() : "";
  if (!raw) {
    return base.join("\n");
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sections = (parsed.sections ?? {}) as Record<string, unknown>;
    const sectionLabels = (parsed.sectionLabels ?? {}) as Record<string, unknown>;
    const sectionEntries = Object.entries(sections);

    if (sectionEntries.length > 0) {
      return [
        `## Vendor Information`,
        `Vendor Name: ${input.vendorName || (parsed.vendorName as string) || "Unknown"}`,
        `Proposed Price: $${input.price || (parsed.totalPrice as string) || "N/A"}`,
        `Proposed Timeline: ${input.timeline || (parsed.timeline as string) || "N/A"}`,
        "",
        ...sectionEntries.map(([key, value]) => `## ${String(sectionLabels[key] || key)}\n${String(value || "")}`),
      ].join("\n");
    }

    return [...base, "", "## Vendor Proposal Details (Extracted from PDF):", raw].join("\n");
  } catch {
    // Raw extracted PDF text: format as structured vendor proposal for analysis
    return [
      ...base,
      "",
      "## Vendor Proposal Details (Extracted from PDF)",
      "",
      raw,
    ].join("\n");
  }
}

/* ═══════════════════════════════════════════════════════════════════
   API Route — Orchestrates the 3-agent pipeline
   ═══════════════════════════════════════════════════════════════════

   Mode "score_single": Agent 1 + Agent 2 for one vendor
   Mode "judge":        Agent 3 to compare all scored vendors
   Mode "full_pipeline": Agent 1 + 2 + 3 for all vendors at once
   ═══════════════════════════════════════════════════════════════════ */
export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now();
  let trace: ReturnType<typeof langfuse.trace> | null = null;

  console.log(`[AI:POST] === REQUEST START === time=${new Date().toISOString()}`);

  try {
    const body = await req.json();
    const { mode } = body;
    console.log(`[AI:POST] mode=${mode} vendors=${Array.isArray(body.vendors)?body.vendors.length:0}`);

    // ── Mode: score_single ─────────────────────────────────────
    // Runs Agent 1 (Extractor) + Agent 2 (Scorer) for a single vendor
    if (mode === "score_single") {
      console.log(`[AI:POST] Entering score_single path`);
      const { contract_title, contract_description, contract_budget, contract_deadline, contract_certifications,
              vendor_name, vendor_price, vendor_timeline, vendor_experience, proposal_data, mandatoryCriteria } = body;

      // Build RFP text from contract fields
      const rfpText = [
        `Contract Title: ${contract_title || "N/A"}`,
        `Description: ${contract_description || "N/A"}`,
        `Budget: $${contract_budget || "N/A"}`,
        `Deadline: ${contract_deadline || "N/A"}`,
        contract_certifications ? `Required Certifications: ${contract_certifications}` : "",
      ].filter(Boolean).join("\n");

      const vendorText = buildVendorText({
        vendorName: vendor_name,
        price: vendor_price,
        timeline: vendor_timeline,
        experience: vendor_experience,
        proposalData: proposal_data,
      });

      trace = langfuse.trace({
        name: `Vendor Analysis - ${vendor_name || "Unknown"}`,
        metadata: {
          vendorName: vendor_name || "Unknown",
          fileNames: proposal_data ? ["proposal_data_json"] : [],
          mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
          modelUsed: AGENT_MODEL.DOCUMENT_ANALYSIS,
          tokenUsage: null,
          latency: null,
          finalScore: null,
        },
      });

      const readRfpSpan = trace.span({
        name: "Read RFP",
        input: {
          contractTitle: contract_title || "N/A",
          contractDescriptionChars: (contract_description || "").length,
          contractBudget: contract_budget || "N/A",
          contractDeadline: contract_deadline || "N/A",
        },
      });

      const readVendorSpan = trace.span({
        name: "Read Vendor Proposal",
        input: {
          vendorName: vendor_name || "Unknown",
          proposalDataProvided: Boolean(proposal_data),
          vendorTextChars: vendorText.length,
        },
      });

      // Agent 1: Extract both documents
      const [rfpMarkdown, vendorMarkdown] = await Promise.all([
        runExtractor("RFP", rfpText),
        runExtractor("Vendor Proposal", vendorText),
      ]);

      readRfpSpan.end({
        output: {
          rfpExtractChars: rfpMarkdown.length,
        },
      });

      readVendorSpan.end({
        output: {
          vendorExtractChars: vendorMarkdown.length,
        },
      });

      const extractRequirementsSpan = trace.span({
        name: "Extract Requirements",
        input: {
          vendorName: vendor_name || "Unknown",
          rfpExtractChars: rfpMarkdown.length,
          vendorExtractChars: vendorMarkdown.length,
        },
      });

      // Agent 2: Score
      const scorerResult = await runScorer(rfpMarkdown, vendorMarkdown, vendor_name || "Unknown");

      extractRequirementsSpan.end({
        output: {
          scoreChars: JSON.stringify(scorerResult).length,
        },
      });

      const scoreVendorSpan = trace.span({
        name: "Score Vendor",
        input: {
          vendorName: vendor_name || "Unknown",
        },
      });
      scoreVendorSpan.end({
        output: {
          finalScore: scorerResult.overall_score,
        },
        metadata: {
          vendorName: vendor_name || "Unknown",
          finalScore: scorerResult.overall_score,
        },
      });

      trace.update({
        metadata: {
          vendorName: vendor_name || "Unknown",
          finalScore: scorerResult.overall_score,
          latency: Date.now() - requestStartedAt,
        },
      });

      return NextResponse.json({
        analysis: scorerResult,
        rfp_extract: rfpMarkdown,
        vendor_extract: vendorMarkdown,
      });
    }

    // ── Mode: judge ────────────────────────────────────────────
    // Runs Agent 3 (Judge) to compare all scored vendors
    if (mode === "judge") {
      const { rfp_extract, vendor_scores } = body;
      trace = langfuse.trace({
        name: "Generate Final Recommendation",
        metadata: {
          vendorCount: Array.isArray(vendor_scores) ? vendor_scores.length : 0,
        },
      });
      const judgeSpan = trace.span({
        name: "Generate Final Recommendation",
        input: {
          vendorCount: Array.isArray(vendor_scores) ? vendor_scores.length : 0,
          rfpExtractChars: typeof rfp_extract === "string" ? rfp_extract.length : 0,
        },
      });
      const judgeResult = await runJudge(rfp_extract, vendor_scores);
      judgeSpan.end({
        output: {
          bestVendor: judgeResult?.comparative_analysis?.best_vendor || "",
        },
      });
      trace.update({
        metadata: {
          vendorCount: Array.isArray(vendor_scores) ? vendor_scores.length : 0,
          latency: Date.now() - requestStartedAt,
        },
      });
      return NextResponse.json({ judge: judgeResult });
    }

    // ── Mode: full_pipeline ────────────────────────────────────
    // Runs all 3 agents for a complete contract evaluation
    if (mode === "full_pipeline") {
      console.log(`[AI:POST] Entering full_pipeline path`);
      const { contract_title, contract_description, contract_budget, contract_deadline, contract_certifications,
        vendors, contract_id, mandatoryCriteria } = body;
      const fastMode = !!body.fastMode;

      console.log(`[AI:POST:full_pipeline] Starting. vendors=${Array.isArray(vendors) ? vendors.length : 0}`);

      // Build RFP text
      const rfpText = [
        `Contract Title: ${contract_title || "N/A"}`,
        `Description: ${contract_description || "N/A"}`,
        `Budget: $${contract_budget || "N/A"}`,
        `Deadline: ${contract_deadline || "N/A"}`,
        contract_certifications ? `Required Certifications: ${contract_certifications}` : "",
      ].filter(Boolean).join("\n");

      // Agent 1: Extract RFP once
      console.log(`[AI:POST:full_pipeline] Calling runExtractor for RFP`);
      const rfpMarkdown = await runExtractor("RFP", rfpText);
      console.log(`[AI:POST:full_pipeline] runExtractor completed. rfpMarkdown length=${rfpMarkdown.length}`);

      trace = langfuse.trace({
        name: `Vendor Analysis - ${contract_title || "Unknown Contract"}`,
        metadata: {
          contractTitle: contract_title || "Unknown",
          vendorCount: Array.isArray(vendors) ? vendors.length : 0,
          mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
          finalScore: null,
        },
      });

      const readRfpSpan = trace.span({
        name: "Read RFP",
        input: {
          contractTitle: contract_title || "N/A",
          contractDescriptionChars: (contract_description || "").length,
          contractBudget: contract_budget || "N/A",
          contractDeadline: contract_deadline || "N/A",
        },
      });
      readRfpSpan.end({
        output: {
          rfpExtractChars: rfpMarkdown.length,
        },
      });

      // Agent 1 + 2: Extract and score each vendor in small batches to reduce total latency.
      const vendorScores: ProposalAnalysis[] = [];
      const vendorExtracts: Record<string, string> = {};
      const analyzeVendor = async (v: (typeof vendors)[number]) => {
        const vendorTrace = langfuse.trace({
          name: `Vendor Analysis - ${v.vendor_name || "Unknown"}`,
          metadata: {
            vendorName: v.vendor_name || "Unknown",
            fileNames: v.proposal_data ? ["proposal_data_json"] : [],
            modelUsed: AGENT_MODEL.DOCUMENT_ANALYSIS,
            tokenUsage: null,
            latency: null,
            finalScore: null,
          },
        });

        const vendorText = buildVendorText({
          vendorName: v.vendor_name,
          price: v.price,
          timeline: v.timeline,
          experience: v.experience,
          proposalData: v.proposal_data,
        });

        const readVendorSpan = vendorTrace.span({
          name: "Read Vendor Proposal",
          input: {
            vendorName: v.vendor_name || "Unknown",
            proposalDataProvided: Boolean(v.proposal_data),
            vendorTextChars: vendorText.length,
          },
        });

        try {
          const vendorMarkdown = await runExtractor("Vendor Proposal", vendorText);
          readVendorSpan.end({ output: { vendorExtractChars: vendorMarkdown.length } });

          const extractRequirementsSpan = vendorTrace.span({
            name: "Extract Requirements",
            input: {
              vendorName: v.vendor_name || "Unknown",
              rfpExtractChars: rfpMarkdown.length,
              vendorExtractChars: vendorMarkdown.length,
            },
          });

          console.log(`[AI:POST:full_pipeline] Calling runScorer for vendor=${v.vendor_name}`);
          const scoreResult = await runScorer(rfpMarkdown, vendorMarkdown, v.vendor_name || "Unknown");
          console.log(`[AI:POST:full_pipeline] runScorer completed for vendor=${v.vendor_name} score=${scoreResult.overall_score}`);
          extractRequirementsSpan.end({ output: { scoreChars: JSON.stringify(scoreResult).length } });

          const scoreVendorSpan = vendorTrace.span({
            name: "Score Vendor",
            input: { vendorName: v.vendor_name || "Unknown" },
          });
          scoreVendorSpan.end({
            output: { finalScore: scoreResult.overall_score },
            metadata: { vendorName: v.vendor_name || "Unknown", finalScore: scoreResult.overall_score },
          });

          vendorTrace.update({
            metadata: {
              vendorName: v.vendor_name || "Unknown",
              finalScore: scoreResult.overall_score,
              latency: Date.now() - requestStartedAt,
            },
          });

          return { vendor_name: v.vendor_name || "Unknown", vendorMarkdown, scoreResult };
        } catch (vendorErr: unknown) {
          const msg = vendorErr instanceof Error ? vendorErr.message : String(vendorErr);
          console.error(`Failed to score vendor ${v.vendor_name}:`, msg);
          readVendorSpan.end({ level: "ERROR", statusMessage: msg.slice(0, 500) });
          vendorTrace.update({
            metadata: {
              vendorName: v.vendor_name || "Unknown",
              error: msg.slice(0, 500),
              latency: Date.now() - requestStartedAt,
            },
          });
          return {
            vendor_name: v.vendor_name || "Unknown",
            vendorMarkdown: "",
            scoreResult: {
              vendor_name: v.vendor_name || "Unknown",
              overall_score: 0,
              independent_recommendation: "Not Recommended",
              criterion_scores: {
                technical_fit: { score: 0, reason: "Scoring failed" },
                cost_efficiency: { score: 0, reason: "Scoring failed" },
                relevant_experience: { score: 0, reason: "Scoring failed" },
                timeline_fit: { score: 0, reason: "Scoring failed" },
                compliance_completeness: { score: 0, reason: "Scoring failed" },
              },
              strengths: [],
              weaknesses: ["AI scoring failed for this vendor"],
              risk_flags: ["Scoring error — manual review required"],
              analysis_summary: `Automated scoring failed: ${msg.slice(0, 100)}`,
            },
          };
        }
      };

      const batchSize = fastMode ? Math.max(1, vendors.length) : Math.min(2, Math.max(1, vendors.length));
      for (let index = 0; index < vendors.length; index += batchSize) {
        const batch = vendors.slice(index, index + batchSize);
        const batchResults = await Promise.all(batch.map(analyzeVendor));
        for (const result of batchResults) {
          if (result.vendorMarkdown) {
            vendorExtracts[result.vendor_name] = result.vendorMarkdown;
          }
          vendorScores.push(result.scoreResult);
        }
      }

      // Agent 3: Judge all vendors
      let judgeResult = null;
      if (vendorScores.length > 0) {
        const recommendationSpan = trace.span({
          name: "Generate Final Recommendation",
          input: {
            vendorCount: vendorScores.length,
            rfpExtractChars: rfpMarkdown.length,
          },
        });
        judgeResult = await runJudge(rfpMarkdown, vendorScores);
        recommendationSpan.end({
          output: {
            bestVendor: judgeResult?.comparative_analysis?.best_vendor || "",
          },
          metadata: {
            vendorCount: vendorScores.length,
            latency: Date.now() - requestStartedAt,
          },
        });
      }

      trace.update({
        metadata: {
          contractTitle: contract_title || "Unknown",
          vendorCount: Array.isArray(vendors) ? vendors.length : 0,
          latency: Date.now() - requestStartedAt,
        },
      });

      console.log(`[AI:POST:full_pipeline] Completed. Vendors scored: ${vendorScores.length}, Judge result: ${judgeResult ? 'yes' : 'no'}`);

      if (contract_id) {
        const analysesByProposalId: Record<string, ProposalAnalysis> = {};
        for (let index = 0; index < vendors.length; index++) {
          const vendor = vendors[index] as { proposal_id?: string } | undefined;
          const score = vendorScores[index];
          if (vendor?.proposal_id && score) {
            analysesByProposalId[vendor.proposal_id] = score;
          }
        }

        await saveProposalAnalysisResult(contract_id, {
          cache_key: `analysis:${contract_id}:${Date.now()}`,
          created_at: new Date().toISOString(),
          analyses_by_proposal_id: analysesByProposalId,
          judge_result: judgeResult ?? null,
          vendor_count: vendorScores.length,
        });
      }

      return NextResponse.json({
        vendor_scores: vendorScores,
        judge: judgeResult,
        rfp_extract: rfpMarkdown,
        vendor_extracts: vendorExtracts,
      });
    }

    return NextResponse.json({ error: "Invalid mode. Use: score_single, judge, or full_pipeline" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to analyze proposal";
    const stack = error instanceof Error ? error.stack : "";
    console.error(`[AI:POST] ERROR: ${message}`);
    console.error(`[AI:POST] Stack:`, stack);
    if (trace) {
      trace.update({
        metadata: {
          error: message.slice(0, 500),
          latency: Date.now() - requestStartedAt,
        },
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await langfuse.flushAsync();
  }
}
