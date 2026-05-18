/**
 * OpenRouter LLM client using OpenAI-compatible chat completions API.
 * Full JavaScript version with:
 * - Langfuse tracing
 * - Token usage tracking
 * - Cost estimation
 * - JSON helper
 * - Fallback model support
 */

import { langfuse } from "@/config/langfuse";

export type OpenRouterModel = string;

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || "";

const OPENROUTER_PRIMARY_MODEL =
  process.env.OPENROUTER_PRIMARY_MODEL ||
  "qwen/qwen-plus-2025-2025-01-25";

const OPENROUTER_INTAKE_MODEL =
  process.env.OPENROUTER_INTAKE_MODEL ||
  "qwen/qwen-turbo";

const OPENROUTER_FALLBACK_MODEL =
  process.env.OPENROUTER_FALLBACK_MODEL ||
  "qwen/qwen-plus-2025-2025-01-25";

const OPENROUTER_ANALYSIS_MODEL =
  process.env.OPENROUTER_ANALYSIS_MODEL ||
  OPENROUTER_PRIMARY_MODEL;

/**
 * Example pricing per 1K tokens (USD)
 * Update later using OpenRouter pricing page.
 */
const MODEL_PRICING = {
  "qwen/qwen-plus-2025-2025-01-25": {
    input: 0.0004,
    output: 0.0012,
  },
  "qwen/qwen-turbo": {
    input: 0.0002,
    output: 0.0006,
  },
};

export const MODEL = {
  PRIMARY: OPENROUTER_PRIMARY_MODEL,
  FALLBACK: OPENROUTER_FALLBACK_MODEL,
};

export const AGENT_MODEL = {
  DOCUMENT_ANALYSIS: OPENROUTER_ANALYSIS_MODEL,
  REQUIREMENT_EXTRACTION: MODEL.PRIMARY,
  INTAKE_EXTRACTION: OPENROUTER_INTAKE_MODEL,
  TEMPLATE_SELECTION: MODEL.PRIMARY,
  TEMPLATE_FORMATTING: MODEL.PRIMARY,
  RFP_WRITING: OPENROUTER_ANALYSIS_MODEL,
  QUALITY_ASSURANCE: OPENROUTER_ANALYSIS_MODEL,
};

/* ===================================================
   HELPERS
=================================================== */

function parseProviderErrorText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || raw;
  } catch {
    return raw;
  }
}

