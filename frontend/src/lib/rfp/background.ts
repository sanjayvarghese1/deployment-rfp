"use client";

import { apiUrl } from "@/lib/api";
import { createNotification } from "@/services/supabase";
import type { DecompositionData, PipelineProgress, PipelineResult, RfpInput } from "./config";

type GenerationStatus = "idle" | "running" | "complete" | "error";

export interface BackgroundGenerationSnapshot {
  jobId: string | null;
  status: GenerationStatus;
  progress: PipelineProgress | null;
  result: Omit<PipelineResult, "pdfBase64"> | null;
  pdfBase64: string | null;
  decomposition: DecompositionData | null;
  error: string | null;
  startedAt: number | null;
}

type Listener = (snapshot: BackgroundGenerationSnapshot) => void;

const STORAGE_KEY = "rfp:last-generation-snapshot";
const STALE_RUNNING_MS = 15 * 60 * 1000; // treat running jobs older than 15 minutes as stale

const emptySnapshot: BackgroundGenerationSnapshot = {
  jobId: null,
  status: "idle",
  progress: null,
  result: null,
  pdfBase64: null,
  decomposition: null,
  error: null,
  startedAt: null,
};

function normalizeStartedAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function coerceSnapshot(snapshot: BackgroundGenerationSnapshot): BackgroundGenerationSnapshot {
  return {
    ...snapshot,
    startedAt: normalizeStartedAt(snapshot.startedAt),
  };
}

function expireRunningSnapshot(
  snapshot: BackgroundGenerationSnapshot,
  hasActiveRunner: boolean,
): BackgroundGenerationSnapshot {
  const normalized = coerceSnapshot(snapshot);
  if (normalized.status !== "running") return normalized;

  const startedAt = normalized.startedAt;
  const staleByTime = startedAt !== null && Date.now() - startedAt > STALE_RUNNING_MS;
  // Treat only time-stale runs as expired. Do not immediately mark runs
  // without an active in-memory runner as errors — keep them in `running`
  // state so the UI can show background progress after navigation or reload
  // for up to `STALE_RUNNING_MS`.
  if (!staleByTime) return normalized;

  return {
    ...emptySnapshot,
    status: "error",
    error: "Previous generation session expired. Please start a new generation.",
  };
}

declare global {
  interface Window {
    __rfpBackgroundGeneration?: {
      snapshot: BackgroundGenerationSnapshot;
      listeners: Set<Listener>;
      runningPromise: Promise<void> | null;
    };
  }
}

function getStore() {
  if (typeof window === "undefined") return null;
  if (!window.__rfpBackgroundGeneration) {
    let persisted = emptySnapshot;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) persisted = coerceSnapshot(JSON.parse(raw) as BackgroundGenerationSnapshot);
    } catch {
      // ignore storage failures
    }

    persisted = expireRunningSnapshot(persisted, false);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // ignore storage failures
    }

    window.__rfpBackgroundGeneration = {
      snapshot: persisted,
      listeners: new Set<Listener>(),
      runningPromise: null,
    };
  }

  const store = window.__rfpBackgroundGeneration;
  const normalized = expireRunningSnapshot(store.snapshot, !!store.runningPromise);
  if (JSON.stringify(normalized) !== JSON.stringify(store.snapshot)) {
    store.snapshot = normalized;
    persistSnapshot(normalized);
  }

  return window.__rfpBackgroundGeneration;
}

function publish(next: BackgroundGenerationSnapshot) {
  const store = getStore();
  if (!store) return;
  store.snapshot = next;
  persistSnapshot(next);
  for (const listener of store.listeners) listener(next);
}

function persistSnapshot(snapshot: BackgroundGenerationSnapshot) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }
  } catch {
    // ignore storage failures
  }
}

async function notifyCompletion(input: RfpInput, snapshot: BackgroundGenerationSnapshot, userId: string) {
  if (typeof window === "undefined") return;

  try {
    await createNotification({
      user_id: userId,
      type: "rfp_generation_complete",
      read: false,
      title: `RFP Ready: ${input.project_title}`,
      message: `Your RFP for ${input.project_title} is ready. Open the results or edit it from the draft editor.`,
    });

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`RFP ready: ${input.project_title}`, {
        body: `Your RFP for ${input.organization_name} finished generating. Open the results or edit the draft now.`,
        tag: snapshot.jobId || undefined,
      });
    }
  } catch (error) {
    console.warn("Failed to create completion notification:", error);
  }
}

function mapJobStatus(status: string): GenerationStatus {
  if (status === "completed") return "complete";
  if (status === "failed") return "error";
  return "running";
}

