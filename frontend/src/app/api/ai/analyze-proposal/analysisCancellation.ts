type AnalysisCancelStore = {
  cancelledJobs: Set<string>;
  activeControllers: Map<string, AbortController>;
};

const GLOBAL_KEY = "__deployment_rfp_analysis_cancel_store__";

function getStore(): AnalysisCancelStore {
  const globalObject = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: AnalysisCancelStore;
  };

  if (!globalObject[GLOBAL_KEY]) {
    globalObject[GLOBAL_KEY] = {
      cancelledJobs: new Set<string>(),
      activeControllers: new Map<string, AbortController>(),
    };
  }

  return globalObject[GLOBAL_KEY];
}

export function registerAnalysisController(jobId: string): AbortController {
  const store = getStore();
  const existing = store.activeControllers.get(jobId);
  console.log(`[CancelStore] registerAnalysisController for jobId=${jobId}, existing=${!!existing}`);
  if (existing) return existing;

  const controller = new AbortController();
  store.activeControllers.set(jobId, controller);
  return controller;
}

export function cancelAnalysisJob(jobId: string): boolean {
  if (!jobId) return false;

  const store = getStore();
  store.cancelledJobs.add(jobId);
  const controller = store.activeControllers.get(jobId);
  console.log(`[CancelStore] cancelAnalysisJob for jobId=${jobId}, foundController=${!!controller}`);
  if (controller) {
    controller.abort();
    store.activeControllers.delete(jobId);
  }

  return true;
}

export function isAnalysisJobCancelled(jobId?: string | null): boolean {
  const store = getStore();
  const isCancelled = Boolean(jobId && store.cancelledJobs.has(jobId));
  if (jobId) {
    console.log(`[CancelStore] isAnalysisJobCancelled for jobId=${jobId} -> ${isCancelled}. All cancelled:`, Array.from(store.cancelledJobs));
  }
  return isCancelled;
}

export function clearAnalysisJob(jobId?: string | null): void {
  if (!jobId) return;
  const store = getStore();
  store.activeControllers.delete(jobId);
  store.cancelledJobs.delete(jobId);
}
