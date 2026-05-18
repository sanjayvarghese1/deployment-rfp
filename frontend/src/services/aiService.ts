import { supabase } from "@/services/supabase";
import { apiUrl } from "@/lib/api";
import type { MandatoryCriteriaPayload } from "@/lib/rfp/config";

const AI_API_BASE_PATH = "/api/ai";
const AI_API_BASE = apiUrl(AI_API_BASE_PATH);

function buildAIEndpoint(path: string, apiBaseUrl?: string): string {
  if (apiBaseUrl) {
    return new URL(`${AI_API_BASE_PATH}${path}`, apiBaseUrl).toString();
  }

  return apiUrl(`${AI_API_BASE_PATH}${path}`);
}

export interface RFPInput {
  project_title: string;
  description: string;
  budget: string;
  deadline: string;
  industry: string;
  required_certifications: string;
  mission_objective: string;
}

export interface ProposalInput {
  contract_title: string;
  contract_description: string;
  contract_budget: string;
  contract_deadline?: string;
  contract_certifications?: string;
  vendor_name: string;
  vendor_price: string;
  vendor_timeline: string;
  vendor_experience: string;
  proposal_data?: string;
  mandatoryCriteria?: MandatoryCriteriaPayload;
}

export interface AnalysisScoringCriterion {
  id: string;
  label: string;
  max_score: number;
  score: number;
  reason: string;
  evidence?: string;
}

