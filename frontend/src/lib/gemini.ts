/**
 * Compatibility wrapper retained for existing imports.
 * All calls are routed through OpenRouter via the shared chat client.
 */

import { openRouterChat, openRouterChatJSON } from "@/lib/openrouter";

export interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

/**
 * Call the Gemini generateContent API and return the text response.
 */
export async function geminiChat(opts: {
  systemInstruction?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const { messages, temperature = 0.5, maxOutputTokens = 4096, systemInstruction } = opts;

  const finalMessages = systemInstruction
    ? [{ role: "system" as const, content: systemInstruction }, ...messages]
    : messages;

  return openRouterChat({
    model: "minimax/minimax-m2.7",
    messages: finalMessages,
    temperature,
    max_tokens: maxOutputTokens,
  });
}

/**
 * Call Gemini and parse the response as JSON.
 * Strips markdown fences and attempts repair on malformed output.
 */
export async function geminiChatJSON<T = unknown>(opts: {
  systemInstruction?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<T> {
  const { messages, temperature = 0.5, maxOutputTokens = 4096, systemInstruction } = opts;
  const finalMessages = systemInstruction
    ? [{ role: "system" as const, content: systemInstruction }, ...messages]
    : messages;

  return openRouterChatJSON<T>({
    model: "minimax/minimax-m2.7",
    messages: finalMessages,
    temperature,
    max_tokens: maxOutputTokens,
  });
}

/**
 * Check whether the Gemini API key is configured.
 */
export function isGeminiAvailable(): boolean {
  return (process.env.OPENROUTER_API_KEY || "").length > 0;
}
