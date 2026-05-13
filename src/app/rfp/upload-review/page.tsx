"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createContract } from "@/services/supabase";
import { useAuth } from "@/contexts/AuthContext";
import {
  getBackgroundGenerationSnapshot,
  startBackgroundRfpGeneration,
  subscribeBackgroundGeneration,
} from "@/lib/rfp/background";
import type { PipelineProgress, RfpInput } from "@/lib/rfp/config";

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

export default function RfpUploadReviewPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [analysis, setAnalysis] = useState<RfpAnalysis | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [flowState, setFlowState] = useState<"idle" | "generating" | "review">("review");
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(2);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [generationSnapshot, setGenerationSnapshot] = useState(getBackgroundGenerationSnapshot());
  const [qaSuggestionStates, setQaSuggestionStates] = useState<Record<number, SuggestionState>>({});
  const [qaSuggestionsResolved, setQaSuggestionsResolved] = useState(false);

  useEffect(() => {
    try {
      const storedAnalysis = sessionStorage.getItem("rfp-upload-analysis");
      const storedPdfName = sessionStorage.getItem("uploaded-pdf-name");

      if (storedAnalysis) setAnalysis(JSON.parse(storedAnalysis));
      if (storedPdfName) setPdfName(storedPdfName);
      setLoading(false);
    } catch {
      setLoading(false);
      router.push("/rfp");
    }
  }, [router]);

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
        onResult: () => {
          sessionStorage.removeItem("rfp-upload-analysis");
          sessionStorage.removeItem("uploaded-pdf-name");
          // Keep upload and scratch flows consistent: land in shared Results UI,
          // then let users choose Download or Edit from there.
          router.push("/rfp/intake?tab=generate");
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
        uploaded_pdf_name: pdfName,
        uploaded_pdf_analysis: analysis.analysis,
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
      <div className="flex min-h-screen items-center justify-center bg-[#EFECE3]">
        <button className="btn-primary" onClick={() => router.push("/rfp")}>
          Go Back
        </button>
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
        </div>
      )}
    </div>
  );
}