export function getBackgroundGenerationSnapshot(): BackgroundGenerationSnapshot {
  const store = getStore();
  if (store) {
    const normalized = expireRunningSnapshot(store.snapshot, !!store.runningPromise);
    if (JSON.stringify(normalized) !== JSON.stringify(store.snapshot)) {
      store.snapshot = normalized;
      persistSnapshot(normalized);
    }
    return store.snapshot;
  }

  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BackgroundGenerationSnapshot;
  } catch {
    // ignore
  }

  return emptySnapshot;
}

export function resetBackgroundGeneration(): BackgroundGenerationSnapshot {
  const store = getStore();
  if (store) {
    store.runningPromise = null;
    store.snapshot = emptySnapshot;
    persistSnapshot(emptySnapshot);
    for (const listener of store.listeners) listener(emptySnapshot);
    return emptySnapshot;
  }

  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }

  return emptySnapshot;
}

export function subscribeBackgroundGeneration(listener: Listener): () => void {
  const store = getStore();
  if (!store) return () => undefined;
  const normalized = expireRunningSnapshot(store.snapshot, !!store.runningPromise);
  if (JSON.stringify(normalized) !== JSON.stringify(store.snapshot)) {
    store.snapshot = normalized;
    persistSnapshot(normalized);
  }
  store.listeners.add(listener);
  listener(store.snapshot);
  return () => {
    store.listeners.delete(listener);
  };
}

export async function startBackgroundRfpGeneration(
  input: RfpInput,
  userId: string,
  callbacks: {
    onProgress?: (progress: PipelineProgress) => void;
    onResult?: (result: Omit<PipelineResult, "pdfBase64">, pdfBase64: string, decomposition: DecompositionData) => void;
    onError?: (error: string) => void;
    onComplete?: () => void;
  } = {},
): Promise<string> {
  const store = getStore();
  if (!store) throw new Error("Background generation is only available in the browser.");

  if (store.runningPromise) return store.snapshot.jobId || "rfp-job";

  const jobId = `rfp-${Date.now()}`;
  const startedAt = Date.now();
  const runningSnapshot: BackgroundGenerationSnapshot = {
    jobId,
    status: "running",
    progress: null,
    result: null,
    pdfBase64: null,
    decomposition: null,
    error: null,
    startedAt,
  };

  publish(runningSnapshot);

  store.runningPromise = (async () => {
    try {
      const res = await fetch(apiUrl("/api/rfp/generate/background"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, fastMode: true }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "Unknown error");
        throw new Error(errText);
      }

      const data = (await res.json()) as { job_id: string };
      const backgroundJobId = data.job_id;
      publish({ ...runningSnapshot, jobId: backgroundJobId });

      while (true) {
        const pollRes = await fetch(apiUrl(`/api/rfp/generate/jobs/${backgroundJobId}`), {
          method: "GET",
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        });

        if (!pollRes.ok) {
          throw new Error(await pollRes.text().catch(() => "Failed to read generation job"));
        }

        const pollData = (await pollRes.json()) as { job?: any };
        const job = pollData.job;
        if (!job) {
          throw new Error("Generation job missing");
        }

        if (job.progress) {
          const progress = job.progress as PipelineProgress;
          callbacks.onProgress?.(progress);
          publish({ ...runningSnapshot, jobId: backgroundJobId, progress, status: mapJobStatus(job.status) });
        }

        if (job.status === "completed") {
          const result = job.result as Omit<PipelineResult, "pdfBase64">;
          const pdfBase64 = job.pdf_base64 as string;
          const decomposition = (job.decomposition || result?.decomposition) as DecompositionData;

          if (!result || !pdfBase64) {
            throw new Error("Generation finished without a result.");
          }

          const finalSnapshot: BackgroundGenerationSnapshot = {
            jobId: backgroundJobId,
            status: "complete",
            progress: null,
            result,
            pdfBase64,
            decomposition,
            error: null,
            startedAt,
          };

          persistSnapshot(finalSnapshot);
          publish(finalSnapshot);
          callbacks.onResult?.(result, pdfBase64, decomposition);
          await notifyCompletion(input, finalSnapshot, userId);
          callbacks.onComplete?.();
          return;
        }

        if (job.status === "failed") {
          throw new Error(job.error || "Generation failed");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 4000));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedSnapshot: BackgroundGenerationSnapshot = {
        jobId,
        status: "error",
        progress: null,
        result: null,
        pdfBase64: null,
        decomposition: null,
        error: message,
        startedAt,
      };
      persistSnapshot(failedSnapshot);
      publish(failedSnapshot);
      callbacks.onError?.(message);
      throw error;
    } finally {
      store.runningPromise = null;
    }
  })();

  return jobId;
}
