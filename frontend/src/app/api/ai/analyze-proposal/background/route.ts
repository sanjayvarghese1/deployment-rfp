import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/services/supabase";
import { runCachedFullPipeline, saveProposalAnalysisResult } from "@/services/aiService";
import { createAnalysisJob, updateAnalysisJob } from "@/services/analysisJobs";
import type { FullPipelineResult, ProposalAnalysis } from "@/services/aiService";
import type { MandatoryCriteriaPayload } from "@/lib/rfp/config";
import { createClient } from "@supabase/supabase-js";

type BackgroundVendorInput = {
  proposal_id?: string;
  vendor_name: string;
  price: string;
  timeline: string;
  experience: string;
  proposal_data?: string;
};

type ProposalSourceRow = {
  id: string;
  proposal_file: string | null;
  proposal_data: string | null;
};

type BackgroundAnalysisRequest = {
  contract_id: string;
  contract: {
    title: string;
    description: string;
    budget: string;
    deadline?: string;
    certifications?: string;
    mandatoryCriteria?: MandatoryCriteriaPayload;
  };
  vendors?: BackgroundVendorInput[];
};

function isWeakProposalText(text: string | null | undefined): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return true;

  if (normalized.startsWith("{")) {
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      const storagePath = String(parsed.storagePath || parsed.storage_path || "").trim();
      const source = String(parsed.source || "").trim();
      const sections = parsed.sections as Record<string, unknown> | undefined;
      const sectionTextLength = sections
        ? Object.values(sections).reduce((sum, value) => sum + String(value || "").trim().length, 0)
        : 0;

      // JSON that only points to a file location is not evaluable proposal content.
      if (storagePath && sectionTextLength < 120) return true;
      if (source === "uploaded_pdf" && sectionTextLength < 120) return true;
      if (sectionTextLength > 0) return sectionTextLength < 140;
    } catch {
      // Non-JSON-like text continues through generic weak-text checks.
    }
  }

  if (normalized.length < 140) return true;
  if (/\[(pdf uploaded|pdf extraction failed)/i.test(normalized)) return true;
  const notFoundCount = (normalized.match(/not found/gi) || []).length;
  const naCount = (normalized.match(/\bn\/a\b/gi) || []).length;
  if (notFoundCount + naCount >= 6) return true;
  const metadataOnly = ["vendor name", "proposed price", "proposed timeline", "vendor experience"]
    .filter((token) => normalized.toLowerCase().includes(token)).length;
  return metadataOnly >= 2 && normalized.length < 500;
}

async function reExtractProposalFromPdf(origin: string, pdfUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/extract-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfUrl }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(`[AI] reExtractProposalFromPdf failed status=${response.status} body=${body.slice(0, 200)}`);
      return null;
    }

    const data = await response.json().catch(() => null) as { extracted_text?: string } | null;
    const extractedText = String(data?.extracted_text || "").trim();
    return extractedText.length > 0 ? extractedText : null;
  } catch (error) {
    console.warn("[AI] reExtractProposalFromPdf error:", error);
    return null;
  }
}

