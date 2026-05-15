"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { RFP_QUESTIONS, FINAL_INTAKE_KEY, getFinalIntakeQuestionLabel, type PipelineProgress, type PipelineResult, type RfpInput, type DecompositionData, type PdfTemplate, type QAResult, type MandatoryCriterion, type MandatoryCriteriaRecommendation } from "@/lib/rfp/config";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { supabase } from "@/services/supabase";
import { getBackgroundGenerationSnapshot, startBackgroundRfpGeneration, subscribeBackgroundGeneration } from "@/lib/rfp/background";
import { apiUrl } from "@/lib/api";
import MandatoryCriteriaPhase from "@/components/MandatoryCriteriaPhase";
import { addCriterionTarget, buildFallbackCriteria, buildMandatoryCriteriaPayload, normalizeRecommendation, removeCriterionTarget, updateCriterionTarget } from "@/lib/rfp/mandatoryCriteria";

type FlowState = "idle" | "generating" | "review";
type WizardStep = 1 | 2 | 3 | 4;
type QaDecisionMode = "auto" | "custom" | "skip";

const INTAKE_ORDER = [...RFP_QUESTIONS.map((question) => question.key), FINAL_INTAKE_KEY];
const MAX_INTAKE_MESSAGE_CHARS = 1000;
const EDITOR_DRAFT_KEY = "rfp-editor-draft";
const EDITOR_SYNC_EVENT = "rfp-editor-draft-updated";
const SELECTED_TARGET_KEY = "rfp-selected-target";

const TEMPLATE_PREVIEWS: Record<PdfTemplate, { title: string; subtitle: string; accent: string; chips: string[] }> = {
  software: {
    title: "Software Executive RFP",
    subtitle: "Clean, modern, product-led layout for digital platforms and enterprise software.",
    accent: "linear-gradient(135deg, #2563eb, #1d4ed8)",
    chips: ["Architecture", "Security", "Delivery"],
  },
  manufacturing: {
    title: "Manufacturing Procurement RFP",
    subtitle: "Structured, industrial-style layout for equipment, plant, and production programs.",
    accent: "linear-gradient(135deg, #d97706, #b45309)",
    chips: ["Plant", "Quality", "Operations"],
  },
  consulting: {
    title: "Consulting & Advisory RFP",
    subtitle: "Refined, boardroom-ready format for strategy, advisory, and managed services.",
    accent: "linear-gradient(135deg, #0369a1, #0f766e)",
    chips: ["Strategy", "Governance", "Outcomes"],
  },
  government: {
    title: "Government & Public Sector RFP",
    subtitle: "Formal procurement layout with strong compliance and evaluation emphasis.",
    accent: "linear-gradient(135deg, #374151, #111827)",
    chips: ["Compliance", "Evaluation", "Contract"],
  },
};

interface ChatMessage {
  role: "bot" | "user";
  text: string;
}

interface RfpChatbotProps {
  onSaved?: () => void;
  contractId?: string;
  onRfpGenerated?: (data: {
    title: string;
    sections: Record<string, string>;
    sectionLabels: Record<string, string>;
    pdfBase64: string;
    metadata: { organization_name: string; project_title: string; category: string; date: string };
    mandatoryCriteria?: MandatoryCriteriaState;
  }) => void;
}

interface IntakeResponse {
  extractedAnswers?: Record<string, string>;
  nextQuestionKey?: string | null;
  nextQuestion?: string | null;
  readyForGeneration?: boolean;
  summary?: string;
  clarifyingQuestion?: string | null;
  chatReply?: string | null;
  missingRequired?: string[];
}

interface QaReviewResponse {
  qa: QAResult;
  missingRequired: string[];
  missingQuestionKey: string | null;
  missingQuestionLabel: string | null;
}

interface QaSuggestionState {
  mode: QaDecisionMode | "";
  note: string;
}

interface EditorDraftSnapshot {
  metadata: { organization_name: string; project_title: string; category: string; date: string };
  sections: Record<string, string>;
  sectionLabels: Record<string, string>;
  template: PdfTemplate;
  pdfBase64: string;
  sourcePdfBase64?: string;
  decomposition?: DecompositionData | null;
  subsystemName?: string;
  updatedAt?: string;
}

type TargetRfp = "full" | string;

interface MandatoryCriteriaState {
  loading: boolean;
  ready: boolean;
  targets: string[];
  activeTargetIndex: number;
  criteriaByTarget: Record<string, MandatoryCriterion[]>;
  error: string | null;
}

function getNextRequiredKey(answers: Record<string, string>): string | null {
  for (const key of INTAKE_ORDER) {
    const value = answers[key];
    if (!value || !value.trim()) return key;
  }
  return null;
}

function getNextConversationKey(answers: Record<string, string>): string | null {
  for (const question of RFP_QUESTIONS) {
    const value = answers[question.key];
    if (!value || !value.trim()) return question.key;
  }
  // After all RFP_QUESTIONS are answered, ask for additional details
  if (!answers[FINAL_INTAKE_KEY] || !answers[FINAL_INTAKE_KEY].trim()) {
    return FINAL_INTAKE_KEY;
  }
  return null;
}

function getNextRequiredGenerationKey(answers: Record<string, string>): string | null {
  for (const question of RFP_QUESTIONS) {
    if (question.key === FINAL_INTAKE_KEY) continue;
    const value = answers[question.key];
    if (!value || !value.trim()) return question.key;
  }
  return null;
}

