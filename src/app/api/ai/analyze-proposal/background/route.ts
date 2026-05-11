import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/services/supabase";
import { runCachedFullPipeline, saveProposalAnalysisResult } from "@/services/aiService";
import { createAnalysisJob, updateAnalysisJob } from "@/services/analysisJobs";

type BackgroundVendorInput = {
  proposal_id?: string;
  vendor_name: string;
  price: string;
  timeline: string;
  experience: string;
  proposal_data?: string;
};

async function processBackgroundAnalysis(jobId: string, origin: string, body: any) {
  const contractId = body.contract_id as string;
  const contract = body.contract as { title: string; description: string; budget: string; deadline?: string; certifications?: string };
  const vendors = Array.isArray(body.vendors) ? (body.vendors as BackgroundVendorInput[]) : [];

  try {
    await updateAnalysisJob(jobId, { status: "running", progress: "Starting analysis..." });

    const data = await runCachedFullPipeline(contract, vendors, origin);

    const vendorScores = Array.isArray(data?.vendor_scores) ? data.vendor_scores : [];
    const proposalUpdates: Promise<unknown>[] = [];

    for (let index = 0; index < vendors.length; index++) {
      const vendor = vendors[index];
      const score = vendorScores[index];
      if (!vendor || !score || !vendor.proposal_id) continue;
      proposalUpdates.push(
        (supabase.from("proposals").update({
          ai_score: score.overall_score,
          risk_level: score.risk_flags?.length > 0 ? "High" : "Low",
        }).eq("id", vendor.proposal_id).eq("contract_id", contractId) as any).then((r: any) => r)
      );
    }

    await Promise.allSettled(proposalUpdates);

    const analysesByProposalId: Record<string, unknown> = {};
    for (let index = 0; index < vendors.length; index++) {
      const vendor = vendors[index];
      const score = vendorScores[index];
      if (vendor?.proposal_id && score) {
        analysesByProposalId[vendor.proposal_id] = score;
      }
    }

    await saveProposalAnalysisResult(contractId, {
      cache_key: data?.cache_key || `${jobId}`,
      created_at: new Date().toISOString(),
      analyses_by_proposal_id: analysesByProposalId as any,
      judge_result: data?.judge ?? null,
      vendor_count: vendors.length,
    });

    await updateAnalysisJob(jobId, { status: "completed", progress: "Analysis complete", result: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateAnalysisJob(jobId, { status: "failed", progress: "Analysis failed", error: message });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const contractId = body.contract_id as string | undefined;
  const contract = body.contract;
  const vendors = Array.isArray(body.vendors) ? body.vendors : [];

  if (!contractId || !contract || vendors.length === 0) {
    return NextResponse.json({ error: "Missing contract_id, contract, or vendors" }, { status: 400 });
  }

  const inserted = await createAnalysisJob({ contract_id: contractId, request: { contract, vendors } });

  void processBackgroundAnalysis(inserted.id, req.nextUrl.origin, body);

  return NextResponse.json({ job_id: inserted.id, status: "queued" }, { status: 202 });
}
