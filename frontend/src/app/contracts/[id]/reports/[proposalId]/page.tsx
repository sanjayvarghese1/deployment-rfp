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

function scoreBarClass(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.75) return "bg-[var(--success)]";
  if (ratio >= 0.45) return "bg-[var(--warning)]";
  return "bg-[var(--danger)]";
}

function scoreBarWidth(score: number, maxScore: number): string {
  if (maxScore <= 0) return "0%";
  return `${Math.max(4, Math.min(100, (score / maxScore) * 100))}%`;
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
  const params = useParams();
  const router = useRouter();
  const contractId = String(params.id || "");
  const proposalId = String(params.proposalId || "");

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

    if (Array.isArray(analysis.scoring_criteria) && analysis.scoring_criteria.length > 0) {
      return analysis.scoring_criteria;
    }

    return [
      { id: "technical_fit", label: "Technical fit", max_score: 30, score: analysis.criterion_scores?.technical_fit?.score ?? 0, reason: analysis.criterion_scores?.technical_fit?.reason ?? "" },
      { id: "cost_efficiency", label: "Cost efficiency", max_score: 20, score: analysis.criterion_scores?.cost_efficiency?.score ?? 0, reason: analysis.criterion_scores?.cost_efficiency?.reason ?? "" },
      { id: "relevant_experience", label: "Relevant experience", max_score: 20, score: analysis.criterion_scores?.relevant_experience?.score ?? 0, reason: analysis.criterion_scores?.relevant_experience?.reason ?? "" },
      { id: "timeline_fit", label: "Timeline fit", max_score: 15, score: analysis.criterion_scores?.timeline_fit?.score ?? 0, reason: analysis.criterion_scores?.timeline_fit?.reason ?? "" },
      { id: "compliance_completeness", label: "Compliance completeness", max_score: 15, score: analysis.criterion_scores?.compliance_completeness?.score ?? 0, reason: analysis.criterion_scores?.compliance_completeness?.reason ?? "" },
    ];
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
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--background)_0%,rgba(244,240,229,0.72)_100%)] p-6 md:p-10">
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

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[var(--divider)] bg-white/90 p-4 shadow-sm backdrop-blur-sm">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Overall score</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <p className={`text-4xl font-semibold ${scoreClass(analysis.overall_score)}`}>{analysis.overall_score}/100</p>
              <span className={`text-xs font-medium px-3 py-1 rounded-full ${recommendationClass(analysis.independent_recommendation)}`}>
                {analysis.independent_recommendation}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--divider)] bg-white/90 p-4 shadow-sm backdrop-blur-sm">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Mandatory criteria</p>
            <p className="mt-2 text-3xl font-semibold text-[var(--foreground)]">{criterionRows.length}</p>
            <p className="text-sm text-[var(--muted)]">criteria evaluated in this report</p>
          </div>
          <div className="rounded-xl border border-[var(--divider)] bg-white/90 p-4 shadow-sm backdrop-blur-sm">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Risk posture</p>
            <p className="mt-2 text-3xl font-semibold text-[var(--foreground)]">{analysis.risk_flags?.length || 0}</p>
            <p className="text-sm text-[var(--muted)]">flag(s) requiring attention</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-xl border border-[var(--divider)] bg-white p-5 shadow-sm space-y-5">
            <p className="text-sm text-[var(--muted)]">{analysis.analysis_summary}</p>

            {a.risk_summary && (
              <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
                <span className="font-medium text-[var(--foreground)]">Risk summary:</span> {a.risk_summary}
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-[var(--divider)]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--surface)] text-left text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Criterion</th>
                    <th className="px-3 py-2 font-medium">Weight</th>
                    <th className="px-3 py-2 font-medium">Vendor score</th>
                    <th className="px-3 py-2 font-medium">Visual</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {criterionRows.map((row, index) => (
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

            <div className="rounded-xl border border-[var(--divider)] bg-[var(--surface)]/40 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">Mandatory score breakdown</p>
                  <p className="text-xs text-[var(--muted)]">Bars compare the score earned against the maximum weight for each criterion.</p>
                </div>
                <span className="text-xs font-medium rounded-full bg-white px-3 py-1 text-[var(--muted)] border border-[var(--divider)]">
                  Visual summary
                </span>
              </div>

              <div className="space-y-3">
                {criterionRows.map((row) => (
                  <div key={`summary-${row.id}`} className="rounded-lg border border-[var(--divider)] bg-white p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)]">{row.label}</p>
                        <p className="text-xs text-[var(--muted)]">Mandatory {row.max_score} · Earned {row.score}</p>
                      </div>
                      <p className="text-sm font-semibold text-[var(--foreground)] whitespace-nowrap">{row.score}/{row.max_score}</p>
                    </div>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-[var(--surface)] ring-1 ring-inset ring-[var(--divider)]">
                      <div
                        className={`h-full rounded-full ${scoreBarClass(row.score, row.max_score)}`}
                        style={{ width: scoreBarWidth(row.score, row.max_score) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--divider)] bg-white p-5 shadow-sm space-y-5 sticky top-6 self-start">
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