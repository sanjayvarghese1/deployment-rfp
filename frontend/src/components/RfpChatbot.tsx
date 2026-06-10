"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { RFP_QUESTIONS, FINAL_INTAKE_KEY, getFinalIntakeQuestionLabel, type PipelineProgress, type PipelineResult, type RfpInput, type DecompositionData, type PdfTemplate, type QAResult, type MandatoryCriterion, type MandatoryCriteriaRecommendation } from "@/lib/rfp/config";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { supabase } from "@/services/supabase";
import { getBackgroundGenerationSnapshot, resetBackgroundGeneration, startBackgroundRfpGeneration, subscribeBackgroundGeneration } from "@/lib/rfp/background";
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
const CHAT_STATE_KEY = "rfp-chat-state";

type ChatProgressStatus = "answered" | "skipped" | "current" | "pending";

interface ChatStateSnapshot {
  messages: ChatMessage[];
  answers: Record<string, string>;
  skippedQuestions: string[];
  questionWarnings: Record<string, number>;
  forcedQuestionKey: string | null;
  inputValue: string;
}

interface ChatProgressItem {
  key: string;
  label: string;
  status: ChatProgressStatus;
  index: number;
}

function getMissingQuestionLabel(key: string | null, fallback: string): string {
  if (!key) return fallback;
  return getQuestionLabelForKey(key) || fallback;
}

function createInitialChatMessages(): ChatMessage[] {
  return [
    { role: "bot", text: "Welcome! I will collect 19 RFP details one by one." },
    { role: "bot", text: RFP_QUESTIONS[0].label },
  ];
}

function isGreetingOnlyMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 40) return false;
  return /^(hi|hello|hey|good morning|good afternoon|good evening|greetings|sup|yo|hello there|hey there)[!.?\s]*$/i.test(normalized);
}

function isSkipRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 120) return false;

  return /\b(can't provide|cannot provide|cant provide|can't share|cannot share|can't answer|cannot answer|won't provide|won't share|don't know|do not know|not sure|unsure|prefer not|skip this|skip it|pass|none|n\/a|na|unable|don't have|do not have|no idea|no comment)\b/i.test(normalized)
    || /^(skip|pass|none|n\/a|na|not sure|unsure|no)$/i.test(normalized);
}

/** Returns a persuasive message explaining why a mandatory question should not be skipped. */
function getMandatorySkipMessage(key: string, label: string): string {
  const shortLabel = label.replace(/ \(or type .*?\)/, "").replace(/\?$/, "");
  const tips: Record<string, string> = {
    organization_name: "Your organization\u2019s name is required \u2014 it appears throughout the RFP document and on the cover page. Please provide it (even a short name works).",
    project_title: "A project title is essential \u2014 it identifies the RFP to vendors. Please provide a title, even a working one.",
    category: "The project category determines the tone and template of your RFP. Please select one: software, manufacturing, logistics, construction, or other.",
    organization_background: "Organization background helps vendors understand who they\u2019d be working with. You can type \"auto\" and the AI will generate it for you.",
    project_overview: "The project overview is one of the first things vendors read. It\u2019s critical for context. Type \"auto\" if you prefer the AI to handle it.",
    project_objectives: "Objectives define what success looks like \u2014 vendors need these to tailor their proposals. Type \"auto\" to have the AI draft them.",
    scope_of_work: "Scope of work is a core RFP section that defines exactly what must be delivered. Type \"auto\" if you\u2019d like the AI to draft it.",
    detailed_project_description: "A detailed description is crucial for generating a high-quality RFP. Type \"auto\" and the AI will draft it from the context you\u2019ve already provided.",
    technical_requirements: "Technical requirements tell vendors what specifications to meet. Type \"auto\" to let the AI infer them from your project details.",
    deliverables: "Deliverables define what vendors must hand over \u2014 this is non-negotiable in an RFP. Type \"auto\" to auto-generate them.",
    vendor_qualifications: "Vendor qualifications protect you by filtering out unqualified bidders. Type \"auto\" to let the AI recommend sensible defaults.",
    implementation_timeline: "A timeline sets expectations for delivery. Without it, vendors can\u2019t estimate effort or cost. Type \"auto\" to generate a draft.",
    budget_framework: "Budget information guides vendor proposals and prevents mismatched bids. Type \"auto\" if you prefer the AI to suggest a framework.",
    evaluation_criteria: "Evaluation criteria ensure a fair and transparent vendor selection process. Type \"auto\" to have the AI propose a scoring model.",
    risk_management: "Risk management demonstrates maturity and helps vendors plan for contingencies. Type \"auto\" to auto-draft this section.",
    legal_and_contractual: "Legal & contractual terms protect your organization in any agreement with a vendor. Even a brief note on IP ownership or NDA requirements is valuable. Type \"auto\" to have the AI draft standard clauses.",
    contact_information: "Contact information is how vendors reach you with questions and submit proposals. It\u2019s a required section in any professional RFP. Type \"auto\" if you\u2019d like the AI to insert placeholder details.",
  };
  return tips[key] || `\"${shortLabel}\" is a core part of the RFP that vendors depend on. You can always type \"auto\" and the AI will write it based on your other answers.`;
}

function isBoilerplateSummary(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  return normalized.includes("greeting received") || normalized.includes("follow-up") || normalized.includes("follow up");
}

function getFriendlyAcknowledge(text: string): string {
  if (!text || isBoilerplateSummary(text)) return "";
  return text.replace(/\s+/g, " ").trim();
}

function clearEditorDraftStorage() {
  try {
    window.localStorage.removeItem(EDITOR_DRAFT_KEY);
    window.localStorage.removeItem(SELECTED_TARGET_KEY);
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(`${EDITOR_DRAFT_KEY}:`)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures and continue with the reset.
  }
}

function clearRfpSessionStorage() {
  try {
    window.sessionStorage.removeItem("rfp-upload-analysis");
    window.sessionStorage.removeItem("rfp-uploaded-pdf-name");
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index++) {
      const key = window.sessionStorage.key(index);
      if (key && key.startsWith("rfp-uploaded-pdf:")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures and continue with the reset.
  }
}

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
  initialUploadAnalysis?: UploadAnalysisPayload | null;
  onRfpGenerated?: (data: {
    title: string;
    sections: Record<string, string>;
    sectionLabels: Record<string, string>;
    pdfBase64: string;
    metadata: { organization_name: string; project_title: string; category: string; date: string };
    mandatoryCriteria?: MandatoryCriteriaState;
  }) => void;
}

