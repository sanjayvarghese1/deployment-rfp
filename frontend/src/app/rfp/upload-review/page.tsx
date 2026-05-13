"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { createContract } from "@/services/supabase";
import { useAuth } from "@/contexts/AuthContext";
import {
  getBackgroundGenerationSnapshot,
  startBackgroundRfpGeneration,
  subscribeBackgroundGeneration,
} from "@/lib/rfp/background";
import type { PdfTemplate, PipelineProgress, RfpInput } from "@/lib/rfp/config";

interface RfpAnalysis {
  overallScore: number;
  suggestions: string[];
  strengths: string[];
  analysis: {
    fileName: string;
    extractedText: string;
    sections: Record<string, string>;
  };
}

type SuggestionMode = "auto" | "custom" | "skip" | "";

interface SuggestionState {
  mode: SuggestionMode;
  note: string;
}

interface GeneratedDraft {
  metadata: { organization_name: string; project_title: string; category: string; date: string };
  sections: Record<string, string>;
  sectionLabels: Record<string, string>;
  template: string;
  pdfBase64: string;
  decomposition: unknown;
  uploadedPdfAnalysis?: Record<string, unknown>;
  sourcePdfBase64?: string;
  uploadedFrom?: "pdf";
  uploadedFileName?: string;
  suggestionsApplied?: string[];
  qaSuggestionStates?: Record<number, SuggestionState>;
}

