import assert from "node:assert/strict";

const baseUrl = process.argv[2];

if (!baseUrl) {
  throw new Error("usage: node tests/pdf-render-smoke.mjs <base-url>");
}

const response = await fetch(new URL("/api/rfp/render-pdf", baseUrl), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    metadata: {
      organization_name: "ProcureNet QA",
      project_title: "Local PDF smoke test",
      category: "software",
      date: "2026-05-29",
    },
    sections: {
      executive_summary: "A minimal render test used by GitLab CI.",
      project_overview: "This confirms the PDF generation endpoint is working.",
    },
    template: "software",
  }),
});

assert.equal(response.status, 200, "/api/rfp/render-pdf should return 200");

const payload = await response.json();
// Require a reasonably-sized PDF to detect fallback/no-op generators
assert.ok(typeof payload.pdfBase64 === "string" && payload.pdfBase64.length > 1000, "pdfBase64 should be present and reasonably large");