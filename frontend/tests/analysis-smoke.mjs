import assert from "node:assert/strict";

const baseUrl = process.argv[2];

if (!baseUrl) {
  throw new Error("usage: node tests/analysis-smoke.mjs <base-url>");
}

const response = await fetch(new URL("/api/ai/analyze-proposal", baseUrl), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    mode: "score_single",
    contract_title: "Cloud Platform Modernization",
    contract_description: "Replace legacy deployment tooling with a modern CI/CD pipeline and improved observability.",
    contract_budget: "250000",
    contract_deadline: "2026-12-31",
    contract_certifications: "SOC2, ISO27001",
    vendor_name: "Acme Delivery Co",
    vendor_price: "240000",
    vendor_timeline: "12 weeks",
    vendor_experience: "Delivered similar CI/CD modernization projects for public sector teams.",
    proposal_data: "We propose a phased delivery with CI/CD automation, observability, and migration support. Our team has prior experience with security-compliant deployments and vendor onboarding.",
    mandatoryCriteria: {
      subsystems: {},
    },
  }),
});

assert.equal(response.status, 200, "/api/ai/analyze-proposal should return 200");

const payload = await response.json();
assert.ok(payload.analysis, "analysis payload should be present");
assert.equal(typeof payload.analysis.overall_score, "number", "overall_score should be numeric");
assert.ok(payload.rfp_extract && payload.rfp_extract.length > 50, "rfp_extract should be populated");
assert.ok(payload.vendor_extract && payload.vendor_extract.length > 50, "vendor_extract should be populated");
assert.ok(payload.analysis.analysis_summary || payload.analysis.independent_recommendation, "analysis should include a summary or recommendation");