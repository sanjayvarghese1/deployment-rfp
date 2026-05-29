import assert from "node:assert/strict";

const baseUrl = process.argv[2];

if (!baseUrl) {
  throw new Error("usage: node tests/routing-smoke.mjs <base-url>");
}

async function checkRoute(path, expectedStatus) {
  const response = await fetch(new URL(path, baseUrl), { redirect: "manual" });
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}`);
}

await checkRoute("/", 307);
await checkRoute("/companies", 200);
await checkRoute("/contracts", 200);
await checkRoute("/login", 200);
await checkRoute("/rfp/intake", 200);