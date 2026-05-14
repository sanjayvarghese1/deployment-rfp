import { NextRequest, NextResponse } from "next/server";
import { openRouterChatJSON, AGENT_MODEL } from "@/lib/openrouter";
import { extractPdfTextWithOcrFallback } from "@/lib/pdfExtraction";

export const runtime = "nodejs";
export const maxDuration = 60;

interface UploadedRfpAnalysis {
  fileName: string;
  fileSize: number;
  pageCount: number;
  extractedText: string;
  sections: Record<string, string>;
  metadata: {
    title?: string;
    author?: string;
    creationDate?: string;
  };
}

interface AiScoreResult {
  overallScore: number;
  improvements: string[];
  strengths: string[];
  readinessLevel: string;
  scoreBreakdown?: {
    completeness?: number;
    clarity?: number;
    technicalDepth?: number;
    complianceReadiness?: number;
  };
}

interface RfpScoreResult {
  overallScore: number;
  suggestions: string[];
  strengths: string[];
  analysis: UploadedRfpAnalysis;
}

async function resolvePdfBuffer(request: NextRequest): Promise<{ buffer: Buffer; fileName: string }> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { pdfUrl?: string; fileName?: string };
    const pdfUrl = typeof body.pdfUrl === "string" ? body.pdfUrl.trim() : "";

    if (!pdfUrl) {
      throw new Error("Missing pdfUrl");
    }

    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName: body.fileName || pdfUrl.split("/").pop() || "uploaded-rfp.pdf",
    };
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("No file provided");
  }

  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    fileName: file.name || "uploaded-rfp.pdf",
  };
}

/**
 * Extract and parse PDF content
 */
async function extractPdfText(pdfBuffer: Buffer): Promise<UploadedRfpAnalysis> {
  try {
    const extracted = await extractPdfTextWithOcrFallback(pdfBuffer, { minTextChars: 60, maxOcrPages: 20 });
    const extractedText = extracted.text;

    // Simple section detection based on common RFP patterns
    const sections = detectSections(extractedText);

    return {
      fileName: "uploaded-rfp.pdf",
      fileSize: pdfBuffer.length,
      pageCount: extracted.pageCount || 0,
      extractedText,
      sections,
      metadata: {
        title: undefined,
        author: undefined,
        creationDate: undefined,
      },
    };
  } catch (error) {
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Detect common RFP sections in text
 */
function detectSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};

  // Common RFP section patterns
  const sectionPatterns = [
    { key: "executive_summary", patterns: ["executive summary", "overview", "introduction"] },
    { key: "project_scope", patterns: ["scope of work", "project scope", "scope"] },
    { key: "requirements", patterns: ["requirements", "technical requirements", "functional requirements"] },
    { key: "timeline", patterns: ["timeline", "schedule", "milestones", "delivery schedule"] },
    { key: "budget", patterns: ["budget", "pricing", "cost", "financial"] },
    { key: "evaluation", patterns: ["evaluation criteria", "selection criteria", "evaluation"] },
    { key: "submission", patterns: ["submission", "how to apply", "application process"] },
    { key: "contact", patterns: ["contact", "questions", "inquiries", "contact information"] },
  ];

  const lines = text.split("\n");
  let currentSection = "general";
  let currentContent = "";

  for (const line of lines) {
    const trimmedLine = line.trim().toLowerCase();

    // Check if this line starts a new section
    let foundSection = false;
    for (const { key, patterns } of sectionPatterns) {
      if (patterns.some((p) => trimmedLine.includes(p) && trimmedLine.length < 100)) {
        if (currentContent.trim()) {
          sections[currentSection] = (sections[currentSection] || "") + currentContent;
        }
        currentSection = key;
        currentContent = "";
        foundSection = true;
        break;
      }
    }

    if (!foundSection) {
      currentContent += line + "\n";
    }
  }

  if (currentContent.trim()) {
    sections[currentSection] = (sections[currentSection] || "") + currentContent;
  }

  return sections;
}

/**
 * Score the RFP using AI model (same as build-from-scratch)
 */
