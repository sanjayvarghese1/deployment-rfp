/* ═══════════════════════════════════════════════════════════ */
/*   SSE Streaming API for RFP Generation Pipeline             */
/* ═══════════════════════════════════════════════════════════ */

import { NextRequest } from "next/server";
import { runGeneratePipeline } from "@/lib/rfp/generate";
import type { RfpInput } from "@/lib/rfp/config";

export const maxDuration = 300; // Vercel Hobby plan max: 300 seconds. Pro plan allows 900.

export async function POST(req: NextRequest) {
  const body: RfpInput = await req.json();

  console.log("📥 [GENERATE API RECEIVED]", {
    has_precomputedDecomposition: !!body.precomputedDecomposition,
    precomputed_subsystems: body.precomputedDecomposition?.subsystems ? Object.keys(body.precomputedDecomposition.subsystems) : "N/A",
    selected_subsystems: body.selectedSubsystems,
  });

  if (!body.project_title || !body.organization_name) {
    return new Response(
      JSON.stringify({ error: "project_title and organization_name are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await runGeneratePipeline(body, (progress) => {
          send("progress", progress);
        });

        // Send result without the large pdfBase64 first, then pdf separately
        const { pdfBase64, decomposition, ...rest } = result;

        // Strip pdfBase64 from subsystem pdfs for the result event (send separately)
        const decompMeta = {
          subsystems: decomposition.subsystems,
          inferredRequirements: decomposition.inferredRequirements,
          needsDecomposition: decomposition.needsDecomposition,
          subsystemDrafts: decomposition.subsystemDrafts,
        };
        send("result", { ...rest, decomposition: decompMeta });
        send("pdf", { pdfBase64 });

        // Send subsystem PDFs individually to avoid huge SSE payloads
        if (decomposition.needsDecomposition && decomposition.subsystemPdfs.length > 0) {
          for (const draft of decomposition.subsystemDrafts) {
            send("subsystem_draft", draft);
          }
          for (const sp of decomposition.subsystemPdfs) {
            send("subsystem_pdf", { name: sp.name, pdfBase64: sp.pdfBase64 });
          }
          send("subsystem_pdfs_done", { count: decomposition.subsystemPdfs.length });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("RFP pipeline error:", message);
        send("error", { message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
