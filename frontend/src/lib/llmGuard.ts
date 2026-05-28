import { openRouterChat, openRouterChatJSON } from "@/lib/openrouter";
import { langfuse } from "@/config/langfuse";
import { redactPII, fingerprint } from "@/lib/redact";

const ENABLE_GUARD = process.env.LLM_GUARD_ENABLE !== "false";

type ChatOpts = {
  model?: string;
  messages?: any[];
  temperature?: number;
  max_tokens?: number;
  response_format?: any;
};

export async function guardedOpenRouterChat(opts: ChatOpts): Promise<any> {
  const model = opts?.model;
  const messages = opts?.messages || [];

  const combinedText = messages.map((m: any) => String(m?.content || "")).join(" ");
  const reqHash = fingerprint(combinedText);
  const redactedSnippet = redactPII(combinedText).slice(0, 2000);

  if (!ENABLE_GUARD) {
    return openRouterChat(opts);
  }

  try {
    const result = await openRouterChat(opts);
    return result;
  } catch (error) {
    // Record an error event to Langfuse with redacted metadata and fingerprint.
    try {
      const trace = langfuse.trace({ name: "LLM Guard: Error", metadata: { model, reqHash } });
      const gen = trace.generation
        ? trace.generation({ name: "llm_error", model, input: { messageCount: messages.length } })
        : undefined;

      if (gen && gen.end) {
        gen.end({ statusMessage: redactPII(String(error)).slice(0, 1000) }, { metadata: { redactedSnippet } });
      }

      if (langfuse.flushAsync) await langfuse.flushAsync();
    } catch (e) {
      // Swallow Langfuse errors to avoid masking original error
      // eslint-disable-next-line no-console
      console.warn("LLM Guard: failed to write Langfuse trace", e);
    }

    throw error;
  }
}

export async function guardedOpenRouterChatJSON(opts: ChatOpts): Promise<any> {
  // Same guard behavior but calling the JSON helper
  const model = opts?.model;
  const messages = opts?.messages || [];
  const combinedText = messages.map((m: any) => String(m?.content || "")).join(" ");
  const reqHash = fingerprint(combinedText);
  const redactedSnippet = redactPII(combinedText).slice(0, 2000);

  if (!ENABLE_GUARD) {
    return openRouterChatJSON(opts);
  }

  try {
    const result = await openRouterChatJSON(opts);
    return result;
  } catch (error) {
    try {
      const trace = langfuse.trace({ name: "LLM Guard: Error", metadata: { model, reqHash } });
      const gen = trace.generation
        ? trace.generation({ name: "llm_error_json", model, input: { messageCount: messages.length } })
        : undefined;

      if (gen && gen.end) {
        gen.end({ statusMessage: redactPII(String(error)).slice(0, 1000) }, { metadata: { redactedSnippet } });
      }

      if (langfuse.flushAsync) await langfuse.flushAsync();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("LLM Guard: failed to write Langfuse trace", e);
    }

    throw error;
  }
}

export default { guardedOpenRouterChat, guardedOpenRouterChatJSON };
