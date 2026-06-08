import { NextRequest, NextResponse } from "next/server";
import { callOllamaGenerate, resolvePreferredModel, safeParseJson } from "@/lib/ai/ollamaApi";

export const runtime = "nodejs";

interface HeuristicExtraction {
  price: string;
  timeline: string;
  description: string;
  candidates: {
    prices: string[];
    timelines: string[];
  };
}

interface RankedCandidate {
  value: string;
  score: number;
}

interface AiExtraction {
  price: string;
  timeline: string;
  description: string;
  confidence: number;
  notes: string[];
}

const OLLAMA_OPTIONS = {
  num_predict: 600,
  temperature: 0.1,
  top_p: 0.85,
  repeat_penalty: 1.05,
};

function normalizeText(raw: string): string {
  return raw
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueNonEmpty(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function parsePriceToNumber(value: string): number {
  const numeric = value.replace(/[^\d.]/g, "");
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickBestPrice(candidates: RankedCandidate[]): string {
  if (candidates.length === 0) return "";
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return parsePriceToNumber(b.value) - parsePriceToNumber(a.value);
  });
  return sorted[0].value;
}

function scoreTimeline(value: string): number {
  let score = 0;
  if (/\b\d+\s*(?:day|days|week|weeks|month|months|year|years)\b/i.test(value)) score += 30;
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(value)) score += 25;
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(value)) score += 20;
  if (/\b(?:to|\-|–)\b/.test(value)) score += 15;
  if (value.length >= 6 && value.length <= 70) score += 10;
  if (/confidential|notice|proprietary/i.test(value)) score -= 60;
  return score;
}

function pickBestTimeline(candidates: RankedCandidate[]): string {
  if (candidates.length === 0) return "";
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  return sorted[0].value;
}

function cleanTimeline(value: string): string {
  return value
    .split(/(?:confidentiality\s+notice|this\s+document\s+contains|proprietary\s+and\s+confidential|all\s+rights\s+reserved)/i)[0]
    .replace(/\s+/g, " ")
    .trim();
}

function extractPriceCandidates(text: string): string[] {
  const ranked: RankedCandidate[] = [];

  const currencyPattern = `(?:(?:\\$|usd|gbp|eur|inr|[\\$\\u00A2-\\u00A5\\u20A0-\\u20CF\\uFE69\\uFF04\\uFFE0\\uFFE1\\uFFE5\\uFFE6₹€£])\\s*[\\d,]+(?:\\.\\d+)?(?:\\s*(?:k|m|bn|lakh|crore|million|billion))?|[\\d,]+(?:\\.\\d+)?(?:\\s*(?:k|m|bn|lakh|crore|million|billion))?\\s*(?:usd|gbp|eur|inr|[\\$\\u00A2-\\u00A5\\u20A0-\\u20CF\\uFE69\\uFF04\\uFFE0\\uFFE1\\uFFE5\\uFFE6₹€£]))`;

  const labeledPatterns: Array<{ pattern: RegExp; score: number }> = [
    {
      pattern: new RegExp(`(?:total\\s+contract\\s+value|total\\s+price|total\\s+cost|grand\\s+total|lump\\s+sum|bid\\s+price|quoted\\s+price)\\s*[:\\-]?\\s*(${currencyPattern})`, "gi"),
      score: 100,
    },
    {
      pattern: new RegExp(`(?:price|budget|cost\\s+proposal)\\s*[:\\-]?\\s*(${currencyPattern})`, "gi"),
      score: 75,
    },
    {
      pattern: /(?:total\s+contract\s+value|total\s+price|total\s+cost|grand\s+total|lump\s+sum)\s*[:\-]?\s*([\d,]+(?:\.\d{1,2})?)/gi,
      score: 90,
    },
  ];

  for (const { pattern, score } of labeledPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = String(match[1] ?? "").replace(/\s+/g, " ").trim();
      if (!value) continue;
      const hasCurrencyIndicator = /[$\u00A2-\u00A5\u20A0-\u20CF\uFE69\uFF04\uFFE0\uFFE1\uFFE5\uFFE6₹€£]/.test(value) || /\b(?:usd|gbp|eur|inr)\b/i.test(value);
      ranked.push({ value: hasCurrencyIndicator ? value : `$${value}`, score });
    }
  }

  if (ranked.length === 0) {
    const fallbackCurrencyRe = new RegExp(currencyPattern, "gi");
    for (const match of text.matchAll(fallbackCurrencyRe)) {
      const value = String(match[0] ?? "").replace(/\s+/g, " ").trim();
      if (value) ranked.push({ value, score: 40 });
    }
  }

  const uniqueValues = uniqueNonEmpty(ranked.map((item) => item.value));
  const rankedUnique = uniqueValues.map((value) => ({
    value,
    score: Math.max(...ranked.filter((item) => item.value === value).map((item) => item.score)),
  }));

  const best = pickBestPrice(rankedUnique);
  if (!best) return uniqueValues;
  return [best, ...uniqueValues.filter((value) => value !== best)];
}

