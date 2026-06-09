"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { saveProposalAnalysisResult, ProposalAnalysis, JudgeResult, startBackgroundAnalysisJob, getBackgroundAnalysisJob } from "@/services/aiService";
import { generateProposalPDF } from "@/services/pdfGenerator";
import ProposalPairwiseComparison from "@/components/ProposalPairwiseComparison";
import VendorComparisonChart from "@/components/VendorComparisonChart";
import ProposalMetricsComparison from "@/components/ProposalMetricsComparison";
import { supabase } from "@/services/supabase";
import formatCurrency, { extractCurrencyLikeText, extractPriceLikeText, extractTimelineLikeText, parseNumber, formatPriceDisplay, formatCurrencyWithOriginal } from "@/lib/formatters/number";
import { randomUUID } from '@/lib/uuid';
import { apiUrl, getBackendBaseUrl } from "@/lib/api";
import { downloadPdfReport } from "@/services/pdfReports";

const isSafeShortText = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 80) return false;
  return !/confidentiality notice|table of contents|executive summary|appendix|proposal/i.test(text);
};



function normalizeDoc(data: any): any {
  return data;
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "_")
    .slice(0, 120) || "vendor-analysis-report";
}

interface Contract {
  contract_id: string;
  title: string;
  description?: string;
  budget?: string;
  deadline?: string;
  required_certifications?: string;
  [key: string]: any;
}

interface Proposal {
  proposal_id: string;
  contract_id: string;
  vendor_id: string;
  vendor_name: string;
  price?: string;
  timeline?: string;
  experience?: string;
  proposal_type?: string;
  proposal_data?: string;
  proposal_file?: string;
  proposal_file_name?: string;
  extracted_text?: string;
  ai_score?: number;
  status?: string;
  created_at?: string;
  [key: string]: any;
}

