"use client";

import React, { useEffect, useState } from "react";
import { getBackgroundAnalysisJob, AnalysisJobStatus } from "@/services/aiService";

interface AnalysisProgressModalProps {
  jobId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  onComplete: (result: AnalysisJobStatus) => void;
}

export default function AnalysisProgressModal({
  jobId,
  isOpen,
  onClose,
  onRetry,
  onComplete,
}: AnalysisProgressModalProps) {
  const [job, setJob] = useState<AnalysisJobStatus | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!isOpen || !jobId) return;

    setPolling(true);
    const pollInterval = setInterval(async () => {
      try {
        const result = await getBackgroundAnalysisJob(jobId);
        if (result) {
          setJob(result);

          if (result.status === "completed" || result.status === "failed") {
            setPolling(false);
            clearInterval(pollInterval);

            if (result.status === "completed") {
              setTimeout(() => onComplete(result), 1000);
            }
          }
        }
      } catch (err) {
        console.error("Failed to poll analysis job:", err);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [isOpen, jobId, onComplete]);

  if (!isOpen) return null;

  const isProcessing = job?.status === "running" || job?.status === "queued";
  const isCompleted = job?.status === "completed";
  const isFailed = job?.status === "failed";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {isProcessing && "Analysis in Progress"}
            {isCompleted && "Analysis Complete"}
            {isFailed && "Analysis Failed"}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-4">
          {/* Job ID */}
          <div className="text-xs text-gray-500">
            Job ID: <code className="font-mono">{jobId}</code>
          </div>

          {/* Progress */}
          {isProcessing && (
            <>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                <span className="text-sm text-gray-700">{job?.progress || "Processing..."}</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Status: <span className="capitalize font-semibold text-blue-600">{job?.status}</span>
              </div>
            </>
          )}

          {/* Completed */}
          {isCompleted && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm font-medium text-green-700">Analysis completed successfully!</span>
              </div>
              <p className="text-xs text-gray-600">
                {job?.result?.vendor_scores?.length || 0} vendor(s) analyzed
              </p>
            </div>
          )}

          {/* Failed */}
          {isFailed && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="text-sm font-medium text-red-700">Analysis failed</span>
              </div>
              <p className="text-xs text-gray-600 bg-red-50 p-2 rounded">
                {job?.error || "Unknown error"}
              </p>
              <p className="text-xs text-gray-500">Retry count: {retryCount}</p>
            </div>
          )}

          {/* Timeline */}
          {job?.created_at && (
            <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
              <div>Created: {new Date(job.created_at).toLocaleTimeString()}</div>
              {job?.updated_at && <div>Updated: {new Date(job.updated_at).toLocaleTimeString()}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex gap-2">
          {isProcessing && (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Close (keep running)
            </button>
          )}

          {isFailed && (
            <>
              <button
                onClick={onRetry}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry Analysis
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          {isCompleted && (
            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