export interface UploadAnalysisPayload {
  overallScore: number;
  suggestions: string[];
  strengths: string[];
  analysis: {
    fileName: string;
    extractedText: string;
    sections: Record<string, string>;
    metadata?: {
      title?: string;
      author?: string;
      creationDate?: string;
    };
  };
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

function getNextRequiredKey(answers: Record<string, string>, skippedQuestions: Set<string> = new Set()): string | null {
  for (const key of INTAKE_ORDER) {
    if (skippedQuestions.has(key)) continue;
    const value = answers[key];
    if (!value || !value.trim()) return key;
  }
  return null;
}

function getNextConversationKey(answers: Record<string, string>, skippedQuestions: Set<string> = new Set()): string | null {
  for (const question of RFP_QUESTIONS) {
    if (skippedQuestions.has(question.key)) continue;
    const value = answers[question.key];
    if (!value || !value.trim()) return question.key;
  }
  if (!skippedQuestions.has(FINAL_INTAKE_KEY) && (!answers[FINAL_INTAKE_KEY] || !answers[FINAL_INTAKE_KEY].trim())) {
    return FINAL_INTAKE_KEY;
  }
  return null;
}

function getNextRequiredGenerationKey(answers: Record<string, string>, skippedQuestions: Set<string> = new Set()): string | null {
  for (const question of RFP_QUESTIONS) {
    if (question.key === FINAL_INTAKE_KEY) continue;
    if (skippedQuestions.has(question.key)) continue;
    const value = answers[question.key];
    if (!value || !value.trim()) return question.key;
  }
  return null;
}

function toTitleCaseFromKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getQuestionLabelForKey(key: string | null): string | null {
  if (!key) return null;
  if (key === FINAL_INTAKE_KEY) return getFinalIntakeQuestionLabel();
  return RFP_QUESTIONS.find((question) => question.key === key)?.label || toTitleCaseFromKey(key);
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function loadPersistedChatState(): Partial<ChatStateSnapshot> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHAT_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatStateSnapshot>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export default function RfpChatbot({ onSaved, contractId, onRfpGenerated, initialUploadAnalysis }: RfpChatbotProps = {}) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const persistedChatState = loadPersistedChatState();
  const [answers, setAnswers] = useState<Record<string, string>>(() => (persistedChatState?.answers && typeof persistedChatState.answers === "object" ? persistedChatState.answers : {}));
  const [inputValue, setInputValue] = useState(() => (typeof persistedChatState?.inputValue === "string" ? persistedChatState.inputValue : ""));
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplate>("software");
  const [templateTouched, setTemplateTouched] = useState(false);
  const [selectedSubsystems, setSelectedSubsystems] = useState<Set<string>>(new Set());
  const [decompositionAnalysis, setDecompositionAnalysis] = useState<DecompositionData | null>(null);
  const [decompositionLoading, setDecompositionLoading] = useState(false);
  const [qaReview, setQaReview] = useState<QAResult | null>(null);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaSuggestionStates, setQaSuggestionStates] = useState<Record<number, QaSuggestionState>>({});
  const [forcedQuestionKey, setForcedQuestionKey] = useState<string | null>(() => (typeof persistedChatState?.forcedQuestionKey === "string" || persistedChatState?.forcedQuestionKey === null ? persistedChatState.forcedQuestionKey ?? null : null));
  const [skippedQuestions, setSkippedQuestions] = useState<Set<string>>(() => new Set((persistedChatState?.skippedQuestions || []).filter((key): key is string => typeof key === "string")));
  const [questionWarnings, setQuestionWarnings] = useState<Record<string, number>>(
    () => (persistedChatState?.questionWarnings && typeof persistedChatState.questionWarnings === "object" ? persistedChatState.questionWarnings : {})
  );
  const [generationSnapshot, setGenerationSnapshot] = useState(getBackgroundGenerationSnapshot());
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const restoredMessages = persistedChatState?.messages;
    if (Array.isArray(restoredMessages) && restoredMessages.length > 0) {
      return restoredMessages.filter((item) => item && (item.role === "bot" || item.role === "user") && typeof item.text === "string");
    }
    return createInitialChatMessages();
  });
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
  const uploadInitRef = useRef(false);

  // Pre-fetch QA cache: keyed by a fingerprint of answers+skipped so stale results are discarded.
  const qaPrefetchRef = useRef<{ fingerprint: string; promise: Promise<QaReviewResponse> | null; result: QaReviewResponse | null }>({ fingerprint: "", promise: null, result: null });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const progressScrollRef = useRef<HTMLDivElement>(null);
  const activeProgressItemRef = useRef<HTMLButtonElement | null>(null);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = chatScrollRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior });
    });
  }, []);

  useEffect(() => {
    if (wizardStep === 4) {
      setSaved(false);
      setSaving(false);
    }
  }, [wizardStep]);

  useIsomorphicLayoutEffect(() => {
    try {
      const snapshot: ChatStateSnapshot = {
        messages,
        answers,
        skippedQuestions: Array.from(skippedQuestions),
        questionWarnings,
        forcedQuestionKey,
        inputValue,
      };
      window.localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage failures.
    }
  }, [answers, forcedQuestionKey, inputValue, messages, questionWarnings, skippedQuestions]);

  useEffect(() => {
    const syncChatStateFromStorage = () => {
      try {
        const raw = window.localStorage.getItem(CHAT_STATE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<ChatStateSnapshot>;
        if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
          setMessages(parsed.messages.filter((item) => item && (item.role === "bot" || item.role === "user") && typeof item.text === "string"));
        }
        if (parsed.answers && typeof parsed.answers === "object") {
          setAnswers(parsed.answers);
        }
        if (Array.isArray(parsed.skippedQuestions)) {
          setSkippedQuestions(new Set(parsed.skippedQuestions.filter((key): key is string => typeof key === "string")));
        }
        if (parsed.questionWarnings && typeof parsed.questionWarnings === "object") {
          setQuestionWarnings(parsed.questionWarnings);
        }
        if (typeof parsed.forcedQuestionKey === "string" || parsed.forcedQuestionKey === null) {
          setForcedQuestionKey(parsed.forcedQuestionKey ?? null);
        }
        if (typeof parsed.inputValue === "string") {
          setInputValue(parsed.inputValue);
        }
      } catch {
        // Ignore malformed storage entries.
      }
    };

    syncChatStateFromStorage();
    window.addEventListener("storage", syncChatStateFromStorage);
    return () => window.removeEventListener("storage", syncChatStateFromStorage);
  }, []);

  const currentPromptKey = forcedQuestionKey || getNextConversationKey(answers, skippedQuestions);
  const currentQuestion = currentPromptKey
    ? currentPromptKey === FINAL_INTAKE_KEY
      ? { key: FINAL_INTAKE_KEY, label: getFinalIntakeQuestionLabel(), placeholder: "Add any extra notes..." }
      : RFP_QUESTIONS.find((q) => q.key === currentPromptKey) || null
    : null;

  const questionProgress = useMemo<ChatProgressItem[]>(() => {
    return RFP_QUESTIONS.map((question, index) => {
      const hasAnswer = !!answers[question.key]?.trim();
      const isSkipped = skippedQuestions.has(question.key);
      const isCurrent = currentPromptKey === question.key && !hasAnswer;
      const status: ChatProgressStatus = isSkipped ? "skipped" : hasAnswer ? "answered" : isCurrent ? "current" : "pending";
      return { key: question.key, label: question.label, status, index };
    });
  }, [answers, currentPromptKey, skippedQuestions]);

  const completedCount = questionProgress.filter((item) => item.status === "answered").length;
  const skippedCount = questionProgress.filter((item) => item.status === "skipped").length;
  const completionPercent = Math.round((completedCount / Math.max(1, RFP_QUESTIONS.length)) * 100);

  useEffect(() => {
    if (wizardStep !== 1) return;
    scrollChatToBottom("auto");
  }, [currentPromptKey, generationSnapshot.progress, messages, progress, scrollChatToBottom, wizardStep]);

  useEffect(() => {
    if (wizardStep !== 1) return;
    activeProgressItemRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentPromptKey, wizardStep]);

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

  useEffect(() => {
    return subscribeBackgroundGeneration((snapshot) => {
      setGenerationSnapshot(snapshot);
      
      const expectedMode = initialUploadAnalysis ? "upload" : "scratch";
      const snapshotMode = snapshot.mode || "scratch";
      if (snapshotMode !== expectedMode) {
        return;
      }

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
        if (snapshot.error.includes("expired")) {
          // Reset the background generation immediately to clear the expired error
          resetBackgroundGeneration();
          setError(null);
          setFlowState("idle");
          setWizardStep(1);
        } else {
          setError(snapshot.error);
          setFlowState("review");
          setWizardStep(3);
        }
      }
    });
  }, [initialUploadAnalysis]);

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
    if (draft.decomposition && draft.decomposition.subsystemPdfs && draft.decomposition.subsystemPdfs.length > 0) {
      setDecomposition((prev) => {
        const base: DecompositionData = prev ? { ...prev } : { ...draft.decomposition! };
        base.subsystemPdfs = draft.decomposition!.subsystemPdfs;
        base.subsystemDrafts = draft.decomposition!.subsystemDrafts || base.subsystemDrafts;
        return base;
      });
    }
    setFlowState("review");
    setWizardStep(3);
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

  // Intake is complete when every question is either answered OR intentionally skipped.
  // We use getNextConversationKey (which covers all 20 RFP questions + the final optional
  // one) so that skipping the last question also reveals the subsystem/template panel.
  const intakeComplete = getNextConversationKey(answers, skippedQuestions) === null;
  const qaSuggestionsResolved = !qaReview || qaReview.improvements.every((_, index) => qaSuggestionStates[index]?.mode);

  const buildQaRevisionNotes = useCallback(() => {
    if (!qaReview) return "";
    return qaReview.improvements
      .map((improvement, index) => {
        const state = qaSuggestionStates[index];
        if (!state?.mode) return "";
        const note = state.note.trim();
        if (state.mode === "skip") return `Suggestion ${index + 1} skipped: ${improvement}`;
        if (state.mode === "auto" || !note || note.toLowerCase() === "auto") return `Suggestion ${index + 1} auto-applied by AI: ${improvement}`;
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

  useEffect(() => {
    if (!initialUploadAnalysis || uploadInitRef.current) return;
    uploadInitRef.current = true;

    let restoredDraft: EditorDraftSnapshot | null = null;
    try {
      const sessionRaw = window.sessionStorage.getItem(EDITOR_DRAFT_KEY) || window.sessionStorage.getItem("rfp-editor-draft");
      const localRaw = window.localStorage.getItem(EDITOR_DRAFT_KEY);
      const raw = sessionRaw || localRaw;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<EditorDraftSnapshot>;
        const hasSnapshot = !!parsed?.metadata && !!parsed?.sections && !!parsed?.sectionLabels && !!parsed?.template;
        if (hasSnapshot) restoredDraft = parsed as EditorDraftSnapshot;
      }
    } catch {
      restoredDraft = null;
    }

    const nowDate = new Date().toISOString().slice(0, 10);
    const uploadSections = initialUploadAnalysis.analysis.sections || {};
    const hasDetectedSections = Object.keys(uploadSections).length > 0;
    const sections = hasDetectedSections
      ? uploadSections
      : { project_overview: initialUploadAnalysis.analysis.extractedText.slice(0, 5000) };
    const sectionLabels = Object.fromEntries(Object.keys(sections).map((key) => [key, toTitleCaseFromKey(key)]));
    const projectTitle =
      initialUploadAnalysis.analysis.metadata?.title?.trim() ||
      initialUploadAnalysis.analysis.fileName?.replace(/\.pdf$/i, "") ||
      "Uploaded RFP";
    const category = (answers.category || "other").toLowerCase();

    const qaFromUpload: QAResult = {
      overallScore: Math.max(0, Math.min(100, Math.round(initialUploadAnalysis.overallScore))),
      missingSections: [],
      improvements: (initialUploadAnalysis.suggestions || []).slice(0, 6),
      strengths: (initialUploadAnalysis.strengths || []).slice(0, 5),
      readinessLevel:
        initialUploadAnalysis.overallScore >= 70 ? "ready" : initialUploadAnalysis.overallScore >= 40 ? "needs_minor_edits" : "needs_major_revisions",
      scoreExplanation: "Initial QA score generated from uploaded RFP analysis.",
    };

    setAnswers((current) => ({
      ...current,
      organization_name: current.organization_name || profile?.company_name || "Organization",
      project_title: current.project_title || projectTitle,
      category: current.category || category,
      detailed_project_description: current.detailed_project_description || initialUploadAnalysis.analysis.extractedText.slice(0, 5000),
    }));

    const initialMetadata = restoredDraft?.metadata || {
      organization_name: profile?.company_name || "Organization",
      project_title: projectTitle,
      category,
      date: nowDate,
    };

    setResult({
      sections: restoredDraft?.sections || sections,
      sectionLabels: restoredDraft?.sectionLabels || sectionLabels,
      metadata: initialMetadata,
      qa: qaFromUpload,
      template: (restoredDraft?.template as PdfTemplate) || selectedTemplate,
      decomposition: restoredDraft?.decomposition || {
        subsystems: {},
        inferredRequirements: [],
        needsDecomposition: false,
        subsystemPdfs: [],
        subsystemDrafts: [],
      },
    });
    if (restoredDraft?.pdfBase64) {
      setPdfBase64(restoredDraft.pdfBase64);
      setDecomposition(restoredDraft.decomposition || null);
    }
    setQaReview(qaFromUpload);
    initializeQaSuggestionStates(qaFromUpload);
    setFlowState("review");
    setWizardStep(restoredDraft ? 3 : 2);
    setMessages([]);
    setError(null);
    setSelectedSubsystems(new Set(["full"]));
    setDownloadTarget("full");
    setEditTarget("full");
    setMandatoryCriteria({ loading: false, ready: false, targets: [], activeTargetIndex: 0, criteriaByTarget: {}, error: null });
  }, [answers.category, initialUploadAnalysis, initializeQaSuggestionStates, profile?.company_name, selectedTemplate]);

  useEffect(() => {
    if (!intakeComplete || decompositionAnalysis) return;
    let cancelled = false;
    const fetchDecomposition = async () => {
      setDecompositionLoading(true);
      try {
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
            setDecompositionAnalysis(data);
            setSelectedSubsystems((current) => current);
          }
        }
      } catch (err) {
        console.warn("Decomposition analysis failed:", err);
      } finally {
        if (!cancelled) setDecompositionLoading(false);
      }
    };
    fetchDecomposition();
    return () => { cancelled = true; };
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
    : generatedSubsystemDrafts.length > 0
      ? generatedSubsystemDrafts.map((draft) => draft.name)
      : pdfBase64 || result
        ? ["full"]
        : [];
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
      if (!response.ok) throw new Error(await response.text().catch(() => "Failed to generate mandatory criteria"));
      const data = (await response.json()) as MandatoryCriteriaRecommendation;
      const criteriaByTarget = normalizeRecommendation(data, normalizedTargets);
      setMandatoryCriteria({ loading: false, ready: true, targets: normalizedTargets, activeTargetIndex: 0, criteriaByTarget, error: null });
    } catch (error) {
      console.warn("Mandatory criteria recommendation failed:", error);
      const fallbackTargets = normalizedTargets.length > 0 ? normalizedTargets : ["full"];
      const criteriaByTarget = Object.fromEntries(fallbackTargets.map((target) => [target, buildFallbackCriteria(target === "full" ? "Full RFP" : target.replace(/_/g, " "))]));
      setMandatoryCriteria({ loading: false, ready: true, targets: fallbackTargets, activeTargetIndex: 0, criteriaByTarget, error: null });
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
      if (current.activeTargetIndex <= 0) { setWizardStep(3); return current; }
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
    setMandatoryCriteria((current) => ({ ...current, criteriaByTarget: updateCriterionTarget(current.criteriaByTarget, target, index, patch) }));
  }, []);

  const addMandatoryCriterion = useCallback((target: string) => {
    setMandatoryCriteria((current) => ({ ...current, criteriaByTarget: addCriterionTarget(current.criteriaByTarget, target) }));
  }, []);

  const removeMandatoryCriterion = useCallback((target: string, index: number) => {
    setMandatoryCriteria((current) => ({ ...current, criteriaByTarget: removeCriterionTarget(current.criteriaByTarget, target, index) }));
  }, []);

  const handleStartOver = useCallback(() => {
    resetBackgroundGeneration();
    try {
      window.localStorage.removeItem(CHAT_STATE_KEY);
    } catch {
      // Ignore storage errors.
    }
    clearRfpSessionStorage();
    clearEditorDraftStorage();
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
    setSkippedQuestions(new Set());
    setQuestionWarnings({});
    setMandatoryCriteria({ loading: false, ready: false, targets: [], activeTargetIndex: 0, criteriaByTarget: {}, error: null });
    setResult(null);
    setPdfBase64(null);
    setDecomposition(null);
    setProgress(null);
    setError(null);
    setElapsed(0);
    setSaved(false);
    setSaving(false);
    setInputValue("");
    setIntaking(false);
    setDownloadTarget("full");
    setEditTarget("full");
    setMessages(createInitialChatMessages());
    uploadInitRef.current = false;
    router.replace("/rfp/intake");
  }, [router]);

  useEffect(() => {
    if (availableFileTargets.length === 0) return;
    if (!availableFileTargets.includes(downloadTarget)) setDownloadTarget(availableFileTargets[0]);
    if (!availableFileTargets.includes(editTarget)) setEditTarget(availableFileTargets[0]);
  }, [availableFileTargets, downloadTarget, editTarget]);

  useEffect(() => {
    if (selectedSubsystems.has("full")) {
      setDownloadTarget("full");
      setEditTarget("full");
    }
  }, [selectedSubsystems]);

  // Auto-select "full" when intake is complete and there are no decomposition subsystems.
  // We wait until decompositionLoading is false so that if the decomposition API returns
  // subsystems we don't silently pre-select "full" and hide the subsystem picker from the user.
  // The dep array uses `selectedSubsystems` (the Set reference) rather than `.size` so that
  // React sees a real change when the Set is replaced.
  useEffect(() => {
    if (!intakeComplete || decompositionLoading) return;
    const hasSubsystems = decompositionAnalysis?.subsystems && Object.keys(decompositionAnalysis.subsystems).length > 0;
    if (!hasSubsystems && selectedSubsystems.size === 0) {
      setSelectedSubsystems(new Set(["full"]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeComplete, decompositionLoading, decompositionAnalysis, selectedSubsystems]);

  // ─── Background QA pre-fetch ───────────────────────────────────────────────
  // The moment intake is complete AND we're on step 1, silently kick off the QA
  // API call in the background. When the user clicks "Run QA Analysis" the result
  // is ready instantly (or the in-flight request is awaited rather than duplicated).
  useEffect(() => {
    if (!intakeComplete || wizardStep !== 1) return;
    // Build a stable fingerprint to detect when answers change and we need a fresh fetch.
    const skippedArr = Array.from(skippedQuestions).sort();
    const fingerprint = JSON.stringify({ answers, skipped: skippedArr, template: selectedTemplate });
    const cache = qaPrefetchRef.current;
    // Already have a valid cached result or in-flight promise for this exact fingerprint.
    if (cache.fingerprint === fingerprint && (cache.result || cache.promise)) return;
    // Kick off a new background fetch.
    const promise = fetch(apiUrl("/api/rfp/qa-review"), {
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
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("prefetch failed");
        const data = (await res.json()) as QaReviewResponse;
        // Only store if the fingerprint hasn't changed while we were fetching.
        if (qaPrefetchRef.current.fingerprint === fingerprint) {
          qaPrefetchRef.current = { fingerprint, promise: null, result: data };
        }
        return data;
      })
      .catch(() => {
        // Silently discard prefetch errors — runQaReview will retry.
        if (qaPrefetchRef.current.fingerprint === fingerprint) {
          qaPrefetchRef.current = { fingerprint: "", promise: null, result: null };
        }
        return null as unknown as QaReviewResponse;
      });
    qaPrefetchRef.current = { fingerprint, promise, result: null };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeComplete, wizardStep, answers, skippedQuestions, selectedTemplate, selectedSubsystems]);

  const handleSkipCurrentQuestion = useCallback(() => {
    const currentKey = currentPromptKey;
    if (!currentKey || intaking || flowState !== "idle") return;

    // Guard: don’t allow skipping mandatory questions via the button either.
    const questionConfig = currentKey === FINAL_INTAKE_KEY
      ? { optional: true }
      : RFP_QUESTIONS.find((q) => q.key === currentKey);
    if (!questionConfig?.optional) return;

    const currentQuestionLabel = getQuestionLabelForKey(currentKey) || "the current question";
    const nextSkippedQuestions = new Set(skippedQuestions);
    nextSkippedQuestions.add(currentKey);

    const nextAnswers = { ...answers };
    delete nextAnswers[currentKey];

    const nextQuestionKey = getNextConversationKey(nextAnswers, nextSkippedQuestions);
    const nextQuestionLabel = getQuestionLabelForKey(nextQuestionKey);

    setAnswers(nextAnswers);
    setQuestionWarnings((prev) => {
      const next = { ...prev };
      delete next[currentKey];
      return next;
    });
    setSkippedQuestions(nextSkippedQuestions);
    setForcedQuestionKey(null);
    setInputValue("");
    setMessages((prev) => [
      ...prev,
      {
        role: "bot",
        text: nextQuestionLabel
          ? `Skipped for now: ${currentQuestionLabel}. Next up: ${nextQuestionLabel}`
          : `Skipped for now: ${currentQuestionLabel}. I have everything else I need for the intake.`,
      },
    ]);
    scrollChatToBottom();
  }, [answers, currentPromptKey, flowState, intaking, scrollChatToBottom, skippedQuestions]);

  const submitAnswer = useCallback(async (value: string) => {
    const answerText = value.trim();
    if (!answerText || intaking || flowState !== "idle") return;

    const currentKey = currentPromptKey;
    const currentQuestionLabel = currentQuestion?.label || "the current question";

    if (isGreetingOnlyMessage(answerText)) {
      setMessages((prev) => [...prev, { role: "user", text: answerText }, { role: "bot", text: `Hi there. ${currentQuestionLabel}` }]);
      setInputValue("");
      return;
    }

    if (currentKey && isSkipRequest(answerText)) {
      // Determine whether this question can be skipped.
      const questionConfig = currentKey === FINAL_INTAKE_KEY
        ? { optional: true }
        : RFP_QUESTIONS.find((q) => q.key === currentKey);
      const isOptional = questionConfig?.optional === true;

      if (!isOptional) {
        // Mandatory question — show a persuasive reason instead of skipping.
        const persuasion = getMandatorySkipMessage(currentKey, currentQuestion?.label || currentKey);
        setMessages((prev) => [
          ...prev,
          { role: "user", text: answerText },
          { role: "bot", text: `⚠️ ${persuasion}` },
        ]);
        setInputValue("");
        return;
      }

      setMessages((prev) => [...prev, { role: "user", text: answerText }]);
      setInputValue("");
      handleSkipCurrentQuestion();
      return;
    }

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
        body: JSON.stringify({ message: answerText, answers, currentQuestionKey: currentKey }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "Failed to extract intake fields");
        throw new Error(errText);
      }
      const data = (await res.json()) as IntakeResponse;
      const mergedAnswers = { ...answers, ...(data.extractedAnswers || {}) };
      setAnswers(mergedAnswers);
      if (currentKey) {
        setQuestionWarnings((prev) => { const next = { ...prev }; delete next[currentKey]; return next; });
        setSkippedQuestions((prev) => { if (!prev.has(currentKey)) return prev; const next = new Set(prev); next.delete(currentKey); return next; });
      }
      if (forcedQuestionKey && mergedAnswers[forcedQuestionKey]?.trim()) setForcedQuestionKey(null);
      const nextQuestionKey = data.nextQuestionKey || getNextRequiredKey(mergedAnswers, skippedQuestions);
      const botMessage =
        getFriendlyAcknowledge(data.chatReply || data.summary || "") ||
        data.clarifyingQuestion ||
        (!nextQuestionKey && data.readyForGeneration ? "I have enough information to generate the RFP. Click **Generate RFP** when you're ready." : "");
      if (botMessage) setMessages((prev) => [...prev, { role: "bot", text: botMessage }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { role: "bot", text: `I couldn't parse that yet: ${msg}` }]);
    } finally {
      setIntaking(false);
    }
  }, [answers, currentPromptKey, currentQuestion?.label, flowState, handleSkipCurrentQuestion, intaking]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && flowState === "idle") {
      e.preventDefault();
      submitAnswer(inputValue);
    }
  };

  // Helper: build the QA fetch payload (shared by prefetch + runQaReview)
  const buildQaPayload = useCallback(() => ({
    answers,
    selectedTemplate,
    selectedSubsystems: Array.from(selectedSubsystems),
    projectTitle: answers.project_title || profile?.company_name || "Project",
    organizationName: answers.organization_name || profile?.company_name || "Organization",
    category: answers.category || "software",
    additionalDetails: answers[FINAL_INTAKE_KEY] || "",
  }), [answers, profile?.company_name, selectedSubsystems, selectedTemplate]);

  // Fingerprint of current intake state — used to invalidate the prefetch cache when answers change.
  const qaFingerprint = useMemo(() => {
    const skippedArr = Array.from(skippedQuestions).sort();
    return JSON.stringify({ answers, skipped: skippedArr, template: selectedTemplate });
  }, [answers, skippedQuestions, selectedTemplate]);

  // Internal fetch that returns the raw QaReviewResponse (used by both prefetch and runQaReview)
  const fetchQaReview = useCallback(async (): Promise<QaReviewResponse> => {
    const res = await fetch(apiUrl("/api/rfp/qa-review"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildQaPayload()),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "Failed to review the intake");
      throw new Error(errText);
    }
    return res.json() as Promise<QaReviewResponse>;
  }, [buildQaPayload]);

  const runQaReview = useCallback(async () => {
    const missingKey = getNextRequiredKey(answers, skippedQuestions);
    if (missingKey) {
      setForcedQuestionKey(missingKey);
      setError(`I still need one more answer: ${getMissingQuestionLabel(missingKey, missingKey)}`);
      return;
    }
    setQaLoading(true);
    setError(null);
    try {
      // Use the prefetch cache if the fingerprint still matches (answers haven't changed).
      const cache = qaPrefetchRef.current;
      let data: QaReviewResponse;
      if (cache.result && cache.fingerprint === qaFingerprint) {
        // Instant result from background prefetch!
        data = cache.result;
      } else if (cache.promise && cache.fingerprint === qaFingerprint) {
        // Prefetch is in-flight — await it instead of starting a new request.
        data = await cache.promise;
      } else {
        // No valid cache — fetch now.
        data = await fetchQaReview();
      }
      // Clear the cache after consuming it.
      qaPrefetchRef.current = { fingerprint: "", promise: null, result: null };

      // Only block progression if there are still-unanswered (non-skipped) required fields.
      if (data.missingRequired?.length) {
        const remainingMissing = data.missingRequired.filter((key) => !skippedQuestions.has(key));
        if (remainingMissing.length > 0) {
          const key = data.missingQuestionKey && !skippedQuestions.has(data.missingQuestionKey)
            ? data.missingQuestionKey
            : remainingMissing[0];
          setForcedQuestionKey(key);
          setWizardStep(1);
          setError(`Before I score the draft, I still need: ${getMissingQuestionLabel(key, data.missingQuestionLabel || "one missing answer")}`);
          setInputValue("");
          scrollChatToBottom("auto");
          return;
        }
      }
      const qaResult = data.qa ?? {
        overallScore: 60,
        missingSections: [],
        improvements: [],
        strengths: ["Intake completed with user-selected skips applied."],
        readinessLevel: "needs_minor_edits" as const,
        scoreExplanation: "Score estimated — some intake fields were intentionally skipped.",
      };
      setQaReview(qaResult);
      initializeQaSuggestionStates(qaResult);
      setWizardStep(2);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setQaLoading(false);
    }
  }, [answers, fetchQaReview, initializeQaSuggestionStates, qaFingerprint, scrollChatToBottom, skippedQuestions]);

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
    setMandatoryCriteria({ loading: false, ready: false, targets: [], activeTargetIndex: 0, criteriaByTarget: {}, error: null });
    setProgress(null);
    setMessages([]);
    setInputValue("");
    setDownloadTarget("full");
    setEditTarget("full");

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    const finalAnswers = { ...answers };
    if (!finalAnswers.organization_name && profile?.company_name) finalAnswers.organization_name = profile.company_name;
    for (const q of RFP_QUESTIONS) {
      if (!finalAnswers[q.key]) finalAnswers[q.key] = "auto";
    }
    if (!finalAnswers[FINAL_INTAKE_KEY]) finalAnswers[FINAL_INTAKE_KEY] = "";

    const qaRevisionNotes = buildQaRevisionNotes();
    const sections: Record<string, string> = {};
    for (const q of RFP_QUESTIONS) {
      if (!q.isMetadata && q.key !== "detailed_project_description") sections[q.key] = finalAnswers[q.key];
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
        ? { subsystems: decompositionAnalysis.subsystems, inferredRequirements: decompositionAnalysis.inferredRequirements || [], needsDecomposition: decompositionAnalysis.needsDecomposition }
        : undefined,
    };

    clearEditorDraftStorage();

    try {
      await startBackgroundRfpGeneration(input, user?.id || profile?.company_name || "anonymous", initialUploadAnalysis ? "upload" : "scratch", {
        onProgress: (progress) => { setProgress(progress); },
        onResult: (generatedResult, generatedPdfBase64, generatedDecomposition) => {
          setResult(generatedResult);
          setPdfBase64(generatedPdfBase64);
          setDecomposition(generatedDecomposition);
          setProgress(null);
          setFlowState("review");
          setWizardStep(3);
          try {
            window.localStorage.setItem("rfp-editor-draft", JSON.stringify({
              metadata: generatedResult.metadata,
              sections: generatedResult.sections,
              sectionLabels: generatedResult.sectionLabels,
              template: generatedResult.template,
              pdfBase64: generatedPdfBase64,
              decomposition: generatedDecomposition,
            }));
          } catch { /* ignore */ }
        },
        onError: (message) => { setError(message); setFlowState("review"); setWizardStep(3); },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setFlowState("review");
      setMessages((prev) => [...prev, { role: "bot", text: `Error: ${msg}` }]);
    }
  };

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

  const resolveSavedPdf = () => {
    if (pdfBase64) return { base64: pdfBase64, fileName: `${result?.metadata.project_title || "RFP"}.pdf` };
    if (!initialUploadAnalysis) return null;
    try {
      const uploadedFileName = window.sessionStorage.getItem("rfp-uploaded-pdf-name") || "Uploaded RFP.pdf";
      const uploadedPdfBase64 = window.sessionStorage.getItem(`rfp-uploaded-pdf:${uploadedFileName}`);
      if (!uploadedPdfBase64) return null;
      return { base64: uploadedPdfBase64, fileName: uploadedFileName };
    } catch {
      return null;
    }
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
      return { metadata: result.metadata, sections: result.sections, sectionLabels: result.sectionLabels, template: result.template as PdfTemplate, pdfBase64, sourcePdfBase64: pdfBase64, decomposition, updatedAt: new Date().toISOString() };
    }
    const subsystemDraft = decomposition?.subsystemDrafts?.find((draft) => draft.name === target);
    if (!subsystemDraft) return null;
    return { metadata: subsystemDraft.metadata, sections: subsystemDraft.sections, sectionLabels: subsystemDraft.sectionLabels, template: subsystemDraft.template, pdfBase64: subsystemDraft.pdfBase64, sourcePdfBase64: subsystemDraft.pdfBase64, decomposition, subsystemName: subsystemDraft.name, updatedAt: new Date().toISOString() };
  }, [decomposition, pdfBase64, result]);

  const openEditorForTarget = useCallback((target: TargetRfp) => {
    let draft: EditorDraftSnapshot | null = null;
    try {
      const key = `${EDITOR_DRAFT_KEY}:${target}`;
      const raw = window.localStorage.getItem(key);
      if (raw) draft = JSON.parse(raw) as EditorDraftSnapshot;
    } catch { /* ignore */ }
    if (!draft) draft = buildEditorDraft(target);
    if (!draft) {
      setError(target === "full" ? "The full RFP is not ready yet." : `Subsystem draft for ${target} is not ready yet.`);
      return;
    }
    try {
      const preferredReturn = window.location.pathname + window.location.search;
      const withReturn = { ...draft, returnTo: preferredReturn };
      window.localStorage.setItem(EDITOR_DRAFT_KEY, JSON.stringify(withReturn));
      try { window.localStorage.setItem(SELECTED_TARGET_KEY, target); } catch {}
      try { window.localStorage.setItem(`${EDITOR_DRAFT_KEY}:${target}`, JSON.stringify(withReturn)); } catch {}
    } catch { /* ignore */ }
    router.push("/rfp/editor");
  }, [buildEditorDraft, router]);

  const downloadSelectedRfp = useCallback((target: TargetRfp) => {
    if (target === "full") { downloadPdf(); return; }
    downloadSubsystemPdf(target);
  }, [downloadPdf, downloadSubsystemPdf]);

  const downloadMarkdown = () => {
    if (!result) return;
    const md = Object.entries(result.sections).map(([key, val]) => `## ${result.sectionLabels[key] || key}\n\n${val}`).join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.metadata.project_title || "RFP"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveToMyContracts = async () => {
    if (!result || !user) {
      setMessages((prev) => [...prev, { role: "bot", text: "Error: Missing user data or RFP result." }]);
      return;
    }
    if (saving || saved) return;
    setSaving(true);
    try {
      const userMetadataFullName = (user as unknown as { user_metadata?: { full_name?: string } }).user_metadata?.full_name;
      const commonFields = {
        budget: answers.budget_framework || "TBD",
        deadline: answers.implementation_timeline || "TBD",
        status: "draft" as const,
        industry: result.metadata.category,
        posted_by: user.id,
        posted_by_name: profile?.company_name || userMetadataFullName || user.email || "Unknown",
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
      const sanitizeText = (text: string | null | undefined): string => { if (!text) return ""; return String(text).replace(/\0/g, ""); };
      const sanitizeObject = (obj: unknown): unknown => {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === "string") return sanitizeText(obj);
        if (Array.isArray(obj)) return obj.map(sanitizeObject);
        if (typeof obj === "object") return Object.entries(obj).reduce((acc, [key, val]) => { acc[key as keyof typeof acc] = sanitizeObject(val); return acc; }, {} as Record<string, unknown>);
        return obj;
      };

      const subsystemDrafts = decomposition?.subsystemDrafts || [];
      const subsystemPdfs = decomposition?.subsystemPdfs || [];
      const mandatoryCriteriaTargets = mandatoryCriteria.targets.length > 0 ? mandatoryCriteria.targets : ["full"];
      const saves: Promise<unknown>[] = [];
      const savedPdf = resolveSavedPdf();
      const savedPdfBase64 = savedPdf?.base64 || "";
      const savedPdfFileName = savedPdf?.fileName || `${result.metadata.project_title}.pdf`;

      if (mandatoryCriteriaTargets.includes("full")) {
        saves.push((async () => {
          const insertData = {
            ...commonFields,
            title: result.metadata.project_title,
            description: Object.values(result.sections).find(Boolean)?.slice(0, 300) || result.metadata.project_title,
            rfp_sections: result.sections,
            rfp_section_labels: result.sectionLabels,
            rfp_pdf_base64: savedPdfBase64,
            rfp_file_name: savedPdfFileName,
            rfp_decomposition: null,
            last_analysis_result: { ...result.qa, mandatory_criteria: buildMandatoryCriteriaPayload(mandatoryCriteria.criteriaByTarget, ["full"], 0) },
            rfp_metadata: { ...commonFields.rfp_metadata, mandatory_criteria: buildMandatoryCriteriaPayload(mandatoryCriteria.criteriaByTarget, ["full"], 0) },
          };
          const { data, error } = await supabase.from("contracts").insert(sanitizeObject(insertData) as any).select("id");
          if (error) throw error;
          return data?.[0]?.id;
        })());
      }

      const subsystemTargets = mandatoryCriteriaTargets.filter((target) => target !== "full");
      for (const targetName of subsystemTargets) {
        const draft = subsystemDrafts.find((item) => normalizeName(item.name) === normalizeName(targetName));
        const pdf = subsystemPdfs.find((item) => normalizeName(item.name) === normalizeName(targetName));
        const subsystemData = {
          name: targetName,
          sections: draft?.sections || result.sections,
          sectionLabels: draft?.sectionLabels || result.sectionLabels,
          metadata: draft?.metadata || result.metadata,
          template: draft?.template || result.template,
          pdfBase64: draft?.pdfBase64 || pdf?.pdfBase64 || "",
        };
        const subsystemCriteriaPayload = buildMandatoryCriteriaPayload(mandatoryCriteria.criteriaByTarget, [targetName], 0);
        saves.push((async () => {
          const insertData = {
            ...commonFields,
            title: `${subsystemData.metadata.project_title} — ${targetName}`,
            description: `Subsystem RFP for "${targetName}" decomposed from ${result.metadata.project_title}`.slice(0, 300),
            rfp_sections: subsystemData.sections,
            rfp_section_labels: subsystemData.sectionLabels,
            rfp_pdf_base64: subsystemData.pdfBase64 || savedPdfBase64,
            rfp_file_name: `${subsystemData.metadata.project_title || result.metadata.project_title} — ${targetName}.pdf`,
            rfp_decomposition: decomposition ? { subsystems: decomposition.subsystems, inferredRequirements: decomposition.inferredRequirements, needsDecomposition: true, subsystemName: targetName } : null,
            rfp_metadata: { ...commonFields.rfp_metadata, ...subsystemData.metadata, mandatory_criteria: subsystemCriteriaPayload },
            rfp_template: subsystemData.template,
            last_analysis_result: { ...result.qa, mandatory_criteria: subsystemCriteriaPayload },
          };
          const { data, error } = await supabase.from("contracts").insert(sanitizeObject(insertData) as any).select("id");
          if (error) throw error;
          return data?.[0]?.id;
        })());
      }

      if (contractId && onRfpGenerated) {
        if (saves.length > 0) await Promise.all(saves);
        onRfpGenerated({ title: result.metadata.project_title, sections: result.sections, sectionLabels: result.sectionLabels, pdfBase64: pdfBase64 || "", metadata: result.metadata, mandatoryCriteria });
        setSaved(true);
        setMessages((prev) => [...prev, { role: "bot", text: "RFP generated! Returning to contract view..." }]);
        onSaved?.();
        return;
      }

      if (saves.length === 0) {
        setMessages((prev) => [...prev, { role: "bot", text: "❌ No systems to save. Please check your selections and try again." }]);
        setSaving(false);
        return;
      }

      const results = await Promise.all(saves);
      setSaved(true);

      const createdContractId = results[0] as string | undefined;
      if (createdContractId) {
        // Redirect directly to the newly created contract preview so the user can review and publish it
        router.push(`/contracts/${createdContractId}/preview?from=my-contracts`);
      } else {
        onSaved?.();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { role: "bot", text: `❌ Failed to save: ${msg}` }]);
    }
    setSaving(false);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    /*
     * KEY FIX: flexWrap changed from "wrap" to "nowrap" so the sidebar stays
     * alongside the chat panel instead of wrapping below it.
     */
    <div style={{ display: "flex", flexWrap: "nowrap", gap: 24, alignItems: "flex-start", maxWidth: 1480, margin: "0 auto", padding: "0 24px" }}>

      {/* ── Main card ── */}
      {/*
       * KEY FIX: flex changed from "1 1 760px" → "1 1 0" so the card
       * shrinks to share the row with the sidebar instead of claiming 760px
       * and forcing a wrap.
       */}
      <div className="card" style={{ flex: "1 1 0", minWidth: 0, overflow: "hidden", background: "linear-gradient(180deg, rgba(255,255,255,0.95), rgba(239,236,227,0.92))", border: "1px solid var(--card-border)", boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--card-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          <div style={{ padding: "16px 20px 8px" }}>
            <div ref={chatScrollRef} style={{ height: 480, overflowY: "auto", paddingRight: 4 }}>
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
                    dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }}
                  />
                </div>
              ))}

              {flowState === "generating" && activeGenerationProgress && (
                <div style={{ background: "var(--surface)", borderRadius: 12, padding: "14px 16px", marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>{activeGenerationProgress.stage}</span>
                    <span style={{ color: "var(--muted)" }}>{activeGenerationProgress.percent}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--surface-hover)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${activeGenerationProgress.percent}%`, background: "var(--primary)", borderRadius: 3, transition: "width 0.4s ease" }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{activeGenerationProgress.message}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: 8, padding: 12, margin: "8px 20px", color: "var(--danger)", fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Error during generation</div>
            <div style={{ marginBottom: 10, lineHeight: 1.5 }}>{error}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  setError(null);
                  if (wizardStep === 3 && !result) {
                    setWizardStep(1);
                    setFlowState("idle");
                  }
                }}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  background: "#fff",
                  border: "1px solid var(--danger)",
                  color: "var(--danger)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Back to Intake
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleStartOver}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  background: "var(--danger)",
                  border: "none",
                  color: "#fff",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Start Over
              </button>
            </div>
          </div>
        )}

        {wizardStep === 3 && generationSnapshot.status === "running" && activeGenerationProgress && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: 14, padding: 16, margin: "12px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Pulsing dot */}
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", display: "inline-block", animation: "pulse 1.4s ease-in-out infinite" }} />
                <strong style={{ color: "var(--foreground)", fontSize: 13 }}>{activeGenerationProgress.stage}</strong>
              </div>
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--muted)" }}>
                {activeGenerationProgress.percent}% &bull; {formatTime(elapsed)}
              </span>
            </div>
            {/* Segmented progress bar */}
            <div style={{ height: 8, borderRadius: 999, background: "var(--surface-hover)", overflow: "hidden", marginBottom: 8, position: "relative" }}>
              <div style={{
                height: "100%",
                width: `${activeGenerationProgress.percent}%`,
                background: activeGenerationProgress.percent >= 90
                  ? "linear-gradient(90deg, var(--primary), #16a34a)"
                  : "linear-gradient(90deg, var(--primary), #60a5fa)",
                borderRadius: 999,
                transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
              }} />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{activeGenerationProgress.message}</div>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", opacity: 0.75 }}>Generation is running in the background. You can leave this page and come back.</div>
            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  resetBackgroundGeneration();
                  setFlowState("idle");
                  setWizardStep(initialUploadAnalysis ? 2 : 1);
                  setError(null);
                  setProgress(null);
                }}
                className="btn-outline"
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  borderColor: "var(--danger)",
                  color: "var(--danger)",
                  cursor: "pointer",
                }}
              >
                Cancel Generation
              </button>
            </div>
          </div>
        )}

        {wizardStep === 2 && qaReview && (
          <div className="animate-fadeIn" style={{ margin: "12px 20px" }}>
            <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div
                  style={{
                    width: 48, height: 48, borderRadius: "50%",
                    background: qaReview.overallScore >= 70 ? "var(--success)" : qaReview.overallScore >= 40 ? "var(--warning)" : "var(--danger)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#EFECE3", fontWeight: 700, fontSize: 16,
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
              {qaReview.strengths && qaReview.strengths.length > 0 && (
                <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 10, marginBottom: 8, color: "var(--foreground-secondary)" }}>
                  <strong style={{ display: "block", marginBottom: 6, color: "var(--primary)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Mentor Assessment</strong>
                  <div style={{ 
                    fontStyle: "italic", 
                    background: "rgba(224, 219, 203, 0.25)", 
                    padding: "12px 14px", 
                    borderRadius: 8, 
                    borderLeft: "4px solid var(--primary)",
                    whiteSpace: "pre-wrap"
                  }}>
                    "{Array.isArray(qaReview.strengths) ? qaReview.strengths.join("\n\n") : qaReview.strengths}"
                  </div>
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
                        <button className="btn-outline" onClick={() => setQaSuggestionStates((prev) => ({ ...prev, [index]: { mode: "auto", note: "auto" } }))} style={{ fontSize: 12, padding: "6px 10px" }}>auto</button>
                        <button className="btn-outline" onClick={() => setQaSuggestionStates((prev) => ({ ...prev, [index]: { mode: "custom", note: prev[index]?.note || "" } }))} style={{ fontSize: 12, padding: "6px 10px" }}>custom</button>
                        <button className="btn-outline" onClick={() => setQaSuggestionStates((prev) => ({ ...prev, [index]: { mode: "skip", note: "skip" } }))} style={{ fontSize: 12, padding: "6px 10px" }}>No</button>
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
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--warning)" }}>Please choose auto, custom, or No for every suggestion.</div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button className="btn-primary" onClick={startGeneration} disabled={!qaSuggestionsResolved || qaLoading || selectedSubsystems.size === 0}>Generate RFP</button>
                {initialUploadAnalysis && (
                  <button
                    className="btn-outline"
                    onClick={() => {
                      let loadedPdfBase64 = null;
                      if (initialUploadAnalysis) {
                        const pdfFileName = sessionStorage.getItem("rfp-uploaded-pdf-name");
                        if (pdfFileName) {
                          const pdfBase64String = sessionStorage.getItem(`rfp-uploaded-pdf:${pdfFileName}`);
                          if (pdfBase64String) { setPdfBase64(pdfBase64String); loadedPdfBase64 = pdfBase64String; }
                        }
                      }
                      setFlowState("review");
                      setWizardStep(4);
                      setSelectedSubsystems(new Set(["full"]));
                      setDownloadTarget("full");
                      setEditTarget("full");
                      const successMsg = loadedPdfBase64
                        ? "Continuing with uploaded RFP without changes. The PDF will be saved along with your mandatory criteria."
                        : "Continuing with uploaded RFP analysis without changes. Setting up mandatory criteria...";
                      setMessages((prev) => [...prev, { role: "bot", text: successMsg }]);
                    }}
                  >
                    Continue without changes
                  </button>
                )}
                <button className="btn-outline" onClick={() => { setWizardStep(1); setQaReview(null); setQaSuggestionStates({}); }}>Back to intake</button>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {wizardStep === 3 && result && (
          <div className="animate-fadeIn" style={{ margin: "12px 20px" }}>
            <div style={{ background: "linear-gradient(180deg, var(--surface) 0%, rgba(239,236,227,0.7) 100%)", borderRadius: 18, padding: 18, marginBottom: 12, border: "1px solid var(--card-border)" }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--muted)", marginBottom: 8 }}>File summary</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)", marginBottom: 8 }}>{result.metadata.project_title}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                {selectedSubsystems.has("full")
                  ? "The AI generated the common combined RFP from your intake answers."
                  : selectedSubsystemNames.length > 0
                    ? `The AI generated only the subsystem files you selected: ${selectedSubsystemNames.join(", ")}.`
                    : "The AI generated the RFP set from your intake answers, ready to download or edit."}
              </div>
            </div>

            <div style={{ background: "var(--surface)", borderRadius: 16, padding: 16, border: "1px solid var(--card-border)", display: "grid", gap: 14 }}>
              <div style={{ background: "rgba(239,236,227,0.65)", borderRadius: 14, padding: 14, border: "1px solid var(--card-border)" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em", color: "var(--muted)", marginBottom: 8 }}>File selector</div>
                <div style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6, marginBottom: 12 }}>Choose one generated file and use the same selector for download or edit.</div>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Select file</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {availableFileTargets.length > 0 ? availableFileTargets.map((target) => {
                        const active = downloadTarget === target;
                        const label = target === "full" ? "Common RFP" : target;
                        return (
                          <button
                            key={target}
                            type="button"
                            onClick={() => { setDownloadTarget(target); setEditTarget(target); try { window.localStorage.setItem(SELECTED_TARGET_KEY, target); } catch {} }}
                            style={{
                              padding: "8px 12px", borderRadius: 999,
                              border: active ? "1px solid var(--primary)" : "1px solid var(--card-border)",
                              background: active ? "var(--primary)" : "#fff",
                              color: active ? "#EFECE3" : "var(--foreground)",
                              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s ease",
                            }}
                          >
                            {label}
                          </button>
                        );
                      }) : <div style={{ fontSize: 12, color: "var(--muted)" }}>No generated files available yet.</div>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
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

              <button className="btn-ghost" onClick={handleStartOver}>Start Over</button>
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

        {/* Bottom input / action bar */}
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
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {/* Skip button is only shown for optional questions */}
                {(() => {
                  const qConfig = currentPromptKey === FINAL_INTAKE_KEY
                    ? { optional: true }
                    : RFP_QUESTIONS.find((q) => q.key === currentPromptKey);
                  return qConfig?.optional ? (
                    <button
                      className="btn-outline"
                      style={{ fontSize: 13, padding: "6px 16px" }}
                      onClick={handleSkipCurrentQuestion}
                      disabled={intaking || !currentQuestion}
                    >
                      Skip
                    </button>
                  ) : null;
                })()}
                <button className="btn-primary" style={{ fontSize: 13, padding: "6px 16px" }} onClick={() => submitAnswer(inputValue)} disabled={intaking}>
                  {intaking ? "Thinking..." : "Send"}
                </button>
              </div>
            </div>
          )}

          {wizardStep === 1 && flowState === "idle" && intakeComplete && !decompositionLoading && (
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {decompositionAnalysis?.subsystems && Object.keys(decompositionAnalysis.subsystems).length > 0 && (
                <div style={{ background: "var(--surface)", borderRadius: 12, padding: 16, border: "1px solid var(--card-border)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginBottom: 12 }}>Choose which RFPs to generate</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={selectedSubsystems.has("full")}
                        onChange={(e) => {
                          const newSet = new Set(selectedSubsystems);
                          if (e.target.checked) {
                            newSet.add("full");
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
                    {Object.entries(decompositionAnalysis.subsystems).map(([subsystemName, description]) => (
                      <label key={subsystemName} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={selectedSubsystems.has(subsystemName) && !selectedSubsystems.has("full")}
                          onChange={(e) => {
                            const newSet = new Set(selectedSubsystems);
                            if (e.target.checked) { newSet.delete("full"); newSet.add(subsystemName); }
                            else { newSet.delete(subsystemName); }
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
                        textAlign: "left", padding: 0,
                        border: active ? "2px solid var(--primary)" : "1px solid var(--card-border)",
                        borderRadius: 16, overflow: "hidden", background: "var(--surface)",
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
                {qaLoading ? "Analysing intake..." : qaReview ? "Re-run QA Analysis" : "Run QA Analysis"}
              </button>
            </div>
          )}

          {wizardStep === 1 && flowState === "idle" && intakeComplete && decompositionLoading && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid var(--card-border)", background: "var(--surface)", color: "var(--muted)", fontSize: 13 }}>
              Analyzing project structure before showing subsystem options and template selection...
            </div>
          )}

          {wizardStep === 3 && flowState === "generating" && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, padding: "6px 8px" }}>
              {activeGenerationProgress
                ? `${activeGenerationProgress.stage} — ${activeGenerationProgress.percent}% • ${formatTime(elapsed)} elapsed`
                : `Generating... ${formatTime(elapsed)} elapsed`}
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => {
                    resetBackgroundGeneration();
                    setFlowState("idle");
                    setWizardStep(initialUploadAnalysis ? 2 : 1);
                    setError(null);
                    setProgress(null);
                  }}
                  className="btn-outline"
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    borderColor: "var(--danger)",
                    color: "var(--danger)",
                    cursor: "pointer"
                  }}
                >
                  Cancel Generation
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Sidebar: Question Progress ── */}
      {/*
       * KEY FIX: flex changed to "0 0 300px" (was "0 0 320px" with minWidth 280),
       * and minWidth removed so it never pushes to a new row.
       * position: sticky keeps it anchored to the right of the chat while scrolling.
       */}
      {wizardStep === 1 && (
        <aside style={{
          flex: "0 0 340px",
          width: 340,
          background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(239,236,227,0.96))",
          border: "1px solid var(--card-border)",
          borderRadius: 18,
          padding: 16,
          position: "sticky",
          top: 14,
          alignSelf: "flex-start",
          boxShadow: "0 18px 44px rgba(15, 23, 42, 0.08)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>Intake Progress</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--foreground)", marginTop: 4 }}>{completionPercent}%</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{completedCount} answered · {skippedCount} skipped · {RFP_QUESTIONS.length - completedCount - skippedCount} remaining</div>
            </div>
            <button className="btn-ghost" onClick={handleStartOver} style={{ fontSize: 12, padding: "6px 10px" }}>Reset</button>
          </div>

          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <div style={{ height: 10, borderRadius: 999, background: "rgba(15, 23, 42, 0.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${completionPercent}%`, borderRadius: 999, background: "linear-gradient(90deg, var(--primary) 0%, #16a34a 100%)", transition: "width 0.25s ease" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, color: "var(--muted)" }}>
              <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(16, 185, 129, 0.12)", color: "#0f766e" }}>Answered</span>
              <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(245, 158, 11, 0.14)", color: "#b45309" }}>Skipped</span>
              <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(79, 70, 229, 0.12)", color: "#4338ca" }}>Current</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${questionProgress.length}, minmax(0, 1fr))`, gap: 4, marginBottom: 12 }}>
            {questionProgress.map((item) => {
              const isAnswered = item.status === "answered";
              const isSkipped = item.status === "skipped";
              const isCurrent = item.status === "current";
              const stripColor = isAnswered ? "#16a34a" : isSkipped ? "#f59e0b" : isCurrent ? "var(--primary)" : "rgba(15, 23, 42, 0.16)";
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    if (!isAnswered && !isSkipped) return;
                    setForcedQuestionKey(item.key);
                    setMessages((prev) => [...prev, { role: "bot", text: `Let's revisit this one: ${item.label}` }]);
                  }}
                  title={item.label}
                  style={{
                    height: 10, borderRadius: 999,
                    border: `1px solid ${isCurrent ? "var(--primary)" : "transparent"}`,
                    background: stripColor,
                    cursor: isAnswered || isSkipped ? "pointer" : "default",
                    boxShadow: isCurrent ? "0 0 0 2px rgba(79, 70, 229, 0.12)" : "none",
                  }}
                />
              );
            })}
          </div>

          <div style={{ display: "grid", gap: 8, maxHeight: 460, overflowY: "auto", paddingRight: 4 }}>
            {questionProgress.map((item) => {
              const isCurrent = item.status === "current";
              const isAnswered = item.status === "answered";
              const isSkipped = item.status === "skipped";
              const statusColor = isAnswered ? "#16a34a" : isSkipped ? "#f59e0b" : isCurrent ? "var(--primary)" : "#94a3b8";
              const statusLabel = isAnswered ? "Done" : isSkipped ? "Skip" : isCurrent ? "Now" : String(item.index + 1).padStart(2, "0");
              return (
                <button
                  key={item.key}
                  ref={isCurrent ? (element) => { activeProgressItemRef.current = element; } : undefined}
                  type="button"
                  onClick={() => {
                    if (!isSkipped && !isAnswered) return;
                    setForcedQuestionKey(item.key);
                    setMessages((prev) => [...prev, { role: "bot", text: `Let's revisit this one: ${item.label}` }]);
                  }}
                  style={{
                    width: "100%", display: "flex", alignItems: "flex-start", gap: 10,
                    textAlign: "left", padding: "10px 11px", borderRadius: 12,
                    border: `1px solid ${isCurrent ? "var(--primary)" : isAnswered ? "rgba(16, 185, 129, 0.24)" : isSkipped ? "rgba(245, 158, 11, 0.24)" : "var(--card-border)"}`,
                    background: isCurrent ? "rgba(79, 70, 229, 0.08)" : isAnswered ? "rgba(16, 185, 129, 0.08)" : isSkipped ? "rgba(245, 158, 11, 0.09)" : "rgba(255,255,255,0.75)",
                    color: "var(--foreground)",
                    cursor: isSkipped || isAnswered ? "pointer" : "default",
                  }}
                  title={isSkipped ? "Go back to this question" : isAnswered ? "Answered" : isCurrent ? "Current question" : "Pending"}
                >
                  <span
                    style={{
                      width: 26, height: 26, borderRadius: 999, flexShrink: 0,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: statusColor, color: isCurrent ? "#EFECE3" : "#fff", fontSize: 10, fontWeight: 800,
                    }}
                  >
                    {statusLabel}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                      {isAnswered && "Answered and included in generation"}
                      {isSkipped && "Skipped for now - click to revisit"}
                      {isCurrent && "Current question"}
                      {!isAnswered && !isSkipped && !isCurrent && "Pending"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}