export async function generateRFP(input: RFPInput): Promise<string> {
  const res = await fetch(buildAIEndpoint("/generate-rfp"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to generate RFP");
  const data = await res.json();
  return data.rfp;
}

// ─── Agent 2 (Scorer) output types ──────────────────────────────

export interface CriterionScore {
  score: number;
  reason: string;
  max_score?: number;
  evidence?: string;
}

export interface ProposalAnalysis {
  vendor_name: string;
  overall_score: number;
  independent_recommendation: string;
  criterion_scores: Record<string, CriterionScore>;
  scoring_criteria?: AnalysisScoringCriterion[];
  mandatory_criteria?: MandatoryCriteriaPayload;
  strengths: string[];
  weaknesses: string[];
  risk_flags: string[];
  analysis_summary: string;
}

// ─── Agent 3 (Judge) output types ──────────────────────────────

export interface VendorRanking {
  vendor_name: string;
  final_score: number;
  comparative_recommendation: string;
  strengths: string[];
  weaknesses: string[];
  why: string;
}

export interface OtherVendorSnapshot {
  vendor_name: string;
  label: string;
  score: number;
  note: string;
}

export interface JudgeResult {
  comparative_analysis: {
    best_vendor: string;
    selection_summary: string;
    ranking: VendorRanking[];
  };
  final_recommendation_view: {
    recommended_vendor: string;
    headline: string;
    summary: string;
    why_this_vendor_won: string[];
    key_tradeoffs: string[];
    other_vendors_snapshot: OtherVendorSnapshot[];
  };
}

export interface FullPipelineResult {
  vendor_scores: ProposalAnalysis[];
  judge: JudgeResult | null;
  rfp_extract: string;
  vendor_extracts: Record<string, string>;
}

export interface CachedFullPipelineResult extends FullPipelineResult {
  from_cache: boolean;
  cache_key: string;
}

export interface AnalysisJobStatus {
  id: string;
  contract_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: string | null;
  result: FullPipelineResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedProposalAnalysisResult {
  cache_key: string;
  created_at: string;
  analyses_by_proposal_id: Record<string, ProposalAnalysis>;
  judge_result: JudgeResult | null;
  vendor_count: number;
  mandatory_criteria?: MandatoryCriteriaPayload;
  rfp_extract?: string;
  vendor_extracts?: Record<string, string>;
  vendor_scores?: ProposalAnalysis[];
}

type PipelineContract = { title: string; description: string; budget: string; deadline?: string; certifications?: string; mandatoryCriteria?: MandatoryCriteriaPayload };

const ANALYSIS_CACHE_VERSION = 5;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function buildPipelineCacheKey(contract: PipelineContract, vendors: VendorInput[]): string {
  const normalized = {
    version: ANALYSIS_CACHE_VERSION,
    contract: {
      title: contract.title || "",
      description: contract.description || "",
      budget: contract.budget || "",
      deadline: contract.deadline || "",
      certifications: contract.certifications || "",
      mandatoryCriteria: contract.mandatoryCriteria || null,
    },
    vendors: vendors.map((vendor) => ({
      vendor_name: vendor.vendor_name || "",
      price: vendor.price || "",
      timeline: vendor.timeline || "",
      experience: vendor.experience || "",
      proposal_data: vendor.proposal_data || "",
    })),
  };

  return hashString(stableStringify(normalized));
}

function hasMeaningfulAnalysis(result: Partial<FullPipelineResult> | undefined): boolean {
  if (!result?.vendor_scores || !Array.isArray(result.vendor_scores) || result.vendor_scores.length === 0) {
    return false;
  }

  return result.vendor_scores.some((vendor) => Number(vendor?.overall_score ?? 0) > 0);
}

// ─── score_single: Agent 1 + Agent 2 for one vendor ────────

export async function analyzeProposal(input: ProposalInput): Promise<{ analysis: ProposalAnalysis; rfp_extract: string; vendor_extract: string }> {
  const res = await fetch(`${AI_API_BASE}/analyze-proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "score_single", ...input }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error || "Failed to analyze proposal");
  }
  return await res.json();
}

// ─── judge: Agent 3 to compare all scored vendors ──────────

export async function judgeVendors(rfpExtract: string, vendorScores: ProposalAnalysis[], apiBaseUrl?: string): Promise<JudgeResult> {
  const res = await fetch(buildAIEndpoint("/analyze-proposal", apiBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "judge", rfp_extract: rfpExtract, vendor_scores: vendorScores }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error || "Failed to judge vendors");
  }
  const data = await res.json();
  return data.judge;
}

// ─── full_pipeline: Agent 1 + 2 + 3 for all vendors ───────

export interface VendorInput {
  proposal_id?: string;
  vendor_name: string;
  price: string;
  timeline: string;
  experience: string;
  proposal_data?: string;
}

export async function runFullPipeline(
  contract: PipelineContract,
  vendors: VendorInput[],
  apiBaseUrl?: string,
  options?: { fastMode?: boolean }
): Promise<FullPipelineResult> {
  // Set a 15-minute timeout for the full pipeline (matching the API's maxDuration)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const res = await fetch(buildAIEndpoint("/analyze-proposal", apiBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "full_pipeline",
        contract_title: contract.title,
        contract_description: contract.description,
        contract_budget: contract.budget,
        contract_deadline: contract.deadline,
        contract_certifications: contract.certifications,
        mandatoryCriteria: contract.mandatoryCriteria,
        vendors,
        fastMode: !!options?.fastMode,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error || `Failed to run full pipeline: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runCachedFullPipeline(
  contract: PipelineContract,
  vendors: VendorInput[],
  apiBaseUrl?: string,
  options?: { fastMode?: boolean }
): Promise<CachedFullPipelineResult> {
  const cacheKey = buildPipelineCacheKey(contract, vendors);

  try {
    const { data: cached, error: cacheReadError } = await supabase
      .from("analysis_reports")
      .select("result")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (cacheReadError) {
      throw cacheReadError;
    }

    const cachedResult = cached?.result as Partial<FullPipelineResult> | undefined;

    if (cachedResult?.vendor_scores && cachedResult.rfp_extract && cachedResult.vendor_extracts && hasMeaningfulAnalysis(cachedResult)) {
      return {
        vendor_scores: cachedResult.vendor_scores,
        judge: cachedResult.judge ?? null,
        rfp_extract: cachedResult.rfp_extract,
        vendor_extracts: cachedResult.vendor_extracts,
        from_cache: true,
        cache_key: cacheKey,
      };
    }

    if (cachedResult?.vendor_scores && cachedResult.rfp_extract && cachedResult.vendor_extracts) {
      console.warn("Ignoring cached analysis result with all-zero vendor scores; rerunning analysis.");
    }
  } catch (error) {
    console.warn("Failed to read analysis cache:", error);
  }

  const result = await runFullPipeline(contract, vendors, apiBaseUrl, options);

  try {
    // Use a service-role Supabase client when available to avoid RLS failures on server-side writes
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error: cacheWriteError } = await supabaseAdmin.from("analysis_reports").upsert({
          cache_key: cacheKey,
          contract,
          vendors,
          result,
          updated_at: new Date().toISOString(),
        });
        if (cacheWriteError) throw cacheWriteError;
      } catch (adminErr) {
        console.warn('Service-role Supabase write failed, falling back to anon client:', adminErr);
        const { error: cacheWriteError } = await supabase.from("analysis_reports").upsert({
          cache_key: cacheKey,
          contract,
          vendors,
          result,
          updated_at: new Date().toISOString(),
        });
        if (cacheWriteError) throw cacheWriteError;
      }
    } else {
      const { error: cacheWriteError } = await supabase.from("analysis_reports").upsert({
        cache_key: cacheKey,
        contract,
        vendors,
        result,
        updated_at: new Date().toISOString(),
      });
      if (cacheWriteError) throw cacheWriteError;
    }
  } catch (error) {
    console.warn("Failed to save analysis cache:", error);
  }

  return {
    ...result,
    from_cache: false,
    cache_key: cacheKey,
  };
}

export async function startBackgroundAnalysisJob(input: {
  contract_id: string;
  contract: PipelineContract;
  vendors: VendorInput[];
}): Promise<{ job_id: string }> {
  const res = await fetch(apiUrl("/api/ai/analyze-proposal/background"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error || "Failed to start background analysis");
  }

  return await res.json();
}

export async function getBackgroundAnalysisJob(jobId: string): Promise<AnalysisJobStatus | null> {
  try {
    const start = Date.now();
    const res = await fetch(apiUrl(`/api/ai/analysis-jobs/${jobId}`), {
      method: "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-cache" },
    });
    const elapsed = Date.now() - start;

    if (res.status === 404) {
      console.debug(`[AI] getBackgroundAnalysisJob ${jobId} -> 404 (${elapsed}ms)`);
      return null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "<no-body>");
      console.error(`[AI] getBackgroundAnalysisJob ${jobId} -> ${res.status} ${res.statusText} (${elapsed}ms). Response:`, text);
      return null;
    }

    const data = await res.json().catch((err) => {
      console.error(`[AI] Failed to parse JSON for analysis job ${jobId}:`, err);
      return null;
    });

    if (!data) return null;
    return data.job as AnalysisJobStatus;
  } catch (err) {
    console.error(`[AI] Network error polling analysis job ${jobId}:`, err);
    return null;
  }
}

