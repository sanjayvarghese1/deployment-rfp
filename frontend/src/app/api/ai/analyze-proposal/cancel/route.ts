import { NextRequest, NextResponse } from "next/server";
import { cancelAnalysisJob } from "../analysisCancellation";
import { updateAnalysisJob } from "@/services/analysisJobs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const jobId = String(body.job_id || body.jobId || "").trim();

  if (!jobId) {
    return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  }

  // Abort the in-memory AbortController (stops ongoing LLM fetch immediately)
  cancelAnalysisJob(jobId);

  // Also mark the DB job as cancelled so polling stops and background worker exits cleanly
  try {
    await updateAnalysisJob(jobId, { status: "cancelled", progress: "Cancelled by user" });
  } catch (err) {
    console.warn(`[Cancel] Failed to update job status in DB for jobId=${jobId}:`, err);
  }

  return NextResponse.json({ status: "cancelled" });
}
