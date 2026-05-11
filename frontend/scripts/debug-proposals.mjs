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
  .select("id,vendor_name,proposal_type,proposal_data,created_at")
  .eq("proposal_type", "uploaded_pdf")
  .order("created_at", { ascending: false })
  .limit(10);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

for (const row of data ?? []) {
  const text = (row.proposal_data ?? "").toString();
  const preview = text.slice(0, 120).replace(/\s+/g, " ");
  console.log(
    JSON.stringify({
      id: row.id,
      vendor: row.vendor_name,
      created_at: row.created_at,
      text_len: text.length,
      preview,
    })
  );
}
