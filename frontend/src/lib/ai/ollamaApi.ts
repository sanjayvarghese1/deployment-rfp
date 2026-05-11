const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export const PREFERRED_MODELS = ["mistral", "llama3.2"] as const;

export type PreferredModel = (typeof PREFERRED_MODELS)[number];

let modelCache: { expiresAt: number; models: string[] } | null = null;

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  options?: {
    num_predict?: number;
    temperature?: number;
    top_p?: number;
    repeat_penalty?: number;
  };
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function getOllamaModels(): Promise<string[]> {
  const now = Date.now();
  if (modelCache && modelCache.expiresAt > now) {
    return modelCache.models;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    if (!response.ok) return [];
    const data = (await response.json()) as OllamaTagsResponse;
    const models = Array.from(
      new Set(
        (data.models ?? [])
          .map((item) => String(item.name || item.model || "").trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    modelCache = { expiresAt: now + 60_000, models };
    return models;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePreferredModel(preferred: readonly string[] = PREFERRED_MODELS): Promise<string | null> {
  const models = await getOllamaModels();
  for (const candidate of preferred) {
    const found = models.find((model) => model === candidate || model.startsWith(`${candidate}:`) || model.startsWith(`${candidate}-`));
    if (found) return found;
  }
  return null;
}

export async function isOllamaRunning(): Promise<boolean> {
  const models = await getOllamaModels();
  return models.length > 0;
}

export function makeTimeoutController(timeoutMs = DEFAULT_TIMEOUT_MS): AbortController {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller;
}

export async function callOllamaGenerate(request: OllamaGenerateRequest): Promise<string> {
  const controller = request.signal ? null : makeTimeoutController(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = request.signal ?? controller!.signal;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        stream: false,
        options: request.options ?? {
          num_predict: 1024,
          temperature: 0.3,
          top_p: 0.9,
          repeat_penalty: 1.1,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `Ollama request failed (${response.status})`);
    }

    const data = (await response.json()) as { response?: string };
    return data.response ?? "";
  } finally {
    if (controller) controller.abort();
  }
}

function stripCodeFences(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonSubstring(value: string): string | null {
  const text = stripCodeFences(value);
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const start = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  const endBrace = text.lastIndexOf("}");
  const endBracket = text.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function safeParseJson<T>(value: string, fallback: T): T {
  const directAttempts = [value, stripCodeFences(value), extractJsonSubstring(value)].filter(Boolean) as string[];
  for (const candidate of directAttempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // keep trying
    }
  }
  return fallback;
}

export function safeJsonObject<T extends Record<string, unknown>>(value: string, fallback: T): T {
  return safeParseJson<T>(value, fallback);
}
