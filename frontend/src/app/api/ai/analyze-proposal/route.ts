import { NextRequest, NextResponse } from "next/server";
import { openRouterChat, openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";
import { saveProposalAnalysisResult } from "@/services/aiService";
import type { MandatoryCriteriaPayload } from "@/lib/rfp/config";
import type { AnalysisScoringCriterion, CriterionScore, JudgeResult, ProposalAnalysis } from "@/services/aiService";

export const maxDuration = 240; // Conservative limit for Vercel Hobby (max 300)

type ScoringCriterion = {
  id: string;
  label: string;
  max_score: number;
  notes?: string;
};

type OpenRouterCriterionResponse = {
  score?: number;
  reason?: string;
  evidence?: string;
  support_level?: "explicit" | "partial" | "inferred" | string;
  confidence?: number;
};

type ScoringStrictness = "strict" | "balanced" | "lenient";

const LEGACY_SCORING_CRITERIA: ScoringCriterion[] = [
  { id: "technical_fit", label: "Technical fit", max_score: 30 },
  { id: "cost_efficiency", label: "Cost efficiency", max_score: 20 },
  { id: "relevant_experience", label: "Relevant experience", max_score: 20 },
  { id: "timeline_fit", label: "Timeline fit", max_score: 15 },
  { id: "compliance_completeness", label: "Compliance completeness", max_score: 15 },
];

function clampScore(value: unknown, maxScore: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(maxScore, Math.round(parsed)));
}

function normalizeCriterionLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeRubric(mandatoryCriteria?: MandatoryCriteriaPayload | null): ScoringCriterion[] {
  const payload = mandatoryCriteria || null;
  const sourceCriteria = Array.isArray(payload?.fullRfp) && payload.fullRfp.length > 0
    ? payload.fullRfp
    : (() => {
        const subsystemEntries = Object.entries(payload?.subsystems || {});
        if (subsystemEntries.length > 0) {
          return subsystemEntries[0]?.[1] || [];
        }
        return [];
      })();

  const mapped = sourceCriteria
    .filter((item) => Number(item?.value) > 0)
    .map((item, index) => {
      const label = String(item.label || `Criterion ${index + 1}`);
      return {
        id: normalizeCriterionLabel(item.id || label || `criterion_${index + 1}`),
        label,
        max_score: Math.max(1, Math.round(Number(item.value ?? item.recommendedValue ?? 0))),
        notes: typeof item.notes === "string" ? item.notes : undefined,
      };
    })
    .filter((item) => item.max_score > 0);

  if (mapped.length === 0) {
    return LEGACY_SCORING_CRITERIA;
  }

  const total = mapped.reduce((sum, item) => sum + item.max_score, 0);
  if (total === 100) return mapped;

  const factor = 100 / total;
  const scaled = mapped.map((item) => ({
    ...item,
    max_score: Math.max(1, Math.round(item.max_score * factor)),
  }));
  const adjustedTotal = scaled.reduce((sum, item) => sum + item.max_score, 0);
  const drift = 100 - adjustedTotal;
  if (drift !== 0 && scaled.length > 0) {
    scaled[scaled.length - 1] = {
      ...scaled[scaled.length - 1],
      max_score: Math.max(1, scaled[scaled.length - 1].max_score + drift),
    };
  }
  return scaled;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildCriterionSignalPhrases(criterion: ScoringCriterion): string[] {
  const labels = [criterion.label, criterion.notes || ""].join(" ").toLowerCase();
  const seeds = new Set<string>([
    criterion.label,
    criterion.notes || "",
    ...buildCriterionHints(criterion.label),
  ]);

  const normalized = normalizeCriterionLabel(labels);
  for (const token of normalized.split("_")) {
    if (token.length >= 4) seeds.add(token);
  }

  if (labels.includes("compliance")) {
    ["compliance", "mandatory", "required", "shall", "must", "certification", "certificate", "policy", "security", "privacy", "sla", "deadline"].forEach((token) => seeds.add(token));
  }

  if (labels.includes("technical") || labels.includes("fit")) {
    ["architecture", "implementation", "integration", "deployment", "configuration", "compatibility", "performance", "scalability", "workflow", "solution"].forEach((token) => seeds.add(token));
  }

  if (labels.includes("timeline") || labels.includes("schedule") || labels.includes("delivery")) {
    ["timeline", "schedule", "milestone", "weeks", "months", "delivery", "go live", "implementation"].forEach((token) => seeds.add(token));
  }

  if (labels.includes("experience")) {
    ["experience", "project", "client", "case study", "reference", "similar", "past work", "implemented"].forEach((token) => seeds.add(token));
  }

  if (criterion.notes) {
    criterion.notes
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4)
      .forEach((token) => seeds.add(token));
  }

  return [...seeds]
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 4)
    .sort((left, right) => right.length - left.length);
}

function evaluateCriterionEvidence(input: {
  criterion: ScoringCriterion;
  rfpMarkdown: string;
  vendorMarkdown: string;
  vendorText: string;
}): { explicitSupport: boolean; partialSupport: boolean; matchedSignals: string[]; strongestSignal?: string } {
  const vendorRaw = normalizeSearchText(input.vendorText);
  const vendorExtract = normalizeSearchText(input.vendorMarkdown);
  const rfpText = normalizeSearchText(input.rfpMarkdown);
  const signals = buildCriterionSignalPhrases(input.criterion);

  const matchedSignals = signals.filter((signal) => signal && (vendorRaw.includes(signal) || vendorExtract.includes(signal)));
  const rfpSignals = signals.filter((signal) => signal && rfpText.includes(signal));
  const strongestSignal = matchedSignals.find((signal) => signal.includes(" ")) || matchedSignals[0];

  const explicitSupport = Boolean(strongestSignal) && rfpSignals.length > 0 && (
    vendorRaw.includes(strongestSignal) || vendorExtract.includes(strongestSignal)
  );

  const partialSupport = matchedSignals.length > 0 || rfpSignals.length > 0;

  return { explicitSupport, partialSupport, matchedSignals, strongestSignal };
}

