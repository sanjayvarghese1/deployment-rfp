"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import jsPDF from "jspdf";
import { supabase } from "@/services/supabase";
import type { ProposalAnalysis, SavedProposalAnalysisResult } from "@/services/aiService";
import formatCurrency from "@/lib/formatters/number";

function normalizeDoc(data: any): any {
  return data;
}

function supportLabel(level?: string): string {
  if (level === "explicit") return "Explicit";
  if (level === "partial") return "Partial";
  if (level === "inferred") return "Inferred";
  return "Unknown";
}

function supportClass(level?: string): string {
  if (level === "explicit") return "bg-[#EAF3EE] text-[#2E7D5E]";
  if (level === "partial") return "bg-[#FDF3E3] text-[#8A6020]";
  if (level === "inferred") return "bg-[#FCECEA] text-[#B03A2E]";
  return "bg-[#EEECEA] text-[#7A7872]";
}

function recommendationPill(label?: string): string {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("strong")) return "bg-[#EAF3EE] text-[#2E7D5E]";
  if (normalized.includes("recommend")) return "bg-[#EAF1FB] text-[#1A5FAD]";
  if (normalized.includes("consider")) return "bg-[#FDF3E3] text-[#8A6020]";
  return "bg-[#FCECEA] text-[#B03A2E]";
}