export async function getCachedFullPipeline(contract: PipelineContract, vendors: VendorInput[]): Promise<CachedFullPipelineResult | null> {
  const cacheKey = buildPipelineCacheKey(contract, vendors);

  try {
    const { data, error } = await supabase
      .from("analysis_reports")
      .select("result")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error) throw error;

    const cachedResult = data?.result as Partial<FullPipelineResult> | undefined;
    if (!cachedResult?.vendor_scores || !cachedResult.rfp_extract || !cachedResult.vendor_extracts) return null;

    return {
      vendor_scores: cachedResult.vendor_scores,
      judge: cachedResult.judge ?? null,
      rfp_extract: cachedResult.rfp_extract,
      vendor_extracts: cachedResult.vendor_extracts,
      from_cache: true,
      cache_key: cacheKey,
    };
  } catch (error) {
    console.warn("Failed to read analysis cache:", error);
    return null;
  }
}

export async function saveProposalAnalysisResult(contractId: string, result: SavedProposalAnalysisResult): Promise<void> {
  const payload = {
    last_analysis_result: {
      ...result,
      created_at: result.created_at || new Date().toISOString(),
    },
  };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin.from("contracts").update(payload).eq("id", contractId);
      if (!error) return;
      console.warn("Service-role saveProposalAnalysisResult failed, falling back to anon client:", error);
    } catch (serviceError) {
      console.warn("Service-role saveProposalAnalysisResult unavailable, falling back to anon client:", serviceError);
    }
  }

  const { error } = await supabase.from("contracts").update(payload).eq("id", contractId);
  if (error) throw error;
}

// ─── Multi-Agentic Proposal Generator ────────────────────────────

export interface RFPAnalysis {
  summary: string;
  key_requirements: string[];
  technical_requirements: string[];
  deliverables: string[];
  evaluation_criteria: string[];
  required_certifications: string[];
  budget_range: string;
  timeline_expectations: string;
  submission_requirements: string[];
  questions_for_vendor: string[];
}

export interface ParseRFPInput {
  rfp_text?: string;
  contract_title?: string;
  contract_description?: string;
  contract_budget?: string;
  contract_deadline?: string;
  contract_industry?: string;
}

export async function parseRFP(input: ParseRFPInput): Promise<RFPAnalysis> {
  const res = await fetch(`${AI_API_BASE}/parse-rfp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to parse RFP");
  const data = await res.json();
  return data.rfp_analysis;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProposalChatResponse {
  reply: string;
  proposal_ready: boolean;
  section_index: number;
}

export async function proposalChat(
  messages: ChatMessage[],
  rfpContext: string,
  sectionIndex: number
): Promise<ProposalChatResponse> {
  const res = await fetch(`${AI_API_BASE}/proposal-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      rfp_context: rfpContext,
      section_index: sectionIndex,
    }),
  });
  if (!res.ok) throw new Error("Failed to get chat response");
  const data = await res.json();
  return data;
}