function mapProviderError(status: number, raw: string): string {
  const detail = parseProviderErrorText(raw);

  if (status === 401 || status === 403) {
    return `Unauthorized (${status}): ${detail}`;
  }

  if (status === 429) {
    return `Rate limit exceeded (${status}): ${detail}`;
  }

  return `OpenRouter error (${status}): ${detail}`;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function summarizeMessages(messages: any[]): any {
  return {
    count: messages.length,
    totalChars: messages.reduce(
      (sum: number, m: any) => sum + m.content.length,
      0
    ),
    roles: messages.map((m: any) => m.role),
  };
}

function summarizeUsage(usage: any): any {
  if (!usage) return null;

  return {
    promptTokens:
      usage.prompt_tokens || 0,
    completionTokens:
      usage.completion_tokens || 0,
    totalTokens:
      usage.total_tokens || 0,
  };
}

function estimateCost(model: string, usage: any): number {
  if (!usage) return 0;

  const pricing =
    MODEL_PRICING[model as keyof typeof MODEL_PRICING];

  if (!pricing) return 0;

  const prompt =
    usage.prompt_tokens || 0;

  const completion =
    usage.completion_tokens || 0;

  const total =
    (prompt / 1000) *
      pricing.input +
    (completion / 1000) *
      pricing.output;

  return Number(
    total.toFixed(6)
  );
}

/* ===================================================
   OPENROUTER REQUEST
=================================================== */

async function callOpenRouter(
  payload: any,
  timeoutMs: number
): Promise<Response> {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY missing (check .env and restart server)");
    }

    try {
      return await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Network request to OpenRouter failed: ${msg}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ===================================================
   MAIN CHAT
=================================================== */

export async function openRouterChat(
  opts: any
): Promise<string> {
  const {
    model,
    messages,
    temperature = 0.5,
    max_tokens = 2048,
    response_format,
  } = opts;

  if (
    !OPENROUTER_API_KEY
  ) {
    throw new Error(
      "OPENROUTER_API_KEY missing"
    );
  }

  const primaryModel =
    model ||
    OPENROUTER_PRIMARY_MODEL;

  const fallbackModel =
    OPENROUTER_FALLBACK_MODEL;

  const normalizedMessages =
    messages.some(
      (m: any) =>
        m.role === "system"
    )
      ? messages
      : [
          {
            role: "system",
            content:
              "You are an expert RFP analysis assistant.",
          },
          ...messages,
        ];

  const timeoutMs =
    Math.min(
      5400000,
      Math.max(
        180000,
        max_tokens * 60
      )
    );

  const requestStartedAt =
    Date.now();

  console.log(`[OpenRouter] openRouterChat request started for model ${primaryModel}`);

  const trace =
    langfuse.trace({
      name: "OpenRouter Call",
      metadata: {
        modelRequested:
          primaryModel,
        fallbackModel,
        messageSummary:
          summarizeMessages(
            normalizedMessages
          ),
      },
    });

  const requestPayload =
    (selectedModel: string) => ({
      model:
        selectedModel,
      messages:
        normalizedMessages,
      temperature,
      max_tokens,
      ...(response_format ? { response_format } : {}),
    });

  const runAttempt =
    async (
      selectedModel: string,
      attemptName: string
    ) => {
      const attemptStartedAt =
        Date.now();

      console.log(`[OpenRouter] attempt ${attemptName} starting for model ${selectedModel}`);

      const generation =
        trace.generation({
          name:
            attemptName,
          model:
            selectedModel,
          input:
            summarizeMessages(
              normalizedMessages
            ),
        });

      let finalized =
        false;

      const finalize = (
        body: any
      ) => {
        if (finalized)
          return;

        finalized = true;
        generation.end(
          body
        );
      };

      try {
        const response =
          await callOpenRouter(
            requestPayload(
              selectedModel
            ),
            timeoutMs
          );

        if (
          !response.ok
        ) {
          const raw =
            await response.text();

          throw new Error(
            mapProviderError(
              response.status,
              raw
            )
          );
        }

        const data =
          await response.json();

        const content =
          data
            ?.choices?.[0]
            ?.message?.content
            ?.trim() ||
          "";

        if (
          !content
        ) {
          throw new Error(
            "Empty model response"
          );
        }

        const promptTokens =
          data?.usage
            ?.prompt_tokens ||
          0;

        const completionTokens =
          data?.usage
            ?.completion_tokens ||
          0;

        const totalTokens =
          data?.usage
            ?.total_tokens ||
          promptTokens +
            completionTokens;

        const estimatedCost =
          estimateCost(
            selectedModel,
            data.usage
          );

        const tokenUsage = {
          promptTokens,
          completionTokens,
          totalTokens,
        };

        finalize({
          output: {
            contentChars:
              content.length,
          },

          metadata: {
            latencyMs:
              Date.now() -
              attemptStartedAt,
            modelUsed:
              selectedModel,
            estimatedCostUsd:
              estimatedCost,
          },

          usage: tokenUsage,

          costDetails: {
            total:
              estimatedCost,
          },
        });

        return {
          content,
          usage: tokenUsage,
          cost:
            estimatedCost,
        };
      } catch (error) {
        finalize({
          level: "ERROR",
          statusMessage:
            sanitizeError(
              error
            ),
          metadata: {
            modelUsed:
              selectedModel,
            latencyMs:
              Date.now() -
              attemptStartedAt,
          },
        });

        throw error;
      }
    };

  try {
    const result =
      await runAttempt(
        primaryModel,
        "Primary Model Attempt"
      );

    trace.update({
      metadata: {
        modelUsed:
          primaryModel,
        tokenUsage: result.usage,
        promptTokens: result.usage?.promptTokens || 0,
        completionTokens: result.usage?.completionTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
        estimatedCostUsd: result.cost,
        latencyMs:
          Date.now() -
          requestStartedAt,
      },
    });

    console.log(`[OpenRouter] primary result tokens=${JSON.stringify(result.usage)} cost=${String(result.cost)}`);

    console.log(`[OpenRouter] Flushing trace to Langfuse...`);
    await langfuse.flushAsync();
    console.log(`[OpenRouter] Trace flushed successfully to Langfuse`);

    return result.content;
  } catch {
    const result =
      await runAttempt(
        fallbackModel,
        "Fallback Model Attempt"
      );

    trace.update({
      metadata: {
        modelUsed:
          fallbackModel,
        tokenUsage: result.usage,
        promptTokens: result.usage?.promptTokens || 0,
        completionTokens: result.usage?.completionTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
        estimatedCostUsd: result.cost,
        latencyMs:
          Date.now() -
          requestStartedAt,
      },
    });

    console.log(`[OpenRouter] fallback result tokens=${JSON.stringify(result.usage)} cost=${String(result.cost)}`);

    console.log(`[OpenRouter] Flushing fallback trace to Langfuse...`);
    await langfuse.flushAsync();
    console.log(`[OpenRouter] Fallback trace flushed successfully to Langfuse`);

    return result.content;
  }
}

/* ===================================================
   JSON HELPER
=================================================== */

function repairAndParseJSON(
  raw: string
): any {
  let cleaned = raw
    .replace(
      /```json\n?/g,
      ""
    )
    .replace(
      /```\n?/g,
      ""
    )
    .trim();

  const extractBalancedJSON = (text: string) => {
    const candidates = ["{", "["];

    for (const opener of candidates) {
      const startIndex = text.indexOf(opener);
      if (startIndex < 0) continue;

      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let i = startIndex; i < text.length; i += 1) {
        const char = text[i];

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
          continue;
        }

        if (char === '"') {
          inString = true;
          continue;
        }

        if (char === opener) {
          depth += 1;
        } else if ((opener === "{" && char === "}") || (opener === "[" && char === "]")) {
          depth -= 1;
          if (depth === 0) {
            return text.slice(startIndex, i + 1);
          }
        }
      }
    }

    return null;
  };

  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const extracted = extractBalancedJSON(cleaned);
    if (extracted) cleaned = extracted;
  }

  try {
    return JSON.parse(
      cleaned
    );
  } catch {
    return null;
  }
}

export async function openRouterChatJSON<T = any>(
  opts: any
): Promise<T> {
  const raw =
    await openRouterChat(
      opts
    );

  const parsed =
    repairAndParseJSON(
      raw
    );

  if (parsed !== null)
    return parsed;

  const repairRaw =
    await openRouterChat({
      ...opts,
      messages: [
        {
          role: "system",
          content:
            "You are a JSON repair tool. Return only valid JSON with no markdown, no prose, and no code fences.",
        },
        {
          role: "user",
          content:
            `Convert the following model output into valid JSON only, preserving the original meaning exactly when possible. Output only the JSON object or array.\n\nRAW OUTPUT:\n${raw}`,
        },
      ],
      temperature: 0,
      max_tokens: Math.max(512, opts?.max_tokens || 2048),
    });

  const repairedParsed =
    repairAndParseJSON(
      repairRaw
    );

  if (repairedParsed !== null)
    return repairedParsed;

  throw new Error(
    `Failed to parse JSON response: ${raw.substring(
      0,
      500
    )}`
  );
}