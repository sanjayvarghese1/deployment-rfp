import assert from "node:assert/strict";

const baseUrl = process.argv[2];

if (!baseUrl) {
  throw new Error("usage: node tests/route-and-api-smoke.mjs <base-url>");
}

async function expectStatus(path, allowedStatuses, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: "manual",
    ...options,
  });

  assert.ok(
    allowedStatuses.includes(response.status),
    `${path} returned ${response.status}, expected one of ${allowedStatuses.join(", ")}`,
  );

  return response;
}

await expectStatus("/", [307, 308]);
await expectStatus("/companies", [200]);
await expectStatus("/contracts", [200]);
await expectStatus("/login", [200]);
await expectStatus("/signup", [200]);
await expectStatus("/rfp/intake", [200]);

const apiTestResponse = await expectStatus("/api/ai/test", [200], {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ smoke: true }),
});
const apiTestBody = await apiTestResponse.json();
assert.equal(apiTestBody.success, true);

const aiHealthResponse = await expectStatus("/api/ai/health", [200, 503]);
const aiHealthBody = await aiHealthResponse.json();
assert.ok(typeof aiHealthBody.ok === "boolean");

const langfuseResponse = await expectStatus("/api/debug/langfuse-health", [200]);
const langfuseBody = await langfuseResponse.json();
// Require real Langfuse keys and a successful trace; reject mock/fallbacks
assert.equal(langfuseBody.envVarsPresent.secretKey, true, "Langfuse secret key must be present");
assert.equal(langfuseBody.traceTest.success, true, "Langfuse trace must succeed (no mock)");

const generateValidationResponse = await expectStatus("/api/rfp/generate", [400], {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const generateValidationBody = await generateValidationResponse.json();
assert.ok(generateValidationBody.error);

const renderValidationResponse = await expectStatus("/api/rfp/render-pdf", [400], {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const renderValidationBody = await renderValidationResponse.json();
assert.ok(renderValidationBody.error);