export default function RfpUploadReviewPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [analysis, setAnalysis] = useState<RfpAnalysis | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [flowState, setFlowState] = useState<"idle" | "generating" | "review">("review");
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(2);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [generationSnapshot, setGenerationSnapshot] = useState(getBackgroundGenerationSnapshot());
  const [downloadTarget, setDownloadTarget] = useState<"full">("full");
  const [editTarget, setEditTarget] = useState<"full">("full");
  const [qaSuggestionStates, setQaSuggestionStates] = useState<Record<number, SuggestionState>>({});
  const [qaSuggestionsResolved, setQaSuggestionsResolved] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedDraft | null>(null);
  const [analyzingPdf, setAnalyzingPdf] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [uploadedPdfUrl, setUploadedPdfUrl] = useState("");

  useEffect(() => {
    try {
      const storedAnalysis = sessionStorage.getItem("rfp-upload-analysis");
      const storedPdfName = sessionStorage.getItem("rfp-uploaded-pdf-name") || sessionStorage.getItem("uploaded-pdf-name");
      const storedPdfUrl = sessionStorage.getItem("rfp-uploaded-pdf-url") || "";
      const storedDraftRaw = sessionStorage.getItem("rfp-editor-draft") || localStorage.getItem("rfp-editor-draft");

      if (storedAnalysis) setAnalysis(JSON.parse(storedAnalysis));
      if (storedPdfName) setPdfName(storedPdfName);
      if (storedPdfUrl) setUploadedPdfUrl(storedPdfUrl);
      if (storedDraftRaw) {
        const storedDraft = JSON.parse(storedDraftRaw) as GeneratedDraft;
        if (storedDraft?.uploadedFrom === "pdf" && storedDraft.pdfBase64) {
          setGeneratedDraft(storedDraft);
          setSaved(false);
          setDownloadTarget("full");
          setEditTarget("full");
          setFlowState("review");
          setWizardStep(3);
        }
      }
      setLoading(false);
    } catch {
      setLoading(false);
      router.push("/rfp");
    }
  }, [router]);

  const runPdfAnalysis = useCallback(async () => {
    if (!uploadedPdfUrl || analyzingPdf) return;

    try {
      setAnalyzingPdf(true);
      setAnalysisError("");
      setFlowState("review");
      setWizardStep(2);

      const response = await fetch(apiUrl("/api/rfp/upload-analyze"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pdfUrl: uploadedPdfUrl, fileName: pdfName || "uploaded-rfp.pdf" }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Analysis failed");
      }

      const scoreResult = await response.json();
      setAnalysis(scoreResult);
      sessionStorage.setItem("rfp-upload-analysis", JSON.stringify(scoreResult));
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setAnalyzingPdf(false);
    }
  }, [analyzingPdf, pdfName, uploadedPdfUrl]);

  useEffect(() => {
    const unsubscribe = subscribeBackgroundGeneration((snapshot) => {
      setGenerationSnapshot(snapshot);
      if (snapshot.progress) setProgress(snapshot.progress);
      if (snapshot.status === "running") {
        setFlowState("generating");
        setWizardStep(3);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!analysis) return;
    const allResolved = analysis.suggestions.every((_, index) => qaSuggestionStates[index]?.mode);
    setQaSuggestionsResolved(allResolved);
  }, [analysis, qaSuggestionStates]);

  const activeGenerationProgress = progress || generationSnapshot.progress;

  const readinessLabel = useMemo(() => {
    if (!analysis) return "";
    if (analysis.overallScore >= 70) return "Ready for distribution";
    if (analysis.overallScore >= 40) return "Needs minor edits";
    return "Needs revisions";
  }, [analysis]);

  const scoreCircleColor = useMemo(() => {
    if (!analysis) return "var(--muted)";
    if (analysis.overallScore >= 70) return "var(--success)";
    if (analysis.overallScore >= 40) return "var(--warning)";
    return "var(--danger)";
  }, [analysis]);

  const buildQaRevisionNotes = useCallback(() => {
    if (!analysis) return "";

    return analysis.suggestions
      .map((improvement, index) => {
        const state = qaSuggestionStates[index];
        if (!state?.mode) return "";

        const note = state.note.trim();
        if (state.mode === "skip") return `Suggestion ${index + 1} skipped: ${improvement}`;
        if (state.mode === "auto" || !note || note.toLowerCase() === "auto") {
          return `Suggestion ${index + 1} auto-applied by AI: ${improvement}`;
        }

        return `Suggestion ${index + 1} custom revision: ${note}`;
      })
      .filter(Boolean)
      .join("\n");
  }, [analysis, qaSuggestionStates]);

  const handleGenerateWithSuggestions = useCallback(async () => {
    if (!analysis || !qaSuggestionsResolved || !user) return;

    try {
      setGenerating(true);
      setFlowState("generating");
      setWizardStep(3);
      setProgress(null);

      const input: RfpInput = {
        organization_name: profile?.company_name || "Organization",
        project_title: pdfName.replace(/\.pdf$/i, "") || "Upload",
        category: "other",
        sections: { ...analysis.analysis.sections },
        detailed_project_description: analysis.analysis.extractedText,
        additional_details: "",
        selected_template: "software",
        selectedSubsystems: ["full"],
        qaRevisionNotes: buildQaRevisionNotes(),
        skipDecomposition: true,
      };

      await startBackgroundRfpGeneration(input, user.id || profile?.company_name || "anonymous", {
        onProgress: (progressData) => setProgress(progressData),
        onResult: (result, pdfBase64, decomposition) => {
          const draft: GeneratedDraft = {
            metadata: result.metadata,
            sections: result.sections,
            sectionLabels: result.sectionLabels,
            template: result.template,
            pdfBase64,
            uploadedFrom: "pdf" as const,
            uploadedFileName: pdfName,
            suggestionsApplied: analysis.suggestions.filter((_, idx) => qaSuggestionStates[idx]?.mode !== "skip"),
            qaSuggestionStates,
            decomposition,
            uploadedPdfAnalysis: analysis.analysis as Record<string, unknown>,
          };

          setGeneratedDraft(draft);
          setSaved(false);
          setDownloadTarget("full");
          setEditTarget("full");
          sessionStorage.setItem("rfp-editor-draft", JSON.stringify(draft));
          localStorage.setItem("rfp-editor-draft", JSON.stringify(draft));
          sessionStorage.removeItem("rfp-upload-analysis");
          sessionStorage.removeItem("uploaded-pdf-name");
          setGenerating(false);
          setFlowState("review");
          setWizardStep(3);
        },
        onError: (error) => {
          console.error("Generation error:", error);
          alert(`Generation failed: ${error}`);
          setGenerating(false);
          setFlowState("review");
          setWizardStep(2);
        },
        onComplete: () => setGenerating(false),
      });
    } catch (error) {
      console.error("Failed to start generation:", error);
      alert("Failed to start RFP generation. Please try again.");
      setGenerating(false);
      setFlowState("review");
      setWizardStep(2);
    }
  }, [analysis, buildQaRevisionNotes, pdfName, profile?.company_name, qaSuggestionStates, qaSuggestionsResolved, router, user]);

  const downloadBlob = useCallback((base64: string, filename: string) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const buildEditorDraft = useCallback((target: "full") => {
    if (!generatedDraft || target !== "full") return null;

    return {
      metadata: generatedDraft.metadata,
      sections: generatedDraft.sections,
      sectionLabels: generatedDraft.sectionLabels,
      template: generatedDraft.template as PdfTemplate,
      pdfBase64: generatedDraft.pdfBase64,
      sourcePdfBase64: generatedDraft.sourcePdfBase64 || generatedDraft.pdfBase64,
      decomposition: generatedDraft.decomposition,
      uploadedPdfAnalysis: generatedDraft.uploadedPdfAnalysis,
      returnTo: window.location.pathname + window.location.search,
      uploadedFrom: "pdf" as const,
      uploadedFileName: generatedDraft.uploadedFileName || pdfName,
      suggestionsApplied: generatedDraft.suggestionsApplied,
      qaSuggestionStates: generatedDraft.qaSuggestionStates,
      updatedAt: new Date().toISOString(),
    };
  }, [generatedDraft, pdfName]);

  const openEditorForTarget = useCallback((target: "full") => {
    const draft = buildEditorDraft(target);
    if (!draft) return;

    try {
      const serialized = JSON.stringify(draft);
      window.localStorage.setItem("rfp-editor-draft", serialized);
      window.sessionStorage.setItem("rfp-editor-draft", serialized);
    } catch {
      /* ignore storage failures */
    }

    router.push("/rfp/editor");
  }, [buildEditorDraft, router]);

  const downloadSelectedRfp = useCallback((target: "full") => {
    if (!generatedDraft || target !== "full") return;
    downloadBlob(generatedDraft.pdfBase64, `${generatedDraft.metadata.project_title || "RFP"}-generated.pdf`);
  }, [downloadBlob, generatedDraft]);

  const downloadMarkdown = useCallback(() => {
    if (!generatedDraft) return;

    const markdown = Object.entries(generatedDraft.sections)
      .map(([key, value]) => `## ${generatedDraft.sectionLabels[key] || key}\n\n${value}`)
      .join("\n\n---\n\n");

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${generatedDraft.metadata.project_title || "RFP"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [generatedDraft]);

  const saveGeneratedToContracts = useCallback(async () => {
    if (!generatedDraft || !user || saving || saved) return;

    try {
      setSaving(true);
      await createContract({
        title: generatedDraft.metadata.project_title,
        description: Object.values(generatedDraft.sections).find(Boolean)?.slice(0, 300) || generatedDraft.metadata.project_title,
        budget: "TBD",
        deadline: "TBD",
        industry: generatedDraft.metadata.category || "other",
        status: "draft",
        posted_by: user.id,
        posted_by_name: profile?.company_name || user.user_metadata?.full_name || user.email || "Unknown",
        poster_verified: profile?.verified || false,
        rfp_metadata: generatedDraft.metadata,
        rfp_qa: {
          overallScore: Math.round(analysis?.overallScore || 0),
          suggestions: analysis?.suggestions || generatedDraft.suggestionsApplied || [],
          strengths: analysis?.strengths || [],
        },
        rfp_sections: generatedDraft.sections,
        rfp_section_labels: generatedDraft.sectionLabels,
        rfp_pdf_base64: generatedDraft.pdfBase64,
        rfp_file_name: generatedDraft.uploadedFileName || pdfName,
        last_analysis_result: {
          overallScore: Math.round(analysis?.overallScore || 0),
          strengths: analysis?.strengths || [],
          suggestions: analysis?.suggestions || generatedDraft.suggestionsApplied || [],
          analysis: generatedDraft.uploadedPdfAnalysis || analysis?.analysis || {},
        },
      });

      setSaved(true);
      router.push("/contracts");
    } catch (error) {
      console.error("Failed to save generated RFP to My Contracts:", error);
      alert(error instanceof Error ? error.message : "Failed to save to My Contracts.");
    } finally {
      setSaving(false);
    }
  }, [analysis, generatedDraft, pdfName, profile?.company_name, profile?.verified, router, saved, saving, user]);

  const handleDirectSaveToContracts = useCallback(async () => {
    if (!analysis || !user || saving) return;

    try {
      setSaving(true);
      await createContract({
        title: `RFP from ${pdfName.replace(/\.pdf$/i, "") || "Upload"}`,
        description: analysis.analysis.extractedText.slice(0, 300) || pdfName,
        budget: "TBD",
        deadline: "TBD",
        industry: "other",
        status: "draft",
        posted_by: user.id,
        posted_by_name: profile?.company_name || user.user_metadata?.full_name || user.email || "Unknown",
        poster_verified: profile?.verified || false,
        rfp_metadata: {
          organization_name: profile?.company_name || "Organization",
          project_title: `RFP from ${pdfName.replace(/\.pdf$/i, "") || "Upload"}`,
          category: "other",
          date: new Date().toISOString(),
          uploadedFileName: pdfName,
        },
        rfp_qa: {
          overallScore: Math.round(analysis.overallScore),
          suggestions: analysis.suggestions,
          strengths: analysis.strengths,
        },
        rfp_sections: analysis.analysis.sections,
        rfp_section_labels: Object.fromEntries(Object.keys(analysis.analysis.sections).map((key) => [key, key.replace(/_/g, " ")])),
        rfp_pdf_base64: "",
        rfp_file_name: pdfName,
        last_analysis_result: {
          overallScore: Math.round(analysis.overallScore),
          strengths: analysis.strengths,
          suggestions: analysis.suggestions,
          analysis: analysis.analysis,
        },
      });

      sessionStorage.removeItem("rfp-upload-analysis");
      sessionStorage.removeItem("uploaded-pdf-name");
      router.push("/rfp/intake?tab=blank");
    } finally {
      setSaving(false);
    }
  }, [analysis, pdfName, profile?.company_name, profile?.verified, router, saving, user]);

  if (loading) return <div className="min-h-screen bg-[#EFECE3]" />;

  if (!analysis) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#EFECE3] px-4">
        <div className="card w-full max-w-[780px] p-6">
          <div className="text-lg font-bold text-[var(--foreground)]">RFP uploaded</div>
          <div className="mt-2 text-sm text-[var(--muted)]">
            {pdfName || "Your PDF"} is ready. Extraction and analysis will start only when you click Run Analysis.
          </div>
          {analysisError && <div className="mt-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-light)] p-3 text-sm text-[var(--danger)]">{analysisError}</div>}
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="btn-primary" onClick={runPdfAnalysis} disabled={analyzingPdf || !uploadedPdfUrl}>
              {analyzingPdf ? "Analyzing..." : "Run Analysis"}
            </button>
            <button className="btn-outline" onClick={() => router.push("/rfp") }>
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--card-border)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" fill="#EFECE3" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z" /></svg>
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>RFP Generator</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {flowState === "idle" && "Intake in progress"}
            {flowState === "generating" && "Generating..."}
            {flowState === "review" && "Complete"}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 20px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
          {[
            { label: "1. Intake", active: wizardStep === 1, done: wizardStep > 1 },
            { label: "2. QA Review", active: wizardStep === 2, done: wizardStep > 2 },
            { label: "3. Results", active: wizardStep === 3, done: false },
          ].map((step) => (
            <div key={step.label} style={{ padding: "8px 10px", borderRadius: 999, textAlign: "center", fontSize: 12, fontWeight: 600, background: step.active ? "var(--primary)" : step.done ? "var(--primary-light)" : "var(--surface)", color: step.active ? "#EFECE3" : "var(--foreground)", border: "1px solid var(--card-border)" }}>
              {step.label}
            </div>
          ))}
        </div>
      </div>

      {flowState === "generating" && activeGenerationProgress && (
        <div style={{ padding: "0 20px 8px" }}>
          <div style={{ background: "var(--surface)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{activeGenerationProgress.stage}</span>
              <span style={{ color: "var(--muted)" }}>{activeGenerationProgress.percent}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--surface-hover)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${activeGenerationProgress.percent}%`,
                  background: "var(--primary)",
                  borderRadius: 3,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{activeGenerationProgress.message}</div>
          </div>
        </div>
      )}

      {!(flowState === "generating" && activeGenerationProgress) && (
        <div style={{ padding: "0 20px 20px" }}>
          {generatedDraft && (
            <>
              <div style={{ background: "linear-gradient(180deg, var(--surface) 0%, rgba(239,236,227,0.7) 100%)", borderRadius: 18, padding: 18, marginBottom: 12, border: "1px solid var(--card-border)" }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--muted)", marginBottom: 8 }}>File summary</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)", marginBottom: 8 }}>
                  {generatedDraft.metadata.project_title}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, maxWidth: 860 }}>
                  The AI generated the RFP set from your intake answers, ready to download or edit.
                </div>
              </div>

              <div style={{ background: "var(--surface)", borderRadius: 16, padding: 16, border: "1px solid var(--card-border)", display: "grid", gap: 14 }}>
                <div style={{ background: "rgba(239,236,227,0.65)", borderRadius: 14, padding: 14, border: "1px solid var(--card-border)" }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: "var(--muted)", marginBottom: 8 }}>
                    File selector
                  </div>
                  <div style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6, marginBottom: 12 }}>
                    Choose one generated file and use the same selector for download or edit.
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                      Select file
                      <select className="input-field" value={downloadTarget} onChange={(event) => {
                        const nextTarget = event.target.value as "full";
                        setDownloadTarget(nextTarget);
                        setEditTarget(nextTarget);
                      }}>
                        <option value="full">Common RFP</option>
                      </select>
                    </label>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button className="btn-primary" onClick={() => downloadSelectedRfp(downloadTarget)} style={{ gap: 6 }}>
                        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                        Download Selected PDF
                      </button>
                      <button className="btn-outline" onClick={() => openEditorForTarget(editTarget)} style={{ gap: 6 }}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 3.487a2.375 2.375 0 113.358 3.358L7.5 19.565 3 21l1.435-4.5L16.862 3.487z" /></svg>
                        Edit Selected PDF
                      </button>
                    </div>
                  </div>
                </div>

                <button className="btn-outline" onClick={downloadMarkdown} style={{ gap: 6 }}>
                  <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5v-2z"/></svg>
                  Download Markdown
                </button>

                {user && (
                  <button
                    className={saved ? "btn-outline" : "btn-primary"}
                    onClick={saveGeneratedToContracts}
                    disabled={saving || saved}
                    style={{ gap: 6 }}
                  >
                    {saving ? (
                      <><div style={{ width: 14, height: 14, border: "2px solid rgba(239,236,227,0.3)", borderTop: "2px solid #EFECE3", borderRadius: "50%", animation: "spin 1s linear infinite" }} />Saving...</>
                    ) : saved ? (
                      <><svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>Saved to My Contracts</>
                    ) : (
                      <><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>Save to My Contracts</>
                    )}
                  </button>
                )}
              </div>
            </>
          )}

          {!generatedDraft && (
            <>
              <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: scoreCircleColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#EFECE3", fontWeight: 700, fontSize: 16 }}>
                    {Math.round(analysis.overallScore)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>QA Review Score</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{readinessLabel}</div>
                  </div>
                </div>
                {analysis.strengths.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 10 }}>
                    <strong>Strengths:</strong> {analysis.strengths.slice(0, 3).join(", ")}
                  </div>
                )}
                {analysis.suggestions.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <strong>Suggestions:</strong>
                    <ul style={{ margin: "6px 0 0 18px", padding: 0, display: "grid", gap: 4 }}>
                      {analysis.suggestions.slice(0, 5).map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>Fix suggestions before generation</div>
                <div style={{ display: "grid", gap: 12 }}>
                  {analysis.suggestions.map((improvement, index) => {
                    const state = qaSuggestionStates[index] || { mode: "", note: "" };
                    return (
                      <div key={index} style={{ border: "1px solid var(--card-border)", borderRadius: 10, padding: 12, background: "var(--surface-hover)" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Suggestion {index + 1}</div>
                        <div style={{ fontSize: 13, marginBottom: 10, color: "var(--foreground-secondary)" }}>{improvement}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <button className="btn-outline" onClick={() => setQaSuggestionStates((prev) => ({ ...prev, [index]: { mode: "auto", note: "auto" } }))} style={{ fontSize: 12, padding: "6px 10px" }}>
                            auto
                          </button>
                          <button className="btn-outline" onClick={() => setQaSuggestionStates((prev) => ({ ...prev, [index]: { mode: "custom", note: prev[index]?.note || "" } }))} style={{ fontSize: 12, padding: "6px 10px" }}>
                            custom
                          </button>
                          <button className="btn-outline" onClick={() => setQaSuggestionStates((prev) => ({ ...prev, [index]: { mode: "skip", note: "skip" } }))} style={{ fontSize: 12, padding: "6px 10px" }}>
                            No
                          </button>
                        </div>
                        {state.mode === "custom" && (
                          <textarea
                            className="input-field"
                            value={state.note}
                            onChange={(e) => setQaSuggestionStates((prev) => ({ ...prev, [index]: { mode: "custom", note: e.target.value } }))}
                            placeholder='Type the changes you want, or type "auto" to let AI apply it.'
                            rows={3}
                            style={{ width: "100%", resize: "vertical" }}
                          />
                        )}
                        {state.mode === "auto" && <div style={{ fontSize: 12, color: "var(--success)" }}>AI will apply this suggestion automatically.</div>}
                        {state.mode === "skip" && <div style={{ fontSize: 12, color: "var(--muted)" }}>Suggestion skipped. Generation will continue without this change.</div>}
                      </div>
                    );
                  })}
                </div>

                {!qaSuggestionsResolved && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--warning)" }}>
                    Please choose auto, custom, or No for every suggestion.
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                  <button className="btn-primary" onClick={handleGenerateWithSuggestions} disabled={!qaSuggestionsResolved || saving || generating}>
                    {generating ? "Generating..." : "Generate RFP"}
                  </button>
                  <button className="btn-outline" onClick={handleDirectSaveToContracts} disabled={saving || !user || generating}>
                    {saving ? "Saving..." : "Save Without Changes"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

