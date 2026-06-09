"use client";

import type { ProposalAnalysis } from "@/services/aiService";
import computeComparativeMetrics from "@/lib/comparativeMetrics";
import computePairwiseComparisons from "@/lib/pairwiseComparator";
import { extractPriceLikeText, formatPriceDisplay } from "@/lib/formatters/number";

interface ProposalPairwiseComparisonProps {
  proposals: any[];
  analyses: Record<string, ProposalAnalysis>;
}

export default function ProposalPairwiseComparison({ proposals, analyses }: ProposalPairwiseComparisonProps) {
  if (!proposals || proposals.length === 0) return null;

  const isSafeShortText = (value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > 80) return false;
    return !/confidentiality notice|table of contents|executive summary|appendix|proposal/i.test(text);
  };

  const vendorScores = proposals.map((p) => {
    const analysis = analyses[p.proposal_id];
    const extractedPrice = extractPriceLikeText(p.extracted_text ?? p.proposal_data);
    const priceText = analysis?.price
      ? analysis.price
      : isSafeShortText(extractedPrice)
        ? extractedPrice
        : isSafeShortText(p.price)
          ? p.price
          : "";

    return {
      vendor_name: p.vendor_name || "Unknown",
      price: priceText,
      overall_score: analysis?.overall_score ?? p.ai_score ?? 0,
      risk_flags: analysis?.risk_flags ?? [],
      scoring_criteria: analysis?.scoring_criteria ?? [],
    };
  });

  const metrics = computeComparativeMetrics(vendorScores as any);
  const overallMap: Record<string, number> = {};
  for (const v of vendorScores) overallMap[v.vendor_name] = Number(v.overall_score ?? 0);

  const pairs = computePairwiseComparisons(metrics, overallMap);

  // Simple highlights
  const bestRiskAdjusted = metrics.slice().sort((a, b) => (b.risk_adjusted_score ?? 0) - (a.risk_adjusted_score ?? 0))[0];
  const validPrices = metrics.filter((m) => Number.isFinite(m.price_value ?? NaN) && (m.price_value ?? 0) > 0);
  const lowestPrice = validPrices.length ? validPrices.slice().sort((a, b) => (a.price_value ?? 0) - (b.price_value ?? 0))[0] : null;
  const highestScore = vendorScores.slice().sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0))[0];
  const mostCovered = metrics
    .filter((m) => Number.isFinite(m.mandatory_coverage_pct ?? NaN))
    .slice()
    .sort((a, b) => (b.mandatory_coverage_pct ?? 0) - (a.mandatory_coverage_pct ?? 0))[0];

  const winCounts = new Map<string, number>();
  for (const pair of pairs) {
    if (pair.winner !== "tie") {
      winCounts.set(pair.winner, (winCounts.get(pair.winner) ?? 0) + 1);
    }
  }

  const leader = Array.from(winCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || highestScore?.vendor_name || "N/A";
  const pairSummary = pairs
    .filter((pair) => pair.winner !== "tie")
    .slice(0, 3)
    .map((pair) => `${pair.winner} over ${pair.winner === pair.a ? pair.b : pair.a}: ${pair.reasons[0] || "clearer fit"}`);

  const decisiveMatch = pairs
    .filter((pair) => pair.winner !== "tie")
    .sort((a, b) => (b.winnerScoreDiff ?? 0) - (a.winnerScoreDiff ?? 0))[0];

  return (
    <div className="rounded-xl border border-[var(--divider)] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">Pairwise Comparisons</p>
          <p className="text-xs text-[var(--muted)]">Deterministic, auditable reasons shown at a glance</p>
        </div>
        <div className="text-xs text-[var(--muted)]">{metrics.length} vendor{metrics.length !== 1 ? "s" : ""} compared</div>
      </div>

      <div className="rounded-lg border border-[var(--divider)] bg-[var(--primary-light)]/35 p-3 mb-3 space-y-2">
        <p className="text-sm font-semibold text-[var(--foreground)]">Detailed comparison summary</p>
        <p className="text-sm text-[var(--muted)]">
          {leader !== "N/A"
            ? `${leader} is the current front-runner across the pairwise checks. `
            : "The current analysis is too close to call on pairwise checks. "}
          {highestScore?.vendor_name ? `${highestScore.vendor_name} leads on total score. ` : ""}
          {bestRiskAdjusted?.vendor_name ? `${bestRiskAdjusted.vendor_name} leads on risk-adjusted fit. ` : ""}
          {lowestPrice?.vendor_name ? `${lowestPrice.vendor_name} is the lowest-cost option. ` : ""}
          {mostCovered?.vendor_name ? `${mostCovered.vendor_name} has the strongest mandatory coverage. ` : ""}
        </p>
        {decisiveMatch && (
          <div className="rounded-md bg-white/80 border border-[var(--divider)] p-2.5">
            <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">Most decisive matchup</p>
            <p className="text-sm text-[var(--foreground)] font-medium">
              {decisiveMatch.winner} beat {decisiveMatch.winner === decisiveMatch.a ? decisiveMatch.b : decisiveMatch.a}
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">{decisiveMatch.reasons.join(" · ")}</p>
          </div>
        )}
        {pairSummary.length > 0 && (
          <ul className="text-xs text-[var(--muted)] list-disc list-inside space-y-1">
            {pairSummary.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--divider)]">
          <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">Best Risk‑Adjusted</p>
          <p className="text-sm font-bold text-[var(--foreground)]">{bestRiskAdjusted?.vendor_name ?? "N/A"}</p>
          <p className="text-xs text-[var(--warning)]">{bestRiskAdjusted?.risk_adjusted_score ?? "N/A"}/100</p>
        </div>

        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--divider)]">
          <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">Lowest Price</p>
          <p className="text-sm font-bold text-[var(--foreground)]">{lowestPrice?.vendor_name ?? "N/A"}</p>
          <p className="text-xs text-[var(--success)]">{lowestPrice?.price_raw ? formatPriceDisplay(lowestPrice.price_raw) : "N/A"}</p>
        </div>

        <div className="bg-[var(--surface)] rounded-lg p-3 border border-[var(--divider)]">
          <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">Highest Score</p>
          <p className="text-sm font-bold text-[var(--foreground)]">{highestScore?.vendor_name ?? "N/A"}</p>
          <p className="text-xs text-[var(--primary)]">{highestScore?.overall_score ?? "N/A"}/100</p>
        </div>
      </div>

      <div className="text-xs text-[var(--muted)] space-y-2">
        {pairs.slice(0, 6).map((p, i) => (
          <div key={`${p.a}-${p.b}-${i}`} className="p-2 border rounded-md bg-white/60">
            <div className="flex items-center justify-between">
              <div className="font-medium text-[var(--foreground)]">{p.a} vs {p.b}</div>
              <div className={`text-xs font-semibold ${p.winner === 'tie' ? 'text-[var(--muted)]' : 'text-[var(--primary)]'}`}>{p.winner === 'tie' ? 'Tie' : `${p.winner} wins`}</div>
            </div>
            <div className="text-[var(--muted)] mt-1">
              {p.reasons.join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
