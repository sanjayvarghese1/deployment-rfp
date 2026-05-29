import assert from "node:assert/strict";

const baseUrl = process.argv[2];

if (!baseUrl) {
  throw new Error("usage: node tests/rfp-generate-smoke.mjs <base-url>");
}

const response = await fetch(new URL("/api/rfp/generate", baseUrl), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    organization_name: "ProcureNet QA",
    project_title: "CI RFP Generation Smoke Test",
    category: "software",
    detailed_project_description: "Validate the RFP generation pipeline and ensure the SSE stream emits a final PDF.",
    sections: {
      executive_summary: "This is a smoke test RFP to validate generation.",
      project_overview: "The test ensures the generation pipeline returns structured output.",
      scope_of_work: "Deliver a working smoke test across the full generation flow.",
      technical_requirements: "Must produce a non-empty PDF and result payload.",
    },
    selected_template: "software",
    skipDecomposition: true,
    fastMode: true,
  }),
});

assert.equal(response.status, 200, "/api/rfp/generate should return 200");
assert.match(response.headers.get("content-type") || "", /text\/event-stream/i, "generation endpoint should stream SSE");

const raw = await response.text();
assert.ok(raw.includes("event: result"), "generation stream should include a result event");
assert.ok(raw.includes("event: pdf"), "generation stream should include a pdf event");
assert.ok(!raw.includes("event: error"), "generation stream should not emit an error event");

const pdfMatch = raw.match(/event: pdf\s+data: (\{.*?\})\s*(?:\n\n|$)/s);
assert.ok(pdfMatch, "pdf event payload should be present");
const pdfPayload = JSON.parse(pdfMatch[1]);
assert.ok(typeof pdfPayload.pdfBase64 === "string" && pdfPayload.pdfBase64.length > 1000, "generated pdf should be present and non-trivial");