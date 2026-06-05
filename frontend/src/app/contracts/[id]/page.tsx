"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getCachedFullPipeline, saveProposalAnalysisResult, ProposalAnalysis, JudgeResult } from "@/services/aiService";
import { generateProposalPDF } from "@/services/pdfGenerator";
import VendorComparisonChart from "@/components/VendorComparisonChart";
import ProposalMetricsComparison from "@/components/ProposalMetricsComparison";
import ProposalPairwiseComparison from "@/components/ProposalPairwiseComparison";
import formatCurrency, { firstNonEmptyText, extractCurrencyLikeText, extractPriceLikeText, extractTimelineLikeText, parseNumber } from "@/lib/formatters/number";
import { randomUUID } from '@/lib/uuid';
import { startBackgroundAnalysisJob, getBackgroundAnalysisJob } from "@/services/aiService";
import { supabase } from "@/services/supabase";
import { apiUrl } from "@/lib/api";

function normalizeDoc(data: any): any {
  return data;
}

/** Short display value for budget/deadline cards */
function shortValue(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const s = raw.trim();
  if (s.length <= 22) return s;
  const dot = s.indexOf(".");
  if (dot > 0 && dot <= 30) return s.slice(0, dot + 1);
  return s.slice(0, 20) + "…";
}

function extractPdfBase64(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!value.startsWith("data:")) return value;
  const commaIndex = value.indexOf(",");
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : null;
}

