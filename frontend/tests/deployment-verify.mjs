import assert from "node:assert/strict";

const frontendUrl = process.env.DEPLOYED_FRONTEND_URL;
const backendUrl = process.env.DEPLOYED_BACKEND_URL;

if (!frontendUrl && !backendUrl) {
  throw new Error("Set DEPLOYED_FRONTEND_URL and/or DEPLOYED_BACKEND_URL to run deployment verification.");
}

if (backendUrl) {
  const health = await fetch(new URL("/healthz", backendUrl));
  assert.equal(health.status, 200, "/healthz should return 200");
}

if (frontendUrl) {
  const routeChecks = [
    { path: "/", statuses: [307, 308] },
    { path: "/companies", statuses: [200] },
    { path: "/contracts", statuses: [200] },
    { path: "/login", statuses: [200] },
    { path: "/signup", statuses: [200] },
    { path: "/rfp/intake", statuses: [200] },
    { path: "/messages", statuses: [200, 307, 308] },
    { path: "/notifications", statuses: [200, 307, 308] },
    { path: "/profile", statuses: [200, 307, 308] },
  ];

  for (const route of routeChecks) {
    const response = await fetch(new URL(route.path, frontendUrl), { redirect: "manual" });
    assert.ok(
      route.statuses.includes(response.status),
      `${route.path} returned ${response.status}, expected one of ${route.statuses.join(", ")}`,
    );
  }

  const apiTestResponse = await fetch(new URL("/api/ai/test", frontendUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ smoke: true }),
  });
  assert.equal(apiTestResponse.status, 200, "/api/ai/test should return 200");
  const apiTestBody = await apiTestResponse.json();
  assert.equal(apiTestBody.success, true);

  const aiHealthResponse = await fetch(new URL("/api/ai/health", frontendUrl), { redirect: "manual" });
  assert.ok([200, 503].includes(aiHealthResponse.status), "/api/ai/health should return 200 or 503");
  const aiHealthBody = await aiHealthResponse.json();
  assert.ok(typeof aiHealthBody.ok === "boolean");

  const langfuseResponse = await fetch(new URL("/api/debug/langfuse-health", frontendUrl));
  assert.equal(langfuseResponse.status, 200, "/api/debug/langfuse-health should return 200");
  const langfuseBody = await langfuseResponse.json();
  assert.equal(langfuseBody.envVarsPresent.secretKey, true, "Langfuse secret key must be present");
  assert.equal(langfuseBody.traceTest.success, true, "Langfuse trace must succeed (no mock)");

  const generateValidationResponse = await fetch(new URL("/api/rfp/generate", frontendUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(generateValidationResponse.status, 400, "/api/rfp/generate should reject invalid payloads");

  const renderValidationResponse = await fetch(new URL("/api/rfp/render-pdf", frontendUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(renderValidationResponse.status, 400, "/api/rfp/render-pdf should reject invalid payloads");

  const renderResponse = await fetch(new URL("/api/rfp/render-pdf", frontendUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metadata: {
        organization_name: "ProcureNet QA",
        project_title: "Deployment Verification",
        category: "software",
        date: "2026-05-29",
      },
      sections: {
        executive_summary: "Verification of the deployed PDF render flow.",
        project_overview: "This is a smoke test for the hosted frontend.",
      },
      template: "software",
    }),
  });

  assert.equal(renderResponse.status, 200, "/api/rfp/render-pdf should return 200");
  const renderBody = await renderResponse.json();
  assert.ok(typeof renderBody.pdfBase64 === "string" && renderBody.pdfBase64.length > 1000, "pdfBase64 should be returned and reasonably large");
}