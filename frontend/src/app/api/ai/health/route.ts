import { NextResponse } from "next/server";
import { getOllamaModels, resolvePreferredModel, isOllamaRunning } from "@/lib/ai/ollamaApi";

export const runtime = "nodejs";

export async function GET() {
  try {
    const running = await isOllamaRunning();
    const models = await getOllamaModels();
    const preferredModel = await resolvePreferredModel();

    if (!running) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ollama not running",
          hint: "Run: ollama serve",
          models: [],
          preferred_model: null,
        },
        { status: 503 },
      );
    }

    if (!preferredModel) {
      return NextResponse.json(
        {
          ok: false,
          error: "Preferred Ollama models unavailable",
          hint: "Pull mistral or llama3.2",
          models,
          preferred_model: null,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      models,
      preferred_model: preferredModel,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: message || "Health check failed",
        hint: "Run: ollama serve",
        models: [],
        preferred_model: null,
      },
      { status: 500 },
    );
  }
}
