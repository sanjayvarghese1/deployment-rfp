import type { FullPipelineResult } from "@/services/aiService";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "@/services/supabase";
import { createClient } from "@supabase/supabase-js";

export type AnalysisJobStatus = {
  id: string;
  contract_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: string | null;
  result: FullPipelineResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type AnalysisJobRecord = AnalysisJobStatus & {
  request: unknown;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function isMissingAnalysisJobsTable(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
  const message = typeof error === "object" && error !== null
    ? String((error as { message?: string }).message || (error as { details?: string }).details || "")
    : String(error);
  return (
    code === "PGRST205" ||
    message.includes("analysis_jobs") ||
    message.includes("schema cache") ||
    message.includes("Could not find the table") ||
    message.includes("relation \"public.analysis_jobs\" does not exist")
  );
}

function requireSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for analysis_jobs persistence"
    );
  }

  return supabaseAdmin;
}

export async function createAnalysisJob(input: {
  contract_id: string;
  request: unknown;
}): Promise<AnalysisJobRecord> {
  const now = new Date().toISOString();
  const job: AnalysisJobRecord = {
    id: uuidv4(),
    contract_id: input.contract_id,
    status: "queued",
    progress: "Queued for analysis",
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
    request: input.request,
  };

  const admin = requireSupabaseAdmin();
  const { error } = await admin.from("analysis_jobs").insert(job as any);
  if (error) {
    throw error;
  }

  return job;
}

export async function getAnalysisJob(jobId: string): Promise<AnalysisJobStatus | null> {
  const admin = requireSupabaseAdmin();
  const { data, error } = await admin
    .from("analysis_jobs")
    .select("id, contract_id, status, progress, result, error, created_at, updated_at")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) return null;

  return data as AnalysisJobStatus;
}

export async function updateAnalysisJob(jobId: string, patch: Partial<Omit<AnalysisJobRecord, "id" | "contract_id" | "created_at" | "request">>) {
  const admin = requireSupabaseAdmin();
  const { data, error } = await admin
    .from("analysis_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() } as any)
    .eq("id", jobId)
    .select("id, contract_id, status, progress, result, error, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AnalysisJobRecord) || null;
}