export interface ProposalSections {
  vendor_information: string;
  company_profile: string;
  project_understanding: string;
  proposed_solution: string;
  deliverables: string;
  project_timeline: string;
  cost_proposal: string;
  team_details: string;
  past_experience: string;
  risk_management: string;
  support_maintenance: string;
  graphs_visualizations: string;
  terms_conditions: string;
  document_uploads: string;
  final_declaration: string;
}

export interface GeneratedProposal {
  sections: ProposalSections;
  proposal_title: string;
  total_price: string;
  timeline_summary: string;
}

export async function generateFullProposal(
  chatHistory: ChatMessage[],
  rfpContext: string,
  vendorName: string,
  contractTitle: string
): Promise<GeneratedProposal> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_800_000); // 30 min — extraction + generation + auto-expand
  try {
    const res = await fetch(`${AI_API_BASE}/generate-proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_history: chatHistory,
        rfp_context: rfpContext,
        vendor_name: vendorName,
        contract_title: contractTitle,
        mode: "full",
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("Failed to generate proposal");
    const data = await res.json();
    return data.proposal;
  } finally {
    clearTimeout(timer);
  }
}

export interface ParsedUploadedProposal {
  sections: ProposalSections;
  extracted_price: string;
  extracted_timeline: string;
}

export async function parseUploadedProposal(proposalText: string): Promise<ParsedUploadedProposal> {
  const res = await fetch(`${AI_API_BASE}/generate-proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "parse_upload", existing_proposal: proposalText }),
  });
  if (!res.ok) throw new Error("Failed to parse proposal");
  const data = await res.json();
  return data.parsed_proposal;
}

export async function editProposalSection(
  sectionName: string,
  currentContent: string,
  editInstructions: string,
  rfpContext: string
): Promise<string> {
  const res = await fetch(`${AI_API_BASE}/generate-proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "edit_section",
      section_to_edit: sectionName,
      existing_proposal: currentContent,
      edit_instructions: editInstructions,
      rfp_context: rfpContext,
    }),
  });
  if (!res.ok) throw new Error("Failed to edit section");
  const data = await res.json();
  return data.edited_section;
}

// ─── Section Expansion for 20-40 Page Proposals ─────────────────

export async function expandSection(
  sectionKey: keyof ProposalSections,
  sectionContent: string,
  rfpContext: string,
  allSections?: ProposalSections
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600_000); // 10 min per section expansion
  try {
    const res = await fetch(`${AI_API_BASE}/generate-proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "expand_section",
        section_key: sectionKey,
        section_content: sectionContent,
        rfp_context: rfpContext,
        all_sections: allSections,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Failed to expand section: ${sectionKey}`);
    const data = await res.json();
    return data.expanded_section;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateExecutiveSummary(
  sections: ProposalSections,
  rfpContext: string,
  vendorName: string,
  contractTitle: string
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000); // 5 min
  try {
    const res = await fetch(`${AI_API_BASE}/generate-proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "executive_summary",
        all_sections: sections,
        rfp_context: rfpContext,
        vendor_name: vendorName,
        contract_title: contractTitle,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("Failed to generate executive summary");
    const data = await res.json();
    return data.executive_summary;
  } finally {
    clearTimeout(timer);
  }
}

export interface ExpandProgress {
  current: number;
  total: number;
  sectionKey: string;
  sectionLabel: string;
  phase: "expanding" | "summary" | "charts" | "done";
}

const SECTION_LABEL_MAP: Record<keyof ProposalSections, string> = {
  vendor_information: "Vendor Information",
  company_profile: "Company Profile",
  project_understanding: "Project Understanding",
  proposed_solution: "Proposed Solution",
  deliverables: "Deliverables",
  project_timeline: "Project Timeline",
  cost_proposal: "Cost Proposal",
  team_details: "Team Details",
  past_experience: "Past Experience",
  risk_management: "Risk Management",
  support_maintenance: "Support & Maintenance",
  graphs_visualizations: "Graphs / Visualizations",
  terms_conditions: "Terms & Conditions",
  document_uploads: "Document Uploads",
  final_declaration: "Final Declaration",
};

