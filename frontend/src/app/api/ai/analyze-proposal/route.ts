import { NextRequest, NextResponse } from "next/server";
import { openRouterChat, openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";
import { extractPdfTextWithOcrFallback } from "@/lib/pdfExtraction";
import { saveProposalAnalysisResult } from "@/services/aiService";
import type { ProposalAnalysis, JudgeResult } from "@/services/aiService";
import { extractCurrencyLikeText, extractTimelineLikeText, parseNumber } from "@/lib/formatters/number";

export const maxDuration = 900; // 15 minutes for the full 3-agent pipeline with multiple vendors

const MAX_EXTRACT_INPUT_CHARS = 24000;

function clampExtractorInput(text: string): string {
  const normalized = String(text || "");
  if (normalized.length <= MAX_EXTRACT_INPUT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_EXTRACT_INPUT_CHARS)}\n\n[TRUNCATED: input exceeded ${MAX_EXTRACT_INPUT_CHARS} chars]`;
}

type PriceConfidence = "exact" | "estimated" | "unknown";
type TimelineConfidence = "explicit" | "inferred" | "unknown";

type AnalysisTimeline = {
  start: string | null;
  end: string | null;
  duration_weeks: number | null;
};

type NormalizedPrice = {
  price: number | null;
  price_currency: string | null;
  price_confidence: PriceConfidence;
  price_estimation_reasoning: string;
};

type NormalizedTimeline = {
  timeline: AnalysisTimeline;
  timeline_confidence: TimelineConfidence;
  timeline_estimation_reasoning: string;
};

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toText(item)).filter(Boolean);
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = toText(value);
  if (!text) return null;
  if (!/\d/.test(text)) return null;
  const parsed = parseNumber(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectCurrencyCode(text: string): string | null {
  const upper = text.toUpperCase();
  const codeMatch = upper.match(/\b(USD|EUR|GBP|AUD|CAD|INR|JPY|CNY|NZD|SGD|CHF|AED|SAR|ZAR)\b/);
  if (codeMatch?.[1]) return codeMatch[1];
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";
  if (text.includes("₹")) return "INR";
  if (text.includes("¥")) return "JPY";
  if (text.includes("$")) return "USD";
  return null;
}

function sanitizeAnalysisTimeline(value: unknown): AnalysisTimeline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const start = toText(candidate.start) || null;
  const end = toText(candidate.end) || null;
  const durationWeeks = normalizeNumber(candidate.duration_weeks);
  if (!start && !end && durationWeeks === null) return null;
  return {
    start,
    end,
    duration_weeks: durationWeeks,
  };
}

function inferPriceFromText(sourceText: string): NormalizedPrice {
  const extracted = extractCurrencyLikeText(sourceText);
  const numeric = normalizeNumber(extracted);
  const sourceCurrency = detectCurrencyCode(extracted) || detectCurrencyCode(sourceText);

  if (numeric !== null) {
    const explicit = /(?:\b(?:price|budget|total|fee|cost|quote|proposal)\b|[$€£₹¥]|\b(?:USD|EUR|GBP|AUD|CAD|INR|JPY|CNY|NZD|SGD|CHF|AED|SAR)\b)/i.test(extracted) || /[$€£₹¥]|\b(?:USD|EUR|GBP|AUD|CAD|INR|JPY|CNY|NZD|SGD|CHF|AED|SAR)\b/i.test(sourceText);
    return {
      price: numeric,
      price_currency: sourceCurrency || "USD",
      price_confidence: explicit ? "exact" : "estimated",
      price_estimation_reasoning: explicit ? "Explicit price detected in proposal text." : `Estimated from proposal text: ${extracted}`,
    };
  }

  return {
    price: null,
    price_currency: null,
    price_confidence: "unknown",
    price_estimation_reasoning: "Price not found in the proposal text.",
  };
}

function inferTimelineFromText(sourceText: string): NormalizedTimeline {
  const extracted = extractTimelineLikeText(sourceText);
  const durationMatch = extracted.match(/\b(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i) || sourceText.match(/\b(\d+(?:\.\d+)?)\s*(days?|weeks?|months?|years?)\b/i);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    const durationWeeks = unit.startsWith("day") ? Math.max(1, Math.round(amount / 7)) : unit.startsWith("month") ? Math.max(1, Math.round(amount * 4.345)) : unit.startsWith("year") ? Math.max(1, Math.round(amount * 52)) : Math.max(1, Math.round(amount));
    return {
      timeline: { start: null, end: null, duration_weeks: durationWeeks },
      timeline_confidence: /\b(?:weeks?|months?|years?|days?)\b/i.test(extracted) ? "explicit" : "inferred",
      timeline_estimation_reasoning: `Duration detected in proposal text: ${durationMatch[0]}.`,
    };
  }

  const isoDates = Array.from(new Set((sourceText.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []).map((date) => date.trim())));
  if (isoDates.length >= 2) {
    return {
      timeline: { start: isoDates[0], end: isoDates[1], duration_weeks: null },
      timeline_confidence: "explicit",
      timeline_estimation_reasoning: `Explicit dates detected: ${isoDates[0]} to ${isoDates[1]}.`,
    };
  }

  if (isoDates.length === 1) {
    return {
      timeline: { start: null, end: isoDates[0], duration_weeks: null },
      timeline_confidence: "explicit",
      timeline_estimation_reasoning: `Explicit date detected: ${isoDates[0]}.`,
    };
  }

  return {
    timeline: { start: null, end: null, duration_weeks: null },
    timeline_confidence: "unknown",
    timeline_estimation_reasoning: "Timeline not found in the proposal text.",
  };
}

function normalizeProposalAnalysis(raw: unknown, vendorMarkdown: string, vendorName: string): ProposalAnalysis {
  const source = (vendorMarkdown || "").toString();
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const recommendation = toText(data.recommendation) || toText(data.independent_recommendation) || "Not Recommended";
  const priceCandidate = normalizeNumber(data.price);
  const priceCurrencyCandidate = toText(data.price_currency) || null;
  const priceConfidence = toText(data.price_confidence) as PriceConfidence;
  const priceReason = toText(data.price_estimation_reasoning);
  const timelineCandidate = sanitizeAnalysisTimeline(data.timeline);
  const timelineConfidence = toText(data.timeline_confidence) as TimelineConfidence;
  const timelineReason = toText(data.timeline_estimation_reasoning);

  const inferredPrice = inferPriceFromText(source);
  const inferredTimeline = inferTimelineFromText(source);

  const price = priceCandidate !== null ? priceCandidate : inferredPrice.price;
  const priceCurrency = priceCurrencyCandidate || inferredPrice.price_currency;
  const normalizedPriceConfidence: PriceConfidence = priceCandidate !== null
    ? (priceConfidence === "exact" || priceConfidence === "estimated" || priceConfidence === "unknown" ? priceConfidence : inferredPrice.price_confidence)
    : inferredPrice.price_confidence;

  const timeline = timelineCandidate || inferredTimeline.timeline;
  const normalizedTimelineConfidence: TimelineConfidence = timelineCandidate
    ? (timelineConfidence === "explicit" || timelineConfidence === "inferred" || timelineConfidence === "unknown" ? timelineConfidence : inferredTimeline.timeline_confidence)
    : inferredTimeline.timeline_confidence;

  const criterionScores = data.criterion_scores && typeof data.criterion_scores === "object" ? data.criterion_scores as ProposalAnalysis["criterion_scores"] : {
    technical_fit: { score: 0, reason: "Scoring unavailable" },
    cost_efficiency: { score: 0, reason: "Scoring unavailable" },
    relevant_experience: { score: 0, reason: "Scoring unavailable" },
    timeline_fit: { score: 0, reason: "Scoring unavailable" },
    compliance_completeness: { score: 0, reason: "Scoring unavailable" },
  };

  const strengths = toStringArray(data.strengths);
  const weaknesses = toStringArray(data.weaknesses);
  const riskFlags = toStringArray(data.risk_flags);
  const analysisSummary = toText(data.analysis_summary) || `Automated analysis generated for ${vendorName}.`;
  const riskSummary = toText(data.risk_summary) || (riskFlags.length > 0 ? riskFlags.join("; ") : "No major risk flags detected.");

  return {
    vendor_name: toText(data.vendor_name) || vendorName || "Unknown",
    recommendation,
    overall_score: normalizeNumber(data.overall_score) ?? 0,
    independent_recommendation: recommendation,
    price,
    price_currency: priceCurrency,
    price_confidence: normalizedPriceConfidence,
    price_estimation_reasoning: priceReason || inferredPrice.price_estimation_reasoning,
    timeline,
    timeline_confidence: normalizedTimelineConfidence,
    timeline_estimation_reasoning: timelineReason || inferredTimeline.timeline_estimation_reasoning,
    criterion_scores: criterionScores,
    strengths,
    weaknesses,
    risk_flags: riskFlags,
    risk_summary: riskSummary,
    analysis_summary: analysisSummary,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Agent 1 — Extractor
   Reads messy text and converts it into clean structured Markdown
   focused only on evaluation-relevant content.
   ═══════════════════════════════════════════════════════════════════ */
async function runExtractor(docType: "RFP" | "Vendor Proposal", text: string): Promise<string> {
  const safeText = clampExtractorInput(text);
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
${safeText}`;

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

PRICE AND TIMELINE EXTRACTION REQUIREMENT
Before scoring, inspect the vendor proposal for explicit price and timeline details.
- Return the best numeric price you can find in 'price'.
- Set 'price_currency' to the detected ISO currency code when possible.
- Use 'price_confidence' = "exact" when the price is explicit, "estimated" when inferred, and "unknown" if missing.
- Return 'timeline' as { "start": string | null, "end": string | null, "duration_weeks": number | null }.
- Use 'timeline_confidence' = "explicit" when the dates or duration are explicit, "inferred" when estimated, and "unknown" if missing.
- Add short reasoning in 'price_estimation_reasoning' and 'timeline_estimation_reasoning' when values are estimated or inferred.
- Include a short 'risk_summary' in addition to 'risk_flags'.
- Keep 'recommendation' and 'independent_recommendation' in sync.

RETURN STRICT JSON:
{
  "vendor_name": "${vendorName}",
  "recommendation": "<Strongly Recommended|Recommended|Consider|Risky|Not Recommended>",
  "overall_score": <number>,
  "independent_recommendation": "<Strongly Recommended|Recommended|Consider|Risky|Not Recommended>",
  "price": <number|null>,
  "price_currency": <string|null>,
  "price_confidence": "<exact|estimated|unknown>",
  "price_estimation_reasoning": "<string>",
  "timeline": { "start": <string|null>, "end": <string|null>, "duration_weeks": <number|null> },
  "timeline_confidence": "<explicit|inferred|unknown>",
  "timeline_estimation_reasoning": "<string>",
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
  "risk_summary": "<string>",
  "analysis_summary": "<string>"
}`;

  try {
    return normalizeProposalAnalysis(await openRouterChatJSON({
      model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
      messages: [
        { role: "system", content: "You are a JSON-only API. You MUST respond with raw valid JSON only. No explanations, no markdown, no text before or after the JSON object. Keep all string values concise (under 30 words each)." },
        { role: "user", content: prompt },
      ],
      max_tokens: 6000,
      temperature: 0,
    }), vendorMarkdown, vendorName);
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
      const fixerPrompt = `You are a JSON fixer. Convert the following analysis output into strict JSON matching this schema:\n${JSON.stringify({ vendor_name: "", recommendation: "", overall_score: 0, independent_recommendation: "", price: null, price_currency: null, price_confidence: "unknown", price_estimation_reasoning: "", timeline: { start: null, end: null, duration_weeks: null }, timeline_confidence: "unknown", timeline_estimation_reasoning: "", criterion_scores: { technical_fit: { score: 0, reason: "" }, cost_efficiency: { score: 0, reason: "" }, relevant_experience: { score: 0, reason: "" }, timeline_fit: { score: 0, reason: "" }, compliance_completeness: { score: 0, reason: "" } }, strengths: [], weaknesses: [], risk_flags: [], risk_summary: "", analysis_summary: "" }, null, 2)}\n\nHere is the raw analysis:\n\n${raw}`;

      return normalizeProposalAnalysis(await openRouterChatJSON({
        model: AGENT_MODEL.REQUIREMENT_EXTRACTION,
        messages: [
          { role: "system", content: "You are a JSON-only API. Extract valid JSON only, no surrounding text." },
          { role: "user", content: fixerPrompt },
        ],
        max_tokens: 6000,
        temperature: 0,
      }), vendorMarkdown, vendorName);
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

async function resolveVendorText(input: {
  vendorName?: string;
  price?: string;
  timeline?: string;
  experience?: string;
  proposalData?: unknown;
  proposalFileUrl?: string;
}): Promise<string> {
  const directText = buildVendorText({
    vendorName: input.vendorName,
    price: input.price,
    timeline: input.timeline,
    experience: input.experience,
    proposalData: input.proposalData,
  });

  if (input.proposalData) {
    return directText;
  }

  const pdfUrl = typeof input.proposalFileUrl === "string" ? input.proposalFileUrl.trim() : "";
  if (!pdfUrl) {
    return directText;
  }

  try {
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      return `${directText}\n\n## PDF Extraction\nFailed to fetch proposal PDF from URL.`;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const extraction = await extractPdfTextWithOcrFallback(buffer, { minTextChars: 60, maxOcrPages: 20 });
    return buildVendorText({
      vendorName: input.vendorName,
      price: input.price,
      timeline: input.timeline,
      experience: input.experience,
      proposalData: extraction.text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${directText}\n\n## PDF Extraction\nFailed to extract vendor PDF: ${message}`;
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
            const { contract_title, contract_description, contract_budget, contract_deadline, contract_certifications, rfp_text,
              vendor_name, vendor_price, vendor_timeline, vendor_experience, proposal_data, proposal_file_url } = body;

      // Build RFP text from the stored RFP content when available, otherwise fall back to metadata.
      const rfpText = String(rfp_text || "").trim() || [
        `Contract Title: ${contract_title || "N/A"}`,
        `Description: ${contract_description || "N/A"}`,
        `Budget: $${contract_budget || "N/A"}`,
        `Deadline: ${contract_deadline || "N/A"}`,
        contract_certifications ? `Required Certifications: ${contract_certifications}` : "",
      ].filter(Boolean).join("\n");

      const vendorText = await resolveVendorText({
        vendorName: vendor_name,
        price: vendor_price,
        timeline: vendor_timeline,
        experience: vendor_experience,
        proposalData: proposal_data,
        proposalFileUrl: proposal_file_url,
      });

      trace = langfuse.trace({
        name: `Vendor Analysis - ${vendor_name || "Unknown"}`,
        metadata: {
          vendorName: vendor_name || "Unknown",
          fileNames: proposal_data ? ["proposal_data_json"] : proposal_file_url ? ["proposal_file_url"] : [],
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
          proposalFileUrlProvided: Boolean(proposal_file_url),
          vendorTextChars: vendorText.length,
        },
      });

      let rfpMarkdown = "";
      try {
        rfpMarkdown = await runExtractor("RFP", rfpText);
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        console.warn(`[AI:POST:score_single] RFP extractor failed, using fallback text: ${msg}`);
        rfpMarkdown = `# Document Type\nRFP\n\n# Core Summary\nFallback extraction generated from contract fields.\n\n# Evaluation-Relevant Fields\n${clampExtractorInput(rfpText)}`;
      }

      let vendorMarkdown = "";
      try {
        vendorMarkdown = await runExtractor("Vendor Proposal", vendorText);
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        console.warn(`[AI:POST:score_single] Vendor extractor failed for ${vendor_name || "Unknown"}, using fallback text: ${msg}`);
        vendorMarkdown = `# Document Type\nVendor Proposal\n\n# Core Summary\nFallback extraction generated from vendor text.\n\n# Evaluation-Relevant Fields\n${clampExtractorInput(vendorText)}`;
      }

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

      const normalizedAnalysis = normalizeProposalAnalysis(scorerResult, vendorMarkdown, vendor_name || "Unknown");

      trace.update({
        metadata: {
          vendorName: vendor_name || "Unknown",
          finalScore: normalizedAnalysis.overall_score,
          latency: Date.now() - requestStartedAt,
        },
      });

      return NextResponse.json({
        analysis: normalizedAnalysis,
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
        vendors, contract_id, rfp_text } = body;
      const fastMode = !!body.fastMode;

      console.log(`[AI:POST:full_pipeline] Starting. vendors=${Array.isArray(vendors) ? vendors.length : 0}`);

      // Build RFP text from the stored RFP content when available, otherwise fall back to metadata.
      const rfpText = String(rfp_text || "").trim() || [
        `Contract Title: ${contract_title || "N/A"}`,
        `Description: ${contract_description || "N/A"}`,
        `Budget: $${contract_budget || "N/A"}`,
        `Deadline: ${contract_deadline || "N/A"}`,
        contract_certifications ? `Required Certifications: ${contract_certifications}` : "",
      ].filter(Boolean).join("\n");

      // Agent 1: Extract RFP once
      console.log(`[AI:POST:full_pipeline] Calling runExtractor for RFP`);
      let rfpMarkdown = "";
      try {
        rfpMarkdown = await runExtractor("RFP", rfpText);
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        console.warn(`[AI:POST:full_pipeline] RFP extractor failed, using fallback text: ${msg}`);
        rfpMarkdown = `# Document Type\nRFP\n\n# Core Summary\nFallback extraction generated from contract fields.\n\n# Evaluation-Relevant Fields\n${clampExtractorInput(rfpText)}`;
      }
      console.log(`[AI:POST:full_pipeline] runExtractor completed. rfpMarkdown length=${rfpMarkdown.length}`);

      trace = langfuse.trace({
        name: `Vendor Analysis - ${contract_title || "Unknown Contract"}`,
        metadata: {
          contractTitle: contract_title || "Unknown",
          vendorCount: Array.isArray(vendors) ? vendors.length : 0,
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
            fileNames: v.proposal_data ? ["proposal_data_json"] : v.proposal_file_url ? ["proposal_file_url"] : [],
            modelUsed: AGENT_MODEL.DOCUMENT_ANALYSIS,
            tokenUsage: null,
            latency: null,
            finalScore: null,
          },
        });

        const vendorText = await resolveVendorText({
          vendorName: v.vendor_name,
          price: v.price,
          timeline: v.timeline,
          experience: v.experience,
          proposalData: v.proposal_data,
          proposalFileUrl: v.proposal_file_url,
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
              recommendation: "Not Recommended",
              overall_score: 0,
              independent_recommendation: "Not Recommended",
              price: null,
              price_currency: null,
              price_confidence: "unknown",
              price_estimation_reasoning: "Scoring failed before price extraction completed.",
              timeline: { start: null, end: null, duration_weeks: null },
              timeline_confidence: "unknown",
              timeline_estimation_reasoning: "Scoring failed before timeline extraction completed.",
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
              risk_summary: `Automated scoring failed: ${msg.slice(0, 100)}`,
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

        try {
          await saveProposalAnalysisResult(contract_id, {
            cache_key: `analysis:${contract_id}:${Date.now()}`,
            created_at: new Date().toISOString(),
            analyses_by_proposal_id: analysesByProposalId,
            judge_result: judgeResult ?? null,
            vendor_count: vendorScores.length,
          });
        } catch (cacheErr) {
          const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
          console.warn(`[AI:POST:full_pipeline] Failed to save analysis cache, continuing without cache: ${msg}`);
        }
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
