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
 * Pricing per 1K tokens (USD) from OpenRouter
 * Updated 2025-05-20
 * Source: https://openrouter.ai/models
 */
const MODEL_PRICING = {
  // Qwen Plus series (all variants)
  "qwen/qwen-plus-2025-2025-01-25": {
    input: 0.0004,
    output: 0.0012,
  },
  "qwen/qwen-plus-2025-01-25": {
    input: 0.0004,
    output: 0.0012,
  },
  "qwen/qwen-plus": {
    input: 0.0004,
    output: 0.0012,
  },

  // Qwen Turbo series (budget models)
  "qwen/qwen-turbo": {
    input: 0.0002,
    output: 0.0006,
  },

  // Qwen 3 Max (high performance)
  "qwen/qwen3-max": {
    input: 0.002,
    output: 0.006,
  },

  // Qwen 3 Vision models
  "qwen/qwen3-32b-vision": {
    input: 0.0008,
    output: 0.0024,
  },
  "qwen/qwen3-vision": {
    input: 0.001,
    output: 0.003,
  },

  // Qwen 32B
  "qwen/qwen-32b": {
    input: 0.0008,
    output: 0.0024,
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

interface CostBreakdown {
  input: number;
  output: number;
  total: number;
}

function estimateCost(model: string, usage: any): CostBreakdown {
  if (!usage) {
    return { input: 0, output: 0, total: 0 };
  }

  const pricing =
    MODEL_PRICING[model as keyof typeof MODEL_PRICING];

  if (!pricing) {
    console.warn(
      `[OpenRouter] No pricing found for model ${model}. Cost will show as 0. Please add pricing to MODEL_PRICING.`
    );
    return { input: 0, output: 0, total: 0 };
  }

  const prompt =
    usage.prompt_tokens || 0;

  const completion =
    usage.completion_tokens || 0;

  const inputCost = Number(
    ((prompt / 1000) * pricing.input).toFixed(6)
  );

  const outputCost = Number(
    ((completion / 1000) * pricing.output).toFixed(6)
  );

  const total = Number(
    (inputCost + outputCost).toFixed(6)
  );

  return { input: inputCost, output: outputCost, total };
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

        const costBreakdown =
          estimateCost(
            selectedModel,
            data.usage
          );

        const tokenUsage = {
          input: promptTokens,
          output: completionTokens,
        };

        finalize({
          model: selectedModel,
          modelParameters: {
            temperature,
            max_tokens,
          },

          output: {
            contentChars:
              content.length,
          },

          usage: {
            unit: "TOKENS",
            input: promptTokens,
            output: completionTokens,
            total: totalTokens,
            inputCost: costBreakdown.input,
            outputCost: costBreakdown.output,
            totalCost: costBreakdown.total,
          },

          usageDetails: {
            promptTokens,
            completionTokens,
            totalTokens,
          },

          costDetails: {
            input_cost: costBreakdown.input,
            output_cost: costBreakdown.output,
            total_cost: costBreakdown.total,
            currency: "USD",
          },

          metadata: {
            latencyMs:
              Date.now() -
              attemptStartedAt,
            modelUsed:
              selectedModel,
            estimatedCostUsd:
              costBreakdown.total,
            costBreakdown: {
              input: costBreakdown.input,
              output: costBreakdown.output,
            },
          },
        });

        return {
          content,
          usage: tokenUsage,
          cost:
            costBreakdown.total,
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
        inputTokens: result.usage?.input || 0,
        outputTokens: result.usage?.output || 0,
        totalTokens: (result.usage?.input || 0) + (result.usage?.output || 0),
        estimatedCostUsd: result.cost,
        costBreakdown: {
          input: result.cost !== 0 ? result.cost * 0.25 : 0, // approx split
          output: result.cost !== 0 ? result.cost * 0.75 : 0,
        },
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
        inputTokens: result.usage?.input || 0,
        outputTokens: result.usage?.output || 0,
        totalTokens: (result.usage?.input || 0) + (result.usage?.output || 0),
        estimatedCostUsd: result.cost,
        costBreakdown: {
          input: result.cost !== 0 ? result.cost * 0.25 : 0, // approx split
          output: result.cost !== 0 ? result.cost * 0.75 : 0,
        },
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