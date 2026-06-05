export function parseNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).replace(/,/g, "").replace(/[^\d.\-\s]/g, "");
  const n = parseFloat(s.trim());
  return Number.isFinite(n) ? n : 0;
}

export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  return text.trim();
}

export function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return "";
}

export function extractLabeledText(source: unknown, labels: string[]): string {
  const text = toText(source);
  if (!text) return "";

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const label of labels) {
      const normalized = label.toLowerCase();
      if (lower.startsWith(normalized)) {
        return line.slice(label.length).replace(/^[:\s-]+/, "").trim();
      }
      if (lower.includes(normalized)) {
        const index = lower.indexOf(normalized);
        return line.slice(index + label.length).replace(/^[:\s-]+/, "").trim() || line.trim();
      }
    }
  }

  return "";
}

export function extractCurrencyLikeText(source: unknown): string {
  const text = toText(source);
  if (!text) return "";

  const labeled = extractLabeledText(text, ["Proposed Price", "Price", "Budget", "Total Cost", "Estimated Price"]);
  if (labeled) return labeled;

  const currencyMatch = text.match(/(?:USD\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion))?/i);
  return currencyMatch?.[0]?.trim() || "";
}

export function extractPriceLikeText(source: unknown): string {
  const text = toText(source);
  if (!text) return "";

  const labeled = extractLabeledText(text, ["Proposed Price", "Price", "Total Cost", "Estimated Price", "Quote", "Quoted Price", "Bid"]);
  if (labeled) return labeled;

  const priceContextMatch = text.match(/(?:proposed price|quoted price|total cost|estimated price|quote|bid)[:\s-]{0,20}(?:USD\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion))?/i);
  if (priceContextMatch?.[0]) return priceContextMatch[0].trim();

  const currencyMatch = text.match(/(?:USD\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion))?/i);
  return currencyMatch?.[0]?.trim() || "";
}

export function extractTimelineLikeText(source: unknown): string {
  const text = toText(source);
  if (!text) return "";

  const labeled = extractLabeledText(text, ["Proposed Timeline", "Timeline", "Implementation Timeline", "Deadline", "Schedule"]);
  if (labeled) return labeled;

  const durationMatch = text.match(/\b(?:\d+\s*(?:days?|weeks?|months?|years?)|Q\d\s*\d{4}|[A-Za-z]+\s+\d{4})\b/i);
  return durationMatch?.[0]?.trim() || "";
}

export function formatCurrency(value: string | number | null | undefined, locale = "en-US", currency = "USD") {
  const n = parseNumber(value);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default formatCurrency;