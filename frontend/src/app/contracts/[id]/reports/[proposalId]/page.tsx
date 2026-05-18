"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";
import type { ProposalAnalysis, SavedProposalAnalysisResult } from "@/services/aiService";
import formatCurrency, { extractCurrencyLikeText, extractTimelineLikeText, parseNumber } from "@/lib/formatters/number";

function normalizeDoc(data: any): any {
  return data;
}

function scoreClass(score: number): string {
  if (score >= 70) return "text-[var(--success)]";
  if (score >= 50) return "text-[var(--warning)]";
  return "text-[var(--danger)]";
}

function recommendationClass(label: string): string {
  if (label === "Strongly Recommended") return "bg-[var(--success-light)] text-[var(--success)]";
  if (label === "Recommended") return "bg-[var(--primary-light)] text-[var(--primary)]";
  if (label === "Consider") return "bg-[var(--warning-light)] text-[var(--warning)]";
  return "bg-[var(--danger-light)] text-[var(--danger)]";
}

function formatAnalysisPrice(analysis: ProposalAnalysis | null, proposal: any): string {
  const a: any = analysis;
  if (a?.price !== null && a?.price !== undefined && Number.isFinite(a.price)) {
    return formatCurrency(a.price, "en-US", a.price_currency || "USD");
  }

  if (proposal?.price) return proposal.price;
  const extractedPrice = extractCurrencyLikeText(proposal?.extracted_text ?? proposal?.proposal_data ?? proposal?.price);
  const priceValue = parseNumber(extractedPrice);
  return priceValue > 0 ? formatCurrency(priceValue) : "Not provided";
}