export default function RfpChatbot({ onSaved, contractId, onRfpGenerated }: RfpChatbotProps = {}) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [inputValue, setInputValue] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplate>("software");
  const [templateTouched, setTemplateTouched] = useState(false);
  const [selectedSubsystems, setSelectedSubsystems] = useState<Set<string>>(new Set()); // "full" or subsystem names
  const [decompositionAnalysis, setDecompositionAnalysis] = useState<DecompositionData | null>(null);
  const [decompositionLoading, setDecompositionLoading] = useState(false);
  const [qaReview, setQaReview] = useState<QAResult | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaSuggestionStates, setQaSuggestionStates] = useState<Record<number, QaSuggestionState>>({});
  const [forcedQuestionKey, setForcedQuestionKey] = useState<string | null>(null);
  const [generationSnapshot, setGenerationSnapshot] = useState(getBackgroundGenerationSnapshot());
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "bot", text: "Welcome! I will collect 19 RFP details one by one." },
    { role: "bot", text: RFP_QUESTIONS[0].label },
  ]);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [result, setResult] = useState<Omit<PipelineResult, "pdfBase64"> | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [decomposition, setDecomposition] = useState<DecompositionData | null>(null);
  const [mandatoryCriteria, setMandatoryCriteria] = useState<MandatoryCriteriaState>({
    loading: false,
    ready: false,
    targets: [],
    activeTargetIndex: 0,
    criteriaByTarget: {},
    error: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(() => {
    const snapshot = getBackgroundGenerationSnapshot();
    return snapshot.status === "running" && snapshot.startedAt ? Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1000)) : 0;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [intaking, setIntaking] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<TargetRfp>("full");
  const [editTarget, setEditTarget] = useState<TargetRfp>("full");

  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (wizardStep !== 1) return;

    const container = chatScrollRef.current;
    if (!container) return;

    const handle = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(handle);
  }, [messages, wizardStep, progress, generationSnapshot.progress]);

  const currentPromptKey = forcedQuestionKey || getNextConversationKey(answers);
  const currentQuestion = currentPromptKey
    ? currentPromptKey === FINAL_INTAKE_KEY
      ? { key: FINAL_INTAKE_KEY, label: getFinalIntakeQuestionLabel(), placeholder: "Add any extra notes..." }
      : RFP_QUESTIONS.find((q) => q.key === currentPromptKey) || null
    : null;

  useEffect(() => {
    if (templateTouched) return;
    const category = (answers.category || "software").toLowerCase();
    const recommended = category === "manufacturing" || category === "construction"
      ? "manufacturing"
      : category === "logistics"
        ? "consulting"
        : category === "government"
          ? "government"
          : category === "other"
            ? "consulting"
            : "software";
    setSelectedTemplate(recommended);
  }, [answers.category, templateTouched]);

  // Fetch decomposition analysis when intake is complete
  useEffect(() => {
    if (decompositionAnalysis) {
      console.log("📋 [CHECKBOX UI AVAILABLE]", {
        availableSubsystems: Object.keys(decompositionAnalysis.subsystems),
        currentSelection: Array.from(selectedSubsystems),
      });
    }
  }, [decompositionAnalysis, selectedSubsystems]);

  useEffect(() => {
    return subscribeBackgroundGeneration((snapshot) => {
      setGenerationSnapshot(snapshot);

      if (snapshot.status === "running") {
        setFlowState("generating");
        setWizardStep(3);
        setProgress(snapshot.progress);
      }

      if (snapshot.status === "complete" && snapshot.result && snapshot.pdfBase64 && snapshot.decomposition) {
        setFlowState("review");
        setWizardStep(3);
        setResult(snapshot.result);
        setPdfBase64(snapshot.pdfBase64);
        setDecomposition(snapshot.decomposition);
        setProgress(null);
      }

      if (snapshot.status === "error" && snapshot.error) {
        setError(snapshot.error);
        setFlowState("review");
        setWizardStep(3);
      }
    });
  }, []);

  const applyEditedDraft = useCallback((draft: EditorDraftSnapshot) => {
    setPdfBase64(draft.pdfBase64);
    setDecomposition(draft.decomposition || null);
    setSaved(false);
    setResult((current) => {
      if (!current) return current;
      return {
        ...current,
        metadata: draft.metadata,
        sections: draft.sections,
        sectionLabels: draft.sectionLabels,
        template: draft.template,
      };
    });
    // If draft contains updated subsystem pdfs, merge them into decomposition state
    if (draft.decomposition && draft.decomposition.subsystemPdfs && draft.decomposition.subsystemPdfs.length > 0) {
      setDecomposition((prev) => {
        const base: DecompositionData = prev ? { ...prev } : { ...draft.decomposition! };
        base.subsystemPdfs = draft.decomposition!.subsystemPdfs;
        base.subsystemDrafts = draft.decomposition!.subsystemDrafts || base.subsystemDrafts;
        return base;
      });
    }
  }, []);

  useEffect(() => {
    if (generationSnapshot.status !== "running" || !generationSnapshot.startedAt) {
      setElapsed(0);
      return;
    }

    const startedAt = generationSnapshot.startedAt;
    const updateElapsed = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [generationSnapshot.status, generationSnapshot.startedAt]);

  useEffect(() => {
    const syncEditedDraftFromStorage = () => {
      try {
        const raw = window.localStorage.getItem(EDITOR_DRAFT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as EditorDraftSnapshot;
        applyEditedDraft(parsed);
        // restore last selected file if present
        try {
          const sel = window.localStorage.getItem(SELECTED_TARGET_KEY);
          if (parsed.subsystemName) {
            setDownloadTarget(parsed.subsystemName);
            setEditTarget(parsed.subsystemName);
          } else if (sel) {
            setDownloadTarget(sel as TargetRfp);
            setEditTarget(sel as TargetRfp);
          } else {
            setDownloadTarget("full");
            setEditTarget("full");
          }
        } catch {}
      } catch {
        /* ignore storage failures */
      }
    };

    const handleDraftEvent = (event: Event) => {
      const detail = (event as CustomEvent<EditorDraftSnapshot>).detail;
      if (detail) {
        applyEditedDraft(detail);
        try {
          if (detail.subsystemName) {
            setDownloadTarget(detail.subsystemName);
            setEditTarget(detail.subsystemName);
            try { window.localStorage.setItem(SELECTED_TARGET_KEY, detail.subsystemName); } catch {}
          } else {
            setDownloadTarget("full");
            setEditTarget("full");
            try { window.localStorage.setItem(SELECTED_TARGET_KEY, "full"); } catch {}
          }
        } catch {}
        return;
      }
      syncEditedDraftFromStorage();
    };

    syncEditedDraftFromStorage();
    window.addEventListener(EDITOR_SYNC_EVENT, handleDraftEvent as EventListener);
    window.addEventListener("storage", syncEditedDraftFromStorage);

    return () => {
      window.removeEventListener(EDITOR_SYNC_EVENT, handleDraftEvent as EventListener);
      window.removeEventListener("storage", syncEditedDraftFromStorage);
    };
  }, [applyEditedDraft]);

  const intakeComplete = getNextRequiredKey(answers) === null;
  const qaSuggestionsResolved = !qaReview || qaReview.improvements.every((_, index) => qaSuggestionStates[index]?.mode);

  const buildQaRevisionNotes = useCallback(() => {
    if (!qaReview) return "";

    return qaReview.improvements
      .map((improvement, index) => {
        const state = qaSuggestionStates[index];
        if (!state?.mode) return "";

        const note = state.note.trim();
        if (state.mode === "skip") {
          return `Suggestion ${index + 1} skipped: ${improvement}`;
        }

        if (state.mode === "auto" || !note || note.toLowerCase() === "auto") {
          return `Suggestion ${index + 1} auto-applied by AI: ${improvement}`;
        }

        return `Suggestion ${index + 1} custom revision: ${note}`;
      })
      .filter(Boolean)
      .join("\n");
  }, [qaReview, qaSuggestionStates]);

  const initializeQaSuggestionStates = useCallback((review: QAResult) => {
    const initialStates: Record<number, QaSuggestionState> = {};
    review.improvements.forEach((_, index) => {
      initialStates[index] = { mode: "", note: "" };
    });
    setQaSuggestionStates(initialStates);
  }, []);

  // Fetch decomposition analysis when intake is complete
  useEffect(() => {
    if (!intakeComplete || decompositionAnalysis) return; // Only fetch once

    let cancelled = false;

    const fetchDecomposition = async () => {
      setDecompositionLoading(true);
      try {
        // Build input for decomposition analysis
        const sections: Record<string, string> = {};
        for (const q of RFP_QUESTIONS) {
          if (!q.isMetadata && q.key !== "detailed_project_description") {
            sections[q.key] = answers[q.key] || "";
          }
        }

        const input: RfpInput = {
          organization_name: answers.organization_name || profile?.company_name || "Organization",
          project_title: answers.project_title || "Project",
          category: (answers.category || "software").toLowerCase(),
          sections,
          detailed_project_description: answers.detailed_project_description || "",
          additional_details: answers[FINAL_INTAKE_KEY] || "",
        };

        const res = await fetch(apiUrl("/api/rfp/analyze-decomposition"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (res.ok) {
          const data = await res.json() as DecompositionData;
          if (!cancelled && data.subsystems && Object.keys(data.subsystems).length > 0) {
            console.log("✅ [DECOMPOSITION FETCHED]", {
              subsystemCount: Object.keys(data.subsystems).length,
              subsystemNames: Object.keys(data.subsystems),
            });
            setDecompositionAnalysis(data);
            // Preserve the user's explicit choice; do not force common/full.
            setSelectedSubsystems((current) => current);
          }
        }
      } catch (err) {
        console.warn("Decomposition analysis failed:", err);
        // Silently fail - decomposition UI won't show if analysis fails
      } finally {
        if (!cancelled) {
          setDecompositionLoading(false);
        }
      }
    };

    fetchDecomposition();
    return () => {
      cancelled = true;
    };
  }, [intakeComplete, decompositionAnalysis, answers, profile]);

  useEffect(() => {
    if (!decomposition?.subsystemDrafts?.length) {
      setDownloadTarget("full");
      setEditTarget("full");
      return;
    }

    if (downloadTarget !== "full" && !decomposition.subsystemDrafts.some((draft) => draft.name === downloadTarget)) {
      setDownloadTarget("full");
    }

    if (editTarget !== "full" && !decomposition.subsystemDrafts.some((draft) => draft.name === editTarget)) {
      setEditTarget("full");
    }
  }, [decomposition, downloadTarget, editTarget]);

  const activeGenerationProgress = progress || generationSnapshot.progress;
  const generatedSubsystemDrafts = decomposition?.subsystemDrafts || [];
  const selectedSubsystemNames = selectedSubsystems.has("full")
    ? []
    : Array.from(selectedSubsystems).filter((name) => name !== "full" && Object.prototype.hasOwnProperty.call(decompositionAnalysis?.subsystems || {}, name));
  const availableFileTargets: TargetRfp[] = selectedSubsystems.has("full")
    ? ["full"]
    : generatedSubsystemDrafts.map((draft) => draft.name);
  const mandatoryTargets = selectedSubsystems.has("full")
    ? ["full"]
    : (selectedSubsystemNames.length > 0 ? selectedSubsystemNames : Array.from(selectedSubsystems).filter((name) => name !== "full"));

  const loadMandatoryCriteriaRecommendations = useCallback(async (targets: string[]) => {
    const normalizedTargets = targets.length > 0 ? targets : ["full"];
    setMandatoryCriteria((current) => ({ ...current, loading: true, ready: false, error: null, targets: normalizedTargets }));

    try {
      const response = await fetch(apiUrl("/api/rfp/mandatory-criteria"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: answers.organization_name || profile?.company_name || "Organization",
          projectTitle: result?.metadata.project_title || answers.project_title || "RFP",
          category: result?.metadata.category || answers.category || "other",
          selectedSubsystems: normalizedTargets,
          summary: result ? Object.values(result.sections).find(Boolean)?.slice(0, 2000) || "" : answers.detailed_project_description || "",
          decomposition: decompositionAnalysis?.subsystems || {},
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text().catch(() => "Failed to generate mandatory criteria"));
      }

      const data = (await response.json()) as MandatoryCriteriaRecommendation;
      const criteriaByTarget = normalizeRecommendation(data, normalizedTargets);
      setMandatoryCriteria({
        loading: false,
        ready: true,
        targets: normalizedTargets,
        activeTargetIndex: 0,
        criteriaByTarget,
        error: null,
      });
    } catch (error) {
      console.warn("Mandatory criteria recommendation failed:", error);
      const fallbackTargets = normalizedTargets.length > 0 ? normalizedTargets : ["full"];
      const criteriaByTarget = Object.fromEntries(fallbackTargets.map((target) => [target, buildFallbackCriteria(target === "full" ? "Full RFP" : target.replace(/_/g, " "))]));
      setMandatoryCriteria({
        loading: false,
        ready: true,
        targets: fallbackTargets,
        activeTargetIndex: 0,
        criteriaByTarget,
        error: null,
      });
    }
  }, [answers.category, answers.detailed_project_description, answers.organization_name, answers.project_title, decompositionAnalysis?.subsystems, profile?.company_name, result]);

  useEffect(() => {
    if (wizardStep < 3 || !result) return;
    if (mandatoryCriteria.loading) return;
    if (mandatoryCriteria.ready && mandatoryCriteria.targets.length > 0) return;
    void loadMandatoryCriteriaRecommendations(mandatoryTargets);
  }, [loadMandatoryCriteriaRecommendations, mandatoryCriteria.loading, mandatoryCriteria.ready, mandatoryTargets, result, wizardStep]);

  const handleMandatoryCriteriaBack = useCallback(() => {
    setMandatoryCriteria((current) => {
      if (current.activeTargetIndex <= 0) {
        setWizardStep(3);
        return current;
      }
      return { ...current, activeTargetIndex: current.activeTargetIndex - 1 };
    });
  }, []);

  const handleMandatoryCriteriaNext = useCallback(() => {
    setMandatoryCriteria((current) => {
      const nextIndex = Math.min(current.activeTargetIndex + 1, Math.max(0, current.targets.length - 1));
      return { ...current, activeTargetIndex: nextIndex };
    });
  }, []);

  const updateMandatoryCriterion = useCallback((target: string, index: number, patch: Partial<MandatoryCriterion>) => {
    setMandatoryCriteria((current) => ({
      ...current,
      criteriaByTarget: updateCriterionTarget(current.criteriaByTarget, target, index, patch),
    }));
  }, []);

  const addMandatoryCriterion = useCallback((target: string) => {
    setMandatoryCriteria((current) => ({
      ...current,
      criteriaByTarget: addCriterionTarget(current.criteriaByTarget, target),
    }));
  }, []);

  const removeMandatoryCriterion = useCallback((target: string, index: number) => {
    setMandatoryCriteria((current) => ({
      ...current,
      criteriaByTarget: removeCriterionTarget(current.criteriaByTarget, target, index),
    }));
  }, []);

  useEffect(() => {
    if (availableFileTargets.length === 0) return;
    if (!availableFileTargets.includes(downloadTarget)) {
      setDownloadTarget(availableFileTargets[0]);
    }
    if (!availableFileTargets.includes(editTarget)) {
      setEditTarget(availableFileTargets[0]);
    }
  }, [availableFileTargets, downloadTarget, editTarget]);

  useEffect(() => {
    if (selectedSubsystems.has("full")) {
      setDownloadTarget("full");
      setEditTarget("full");
    }
  }, [selectedSubsystems]);

  const submitAnswer = useCallback(async (value: string) => {
    const answerText = value.trim();
    if (!answerText || intaking || flowState !== "idle") return;

    if (answerText.length > MAX_INTAKE_MESSAGE_CHARS) {
      setMessages((prev) => [...prev, { role: "user", text: answerText }]);
      setInputValue("");
      setMessages((prev) => [...prev, { role: "bot", text: `Please keep it under ${MAX_INTAKE_MESSAGE_CHARS} characters. A shorter version will work better here.` }]);
      return;
    }

    setIntaking(true);
    setMessages((prev) => [...prev, { role: "user", text: answerText }]);
    setInputValue("");

    try {
      const res = await fetch(apiUrl("/api/rfp/intake"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: answerText, answers, currentQuestionKey: currentPromptKey }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "Failed to extract intake fields");
        throw new Error(errText);
      }

      const data = (await res.json()) as IntakeResponse;
      const mergedAnswers = {
        ...answers,
        ...(data.extractedAnswers || {}),
      };

      setAnswers(mergedAnswers);
      if (forcedQuestionKey && mergedAnswers[forcedQuestionKey]?.trim()) {
        setForcedQuestionKey(null);
      }

      const nextQuestionKey = data.nextQuestionKey || getNextRequiredKey(mergedAnswers);
      const botMessage =
        data.chatReply ||
        data.clarifyingQuestion ||
        (!nextQuestionKey && data.readyForGeneration
          ? "I have enough information to generate the RFP. Click **Generate RFP** when you're ready."
          : "");

      if (botMessage) {
        setMessages((prev) => [...prev, { role: "bot", text: botMessage }]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { role: "bot", text: `I couldn't parse that yet: ${msg}` }]);
    } finally {
      setIntaking(false);
    }
  }, [answers, currentPromptKey, flowState, intaking]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && flowState === "idle") {
      e.preventDefault();
      submitAnswer(inputValue);
    }
  };

  const runQaReview = useCallback(async () => {
    const missingKey = getNextRequiredKey(answers);
    if (missingKey) {
      setForcedQuestionKey(missingKey);
      setMessages((prev) => [...prev, { role: "bot", text: `I still need one more answer: ${RFP_QUESTIONS.find((q) => q.key === missingKey)?.label || missingKey}` }]);
      return;
    }

    setQaLoading(true);
    setError(null);

    try {
      const res = await fetch(apiUrl("/api/rfp/qa-review"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          selectedTemplate,
          selectedSubsystems: Array.from(selectedSubsystems),
          projectTitle: answers.project_title || profile?.company_name || "Project",
          organizationName: answers.organization_name || profile?.company_name || "Organization",
          category: answers.category || "software",
          additionalDetails: answers[FINAL_INTAKE_KEY] || "",
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "Failed to review the intake");
        throw new Error(errText);
      }

      const data = (await res.json()) as QaReviewResponse;

      if (data.missingRequired?.length) {
        const key = data.missingQuestionKey || data.missingRequired[0] || null;
        setForcedQuestionKey(key);
        setWizardStep(1);
        setMessages((prev) => [
          ...prev,
          {
            role: "bot",
            text: `Before I score the draft, I still need: ${data.missingQuestionLabel || (key ? RFP_QUESTIONS.find((q) => q.key === key)?.label : "one missing answer") || "one missing answer"}`,
          },
        ]);
        return;
      }

      setQaReview(data.qa);
      initializeQaSuggestionStates(data.qa);
      setWizardStep(2);
      setMessages([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages((prev) => [...prev, { role: "bot", text: `QA review failed: ${msg}` }]);
    } finally {
      setQaLoading(false);
    }
  }, [answers, initializeQaSuggestionStates, profile?.company_name, selectedSubsystems, selectedTemplate]);

  /* ─── Start SSE pipeline ─── */
  const startGeneration = async () => {
    const organizationName = answers.organization_name || profile?.company_name || "Organization";
    const projectTitle = answers.project_title || "Project";
    const category = (answers.category || "software").toLowerCase();

    if (!organizationName.trim() || !projectTitle.trim()) {
      setError("Please provide an organization name and project title before generating the RFP.");
      setMessages((prev) => [...prev, { role: "bot", text: "I still need the organization name and project title before I can generate the RFP." }]);
      return;
    }

    if (wizardStep === 2 && qaReview && !qaSuggestionsResolved) {
      setError("Please choose auto, custom, or skip for every QA suggestion before generating.");
      setMessages((prev) => [...prev, { role: "bot", text: "I still need a decision for each QA suggestion before I can generate the RFP." }]);
      return;
    }

    if (selectedSubsystems.size === 0) {
      setError("Please select Common RFP or at least one subsystem before generating.");
      setMessages((prev) => [...prev, { role: "bot", text: "Select Common RFP or one or more subsystems before I generate the file." }]);
      return;
    }

    setFlowState("generating");
    setWizardStep(3);
    setError(null);
    setResult(null);
    setPdfBase64(null);
    setDecomposition(null);
    setMandatoryCriteria({
      loading: false,
      ready: false,
      targets: [],
      activeTargetIndex: 0,
      criteriaByTarget: {},
      error: null,
    });
    setProgress(null);
    setMessages([]);
    setInputValue("");
    setDownloadTarget("full");
    setEditTarget("full");

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    // Build input
    const finalAnswers = { ...answers };
    if (!finalAnswers.organization_name && profile?.company_name) finalAnswers.organization_name = profile.company_name;
    // Fill unfilled with auto
    for (const q of RFP_QUESTIONS) {
      if (!finalAnswers[q.key]) finalAnswers[q.key] = "auto";
    }
    if (!finalAnswers[FINAL_INTAKE_KEY]) finalAnswers[FINAL_INTAKE_KEY] = "";

    const qaRevisionNotes = buildQaRevisionNotes();

    const sections: Record<string, string> = {};
    for (const q of RFP_QUESTIONS) {
      if (!q.isMetadata && q.key !== "detailed_project_description") {
        sections[q.key] = finalAnswers[q.key];
      }
    }

    const input: RfpInput = {
      organization_name: organizationName,
      project_title: projectTitle,
      category: category || "software",
      sections,
      detailed_project_description: finalAnswers.detailed_project_description || "",
      additional_details: finalAnswers[FINAL_INTAKE_KEY] || "",
      selected_template: selectedTemplate,
      selectedSubsystems: Array.from(selectedSubsystems),
      qaReview: qaReview || undefined,
      qaRevisionNotes: qaRevisionNotes || undefined,
      precomputedDecomposition: decompositionAnalysis
        ? {
            subsystems: decompositionAnalysis.subsystems,
            inferredRequirements: decompositionAnalysis.inferredRequirements || [],
            needsDecomposition: decompositionAnalysis.needsDecomposition,
          }
        : undefined,
    };

    console.log("🚀 [GENERATE START] Sending RfpInput:", {
      organization_name: input.organization_name,
      project_title: input.project_title,
      category: input.category,
      selected_template: input.selected_template,
      selectedSubsystems: input.selectedSubsystems,
      subsystemCount: input.selectedSubsystems?.length,
      hasPrecomputedDecomposition: !!input.precomputedDecomposition,
      precomputedSubsystems: input.precomputedDecomposition?.subsystems ? Object.keys(input.precomputedDecomposition.subsystems) : "N/A",
      // DEBUG: Show all sections being sent
      sections_keys: Object.keys(input.sections),
      sections: input.sections,
      detailed_project_description_length: input.detailed_project_description?.length || 0,
      additional_details_length: input.additional_details?.length || 0,
    });

    try {
      await startBackgroundRfpGeneration(input, user?.id || profile?.company_name || "anonymous", {
        onProgress: (progress) => {
          setProgress(progress);
        },
        onResult: (generatedResult, generatedPdfBase64, generatedDecomposition) => {
          setResult(generatedResult);
          setPdfBase64(generatedPdfBase64);
          setDecomposition(generatedDecomposition);
          setProgress(null);
          setFlowState("review");
          setWizardStep(3);
          try {
            window.localStorage.setItem(
              "rfp-editor-draft",
              JSON.stringify({
                metadata: generatedResult.metadata,
                sections: generatedResult.sections,
                sectionLabels: generatedResult.sectionLabels,
                template: generatedResult.template,
                pdfBase64: generatedPdfBase64,
                decomposition: generatedDecomposition,
              }),
            );
          } catch {
            /* ignore storage failures */
          }
        },
        onError: (message) => {
          setError(message);
          setFlowState("review");
          setWizardStep(3);
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setFlowState("review");
      setMessages((prev) => [...prev, { role: "bot", text: `Error: ${msg}` }]);
    }
  };

  /* ─── Download helpers ─── */
  const downloadBlob = (base64: string, filename: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = useCallback(() => {
    if (!pdfBase64) return;
    downloadBlob(pdfBase64, `${result?.metadata.project_title || "RFP"}-Full.pdf`);
  }, [pdfBase64, result?.metadata.project_title]);

  const downloadSubsystemPdf = useCallback((subsystemName: string) => {
    const pdf = decomposition?.subsystemDrafts?.find((draft) => draft.name === subsystemName);
    if (!pdf?.pdfBase64) return;
    downloadBlob(pdf.pdfBase64, `RFP-${subsystemName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
  }, [decomposition]);

  const buildEditorDraft = useCallback((target: TargetRfp): EditorDraftSnapshot | null => {
    if (target === "full") {
      if (!result || !pdfBase64) return null;
      return {
        metadata: result.metadata,
        sections: result.sections,
        sectionLabels: result.sectionLabels,
        template: result.template as PdfTemplate,
        pdfBase64,
        sourcePdfBase64: pdfBase64,
        decomposition,
        updatedAt: new Date().toISOString(),
      };
    }

    const subsystemDraft = decomposition?.subsystemDrafts?.find((draft) => draft.name === target);
    if (!subsystemDraft) return null;

    return {
      metadata: subsystemDraft.metadata,
      sections: subsystemDraft.sections,
      sectionLabels: subsystemDraft.sectionLabels,
      template: subsystemDraft.template,
      pdfBase64: subsystemDraft.pdfBase64,
      sourcePdfBase64: subsystemDraft.pdfBase64,
      decomposition,
      subsystemName: subsystemDraft.name,
      updatedAt: new Date().toISOString(),
    };
  }, [decomposition, pdfBase64, result]);

  const openEditorForTarget = useCallback((target: TargetRfp) => {
    // Prefer per-target persisted draft if present (restores previous edits reliably)
    let draft: EditorDraftSnapshot | null = null;
    try {
      const key = `${EDITOR_DRAFT_KEY}:${target}`;
      const raw = window.localStorage.getItem(key);
      if (raw) draft = JSON.parse(raw) as EditorDraftSnapshot;
    } catch {
      /* ignore */
    }
    if (!draft) {
      draft = buildEditorDraft(target);
    }
    if (!draft) {
      setError(target === "full" ? "The full RFP is not ready yet." : `Subsystem draft for ${target} is not ready yet.`);
      return;
    }

    try {
      const withReturn = { ...draft, returnTo: window.location.pathname + window.location.search };
      window.localStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(withReturn));
      try { window.localStorage.setItem(SELECTED_TARGET_KEY, target); } catch {}
      // also ensure a per-target draft record exists so subsequent Edit uses the same content
      try { window.localStorage.setItem(`${EDITOR_DRAFT_KEY}:${target}`, JSON.stringify(withReturn)); } catch {}
    } catch {
      /* ignore storage failures */
    }
    router.push("/rfp/editor");
  }, [buildEditorDraft, router]);

  const downloadSelectedRfp = useCallback((target: TargetRfp) => {
    if (target === "full") {
      downloadPdf();
      return;
    }
    downloadSubsystemPdf(target);
  }, [downloadPdf, downloadSubsystemPdf]);

  const downloadMarkdown = () => {
    if (!result) return;
    const md = Object.entries(result.sections)
      .map(([key, val]) => `## ${result.sectionLabels[key] || key}\n\n${val}`)
      .join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.metadata.project_title || "RFP"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveToMyContracts = async () => {
    if (!result || !user || saving || saved) return;
    setSaving(true);
    try {
      const commonFields = {
        budget: answers.budget_framework || "TBD",
        deadline: answers.implementation_timeline || "TBD",
        status: "draft" as const,
        industry: result.metadata.category,
        posted_by: user.id,
        posted_by_name: profile?.company_name || (user as any).user_metadata?.full_name || user.email || "Unknown",
        poster_verified: profile?.verified || false,
        rfp_metadata: {
          ...result.metadata,
          mandatory_criteria: buildMandatoryCriteriaPayload(mandatoryCriteria.criteriaByTarget, mandatoryCriteria.targets, mandatoryCriteria.activeTargetIndex),
        },
        rfp_qa: result.qa,
        rfp_template: result.template,
        created_at: new Date().toISOString(),
      };

      const normalizeName = (value: string) => value.trim().toLowerCase().replace(/_/g, " ");
      const fullSelected = selectedSubsystems.has("full");
      const subsystemDrafts = decomposition?.subsystemDrafts || [];
      const subsystemPdfs = decomposition?.subsystemPdfs || [];
      const availableSubsystemNames = Array.from(new Set([
        ...subsystemDrafts.map((draft) => draft.name),
        ...subsystemPdfs.map((pdf) => pdf.name),
      ]));

      // Build the list of subsystem outputs from selected subsystem names first,
      // then fall back to all available drafts/PDFs.
      const selectedForSave = fullSelected
        ? []
        : (selectedSubsystemNames.length > 0 ? selectedSubsystemNames : availableSubsystemNames);

      const subsystemOutputs = selectedForSave
        .map((name) => {
          const draft = subsystemDrafts.find((item) => normalizeName(item.name) === normalizeName(name));
          const pdf = subsystemPdfs.find((item) => normalizeName(item.name) === normalizeName(name));
          if (!draft && !pdf) return null;
          return {
            name: draft?.name || pdf?.name || name,
            sections: draft?.sections || result.sections,
            sectionLabels: draft?.sectionLabels || result.sectionLabels,
            metadata: draft?.metadata || result.metadata,
            template: draft?.template || result.template,
            pdfBase64: draft?.pdfBase64 || pdf?.pdfBase64 || "",
          };
        })
        .filter((item): item is {
          name: string;
          sections: Record<string, string>;
          sectionLabels: Record<string, string>;
          metadata: { organization_name: string; project_title: string; category: string; date: string };
          template: string;
          pdfBase64: string;
        } => Boolean(item && item.name));

      const hasSubsystemOutputs = subsystemOutputs.length > 0;
      const shouldSaveFull = fullSelected;

      // If this is from v6 (embedded mode), call the callback instead of saving to database
      if (contractId && onRfpGenerated) {
        onRfpGenerated({
          title: result.metadata.project_title,
          sections: result.sections,
          sectionLabels: result.sectionLabels,
          pdfBase64: pdfBase64 || "",
          metadata: result.metadata,
          mandatoryCriteria,
        });
        setSaved(true);
        setMessages((prev) => [...prev, { role: "bot", text: "RFP generated! Returning to contract view..." }]);
        onSaved?.();
        return;
      }

      // Otherwise, save to Supabase (standalone mode)
      const saves: Promise<any>[] = [];

      if (shouldSaveFull) {
        saves.push(
          (supabase.from("contracts").insert({
            ...commonFields,
            title: result.metadata.project_title,
            description: Object.values(result.sections).find(Boolean)?.slice(0, 300) || result.metadata.project_title,
            rfp_sections: result.sections,
            rfp_section_labels: result.sectionLabels,
            rfp_pdf_base64: pdfBase64 || "",
            rfp_decomposition: null,
            last_analysis_result: {
              ...result.qa,
              mandatory_criteria: buildMandatoryCriteriaPayload(mandatoryCriteria.criteriaByTarget, ["full"], 0),
            },
            rfp_metadata: {
              ...commonFields.rfp_metadata,
              mandatory_criteria: buildMandatoryCriteriaPayload(mandatoryCriteria.criteriaByTarget, ["full"], 0),
            },
          }).select()) as unknown as Promise<any>
        );
      }

      // Save each subsystem as a separate contract too
      if (hasSubsystemOutputs) {
        for (const sub of subsystemOutputs) {
          const targetKey = mandatoryCriteria.targets.find((target) => normalizeName(target) === normalizeName(sub.name)) || sub.name;
          const subsystemCriteriaPayload = buildMandatoryCriteriaPayload(
            mandatoryCriteria.criteriaByTarget,
            [targetKey],
            0,
          );

          saves.push(
            (supabase.from("contracts").insert({
              ...commonFields,
              title: `${sub.metadata.project_title} — ${sub.name}`,
              description: `Subsystem RFP for "${sub.name}" decomposed from ${result.metadata.project_title}`.slice(0, 300),
              rfp_sections: sub.sections,
              rfp_section_labels: sub.sectionLabels,
              rfp_pdf_base64: sub.pdfBase64 || "",
              rfp_decomposition: {
                subsystems: decomposition!.subsystems,
                inferredRequirements: decomposition!.inferredRequirements,
                needsDecomposition: true,
                subsystemName: sub.name,
              },
              rfp_metadata: {
                ...commonFields.rfp_metadata,
                ...sub.metadata,
                mandatory_criteria: subsystemCriteriaPayload,
              },
              rfp_template: sub.template,
              last_analysis_result: {
                ...result.qa,
                mandatory_criteria: subsystemCriteriaPayload,
              },
            }).select()) as unknown as Promise<any>
          );
        }
      }

      await Promise.all(saves);
      setSaved(true);

      if (shouldSaveFull) {
        setMessages((prev) => [...prev, { role: "bot", text: "Full RFP saved to My Contracts. Go to the **My Contracts** tab to approve and publish it." }]);
      } else if (hasSubsystemOutputs) {
        const total = subsystemOutputs.length;
        setMessages((prev) => [...prev, { role: "bot", text: `All **${total} selected subsystem RFP${total > 1 ? "s" : ""}** saved to My Contracts. Go to the **My Contracts** tab to approve and publish.` }]);
      } else {
        setMessages((prev) => [...prev, { role: "bot", text: "No generated subsystem output found for the selected items, so nothing was saved." }]);
      }
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { role: "bot", text: `Failed to save: ${msg}` }]);
    }
    setSaving(false);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="card" style={{ maxWidth: 800, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--card-border)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" fill="#EFECE3" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z" /></svg>
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>RFP Generator</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {flowState === "idle" && "Intake in progress"}
            {flowState === "generating" && `Generating... ${formatTime(elapsed)}`}
            {flowState === "review" && "Complete"}
          </div>
        </div>
      </div>

      {/* Stage progress */}
      <div style={{ padding: "12px 20px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
          {[
            { label: "1. Intake", active: wizardStep === 1, done: wizardStep > 1 },
            { label: "2. QA Review", active: wizardStep === 2, done: wizardStep > 2 },
            { label: "3. Results", active: wizardStep === 3, done: wizardStep > 3 },
            { label: "4. Mandatory Criteria", active: wizardStep === 4, done: false },
          ].map((step) => (
            <div
              key={step.label}
              style={{
                padding: "8px 10px",
                borderRadius: 999,
                textAlign: "center",
                fontSize: 12,
                fontWeight: 600,
                background: step.active ? "var(--primary)" : step.done ? "var(--primary-light)" : "var(--surface)",
                color: step.active ? "#EFECE3" : "var(--foreground)",
                border: "1px solid var(--card-border)",
              }}
            >
              {step.label}
            </div>
          ))}
        </div>
      </div>

      {/* Chat messages */}
      {wizardStep === 1 && (
        <div ref={chatScrollRef} style={{ height: 400, overflowY: "auto", padding: "16px 20px" }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  background: msg.role === "user" ? "var(--primary)" : "var(--surface)",
                  color: msg.role === "user" ? "#EFECE3" : "var(--foreground)",
                  border: msg.role === "bot" ? "1px solid var(--card-border)" : "none",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                }}
                dangerouslySetInnerHTML={{
                  __html: msg.text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
                }}
              />
            </div>
          ))}

          {/* Progress bar during generation */}
          {flowState === "generating" && activeGenerationProgress && (
            <div style={{ background: "var(--surface)", borderRadius: 12, padding: "14px 16px", marginTop: 8 }}>
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
          )}
        </div>
      )}

        {/* Error display */}
        {error && (
          <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: 8, padding: 12, marginTop: 8, color: "var(--danger)", fontSize: 13 }}>
            {error}
          </div>
        )}

        {wizardStep === 3 && generationSnapshot.status === "running" && activeGenerationProgress && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: 12, padding: 14, marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
              <strong style={{ color: "var(--foreground)" }}>{activeGenerationProgress.stage}</strong>
              <span>{activeGenerationProgress.percent}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "var(--surface-hover)", overflow: "hidden", marginBottom: 8 }}>
              <div style={{ height: "100%", width: `${activeGenerationProgress.percent}%`, background: "var(--primary)", borderRadius: 999, transition: "width 0.4s ease" }} />
            </div>
            <div>{activeGenerationProgress.message}</div>
            <div style={{ marginTop: 8 }}>Generation is running in the background. You can leave this page and keep exploring while it finishes.</div>
          </div>
        )}

        {wizardStep === 2 && qaReview && (
          <div className="animate-fadeIn" style={{ marginTop: 12 }}>
            <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: qaReview.overallScore >= 70 ? "var(--success)" : qaReview.overallScore >= 40 ? "var(--warning)" : "var(--danger)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#EFECE3",
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  {qaReview.overallScore}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>QA Review Score</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {qaReview.readinessLevel === "ready" ? "Ready for distribution" : qaReview.readinessLevel === "needs_minor_edits" ? "Needs minor edits" : "Needs revisions"}
                  </div>
                </div>
              </div>
              {qaReview.strengths.length > 0 && (
                <div style={{ fontSize: 12 }}>
                  <strong>Strengths:</strong> {qaReview.strengths.slice(0, 3).join(", ")}
                </div>
              )}
              {qaReview.improvements.length > 0 && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <strong>Suggestions:</strong>
                  <ul style={{ margin: "6px 0 0 18px", padding: 0, display: "grid", gap: 4 }}>
                    {qaReview.improvements.slice(0, 5).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Fix suggestions before generation</div>
              <div style={{ display: "grid", gap: 12 }}>
                {qaReview.improvements.map((improvement, index) => {
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
                      {state.mode === "auto" && (
                        <div style={{ fontSize: 12, color: "var(--success)" }}>AI will apply this suggestion automatically.</div>
                      )}
                      {state.mode === "skip" && (
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>Suggestion skipped. Generation will continue without this change.</div>
                      )}
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
                <button className="btn-primary" onClick={startGeneration} disabled={!qaSuggestionsResolved || qaLoading || selectedSubsystems.size === 0}>
                  Generate RFP
                </button>
                <button className="btn-outline" onClick={() => setWizardStep(1)}>
                  Back to intake
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results: QA + Download */}
        {wizardStep === 3 && result && (
          <div className="animate-fadeIn" style={{ marginTop: 12 }}>
            <div style={{ background: "linear-gradient(180deg, var(--surface) 0%, rgba(239,236,227,0.7) 100%)", borderRadius: 18, padding: 18, marginBottom: 12, border: "1px solid var(--card-border)" }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--muted)", marginBottom: 8 }}>File summary</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)", marginBottom: 8 }}>
                {result.metadata.project_title}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, maxWidth: 860 }}>
                {selectedSubsystems.has("full")
                  ? "The AI generated the common combined RFP from your intake answers, and it is available as the selected file."
                  : selectedSubsystemNames.length > 0
                    ? `The AI generated only the subsystem files you selected during intake: ${selectedSubsystemNames.join(", ")}.`
                    : "The AI generated the RFP set from your intake answers, ready to download or edit."}
              </div>
            </div>

            <div style={{ background: "var(--surface)", borderRadius: 16, padding: 16, border: "1px solid var(--card-border)", display: "grid", gap: 14 }}>
              <div style={{ background: "rgba(239,236,227,0.65)", borderRadius: 14, padding: 14, border: "1px solid var(--card-border)" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: "var(--muted)", marginBottom: 8 }}>File selector</div>
                <div style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6, marginBottom: 12 }}>Choose one generated file and use the same selector for download or edit.</div>
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                    Select file
                    <select className="input-field" value={downloadTarget} onChange={(event) => {
                      const nextTarget = event.target.value as TargetRfp;
                      setDownloadTarget(nextTarget);
                      setEditTarget(nextTarget);
                      try { window.localStorage.setItem(SELECTED_TARGET_KEY, nextTarget); } catch {}
                    }}>
                      {availableFileTargets.includes("full") && <option value="full">Common RFP</option>}
                      {generatedSubsystemDrafts.map((draft) => (
                        <option key={draft.name} value={draft.name}>{draft.name}</option>
                      ))}
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
                <button className="btn-primary" onClick={() => setWizardStep(4)} disabled={saving} style={{ gap: 6 }}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  Next
                </button>
              )}

              <button
                className="btn-ghost"
                onClick={() => {
                  setFlowState("idle");
                  setWizardStep(1);
                  setAnswers({});
                  setSelectedTemplate("software");
                  setTemplateTouched(false);
                  setSelectedSubsystems(new Set());
                  setDecompositionAnalysis(null);
                  setDecompositionLoading(false);
                  setQaReview(null);
                  setQaSuggestionStates({});
                  setQaLoading(false);
                  setForcedQuestionKey(null);
                  setMandatoryCriteria({
                    loading: false,
                    ready: false,
                    targets: [],
                    activeTargetIndex: 0,
                    criteriaByTarget: {},
                    error: null,
                  });
                  setMessages([
                    { role: "bot", text: "Let's generate a new RFP. I will ask 19 questions one by one." },
                    { role: "bot", text: RFP_QUESTIONS[0].label },
                  ]);
                  setResult(null);
                  setPdfBase64(null);
                  setDecomposition(null);
                  setProgress(null);
                  setError(null);
                  setElapsed(0);
                  setSaved(false);
                }}
              >
                Start Over
              </button>

            </div>

            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14, color: "var(--primary)" }}>Preview Sections ({Object.keys(result.sections).length})</summary>
              <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto" }}>
                {Object.entries(result.sections).map(([key, val]) => (
                  <div key={key} style={{ marginBottom: 12, padding: "8px 12px", background: "var(--surface)", borderRadius: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--primary)" }}>{result.sectionLabels[key] || key}</div>
                    <div style={{ whiteSpace: "pre-wrap", color: "var(--muted)", maxHeight: 100, overflow: "hidden" }}>
                      {val.slice(0, 300)}{val.length > 300 ? "..." : ""}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {wizardStep === 4 && result && (
          <div style={{ padding: "0 20px 20px" }}>
            <div className="animate-fadeIn" style={{ marginTop: 12 }}>
              <MandatoryCriteriaPhase
                title="4. Mandatory Criteria"
                subtitle="The AI-preloaded thresholds are ready. Adjust the sliders, add or remove criteria for the current subsystem, and move through the selected subsystems in order before saving all of them together."
                targets={mandatoryCriteria.targets.length > 0 ? mandatoryCriteria.targets : mandatoryTargets}
                activeTargetIndex={mandatoryCriteria.activeTargetIndex}
                criteriaByTarget={mandatoryCriteria.criteriaByTarget}
                loading={mandatoryCriteria.loading}
                ready={(mandatoryCriteria.targets.length > 0 ? mandatoryCriteria.targets : mandatoryTargets).length > 0 && !mandatoryCriteria.loading}
                onBack={handleMandatoryCriteriaBack}
                onNext={handleMandatoryCriteriaNext}
                onSaveAll={saveToMyContracts}
                onAddCriterion={addMandatoryCriterion}
                onRemoveCriterion={removeMandatoryCriterion}
                onUpdateCriterion={updateMandatoryCriterion}
              />
            </div>
          </div>
        )}

      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--card-border)" }}>
        {wizardStep === 1 && flowState === "idle" && currentQuestion && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              className="input-field"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={currentQuestion?.placeholder || "Type your response here..."}
              rows={3}
              style={{ flex: 1, resize: "none" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-primary" style={{ fontSize: 13, padding: "6px 16px" }} onClick={() => submitAnswer(inputValue)} disabled={intaking}>
                {intaking ? "Thinking..." : "Send"}
              </button>
            </div>
          </div>
        )}

        {wizardStep === 1 && flowState === "idle" && intakeComplete && !decompositionLoading && (
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {/* Decomposition Selection UI */}
            {decompositionAnalysis?.subsystems && Object.keys(decompositionAnalysis.subsystems).length > 0 && (
              <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, border: "1px solid var(--card-border)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginBottom: 12 }}>
                  Choose which RFPs to generate
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {/* Full RFP checkbox */}
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selectedSubsystems.has("full")}
                      onChange={(e) => {
                        const newSet = new Set(selectedSubsystems);
                        if (e.target.checked) {
                          newSet.add("full");
                          // When checking "full", uncheck all subsystems
                          Object.keys(decompositionAnalysis.subsystems).forEach((name) => newSet.delete(name));
                        } else {
                          newSet.delete("full");
                        }
                        setSelectedSubsystems(newSet);
                      }}
                      style={{ marginTop: 4, cursor: "pointer", width: 18, height: 18 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--primary)" }}>Full RFP Only</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>Single comprehensive RFP document</div>
                    </div>
                  </label>

                  {/* Subsystem checkboxes */}
                  {Object.entries(decompositionAnalysis.subsystems).map(([subsystemName, description]) => (
                    <label key={subsystemName} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedSubsystems.has(subsystemName) && !selectedSubsystems.has("full")}
                        onChange={(e) => {
                          const newSet = new Set(selectedSubsystems);
                          if (e.target.checked) {
                            newSet.delete("full");
                            newSet.add(subsystemName);
                            console.log(`✓ Selected subsystem: "${subsystemName}"`, "Current selection:", Array.from(newSet));
                          } else {
                            newSet.delete(subsystemName);
                            console.log(`✗ Deselected subsystem: "${subsystemName}"`, "Current selection:", Array.from(newSet));
                          }
                          setSelectedSubsystems(newSet);
                        }}
                        style={{ marginTop: 4, cursor: "pointer", width: 18, height: 18 }}
                        disabled={selectedSubsystems.has("full")}
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{subsystemName}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{String(description).slice(0, 80)}...</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>Choose a PDF template</div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
              {(Object.keys(TEMPLATE_PREVIEWS) as PdfTemplate[]).map((template) => {
                const preview = TEMPLATE_PREVIEWS[template];
                const active = selectedTemplate === template;
                return (
                  <button
                    key={template}
                    type="button"
                    onClick={() => { setSelectedTemplate(template); setTemplateTouched(true); }}
                    style={{
                      textAlign: "left",
                      padding: 0,
                      border: active ? "2px solid var(--primary)" : "1px solid var(--card-border)",
                      borderRadius: 16,
                      overflow: "hidden",
                      background: "var(--surface)",
                      boxShadow: active ? "0 10px 28px rgba(0,0,0,0.12)" : "none",
                    }}
                  >
                    <div style={{ height: 84, background: preview.accent, padding: 14, color: "#EFECE3", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.4, opacity: 0.8 }}>Template Preview</div>
                      <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{preview.title}</div>
                    </div>
                    <div style={{ padding: 14 }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", minHeight: 42 }}>{preview.subtitle}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                        {preview.chips.map((chip) => (
                          <span key={chip} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 999, background: "var(--surface-hover)", color: "var(--foreground-secondary)" }}>{chip}</span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button className="btn-primary" style={{ width: "100%", padding: "12px 20px", fontSize: 15 }} onClick={runQaReview} disabled={qaLoading}>
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
              {qaLoading ? "Reviewing..." : "Next"}
            </button>
          </div>
        )}

        {wizardStep === 1 && flowState === "idle" && intakeComplete && decompositionLoading && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid var(--card-border)", background: "var(--surface)", color: "var(--muted)", fontSize: 13 }}>
            Analyzing project structure before showing subsystem options and template selection...
          </div>
        )}

        {wizardStep === 3 && flowState === "generating" && (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 8 }}>
            Pipeline running... {formatTime(elapsed)} elapsed
          </div>
        )}
      </div>
    </div>
  );
}