function extractTimelineCandidates(text: string): string[] {
  const ranked: RankedCandidate[] = [];

  const labeled = [
    /(?:timeline|delivery\s+timeline|project\s+duration|duration|delivery\s+time|implementation\s+period)\s*[:\-]?\s*([^\n.]+)/gi,
  ];

  for (const pattern of labeled) {
    for (const match of text.matchAll(pattern)) {
      const value = cleanTimeline(String(match[1] ?? ""));
      if (value.length >= 3) ranked.push({ value, score: 80 + scoreTimeline(value) });
    }
  }

  for (const match of text.matchAll(/\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4})\s*(?:to|\-|–)\s*(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{4})\b/gi)) {
    const value = cleanTimeline(String(match[0] ?? ""));
    ranked.push({ value, score: 95 + scoreTimeline(value) });
  }

  for (const match of text.matchAll(/\b\d+\s*(?:business\s+)?(?:day|days|week|weeks|month|months|year|years)\b/gi)) {
    const value = cleanTimeline(String(match[0] ?? ""));
    ranked.push({ value, score: 70 + scoreTimeline(value) });
  }

  const uniqueValues = uniqueNonEmpty(ranked.map((item) => item.value));
  const rankedUnique = uniqueValues.map((value) => ({
    value,
    score: Math.max(...ranked.filter((item) => item.value === value).map((item) => item.score)),
  }));

  const best = pickBestTimeline(rankedUnique);
  if (!best) return uniqueValues;
  return [best, ...uniqueValues.filter((value) => value !== best)];
}

function extractDescription(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(confidentiality notice|table of contents|appendix|copyright)/i.test(line));

  const paragraph = lines.find((line) => line.length >= 60 && /[a-z]/i.test(line));
  if (paragraph) return paragraph.slice(0, 320);

  const merged = lines.join(" ").replace(/\s+/g, " ").trim();
  return merged.slice(0, 320);
}

function heuristicExtract(rawText: string): HeuristicExtraction {
  const text = normalizeText(rawText);
  const prices = extractPriceCandidates(text);
  const timelines = extractTimelineCandidates(text);

  return {
    price: prices[0] || "",
    timeline: timelines[0] || "",
    description: extractDescription(text),
    candidates: {
      prices,
      timelines,
    },
  };
}

function sanitizeAiOutput(data: AiExtraction, fallback: HeuristicExtraction): AiExtraction {
  const confidence = Number.isFinite(data.confidence) ? Math.max(0, Math.min(100, Number(data.confidence))) : 0;

  const outPrice = String(data.price || "").trim();
  const outTimeline = cleanTimeline(String(data.timeline || "").trim());
  const outDescription = String(data.description || "").trim();

  return {
    price: outPrice || fallback.price,
    timeline: outTimeline || fallback.timeline,
    description: outDescription || fallback.description,
    confidence,
    notes: Array.isArray(data.notes) ? data.notes.slice(0, 5).map((n) => String(n)) : [],
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const proposalText = typeof body?.proposal_text === "string" ? body.proposal_text : "";
    const fileName = typeof body?.file_name === "string" ? body.file_name : "uploaded_proposal";
    const contractHints = {
      budget: typeof body?.contract_budget === "string" ? body.contract_budget : "",
      deadline: typeof body?.contract_deadline === "string" ? body.contract_deadline : "",
    };

    if (!proposalText.trim()) {
      return NextResponse.json({ error: "proposal_text is required" }, { status: 400 });
    }

    const trimmedText = normalizeText(proposalText).slice(0, 30_000);
    const heuristic = heuristicExtract(trimmedText);

    const model = await resolvePreferredModel();
    if (!model) {
      return NextResponse.json({
        extraction: {
          price: heuristic.price,
          timeline: heuristic.timeline,
          description: heuristic.description,
          confidence: 45,
          source: "heuristic",
          notes: ["AI model unavailable; used heuristic extraction."],
          candidates: heuristic.candidates,
        },
      });
    }

    const prompt = `You extract procurement metadata from proposal text.
Return ONLY JSON with this shape:
{
  "price": "<single best total quoted price, include currency symbol if available>",
  "timeline": "<best concise timeline or duration>",
  "description": "<1-2 sentence summary of vendor solution, max 320 chars>",
  "confidence": <0-100 number>,
  "notes": ["brief reason", "brief reason"]
}

Rules:
- Prefer explicit TOTAL/BID/LUMP SUM price over incidental milestone amounts.
- If multiple prices appear, choose the one most clearly labeled as total offer.
- For timeline, prefer overall project duration or explicit start-end range.
- Ignore legal boilerplate/confidentiality text.
- Keep description business-focused.

Filename: ${fileName}
Contract hints:
- Budget: ${contractHints.budget || "N/A"}
- Deadline: ${contractHints.deadline || "N/A"}

Heuristic candidates:
- Price candidates: ${JSON.stringify(heuristic.candidates.prices)}
- Timeline candidates: ${JSON.stringify(heuristic.candidates.timelines)}
- Heuristic description: ${JSON.stringify(heuristic.description)}

Proposal text (truncated):
${trimmedText}`;

    const raw = await callOllamaGenerate({
      model,
      prompt,
      options: OLLAMA_OPTIONS,
      timeoutMs: 60_000,
    });

    const aiParsed = safeParseJson<AiExtraction>(raw, {
      price: "",
      timeline: "",
      description: "",
      confidence: 0,
      notes: [],
    });

    const extraction = sanitizeAiOutput(aiParsed, heuristic);

    return NextResponse.json({
      extraction: {
        ...extraction,
        source: "ai",
        candidates: heuristic.candidates,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Failed to extract upload metadata" }, { status: 500 });
  }
}
