export interface ComparativeMetricsPerVendor {
  vendor_name: string;
  price_raw?: string | null;
  price_value?: number | null;
  price_per_score?: number | null;
  mandatory_coverage_pct?: number | null;
  risk_adjusted_score?: number | null;
}

function parseMoney(value?: string | null): number | null {
  if (!value) return null;
  try {
    const cleaned = String(value)
      .replace(/\u00A0/g, " ")
      .replace(/[^0-9.\-kKmMbB,]/g, "")
      .trim();

    if (!cleaned) return null;
    // Handle shorthand like 10k, 2.5m
    const match = cleaned.match(/^([0-9,.]+)\s*([kKmMbB])?$/);
    if (match) {
      let num = Number(match[1].replace(/,/g, ""));
      const suffix = match[2]?.toLowerCase();
      if (suffix === "k") num = num * 1_000;
      if (suffix === "m") num = num * 1_000_000;
      if (suffix === "b") num = num * 1_000_000_000;
      return Number.isFinite(num) ? num : null;
    }

    const asNumber = Number(cleaned.replace(/,/g, ""));
    return Number.isFinite(asNumber) ? asNumber : null;
  } catch {
    return null;
  }
}

export function computeComparativeMetrics(vendorScores: any[]): ComparativeMetricsPerVendor[] {
  if (!Array.isArray(vendorScores)) return [];

  return vendorScores.map((v) => {
    const vendorName = String(v?.vendor_name || v?.vendor || "Unknown");
    const priceRaw = (v as any).price || (v as any).vendor_price || (v as any).budget || null;
    const priceValue = parseMoney(priceRaw);
    const overall = Number(v?.overall_score ?? v?.final_score ?? 0);

    const pricePerScore = priceValue && overall > 0 ? +(priceValue / Math.max(1, overall)) : null;

    // mandatory coverage: % of criteria present (non-zero) if scoring_criteria exists
    let mandatoryCoverage: number | null = null;
    try {
      const criteria = Array.isArray(v?.scoring_criteria) ? v.scoring_criteria : ([] as any[]);
      if (criteria.length > 0) {
        const nonZero = criteria.filter((c: any) => Number(c?.score ?? 0) > 0).length;
        mandatoryCoverage = Math.round((nonZero / criteria.length) * 100);
      }
    } catch {
      mandatoryCoverage = null;
    }

    // risk-adjusted score: subtract 10% per risk flag up to 50%
    const riskFlags = Array.isArray(v?.risk_flags) ? v.risk_flags.length : 0;
    const riskPenalty = Math.min(0.5, 0.1 * riskFlags);
    const riskAdjusted = Math.round(overall * (1 - riskPenalty));

    return {
      vendor_name: vendorName,
      price_raw: priceRaw || null,
      price_value: priceValue,
      price_per_score: pricePerScore ? Math.round(pricePerScore) : null,
      mandatory_coverage_pct: mandatoryCoverage,
      risk_adjusted_score: Number.isFinite(riskAdjusted) ? riskAdjusted : null,
    };
  });
}

export default computeComparativeMetrics;
