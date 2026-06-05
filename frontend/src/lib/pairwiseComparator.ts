export interface PairwiseComparison {
  a: string;
  b: string;
  winner: string | "tie";
  reasons: string[];
  winnerScoreDiff?: number;
}

/**
 * Deterministic pairwise comparator.
 * Inputs: comparative metrics array produced by computeComparativeMetrics()
 * Optional overallScores map by vendor name for fallback comparisons.
 */
export function computePairwiseComparisons(
  metrics: Array<{
    vendor_name: string;
    price_value?: number | null;
    price_per_score?: number | null;
    mandatory_coverage_pct?: number | null;
    risk_adjusted_score?: number | null;
  }>,
  overallScores?: Record<string, number>
): PairwiseComparison[] {
  const byName = new Map<string, typeof metrics[0]>();
  for (const m of metrics) byName.set(m.vendor_name, m);

  const names = metrics.map((m) => m.vendor_name);
  const pairs: PairwiseComparison[] = [];

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      const ma = byName.get(a)!;
      const mb = byName.get(b)!;

      const reasons: string[] = [];
      let winner: string | "tie" = "tie";

      const ra = Number(ma.risk_adjusted_score ?? NaN);
      const rb = Number(mb.risk_adjusted_score ?? NaN);
      if (Number.isFinite(ra) && Number.isFinite(rb) && Math.abs(ra - rb) >= 3) {
        winner = ra > rb ? a : b;
        reasons.push(`Higher risk-adjusted score (${ra} vs ${rb})`);
      }

      if (winner === "tie") {
        const ca = Number(ma.mandatory_coverage_pct ?? NaN);
        const cb = Number(mb.mandatory_coverage_pct ?? NaN);
        if (Number.isFinite(ca) && Number.isFinite(cb) && Math.abs(ca - cb) >= 5) {
          winner = ca > cb ? a : b;
          reasons.push(`Covers more mandatory items (${Math.round(ca)}% vs ${Math.round(cb)}%)`);
        }
      }

      if (winner === "tie") {
        const pa = Number(ma.price_per_score ?? NaN);
        const pb = Number(mb.price_per_score ?? NaN);
        if (Number.isFinite(pa) && Number.isFinite(pb) && pa > 0 && pb > 0) {
          // lower price_per_score is better
          const rel = Math.abs(pa - pb) / Math.min(pa, pb);
          if (rel >= 0.1) {
            winner = pa < pb ? a : b;
            reasons.push(`More cost-effective (price/score ${Math.round(Math.min(pa, pb))} vs ${Math.round(Math.max(pa, pb))})`);
          }
        }
      }

      if (winner === "tie") {
        const va = Number(ma.price_value ?? NaN);
        const vb = Number(mb.price_value ?? NaN);
        if (Number.isFinite(va) && Number.isFinite(vb) && Math.min(va, vb) > 0) {
          const pct = Math.abs(va - vb) / Math.min(va, vb);
          if (pct >= 0.05) {
            winner = va < vb ? a : b;
            reasons.push(`Lower absolute price (${Math.round(Math.min(va, vb))} vs ${Math.round(Math.max(va, vb))})`);
          }
        }
      }

      if (winner === "tie") {
        const oa = overallScores?.[a] ?? NaN;
        const ob = overallScores?.[b] ?? NaN;
        if (Number.isFinite(oa) && Number.isFinite(ob) && Math.abs(oa - ob) >= 2) {
          winner = oa > ob ? a : b;
          reasons.push(`Higher overall score (${oa} vs ${ob})`);
        }
      }

      if (winner === "tie") {
        // Balanced tradeoffs fallback
        const tradeoffs: string[] = [];
        if (Number.isFinite(ma.risk_adjusted_score ?? NaN) && Number.isFinite(mb.risk_adjusted_score ?? NaN)) {
          tradeoffs.push(`Risk-adjusted ${ma.risk_adjusted_score ?? "N/A"} vs ${mb.risk_adjusted_score ?? "N/A"}`);
        }
        if (Number.isFinite(ma.mandatory_coverage_pct ?? NaN) && Number.isFinite(mb.mandatory_coverage_pct ?? NaN)) {
          tradeoffs.push(`Coverage ${ma.mandatory_coverage_pct ?? "N/A"}% vs ${mb.mandatory_coverage_pct ?? "N/A"}%`);
        }
        if (Number.isFinite(ma.price_value ?? NaN) && Number.isFinite(mb.price_value ?? NaN)) {
          tradeoffs.push(`Price ${ma.price_value ?? "N/A"} vs ${mb.price_value ?? "N/A"}`);
        }
        reasons.push(`Tie / close tradeoffs: ${tradeoffs.join("; ")}`);
      }

      const winnerScoreDiff = (() => {
        const v = overallScores?.[winner as string];
        if (winner === "tie" || !v) return undefined;
        const other = winner === a ? overallScores?.[b] : overallScores?.[a];
        if (other == null) return undefined;
        return Math.round((v - other) * 10) / 10;
      })();

      pairs.push({ a, b, winner, reasons, winnerScoreDiff });
    }
  }

  return pairs;
}

export default computePairwiseComparisons;
