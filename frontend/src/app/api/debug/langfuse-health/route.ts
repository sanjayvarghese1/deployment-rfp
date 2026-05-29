import { NextRequest, NextResponse } from "next/server";
import { langfuse } from "@/config/langfuse";

/**
 * DEBUG ENDPOINT: Test Langfuse connection and configuration
 * GET /api/debug/langfuse-health
 *
 * Returns:
 * - Langfuse configuration check
 * - Env var presence (without exposing secrets)
 * - Test trace creation
 */
export async function GET(req: NextRequest) {
  // Basic env check
  const hasSecretKey = !!process.env.LANGFUSE_SECRET_KEY;
  const hasPublicKey = !!process.env.LANGFUSE_PUBLIC_KEY;
  const hasBaseUrl = !!process.env.LANGFUSE_BASE_URL;
  const baseUrl = process.env.LANGFUSE_BASE_URL || "";

  console.log("[Debug] Langfuse health check requested");
  console.log("[Debug] Env vars present - secretKey:", hasSecretKey, "publicKey:", hasPublicKey, "baseUrl:", hasBaseUrl);

  // Try to create a test trace
  const testResults = {
    timestamp: new Date().toISOString(),
    envVarsPresent: {
      secretKey: hasSecretKey,
      publicKey: hasPublicKey,
      baseUrl: hasBaseUrl,
      baseUrlValue: baseUrl.substring(0, 50) + (baseUrl.length > 50 ? "..." : ""),
    },
    traceTest: {
      attempted: false,
      success: false,
      error: null as string | null,
      traceId: null as string | null,
    },
  };

  try {
    console.log("[Debug] Attempting to create test trace...");

    // Create a simple test trace
    const trace = langfuse.trace({
      name: "health-check",
      metadata: {
        purpose: "Debug health check",
        timestamp: new Date().toISOString(),
        testCost: 0.001234,
        testTokens: { prompt: 10, completion: 20, total: 30 },
      },
    });

    testResults.traceTest.attempted = true;
    testResults.traceTest.traceId = trace.id;

    console.log("[Debug] Test trace created with ID:", trace.id);

    // Try to flush
    console.log("[Debug] Flushing Langfuse client...");
    await langfuse.flushAsync();

    testResults.traceTest.success = true;
    console.log("[Debug] Langfuse flush successful");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    testResults.traceTest.error = errMsg;
    console.error("[Debug] Langfuse test failed:", errMsg);
  }

  // If env vars are missing, the SDK may use a mock client that appears to 'succeed'.
  // Treat missing critical config as a test failure so CI detects mock usage.
  if (!hasSecretKey || !hasPublicKey || !hasBaseUrl) {
    testResults.traceTest.success = false;
    testResults.traceTest.error = testResults.traceTest.error || "Missing Langfuse configuration (using mock client)";
    console.warn("[Debug] Langfuse config incomplete — marking traceTest.success = false");
  }

  console.log("[Debug] Health check complete", testResults);

  return NextResponse.json(testResults, { status: 200 });
}