export async function expandAllSections(
  sections: ProposalSections,
  rfpContext: string,
  vendorName: string,
  contractTitle: string,
  onProgress?: (p: ExpandProgress) => void
): Promise<{ sections: ProposalSections; executiveSummary: string }> {
  const keys = Object.keys(sections) as (keyof ProposalSections)[];
  const filledKeys = keys.filter(k => sections[k]?.trim());
  const total = filledKeys.length + 1; // +1 for executive summary
  const expanded = { ...sections };

  // ─── Parallel batch expansion: 3 sections at a time via batch_expand API ───
  const BATCH_SIZE = 3;
  let completedCount = 0;

  for (let batchStart = 0; batchStart < filledKeys.length; batchStart += BATCH_SIZE) {
    const batchKeys = filledKeys.slice(batchStart, batchStart + BATCH_SIZE);

    // Report progress for the batch
    for (const key of batchKeys) {
      completedCount++;
      onProgress?.({
        current: completedCount,
        total,
        sectionKey: key,
        sectionLabel: SECTION_LABEL_MAP[key],
        phase: "expanding",
      });
    }

    // Call batch_expand API — server expands all sections in this batch in parallel
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600_000); // 10 min per batch
    try {
      const res = await fetch(`${AI_API_BASE}/generate-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "batch_expand",
          section_keys: batchKeys,
          all_sections: sections, // pass original sections for cross-referencing
          rfp_context: rfpContext,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const expandedMap = data.expanded_sections as Record<string, string>;
        for (const key of batchKeys) {
          if (expandedMap[key]) expanded[key as keyof ProposalSections] = expandedMap[key];
        }
      }
    } catch {
      // Keep original content on failure — individual sections may still succeed
    } finally {
      clearTimeout(timer);
    }
  }

  // Generate executive summary (uses fully expanded sections for best quality)
  onProgress?.({ current: total, total, sectionKey: "executive_summary", sectionLabel: "Executive Summary", phase: "summary" });
  let executiveSummary = "";
  try {
    executiveSummary = await generateExecutiveSummary(expanded, rfpContext, vendorName, contractTitle);
  } catch {
    executiveSummary = "";
  }

  onProgress?.({ current: total, total, sectionKey: "", sectionLabel: "", phase: "done" });
  return { sections: expanded, executiveSummary };
}

// ─── Multi-Agent Refine & Data Visualization ────────────────────

export interface CostBreakdownItem {
  label: string;
  value: number;
  color: string;
}

export interface TimelinePhase {
  label: string;
  start_week: number;
  duration_weeks: number;
  color: string;
}

export interface TeamMember {
  name: string;
  role: string;
  experience_years: number;
}

export interface RiskItem {
  risk: string;
  probability: "High" | "Medium" | "Low";
  impact: "High" | "Medium" | "Low";
}

export interface DeliverableItem {
  name: string;
  weight: number;
}

export interface ChartData {
  cost_breakdown: CostBreakdownItem[];
  timeline_phases: TimelinePhase[];
  team_structure: TeamMember[];
  risk_matrix: RiskItem[];
  deliverables_progress: DeliverableItem[];
  budget_total: number;
  timeline_total_weeks: number;
}

export interface SectionScore {
  score: number;
  feedback: string;
  priority: "high" | "medium" | "low";
}

export interface ProposalCritique {
  overall_score: number;
  overall_grade: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  section_scores: Record<keyof ProposalSections, SectionScore>;
  top_improvements: { section: string; action: string }[];
}

export interface RefinedResult {
  improved_sections: Partial<ProposalSections>;
  changes_summary: string;
}

export async function extractChartData(sections: ProposalSections): Promise<ChartData> {
  const res = await fetch(`${AI_API_BASE}/refine-proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections, mode: "extract_data" }),
  });
  if (!res.ok) throw new Error("Failed to extract chart data");
  const data = await res.json();
  return data.chart_data;
}

export async function critiqueProposal(
  sections: ProposalSections,
  rfpContext: string
): Promise<ProposalCritique> {
  const res = await fetch(`${AI_API_BASE}/refine-proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections, rfp_context: rfpContext, mode: "critique" }),
  });
  if (!res.ok) throw new Error("Failed to critique proposal");
  const data = await res.json();
  return data.critique;
}

export async function refineProposal(
  sections: ProposalSections,
  critique: ProposalCritique,
  rfpContext: string
): Promise<RefinedResult> {
  const res = await fetch(`${AI_API_BASE}/refine-proposal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections, critique, rfp_context: rfpContext, mode: "refine_all" }),
  });
  if (!res.ok) throw new Error("Failed to refine proposal");
  const data = await res.json();
  return data.refined;
}
