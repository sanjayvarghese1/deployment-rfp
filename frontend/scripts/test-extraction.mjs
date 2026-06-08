import fs from "fs";
import { createClient } from "@supabase/supabase-js";

function parseNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).replace(/,/g, "").replace(/[^\d.\-\s]/g, "");
  const n = parseFloat(s.trim());
  return Number.isFinite(n) ? n : 0;
}

function toText(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  return text.trim();
}

function extractLabeledText(source, labels) {
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

function extractPriceLikeText(source) {
  const text = toText(source);
  if (!text) return "";

  const labeled = extractLabeledText(text, ["Proposed Price", "Price", "Total Cost", "Estimated Price", "Quote", "Quoted Price", "Bid"]);
  if (labeled) return labeled;

  const priceContextMatch = text.match(/(?:proposed price|quoted price|total cost|estimated price|quote|bid)[:\s-]{0,20}(?:USD\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion))?/i);
  if (priceContextMatch?.[0]) return priceContextMatch[0].trim();

  const currencyMatch = text.match(/(?:USD\s*)?\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:k|m|million|billion))?/i);
  return currencyMatch?.[0]?.trim() || "";
}

function formatCurrency(value, locale = "en-US", currency = "USD") {
  const n = parseNumber(value);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function readEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1).replace(/^"|"$/g, "");
    env[key] = value;
  }
  return env;
}

const env = readEnv(".env.local");
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: proposals, error } = await supabase
  .from("proposals")
  .select("id,vendor_name,proposal_data,extracted_text,price");

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

for (const p of proposals ?? []) {
  const rawText = p.extracted_text || p.proposal_data || "";
  const match = extractPriceLikeText(rawText);
  const num = parseNumber(match);
  const formatted = formatCurrency(num);
  console.log(`Vendor: ${p.vendor_name}`);
  console.log(`  Current DB Price: "${p.price}"`);
  console.log(`  Raw Text Length: ${rawText.length}`);
  console.log(`  extractPriceLikeText: "${match}"`);
  console.log(`  parseNumber: ${num}`);
  console.log(`  formatCurrency: "${formatted}"`);
  console.log(`  First 10 lines containing price keywords:`);
  
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    if (/(price|cost|total|budget|quote|bid|investment|fee)/i.test(line)) {
      console.log(`    - ${line}`);
      if (++count >= 10) break;
    }
  }
  console.log("------------------------------------------------");
}