export default function VendorResponsesTab() {
  const { user, profile } = useAuth();
  const [myContracts, setMyContracts] = useState<Contract[]>([]);
  const [allProposals, setAllProposals] = useState<Proposal[]>([]);
  const [selectedContract, setSelectedContract] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, ProposalAnalysis>>({});
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string>("");
  const [loadingResponses, setLoadingResponses] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [restoredAnalysisFor, setRestoredAnalysisFor] = useState<string | null>(null);
  const [backgroundJobId, setBackgroundJobId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const cancelAnalysisNow = async (jobId?: string | null) => {
    const trimmedJobId = String(jobId || "").trim();
    if (!trimmedJobId) return;

    const cancelPayload = JSON.stringify({ job_id: trimmedJobId });
    const requests = [
      fetch(apiUrl("/api/ai/analyze-proposal/cancel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cancelPayload,
      }),
      fetch(`${getBackendBaseUrl().replace(/\/$/, "")}/api/ai/analysis-jobs/${trimmedJobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cancelPayload,
      }),
    ];

    await Promise.allSettled(requests);
  };

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error } = await supabase.from("contracts").select("*").eq("posted_by", user.id);
      if (error) {
        console.warn("Insights contracts load failed:", error);
        setMyContracts([]);
        setLoadingResponses(false);
        return;
      }
      setMyContracts((data || []).map((row) => ({ contract_id: row.id, ...normalizeDoc(row) })));
      setLoadingResponses(false);
    })();
  }, [user]);

  useEffect(() => {
    if (myContracts.length > 0 && !selectedContract) {
      setSelectedContract(myContracts[0].contract_id);
    }
  }, [myContracts, selectedContract]);

  useEffect(() => {
    setAnalyses({});
    setJudgeResult(null);
    setAnalysisProgress("");
    setRestoredAnalysisFor(null);
  }, [selectedContract]);

  const selectedContractData = myContracts.find((c) => c.contract_id === selectedContract);
  const savedAnalysis = selectedContractData?.last_analysis_result;
  const activeAnalysis = backgroundJobId || analyzing || judgeResult || Object.keys(analyses).length > 0 ? {
    analyses_by_proposal_id: analyses,
    judge_result: judgeResult,
    vendor_count: allProposals.length,
    created_at: "",
    cache_key: "",
  } : savedAnalysis;

  useEffect(() => {
    if (backgroundJobId || analyzing) {
      setRestoredAnalysisFor(null);
    }
  }, [backgroundJobId, analyzing]);

  useEffect(() => {
    if (!selectedContract || !selectedContractData || allProposals.length === 0) return;

    const stored = selectedContractData.last_analysis_result;
    if (!stored?.analyses_by_proposal_id) return;

    const cacheKey = `${selectedContract}:${allProposals.map((p) => p.proposal_id).join("|")}`;
    if (restoredAnalysisFor === cacheKey) return;

    const restoredAnalyses: Record<string, ProposalAnalysis> = {};
    for (const proposal of allProposals) {
      const score = stored.analyses_by_proposal_id[proposal.proposal_id];
      if (score) restoredAnalyses[proposal.proposal_id] = score;
    }

    if (Object.keys(restoredAnalyses).length === 0) return;

    setAnalyses(restoredAnalyses);
    setJudgeResult(stored.judge_result ?? null);
    setAnalysisProgress("Loaded saved analysis from Supabase.");
    setRestoredAnalysisFor(cacheKey);
  }, [selectedContract, selectedContractData, allProposals, restoredAnalysisFor]);

  useEffect(() => {
    if (!selectedContract) return;
    const storedJobId = window.localStorage.getItem(`analysis-job:${selectedContract}`);
    if (storedJobId) {
      setBackgroundJobId(storedJobId);
      setAnalysisProgress("Analysis is running in the background...");
    }
  }, [selectedContract]);

  useEffect(() => {
    if (!selectedContract || !selectedContractData || allProposals.length === 0) return;
    if (selectedContractData.last_analysis_result?.analyses_by_proposal_id) return;
    if (backgroundJobId || analyzing) return;

    const autoKey = `analysis-auto-started:${selectedContract}`;
    if (window.localStorage.getItem(autoKey) === "1") return;

    window.localStorage.setItem(autoKey, "1");
    void runAIAnalysis();
  }, [selectedContract, selectedContractData, allProposals, backgroundJobId, analyzing]);

  useEffect(() => {
    if (!backgroundJobId || !selectedContract) return;

    let active = true;
    const startTime = Date.now();
    const poll = async () => {
      try {
        // Safe timeout: Vercel Free tier has a 10s execution timeout. Persistent analyses take ~3 mins.
        // If polling takes more than 8 minutes, the serverless worker has definitely crashed or timed out.
        if (Date.now() - startTime > 8 * 60 * 1000) {
          setAnalysisProgress("❌ Error: The analysis timed out. This occurs because the Vercel Free (Hobby) tier enforces a strict 10-second limit on serverless functions, terminating the background agent pipeline midway. Please deploy the frontend to Render or upgrade to Vercel Pro to run long analyses.");
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${selectedContract}`);
          return;
        }

        const job = await getBackgroundAnalysisJob(backgroundJobId);
        if (!active) return;

        if (!job) {
          setAnalysisProgress(selectedContractData?.last_analysis_result ? "Loaded saved analysis from Supabase." : "Analysis job not found.");
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${selectedContract}`);
          return;
        }

        setAnalysisProgress(job.progress || "Analysis running in background...");
        if (job.status === "completed" && job.result?.vendor_scores) {
          let proposals = allProposals;
          if (proposals.length === 0) {
            const { data: propData, error: propError } = await supabase.from("proposals").select("*").eq("contract_id", selectedContract);
            if (propError) {
              console.warn("Failed to load proposals on completion:", propError);
            } else if (propData) {
              proposals = propData.map((row) => ({ proposal_id: row.id, ...normalizeDoc(row) }));
              setAllProposals(proposals);
            }
          }

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

          // Save the result to Supabase from the client as a fallback/safeguard
          const analysisPayload = {
            cache_key: job.result.cache_key || `${backgroundJobId}`,
            created_at: new Date().toISOString(),
            analyses_by_proposal_id: newAnalyses,
            judge_result: job.result.judge ?? null,
            vendor_count: proposals.length,
            mandatory_criteria: selectedContractData?.rfp_metadata?.mandatory_criteria,
            rfp_extract: job.result.rfp_extract || "",
            vendor_extracts: job.result.vendor_extracts || {},
            vendor_scores: job.result.vendor_scores || [],
          };

          try {
            await saveProposalAnalysisResult(selectedContract, analysisPayload);
            console.log("Analysis results successfully saved to database from client.");
          } catch (saveError) {
            console.warn("Failed to save analysis result from client:", saveError);
          }

          void (async () => {
            const { data } = await supabase.from("contracts").select("*").eq("id", selectedContract).maybeSingle();
            if (data) {
              setMyContracts((current) => current.map((contract) => contract.contract_id === selectedContract ? { contract_id: data.id, ...normalizeDoc(data) } : contract));
            }
          })();
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${selectedContract}`);
        } else if (job.status === "failed") {
          setAnalysisProgress(`Error: ${job.error || "Analysis failed"}`);
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${selectedContract}`);
        } else if (job.status === "cancelled") {
          setAnalysisProgress("Analysis stopped.");
          setAnalyzing(false);
          setBackgroundJobId(null);
          window.localStorage.removeItem(`analysis-job:${selectedContract}`);
        }
      } catch (error) {
        console.error("Failed to poll analysis job:", error);
        try {
          const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          setAnalysisProgress(`❌ Polling error: ${errMsg}`);
        } catch {}
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
  }, [backgroundJobId, selectedContract, allProposals, selectedContractData]);

  useEffect(() => {
    if (!selectedContract) { setAllProposals([]); return; }
    void (async () => {
      const { data, error } = await supabase.from("proposals").select("*").eq("contract_id", selectedContract);
      if (error) {
        console.warn("Insights proposals load failed:", error);
        setAllProposals([]);
        return;
      }
      setAllProposals((data || []).map((row) => ({ proposal_id: row.id, ...normalizeDoc(row) })));
    })();
  }, [selectedContract]);

  const extractPdfText = async (pdfUrl: string, vendorName: string): Promise<string> => {
    try {
      console.log(`[Extract] Starting extraction for ${vendorName} from ${pdfUrl}`);
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
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "PDF extraction failed");
        }
        const data = await response.json();
        return data.extracted_text || `[PDF uploaded for ${vendorName}]`;
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
      }
    } catch (err) {
      console.error(`[Extract] Error for ${vendorName}:`, err);
      return `[PDF extraction failed: ${vendorName}]`;
    }
  };

  const downloadAnalysisReport = (proposal: Proposal) => {
    const analysis = analyses[proposal.proposal_id];
    if (!analysis) {
      alert("Run AI Analysis first, then try downloading the report.");
      return;
    }
    void downloadPdfReport({
      kind: "proposal-analysis",
      data: {
        proposal,
        analysis,
        contract: selectedContractData,
        judge_result: savedAnalysis?.judge_result ?? null,
      },
    }, sanitizeFileName(`${proposal.vendor_name || "vendor"}-analysis-report.pdf`)).catch((error) => {
      console.error("PDF export failed:", error);
      alert("Failed to generate PDF report.");
    });
  };

  const downloadComparisonSheet = () => {
    const rows = [...allProposals]
      .map((proposal) => {
          const analysis = analyses[proposal.proposal_id];
          const extractedPrice = extractPriceLikeText(proposal.extracted_text ?? proposal.proposal_data);
          const priceText = analysis?.price ? analysis.price : isSafeShortText(extractedPrice) ? extractedPrice : isSafeShortText(proposal.price) ? proposal.price : "";
          const priceFormatted = formatPriceDisplay(priceText) === "N/A" ? "Not provided" : formatPriceDisplay(priceText);
          
          return {
            vendor_name: proposal.vendor_name,
            final_score: analysis?.overall_score ?? proposal.ai_score ?? 0,
            comparative_recommendation: analysis?.independent_recommendation || proposal.status || "Not provided",
            independent_recommendation: analysis?.independent_recommendation || "",
            price: priceFormatted,
            timeline: analysis?.timeline || proposal.timeline || "Not provided",
            strengths: analysis?.strengths || [],
            weaknesses: analysis?.weaknesses || [],
            risk_flags: analysis?.risk_flags || [],
          };
      })
      .sort((left, right) => Number(right.final_score) - Number(left.final_score));

    const activeJudge = judgeResult || savedAnalysis?.judge_result || null;

    void downloadPdfReport({
      kind: "comparison-sheet",
      data: {
        contractTitle: selectedContractData?.title || "Consolidated Vendor Comparison",
        contractBudget: selectedContractData?.budget || selectedContractData?.budget_range || "Not provided",
        contractDeadline: selectedContractData?.deadline || "Not provided",
        bestVendor: activeJudge?.comparative_analysis?.best_vendor || "N/A",
        summary: activeJudge?.comparative_analysis?.selection_summary || "",
        rows,
        decisionNotes: activeJudge?.final_recommendation_view?.summary || "",
        judgeResult: activeJudge,
      },
    }, sanitizeFileName(`${selectedContractData?.title || "contract"}-comparison-sheet.pdf`)).catch((error) => {
      console.error("Comparison sheet export failed:", error);
      alert("Failed to generate comparison sheet.");
    });
  };


  const runAIAnalysis = async () => {
    const contract = myContracts.find((c) => c.contract_id === selectedContract);
    if (!contract || allProposals.length === 0) return;
    setAnalyzing(true);
    setAnalysisProgress("Starting 3-agent pipeline (extracting PDFs if needed)...");
    try {
      setAnalysisProgress(`Preparing proposals (extracting PDFs if needed)...`);
      const vendorPromises = allProposals.map(async (p: Proposal) => {
        let proposalData = p.proposal_data;
        if (p.proposal_type === "uploaded_pdf" && (!proposalData || proposalData.trim() === "")) {
          setAnalysisProgress(`Extracting PDF for "${p.vendor_name}"...`);
          proposalData = await extractPdfText(p.proposal_file || "", p.vendor_name);
          const extractedPriceMatch = extractPriceLikeText(proposalData);
          const extractedPriceValue = parseNumber(extractedPriceMatch);
          const updatePayload: Record<string, unknown> = { extracted_text: proposalData };
          if (extractedPriceValue > 0 && !p.price) {
            updatePayload.price = formatCurrencyWithOriginal(extractedPriceValue, extractedPriceMatch);
          }
          const { error: updateErr } = await (supabase.from("proposals").update(updatePayload).eq("id", p.proposal_id) as any);
          if (updateErr) console.warn(`Failed to save extracted text for ${p.vendor_name}:`, updateErr);
        }
        return {
          proposal_id: p.proposal_id,
          vendor_name: p.vendor_name,
          price: (p.price && parseNumber(p.price) > 0) ? p.price : 
                 (typeof proposalData === "string" && parseNumber(extractPriceLikeText(proposalData)) > 0) 
                   ? formatCurrencyWithOriginal(parseNumber(extractPriceLikeText(proposalData)), extractPriceLikeText(proposalData)) 
                   : "",
          timeline: p.timeline || "",
          experience: p.experience || "",
          proposal_data: proposalData,
        };
      });
      const vendors = await Promise.all(vendorPromises);
      const job = await startBackgroundAnalysisJob({
        contract_id: contract.contract_id,
        contract: {
          title: contract.title,
          description: contract.description || "",
          budget: contract.budget || "",
          deadline: contract.deadline || "",
          certifications: contract.required_certifications || "",
          mandatoryCriteria: contract.rfp_metadata?.mandatory_criteria,
        },
        vendors,
      });

      window.localStorage.setItem(`analysis-job:${selectedContract}`, job.job_id);
      setBackgroundJobId(job.job_id);
      setAnalysisProgress("✅ Analysis is running in the background. Check back or refresh to see results.");
    } catch (err: unknown) {
      let msg = "";
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          msg = "Analysis took too long (>15 min). Please try again.";
        } else {
          msg = err.message;
        }
      } else {
        msg = String(err);
      }
      console.error("Pipeline error:", msg);
      setAnalysisProgress(`❌ Error: ${msg}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const acceptProposal = async (proposalId: string) => {
    if (!selectedContract || !user || acceptingId) return;
    const confirmed = window.confirm("Accept this proposal? All other proposals will be rejected.");
    if (!confirmed) return;
    const doubleConfirmed = window.confirm("Are you absolutely sure you want to accept this proposal? This action is permanent and cannot be undone.");
    if (!doubleConfirmed) return;
    setAcceptingId(proposalId);
    try {
      const contract = myContracts.find((c) => c.contract_id === selectedContract);
      const acceptedProposal = allProposals.find((p) => p.proposal_id === proposalId);
      if (!contract || !acceptedProposal) throw new Error("Contract or proposal not found");
      const ownerName = profile?.company_name || (user as any).user_metadata?.full_name || user.email || "Contract Owner";

      {
        const { error } = await supabase.from("proposals").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", proposalId);
        if (error) throw error;
      }

      const otherProposals = allProposals.filter((p) => p.proposal_id !== proposalId);
      for (const p of otherProposals) {
        {
          const { error } = await supabase.from("proposals").update({ status: "rejected", rejected_at: new Date().toISOString() }).eq("id", p.proposal_id);
          if (error) throw error;
        }
        {
          const { error } = await supabase.from("messages").insert({
            id: randomUUID(),
            sender_id: user.id,
            receiver_id: p.vendor_id,
            text: `Thank you for your proposal for "${contract.title}". After careful review, we have decided to go with another vendor. We appreciate your effort and hope to collaborate in the future.`,
            timestamp: new Date().toISOString(),
          });
          if (error) throw error;
        }
        {
          const { error } = await supabase.from("notifications").insert({
            id: randomUUID(),
            user_id: p.vendor_id,
            type: "proposal_rejected",
            message: `Your proposal for "${contract.title}" was not selected.`,
            read: false,
            timestamp: new Date().toISOString(),
          });
          if (error) throw error;
        }
      }

      {
        const { error } = await supabase.from("contracts").update({ status: "closed" }).eq("id", selectedContract);
        if (error) throw error;
      }

      {
        const { error } = await supabase.from("messages").insert({
          id: randomUUID(),
          sender_id: user.id,
          receiver_id: acceptedProposal.vendor_id,
          text: `Congratulations! Your proposal for "${contract.title}" has been accepted by ${ownerName}. We look forward to working with you. Please reach out to discuss next steps.`,
          timestamp: new Date().toISOString(),
        });
        if (error) throw error;
      }
      {
        const { error } = await supabase.from("notifications").insert({
          id: randomUUID(),
          user_id: acceptedProposal.vendor_id,
          type: "proposal_accepted",
          message: `Your proposal for "${contract.title}" has been accepted!`,
          read: false,
          timestamp: new Date().toISOString(),
        });
        if (error) throw error;
      }

      const { data: vendorData } = await supabase.from("users").select("email").eq("id", acceptedProposal.vendor_id).maybeSingle();
      const vendorEmail = vendorData?.email;
      let emailSent = false;
      if (vendorEmail) {
        try {
          const res = await fetch(apiUrl("/api/proposals/accept"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              vendorEmail,
              vendorName: acceptedProposal.vendor_name,
              contractTitle: contract.title,
              acceptedByName: ownerName,
              price: acceptedProposal.price,
              timeline: acceptedProposal.timeline,
            }),
          });
          const data = await res.json();
          emailSent = data.emailSent;
        } catch { }
      }

      alert(`Proposal by ${acceptedProposal.vendor_name} accepted! ${otherProposals.length} other proposal(s) rejected.${emailSent ? " Email sent." : ""}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Error: ${msg}`);
    }
    setAcceptingId(null);
  };

  const vendorScorePoints = allProposals
    .map((proposal) => {
      const score = analyses[proposal.proposal_id]?.overall_score ?? proposal.ai_score ?? 0;
      return {
        label: proposal.vendor_name,
        value: score,
        color: score >= 70 ? "bg-[var(--success)]" : score >= 50 ? "bg-[var(--warning)]" : "bg-[var(--danger)]",
      };
    })
    .sort((a, b) => b.value - a.value);

  const sortedProposals = [...allProposals].sort((a, b) => {
    const sA = analyses[a.proposal_id]?.overall_score ?? a.ai_score ?? 0;
    const sB = analyses[b.proposal_id]?.overall_score ?? b.ai_score ?? 0;
    return sB - sA;
  });

  return (
    <div className="space-y-6">
      {myContracts.length > 0 && (
        <div className="card p-5">
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Select Contract</label>
          <select value={selectedContract || ""} onChange={(e) => { setSelectedContract(e.target.value); setAnalyses({}); }} className="input-field">
            {myContracts.map((c) => (
              <option key={c.contract_id} value={c.contract_id}>{c.title} ({c.status})</option>
            ))}
          </select>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="p-6 sm:p-8">
          {loadingResponses ? (
            <p className="text-sm text-[var(--muted)] text-center py-10">Loading...</p>
          ) : myContracts.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 bg-[var(--surface)] rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <p className="text-sm text-[var(--muted)]">No contracts yet. Post a contract first to receive vendor proposals.</p>
            </div>
          ) : allProposals.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 bg-[var(--surface)] rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
              </div>
              <p className="text-sm text-[var(--muted)]">No proposals received for this contract yet.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--muted)]">{allProposals.length} proposal{allProposals.length !== 1 ? "s" : ""} received</p>
                  {analysisProgress && <p className="text-xs text-[var(--primary)] mt-1">{analysisProgress}</p>}
                </div>
                <div className="inline-flex items-center gap-2">
                  <button onClick={runAIAnalysis} disabled={analyzing || backgroundJobId !== null} className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2 rounded-full text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-all shadow-sm">
                    {analyzing || backgroundJobId !== null ? <><div className="w-3.5 h-3.5 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin" />Analyzing...</> : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Run AI Analysis</>}
                  </button>
                  {(analyzing || backgroundJobId) && (
                    <button
                      disabled={stopping}
                      onClick={async () => {
                        setStopping(true);
                        setAnalysisProgress("Stopping analysis...");
                        try {
                          await cancelAnalysisNow(backgroundJobId);
                        } catch (err) {
                          console.warn("Failed to cancel analysis:", err);
                        }
                        try { window.localStorage.removeItem(`analysis-job:${selectedContract}`); } catch {}
                        setBackgroundJobId(null);
                        setAnalyzing(false);
                        setStopping(false);
                        setAnalysisProgress("Analysis stopped.");
                        if (selectedContractData?.last_analysis_result?.analyses_by_proposal_id) {
                          setAnalyses(selectedContractData.last_analysis_result.analyses_by_proposal_id);
                          setJudgeResult(selectedContractData.last_analysis_result.judge_result ?? null);
                        }
                      }}
                      className="ml-2 inline-flex items-center gap-2 bg-[#F3F2F1] text-[#1A1916] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#E9E8E6] disabled:opacity-60 disabled:cursor-not-allowed transition-all border"
                    >
                      {stopping ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-[#1A1916]/30 border-t-[#1A1916] rounded-full animate-spin" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" strokeWidth="1.5"/></svg>
                          Stop
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {activeAnalysis?.analyses_by_proposal_id && (
                <div className="rounded-xl border border-[var(--primary)]/20 bg-[var(--primary-light)] p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--primary)]">Analysis Report</p>
                      <p className="text-xs text-[var(--muted)]">
                        {activeAnalysis.created_at ? `Saved ${activeAnalysis.created_at}` : "Latest analysis"} · {activeAnalysis.vendor_count || allProposals.length} vendor(s)
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--primary)] bg-white/70 rounded-full px-3 py-1">
                        {activeAnalysis.cache_key ? "Stored in Supabase" : "Current run"}
                      </span>
                      <button
                        onClick={downloadComparisonSheet}
                        className="rounded-full border border-[var(--primary)]/20 bg-white px-3 py-1 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary)] hover:text-white"
                      >
                        Download Comparison Sheet
                      </button>
                    </div>
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
                    proposals={allProposals}
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
                    contract={selectedContractData}
                    proposals={allProposals}
                    analyses={analyses}
                    contractId={selectedContract || undefined}
                  />
                </div>
              )}

              {activeAnalysis?.judge_result?.comparative_analysis && (
                <details className="group">
                  <summary className="text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] cursor-pointer font-medium flex items-center gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                    View Comparative Ranking
                  </summary>
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-[var(--muted)]">{activeAnalysis.judge_result.comparative_analysis.selection_summary}</p>
                    {activeAnalysis.judge_result.comparative_analysis.ranking?.map((r: any, i: number) => (
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

              {sortedProposals.map((p, idx) => {
                const analysis = analyses[p.proposal_id];
                const score = analysis?.overall_score ?? p.ai_score;
                const risk = analysis?.risk_flags?.length ? "High" : p.risk_level || "Pending";
                const isAccepted = p.status === "accepted";
                const isRejected = p.status === "rejected";
                const hasDecision = allProposals.some((pr) => pr.status === "accepted" || pr.status === "rejected");
                return (
                  <div key={p.proposal_id} className={`border rounded-xl p-5 ${
                    isAccepted ? "border-[var(--success)] bg-[var(--success-light)] ring-2 ring-[var(--success)]/30" :
                    isRejected ? "border-[var(--danger)]/40 bg-[var(--danger-light)] opacity-70" :
                    idx === 0 && score ? "border-[var(--divider)] ring-2 ring-[var(--success)]/30" :
                    "border-[var(--divider)]"
                  }`}>
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
                        <Link href={`/companies/${p.vendor_id}?from=insights`} className="font-semibold text-[var(--foreground)] hover:text-[var(--primary)] hover:underline transition-colors">
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
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${risk === "Low" ? "badge-open" : risk === "High" ? "badge-closed" : "bg-[var(--surface)] text-[var(--muted)]"}`}>{risk}</span>
                        {score != null && (
                          <span className={`text-sm font-bold ${score >= 70 ? "text-[var(--success)]" : score >= 50 ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}>{score}/100</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm text-[var(--muted)] mb-2">
                        <span>Price: <span className="font-medium text-[var(--foreground)]">{(() => {
                          const analysisPrice = analyses[p.proposal_id]?.price;
                          const extractedPrice = extractPriceLikeText(p.extracted_text ?? p.proposal_data);
                          const priceText = analysisPrice ? analysisPrice : isSafeShortText(extractedPrice) ? extractedPrice : isSafeShortText(p.price) ? p.price : "";
                          return formatPriceDisplay(priceText);
                        })()}</span></span>
                      </div>
                    {p.experience && <p className="text-sm text-[var(--muted)] leading-relaxed mb-3">{p.experience}</p>}

                    {p.proposal_data && (() => {
                      try { JSON.parse(p.proposal_data as string); return !(p.proposal_file && typeof p.proposal_file === "string" && p.proposal_file.startsWith("http")); }
                      catch { return false; }
                    })() && (
                      <div className="space-y-2">
                        <button
                          onClick={() => {
                            try {
                              const data = JSON.parse(p.proposal_data as string);
                              const pdfDoc = generateProposalPDF(data);
                              const blob = pdfDoc.output("blob");
                              const url = URL.createObjectURL(blob);
                              window.open(url, "_blank");
                              setTimeout(() => URL.revokeObjectURL(url), 30000);
                            } catch (e) { console.error("PDF generation failed:", e); alert("Failed to generate PDF."); }
                          }}
                          className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          View PDF
                        </button>
                        <button
                          onClick={() => {
                            try {
                              const data = JSON.parse(p.proposal_data as string);
                              const pdfDoc = generateProposalPDF(data);
                              pdfDoc.save(p.proposal_file_name || "proposal.pdf");
                            } catch (e) { console.error("PDF download failed:", e); alert("Failed to download PDF."); }
                          }}
                          className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium ml-4"
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

                    <div className="mt-3 pt-3 border-t border-[var(--divider)] flex items-center justify-between gap-3">
                      <p className="text-sm text-[var(--muted)] line-clamp-2">{analysis?.analysis_summary || "No summary available."}</p>
                      <div className="shrink-0 flex items-center gap-3">
                        <button
                          onClick={() => downloadAnalysisReport(p)}
                          className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium"
                        >
                          Download Report
                        </button>
                        <Link href={`/contracts/${selectedContract}/reports/${p.proposal_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium">
                          Show Report
                        </Link>
                      </div>
                    </div>

                    {!isAccepted && !isRejected && !hasDecision && (
                      <div className="mt-4 pt-3 border-t border-[var(--divider)] flex justify-end">
                        <button
                          onClick={() => acceptProposal(p.proposal_id)}
                          disabled={!!acceptingId || analyzing || backgroundJobId !== null}
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
      </div>
    </div>
  );
}