function formatDisplayDate(value?: string): string {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAnalysisPrice(analysis: ProposalAnalysis | null, proposal: any): string {
  const price = (analysis as any)?.price;
  if (price !== null && price !== undefined && Number.isFinite(price)) {
    return formatCurrency(price, "en-US", (analysis as any)?.price_currency || "USD");
  }
  return proposal?.price || "Not provided";
}

function formatAnalysisTimeline(analysis: ProposalAnalysis | null, proposal: any): string {
  const timeline = String((analysis as any)?.timeline || "").trim();
  if (timeline) return timeline;
  return proposal?.timeline || "Not provided";
}

function formatCompactTimeline(timeline: string): string {
  const text = String(timeline || "").replace(/\s+/g, " ").trim();
  if (!text) return "Not provided";
  const firstClause = text.split(/[;,.]/)[0].trim();
  if (firstClause.length <= 42) return firstClause;
  return `${firstClause.slice(0, 39)}…`;
}

function formatAnalysisBudget(analysis: ProposalAnalysis | null, contract: any): string {
  return String((analysis as any)?.budget || contract?.budget || contract?.budget_range || contract?.budget_framework || "Not provided");
}

function confidenceText(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function vendorInitials(name?: string): string {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "V";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function scoreRingOffset(score: number, maxScore = 100): number {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const safeScore = Math.max(0, Math.min(maxScore, score));
  return circumference - (safeScore / maxScore) * circumference;
}

function scoreBarTone(score: number): string {
  if (score >= 70) return "bg-[#2E7D5E]";
  if (score >= 50) return "bg-[#8A6020]";
  return "bg-[#B03A2E]";
}

function scoreBarWidth(score: number, maxScore: number): string {
  if (maxScore <= 0) return "0%";
  return `${Math.max(4, Math.min(100, (score / maxScore) * 100))}%`;
}

export default function VendorReportPage() {
  const params = useParams<{ id?: string; proposalId?: string }>();
  const router = useRouter();
  const contractId = String(params?.id || "");
  const proposalId = String(params?.proposalId || "");

  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState<any>(null);
  const [proposal, setProposal] = useState<any>(null);
  const [analysis, setAnalysis] = useState<ProposalAnalysis | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<SavedProposalAnalysisResult | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!contractId || !proposalId) return;
      setLoading(true);
      try {
        const [contractSnap, proposalSnap] = await Promise.all([
          supabase.from("contracts").select("*").eq("id", contractId).maybeSingle(),
          supabase.from("proposals").select("*").eq("id", proposalId).maybeSingle(),
        ]);

        if (contractSnap.data) {
          const contractData = { contract_id: contractSnap.data.id, ...normalizeDoc(contractSnap.data) };
          setContract(contractData);
          setSavedAnalysis(contractData.last_analysis_result || null);
        }

        if (proposalSnap.data) {
          setProposal({ proposal_id: proposalSnap.data.id, ...normalizeDoc(proposalSnap.data) });
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [contractId, proposalId]);

  useEffect(() => {
    if (!savedAnalysis?.analyses_by_proposal_id) return;
    setAnalysis(savedAnalysis.analyses_by_proposal_id[proposalId] || null);
  }, [proposalId, savedAnalysis]);

  const criterionRows = useMemo(() => {
    if (!analysis) return [];
    if (Array.isArray(analysis.scoring_criteria) && analysis.scoring_criteria.length > 0) return analysis.scoring_criteria;
    return [
      { id: "technical_fit", label: "Technical fit", max_score: 30, score: analysis.criterion_scores?.technical_fit?.score ?? 0, reason: analysis.criterion_scores?.technical_fit?.reason ?? "" },
      { id: "cost_efficiency", label: "Cost efficiency", max_score: 20, score: analysis.criterion_scores?.cost_efficiency?.score ?? 0, reason: analysis.criterion_scores?.cost_efficiency?.reason ?? "" },
      { id: "relevant_experience", label: "Relevant experience", max_score: 20, score: analysis.criterion_scores?.relevant_experience?.score ?? 0, reason: analysis.criterion_scores?.relevant_experience?.reason ?? "" },
      { id: "timeline_fit", label: "Timeline fit", max_score: 15, score: analysis.criterion_scores?.timeline_fit?.score ?? 0, reason: analysis.criterion_scores?.timeline_fit?.reason ?? "" },
      { id: "compliance_completeness", label: "Compliance completeness", max_score: 15, score: analysis.criterion_scores?.compliance_completeness?.score ?? 0, reason: analysis.criterion_scores?.compliance_completeness?.reason ?? "" },
    ];
  }, [analysis]);

  const reportMetrics = useMemo(() => {
    const rows = criterionRows.filter(Boolean);
    const confidenceValues = rows.map((row: any) => Number(row.confidence)).filter((value) => Number.isFinite(value)) as number[];
    const supportCounts = rows.reduce((acc, row: any) => {
      const level = String(row.support_level || "unknown");
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const evidenceCount = rows.filter((row: any) => String(row.evidence || "").trim().length > 0).length;
    const lowestConfidenceRow = [...rows].filter((row: any) => Number.isFinite(Number(row.confidence))).sort((left: any, right: any) => Number(left.confidence) - Number(right.confidence))[0] as any;
    return {
      averageConfidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : undefined,
      evidenceCoverage: rows.length ? evidenceCount / rows.length : 0,
      evidenceCount,
      supportCounts,
      lowestConfidenceRow,
    };
  }, [criterionRows]);

  const judgeResult = savedAnalysis?.judge_result ?? null;
  const recommendationView = judgeResult?.final_recommendation_view;
  const comparativeReasoning = judgeResult?.comparative_analysis?.comparative_reasoning;
  const selectedVendorName = analysis?.vendor_name || proposal?.vendor_name || "Vendor";
  const recommendationState = recommendationPill(analysis?.independent_recommendation);
  const scoreOffset = scoreRingOffset(analysis?.overall_score || 0);
  const topScore = criterionRows.length ? [...criterionRows].sort((left: any, right: any) => Number(right.score) - Number(left.score))[0] : null;
  const analysisData: any = analysis;
  const currentProposal = proposal;
  const mandatoryConditionRows = useMemo(
    () =>
      criterionRows.map((row: any) => ({
        ...row,
        satisfied: Number(row.score || 0) > 0,
      })),
    [criterionRows],
  );
  const satisfiedMandatoryCount = mandatoryConditionRows.filter((row) => row.satisfied).length;

  const downloadReport = () => {
    if (!analysis || !proposal) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(18);
    doc.text("Vendor Analysis Report", 14, 18);
    doc.setFontSize(10);
    doc.text(`${analysis.vendor_name || proposal.vendor_name || "Vendor"} · ${contract?.title || "Contract"}`, 14, 26);
    doc.setFontSize(11);
    doc.text(`Score: ${analysis.overall_score}/100`, 14, 38);
    doc.text(`Recommendation: ${analysis.independent_recommendation || "Not provided"}`, 14, 45);
    doc.text(`Budget: ${contract?.budget || contract?.budget_range || "Not provided"}`, 14, 52);
    doc.text(`Price: ${formatAnalysisPrice(analysis, proposal)}`, 14, 59);
    doc.text(`Timeline: ${formatAnalysisTimeline(analysis, proposal)}`, 14, 66);
    doc.save(`${String(analysis.vendor_name || proposal.vendor_name || "vendor").replace(/\s+/g, "_")}_report.pdf`);
  };

  if (loading) {
    return <div className="min-h-screen p-8 text-sm text-[var(--muted)]">Loading vendor report...</div>;
  }

  if (!analysis || !proposal) {
    return (
      <div className="min-h-screen p-8 space-y-4">
        <p className="text-sm text-[var(--muted)]">Vendor report not found yet. Run AI Analysis first, then reopen this report.</p>
        <button onClick={() => router.back()} className="text-sm text-[var(--primary)] hover:underline">Go back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#F4F2EE] text-[#1A1916]">
      <div className="flex min-h-screen w-full overflow-hidden">
        <aside className="hidden w-[240px] shrink-0 flex-col overflow-hidden border-r border-black/5 bg-white xl:flex">
          <div className="flex items-center gap-3 border-b border-black/5 px-5 py-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1A5FAD] text-sm font-bold text-white">P</div>
            <div>
              <div className="text-[13px] font-semibold text-[#1A1916]">ProcureIQ</div>
              <div className="mt-0.5 text-[10px] text-[#7A7872]">Vendor analysis</div>
            </div>
          </div>

          <div className="border-b border-black/5 px-5 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7A7872]">Active vendor</div>
            <div className="mt-1 font-serif text-[15px] font-medium leading-snug text-[#1A1916]" style={{ fontFamily: "'Playfair Display', serif" }}>{selectedVendorName}</div>
            <div className="mt-1 text-[11px] text-[#7A7872]">{contract?.title || "Contract"}</div>
            <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${recommendationState}`}>{analysis.independent_recommendation}</div>
          </div>

          <div className="border-b border-black/5 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="relative h-16 w-16 shrink-0">
                <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
                  <circle cx="32" cy="32" r="26" fill="none" stroke="#EEECEA" strokeWidth="6" />
                  <circle cx="32" cy="32" r="26" fill="none" stroke="#2E7D5E" strokeWidth="6" strokeDasharray="163.36" strokeDashoffset={scoreOffset} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <div className="text-[20px] font-bold leading-none text-[#2E7D5E]">{analysis.overall_score}</div>
                  <div className="text-[9px] text-[#7A7872]">/100</div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-[#1A1916]">Overall score</div>
                <div className="mt-1 text-[11px] text-[#2E7D5E]">{analysis.independent_recommendation}</div>
                <div className="mt-1 text-[11px] text-[#7A7872]">Submitted {formatDisplayDate(proposal.created_at)}</div>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-3">
            <div className="px-2 pb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#C8C4BC]">Vendors in this contract</div>
            <div className="space-y-1">
              {[{ name: selectedVendorName, score: analysis.overall_score, active: true }].concat([]).map((vendor) => (
                <div key={vendor.name} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] transition-colors ${vendor.active ? "bg-[#EAF1FB] text-[#1A5FAD] font-medium" : "text-[#7A7872] hover:bg-[#F7F6F3] hover:text-[#1A1916]"}`}>
                  <div className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[13px] ${vendor.active ? "bg-[rgba(26,95,173,0.12)] text-[#1A5FAD]" : "bg-[#EEECEA] text-[#7A7872]"}`}>{vendorInitials(vendor.name)}</div>
                  <span className="min-w-0 flex-1 truncate">{vendor.name}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${vendor.active ? "bg-[#EAF3EE] text-[#2E7D5E]" : "bg-[#EEECEA] text-[#7A7872]"}`}>{vendor.score}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 px-2 pb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#C8C4BC]">Contract</div>
            <div className="space-y-1">
              <Link href={`/contracts/${contractId}`} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-[#7A7872] transition-colors hover:bg-[#F7F6F3] hover:text-[#1A1916]"><div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-[#EEECEA] text-[13px]">📋</div><span className="min-w-0 flex-1 truncate">Contract details</span></Link>
              <Link href={`/contracts/${contractId}`} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-[#7A7872] transition-colors hover:bg-[#F7F6F3] hover:text-[#1A1916]"><div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-[#EEECEA] text-[13px]">⚖</div><span className="min-w-0 flex-1 truncate">Compare all vendors</span></Link>
            </div>
          </nav>

          <div className="border-t border-black/5 p-4">
            <button onClick={downloadReport} className="w-full rounded-lg border border-[#1A5FAD] bg-[#1A5FAD] px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-[#164E94]">Download PDF</button>
            <button onClick={() => router.back()} className="mt-2 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-[11px] font-medium text-[#7A7872] transition-colors hover:bg-[#F7F6F3] hover:text-[#1A1916]">Back to contract</button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-black/5 bg-white px-4 md:px-7">
            <div className="text-[11px] text-[#7A7872]"><Link href={`/contracts/${contractId}`} className="hover:text-[#1A1916]">Contracts</Link><span className="px-1.5 text-[#C8C4BC]">/</span><span className="hover:text-[#1A1916]">{contract?.title || "Contract"}</span><span className="px-1.5 text-[#C8C4BC]">/</span></div>
            <span className="text-[11px] font-medium text-[#1A1916]">{selectedVendorName}</span>
            <div className="ml-auto flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold ${recommendationState}`}>✓ {analysis.independent_recommendation}</span>
              <button onClick={downloadReport} className="rounded-lg border border-black/10 px-4 py-1.5 text-[11px] font-medium text-[#7A7872] transition-colors hover:bg-[#F7F6F3] hover:text-[#1A1916]">Export</button>
              <button onClick={() => window.close()} className="rounded-lg bg-[#1A5FAD] px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#164E94]">Close</button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto bg-[#F4F2EE] px-4 py-5 md:px-7 md:py-6">
            <div className="mx-auto w-full max-w-[1760px] space-y-4">
              <div className="grid items-start gap-3 xl:grid-cols-6">
                <div className="relative h-fit overflow-hidden rounded-[13px] border border-black/5 bg-white p-3"><div className="absolute inset-x-0 top-0 h-[3px] bg-[#2E7D5E]" /><div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7A7872]">Overall score</div><div className={`mt-2 text-[24px] font-bold leading-none ${analysis.overall_score >= 70 ? "text-[#2E7D5E]" : analysis.overall_score >= 50 ? "text-[#8A6020]" : "text-[#B03A2E]"}`}>{analysis.overall_score}<span className="text-[13px] font-normal text-[#7A7872]">/100</span></div><div className="mt-1 text-[10px] text-[#7A7872]">Best in pool · {analysis.independent_recommendation}</div></div>
                <div className="relative h-fit overflow-hidden rounded-[13px] border border-black/5 bg-white p-3"><div className="absolute inset-x-0 top-0 h-[3px] bg-[#0F6E56]" /><div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7A7872]">Quoted price</div><div className="mt-2 text-[20px] font-bold leading-none text-[#1A1916]">{formatAnalysisPrice(analysis, proposal)}</div><div className="mt-1 text-[10px] text-[#2E7D5E]">{formatAnalysisBudget(analysis, contract)}</div></div>
                <div className="relative h-fit overflow-hidden rounded-[13px] border border-black/5 bg-white p-3"><div className="absolute inset-x-0 top-0 h-[3px] bg-[#8A6020]" /><div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7A7872]">Timeline</div><div className="mt-2 max-w-full text-[18px] font-bold leading-tight text-[#1A1916] break-words">{formatCompactTimeline(formatAnalysisTimeline(analysis, proposal))}</div><div className="mt-1 text-[10px] text-[#7A7872]">{analysisData.timeline_confidence === "explicit" ? "Explicit evidence" : "Partial evidence"}</div></div>
                <div className="relative h-fit overflow-hidden rounded-[13px] border border-black/5 bg-white p-3"><div className="absolute inset-x-0 top-0 h-[3px] bg-[#1A5FAD]" /><div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7A7872]">Evidence coverage</div><div className="mt-2 text-[24px] font-bold leading-none text-[#1A5FAD]">{Math.round(reportMetrics.evidenceCoverage * 100)}%</div><div className="mt-1 text-[10px] text-[#7A7872]">{reportMetrics.evidenceCount} of {criterionRows.length} criteria cited</div></div>
                <div className="relative h-fit overflow-hidden rounded-[13px] border border-black/5 bg-white p-3"><div className="absolute inset-x-0 top-0 h-[3px] bg-[#2E7D5E]" /><div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7A7872]">Avg. confidence</div><div className="mt-2 text-[24px] font-bold leading-none text-[#2E7D5E]">{confidenceText(reportMetrics.averageConfidence)}</div><div className="mt-1 text-[10px] text-[#7A7872]">Mean support certainty</div></div>
                <div className="relative h-fit overflow-hidden rounded-[13px] border border-black/5 bg-white p-3"><div className="absolute inset-x-0 top-0 h-[3px] bg-[#B03A2E]" /><div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7A7872]">Risk flags</div><div className="mt-2 text-[24px] font-bold leading-none text-[#8A6020]">{analysis.risk_flags?.length || 0}</div><div className="mt-1 text-[10px] text-[#7A7872]">Moderate review required</div></div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[15px] border border-black/5 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                  <div className="flex flex-col gap-8">
                    <div className="flex flex-col lg:pt-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1A5FAD]">Analysis summary</div>
                      <p className="mt-3 text-[15px] leading-[1.75] text-[#1A1916]" style={{ fontFamily: "'Playfair Display', serif" }}>{analysis.analysis_summary}</p>
                      <div className="mt-3 inline-flex flex-wrap items-center gap-2 text-[12px] text-[#7A7872]">
                        <span className="font-semibold uppercase tracking-[0.08em] text-[#8A6020]">Timeline</span>
                        <span className="text-[#1A1916]">{formatAnalysisTimeline(analysis, proposal)}</span>
                        {analysisData.timeline_confidence && (
                          <span className="rounded-full bg-[#F7F6F3] px-2 py-0.5 text-[10px] font-medium text-[#7A7872]">
                            {analysisData.timeline_confidence === "explicit" ? "Explicit evidence" : analysisData.timeline_confidence === "partial" ? "Partial evidence" : "Inferred"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <div className="mb-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7A7872]">Proposal snapshot</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-[9px] bg-[#F7F6F3] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7A7872]">Recommendation</div><div className="mt-1 text-[12px] font-semibold text-[#2E7D5E]">{analysis.independent_recommendation}</div></div>
                        <div className="rounded-[9px] bg-[#F7F6F3] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7A7872]">Budget ceiling</div><div className="mt-1 text-[12px] font-medium text-[#1A1916]">{formatAnalysisBudget(analysis, contract)}</div></div>
                        <div className="rounded-[9px] bg-[#F7F6F3] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7A7872]">Price confidence</div><div className="mt-1 text-[12px] font-medium text-[#1A1916]">{analysisData.price_confidence || "unknown"}</div></div>
                        <div className="rounded-[9px] bg-[#F7F6F3] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7A7872]">Timeline evidence</div><div className="mt-1 text-[12px] font-medium text-[#8A6020]">{analysisData.timeline_confidence === "explicit" ? "Explicit" : analysisData.timeline_confidence === "partial" ? "Partial" : "Inferred"}</div></div>
                        <div className="rounded-[9px] bg-[#F7F6F3] px-3 py-2.5 sm:col-span-2"><div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7A7872]">Support signals</div><div className="mt-1 text-[12px] font-medium text-[#1A1916]">{reportMetrics.supportCounts.explicit || 0} explicit · {reportMetrics.supportCounts.partial || 0} partial · {reportMetrics.supportCounts.inferred || 0} inferred</div></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[15px] border border-black/5 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                  <div className="mb-4 text-[12px] font-semibold text-[#1A1916]">Vendor snapshot</div>
                  <div className="space-y-4">
                    <div><div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7A7872]">Strengths</div><div className="space-y-1.5 text-[11px] text-[#7A7872]">{(analysis.strengths || []).map((item, index) => <div key={`strength-${index}`} className="flex gap-2"><span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#2E7D5E]" /><span>{item}</span></div>)}{(analysis.strengths || []).length === 0 && <div>No strengths captured.</div>}</div></div>
                    <div className="border-t border-black/5 pt-4"><div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7A7872]">Weaknesses</div><div className="space-y-1.5 text-[11px] text-[#7A7872]">{(analysis.weaknesses || []).map((item, index) => <div key={`weakness-${index}`} className="flex gap-2"><span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#8A6020]" /><span>{item}</span></div>)}{(analysis.weaknesses || []).length === 0 && <div>No weaknesses captured.</div>}</div></div>
                    <div className="border-t border-black/5 pt-4"><div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7A7872]">Risk flags</div><div className="space-y-1.5 text-[11px] text-[#7A7872]">{(analysis.risk_flags || []).map((item, index) => <div key={`risk-${index}`} className="flex gap-2"><span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#B03A2E]" /><span>{item}</span></div>)}{(analysis.risk_flags || []).length === 0 && <div>No risk flags captured.</div>}</div></div>
                    <div className="grid grid-cols-2 gap-2 border-t border-black/5 pt-4"><div className="rounded-[9px] bg-[#F7F6F3] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7A7872]">Lowest confidence</div><div className="mt-1 text-[12px] font-semibold text-[#8A6020]">{reportMetrics.lowestConfidenceRow?.label || "N/A"}</div><div className="mt-0.5 text-[10px] text-[#7A7872]">{confidenceText(reportMetrics.lowestConfidenceRow?.confidence)}</div></div><div className="rounded-[9px] bg-[#F7F6F3] px-3 py-2.5"><div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7A7872]">Highest scoring</div><div className="mt-1 text-[12px] font-semibold text-[#2E7D5E]">{topScore?.label || "N/A"}</div><div className="mt-0.5 text-[10px] text-[#7A7872]">{topScore ? `${topScore.score}/${topScore.max_score}` : "No data"}</div></div></div>
                  </div>
                </div>
              </div>

              <div className="rounded-[15px] border border-black/5 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-semibold text-[#1A1916]">Mandatory criteria scoring</div>
                    <div className="mt-1 text-[11px] text-[#7A7872]">Score and satisfaction view for every mandatory condition</div>
                  </div>
                  <div className="rounded-full bg-[#F7F6F3] px-3 py-1 text-[10px] font-semibold text-[#7A7872]">
                    {criterionRows.length} criteria tracked
                  </div>
                </div>

                <div className="overflow-hidden rounded-[12px] border border-black/5">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-[#F7F6F3] text-left text-[#7A7872]">
                      <tr>
                        <th className="px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.1em]">Condition</th>
                        <th className="px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.1em]">Satisfied</th>
                        <th className="px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.1em]">Score</th>
                        <th className="px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.1em]">Support</th>
                        <th className="px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.1em]">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mandatoryConditionRows.map((row: any, index) => (
                        <tr key={row.id || row.label} className={index % 2 === 0 ? "bg-white" : "bg-[#F7F6F3]/40"}>
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-[#1A1916]">{row.label}</div>
                            <div className="mt-1 text-[11px] text-[#7A7872]">{row.reason || "No supporting reason provided."}</div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${row.satisfied ? "bg-[#EAF3EE] text-[#2E7D5E]" : "bg-[#FCECEA] text-[#B03A2E]"}`}>
                              {row.satisfied ? "Satisfied" : "Not met"}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className={`text-[13px] font-bold ${row.score >= row.max_score * 0.75 ? "text-[#2E7D5E]" : row.score >= row.max_score * 0.45 ? "text-[#8A6020]" : "text-[#B03A2E]"}`}>
                              {row.score}/{row.max_score}
                            </div>
                            <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-[#EEECEA]"><div className={`h-full rounded-full ${row.score >= 70 ? "bg-[#2E7D5E]" : row.score >= 50 ? "bg-[#8A6020]" : "bg-[#B03A2E]"}`} style={{ width: scoreBarWidth(row.score, row.max_score) }} /></div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${supportClass((row as any).support_level)}`}>{supportLabel((row as any).support_level)}</span>
                          </td>
                          <td className="px-4 py-3 align-top text-[11px] text-[#7A7872]">{(row as any).evidence || "No evidence provided"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {mandatoryConditionRows.map((row: any) => (
                    <div key={`visual-${row.id || row.label}`} className="rounded-[12px] border border-black/5 bg-[#F7F6F3]/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] font-medium text-[#1A1916]">{row.label}</div>
                          <div className="mt-1 text-[10px] text-[#7A7872]">{row.satisfied ? "Condition satisfied" : "Needs attention"}</div>
                        </div>
                        <div className="whitespace-nowrap text-[12px] font-semibold text-[#1A1916]">{row.score}/{row.max_score}</div>
                      </div>
                      <div className="mt-3 h-3 overflow-hidden rounded-full bg-[#EEECEA] ring-1 ring-inset ring-black/5">
                        <div className={`h-full rounded-full ${row.score >= 70 ? "bg-[#2E7D5E]" : row.score >= 50 ? "bg-[#8A6020]" : "bg-[#B03A2E]"}`} style={{ width: scoreBarWidth(row.score, row.max_score) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {judgeResult && (
                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-[15px] border border-black/5 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                    <div className="mb-4 text-[12px] font-semibold text-[#1A1916]">AI judge recommendation</div>
                    <div className="mb-4 rounded-[11px] border border-[#1A5FAD]/15 bg-[#EAF1FB] p-4">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#1A5FAD]">Recommended vendor</div>
                      <div className="mt-1 font-serif text-[18px] font-medium text-[#1A1916]" style={{ fontFamily: "'Playfair Display', serif" }}>{recommendationView?.recommended_vendor || judgeResult.comparative_analysis.best_vendor || "Not provided"}</div>
                      <div className="mt-1 text-[11px] leading-[1.55] text-[#1A3D6A]">{recommendationView?.headline || judgeResult.comparative_analysis.selection_summary}</div>
                      <div className="mt-1 text-[11px] leading-[1.55] text-[#1A3D6A]">{recommendationView?.summary || judgeResult.comparative_analysis.selection_summary}</div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-[9px] bg-[#F7F6F3] p-4"><div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7A7872]">Why it won</div><div className="space-y-1.5 text-[11px] text-[#7A7872]">{(recommendationView?.why_this_vendor_won || []).map((item, index) => <div key={index} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2E7D5E]" /><span>{item}</span></div>)}</div></div>
                      <div className="rounded-[9px] bg-[#F7F6F3] p-4"><div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7A7872]">Key tradeoffs</div><div className="space-y-1.5 text-[11px] text-[#7A7872]">{(recommendationView?.key_tradeoffs || []).map((item, index) => <div key={index} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8A6020]" /><span>{item}</span></div>)}</div></div>
                    </div>
                    {comparativeReasoning && <div className="mt-3 rounded-[9px] bg-[#F7F6F3] p-4"><div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7A7872]">Comparative reasoning</div><div className="text-[11px] leading-[1.55] text-[#7A7872]">{comparativeReasoning.summary}</div></div>}
                  </div>
                  <div className="rounded-[15px] border border-black/5 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                    <div className="mb-4 text-[12px] font-semibold text-[#1A1916]">Other vendors snapshot</div>
                    <div className="space-y-3">
                      {(recommendationView?.other_vendors_snapshot || []).map((item, index) => <div key={index} className="rounded-[9px] border border-black/5 bg-[#F7F6F3] p-4"><div className="flex items-center justify-between gap-3"><div className="font-medium text-[#1A1916]">{item.vendor_name}</div><div className="text-[15px] font-bold text-[#1A5FAD]">{item.score}</div></div><div className="mt-1 text-[10px] font-medium text-[#7A7872]">{item.label}</div><div className="mt-1 text-[11px] leading-[1.55] text-[#7A7872]">{item.note}</div></div>)}
                      {(!recommendationView?.other_vendors_snapshot || recommendationView.other_vendors_snapshot.length === 0) && <p className="text-sm text-[#7A7872]">No additional vendor snapshots were returned yet.</p>}
                    </div>
                  </div>
                </div>
              )}

              {currentProposal.proposal_file && typeof currentProposal.proposal_file === "string" && (
                <div className="flex items-center justify-between gap-4 rounded-[13px] border border-black/5 bg-white px-5 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F7F6F3] text-[17px]">📄</div>
                    <div>
                      <div className="text-[13px] font-medium text-[#1A1916]">{currentProposal.proposal_file.split(/[\\/]/).pop() || "Proposal document"}</div>
                      <div className="text-[10px] text-[#7A7872]">Original proposal document · Attached to this contract</div>
                    </div>
                  </div>
                  {currentProposal.proposal_file.startsWith("http") ? <a href={currentProposal.proposal_file} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-black/10 px-4 py-1.5 text-[11px] font-medium text-[#7A7872] transition-colors hover:bg-[#F7F6F3] hover:text-[#1A1916]">Open proposal file</a> : <span className="text-[11px] text-[#7A7872]">Document data is available in storage.</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
