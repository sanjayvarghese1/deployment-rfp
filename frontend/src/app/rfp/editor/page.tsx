"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SECTION_LABELS, type PdfTemplate } from "@/lib/rfp/config";
import { apiUrl } from "@/lib/api";

interface EditorDraft {
  metadata: { organization_name: string; project_title: string; category: string; date: string };
  sections: Record<string, string>;
  sectionLabels: Record<string, string>;
  template: PdfTemplate;
  pdfBase64: string;
  sourcePdfBase64?: string;
  decomposition?: any;
  returnTo?: string;
  subsystemName?: string;
  updatedAt?: string;
  uploadedFrom?: "pdf";
  uploadedFileName?: string;
  suggestionsApplied?: string[];
}

const STORAGE_KEY = "rfp-editor-draft";
const EDITOR_SYNC_EVENT = "rfp-editor-draft-updated";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function usePdfObjectUrl(base64: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!base64) {
      setUrl(null);
      return;
    }

    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);

    return () => URL.revokeObjectURL(nextUrl);
  }, [base64]);

  return url;
}

async function fetchRenderedPdfBase64(draft: EditorDraft): Promise<string> {
  const response = await fetch(apiUrl("/api/rfp/render-pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metadata: draft.metadata,
      sections: draft.sections,
      template: draft.template,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.pdfBase64) {
    throw new Error(data?.error || "Failed to render PDF");
  }

  return data.pdfBase64 as string;
}

export default function RfpEditorPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<"edited" | "original">("edited");
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [livePdfBase64, setLivePdfBase64] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [pagesCollapsed, setPagesCollapsed] = useState(false);
  const [uploadMode, setUploadMode] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const previewRunRef = useRef(0);

  const generateCurrentPdfBase64 = useCallback(async (sourceDraft: EditorDraft) => {
    return fetchRenderedPdfBase64(sourceDraft);
  }, []);

  useEffect(() => {
    try {
      // Try loading from sessionStorage first (upload flow)
      const sessionDraft = sessionStorage.getItem("rfp-editor-draft");
      if (sessionDraft) {
        const parsed = JSON.parse(sessionDraft) as EditorDraft;
        setDraft({
          ...parsed,
          pdfBase64: parsed.pdfBase64 || "",
          sourcePdfBase64: parsed.sourcePdfBase64 || parsed.pdfBase64 || "",
        });
        setUploadMode(!!parsed.uploadedFrom);
        setSuggestions(parsed.suggestionsApplied || []);
        // Keep in sessionStorage but don't remove yet
        return;
      }

      // Fall back to localStorage (regular flow)
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as EditorDraft;
        setDraft({
          ...parsed,
          pdfBase64: parsed.pdfBase64 || "",
          sourcePdfBase64: parsed.sourcePdfBase64 || parsed.pdfBase64 || "",
        });
      }
    } catch {
      setDraft(null);
    }
  }, []);

  useEffect(() => {
    if (!draft) return;
    const firstSection = Object.keys(draft.sections)[0] || null;
    setSelectedSection((current) => current || firstSection);
  }, [draft]);

  const sectionEntries = useMemo(() => Object.entries(draft?.sections || {}), [draft]);
  const previewBase64 = viewerMode === "original" ? draft?.sourcePdfBase64 || draft?.pdfBase64 : livePdfBase64 || draft?.pdfBase64;
  const previewUrl = usePdfObjectUrl(previewBase64);
  const gridTemplateColumns = pagesCollapsed
    ? "56px minmax(0, 1fr) 840px"
    : "260px minmax(0, 1fr) 840px";

  const updateSection = (key: string, value: string) => {
    setDraft((current) => (current ? { ...current, sections: { ...current.sections, [key]: value } } : current));
  };

  const focusSection = (key: string) => {
    setSelectedSection(key);
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!draft) return;

    let cancelled = false;
    const runId = ++previewRunRef.current;
    setPreviewBusy(true);

    const handle = window.setTimeout(async () => {
      try {
        const generatedBase64 = await generateCurrentPdfBase64(draft);
        if (cancelled || previewRunRef.current !== runId) return;
        setLivePdfBase64(generatedBase64);
        setDraft((current) => (current ? { ...current, pdfBase64: generatedBase64 } : current));
      } catch {
        if (cancelled || previewRunRef.current !== runId) return;
        setLivePdfBase64(draft.pdfBase64);
      } finally {
        if (!cancelled && previewRunRef.current === runId) {
          setPreviewBusy(false);
        }
      }
    }, 550);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [draft?.metadata.organization_name, draft?.metadata.project_title, draft?.metadata.category, draft?.metadata.date, draft?.template, draft?.sections, generateCurrentPdfBase64]);

  const saveAndGoBack = async () => {
    if (!draft) return;

    setSaving(true);
    setMessage(null);

    try {
      const pdfBase64 = previewBusy ? await generateCurrentPdfBase64(draft) : (livePdfBase64 || draft.pdfBase64);
      if (!pdfBase64) throw new Error("Failed to generate the PDF.");
      const nextDraft = {
        ...draft,
        pdfBase64,
        sourcePdfBase64: draft.sourcePdfBase64 || draft.pdfBase64,
        updatedAt: new Date().toISOString(),
      };
      // If editing a subsystem, ensure decomposition.subsystemPdfs contains the updated PDF
      if (draft.subsystemName) {
        try {
          const dec = (nextDraft as any).decomposition ? { ...(nextDraft as any).decomposition } : { subsystems: {}, inferredRequirements: [], needsDecomposition: true, subsystemPdfs: [], subsystemDrafts: [] } as any;
          const updatedEntry = {
            name: draft.subsystemName,
            pdfBase64,
            metadata: nextDraft.metadata,
            sections: nextDraft.sections,
            sectionLabels: nextDraft.sectionLabels,
            template: nextDraft.template,
            updatedAt: nextDraft.updatedAt,
          };
          dec.subsystemPdfs = (dec.subsystemPdfs || []).filter((s: any) => s.name !== draft.subsystemName).concat([updatedEntry]);
          // also update subsystemDrafts if present
          dec.subsystemDrafts = (dec.subsystemDrafts || []).map((d: any) => (d.name === draft.subsystemName ? { ...d, pdfBase64 } : d));
          (nextDraft as any).decomposition = dec;
        } catch {
          // ignore decomposition update errors
        }
      }
      
      // Store draft WITHOUT large pdfBase64 to avoid localStorage quota exceeded
      // (pdfBase64 will be sent via event to chatbot but not persisted)
      const draftForStorage: Partial<EditorDraft> = {
        metadata: nextDraft.metadata,
        sections: nextDraft.sections,
        sectionLabels: nextDraft.sectionLabels,
        template: nextDraft.template,
        decomposition: nextDraft.decomposition,
        subsystemName: nextDraft.subsystemName,
        updatedAt: nextDraft.updatedAt,
        // Note: pdfBase64 excluded to save storage quota
      };
      
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draftForStorage));
      // also persist per-target draft so edits are restored when reopening that specific file
      try {
        const key = `${STORAGE_KEY}:${nextDraft.subsystemName || "full"}`;
        window.localStorage.setItem(key, JSON.stringify(draftForStorage));
      } catch {}
      
      setDraft(nextDraft);
      
      // Send full draft WITH pdfBase64 via event to chatbot (won't be stored, just used for display)
      window.dispatchEvent(new CustomEvent(EDITOR_SYNC_EVENT, { detail: nextDraft }));
      setMessage("Updated PDF saved successfully.");
      
      // Handle upload flow - clean up sessionStorage
      if (uploadMode) {
        let destination = nextDraft.returnTo || (nextDraft as any).returnTo || "/rfp/upload-review";
        if (typeof destination === "string") {
          const lower = destination.toLowerCase();
          if (lower.includes("mandatory") || lower.includes("criteria") || lower.includes("targets")) {
            destination = "/postrfp";
          }
        }
        try {
          window.sessionStorage.setItem("rfp-editor-draft", JSON.stringify(nextDraft));
        } catch {}
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            metadata: nextDraft.metadata,
            sections: nextDraft.sections,
            sectionLabels: nextDraft.sectionLabels,
            template: nextDraft.template,
            decomposition: nextDraft.decomposition,
            subsystemName: nextDraft.subsystemName,
            updatedAt: nextDraft.updatedAt,
            sourcePdfBase64: nextDraft.sourcePdfBase64,
            uploadedFrom: nextDraft.uploadedFrom,
            uploadedFileName: nextDraft.uploadedFileName,
            suggestionsApplied: nextDraft.suggestionsApplied,
            returnTo: destination,
          }));
        } catch {}
        // Prefer going back in history if available so user returns to exact previous view
        if (typeof window !== "undefined" && window.history && window.history.length > 1) {
          setTimeout(() => router.back(), 150);
          return;
        }
        setTimeout(() => router.push(destination), 250);
      } else {
        try {
          // Prefer history back first
          if (typeof window !== "undefined" && window.history && window.history.length > 1) {
            router.back();
            return;
          }

          let dest = nextDraft.returnTo || (nextDraft as any).returnTo;
          if (typeof dest === "string") {
            const lower = dest.toLowerCase();
            if (lower.includes("mandatory") || lower.includes("criteria") || lower.includes("targets")) {
              dest = "/postrfp";
            }
          }
          if (dest) {
            router.push(dest);
          } else {
            router.push("/insights");
          }
        } catch {
          router.push("/insights");
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(text || "Failed to regenerate the PDF.");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async () => {
    if (!draft) return;

    const pdfBase64 = previewBusy ? await generateCurrentPdfBase64(draft) : (livePdfBase64 || draft.pdfBase64);
    if (!pdfBase64) return;

    setDraft((current) => (current ? { ...current, pdfBase64 } : current));

    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.metadata.project_title || "RFP"}${draft.subsystemName ? `-${draft.subsystemName.replace(/\s+/g, "-").toLowerCase()}` : ""}-edited.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#EFECE3" }}>
        <div className="card w-full max-w-xl p-8 text-center">
          <h1 className="text-2xl font-bold mb-3" style={{ color: "#000000" }}>No draft loaded</h1>
          <p className="mb-6" style={{ color: "#444444" }}>
            Open a generated RFP from the results screen to edit it here.
          </p>
          <button className="btn-primary" onClick={() => router.push("/contracts")}>Go to Contracts</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden" style={{ background: "#EFECE3" }}>
      <div className="max-w-[1720px] mx-auto px-6 py-8 h-full flex flex-col min-h-0">
        <div className="flex items-start justify-between gap-4 mb-6 mx-auto w-full">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#000000" }}>Edit RFP PDF</h1>
            <p className="mt-1" style={{ color: "#444444" }}>
              {draft.subsystemName
                ? `Editing subsystem RFP: ${draft.subsystemName}. Save to regenerate this subsystem PDF.`
                : "Edit each section as a document page, then save to regenerate the PDF."}
            </p>
          </div>
            <div className="flex gap-2 flex-wrap justify-end">
            <button className="btn-outline" onClick={() => {
              try {
                // Prefer going back in browser history so user returns to the exact previous page
                if (typeof window !== "undefined" && window.history && window.history.length > 1) {
                  router.back();
                  return;
                }

                const sessionRaw = window.sessionStorage.getItem(STORAGE_KEY) || window.sessionStorage.getItem("rfp-editor-draft");
                const raw = sessionRaw || window.localStorage.getItem(STORAGE_KEY);
                if (raw) {
                  const parsed = JSON.parse(raw) as EditorDraft;
                  let dest = parsed.returnTo ?? null;
                  // Normalize known undesired return targets (mandatory/criteria) to the Phase 3 results page
                  if (typeof dest === "string") {
                    const lower = dest.toLowerCase();
                    if (lower.includes("mandatory") || lower.includes("criteria") || lower.includes("targets")) {
                      dest = "/postrfp";
                    }
                  }
                  if (dest) {
                    router.push(dest);
                    return;
                  }
                }
              } catch {}
              router.back();
            }}>Back</button>
            <button className="btn-outline" onClick={downloadPdf} disabled={!draft.pdfBase64}>Download Edited PDF</button>
            <button className="btn-primary" onClick={saveAndGoBack} disabled={saving}>
              {saving ? "Saving..." : "Save and Go Back"}
            </button>
          </div>
        </div>

        {message && (
          <div className="mb-6 rounded-xl border px-4 py-3" style={{ background: "#E5E2D8", borderColor: "#D4D1C8", color: "#000000" }}>
            {message}
          </div>
        )}

        <div className="grid gap-6 items-start flex-1 min-h-0 overflow-hidden mx-auto w-full justify-items-center xl:justify-items-stretch" style={{ gridTemplateColumns }}>
          <aside className="card self-start xl:sticky xl:top-0 h-full overflow-hidden flex flex-col w-full transition-all duration-300 ease-in-out relative" style={{ width: pagesCollapsed ? 56 : 260, padding: pagesCollapsed ? 10 : 16 }}>
            <button
              type="button"
              onClick={() => setPagesCollapsed((current) => !current)}
              aria-label={pagesCollapsed ? "Expand pages panel" : "Collapse pages panel"}
              className="absolute top-1/2 right-2 z-10 h-8 w-8 rounded-full border shadow-sm flex items-center justify-center transition-all"
              style={{
                transform: "translateY(-50%)",
                background: "#FFFFFF",
                borderColor: "#D4D1C8",
                color: "#000000",
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={pagesCollapsed ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"} />
              </svg>
            </button>
            <div className="text-sm uppercase tracking-[0.2em] mb-3 transition-opacity duration-200" style={{ color: "#444444", opacity: pagesCollapsed ? 0 : 1, height: pagesCollapsed ? 0 : "auto", overflow: "hidden" }}>
              Pages
            </div>
            <div className="space-y-2 overflow-auto pr-1 flex-1 min-h-0 transition-all duration-300 ease-in-out" style={{ opacity: pagesCollapsed ? 0 : 1, width: pagesCollapsed ? 0 : "100%", pointerEvents: pagesCollapsed ? "none" : "auto" }}>
              {sectionEntries.map(([key], index) => {
                const label = draft.sectionLabels[key] || SECTION_LABELS[key as keyof typeof SECTION_LABELS] || key;
                const active = selectedSection === key;
                return (
                  <button
                    key={key}
                    onClick={() => focusSection(key)}
                    className="w-full text-left rounded-2xl border px-4 py-3 transition-all"
                    style={{
                      background: active ? "#EFECE3" : "#FFFFFF",
                      borderColor: active ? "#A7A08E" : "#D4D1C8",
                      color: "#000000",
                    }}
                  >
                    <div className="text-xs uppercase tracking-[0.18em] mb-1" style={{ color: "#444444" }}>Page {index + 1}</div>
                    <div className="font-semibold leading-snug">{label}</div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="space-y-6 min-w-0 min-h-0 overflow-y-auto pr-2 h-full w-full flex flex-col items-center">
            <div className="card p-6 w-full max-w-4xl">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center md:text-left">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] mb-1" style={{ color: "#444444" }}>Organization</div>
                  <div className="font-semibold" style={{ color: "#000000" }}>{draft.metadata.organization_name}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] mb-1" style={{ color: "#444444" }}>Project</div>
                  <div className="font-semibold" style={{ color: "#000000" }}>{draft.metadata.project_title}</div>
                </div>
              </div>
            </div>

            <div className="space-y-6 w-full max-w-4xl">
              {sectionEntries.map(([key, value], index) => {
                const label = draft.sectionLabels[key] || SECTION_LABELS[key as keyof typeof SECTION_LABELS] || key;
                const active = selectedSection === key;
                return (
                  <section
                    key={key}
                    ref={(element) => {
                      sectionRefs.current[key] = element;
                    }}
                    onFocusCapture={() => setSelectedSection(key)}
                    className="rounded-[28px] border bg-white shadow-[0_16px_50px_rgba(0,0,0,0.07)] p-6"
                    style={{ borderColor: active ? "#A7A08E" : "#D4D1C8" }}
                  >
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] mb-1" style={{ color: "#444444" }}>Page {index + 1}</div>
                        <h2 className="text-xl font-bold" style={{ color: "#000000" }}>{label}</h2>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full" style={{ background: "#EFECE3", color: "#444444" }}>
                        {(value || "").split(/\s+/).filter(Boolean).length} words
                      </span>
                    </div>

                    <div className="rounded-2xl border px-4 py-3 mb-4" style={{ background: "#EFECE3", borderColor: "#D4D1C8" }}>
                      <div className="text-sm font-semibold mb-2" style={{ color: "#000000" }}>Editable page canvas</div>
                      <p className="text-sm" style={{ color: "#444444", lineHeight: 1.6 }}>
                        Edit the section directly on the page. When you save, this content is regenerated into the PDF.
                      </p>
                    </div>

                    <textarea
                      className="input-field"
                      rows={18}
                      value={value}
                      onChange={(e) => updateSection(key, e.target.value)}
                      onFocus={() => setSelectedSection(key)}
                      style={{
                        width: "100%",
                        minHeight: 420,
                        resize: "vertical",
                        fontFamily: "Georgia, 'Times New Roman', serif",
                        lineHeight: 1.7,
                      }}
                    />
                  </section>
                );
              })}
            </div>
          </main>

          <aside className="space-y-6 self-start xl:sticky xl:top-0 h-full overflow-hidden flex flex-col w-full">
            <div className="card p-5 flex flex-col min-h-0 flex-[1_1_auto] h-full items-center text-center">
              <div className="text-sm uppercase tracking-[0.2em] mb-3 w-full" style={{ color: "#444444" }}>PDF Preview</div>
              <div className="flex gap-2 mb-4 justify-center flex-wrap w-full">
                <button
                  className={viewerMode === "edited" ? "btn-primary" : "btn-outline"}
                  onClick={() => setViewerMode("edited")}
                  type="button"
                >
                  Edited PDF
                </button>
                <button
                  className={viewerMode === "original" ? "btn-primary" : "btn-outline"}
                  onClick={() => setViewerMode("original")}
                  type="button"
                >
                  Original PDF
                </button>
              </div>
              <p className="text-sm mb-3 max-w-md" style={{ color: "#444444", lineHeight: 1.6 }}>
                {previewBusy ? "Updating preview from your latest edits..." : "The preview pane shows the PDF that will be saved."}
              </p>

              <div className="rounded-[22px] overflow-hidden border flex-1 min-h-0 w-full max-w-[820px] mx-auto" style={{ borderColor: "#D4D1C8", background: "#ffffff" }}>
                {previewUrl ? (
                  <iframe title="RFP PDF preview" src={previewUrl} className="w-full h-full min-h-[76vh]" style={{ background: "#ffffff" }} />
                ) : (
                  <div className="h-full min-h-[76vh] flex items-center justify-center p-6 text-center" style={{ color: "#444444" }}>
                    Preview unavailable.
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}