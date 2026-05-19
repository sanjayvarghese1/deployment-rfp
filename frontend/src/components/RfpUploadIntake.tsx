"use client";

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";

interface UploadProgress {
  stage: "idle" | "uploading" | "analyzing" | "done" | "error";
  progress: number;
  error?: string;
}

export default function RfpUploadIntake() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ stage: "idle", progress: 0 });
  const [dragActive, setDragActive] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");

  const progressWidthClass = uploadProgress.progress >= 100 ? "w-full" : uploadProgress.progress >= 65 ? "w-[65%]" : uploadProgress.progress >= 30 ? "w-[30%]" : "w-0";

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!file.type.includes("pdf")) {
        setUploadProgress({ stage: "error", progress: 0, error: "Please upload a PDF file" });
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        setUploadProgress({ stage: "error", progress: 0, error: "File too large (max 50MB)" });
        return;
      }

      try {
        setSelectedFileName(file.name);
        setUploadProgress({ stage: "uploading", progress: 30 });
        sessionStorage.removeItem("rfp-editor-draft");
        localStorage.removeItem("rfp-editor-draft");
        sessionStorage.setItem("rfp-uploaded-pdf-name", file.name);
        sessionStorage.removeItem("rfp-upload-analysis");

        // Convert PDF to base64 and store in session storage for later saving
        const fileReader = new FileReader();
        fileReader.onload = async (e) => {
          const base64String = (e.target?.result as string)?.split(",")[1] || "";
          sessionStorage.setItem(`rfp-uploaded-pdf:${file.name}`, base64String);
          console.log("Stored PDF as base64 in session storage");

          setUploadProgress({ stage: "analyzing", progress: 70 });

          const formData = new FormData();
          formData.append("file", file);

          const analysisResponse = await fetch(apiUrl("/api/rfp/upload-analyze"), {
            method: "POST",
            body: formData,
          });

          if (!analysisResponse.ok) {
            const errorData = await analysisResponse.json().catch(() => null);
            throw new Error(errorData?.error || "Analysis failed");
          }

          const analysisResult = await analysisResponse.json();
          sessionStorage.setItem("rfp-upload-analysis", JSON.stringify(analysisResult));
          setUploadProgress({ stage: "done", progress: 100 });
          router.push("/rfp/upload-review");
        };
        fileReader.readAsDataURL(file);
      } catch (error) {
        setUploadProgress({
          stage: "error",
          progress: 0,
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    },
    [router],
  );

  const handleDrag = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void handleFileUpload(files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      void handleFileUpload(files[0]);
    }
  };

  return (
    <div className="card mx-auto max-w-[800px] overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--card-border)] px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary)]">
          <svg width="18" height="18" fill="#EFECE3" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z" /></svg>
        </div>
        <div>
          <div className="text-[15px] font-semibold text-[var(--foreground)]">RFP Generator</div>
          <div className="text-xs text-[var(--muted)]">
            {uploadProgress.stage === "idle" && "Intake in progress"}
            {uploadProgress.stage === "uploading" && "Uploading..."}
            {uploadProgress.stage === "done" && "Complete"}
            {uploadProgress.stage === "error" && "Upload failed"}
          </div>
        </div>
      </div>

      <div className="px-5 pt-3">
        <div className="mb-3 grid grid-cols-4 gap-2">
          {[
            { label: "1. Intake", active: true },
            { label: "2. QA Review", active: false },
            { label: "3. Results", active: false },
            { label: "4. Mandatory Criteria", active: false },
          ].map((step) => (
            <div
              key={step.label}
              className={`rounded-full border border-[var(--card-border)] px-3 py-2 text-center text-xs font-semibold ${step.active ? "bg-[var(--primary)] text-[#EFECE3]" : "bg-[var(--surface)] text-[var(--foreground)]"}`}
            >
              {step.label}
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="grid gap-5">
          <div className="text-center">
            <div className="text-[20px] font-bold text-[var(--foreground)]">Upload Existing RFP</div>
            <div className="mt-1.5 text-sm text-[var(--muted)]">
              Use a PDF instead of the chatbot, then continue into the same QA analysis screen with score and suggestions.
            </div>
          </div>

              <label htmlFor="rfp-upload-file" className="block cursor-pointer">
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={`grid min-h-[220px] place-items-center rounded-[18px] border-2 border-dashed p-6 text-center transition-colors ${dragActive ? "border-[var(--primary)] bg-[rgba(51,65,85,0.04)]" : "border-[var(--card-border)] bg-[var(--surface)]"}`}
                >
                  <div className="max-w-[420px]">
                    <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--primary-light)]">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                    <div className="mb-1 text-lg font-bold text-[var(--foreground)]">{selectedFileName || "Drop your PDF here"}</div>
                    <div className="text-sm leading-6 text-[var(--muted)]">{selectedFileName ? "Replace the file or continue with this one." : "Click to browse or drag and drop a PDF. Maximum file size: 50MB."}</div>
                  </div>
                </div>
              </label>
              <input ref={fileInputRef} id="rfp-upload-file" type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />

              {uploadProgress.stage === "error" && uploadProgress.error && (
                <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-light)] p-4 text-sm text-[var(--danger)]">{uploadProgress.error}</div>
              )}

              {(uploadProgress.stage === "uploading" || uploadProgress.stage === "analyzing") && (
                <div className="rounded-[14px] border border-[var(--card-border)] bg-[var(--surface)] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <strong>{uploadProgress.stage === "uploading" ? "Uploading..." : "Analyzing..."}</strong>
                    <span className="text-[var(--muted)]">{uploadProgress.progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                    <div className={`h-full rounded-full bg-[var(--primary)] ${progressWidthClass}`} />
                  </div>
                </div>
              )}

              <div className="grid gap-2 text-sm text-[var(--muted)]">
                <div>Upload the PDF as the intake step.</div>
                <div>After upload, analysis runs automatically and the review screen opens when it is ready.</div>
                <div>The review screen also includes a save-without-changes action.</div>
              </div>
        </div>
      </div>
    </div>
  );
}