async function scoreRfpWithAi(analysis: UploadedRfpAnalysis): Promise<RfpScoreResult> {
  try {
    // Extract key information from sections
    const sectionsText = Object.entries(analysis.sections)
      .map(([key, value]) => `[${key.toUpperCase()}]\n${value}`)
      .join("\n\n");

    const aiScore = await openRouterChatJSON<AiScoreResult>(
      {
        model: AGENT_MODEL.DOCUMENT_ANALYSIS,
        messages: [
          {
            role: "system",
            content:
              "You are a senior procurement QA scorer. Evaluate RFP documents for completeness, clarity, technical depth, compliance coverage, and vendor-readiness. Return JSON only. Scores must be on a 0-100 scale, where 100 is excellent and 0 is unusable.",
          },
          {
            role: "user",
            content: `Review this uploaded RFP document and provide quality assessment.

Document: ${analysis.fileName}
Page Count: ${analysis.pageCount}

Content:
${analysis.extractedText.slice(0, 8000)}

Sections Detected:
${sectionsText.slice(0, 4000)}

Evaluate the RFP for:
1. Completeness - Are all key RFP sections present (scope, requirements, timeline, budget, evaluation criteria)?
2. Clarity - Is the RFP well-structured and easy to understand?
3. Technical Depth - Does it include sufficient technical requirements and specifications?
4. Compliance - Are compliance, security, and regulatory requirements adequately covered?

Provide actionable improvements and identify strengths. Use short, concrete suggestions.

Return JSON with this exact shape:
{"overallScore":number,"improvements":string[],"strengths":string[],"readinessLevel":"ready|needs_minor_edits|needs_major_revisions","scoreBreakdown":{"completeness":number,"clarity":number,"technicalDepth":number,"complianceReadiness":number}}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      }
    );

    // Extract component scores from breakdown
    const breakdown = aiScore.scoreBreakdown || {
      completeness: 50,
      clarity: 50,
      technicalDepth: 50,
      complianceReadiness: 50,
    };

    return {
      overallScore: Math.max(0, Math.min(100, Math.round(aiScore.overallScore))),
       suggestions: (Array.isArray(aiScore.improvements) ? aiScore.improvements : []).slice(0, 6),
       strengths: (Array.isArray(aiScore.strengths) ? aiScore.strengths : []).slice(0, 3),
      analysis,
    };
  } catch (error) {
    console.error("AI scoring failed:", error);
    // Fallback to basic scoring if AI fails
    return scoreRfpFallback(analysis);
  }
}

/**
 * Fallback heuristic scoring if AI is unavailable
 */
function scoreRfpFallback(analysis: UploadedRfpAnalysis): RfpScoreResult {
  const text = analysis.extractedText;
  const sections = analysis.sections;

  // Completeness: check for key sections
  const keywordSets = {
    scope: ["scope", "requirements", "deliverables"],
    timeline: ["timeline", "schedule", "deadline", "milestone"],
    budget: ["budget", "price", "cost", "fee"],
    technical: ["technical", "technology", "system", "infrastructure"],
    evaluation: ["evaluation", "criteria", "scoring"],
    contact: ["contact", "email", "phone", "inquiries"],
  };

  let completenessScore = 0;
  const suggestions: string[] = [];
  const textLower = text.toLowerCase();

  // Check completeness
  for (const [category, keywords] of Object.entries(keywordSets)) {
    const found = keywords.some((k) => textLower.includes(k));
    if (found) completenessScore += 16.67;
    else {
      suggestions.push(`Add clear ${category} section`);
    }
  }

  // Clarity: check for structured content
  const hasHeadings = /#{1,6}\s|^[A-Z][^.!?]*:$|^\d+\.\s/m.test(text);
  const hasNumberedLists = /^\d+\.|^•|^-/m.test(text);
  const clarityScore = hasHeadings ? 70 : 40;
  if (!hasNumberedLists) suggestions.push("Use numbered lists for better clarity");

  // Technical depth: check for technical keywords
  const technicalKeywords = [
    "api",
    "database",
    "cloud",
    "security",
    "compliance",
    "architecture",
    "integration",
    "performance",
    "sla",
  ];
  const technicalCount = technicalKeywords.filter((k) => textLower.includes(k)).length;
  const technicalDepth = Math.min(100, (technicalCount / technicalKeywords.length) * 100);

  // Compliance readiness: check for compliance-related content
  const complianceKeywords = ["compliance", "regulation", "audit", "gdpr", "hipaa", "iso", "standard", "policy"];
  const complianceCount = complianceKeywords.filter((k) => textLower.includes(k)).length;
  const complianceReadiness = Math.min(100, (complianceCount / complianceKeywords.length) * 100);
  if (complianceReadiness < 50) suggestions.push("Consider adding compliance and regulatory requirements");

  // Overall score
  const overallScore = Math.round(
    (completenessScore * 0.3 + clarityScore * 0.25 + technicalDepth * 0.2 + complianceReadiness * 0.25) / 100
  ) * 100;

  // Additional suggestions based on length
  if (text.length < 2000) {
    suggestions.push("Document may be too short - consider adding more detail");
  }
  if (text.length > 50000) {
    suggestions.push("Document is quite long - consider summarizing sections for clarity");
  }

  return {
    overallScore: Math.min(100, overallScore),
    suggestions: [...new Set(suggestions)].slice(0, 6), // Remove duplicates, limit to 6
    strengths: ["Well-structured document", "Comprehensive content"],
    analysis,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { buffer: pdfBuffer, fileName } = await resolvePdfBuffer(req);
    const analysis = await extractPdfText(pdfBuffer);
    analysis.fileName = fileName;
    const scoreResult = await scoreRfpWithAi(analysis);

    return NextResponse.json(scoreResult);
  } catch (error) {
    console.error("PDF upload failed:", error);
    return NextResponse.json(
      {
        error: "Failed to process PDF",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