async function processBackgroundAnalysis(jobId: string, origin: string, body: BackgroundAnalysisRequest) {
  const contractId = body.contract_id;
  const contract = body.contract;
  const vendors = Array.isArray(body.vendors) ? body.vendors : [];
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = serviceKey && process.env.NEXT_PUBLIC_SUPABASE_URL
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : supabase;

  console.log(`[AI] processBackgroundAnalysis START jobId=${jobId} origin=${origin} vendors=${vendors.length} at ${new Date().toISOString()}`);

  try {
    await updateAnalysisJob(jobId, { status: "running", progress: "Starting analysis..." });

    const proposalIds = vendors.map((vendor) => vendor.proposal_id).filter((value): value is string => Boolean(value));
    const proposalById = new Map<string, ProposalSourceRow>();

    if (proposalIds.length > 0) {
      const { data: proposalRows, error: proposalReadError } = await db
        .from("proposals")
        .select("id, proposal_file, proposal_data")
        .in("id", proposalIds);

      if (proposalReadError) {
        console.warn("[AI] Failed to read proposal source rows for re-extraction:", proposalReadError);
      } else {
        for (const row of (proposalRows || []) as ProposalSourceRow[]) {
          proposalById.set(row.id, row);
        }
      }
    }

    const hydratedVendors: BackgroundVendorInput[] = [];
    for (const vendor of vendors) {
      const sourceRow = vendor.proposal_id ? proposalById.get(vendor.proposal_id) : undefined;
      const payloadProposalData = String(vendor.proposal_data || "").trim();
      const fallbackDbProposalData = String(sourceRow?.proposal_data || "").trim();
      const sourceText = payloadProposalData || fallbackDbProposalData;
      let proposalData = sourceText;

      const pdfUrl = sourceRow?.proposal_file;
      if (pdfUrl && /^https?:\/\//i.test(pdfUrl) && isWeakProposalText(sourceText)) {
        const extracted = await reExtractProposalFromPdf(origin, pdfUrl);
        if (extracted) {
          proposalData = extracted;
          if (vendor.proposal_id) {
            const { error: writeErr } = await db
              .from("proposals")
              .update({ proposal_data: extracted })
              .eq("id", vendor.proposal_id)
              .eq("contract_id", contractId);
            if (writeErr) {
              console.warn(`[AI] Failed to update proposal_data for proposal ${vendor.proposal_id}:`, writeErr);
            }
          }
        }
      }

      hydratedVendors.push({
        ...vendor,
        proposal_data: proposalData,
      });
    }

    const data: FullPipelineResult = await runCachedFullPipeline(contract, hydratedVendors, origin, { fastMode: false });

    const vendorScores = Array.isArray(data?.vendor_scores) ? data.vendor_scores : [];
    const proposalUpdates: Promise<unknown>[] = [];

    for (let index = 0; index < hydratedVendors.length; index++) {
      const vendor = hydratedVendors[index];
      const score = vendorScores[index];
      if (!vendor || !score || !vendor.proposal_id) continue;
      proposalUpdates.push(
        db.from("proposals").update({
          ai_score: score.overall_score,
          risk_level: score.risk_flags?.length > 0 ? "High" : "Low",
        }).eq("id", vendor.proposal_id).eq("contract_id", contractId)
      );
    }

    await Promise.allSettled(proposalUpdates);

    const analysesByProposalId: Record<string, ProposalAnalysis> = {};
    for (let index = 0; index < hydratedVendors.length; index++) {
      const vendor = hydratedVendors[index];
      const score = vendorScores[index];
      if (vendor?.proposal_id && score) {
        analysesByProposalId[vendor.proposal_id] = score;
      }
    }

    await saveProposalAnalysisResult(contractId, {
      cache_key: data?.cache_key || `${jobId}`,
      created_at: new Date().toISOString(),
      analyses_by_proposal_id: analysesByProposalId,
      judge_result: data?.judge ?? null,
      vendor_count: hydratedVendors.length,
      mandatory_criteria: contract.mandatoryCriteria,
      rfp_extract: data?.rfp_extract || "",
      vendor_extracts: data?.vendor_extracts || {},
      vendor_scores: data?.vendor_scores || [],
    });

    await updateAnalysisJob(jobId, { status: "completed", progress: "Analysis complete", result: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateAnalysisJob(jobId, { status: "failed", progress: "Analysis failed", error: message });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as BackgroundAnalysisRequest;
  const contractId = body.contract_id;
  const contract = body.contract;
  const vendors = Array.isArray(body.vendors) ? body.vendors : [];

  if (!contractId || !contract || vendors.length === 0) {
    return NextResponse.json({ error: "Missing contract_id, contract, or vendors" }, { status: 400 });
  }

  const inserted = await createAnalysisJob({ contract_id: contractId, request: { contract, vendors } });

  console.log(`[AI] created analysis job ${inserted.id} for contract ${contractId}`);

  void processBackgroundAnalysis(inserted.id, req.nextUrl.origin, body);

  return NextResponse.json({ job_id: inserted.id, status: "queued" }, { status: 202 });
}
