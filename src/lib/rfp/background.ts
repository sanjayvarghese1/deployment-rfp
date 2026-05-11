"use client";

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
      status: "unread",
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
      const res = await fetch("/api/rfp/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Unknown error");
        throw new Error(errText);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: Omit<PipelineResult, "pdfBase64"> | null = null;
      let pdfBase64: string | null = null;
      let decomposition: DecompositionData | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          const lines = evt.split("\n");
          let eventType = "";
          let dataStr = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            if (line.startsWith("data: ")) dataStr = line.slice(6);
          }

          if (!eventType || !dataStr) continue;

          const data = JSON.parse(dataStr);
          if (eventType === "progress") {
            callbacks.onProgress?.(data as PipelineProgress);
            publish({ ...runningSnapshot, progress: data as PipelineProgress, status: "running" });
          } else if (eventType === "result") {
            result = data as Omit<PipelineResult, "pdfBase64">;
          } else if (eventType === "pdf") {
            pdfBase64 = data.pdfBase64 as string;
          } else if (eventType === "subsystem_draft") {
            if (!decomposition) decomposition = { subsystems: {}, inferredRequirements: [], needsDecomposition: false, subsystemPdfs: [], subsystemDrafts: [] };
            decomposition.subsystemDrafts.push(data as DecompositionData["subsystemDrafts"][number]);
          } else if (eventType === "subsystem_pdf") {
            if (!decomposition) decomposition = { subsystems: {}, inferredRequirements: [], needsDecomposition: false, subsystemPdfs: [], subsystemDrafts: [] };
            decomposition.subsystemPdfs.push({ name: data.name, pdfBase64: data.pdfBase64 });
          } else if (eventType === "error") {
            throw new Error(data.message || "Generation failed");
          }
        }
      }

      if (!result || !pdfBase64) {
        throw new Error("Generation finished without a result.");
      }

      const finalDecomposition = decomposition || (result.decomposition as DecompositionData);
      const finalSnapshot: BackgroundGenerationSnapshot = {
        jobId,
        status: "complete",
        progress: null,
        result,
        pdfBase64,
        decomposition: finalDecomposition,
        error: null,
        startedAt,
      };

      persistSnapshot(finalSnapshot);
      publish(finalSnapshot);
      callbacks.onResult?.(result, pdfBase64, finalDecomposition);
      await notifyCompletion(input, finalSnapshot, userId);
      callbacks.onComplete?.();
      return;
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