function formatAnalysisTimeline(analysis: ProposalAnalysis | null, proposal: any): string {
  const a: any = analysis;
  if (a?.timeline) {
    const { start, end, duration_weeks: durationWeeks } = a.timeline;
    if (start || end || durationWeeks !== null) {
      if (start && end) return `${start} → ${end}${durationWeeks ? ` (${durationWeeks} weeks)` : ""}`;
      if (durationWeeks !== null) return `${durationWeeks} weeks`;
      return start || end || "Not provided";
    }
  }

  if (proposal?.timeline) return proposal.timeline;
  const extractedTimeline = extractTimelineLikeText(proposal?.extracted_text ?? proposal?.proposal_data ?? proposal?.timeline);
  return extractedTimeline && extractedTimeline.length < 80 ? extractedTimeline : "Not provided";
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

  const a: any = analysis;

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
    const rows: Array<{ key: keyof ProposalAnalysis["criterion_scores"]; label: string; color: string }> = [
      { key: "technical_fit", label: "Technical fit", color: "bg-[var(--primary)]" },
      { key: "cost_efficiency", label: "Cost efficiency", color: "bg-[var(--success)]" },
      { key: "relevant_experience", label: "Relevant experience", color: "bg-[var(--primary)]" },
      { key: "timeline_fit", label: "Timeline fit", color: "bg-[var(--warning)]" },
      { key: "compliance_completeness", label: "Compliance completeness", color: "bg-[var(--danger)]" },
    ];

    return rows.map((row) => ({
      ...row,
      score: analysis.criterion_scores[row.key]?.score ?? 0,
      reason: analysis.criterion_scores[row.key]?.reason ?? "",
    }));
  }, [analysis]);

  const recommendation = a?.recommendation || a?.independent_recommendation;
  const priceConfidence = a?.price_confidence || "unknown";
  const timelineConfidence = a?.timeline_confidence || "unknown";

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
    <div className="min-h-screen bg-[var(--background)] p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Vendor report</p>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">{analysis.vendor_name || proposal.vendor_name}</h1>
            <p className="text-sm text-[var(--muted)]">{contract?.title || "Contract"} · {proposal.created_at || "Recent"}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/contracts/${contractId}`} className="text-sm px-4 py-2 rounded-full border border-[var(--divider)] text-[var(--foreground)] hover:bg-[var(--surface)]">Back to contract</Link>
            <button onClick={() => window.close()} className="text-sm px-4 py-2 rounded-full bg-[var(--primary)] text-[#EFECE3] hover:bg-[var(--primary-hover)]">Close tab</button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-xl border border-[var(--divider)] bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Overall score</p>
                <p className={`text-4xl font-semibold ${scoreClass(analysis.overall_score)}`}>{analysis.overall_score}/100</p>
              </div>
              <span className={`text-xs font-medium px-3 py-1 rounded-full ${recommendationClass(analysis.independent_recommendation)}`}>
                {analysis.independent_recommendation}
              </span>
            </div>

            <p className="text-sm text-[var(--muted)]">{analysis.analysis_summary}</p>

            {a.risk_summary && (
              <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
                <span className="font-medium text-[var(--foreground)]">Risk summary:</span> {a.risk_summary}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {criterionRows.map((row) => (
                <div key={row.key} className="rounded-lg border border-[var(--divider)] p-3">
                  <div className="flex items-center justify-between gap-2 text-xs mb-2">
                    <span className="font-medium text-[var(--foreground)]">{row.label}</span>
                    <span className={`font-semibold ${row.color === "bg-[var(--success)]" ? "text-[var(--success)]" : row.color === "bg-[var(--warning)]" ? "text-[var(--warning)]" : row.color === "bg-[var(--danger)]" ? "text-[var(--danger)]" : "text-[var(--primary)]"}`}>{row.score}/100</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--surface)] overflow-hidden mb-2">
                    <div className={`h-full rounded-full ${row.color}`} style={{ width: `${Math.max(6, row.score)}%` }} />
                  </div>
                  <p className="text-xs text-[var(--muted)]">{row.reason}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--divider)] bg-white p-5 shadow-sm space-y-4">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)] mb-2">Snapshot</p>
              <div className="space-y-2 text-sm">
                <p><span className="text-[var(--muted)]">Recommendation:</span> {recommendation || "Not provided"}</p>
                <p><span className="text-[var(--muted)]">Price:</span> {formatAnalysisPrice(analysis, proposal)} <span className="text-[var(--muted)]">({priceConfidence})</span></p>
                {a?.price_estimation_reasoning && priceConfidence !== "exact" && <p className="text-xs text-[var(--muted)]">{a.price_estimation_reasoning}</p>}
                <p><span className="text-[var(--muted)]">Timeline:</span> {formatAnalysisTimeline(analysis, proposal)} <span className="text-[var(--muted)]">({timelineConfidence})</span></p>
                {a?.timeline_estimation_reasoning && timelineConfidence !== "explicit" && <p className="text-xs text-[var(--muted)]">{a.timeline_estimation_reasoning}</p>}
                <p><span className="text-[var(--muted)]">Risk:</span> {analysis.risk_flags?.length ? "Has risk flags" : "No major risk flags"}</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[var(--foreground)] mb-2">Strengths</p>
              <ul className="list-disc list-inside text-sm text-[var(--muted)] space-y-1">
                {(analysis.strengths || []).map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>

            <div>
              <p className="text-sm font-semibold text-[var(--foreground)] mb-2">Weaknesses</p>
              <ul className="list-disc list-inside text-sm text-[var(--muted)] space-y-1">
                {(analysis.weaknesses || []).map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>

            <div>
              <p className="text-sm font-semibold text-[var(--foreground)] mb-2">Risk flags</p>
              <ul className="list-disc list-inside text-sm text-[var(--muted)] space-y-1">
                {(analysis.risk_flags || []).map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
          </div>
        </div>

        {savedAnalysis?.judge_result?.comparative_analysis && (
          <div className="rounded-xl border border-[var(--divider)] bg-white p-5 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-[var(--foreground)]">Overall comparison context</p>
            <p className="text-sm text-[var(--muted)]">{savedAnalysis.judge_result.comparative_analysis.selection_summary}</p>
            <p className="text-xs text-[var(--muted)]">Best vendor overall: {savedAnalysis.judge_result.comparative_analysis.best_vendor}</p>
          </div>
        )}

        {proposal.proposal_file && typeof proposal.proposal_file === "string" && (
          <div className="rounded-xl border border-[var(--divider)] bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-[var(--foreground)] mb-2">Original document</p>
            <p className="text-sm text-[var(--muted)] mb-3">The uploaded proposal remains attached, but its raw contents are not rendered in the UI.</p>
            {proposal.proposal_file.startsWith("http") ? (
              <a
                href={proposal.proposal_file}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium"
              >
                Open proposal file
              </a>
            ) : (
              <p className="text-sm text-[var(--muted)]">Document data is available in storage.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}