function tightenCriterionScore(input: {
  criterion: ScoringCriterion;
  vendorText: string;
  vendorMarkdown: string;
  rfpMarkdown: string;
  score: CriterionScore;
  mandatoryCriteriaPresent: boolean;
}): CriterionScore {
  const evidence = evaluateCriterionEvidence({
    criterion: input.criterion,
    rfpMarkdown: input.rfpMarkdown,
    vendorMarkdown: input.vendorMarkdown,
    vendorText: input.vendorText,
  });

  const confidence = Number.isFinite(Number(input.score.confidence)) ? Number(input.score.confidence) : undefined;
  const rawScore = clampScore(input.score.score, input.criterion.max_score);
  let score = rawScore;

  if (!evidence.partialSupport) {
    score = 0;
  } else if (input.mandatoryCriteriaPresent && !evidence.explicitSupport) {
    score = Math.min(score, Math.max(0, Math.round(input.criterion.max_score * 0.35)));
  } else if (!evidence.explicitSupport) {
    score = Math.min(score, Math.max(0, Math.round(input.criterion.max_score * (confidence && confidence >= 0.75 ? 0.55 : 0.25))));
  }

  if (score === 0) {
    return {
      ...input.score,
      score: 0,
      reason: `No concrete evidence found for ${input.criterion.label}.`,
      evidence: evidence.matchedSignals.slice(0, 3).join(", "),
      support_level: "inferred",
      confidence: 0,
    } as unknown as CriterionScore;
  }

  return {
    ...input.score,
    score,
    reason: (evidence.explicitSupport ? input.score.reason : `Partial evidence only for ${input.criterion.label}; score capped to avoid over-crediting vague matches.`).slice(0, 220),
    evidence: evidence.matchedSignals.slice(0, 3).join(", ") || input.score.evidence,
    support_level: evidence.explicitSupport ? "explicit" : "partial",
    confidence: evidence.explicitSupport ? Math.max(Number(input.score.confidence || 0), 0.8) : Math.min(Number(input.score.confidence || 0.55), 0.65),
  } as unknown as CriterionScore;
}

function isContentRich(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 120;
}

function guessDocumentType(text: string, fileName?: string): "RFP" | "Vendor Proposal" {
  const normalized = (String(fileName || "") + " " + String(text || "")).toLowerCase();
  const vendorSignals = [
    "vendor proposal",
    "proposed solution",
    "proposed timeline",
    "proposed price",
    "vendor name",
    "references",
    "case study",
    "we propose",
    "our approach",
    "team members",
    "cost breakdown",
    "relevant experience",
    "deliverables mentioned",
    "our proposal",
    "statement of work",
    "pricing",
    "quote",
  ];
  const rfpSignals = [
    "request for proposal",
    "request for quotations",
    "invitation to tender",
    "scope of work",
    "submission deadline",
    "evaluation criteria",
    "proposal due",
    "instructions to bidders",
    "rfp",
    "rfq",
    "tender",
    "contract title",
    "budget:",
    "required deliverables",
    "mandatory requirements",
    "submission",
  ];

  const vendorHits = vendorSignals.filter((sig) => normalized.includes(sig));
  const rfpHits = rfpSignals.filter((sig) => normalized.includes(sig));
  const fileNameText = String(fileName || "").toLowerCase();
  const hasVendorPrice = Boolean(extractPriceFromText(text) || extractPriceFromText(fileName || ""));
  const hasStrongRfpOpening = /request for proposal|request for quotations|invitation to tender/i.test(normalized);
  const hasStrongRfpStructure = /submission deadline|evaluation criteria|instructions to bidders|mandatory requirements|required deliverables/i.test(normalized);

  if (hasVendorPrice || vendorHits.length > 0) {
    return "Vendor Proposal";
  }

  if (hasStrongRfpOpening || (hasStrongRfpStructure && rfpHits.length >= 2)) {
    return "RFP";
  }

  if (fileNameText.includes("rfp") && !/proposal|vendor|quote|pricing/i.test(fileNameText)) {
    return "RFP";
  }

  return "Vendor Proposal";
}

function extractMonetaryToken(text: string): string | null {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const hasMoneyCue = /(budget|price|cost|investment|estimate|fee|amount|total)/i.test(line);
    const amountMatch = line.match(/(?:\$|usd|gbp|eur)?\s*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s?(?:k|m|bn))?)/i);
    const token = amountMatch?.[1]?.trim();
    if (hasMoneyCue && token && /[0-9]/.test(token)) return token;
  }

  const moneyMatch = String(text).match(/(?:\$|usd|gbp|eur)\s*[0-9][0-9,]*(?:\.[0-9]+)?(?:\s?(?:k|m|bn))?/i);
  if (moneyMatch) {
    const digits = moneyMatch[0].match(/[0-9][0-9,]*(?:\.[0-9]+)?(?:\s?(?:k|m|bn))?/i)?.[0];
    if (digits) return digits.trim();
  }

  return null;
}