function downloadPdfFromBase64(base64: string, filename: string) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function ContractDetailPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const contractId: string = String(params?.id || "");
  const { user, profile } = useAuth();
  const [contract, setContract] = useState<any>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Owner tabs
  const [ownerTab, setOwnerTab] = useState<"details" | "responses">("details");

  // AI analysis — 3-agent pipeline
  const [analyses, setAnalyses] = useState<Record<string, ProposalAnalysis>>({});
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string>("");
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [cachedAnalysisLoadedFor, setCachedAnalysisLoadedFor] = useState<string | null>(null);
  const [restoredFromContract, setRestoredFromContract] = useState(false);
  const [referrer, setReferrer] = useState("");
  const [backgroundJobId, setBackgroundJobId] = useState<string | null>(null);

  const savedAnalysis = contract?.last_analysis_result;
  const liveAnalysis = backgroundJobId || analyzing || judgeResult || Object.keys(analyses).length > 0 ? {
    analyses_by_proposal_id: analyses,
    judge_result: judgeResult,
    vendor_count: proposals.length,
    created_at: "",
    cache_key: "",
  } : null;

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      setReferrer(urlParams.get("from") || "");
    }
  }, []);

  useEffect(() => {
    const fetchContract = async () => {
      try {
        const { data, error } = await supabase.from("contracts").select("*").eq("id", contractId).single();
        if (error) throw error;
        if (data) setContract({ contract_id: data.id, ...normalizeDoc(data) });
      } catch (err) {
        console.error("Failed to fetch contract:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchContract();
  }, [contractId]);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("*")
        .eq("contract_id", contractId)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Contract proposals load failed:", error);
        setProposals([]);
        return;
      }

      setProposals((data || []).map((row) => ({ proposal_id: row.id, ...normalizeDoc(row) })));
    })();
  }, [contractId]);

  useEffect(() => {
    const loadCachedAnalysis = async () => {
      if (!contract || proposals.length === 0) return;

      const cacheKey = `${contractId}:${proposals.map((p) => p.proposal_id).join("|")}`;
      if (cachedAnalysisLoadedFor === cacheKey) return;

      const vendors = proposals.map((p: any) => ({
        vendor_name: p.vendor_name,
        price: p.price,
        timeline: p.timeline,
        experience: p.experience,
        proposal_data: p.proposal_data,
      }));

      const cached = await getCachedFullPipeline(
        {
          title: contract.title,
          description: contract.description,
          budget: contract.budget,
          deadline: contract.deadline,
          certifications: contract.required_certifications,
        },
        vendors
      );

      setCachedAnalysisLoadedFor(cacheKey);
      if (!cached) return;

      const restored: Record<string, ProposalAnalysis> = {};
      for (let i = 0; i < proposals.length; i++) {
        const proposal = proposals[i];
        const score = cached.vendor_scores[i];
        if (score) restored[proposal.proposal_id] = score;
      }

      setAnalyses(restored);
      setJudgeResult(cached.judge);
      setAnalysisProgress("Loaded saved analysis from Supabase.");
    };

    loadCachedAnalysis();
  }, [contract, proposals, contractId, cachedAnalysisLoadedFor]);

  useEffect(() => {
    if (!contract || proposals.length === 0 || restoredFromContract) return;

    const stored = contract.last_analysis_result;
    if (!stored?.analyses_by_proposal_id) return;

    const restoredAnalyses: Record<string, ProposalAnalysis> = {};
    for (const proposal of proposals) {
      const score = stored.analyses_by_proposal_id[proposal.proposal_id];
      if (score) restoredAnalyses[proposal.proposal_id] = score;
    }

    if (Object.keys(restoredAnalyses).length === 0) return;

    setAnalyses(restoredAnalyses);
    setJudgeResult(stored.judge_result ?? null);
    setAnalysisProgress("Loaded saved analysis from Supabase.");
    setRestoredFromContract(true);
  }, [contract, proposals, restoredFromContract]);

  useEffect(() => {
    if (!contractId) return;
    const storedJobId = window.localStorage.getItem(`analysis-job:${contractId}`);
    if (storedJobId) {
      setBackgroundJobId(storedJobId);
      setAnalysisProgress("Analysis is running in the background...");
    }
  }, [contractId]);

  useEffect(() => {
    if (!backgroundJobId || proposals.length === 0) return;

    let active = true;
    const poll = async () => {
      try {
        const job = await getBackgroundAnalysisJob(backgroundJobId);
        if (!active) return;

        if (!job) {
          setAnalysisProgress(savedAnalysis ? "Loaded saved analysis from Supabase." : "Analysis job not found.");
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${contractId}`);
          return;
        }

        setAnalysisProgress(job.progress || "Analysis running in background...");
        if (job.status === "completed" && job.result?.vendor_scores) {
          const newAnalyses: Record<string, ProposalAnalysis> = {};
          for (let i = 0; i < proposals.length; i++) {
            const proposal = proposals[i];
            const score = job.result.vendor_scores[i];
            if (proposal && score) {
              newAnalyses[proposal.proposal_id] = score;
            }
          }
          setAnalyses(newAnalyses);
          setJudgeResult(job.result.judge ?? null);
          const nextSavedAnalysis = {
            cache_key: `analysis:${contractId}:${Date.now()}`,
            created_at: new Date().toISOString(),
            analyses_by_proposal_id: newAnalyses,
            judge_result: job.result.judge ?? null,
            vendor_count: proposals.length,
            mandatory_criteria: contract?.rfp_metadata?.mandatory_criteria,
          };
          await saveProposalAnalysisResult(contractId, nextSavedAnalysis as any);
          setContract((current: any) => current ? { ...current, last_analysis_result: nextSavedAnalysis } : current);
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${contractId}`);
        } else if (job.status === "failed") {
          setAnalysisProgress(`Error: ${job.error || "Analysis failed"}`);
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${contractId}`);
        }
      } catch (error) {
        console.warn("Failed to poll analysis job:", error);
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [backgroundJobId, proposals, contractId, savedAnalysis]);

  const extractPdfText = async (pdfUrl: string, vendorName: string): Promise<string> => {
    try {
      console.log(`[Extract] Starting extraction for ${vendorName} from ${pdfUrl}`);
      
      // Set a 2-minute timeout for PDF extraction
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2 * 60 * 1000);

      try {
        const response = await fetch(apiUrl("/api/extract-pdf"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfUrl }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        console.log(`[Extract] Response status: ${response.status}`);

        if (!response.ok) {
          const error = await response.json();
          console.error(`[Extract] API error: ${error.error}`);
          throw new Error(error.error || "PDF extraction failed");
        }

        const data = await response.json();
        console.log(`[Extract] Success: ${data.text_length || data.extracted_text?.length || 0} chars extracted`);
        return data.extracted_text || `[PDF uploaded for ${vendorName}]`;
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
      }
    } catch (err) {
      console.error(`[Extract] Error for ${vendorName}:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setAnalysisProgress(`Error extracting PDF for ${vendorName}: ${errMsg}`);
      return `[PDF extraction failed: ${vendorName}]`;
    }
  };

  const runAIAnalysis = async () => {
    if (!contract || proposals.length === 0) return;
    setAnalyzing(true);
    setAnalysisProgress("Starting 3-agent pipeline (extracting PDFs if needed)...");
    try {
      setAnalysisProgress(`Preparing proposals (extracting PDFs if needed)...`);

      const vendorPromises = proposals.map(async (p: any) => {
        let proposalData = p.proposal_data;
        if (p.proposal_type === "uploaded_pdf" && (!proposalData || proposalData.trim() === "")) {
          setAnalysisProgress(`Extracting PDF for "${p.vendor_name}"...`);
          proposalData = await extractPdfText(p.proposal_file, p.vendor_name);
          const { error: updateErr } = await (supabase.from("proposals").update({ proposal_data: proposalData }).eq("id", p.proposal_id) as any);
          if (updateErr) {
            console.warn(`[Analysis] Failed to save extracted text for ${p.vendor_name}:`, updateErr);
          }
        }

        return {
          proposal_id: p.proposal_id,
          vendor_name: p.vendor_name,
          price: p.price,
          timeline: p.timeline,
          experience: p.experience,
          proposal_data: proposalData,
        };
      });

      const vendors = await Promise.all(vendorPromises);
      const job = await startBackgroundAnalysisJob({
        contract_id: contractId,
        contract: {
          title: contract.title,
          description: contract.description,
          budget: contract.budget,
          deadline: contract.deadline,
          certifications: contract.required_certifications,
          mandatoryCriteria: contract.rfp_metadata?.mandatory_criteria,
        },
        vendors,
      });

      window.localStorage.setItem(`analysis-job:${contractId}`, job.job_id);
      setBackgroundJobId(job.job_id);
      setAnalysisProgress("✅ Analysis is running in the background. Check back or refresh to see results.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Pipeline error:", msg);
      setAnalysisProgress(`❌ Error: ${msg}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const vendorScorePoints = proposals
    .map((proposal) => {
      const score = analyses[proposal.proposal_id]?.overall_score ?? proposal.ai_score ?? 0;
      return {
        label: proposal.vendor_name,
        value: score,
        color: score >= 70 ? "bg-[var(--success)]" : score >= 50 ? "bg-[var(--warning)]" : "bg-[var(--danger)]",
      };
    })
    .sort((a, b) => b.value - a.value);

  const acceptProposal = async (proposalId: string) => {
    if (!contract || !user || acceptingId) return;
    const confirmed = window.confirm("Accept this proposal? All other proposals will be rejected.");
    if (!confirmed) return;
    setAcceptingId(proposalId);
    try {
      const acceptedProposal = proposals.find((p: any) => p.proposal_id === proposalId);
      if (!acceptedProposal) throw new Error("Proposal not found");
      const ownerName = profile?.company_name || (user as any).user_metadata?.full_name || user.email || "Contract Owner";

      // 1. Mark accepted proposal
      {
        const { error } = await supabase.from("proposals").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", proposalId);
        if (error) throw error;
      }

      // 2. Reject all other proposals + send rejection messages/notifications
      const otherProposals = proposals.filter((p: any) => p.proposal_id !== proposalId);
      for (const p of otherProposals) {
        {
          const { error } = await supabase.from("proposals").update({ status: "rejected", rejected_at: new Date().toISOString() }).eq("id", p.proposal_id);
          if (error) throw error;
        }
        {
          const { error } = await supabase.from("messages").insert({
            id: randomUUID(),
            sender_id: user.id, receiver_id: p.vendor_id,
          text: `Thank you for your proposal for "${contract.title}". After careful review, we have decided to go with another vendor. We appreciate your effort and hope to collaborate in the future.`,
          timestamp: new Date().toISOString(),
          read: false,
          });
          if (error) throw error;
        }
        {
          const { error } = await supabase.from("notifications").insert({
            id: randomUUID(),
          user_id: p.vendor_id, type: "proposal_rejected",
          message: `Your proposal for "${contract.title}" was not selected.`,
          read: false, timestamp: new Date().toISOString(),
          });
          if (error) throw error;
        }
      }

      // 3. Close the contract
      {
        const { error } = await supabase.from("contracts").update({ status: "closed" }).eq("id", contractId);
        if (error) throw error;
      }

      // 4. Send acceptance message + notification to winner
      {
        const { error } = await supabase.from("messages").insert({
          id: randomUUID(),
        sender_id: user.id, receiver_id: acceptedProposal.vendor_id,
        text: `Congratulations! Your proposal for "${contract.title}" has been accepted by ${ownerName}. We look forward to working with you. Please reach out to discuss next steps.`,
        timestamp: new Date().toISOString(),
          read: false,
        });
        if (error) throw error;
      }
      {
        const { error } = await supabase.from("notifications").insert({
          id: randomUUID(),
        user_id: acceptedProposal.vendor_id, type: "proposal_accepted",
        message: `Your proposal for "${contract.title}" has been accepted!`,
        read: false, timestamp: new Date().toISOString(),
        });
        if (error) throw error;
      }

      // 5. Send email via API
      const { data: vendorData } = await supabase.from("users").select("email").eq("id", acceptedProposal.vendor_id).maybeSingle();
      const vendorEmail = vendorData?.email;
      let emailSent = false;
      if (vendorEmail) {
        try {
          const res = await fetch(apiUrl("/api/proposals/accept"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              vendorEmail, vendorName: acceptedProposal.vendor_name,
              contractTitle: contract.title, acceptedByName: ownerName,
              price: acceptedProposal.price, timeline: acceptedProposal.timeline,
            }),
          });
          const data = await res.json();
          emailSent = data.emailSent;
        } catch { /* email is best-effort */ }
      }

      alert(`Proposal by ${acceptedProposal.vendor_name} accepted! ${otherProposals.length} other proposal(s) rejected.${emailSent ? " Email sent." : ""}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Error: ${msg}`);
    }
    setAcceptingId(null);
  };

  if (loading) return <div className="flex justify-center py-20 text-[var(--muted)]"><div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>;
  if (!contract) return <div className="flex justify-center py-20 text-[var(--muted)]">Contract not found.</div>;

  const isOwner = user?.id === contract.posted_by;
  const sortedProposals = [...proposals].sort((a, b) => {
    const sA = analyses[a.proposal_id]?.overall_score ?? a.ai_score ?? 0;
    const sB = analyses[b.proposal_id]?.overall_score ?? b.ai_score ?? 0;
    return sB - sA;
  });

  const activeAnalysis = liveAnalysis ?? savedAnalysis;

  const contractTextSource = [
    contract.description,
    contract.rfp_sections?.budget_framework,
    contract.rfp_sections?.implementation_timeline,
    contract.rfp_metadata?.budgetIndicator,
    contract.rfp_metadata?.timelineIndicator,
  ].filter(Boolean).join("\n");

  const displayBudget = firstNonEmptyText(
    contract.budget,
    contract.budget_range,
    contract.budget_framework,
    contract.budgetIndicator,
    contract.rfp_metadata?.budgetIndicator,
    extractCurrencyLikeText(contractTextSource)
  ) || "TBD";

  if (!contractId) return null;
  const displayDeadline = firstNonEmptyText(
    contract.deadline,
    contract.timelineIndicator,
    contract.implementation_timeline,
    contract.rfp_metadata?.timelineIndicator,
    extractTimelineLikeText(contractTextSource)
  ) || "TBD";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back link */}
      <button
        onClick={() => {
          if (referrer === "insights") {
            router.push("/insights?tab=blank");
          } else {
            router.push("/contracts");
          }
        }}
        className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--primary)] mb-5 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        Back to {referrer === "insights" ? "My Contracts" : "Contracts"}
      </button>

      {/* Contract Header */}
      <div className="card mb-4">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">{contract.title}</h1>
            <p className="text-sm text-[var(--muted)] mt-1 flex items-center gap-1.5">
              Posted by {contract.posted_by_name}
              {contract.poster_verified && (
                <svg className="w-4 h-4 text-[var(--accent)]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
              )}
              <span className="mx-1">·</span>
              {contract.created_at}
            </p>
          </div>
          <span className={`shrink-0 ml-3 ${contract.status === "open" ? "badge-open" : "badge-closed"}`}>
            {contract.status}
          </span>
        </div>

        <p className="text-[var(--muted)] mb-5 leading-relaxed">{contract.description}</p>

        {/* Key details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "Budget", value: shortValue(displayBudget, "TBD"), title: displayBudget },
            { label: "Deadline", value: shortValue(displayDeadline, "TBD"), title: displayDeadline },
            { label: "Industry", value: contract.industry || "N/A" },
            { label: "Proposals", value: String(proposals.length) },
          ].map((item) => (
            <div key={item.label} className="bg-[var(--surface)] border border-[var(--divider)] rounded-xl p-4 min-h-[80px] flex flex-col">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--muted)] mb-2">{item.label}</p>
              <p className="text-sm font-semibold text-[var(--foreground)] leading-snug break-words" title={item.title || item.value}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Full budget & deadline text (expandable if truncated) */}
        {(displayBudget.length > 60 || displayDeadline.length > 60) && (
          <details className="mb-4 group">
            <summary className="text-xs text-[var(--primary)] cursor-pointer font-medium">View full budget &amp; timeline details</summary>
            <div className="mt-2 space-y-2 text-sm text-[var(--muted)] bg-[var(--surface)] rounded-lg p-4 border border-[var(--divider)]">
              {displayBudget.length > 60 && (
                <div><p className="text-xs font-semibold text-[var(--foreground)] mb-0.5">Budget</p><p className="leading-relaxed">{displayBudget}</p></div>
              )}
              {displayDeadline.length > 60 && (
                <div><p className="text-xs font-semibold text-[var(--foreground)] mb-0.5">Timeline</p><p className="leading-relaxed">{displayDeadline}</p></div>
              )}
            </div>
          </details>
        )}

        {/* Download RFP PDF */}
        {extractPdfBase64(contract.rfp_pdf_base64) && (
          <button
            onClick={() => downloadPdfFromBase64(extractPdfBase64(contract.rfp_pdf_base64) as string, `${contract.rfp_file_name || contract.title || "RFP"}.pdf`)}
            className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all shadow-sm mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Download RFP PDF
          </button>
        )}

        {contract.required_certifications && (
          <p className="text-xs text-[var(--muted)] mb-4">Required Certifications: <span className="font-medium text-[var(--foreground)]">{contract.required_certifications}</span></p>
        )}
        {contract.mission_objective && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-1">Mission Objective</h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">{contract.mission_objective}</p>
          </div>
        )}
      </div>

      {/* RFP Document Section */}
      {contract.rfp_document && (
        <div className="card mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[var(--primary-light)] rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">{contract.rfp_file_name ? `RFP: ${contract.rfp_file_name}` : "RFP Document"}</h2>
              <p className="text-xs text-[var(--muted)]">Uploaded by {contract.posted_by_name}</p>
            </div>
          </div>
          <div className="bg-[var(--surface)] rounded-xl p-5 text-sm text-[var(--muted)] whitespace-pre-wrap font-mono max-h-[500px] overflow-y-auto border border-[var(--divider)] leading-relaxed">
            {contract.rfp_document.startsWith("data:") ? (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-[var(--muted)] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                <p className="text-[var(--muted)] font-medium mb-2">Binary document attached</p>
                <a href={contract.rfp_document} download={contract.rfp_file_name || "rfp-document"} className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download Document
                </a>
              </div>
            ) : (
              contract.rfp_document
            )}
          </div>
        </div>
      )}

      {/* RFP Sections (generated via pipeline) */}
      {contract.rfp_sections && Object.keys(contract.rfp_sections).length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[var(--primary-light)] rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">RFP Sections</h2>
              <p className="text-xs text-[var(--muted)]">{Object.keys(contract.rfp_sections).length} sections generated</p>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(contract.rfp_sections).map(([key, content]: [string, any]) => {
              const label = contract.rfp_section_labels?.[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              return (
                <details key={key} className="group border border-[var(--divider)] rounded-lg overflow-hidden">
                  <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors flex items-center justify-between">
                    {label}
                    <svg className="w-4 h-4 text-[var(--muted)] group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-[var(--muted)] leading-relaxed whitespace-pre-wrap">{String(content)}</div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {/* Apply Button for vendors */}
      {user && !isOwner && contract.status === "open" && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--divider)] p-6 mb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Interested in this contract?</h2>
              <p className="text-sm text-[var(--muted)] mt-0.5">Submit your vendor proposal to compete for this project.</p>
            </div>
            <Link href={`/contracts/${contractId}/apply`} className="btn-primary shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Apply Now
            </Link>
          </div>
        </div>
      )}

      {/* Not signed in prompt */}
      {!user && contract.status === "open" && (
        <div className="card mb-4 text-center">
          <p className="text-sm text-[var(--muted)] mb-3">Sign in to submit a proposal for this contract.</p>
          <Link href="/login" className="btn-primary inline-flex">Sign In</Link>
        </div>
      )}

      {/* Non-owner proposal count */}
      {!isOwner && proposals.length > 0 && (
        <div className="card mb-4">
          <p className="text-sm text-[var(--muted)]"><span className="font-semibold text-[var(--foreground)]">{proposals.length}</span> proposal{proposals.length !== 1 ? "s" : ""} have been submitted for this contract.</p>
        </div>
      )}

      {/* Owner Section: Vendor Responses */}
      {isOwner && (
        <div className="card !p-0 overflow-hidden">
          <div className="flex border-b border-[var(--divider)]">
            <button onClick={() => setOwnerTab("details")} className={`tab-btn flex-1 justify-center ${ownerTab === "details" ? "active" : ""}`}>
              Contract Info
            </button>
            <button onClick={() => setOwnerTab("responses")} className={`tab-btn flex-1 justify-center ${ownerTab === "responses" ? "active" : ""}`}>
              Vendor Responses ({proposals.length})
            </button>
          </div>

          {ownerTab === "details" && (
            <div className="p-6">
              <p className="text-sm text-[var(--muted)]">This is your contract. Vendors can browse and apply from the marketplace. You can view all vendor responses in the &quot;Vendor Responses&quot; tab.</p>
            </div>
          )}

          {ownerTab === "responses" && (
            <div className="p-6">
              {proposals.length === 0 ? (
                <p className="text-sm text-[var(--muted)] text-center py-8">No proposals received yet.</p>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-[var(--muted)]">{proposals.length} proposal{proposals.length !== 1 ? "s" : ""} received</p>
                      {analysisProgress && <p className="text-xs text-[var(--primary)] mt-1">{analysisProgress}</p>}
                    </div>
                    <button onClick={runAIAnalysis} disabled={analyzing || backgroundJobId !== null} className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2 rounded-lg text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-all shadow-sm">
                      {analyzing || backgroundJobId !== null ? <><div className="w-3.5 h-3.5 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin" />Analyzing...</> : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Run AI Analysis</>}
                    </button>
                  </div>

                  {activeAnalysis?.analyses_by_proposal_id && (
                    <div className="rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-light)] p-5 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--primary)]">{liveAnalysis ? "Latest Analysis Report" : "Saved Analysis Report"}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {activeAnalysis.created_at ? `Saved ${activeAnalysis.created_at}` : "Latest analysis"} · {activeAnalysis.vendor_count || proposals.length} vendor(s)
                          </p>
                        </div>
                        <span className="text-xs font-medium text-[var(--primary)] bg-white/70 rounded-full px-3 py-1">
                          {activeAnalysis.cache_key ? "Stored in Supabase" : "Current run"}
                        </span>
                      </div>

                      {activeAnalysis.judge_result?.final_recommendation_view && (
                        <div className="rounded-lg bg-white/80 border border-[var(--divider)] p-4 space-y-2">
                          <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)]">Recommended Vendor</p>
                          <p className="text-base font-semibold text-[var(--foreground)]">{activeAnalysis.judge_result.final_recommendation_view.recommended_vendor}</p>
                          <p className="text-sm text-[var(--muted)]">{activeAnalysis.judge_result.final_recommendation_view.headline}</p>
                          <p className="text-sm text-[var(--muted)]">{activeAnalysis.judge_result.final_recommendation_view.summary}</p>
                        </div>
                      )}

                      <ProposalPairwiseComparison
                        proposals={sortedProposals}
                        analyses={analyses}
                      />

                      <VendorComparisonChart
                        title="Vendor score comparison"
                        subtitle="Higher bars mean stronger overall fit for the contract."
                        points={vendorScorePoints}
                      />

                      {activeAnalysis.judge_result?.comparative_analysis?.selection_summary && (
                        <div className="rounded-lg bg-white/70 border border-[var(--divider)] p-4">
                          <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">Comparison Summary</p>
                          <p className="text-sm text-[var(--muted)]">{activeAnalysis.judge_result.comparative_analysis.selection_summary}</p>
                        </div>
                      )}

                      <ProposalMetricsComparison
                        contract={contract}
                        proposals={sortedProposals}
                        analyses={analyses}
                        contractId={contractId}
                      />
                    </div>
                  )}

                  {/* ═══ Agent 3 — Judge Recommendation View ═══ */}
                  {judgeResult?.final_recommendation_view && (
                    <div className="bg-[var(--success-light)] border border-[var(--success)]/30 rounded-xl p-5 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <svg className="w-5 h-5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        <p className="text-sm font-bold text-[var(--success)]">AI Judge Recommendation</p>
                      </div>
                      <p className="text-lg font-semibold text-[var(--success)]">{judgeResult.final_recommendation_view.recommended_vendor}</p>
                      <p className="text-sm font-medium text-[var(--success)]">{judgeResult.final_recommendation_view.headline}</p>
                      <p className="text-sm text-[var(--success)]">{judgeResult.final_recommendation_view.summary}</p>

                      {judgeResult.final_recommendation_view.why_this_vendor_won?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-[var(--success)] mb-1">Why this vendor won:</p>
                          <ul className="text-xs text-[var(--success)] list-disc list-inside space-y-0.5">
                            {judgeResult.final_recommendation_view.why_this_vendor_won.map((r: string, i: number) => <li key={i}>{r}</li>)}
                          </ul>
                        </div>
                      )}

                      {judgeResult.final_recommendation_view.key_tradeoffs?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-[var(--warning)] mb-1">Key tradeoffs:</p>
                          <ul className="text-xs text-[var(--warning)] list-disc list-inside space-y-0.5">
                            {judgeResult.final_recommendation_view.key_tradeoffs.map((t: string, i: number) => <li key={i}>{t}</li>)}
                          </ul>
                        </div>
                      )}

                      {judgeResult.final_recommendation_view.other_vendors_snapshot?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[var(--success)]/30">
                          <p className="text-xs font-semibold text-[var(--muted)] mb-2">Other Vendors</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {judgeResult.final_recommendation_view.other_vendors_snapshot.map((v: any, i: number) => (
                              <div key={i} className="bg-[var(--surface)] rounded-lg p-2.5 border border-[var(--divider)]">
                                <div className="flex justify-between items-center mb-0.5">
                                  <p className="text-xs font-medium text-[var(--foreground)]">{v.vendor_name}</p>
                                  <span className={`text-xs font-bold ${v.score >= 70 ? "text-[var(--success)]" : v.score >= 50 ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}>{v.score}</span>
                                </div>
                                <p className={`text-xs font-medium ${v.label === "Strong Candidate" ? "text-[var(--primary)]" : v.label === "Qualified but Weaker Fit" ? "text-[var(--warning)]" : v.label === "High Risk" || v.label === "Not Recommended" ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{v.label}</p>
                                <p className="text-xs text-[var(--muted)] mt-0.5">{v.note}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ═══ Agent 3 — Comparative Ranking (collapsible) ═══ */}
                  {judgeResult?.comparative_analysis && (
                    <details className="group">
                      <summary className="text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] cursor-pointer font-medium flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                        View Comparative Ranking
                      </summary>
                      <div className="mt-3 space-y-2">
                        <p className="text-sm text-[var(--muted)]">{judgeResult.comparative_analysis.selection_summary}</p>
                        {judgeResult.comparative_analysis.ranking?.map((r: any, i: number) => (
                          <div key={i} className={`border rounded-lg p-3 ${i === 0 ? "border-[var(--success)] bg-[var(--success-light)]" : "border-[var(--divider)]"}`}>
                            <div className="flex justify-between items-center mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-[var(--muted)]">#{i + 1}</span>
                                <p className="text-sm font-semibold text-[var(--foreground)]">{r.vendor_name}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  r.comparative_recommendation === "Best Fit" ? "bg-[var(--success-light)] text-[var(--success)]" :
                                  r.comparative_recommendation === "Strong Candidate" ? "bg-[var(--primary-light)] text-[var(--primary)]" :
                                  r.comparative_recommendation === "Qualified but Weaker Fit" ? "bg-[var(--warning-light)] text-[var(--warning)]" :
                                  r.comparative_recommendation === "High Risk" ? "bg-[var(--danger-light)] text-[var(--danger)]" :
                                  "bg-[var(--surface)] text-[var(--muted)]"
                                }`}>{r.comparative_recommendation}</span>
                                <span className={`text-sm font-bold ${r.final_score >= 70 ? "text-[var(--success)]" : r.final_score >= 50 ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}>{r.final_score}</span>
                              </div>
                            </div>
                            <p className="text-xs text-[var(--muted)]">{r.why}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* ═══ Fallback: Simple best vendor when no Judge yet ═══ */}
                  {!judgeResult && sortedProposals.length > 0 && (analyses[sortedProposals[0].proposal_id]) && (
                    <div className="bg-[var(--success-light)] border border-[var(--success)]/30 rounded-xl p-5">
                      <p className="text-sm font-semibold text-[var(--success)] mb-1">Top Scored Vendor</p>
                      <p className="text-[var(--success)] font-medium">{sortedProposals[0].vendor_name}</p>
                      <p className="text-sm text-[var(--success)]">
                        Score: {analyses[sortedProposals[0].proposal_id]?.overall_score}/100 · {analyses[sortedProposals[0].proposal_id]?.independent_recommendation}
                      </p>
                    </div>
                  )}

                  {/* ═══ Individual Proposal Cards with Agent 2 Scores ═══ */}
                  {sortedProposals.map((p, idx) => {
                    const analysis = analyses[p.proposal_id];
                    const score = analysis?.overall_score ?? p.ai_score;
                    const risk = analysis?.risk_flags?.length ? "High" : p.risk_level || "Pending";
                    const isAccepted = p.status === "accepted";
                    const isRejected = p.status === "rejected";
                    const hasDecision = proposals.some((pr: any) => pr.status === "accepted" || pr.status === "rejected");
                    return (
                      <div key={p.proposal_id} className={`border rounded-xl p-5 ${
                        isAccepted ? "border-[var(--success)] bg-[var(--success-light)] ring-2 ring-[var(--success)]/30" :
                        isRejected ? "border-[var(--danger)]/40 bg-[var(--danger-light)] opacity-70" :
                        idx === 0 && score ? "border-[var(--divider)] ring-2 ring-[var(--success)]/30" :
                        "border-[var(--divider)]"
                      }`}>
                        {/* Status banner */}
                        {isAccepted && (
                          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[var(--success)]/30">
                            <svg className="w-5 h-5 text-[var(--success)]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                            <span className="text-sm font-semibold text-[var(--success)]">Accepted</span>
                          </div>
                        )}
                        {isRejected && (
                          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[var(--danger)]/30">
                            <svg className="w-5 h-5 text-[var(--danger)]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
                            <span className="text-sm font-semibold text-[var(--danger)]">Rejected</span>
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <Link href={`/companies/${p.vendor_id}?from=contracts`} className="font-semibold text-[var(--foreground)] hover:text-[var(--primary)] hover:underline transition-colors">
                              {p.vendor_name}
                            </Link>
                            <p className="text-xs text-[var(--muted)]">{p.proposal_type === "generated" ? "Generated proposal" : "Uploaded proposal"} · {p.created_at}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {analysis?.independent_recommendation && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                analysis.independent_recommendation === "Strongly Recommended" ? "bg-[var(--success-light)] text-[var(--success)]" :
                                analysis.independent_recommendation === "Recommended" ? "bg-[var(--primary-light)] text-[var(--primary)]" :
                                analysis.independent_recommendation === "Consider" ? "bg-[var(--warning-light)] text-[var(--warning)]" :
                                analysis.independent_recommendation === "Risky" ? "bg-[var(--danger-light)] text-[var(--danger)]" :
                                "bg-[var(--surface)] text-[var(--muted)]"
                              }`}>{analysis.independent_recommendation}</span>
                            )}
                            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${risk === "Low" ? "bg-[var(--success-light)] text-[var(--success)]" : risk === "High" ? "bg-[var(--danger-light)] text-[var(--danger)]" : "bg-[var(--surface)] text-[var(--muted)]"}`}>{risk}</span>
                            {score != null && (
                              <span className={`text-sm font-bold ${score >= 70 ? "text-[var(--success)]" : score >= 50 ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}>{score}/100</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-4 text-sm text-[var(--muted)] mb-2">
                          <span>Price: <span className="font-medium text-[var(--foreground)]">{(() => {
                            if (p.price) return p.price;
                            const extractedPrice = extractPriceLikeText(p.extracted_text ?? p.proposal_data);
                            const priceValue = parseNumber(extractedPrice);
                            return priceValue > 0 ? formatCurrency(priceValue) : "N/A";
                          })()}</span></span>
                        </div>
                        {p.experience && <p className="text-sm text-[var(--muted)] leading-relaxed mb-3">{p.experience}</p>}

                        {p.proposal_data && !(p.proposal_file && typeof p.proposal_file === "string" && p.proposal_file.startsWith("http")) && (
                          <div className="space-y-2">
                            <button
                              onClick={() => {
                                try {
                                  const data = JSON.parse(p.proposal_data);
                                  const pdfDoc = generateProposalPDF(data);
                                  pdfDoc.save(p.proposal_file_name || "proposal.pdf");
                                } catch (e) { console.error("PDF download failed:", e); alert("Failed to download PDF."); }
                              }}
                              className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              Download PDF
                            </button>
                          </div>
                        )}

                        {p.proposal_file && typeof p.proposal_file === "string" && p.proposal_file.startsWith("http") && (
                          <div>
                            <a
                              href={p.proposal_file}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              Download Proposal PDF
                            </a>
                          </div>
                        )}

                        {analysis && (
                          <details className="mt-3 pt-3 border-t border-[var(--divider)] group">
                            <summary className="cursor-pointer text-sm font-medium text-[var(--primary)] hover:text-[var(--primary-hover)]">
                              View detailed AI breakdown
                            </summary>
                            <div className="mt-3 space-y-3">
                              <p className="text-sm text-[var(--muted)]">{analysis.analysis_summary}</p>
                              <div className="overflow-hidden rounded-lg border border-[var(--divider)] text-xs">
                                <table className="w-full border-collapse">
                                  <thead className="bg-[var(--surface)] text-left text-[var(--muted)]">
                                    <tr>
                                      <th className="px-3 py-2 font-medium">Criterion</th>
                                      <th className="px-3 py-2 font-medium">Weight</th>
                                      <th className="px-3 py-2 font-medium">Score</th>
                                      <th className="px-3 py-2 font-medium">Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(Array.isArray(analysis.scoring_criteria) && analysis.scoring_criteria.length > 0
                                      ? analysis.scoring_criteria
                                      : [
                                          { id: "technical_fit", label: "Technical", max_score: 30, score: analysis.criterion_scores?.technical_fit?.score ?? 0, reason: analysis.criterion_scores?.technical_fit?.reason ?? "" },
                                          { id: "cost_efficiency", label: "Cost", max_score: 20, score: analysis.criterion_scores?.cost_efficiency?.score ?? 0, reason: analysis.criterion_scores?.cost_efficiency?.reason ?? "" },
                                          { id: "relevant_experience", label: "Experience", max_score: 20, score: analysis.criterion_scores?.relevant_experience?.score ?? 0, reason: analysis.criterion_scores?.relevant_experience?.reason ?? "" },
                                          { id: "timeline_fit", label: "Timeline", max_score: 15, score: analysis.criterion_scores?.timeline_fit?.score ?? 0, reason: analysis.criterion_scores?.timeline_fit?.reason ?? "" },
                                          { id: "compliance_completeness", label: "Compliance", max_score: 15, score: analysis.criterion_scores?.compliance_completeness?.score ?? 0, reason: analysis.criterion_scores?.compliance_completeness?.reason ?? "" },
                                        ]).map((row, index) => (
                                      <tr key={row.id || index} className={index % 2 === 0 ? "bg-white" : "bg-[var(--surface)]/40"}>
                                        <td className="px-3 py-2 align-top font-medium text-[var(--foreground)]">{row.label}</td>
                                        <td className="px-3 py-2 align-top text-[var(--muted)]">{row.max_score}/100</td>
                                        <td className="px-3 py-2 align-top text-[var(--foreground)]">{row.score}/{row.max_score}</td>
                                        <td className="px-3 py-2 align-top text-[var(--muted)]">{row.reason || "No reason provided"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {(analysis.strengths?.length > 0 || analysis.weaknesses?.length > 0) && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {analysis.strengths?.length > 0 && (
                                    <div className="rounded-lg bg-[var(--success-light)]/50 p-3">
                                      <p className="text-xs font-medium text-[var(--success)] mb-1">Strengths</p>
                                      <ul className="text-xs text-[var(--success)] list-disc list-inside space-y-0.5">{analysis.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                                    </div>
                                  )}
                                  {analysis.weaknesses?.length > 0 && (
                                    <div className="rounded-lg bg-[var(--warning-light)]/50 p-3">
                                      <p className="text-xs font-medium text-[var(--warning)] mb-1">Weaknesses</p>
                                      <ul className="text-xs text-[var(--warning)] list-disc list-inside space-y-0.5">{analysis.weaknesses.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
                                    </div>
                                  )}
                                </div>
                              )}

                              {analysis.risk_flags?.length > 0 && (
                                <div className="rounded-lg bg-[var(--danger-light)]/50 p-3">
                                  <p className="text-xs font-medium text-[var(--danger)] mb-1">Risk flags</p>
                                  <ul className="text-xs text-[var(--danger)] list-disc list-inside space-y-0.5">{analysis.risk_flags.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
                                </div>
                              )}
                            </div>
                          </details>
                        )}

                        {/* Accept button */}
                        {isOwner && !isAccepted && !isRejected && !hasDecision && (
                          <div className="mt-4 pt-3 border-t border-[var(--divider)] flex justify-end">
                            <button
                              onClick={() => acceptProposal(p.proposal_id)}
                              disabled={!!acceptingId}
                              className="inline-flex items-center gap-2 bg-[var(--success)] text-[#EFECE3] px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-all shadow-sm"
                            >
                              {acceptingId === p.proposal_id ? (
                                <><div className="w-3.5 h-3.5 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin" />Accepting...</>
                              ) : (
                                <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>Accept Proposal</>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
