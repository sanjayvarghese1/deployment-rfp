export function parseNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return 0;

  // Clean currency symbols
  const cleaned = trimmed.replace(/[$\u00A2-\u00A5\u20A0-\u20CF\uFE69\uFF04\uFFE0\uFFE1\uFFE5\uFFE6₹]/g, "").trim();
  
  const match = cleaned.match(/([\d,.-]+)\s*(k|m|b|thousand|million|billion|lakh|crore)?/i);
  if (!match) return 0;
  
  const numStr = match[1].replace(/,/g, "");
  const val = parseFloat(numStr);
  if (!Number.isFinite(val)) return 0;
  
  const suffix = (match[2] || "").toLowerCase();
  let multiplier = 1;
  if (suffix === "k" || suffix === "thousand") multiplier = 1e3;
  else if (suffix === "lakh") multiplier = 1e5;
  else if (suffix === "m" || suffix === "million") multiplier = 1e6;
  else if (suffix === "crore") multiplier = 1e7;
  else if (suffix === "b" || suffix === "billion") multiplier = 1e9;
  
  return val * multiplier;
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
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let rxStr = `\\b${escaped}`;
      if (/\w$/.test(label)) {
        rxStr += `\\b`;
      }
      const rx = new RegExp(rxStr, "i");
      const match = line.match(rx);
      if (match && match.index !== undefined) {
        const after = line.slice(match.index + label.length).replace(/^[:\s-()]+/, "").trim();
        if (after) return after;
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

  const currencyMatch = text.match(/(?:USD\s*|₹\s*|INR\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion|lakh|crore))?/i);
  return currencyMatch?.[0]?.trim() || "";
}

export function extractPriceLikeText(source: unknown): string {
  const text = toText(source);
  if (!text) return "";

  const labeled = extractLabeledText(text, [
    "Total Cost of Ownership (TCO)",
    "Total Cost of Ownership",
    "Proposed Price",
    "Quoted Price",
    "Estimated Price",
    "Proposed Budget",
    "Total Budget",
    "Total Cost",
    "Budget",
    "Price",
    "Quote",
    "Bid",
    "TCO"
  ]);
  if (labeled) return labeled;

  const priceContextMatch = text.match(/\b(?:proposed price|quoted price|total cost|estimated price|quote|bid|proposed budget|total budget|budget|tco)\b[:\s-]{0,20}(?:USD\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion))?/i);
  if (priceContextMatch?.[0]) return priceContextMatch[0].trim();

  const currencyMatch = text.match(/(?:USD\s*|₹\s*|INR\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion|lakh|crore))?/i);
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
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${n.toFixed(0)}`;
  }
}

export function formatCurrencyWithOriginal(value: string | number | null | undefined, originalText?: string) {
  const n = parseNumber(value);
  if (n === 0) return "N/A";
  
  let currency = "USD";
  let locale = "en-US";
  
  const textToCheck = String(originalText || value || "").toLowerCase();
  if (textToCheck.includes("₹") || textToCheck.includes("inr")) {
    currency = "INR";
    locale = "en-IN";
  } else if (textToCheck.includes("£") || textToCheck.includes("gbp")) {
    currency = "GBP";
    locale = "en-GB";
  } else if (textToCheck.includes("€") || textToCheck.includes("eur")) {
    currency = "EUR";
    locale = "de-DE";
  }
  
  try {
    if (originalText && /(lakh|crore|million|billion)/i.test(String(originalText))) {
      return String(originalText).trim();
    }
    
    return new Intl.NumberFormat(locale, { 
      style: "currency", 
      currency,
      maximumFractionDigits: 0
    }).format(n);
  } catch {
    return `${currency === "USD" ? "$" : currency + " "}${n.toLocaleString()}`;
  }
}

export function formatPriceDisplay(priceText: string | null | undefined): string {
  if (!priceText) return "N/A";
  const trimmed = priceText.trim();
  if (!trimmed || /^n\/?a$/i.test(trimmed) || /not\s*provided/i.test(trimmed)) return "N/A";
  
  if (/[$\u00A2-\u00A5\u20A0-\u20CF\uFE69\uFF04\uFFE0\uFFE1\uFFE5\uFFE6₹]/.test(trimmed) || /(?:usd|gbp|eur|inr|lakh|crore|million|billion|thousand|TBD)/i.test(trimmed)) {
    return trimmed;
  }
  
  const parsed = parseNumber(trimmed);
  if (parsed > 0) {
    return formatCurrency(parsed);
  }
  
  return trimmed;
}

export default formatCurrency;