function extractBudgetFromText(text: string): string | null {
  if (!text) return null;
  const budgetKeywords = ["budget", "project budget", "estimated budget", "total budget", "budget range", "available budget"];
  const token = extractMonetaryToken(text);
  if (token) {
    const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (budgetKeywords.some((keyword) => line.toLowerCase().includes(keyword)) && line.includes(token)) {
        return token;
      }
    }
  }

  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (budgetKeywords.some((keyword) => line.toLowerCase().includes(keyword))) {
      const amountMatch = line.match(/(?:\$|usd|gbp|eur)?\s*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s?(?:k|m|bn))?)/i);
      const candidate = amountMatch?.[1]?.trim();
      if (candidate && /[0-9]/.test(candidate)) return candidate;
    }
  }

  if (!text) return null;
  return null;
}

function extractPriceFromText(text: string): string | null {
  if (!text) return null;
  const priceKeywords = ["proposed price", "total price", "price", "cost", "total investment", "bid", "quote", "quoted"];
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!priceKeywords.some((keyword) => line.toLowerCase().includes(keyword))) continue;
    const amountMatch = line.match(/(?:\$|usd|gbp|eur)?\s*([0-9][0-9,]*(?:\.[0-9]+)?(?:\s?(?:k|m|bn))?)/i);
    const candidate = amountMatch?.[1]?.trim();
    if (candidate && /[0-9]/.test(candidate)) return candidate;
  }

  const moneyMatch = extractMonetaryToken(text);
  return moneyMatch;
}

function getScoringStrictness(): ScoringStrictness {
  const raw = String(process.env.ANALYSIS_SCORING_STRICTNESS || "balanced").trim().toLowerCase();
  if (raw === "strict") return "strict";
  if (raw === "lenient") return "lenient";
  return "balanced";
}

function getFullScoreConfidenceThreshold(): number {
  const raw = Number(process.env.ANALYSIS_FULL_SCORE_CONFIDENCE ?? 0.9);
  if (!Number.isFinite(raw)) return 0.9;
  return Math.max(0, Math.min(1, raw));
}

function heuristicStrengthCap(strictness: ScoringStrictness): number {
  // Slightly tightened caps to reduce chance of heuristics approaching full marks
  if (strictness === "strict") return 0.38;
  if (strictness === "lenient") return 0.58;
  return 0.48;
}

function buildCriterionHints(label: string): string[] {
  const normalized = normalizeCriterionLabel(label);

  if (normalized.includes("explain") || normalized.includes("audit") || normalized.includes("trace")) {
    return ["logs", "audit trail", "traceability", "reasoning visibility", "explainability", "decision records"];
  }

  if (normalized.includes("fine_tun") || normalized.includes("customiz") || normalized.includes("domain")) {
    return ["fine-tuning", "customization", "model adaptation", "domain-specific training", "prompt tuning", "configuration"];
  }

  if (normalized.includes("real_time") || normalized.includes("sync")) {
    return ["real time", "real-time", "master data", "data sync", "data synchronization", "synchronization", "replication", "change data capture", "integration", "message queue", "retry logic", "reconciliation"];
  }

  if (normalized.includes("cycle_time") || normalized.includes("timeline") || normalized.includes("delivery") || normalized.includes("speed")) {
    return ["timeline", "delivery speed", "implementation schedule", "turnaround", "deployment pace", "time to value"];
  }

  if (normalized.includes("sap") || normalized.includes("oracle") || normalized.includes("compatibility") || normalized.includes("erp")) {
    return ["sap", "sap ecc", "oracle", "oracle erp", "erp compatibility", "system compatibility", "integration gateway"];
  }

  if (normalized.includes("zero_data_loss") || normalized.includes("loss") || normalized.includes("failure")) {
    return ["zero data loss", "no data loss", "retry logic", "queue", "reconciliation", "checkpoint", "transaction log", "rollback", "idempotent"];
  }

  if (normalized.includes("technical") || normalized.includes("platform")) {
    return ["architecture", "integration", "security", "deployment", "scalability", "compatibility"];
  }

  if (normalized.includes("compliance") || normalized.includes("governance")) {
    return ["policies", "controls", "standards", "approvals", "governance", "compliance"];
  }

  return [];
}

