import fs from "fs";
import { createClient } from "@supabase/supabase-js";

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

const { data: reports, error: rError } = await supabase
  .from("analysis_reports")
  .select("cache_key,result,created_at")
  .order("created_at", { ascending: false })
  .limit(2);

if (rError) {
  console.error("Reports query failed:", rError.message);
  process.exit(1);
}

for (const r of reports ?? []) {
  console.log(`\n======================================================`);
  console.log(`REPORT CREATED AT: ${r.created_at}`);
  console.log(`CACHE KEY: ${r.cache_key}`);
  
  const result = r.result || {};
  const vendorExtracts = result.vendor_extracts || {};
  
  for (const [vendorName, markdown] of Object.entries(vendorExtracts)) {
    console.log(`  Vendor: ${vendorName}`);
    console.log(`  Markdown length: ${markdown.length}`);
    console.log(`  Markdown Preview:\n${markdown.slice(0, 1500)}`);
    console.log(`  -----------------------------------------`);
  }
}
