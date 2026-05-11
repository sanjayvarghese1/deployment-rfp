import { NextRequest, NextResponse } from "next/server";
import { getAnalysisJob } from "@/services/analysisJobs";

export async function GET(_: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const job = await getAnalysisJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Analysis job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("analysis_jobs") || message.includes("schema cache") || message.includes("PGRST205")) {
      return NextResponse.json({ error: "Analysis job not available" }, { status: 404 });
    }

    throw error;
  }
}
