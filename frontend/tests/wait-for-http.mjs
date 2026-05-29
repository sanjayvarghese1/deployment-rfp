import { setTimeout as delay } from "node:timers/promises";

async function waitForHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(1000);
  }

  throw new Error(`timed out waiting for ${url}: ${lastError?.message || lastError || "unknown error"}`);
}

const targetUrl = process.argv[2];

if (!targetUrl) {
  throw new Error("usage: node tests/wait-for-http.mjs <url>");
}

await waitForHttp(targetUrl);