function buildHeuristicScore(input: {
  criterion: ScoringCriterion;
  vendorText: string;
  vendorMarkdown: string;
  strictness?: ScoringStrictness;
}): CriterionScore {
  const genericStopTokens = new Set([
    "vendor",
    "vendors",
    "name",
    "proposal",
    "proposals",
    "proposed",
    "price",
    "timeline",
    "experience",
    "feature",
    "features",
    "workflow",
    "hub",
    "days",
    "day",
  ]);

  const haystack = `${input.vendorText}\n${input.vendorMarkdown}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const rawHints = buildCriterionHints(input.criterion.label).map((hint) => hint.toLowerCase());
  const labelTokens = normalizeCriterionLabel(input.criterion.label)
    .split("_")
    .map((token) => token.trim())
    .filter((token) => token.length >= 5 && !["real", "time", "data", "master", "sync", "erp", "api"].includes(token))
    .filter((token) => !genericStopTokens.has(token));

  const candidates = [...new Set([...rawHints, ...labelTokens])]
    .map((hint) => hint.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((hint) => {
      if (!hint) return false;
      if (genericStopTokens.has(hint)) return false;
      if (!hint.includes(" ") && hint.length < 5) return false;
      return true;
    })
    .map((hint) => ({
    hint: hint.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(),
    phraseWeight: hint.includes(" ") ? 1.2 : 0.4,
  }));

  const matched = candidates.filter((candidate) => candidate.hint && haystack.includes(candidate.hint));
  const vendorTextNormalized = (input.vendorText || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const matchedInText = candidates.filter((candidate) => candidate.hint && vendorTextNormalized.includes(candidate.hint));

  if (matched.length === 0) {
    return {
      score: 0,
      reason: `No heuristic evidence found for ${input.criterion.label}.`,
      evidence: "",
      support_level: "inferred",
      confidence: 0,
    } as unknown as CriterionScore;
  }

  const strongMatches = matched.filter((candidate) => candidate.phraseWeight >= 1.0);
  // Require at least one strong multi-word phrase present in the raw vendor text,
  // or at least two candidate matches explicitly present in the vendor text.
  if (strongMatches.length > 0) {
    const strongInText = strongMatches.filter((c) => vendorTextNormalized.includes(c.hint));
    if (strongInText.length === 0) {
      // strong phrase matched only in markdown/extracted text, not raw vendor text -> ignore
      return {
        score: 0,
        reason: `Heuristic phrase found but not present in submitted vendor text; scoring requires phrase evidence in vendor text.`,
        evidence: matchedInText.slice(0, 3).map((item) => item.hint).join(", "),
      };
    }
  } else {
    // No strong multi-word matches: allow a single candidate match in raw vendor text (relaxed)
    if (matchedInText.length < 1) {
      return {
        score: 0,
        reason: `Heuristic evidence was insufficient in vendor text for ${input.criterion.label}.`,
        evidence: matchedInText.slice(0, 3).map((item) => item.hint).join(", "),
      };
    }
  }

  const rawStrength = matchedInText.reduce((sum, candidate) => sum + candidate.phraseWeight, 0);
  const strengthCap = heuristicStrengthCap(input.strictness || "balanced");
  const score = Math.max(1, Math.min(input.criterion.max_score, Math.round(input.criterion.max_score * Math.min(strengthCap, 0.08 * rawStrength))));
  const confidence = Math.max(0.45, Math.min(0.75, 0.4 + 0.05 * rawStrength));
  const support_level = "partial";

  return {
    score,
    reason: `Heuristic evidence found for ${input.criterion.label}: ${matchedInText.slice(0, 3).map((item) => item.hint).join(", ")}.`,
    evidence: matchedInText.slice(0, 3).map((item) => item.hint).join(", "),
    support_level,
    confidence,
  } as unknown as CriterionScore;
}

function buildCriterionEvidencePrompt(input: {
  criterion: ScoringCriterion;
  rfpMarkdown: string;
  vendorMarkdown: string;
  vendorText: string;
  retry?: boolean;
  lenient?: boolean;
  strictness?: ScoringStrictness;
}): string {
  const { criterion, rfpMarkdown, vendorMarkdown, vendorText, retry } = input;
  const hints = buildCriterionHints(criterion.label);
  const strictnessNote = input.strictness === "strict"
    ? "- STRICT MODE: award points only when evidence is specific and clearly grounded in the vendor text."
    : input.strictness === "lenient"
      ? "- LENIENT MODE: when capability is reasonably implied by concrete context, award partial credit instead of defaulting to zero."
      : "- BALANCED MODE: prioritize explicit evidence, but award partial credit for credible indirect evidence.";
  return `You are Agent 2: The Scorer.
Score exactly ONE mandatory criterion for one vendor proposal using evidence from the provided text.

CRITERION
${criterion.label}
Maximum score: ${criterion.max_score}
${criterion.notes ? `Criterion notes: ${criterion.notes}` : ""}

SCORING RULES
- Inspect the vendor proposal and the RFP carefully.
- Treat this as a mandatory requirement, not a style preference.
- Use 0 when the vendor does not explicitly show the capability, document, deliverable, or commitment.
- If the proposal only mentions related buzzwords or generic marketing claims, cap the score low.
- Do not award high scores for vague, inferred, or paraphrased support.
- Prefer raw vendor text evidence over extracted summaries.
- Quote the clearest concrete evidence you used.
- Keep the reason short and factual.
${strictnessNote}
${retry ? "- This is a retry because the first pass came back with an all-zero result. Re-read the text and be less conservative if evidence is present." : ""}

${input.lenient ? "- LENIENT MODE: Be more permissive when evidence is indirect or implied. If the vendor's submission suggests capability or intent, award reasonable partial credit and explain the inference clearly. Avoid inventing facts, but allow inferred evidence from contextual cues." : ""}

RELATED HINTS
${hints.length > 0 ? hints.map((hint) => `- ${hint}`).join("\n") : "- No extra hints"}

OUTPUT JSON ONLY IN THIS SHAPE:
{
  "score": <number>,
  "reason": "<short reason>",
  "evidence": "<exact or near-exact supporting evidence or empty string if none>",
  "support_level": "<explicit|partial|inferred>",
  "confidence": <number between 0 and 1>
}

RFP EXTRACT:
${rfpMarkdown}

VENDOR EXTRACT:
${vendorMarkdown}

RAW VENDOR TEXT:
${vendorText}`;
}

async function scoreCriterion(input: {
  criterion: ScoringCriterion;
  rfpMarkdown: string;
  vendorMarkdown: string;
  vendorText: string;
  retry?: boolean;
  lenient?: boolean;
  strictness?: ScoringStrictness;
}): Promise<CriterionScore> {
  const prompt = buildCriterionEvidencePrompt(input);
  const temperature = input.lenient
    ? 0.4
    : input.strictness === "lenient"
      ? 0.25
      : 0;
  const response = (await openRouterChatJSON({
    model: AGENT_MODEL.QUALITY_ASSURANCE,
    messages: [
      { role: "system", content: "You are a JSON-only API. Return raw JSON only with score, reason, and evidence. Do not add markdown or commentary." },
      { role: "user", content: prompt },
    ],
    max_tokens: 1200,
    temperature,
  })) as OpenRouterCriterionResponse;

  let score = clampScore(response.score, input.criterion.max_score);
  const reason = String(response.reason || "").trim().slice(0, 220);
  const evidence = String(response.evidence || "").trim().slice(0, 500);
  const supportLevelRaw = String(response.support_level || "").trim().toLowerCase();
  const supportLevel = supportLevelRaw === "explicit" || supportLevelRaw === "partial" || supportLevelRaw === "inferred"
    ? supportLevelRaw
    : (evidence ? "partial" : "inferred");
  const confidence = Number.isFinite(Number(response.confidence))
    ? Math.max(0, Math.min(1, Number(response.confidence)))
    : (supportLevel === "explicit" ? 0.85 : supportLevel === "partial" ? 0.7 : 0.55);

  // Calibration guardrails:
  // - inferred evidence cannot receive near-perfect points
  // - partial evidence can score high but not perfect
  // - explicit evidence can reach full marks only with strong confidence
  // Stricter caps: inferred evidence cannot score above 60% of max, partial above 85%.
  const inferredCap = Math.max(1, Math.floor(input.criterion.max_score * 0.6));
  const partialCap = Math.max(1, Math.floor(input.criterion.max_score * 0.85));

  if (supportLevel === "inferred") {
    score = Math.min(score, inferredCap);
  } else if (supportLevel === "partial") {
    score = Math.min(score, partialCap);
  }

  // If confidence is low, softly dampen the score regardless of support level.
  if (confidence < 0.6 && score > 0) {
    const dampened = Math.round(score * (0.8 + confidence * 0.25));
    score = Math.max(1, Math.min(score, dampened));
  }

  // Full marks require explicit support and a configurable high confidence threshold.
  const fullScoreThreshold = getFullScoreConfidenceThreshold();
  if (score === input.criterion.max_score && !(supportLevel === "explicit" && confidence >= fullScoreThreshold)) {
    score = Math.max(1, input.criterion.max_score - 1);
  }

  // Additional validation: when a max score was awarded, ensure the evidence
  // appears in the vendor text and that the RFP contains related hint tokens.
  // This reduces false full-marks where the LLM invents or misaligns evidence.
  if (score === input.criterion.max_score) {
    try {
      const evidenceLower = (evidence || "").toLowerCase();
      const vendorLower = String(input.vendorMarkdown || input.vendorText || "").toLowerCase();
      const rfpLower = String(input.rfpMarkdown || "").toLowerCase();
      const hints = buildCriterionHints(input.criterion.label).map((h) => h.toLowerCase());
      const labelTokens = normalizeCriterionLabel(input.criterion.label).split("_").filter(Boolean);
      const candidates = [...new Set([...hints, ...labelTokens])];

      const evidenceInVendor = evidenceLower.length >= 5 && vendorLower.includes(evidenceLower);
      const hintOverlap = candidates.some((tok) => tok && rfpLower.includes(tok) && (vendorLower.includes(tok) || (evidenceLower && evidenceLower.includes(tok))));

      if (!(evidenceInVendor && hintOverlap)) {
        // Demote full mark if evidence doesn't align with both RFP and vendor text
        score = Math.max(1, input.criterion.max_score - 1);
      }
    } catch (err) {
      // ignore validation failures - keep prior guarded score
    }
  }

  return {
    score,
    reason: reason || (score > 0 ? `Evidence found for ${input.criterion.label}.` : `No evidence found for ${input.criterion.label}.`),
    evidence,
    support_level: supportLevel,
    confidence,
  } as unknown as CriterionScore;
}

function criteriaToMandatoryCriteria(criteria: ScoringCriterion[]): MandatoryCriteriaPayload {
  return {
    fullRfp: criteria.map((criterion, index) => ({
      id: criterion.id || `criterion_${index + 1}`,
      label: criterion.label,
      value: criterion.max_score,
      recommendedValue: criterion.max_score,
      source: "user",
    })),
    subsystems: {},
    selectedSubsystems: ["full"],
    activeSubsystemIndex: 0,
    completedSubsystems: [],
  };
}

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
async function runScorer(
  rfpMarkdown: string,
  vendorMarkdown: string,
  vendorName: string,
  vendorText: string,
  budget: string,
  mandatoryCriteria?: MandatoryCriteriaPayload,
  options?: { llmOnly?: boolean },
): Promise<ProposalAnalysis> {
  const scoringCriteria = normalizeRubric(mandatoryCriteria);
  const strictness = getScoringStrictness();
  const criterionScores: AnalysisScoringCriterion[] = [];

  for (const criterion of scoringCriteria) {
    const scored = await scoreCriterion({
      criterion,
      rfpMarkdown,
      vendorMarkdown,
      vendorText,
      strictness,
    });
    const tightened = tightenCriterionScore({
      criterion,
      vendorText,
      vendorMarkdown,
      rfpMarkdown,
      score: scored,
      mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
    });
    criterionScores.push({
      id: criterion.id,
      label: criterion.label,
      max_score: criterion.max_score,
      score: tightened.score,
      reason: tightened.reason,
      evidence: tightened.evidence,
      support_level: (tightened as any).support_level,
      confidence: (tightened as any).confidence,
    });
  }

  const initialTotal = criterionScores.reduce((sum, item) => sum + item.score, 0);
  const vendorHasContent = isContentRich(vendorText) || isContentRich(vendorMarkdown);

  // Per-criterion rescue: when LLM gives 0 but there is direct text evidence,
  // use a bounded heuristic score instead of forcing a full all-zero fallback pass.
  if (!options?.llmOnly && vendorHasContent) {
    for (let i = 0; i < scoringCriteria.length; i++) {
      const current = criterionScores[i];
      if (!current || current.score > 0) continue;
      const criterion = scoringCriteria[i];
      const heuristic = buildHeuristicScore({
        criterion,
        vendorText,
        vendorMarkdown,
        strictness,
      });
      if (heuristic.score > 0) {
        const tightened = tightenCriterionScore({
          criterion,
          vendorText,
          vendorMarkdown,
          rfpMarkdown,
          score: heuristic,
          mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
        });
        criterionScores[i] = {
          ...current,
          score: tightened.score,
          reason: `${current.reason} Heuristic assist: ${tightened.reason}`.slice(0, 220),
          evidence: tightened.evidence || current.evidence,
          support_level: (tightened as any).support_level || (current as any).support_level,
          confidence: (tightened as any).confidence || (current as any).confidence,
        };
      }
    }
  }

  if (vendorHasContent && initialTotal === 0) {
    criterionScores.length = 0;
    for (const criterion of scoringCriteria) {
      const scored = await scoreCriterion({
        criterion,
        rfpMarkdown,
        vendorMarkdown,
        vendorText,
        retry: true,
        strictness,
      });
      const tightened = tightenCriterionScore({
        criterion,
        vendorText,
        vendorMarkdown,
        rfpMarkdown,
        score: scored,
        mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
      });
      criterionScores.push({
        id: criterion.id,
        label: criterion.label,
        max_score: criterion.max_score,
        score: tightened.score,
        reason: tightened.reason,
        evidence: tightened.evidence,
        support_level: (tightened as any).support_level,
        confidence: (tightened as any).confidence,
      });
    }
  }

  // Only run heuristic fallback when not explicitly requested to use LLM-only scoring
  if (!options?.llmOnly && vendorHasContent && criterionScores.every((item) => item.score === 0)) {
    criterionScores.length = 0;
    for (const criterion of scoringCriteria) {
      const scored = buildHeuristicScore({
        criterion,
        vendorText,
        vendorMarkdown,
        strictness,
      });
      const tightened = tightenCriterionScore({
        criterion,
        vendorText,
        vendorMarkdown,
        rfpMarkdown,
        score: scored,
        mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
      });
      criterionScores.push({
        id: criterion.id,
        label: criterion.label,
        max_score: criterion.max_score,
        score: tightened.score,
        reason: tightened.reason,
        evidence: tightened.evidence,
        support_level: (tightened as any).support_level,
        confidence: (tightened as any).confidence,
      });
    }
  }
  // If heuristics produced no evidence (all-zero) and LLM-only was not requested, fall back to the LLM scorer
  if (!options?.llmOnly && vendorHasContent && criterionScores.every((item) => item.score === 0)) {
    criterionScores.length = 0;
    for (const criterion of scoringCriteria) {
      const scored = await scoreCriterion({
        criterion,
        rfpMarkdown,
        vendorMarkdown,
        vendorText,
        retry: true,
        lenient: true,
        strictness,
      });
      const tightened = tightenCriterionScore({
        criterion,
        vendorText,
        vendorMarkdown,
        rfpMarkdown,
        score: scored,
        mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
      });
      criterionScores.push({
        id: criterion.id,
        label: criterion.label,
        max_score: criterion.max_score,
        score: tightened.score,
        reason: tightened.reason,
        evidence: tightened.evidence,
        support_level: (tightened as any).support_level,
        confidence: (tightened as any).confidence,
      });
    }
  }

  // If the caller explicitly requested LLM-only scoring, run a lenient LLM pass to score all criteria
  if (options?.llmOnly && vendorHasContent) {
    criterionScores.length = 0;
    for (const criterion of scoringCriteria) {
      const scored = await scoreCriterion({
        criterion,
        rfpMarkdown,
        vendorMarkdown,
        vendorText,
        retry: true,
        lenient: true,
        strictness,
      });
      const tightened = tightenCriterionScore({
        criterion,
        vendorText,
        vendorMarkdown,
        rfpMarkdown,
        score: scored,
        mandatoryCriteriaPresent: Boolean(mandatoryCriteria),
      });
      criterionScores.push({
        id: criterion.id,
        label: criterion.label,
        max_score: criterion.max_score,
        score: tightened.score,
        reason: tightened.reason,
        evidence: tightened.evidence,
        support_level: (tightened as any).support_level,
        confidence: (tightened as any).confidence,
      });
    }
  }

  const overall_score = criterionScores.reduce((sum, item) => sum + item.score, 0);
  const criterion_scores = Object.fromEntries(criterionScores.map((criterion) => [criterion.id, {
    score: criterion.score,
    reason: criterion.reason,
    evidence: criterion.evidence,
    max_score: criterion.max_score,
  }]));
  // Build weaknesses (include low scoring and non-explicit evidence as weaknesses)
  const weaknessThresholdFactor = 0.4; // criteria scoring below 40% of max considered weaknesses
  const weaknesses = criterionScores
    .filter((item) => (
      item.score === 0 ||
      item.score < Math.ceil(item.max_score * weaknessThresholdFactor) ||
      ((item as any).support_level || "") !== "explicit" && item.score < item.max_score
    ))
    .map((item) => `${item.label}: ${item.reason || "Insufficient or indirect evidence"}`).slice(0, 5);

  const mandatoryGaps = criterionScores.filter((item) => item.score === 0).map((item) => item.label).slice(0, 5);

  // Risk flags for inferred evidence or low confidence
  const risk_flags = criterionScores
    .filter((item) => ((item as any).support_level === "inferred") || ((item as any).confidence !== undefined && (item as any).confidence < 0.6) || item.score === 0)
    .map((item) => {
      if (item.score === 0) return `${item.label} missing`;
      if ((item as any).support_level === "inferred") return `${item.label} inferred evidence`;
      if ((item as any).confidence !== undefined && (item as any).confidence < 0.6) return `${item.label} low confidence`;
      return `${item.label} review recommended`;
    }).slice(0, 5);

  return {
    vendor_name: vendorName,
    overall_score,
    independent_recommendation:
      overall_score >= 85 ? "Strongly Recommended"
        : overall_score >= 70 ? "Recommended"
        : overall_score >= 55 ? "Consider"
        : overall_score >= 40 ? "Risky"
        : "Not Recommended",
    budget: budget || "Not provided",
    criterion_scores,
    scoring_criteria: criterionScores,
    mandatory_criteria: criteriaToMandatoryCriteria(scoringCriteria),
    strengths: criterionScores.filter((item) => item.score > 0).map((item) => `${item.label}: ${item.reason}`).slice(0, 5),
    weaknesses,
    risk_flags,
    analysis_summary: overall_score === 0
      ? "The proposal did not contain enough evidence to score any criterion."
      : `Weighted score based on ${criterionScores.length} mandatory criteria and vendor evidence. ${mandatoryGaps.length} mandatory gaps remain.`,
  };
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
  ];

  if (input.price) {
    base.push(`Proposed Price: ${input.price}`);
  }
  if (input.timeline) {
    base.push(`Proposed Timeline: ${input.timeline}`);
  }
  if (input.experience) {
    base.push(`Vendor Experience: ${input.experience}`);
  }

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
        "",
        ...(input.price || parsed.totalPrice ? [`Proposed Price: ${input.price || (parsed.totalPrice as string)}`] : []),
        ...(input.timeline || parsed.timeline ? [`Proposed Timeline: ${input.timeline || (parsed.timeline as string)}`] : []),
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

// ─ Weak-text detection: identify storage pointers and insufficient content ─
function isWeakProposalText(text: string | null | undefined): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return true;

  // Check for JSON storage pointers (not real proposal content)
  if (normalized.startsWith("{")) {
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      const storagePath = String(parsed.storagePath || parsed.storage_path || "").trim();
      const source = String(parsed.source || "").trim();
      const sections = parsed.sections as Record<string, unknown> | undefined;
      const sectionTextLength = sections
        ? Object.values(sections).reduce((sum: number, value) => sum + String(value || "").trim().length, 0 as number)
        : 0;

      // JSON that only points to a file location is not evaluable proposal content.
      if (storagePath && sectionTextLength < 120) return true;
      if (source === "uploaded_pdf" && sectionTextLength < 120) return true;
      if (sectionTextLength > 0) return sectionTextLength < 140;
    } catch {
      // Non-JSON-like text continues through generic weak-text checks.
    }
  }

  // Generic weak-text indicators
  if (normalized.length < 140) return true;
  if (/\[(pdf uploaded|pdf extraction failed)/i.test(normalized)) return true;
  const notFoundCount = (normalized.match(/not found/gi) || []).length;
  const naCount = (normalized.match(/\bn\/a\b/gi) || []).length;
  if (notFoundCount + naCount >= 6) return true;
  const metadataOnly = ["vendor name", "proposed price", "proposed timeline", "vendor experience"]
    .filter((token) => normalized.toLowerCase().includes(token)).length;
  return metadataOnly >= 2 && normalized.length < 500;
}

// ─ Re-extract proposal from PDF if current text looks like a storage pointer ─
async function reExtractProposalFromPdf(origin: string, pdfUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/extract-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfUrl }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(`[AI:score_single] reExtract failed status=${response.status} body=${body.slice(0, 200)}`);
      return null;
    }

    const data = await response.json().catch(() => null) as { extracted_text?: string } | null;
    const extractedText = String(data?.extracted_text || "").trim();
    return extractedText.length > 0 ? extractedText : null;
  } catch (error) {
    console.warn("[AI:score_single] reExtract error:", error);
    return null;
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
      let { contract_title, contract_description, contract_budget, contract_deadline, contract_certifications,
              vendor_name, vendor_price, vendor_timeline, vendor_experience, proposal_data, mandatoryCriteria, proposal_file } = body;

      // ── Detect weak proposal text and attempt re-extraction ──
      if (isWeakProposalText(proposal_data) && proposal_file) {
        console.log(`[AI:score_single] Detected weak proposal text (JSON storage pointer or insufficient content), attempting re-extraction from PDF`);
        const reExtracted = await reExtractProposalFromPdf(req.nextUrl.origin, proposal_file);
        if (reExtracted && !isWeakProposalText(reExtracted)) {
          console.log(`[AI:score_single] Successfully re-extracted ${reExtracted.length} chars from PDF`);
          proposal_data = reExtracted;
        } else {
          console.warn(`[AI:score_single] Re-extraction failed or still weak, proceeding with original`);
        }
      }

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
          vendorPrice: vendor_price || null,
          contractBudget: contract_budget || null,
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
      const [rfpMarkdown, vendorMarkdownRaw] = await Promise.all([
        runExtractor("RFP", rfpText),
        runExtractor("Vendor Proposal", vendorText),
      ]);

      const resolvedBudget = contract_budget || extractBudgetFromText(rfpMarkdown) || extractBudgetFromText(rfpText);

      // If vendor provided no explicit price, try to pull price from extracted vendor text
      const extractedPriceForVendor = extractPriceFromText(vendorMarkdownRaw) || extractPriceFromText(String(proposal_file || ""));

      let vendorMarkdown = vendorMarkdownRaw;
      const vendorDocType = extractedPriceForVendor ? "Vendor Proposal" : guessDocumentType(vendorMarkdownRaw, proposal_file);

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
      let scorerResult: ProposalAnalysis;
      if (vendorDocType === "RFP") {
        scorerResult = {
          vendor_name: vendor_name || "Unknown",
          overall_score: 0,
          independent_recommendation: "Not Recommended",
          budget: resolvedBudget || undefined,
          criterion_scores: {},
          scoring_criteria: [],
          mandatory_criteria: mandatoryCriteria || undefined,
          strengths: [],
          weaknesses: [],
          risk_flags: [],
          analysis_summary: "Uploaded document appears to be an RFP rather than a vendor proposal; scoring skipped.",
          price: extractedPriceForVendor || undefined,
          price_confidence: extractedPriceForVendor ? "extracted" : "unknown",
        } as ProposalAnalysis & any;
      } else {
        scorerResult = await runScorer(rfpMarkdown, vendorMarkdown, vendor_name || "Unknown", vendorText, resolvedBudget || "", mandatoryCriteria, { llmOnly: !!body.llmOnly });
        // If the analysis didn't return a price, attach heuristic extraction
        if (!((scorerResult as any).price) && extractedPriceForVendor) {
          (scorerResult as any).price = extractedPriceForVendor;
          (scorerResult as any).price_confidence = "extracted";
        }
      }

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
          vendorPrice: vendor_price || null,
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
      const resolvedBudget = contract_budget || extractBudgetFromText(rfpMarkdown) || extractBudgetFromText(rfpText);

      trace = langfuse.trace({
        name: `Vendor Analysis - ${contract_title || "Unknown Contract"}`,
        metadata: {
          contractTitle: contract_title || "Unknown",
          contractBudget: contract_budget || null,
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
            vendorPrice: v.price || null,
            contractBudget: resolvedBudget || null,
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
          const vendorMarkdownRaw = await runExtractor("Vendor Proposal", vendorText);
          readVendorSpan.end({ output: { vendorExtractChars: vendorMarkdownRaw.length } });

          // Try to extract price from the vendor markdown
          const extractedPrice = extractPriceFromText(vendorMarkdownRaw) || extractPriceFromText(String(v.proposal_file || ""));
          // Detect if vendor file is actually an RFP and extract budget if so
          const vendorDocType = extractedPrice ? "Vendor Proposal" : guessDocumentType(vendorMarkdownRaw, v.proposal_file);
          let vendorMarkdown = vendorMarkdownRaw;
          let scoreResult: ProposalAnalysis & any;
          const extractRequirementsSpan = vendorTrace.span({
            name: "Extract Requirements",
            input: {
              vendorName: v.vendor_name || "Unknown",
              rfpExtractChars: rfpMarkdown.length,
              vendorExtractChars: vendorMarkdown.length,
            },
          });

          if (vendorDocType === "RFP") {
            scoreResult = {
              vendor_name: v.vendor_name || "Unknown",
              overall_score: 0,
              independent_recommendation: "Not Recommended",
              budget: resolvedBudget || undefined,
              criterion_scores: {},
              scoring_criteria: [],
              mandatory_criteria: mandatoryCriteria || undefined,
              strengths: [],
              weaknesses: [],
              risk_flags: [],
              analysis_summary: "Uploaded document appears to be an RFP rather than a vendor proposal; scoring skipped.",
              price: extractedPrice || undefined,
              price_confidence: extractedPrice ? "extracted" : "unknown",
            } as ProposalAnalysis & any;
          } else {
            console.log(`[AI:POST:full_pipeline] Calling runScorer for vendor=${v.vendor_name}`);
            scoreResult = await runScorer(rfpMarkdown, vendorMarkdown, v.vendor_name || "Unknown", vendorText, resolvedBudget || "", mandatoryCriteria);
            console.log(`[AI:POST:full_pipeline] runScorer completed for vendor=${v.vendor_name} score=${scoreResult.overall_score}`);
            // If scorer did not include price, attach heuristic extraction
            if (!scoreResult?.price && extractedPrice) {
              scoreResult.price = extractedPrice;
              scoreResult.price_confidence = "extracted";
            }
          }
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
              vendorPrice: v.price || null,
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
          rfp_extract: rfpMarkdown,
          vendor_extracts: vendorExtracts,
          vendor_scores: vendorScores,
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
