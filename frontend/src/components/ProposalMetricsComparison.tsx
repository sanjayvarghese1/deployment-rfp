"use client";

import type { ProposalAnalysis } from "@/services/aiService";
import {
  parseNumber,
  formatCurrency,
  firstNonEmptyText,
  extractCurrencyLikeText,
  extractTimelineLikeText,
} from "@/lib/formatters/number";
import MetricCard from "@/components/MetricCard";

interface ProposalMetricsComparisonProps {
  contract: any;
  proposals: any[];
  analyses: Record<string, ProposalAnalysis>;
  contractId?: string;
}

export default function ProposalMetricsComparison({
  contract,
  proposals,
  analyses,
  contractId,
}: ProposalMetricsComparisonProps) {
  if (!contract || proposals.length === 0) {
    return null;
  }

  const isSafeShortText = (value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || text.length > 80) return false;
    return !/confidentiality notice|table of contents|executive summary|appendix|proposal/i.test(text);
  };

  // ─── Parse budget from contract ───
  const budgetText = firstNonEmptyText(
    contract.budget,
    contract.budget_range,
    contract.budget_framework,
    contract.budgetIndicator,
    contract.rfp_metadata?.budgetIndicator,
    contract.last_analysis_result?.budgetIndicator
  );
  const budgetNumber = parseNumber(budgetText);

  // ─── Build proposal metrics data ───
  const metricsData = proposals.map((proposal) => {
    const analysis = analyses[proposal.proposal_id];
    const extractedPrice = extractCurrencyLikeText(proposal.extracted_text ?? proposal.proposal_data);
    const extractedTimeline = extractTimelineLikeText(proposal.extracted_text ?? proposal.proposal_data);
    const priceText = isSafeShortText(extractedPrice)
      ? extractedPrice
      : isSafeShortText(proposal.price)
        ? proposal.price
        : "";
    const timelineText = isSafeShortText(extractedTimeline)
      ? extractedTimeline
      : isSafeShortText(proposal.timeline)
        ? proposal.timeline
        : "";
    const priceNumber = parseNumber(priceText);
    const riskLevel =
      analysis?.risk_flags && analysis.risk_flags.length > 0 ? "High" : "Low";
    const score = analysis?.overall_score ?? proposal.ai_score ?? 0;
    const priceFormatted = priceNumber > 0 ? formatCurrency(priceNumber) : "N/A";
    return {
      vendor_name: proposal.vendor_name || "Unknown",
      price: priceFormatted,
      priceFormatted,
      priceNumber,
      timeline: timelineText || "N/A",
      riskLevel,
      score,
      proposal_id: proposal.proposal_id,
    };
  });

  // Only consider valid numeric prices for average/median calculations
  const validPrices = metricsData.map((m) => m.priceNumber).filter((n) => n > 0);

  const avgPrice = validPrices.length
    ? validPrices.reduce((s, n) => s + n, 0) / validPrices.length
    : 0;

  const medianPrice = (() => {
    if (validPrices.length === 0) return 0;
    const vals = validPrices.slice().sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
  })();

  // ─── Compute risk distribution ───
  const riskCounts = {
    High: metricsData.filter((m) => m.riskLevel === "High").length,
    Low: metricsData.filter((m) => m.riskLevel === "Low").length,
  };

  // ─── Find max price for scaling ───
  const maxPrice = Math.max(
    budgetNumber,
    ...metricsData.map((m) => m.priceNumber),
    1
  );
  const hasBudget = budgetNumber > 0;

  return (
    <div className="rounded-lg border border-[var(--divider)] bg-white/70 p-5 space-y-5">
      {/* ─── Title ─── */}
      <div>
        <p className="text-xs uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">
          Proposal Metrics Comparison
        </p>
        <p className="text-sm text-[var(--muted)]">
          Budget, pricing, timeline, risk, and score breakdown for all vendors
        </p>
      </div>

      {/* ─── Metric Cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Vendors" value={metricsData.length} />
        <MetricCard
          label="Avg Price"
          value={avgPrice > 0 ? formatCurrency(avgPrice) : "N/A"}
        />
        <MetricCard
          label="Median Price"
          value={medianPrice > 0 ? formatCurrency(medianPrice) : "N/A"}
        />
        <MetricCard
          label="Over Budget"
          value={`${metricsData.filter((m) => m.priceNumber > budgetNumber).length}`}
          note={`${((metricsData.filter((m) => m.priceNumber > budgetNumber).length / Math.max(1, metricsData.length)) * 100).toFixed(0)}% of vendors`}
        />
      </div>

      {/* ─── Budget vs. Proposed Price Chart ─── */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Budget vs. Proposed Prices
        </p>
        <div className="space-y-2">
          {/* Contract Budget */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-[var(--foreground)]">
                Contract Budget
              </span>
              <span className="text-[var(--muted)]">{formatCurrency(budgetNumber)}</span>
            </div>
            <div className="w-full bg-[var(--surface)] rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-[var(--primary)]"
                style={{ width: `${Math.max(6, Math.round((budgetNumber / Math.max(1, maxPrice)) * 100))}%` }}
              />
            </div>
          </div>

          {/* Vendor Prices */}
          {metricsData.map((metric, idx) => (
            <div key={`${idx}-${metric.vendor_name}`} className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-[var(--foreground)]">
                  {metric.vendor_name}
                </span>
                <span
                  className={`font-semibold ${
                    hasBudget && metric.priceNumber > budgetNumber
                      ? "text-[var(--warning)]"
                      : "text-[var(--success)]"
                  }`}
                >
                  {metric.priceFormatted}
                </span>
              </div>
              <div className="w-full bg-[var(--surface)] rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full ${
                    hasBudget && metric.priceNumber > budgetNumber
                      ? "bg-[var(--warning)]"
                      : "bg-[var(--success)]"
                  }`}
                  style={{
                    width: `${Math.max(6, Math.round((metric.priceNumber / Math.max(1, maxPrice)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Risk Distribution ─── */}
      <div>
        <div className="space-y-2 border border-[var(--divider)] rounded-lg p-3 bg-[var(--surface)]/30">
          <p className="text-sm font-semibold text-[var(--foreground)]">
            Risk Distribution
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-white/70 border border-[var(--divider)] px-2.5 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--danger)]" />
                <span className="text-[var(--muted)]">High</span>
              </div>
              <div className="font-bold text-[var(--foreground)]">{riskCounts.High}</div>
            </div>
            <div className="rounded-md bg-white/70 border border-[var(--divider)] px-2.5 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--success)]" />
                <span className="text-[var(--muted)]">Low</span>
              </div>
              <div className="font-bold text-[var(--foreground)]">{riskCounts.Low}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Summary Table ─── */}
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Vendor Summary Table
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--divider)]">
                <th className="text-left px-3 py-2 font-semibold text-[var(--muted)] uppercase tracking-wide text-xs">
                  Vendor
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--muted)] uppercase tracking-wide text-xs">
                  Price
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--muted)] uppercase tracking-wide text-xs">
                  Timeline
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--muted)] uppercase tracking-wide text-xs">
                  Risk
                </th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--muted)] uppercase tracking-wide text-xs">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {metricsData.map((metric, idx) => (
                <tr
                  key={`table-${idx}-${metric.vendor_name}`}
                  className="border-b border-[var(--divider)]/50 hover:bg-[var(--surface)]/50 transition-colors"
                >
                  <td className="px-3 py-2.5 text-[var(--foreground)] font-medium">
                    {metric.vendor_name}
                  </td>
                  <td
                    className={`text-right px-3 py-2.5 font-semibold ${
                      hasBudget && metric.priceNumber > budgetNumber
                        ? "text-[var(--warning)]"
                        : "text-[var(--success)]"
                    }`}
                  >
                      {metric.priceFormatted}
                  </td>
                  <td className="text-right px-3 py-2.5 text-[var(--foreground)]">
                    {metric.timeline}
                  </td>
                  <td className="text-right px-3 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-semibold text-xs ${
                        metric.riskLevel === "High"
                          ? "bg-[var(--danger-light)] text-[var(--danger)]"
                          : "bg-[var(--success-light)] text-[var(--success)]"
                      }`}
                    >
                      {metric.riskLevel}
                    </span>
                  </td>
                  <td
                    className={`text-right px-3 py-2.5 font-bold ${
                      metric.score >= 70
                        ? "text-[var(--success)]"
                        : metric.score >= 50
                          ? "text-[var(--warning)]"
                          : "text-[var(--danger)]"
                    }`}
                  >
                    {metric.score}/100
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

