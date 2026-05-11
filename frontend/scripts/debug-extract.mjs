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

const { data, error } = await supabase
  .from("proposals")
  .select("id,vendor_name,proposal_file")
  .eq("proposal_type", "uploaded_pdf")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();

if (error || !data) {
  console.error("No proposal found:", error?.message);
  process.exit(1);
}

console.log("Testing extraction for:", data.vendor_name);
console.log("PDF URL:", data.proposal_file);

const res = await fetch("http://localhost:3000/api/extract-pdf", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pdfUrl: data.proposal_file }),
});

const body = await res.json().catch(() => ({}));
console.log("Status:", res.status);
console.log("Response:", JSON.stringify(body).slice(0, 1200));
