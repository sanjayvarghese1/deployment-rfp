#!/usr/bin/env node
/*
Local smoke test for RFP generation API.
- Checks presence of critical env vars.
- POSTs a minimal RFP request to the generate endpoint (default http://localhost:3000/api/rfp/generate).
- Streams the SSE response and fails if an `event: error` is observed, succeeds if `event: result` or `event: pdf` appears.

Usage:
  SMOKE_URL=http://localhost:3000/api/rfp/generate node frontend/tests/local-smoke.mjs

Exit codes:
 0 = success (no error event seen)
 1 = API responded with error status or emitted an error event
 2 = missing required env vars or network error
*/

const required = [
  "OPENROUTER_API_KEY",
  "PDFSHIFT_API_KEY",
  "LANGFUSE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing required env vars:", missing.join(", "));
  console.error("Set them in your environment or pass them into the process before running this test.");
  process.exit(2);
}

const url = process.env.SMOKE_URL || "http://localhost:3000/api/rfp/generate";

async function run() {
  console.log(`Posting minimal RFP to ${url} (timeout 30s)`);
  const payload = {
    project_title: "Smoke Test Project",
    organization_name: "Smoke Inc",
    category: "software",
    sections: { executive_summary: "auto" },
    fastMode: true,
  };

  let controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("API returned non-OK status:", res.status, await res.text());
      clearTimeout(timeout);
      process.exit(1);
    }

    if (!res.body) {
      console.error("No response body (not a stream). Treating as failure.");
      clearTimeout(timeout);
      process.exit(1);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let seenResult = false;
    let seenError = false;
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      process.stdout.write(chunk);
      accumulated += chunk;

      if (accumulated.includes("event: error")) {
        seenError = true;
        break;
      }
      if (accumulated.includes("event: result") || accumulated.includes("event: pdf")) {
        seenResult = true;
        break;
      }
      // keep last 10k chars to limit memory
      if (accumulated.length > 10000) accumulated = accumulated.slice(-10000);
    }

    clearTimeout(timeout);

    if (seenError) {
      console.error("Smoke test failed: stream emitted event: error");
      process.exit(1);
    }
    if (seenResult) {
      console.log("Smoke test success: stream emitted result/pdf event");
      process.exit(0);
    }

    console.error("Smoke test inconclusive: no result or error events seen in stream");
    process.exit(1);
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("Smoke test timed out (30s)");
      process.exit(1);
    }
    console.error("Network or unexpected error:", err);
    process.exit(2);
  }
}

run();
