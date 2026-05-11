import { Langfuse } from "langfuse";

let client: Langfuse | null | undefined;

export function getLangfuseClient(): Langfuse | null {
  if (client !== undefined) return client;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();

  if (!publicKey || !secretKey) {
    client = null;
    return client;
  }

  client = new Langfuse({
    publicKey,
    secretKey,
    ...(baseUrl ? { baseUrl } : {}),
  });

  return client;
}

export async function flushLangfuse(): Promise<void> {
  const instance = getLangfuseClient();
  if (!instance) return;
  await instance.flushAsync().catch(() => undefined);
}