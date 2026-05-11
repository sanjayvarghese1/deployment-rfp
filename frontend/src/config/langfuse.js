import { Langfuse } from "langfuse";

const globalForLangfuse = globalThis;

const secretKey = process.env.LANGFUSE_SECRET_KEY;
const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const baseUrl = process.env.LANGFUSE_BASE_URL;
const langfuseConfigOk = Boolean(secretKey && publicKey && baseUrl);

console.log(
  "[Langfuse] Init check:",
  "secretKey present?",
  !!secretKey,
  "publicKey present?",
  !!publicKey,
  "baseUrl present?",
  !!baseUrl,
  "configOk?",
  langfuseConfigOk
);

export const langfuse =
  globalForLangfuse.__langfuse ??
  (langfuseConfigOk
    ? (() => {
        console.log("[Langfuse] Creating Langfuse client with baseUrl:", baseUrl);
        const client = new Langfuse({
          secretKey,
          publicKey,
          baseUrl,
        });
        console.log("[Langfuse] Client created successfully");
        return client;
      })()
    : (() => {
        console.warn(
          "[Langfuse] Langfuse config incomplete or invalid. Using mock client.",
          { secretKey: !!secretKey, publicKey: !!publicKey, baseUrl }
        );
        return {
          trace: () => ({
            span: () => ({ end: () => {} }),
            generation: () => ({ end: () => {} }),
            update: () => {},
          }),
          flushAsync: async () => {},
        };
      })());

if (process.env.NODE_ENV !== "production") {
  globalForLangfuse.__langfuse = langfuse;
}