import { Langfuse } from "langfuse";

const globalForLangfuse = globalThis;

function isProbablyHtmlUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.pathname === "/" || url.pathname === "";
  } catch {
    return false;
  }
}

const secretKey = process.env.LANGFUSE_SECRET_KEY;
const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const baseUrl = process.env.LANGFUSE_BASE_URL;
const langfuseConfigOk = Boolean(secretKey && publicKey && baseUrl && !isProbablyHtmlUrl(baseUrl));

export const langfuse =
  globalForLangfuse.__langfuse ??
  (langfuseConfigOk
    ? new Langfuse({
        secretKey,
        publicKey,
        baseUrl,
      })
    : {
        trace: () => ({
          span: () => ({ end: () => {} }),
          generation: () => ({ end: () => {} }),
          update: () => {},
        }),
        flushAsync: async () => {},
      });

if (process.env.NODE_ENV !== "production") {
  globalForLangfuse.__langfuse = langfuse;
}