"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";
import { apiUrl } from "@/lib/api";
import { randomUUID } from '@/lib/uuid';

import {
  parseRFP,
  proposalChat,
  generateFullProposal,
  parseUploadedProposal,
  editProposalSection,
  extractChartData,
  critiqueProposal,
  refineProposal,
  expandAllSections,
  type RFPAnalysis,
  type ChatMessage,
  type ProposalSections,
  type ChartData,
  type ProposalCritique,
  type ExpandProgress,
  type ParsedUploadedProposal,
} from "@/services/aiService";
import { downloadProposalPDF, generateProposalPDF, TEMPLATE_OPTIONS, type TemplateName } from "@/services/pdfGenerator";

/* ─── helpers ─────────────────────────────────────────────── */
function normalizeDoc(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/** Ensure every section value is a plain string (LLMs sometimes return objects). */
function normalizeSections(raw: Partial<ProposalSections> | Record<string, unknown>): ProposalSections {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
    else if (v && typeof v === "object") {
      out[k] = Object.entries(v as Record<string, unknown>)
        .map(([field, val]) => `${field}: ${String(val ?? "")}`)
        .join("\n");
    } else out[k] = v != null ? String(v) : "";
  }
  return out as unknown as ProposalSections;
}

const SECTION_LABELS: Record<keyof ProposalSections, string> = {
  vendor_information: "Vendor Basic Information",
  company_profile: "Company Profile",
  project_understanding: "Project Understanding",
  proposed_solution: "Proposed Solution",
  deliverables: "Deliverables",
  project_timeline: "Project Timeline",
  cost_proposal: "Cost Proposal",
  team_details: "Team Details",
  past_experience: "Past Experience",
  risk_management: "Risk Management",
  support_maintenance: "Support & Maintenance",
  graphs_visualizations: "Graphs / Visualizations",
  terms_conditions: "Terms & Conditions",
  document_uploads: "Document Uploads",
  final_declaration: "Final Declaration",
};

const SECTION_ICONS: Record<keyof ProposalSections, string> = {
  vendor_information: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  company_profile: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  project_understanding: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  proposed_solution: "M13 10V3L4 14h7v7l9-11h-7z",
  deliverables: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  project_timeline: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  cost_proposal: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  team_details: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  past_experience: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  risk_management: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  support_maintenance: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z",
  graphs_visualizations: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  terms_conditions: "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3",
  document_uploads: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
  final_declaration: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
};

/** Truncate a verbose string to the first N characters, appending ellipsis. */
function shortDisplay(value: unknown, max = 22): string {
  const s = String(value ?? "N/A");
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

/** Extract a short budget figure from verbose text, e.g. "$50,000" or the first line. */
function shortBudget(raw: unknown): string {
  const s = String(raw ?? "");
  // Try to find a dollar amount
  const match = s.match(/\$[\d,]+(?:\.\d{2})?(?:\s*(?:–|-)\s*\$[\d,]+(?:\.\d{2})?)?/);
  if (match) return match[0];
  // Fallback: first sentence or 22 chars
  const firstSentence = s.split(/[.\n]/)[0];
  return shortDisplay(firstSentence, 22);
}

/** Extract a short deadline from verbose text. */
function shortDeadline(raw: unknown): string {
  const s = String(raw ?? "");
  // Try to find a date pattern
  const dateMatch = s.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/) || s.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s*\d{4}\b/i);
  if (dateMatch) return dateMatch[0];
  // Try to find "X weeks/months/days"
  const durationMatch = s.match(/\d+\s*(?:weeks?|months?|days?|years?)/i);
  if (durationMatch) return durationMatch[0];
  // Total duration pattern
  const totalMatch = s.match(/total\s+(?:estimate d\s+)?duration[:\s]+([^\n.]+)/i);
  if (totalMatch) return totalMatch[1].trim();
  const firstLine = s.split(/\n/)[0];
  return shortDisplay(firstLine, 22);
}

/** Render basic markdown bold **text** as JSX. */
function renderDescription(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-[var(--foreground)]">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function buildQuickPdfProposalData(input: {
  fileName: string;
  extractedText: string;
  vendorName: string;
  contractTitle: string;
  parsedProposal?: ParsedUploadedProposal | null;
}) {
  const sections = Object.keys(SECTION_LABELS).reduce((acc, key) => {
    acc[key as keyof ProposalSections] = "";
    return acc;
  }, {} as ProposalSections);

  // If parsing succeeded, merge parsed sections into the template
  let totalPrice = "";
  let timeline = "";
  if (input.parsedProposal) {
    const parsed = input.parsedProposal;
    // Merge all parsed sections
    Object.keys(parsed.sections).forEach((key) => {
      sections[key as keyof ProposalSections] = parsed.sections[key as keyof ProposalSections] || "";
    });
    totalPrice = parsed.extracted_price || "";
    timeline = parsed.extracted_timeline || "";
  } else {
    // Fallback: minimal structure with filename note
    sections.vendor_information = `Uploaded PDF proposal: ${input.fileName}`;
  }

  // Always preserve raw PDF text for full transparency
  sections.document_uploads = input.extractedText;

  return {
    title: input.fileName.replace(/\.pdf$/i, "") || "Vendor Proposal",
    vendorName: input.vendorName,
    contractTitle: input.contractTitle,
    totalPrice,
    timeline,
    sections,
    sectionLabels: SECTION_LABELS,
    template: "executive" as TemplateName,
    chartData: null,
    executiveSummary: "",
    source: "uploaded_pdf",
    pdfFileName: input.fileName,
  };
}

type Step = "rfp_analysis" | "choice" | "chat_build" | "upload_edit" | "editor" | "preview";

/* ═══════════════════════════════════════════════════════════ */
export default function ApplyPage() {
  const params = useParams<{ id?: string }>();
  const contractId = params?.id;
  const router = useRouter();
  const { user, profile } = useAuth();

  /* ─── core state ─── */
  const [contract, setContract] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("upload_edit");
  const [submitting, setSubmitting] = useState(false);

  /* ─── RFP analysis ─── */
  const [rfpAnalysis, setRfpAnalysis] = useState<RFPAnalysis | null>(null);
  const [analyzingRfp, setAnalyzingRfp] = useState(false);

  /* ─── Quick Upload PDF ─── */
  const [quickPdfFile, setQuickPdfFile] = useState<File | null>(null);
  const [quickPdfUploading, setQuickPdfUploading] = useState(false);
  const [quickPdfFileName, setQuickPdfFileName] = useState("");
  const [quickPdfUrl, setQuickPdfUrl] = useState<string | null>(null);
  const [quickPdfExtracted, setQuickPdfExtracted] = useState("");
  const [quickUploadSaved, setQuickUploadSaved] = useState(false);

  if (!contractId) return null;

  /* ─── Chat builder ─── */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [proposalReady, setProposalReady] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [showPdfOptions, setShowPdfOptions] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ─── Proposal sections ─── */
  const [sections, setSections] = useState<ProposalSections>({
    vendor_information: "",
    company_profile: "",
    project_understanding: "",
    proposed_solution: "",
    deliverables: "",
    project_timeline: "",
    cost_proposal: "",
    team_details: "",
    past_experience: "",
    risk_management: "",
    support_maintenance: "",
    graphs_visualizations: "",
    terms_conditions: "",
    document_uploads: "",
    final_declaration: "",
  });
  const [proposalTitle, setProposalTitle] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [timelineSummary, setTimelineSummary] = useState("");

  /* ─── Editor state ─── */
  const [editingSection, setEditingSection] = useState<keyof ProposalSections | null>(null);
  const [editInstructions, setEditInstructions] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [activeEditorSection, setActiveEditorSection] = useState<keyof ProposalSections>("vendor_information");

  /* ─── Upload state ─── */
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [parsingUpload, setParsingUpload] = useState(false);

  /* ─── Generating full proposal ─── */
  const [generatingProposal, setGeneratingProposal] = useState(false);

  /* ─── Template & Charts ─── */
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateName>("executive");
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [extractingCharts, setExtractingCharts] = useState(false);

  /* ─── AI Critique ─── */
  const [critique, setCritique] = useState<ProposalCritique | null>(null);
  const [critiquing, setCritiquing] = useState(false);
  const [refining, setRefining] = useState(false);

  /* ─── Expand to Full Proposal ─── */
  const [expanding, setExpanding] = useState(false);
  const [expandProgress, setExpandProgress] = useState<ExpandProgress | null>(null);
  const [executiveSummary, setExecutiveSummary] = useState("");

  /* ─── PDF Preview ─── */
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  /* ─── Fetch contract ─── */
  useEffect(() => {
    const fetchContract = async () => {
      const { data, error } = await supabase.from("contracts").select("*").eq("id", contractId).single();
      if (!error && data) setContract({ contract_id: data.id, ...normalizeDoc(data as Record<string, unknown>) });
      setLoading(false);
    };
    fetchContract();
  }, [contractId]);

  /* ─── Auto-scroll chat ─── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  /* ─── Auto-start interview: ask about section 0 when entering chat_build ─── */
  useEffect(() => {
    if (step !== "chat_build" || chatMessages.length > 0) return;
    setChatLoading(true);
    proposalChat([], getRfpContext(), 0)
      .then((resp) => {
        setChatMessages([{ role: "assistant", content: resp.reply }]);
        setSectionIndex(resp.section_index);
      })
      .catch(() => {
        setChatMessages([{ role: "assistant", content: "Welcome! Let\u2019s build your proposal. To start, please share your company name, primary contact person, email, phone, address, and years of experience." }]);
      })
      .finally(() => setChatLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /* ─── Build RFP context string ─── */
  const getRfpContext = useCallback(() => {
    if (!contract) return "";
    const parts = [
      `Title: ${contract.title}`,
      `Description: ${contract.description}`,
      `Budget: $${contract.budget}`,
      `Deadline: ${contract.deadline}`,
      `Industry: ${contract.industry || "N/A"}`,
    ];
    if (contract.rfp_document && typeof contract.rfp_document === "string" && !(contract.rfp_document as string).startsWith("data:")) {
      parts.push(`\nRFP Document:\n${contract.rfp_document}`);
    }
    if (rfpAnalysis) {
      parts.push(`\nKey Requirements: ${(rfpAnalysis.key_requirements ?? []).join(", ")}`);
      parts.push(`Evaluation Criteria: ${(rfpAnalysis.evaluation_criteria ?? []).join(", ")}`);
    }
    return parts.join("\n");
  }, [contract, rfpAnalysis]);

  /* ═══ QUICK UPLOAD PDF HANDLER ═══ */
  const handleQuickUploadPdf = async () => {
    if (!quickPdfFile || !user) return;
    setQuickPdfUploading(true);
    try {
      // Upload PDF via backend API (no CORS issues)
      const formData = new FormData();
      formData.append("file", quickPdfFile);
      formData.append("contractId", contractId);
      formData.append("userId", user.id);

      const response = await fetch(apiUrl("/api/upload-proposal"), {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const data = await response.json();

      // Immediately persist the uploaded proposal in Supabase so it appears
      // in vendor responses and can be analyzed.
      const proposalId = randomUUID();
      const { error: proposalError } = await supabase.from("proposals").insert({
        id: proposalId,
        contract_id: contractId,
        vendor_id: user.id,
        vendor_name: profile?.company_name || "Unknown",
        price: "",
        timeline: "",
        experience: "",
        proposal_data: JSON.stringify({ source: "uploaded_pdf", storagePath: data.storagePath ?? null }),
        proposal_file: data.url,
        proposal_file_name: data.fileName || quickPdfFile.name,
        proposal_type: "uploaded_pdf",
        ai_score: null,
        risk_level: null,
        created_at: new Date().toISOString(),
      });

      if (proposalError) {
        console.error("Failed to insert uploaded proposal:", proposalError);
        throw proposalError;
      }

      // Notify contract owner if available
      if (contract?.posted_by) {
        const { error: notificationError } = await supabase.from("notifications").insert({
          id: crypto.randomUUID(),
          user_id: contract.posted_by as string,
          type: "new_proposal",
          message: `${profile?.company_name} submitted a proposal for "${contract.title}"`,
          read: false,
          timestamp: new Date().toISOString(),
        });
        if (notificationError) console.warn("Notification insert failed:", notificationError);
      }

      // Update local state and navigate to the vendor response / report page
      setQuickPdfUrl(data.url);
      setQuickPdfFileName(data.fileName || quickPdfFile.name);
      setQuickUploadSaved(true);
      setQuickPdfFile(null);
    } catch (err) {
      console.error("PDF upload failed:", err);
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      alert(`Upload failed: ${errMsg}`);
    } finally {
      setQuickPdfUploading(false);
    }
  };

  /* ═══ STEP 1: Analyze RFP ═══ */
  const handleAnalyzeRfp = async () => {
    if (!contract) return;
    setAnalyzingRfp(true);
    try {
      const rfpText = typeof contract.rfp_document === "string" && !(contract.rfp_document as string).startsWith("data:")
        ? contract.rfp_document as string
        : undefined;
      const analysis = await parseRFP({
        rfp_text: rfpText,
        contract_title: contract.title as string,
        contract_description: contract.description as string,
        contract_budget: contract.budget as string,
        contract_deadline: contract.deadline as string,
        contract_industry: contract.industry as string,
      });
      setRfpAnalysis(analysis);
    } catch {
      alert("Failed to analyze RFP. You can still proceed manually.");
    }
    setAnalyzingRfp(false);
  };

  /* ═══ STEP 3a: Chat ═══ */
  const sectionKeys = Object.keys(SECTION_LABELS) as (keyof ProposalSections)[];

  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim() };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatInput("");
    setChatLoading(true);
    try {
      // Tell the API which section to ask about next
      const nextIndex = Math.min(sectionIndex + 1, 15);
      // Only send last 4 messages to avoid LLM context overflow; full history kept for final generation
      const recentMessages = updated.slice(-4);
      const resp = await proposalChat(recentMessages, getRfpContext(), nextIndex);
      setChatMessages([...updated, { role: "assistant", content: resp.reply }]);
      setSectionIndex(resp.section_index);
      if (resp.proposal_ready || resp.section_index >= 15) {
        setProposalReady(true);
      }
    } catch {
      setChatMessages([...updated, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    }
    setChatLoading(false);
  };

  const handleGenerateFromChat = async () => {
    if (!contract) return;
    setGeneratingProposal(true);
    try {
      const proposal = await generateFullProposal(
        chatMessages,
        getRfpContext(),
        profile?.company_name || "Vendor",
        contract.title as string
      );
      setSections(normalizeSections(proposal.sections));
      setProposalTitle(proposal.proposal_title);
      setTotalPrice(proposal.total_price);
      setTimelineSummary(proposal.timeline_summary);
      setShowPdfOptions(true);
    } catch {
      alert("Failed to generate proposal. Please try again.");
    }
    setGeneratingProposal(false);
  };

  /* ═══ STEP 3b: Upload & Parse ═══ */
  const handleParseUpload = async () => {
    if (!uploadFile) return;
    setParsingUpload(true);
    try {
      const text = await uploadFile.text();
      const parsed = await parseUploadedProposal(text);
      setSections(normalizeSections(parsed.sections));
      setTotalPrice(parsed.extracted_price);
      setTimelineSummary(parsed.extracted_timeline);
      setProposalTitle(`Proposal for ${(contract?.title as string) || "Contract"}`);
      setStep("editor");
    } catch {
      alert("Failed to parse proposal. Make sure it's a text-readable file.");
    }
    setParsingUpload(false);
  };

  /* ═══ STEP 4: Edit section ═══ */
  const handleEditSection = async (sectionKey: keyof ProposalSections) => {
    if (!editInstructions.trim()) return;
    setEditLoading(true);
    try {
      const edited = await editProposalSection(
        SECTION_LABELS[sectionKey],
        sections[sectionKey],
        editInstructions,
        getRfpContext()
      );
      setSections((prev) => ({ ...prev, [sectionKey]: edited }));
      setEditInstructions("");
      setEditingSection(null);
    } catch {
      alert("Failed to edit section.");
    }
    setEditLoading(false);
  };

  /* ═══ PDF helpers ═══ */
  const getPdfInput = useCallback(() => ({
    title: proposalTitle || "Vendor Proposal",
    vendorName: profile?.company_name || "Vendor",
    contractTitle: (contract?.title as string) || "Contract",
    totalPrice,
    timeline: timelineSummary,
    sections,
    sectionLabels: SECTION_LABELS,
    template: selectedTemplate,
    chartData,
    executiveSummary,
  }), [proposalTitle, profile?.company_name, contract?.title, totalPrice, timelineSummary, sections, selectedTemplate, chartData, executiveSummary]);

  const handleDownloadPDF = () => {
    downloadProposalPDF(getPdfInput());
  };

  /* Regenerate PDF preview when on preview step and inputs change */
  useEffect(() => {
    if (step !== "preview") return;
    // Revoke old URL to avoid memory leaks
    let url: string | null = null;
    try {
      const pdfDoc = generateProposalPDF(getPdfInput());
      const blob = pdfDoc.output("blob");
      url = URL.createObjectURL(blob);
      setPdfPreviewUrl(url);
    } catch (e) {
      console.error("PDF preview generation failed:", e);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [step, getPdfInput]);

  /* ═══ AI Critique & Refine ═══ */
  const handleCritique = async () => {
    setCritiquing(true);
    try {
      const result = await critiqueProposal(sections, getRfpContext());
      setCritique(result);
    } catch {
      alert("Failed to critique proposal.");
    }
    setCritiquing(false);
  };

  const handleRefineAll = async () => {
    if (!critique) return;
    setRefining(true);
    try {
      const result = await refineProposal(sections, critique, getRfpContext());
      if (result.improved_sections) {
        const normalized = normalizeSections(result.improved_sections as Record<string, unknown>);
        setSections(prev => ({ ...prev, ...normalized }));
      }
    } catch {
      alert("Failed to refine proposal.");
    }
    setRefining(false);
  };

  const handleExtractCharts = async () => {
    setExtractingCharts(true);
    try {
      const data = await extractChartData(sections);
      setChartData(data);
    } catch {
      alert("Failed to extract chart data.");
    }
    setExtractingCharts(false);
  };

  /* ═══ Expand All Sections for 20-40 page proposal ═══ */
  const handleExpandAll = async () => {
    if (!contract) return;
    setExpanding(true);
    setExpandProgress(null);
    try {
      const result = await expandAllSections(
        sections,
        getRfpContext(),
        profile?.company_name || "Vendor",
        (contract.title as string) || "Contract",
        (p) => setExpandProgress(p)
      );
      setSections(normalizeSections(result.sections));
      if (result.executiveSummary) setExecutiveSummary(result.executiveSummary);
    } catch {
      alert("Failed to expand proposal. Some sections may have been updated.");
    }
    setExpanding(false);
    setExpandProgress(null);
  };

  /* ═══ STEP 5: Submit ═══ */
  const handleSubmit = async () => {
    if (!user) {
      alert("Please sign in to submit.");
      return;
    }
    setSubmitting(true);
    try {
      // If a quick-uploaded PDF exists, save it as an uploaded proposal record.
      if (quickPdfUrl) {
        const proposalId = randomUUID();
        const { error: proposalError } = await supabase.from("proposals").insert({
          id: proposalId,
          contract_id: contractId,
          vendor_id: user.id,
          vendor_name: profile?.company_name || "Unknown",
          price: totalPrice || "",
          timeline: timelineSummary || "",
          experience: sections.past_experience ? sections.past_experience.slice(0, 500) : "",
          proposal_data: JSON.stringify({ source: "uploaded_pdf" }),
          proposal_file: quickPdfUrl,
          proposal_file_name: quickPdfFileName || "uploaded.pdf",
          proposal_type: "uploaded_pdf",
          ai_score: null,
          risk_level: null,
          created_at: new Date().toISOString(),
        });

        if (proposalError) throw proposalError;

        if (contract?.posted_by) {
          const { error: notificationError } = await supabase.from("notifications").insert({
            id: randomUUID(),
            user_id: contract.posted_by as string,
            type: "new_proposal",
            message: `${profile?.company_name} submitted a proposal for "${contract.title}"`,
            read: false,
            timestamp: new Date().toISOString(),
          });
          if (notificationError) console.warn("Notification insert failed:", notificationError);
        }

        // Clear quick-upload state after successful save
        setQuickPdfUrl(null);
        setQuickPdfFileName("");
        setQuickPdfFile(null);

        router.push(`/contracts/${contractId}`);
        return;
      }
      const safeName = (proposalTitle || "proposal").replace(/[^a-zA-Z0-9]/g, "_");

      // Store proposal data for PDF regeneration on the receiver side
      const proposalData = {
        title: proposalTitle || "Vendor Proposal",
        vendorName: profile?.company_name || "Vendor",
        contractTitle: (contract?.title as string) || "Contract",
        totalPrice,
        timeline: timelineSummary,
        sections,
        sectionLabels: SECTION_LABELS,
        template: selectedTemplate,
        chartData: chartData || null,
        executiveSummary: executiveSummary || "",
      };

      const { error: proposalError } = await supabase.from("proposals").insert({
        id: randomUUID(),
        contract_id: contractId,
        vendor_id: user.id,
        vendor_name: profile?.company_name || "Unknown",
        price: totalPrice,
        timeline: timelineSummary,
        experience: sections.past_experience.slice(0, 500),
        proposal_data: JSON.stringify(proposalData),
        proposal_file_name: `${safeName}.pdf`,
        proposal_type: "generated",
        ai_score: null,
        risk_level: null,
        created_at: new Date().toISOString(),
      });

      if (proposalError) {
        throw proposalError;
      }
      if (contract?.posted_by) {
        const { error: notificationError } = await supabase.from("notifications").insert({
          id: crypto.randomUUID(),
          user_id: contract.posted_by as string,
          type: "new_proposal",
          message: `${profile?.company_name} submitted a proposal for "${contract.title}"`,
          read: false,
          timestamp: new Date().toISOString(),
        });

        if (notificationError) {
          throw notificationError;
        }
      }
      router.push(`/contracts/${contractId}`);
    } catch (err) {
      console.error("Proposal submission failed:", err);
      alert("Failed to submit proposal. Check the console for details.");
      setSubmitting(false);
    }
  };

  /* ─── Loading / auth guards ─── */
  if (loading) return <div className="flex justify-center items-center min-h-screen text-[var(--muted)]">Loading...</div>;
  if (!contract) return <div className="flex justify-center items-center min-h-screen text-[var(--muted)]">Contract not found.</div>;
  if (!user) return <div className="flex justify-center items-center min-h-screen text-[var(--muted)]">Please sign in to apply.</div>;

  /* ═══════════════════════════════════════════════════════════ */
  /*                        RENDER                              */
  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link href={`/contracts/${contractId}`} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--primary)] mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back to Contract
        </Link>

        {/* ─── Step Progress Bar ─── */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {[
            { key: "rfp_analysis", label: "Analyze RFP", alt: undefined },
            { key: "choice", label: "Choose Method", alt: undefined },
            { key: "chat_build", label: "Build Proposal", alt: "upload_edit" },
            { key: "editor", label: "Edit & Refine", alt: undefined },
            { key: "preview", label: "Preview & Submit", alt: undefined },
          ].map((s, i) => {
            const stepOrder: Step[] = ["rfp_analysis", "choice", "chat_build", "editor", "preview"];
            const altStepOrder: Step[] = ["rfp_analysis", "choice", "upload_edit", "editor", "preview"];
            const currentIdx = Math.max(stepOrder.indexOf(step), altStepOrder.indexOf(step));
            const isActive = step === s.key || step === s.alt;
            const isPast = i < currentIdx;
            return (
              <div key={s.key} className="flex items-center gap-2 shrink-0">
                {i > 0 && <div className={`w-8 h-0.5 ${isPast ? "bg-[var(--primary)]" : "bg-[var(--divider)]"}`} />}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isActive ? "bg-[var(--primary)] text-[#EFECE3] shadow-md" : isPast ? "bg-[var(--primary-light)] text-[var(--primary)]" : "bg-[var(--surface)] text-[var(--muted)]"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${isActive ? "bg-[#EFECE3]/20" : isPast ? "bg-[var(--accent-light)] text-[var(--primary)]" : "bg-[var(--divider)]"}`}>
                    {isPast ? "✓" : i + 1}
                  </span>
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* ─── Contract Summary Strip ─── */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-2xl p-5 mb-6">
          <p className="text-[10px] uppercase tracking-widest text-[var(--primary)] font-semibold mb-1">Applying to</p>
          <h1 className="text-lg font-bold text-[var(--foreground)] leading-snug mb-3">{contract.title as string}</h1>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="font-semibold text-[var(--foreground)]">{shortBudget(contract.budget)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <span className="font-semibold text-[var(--foreground)]">{shortDeadline(contract.deadline)}</span>
            </div>
            {contract.industry ? (
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                <span className="font-semibold text-[var(--foreground)] capitalize">{contract.industry as string}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/*           STEP 1: RFP OVERVIEW                      */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "rfp_analysis" && (
          <div className="space-y-6">
            {/* RFP Document Preview */}
            {typeof contract.rfp_document === "string" && !(contract.rfp_document).startsWith("data:") && (
              <div className="card">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[var(--primary-light)] rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--foreground)]">RFP Document</h2>
                    <p className="text-xs text-[var(--muted)]">{contract.rfp_file_name ? contract.rfp_file_name as string : "Contract requirements"}</p>
                  </div>
                </div>
                <div className="bg-[var(--surface)] rounded-xl p-5 text-sm text-[var(--foreground)] whitespace-pre-wrap font-mono max-h-72 overflow-y-auto border border-[var(--divider)] leading-relaxed">
                  {String(contract.rfp_document)}
                </div>
              </div>
            )}

            {/* Contract Details */}
            <div className="card">
              <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">Contract Details</h2>
              <div className="text-sm text-[var(--muted)] leading-relaxed mb-5">
                {renderDescription(contract.description as string)}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Budget", value: shortBudget(contract.budget) },
                  { label: "Deadline", value: shortDeadline(contract.deadline) },
                  { label: "Industry", value: (contract.industry as string) || "N/A", capitalize: true },
                  { label: "Certifications", value: shortDisplay((contract.required_certifications as string) || "None") },
                ].map((item) => (
                  <div key={item.label} className="bg-[var(--surface)] border border-[var(--divider)] rounded-xl p-4 min-h-[80px] flex flex-col">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--muted)] mb-2">{item.label}</p>
                    <p className={`text-sm font-semibold text-[var(--foreground)] leading-snug break-words ${item.capitalize ? "capitalize" : ""}`} title={item.value}>{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Expandable full budget & deadline details */}
              {(String(contract.budget ?? "").length > 60 || String(contract.deadline ?? "").length > 60) && (
                <details className="mt-4 group">
                  <summary className="text-xs text-[var(--primary)] cursor-pointer font-medium hover:underline flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    View full budget &amp; timeline details
                  </summary>
                  <div className="mt-3 space-y-3">
                    {String(contract.budget ?? "").length > 60 && (
                      <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--divider)]">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">Full Budget Details</p>
                        <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">{contract.budget as string}</p>
                      </div>
                    )}
                    {String(contract.deadline ?? "").length > 60 && (
                      <div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--divider)]">
                        <p className="text-[10px] uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">Full Timeline Details</p>
                        <p className="text-sm text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">{contract.deadline as string}</p>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>

            {/* Continue Button */}
            <div className="flex justify-end">
              <button onClick={() => setStep("choice")} className="flex items-center justify-center gap-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[#EFECE3] px-8 py-3.5 rounded-full text-sm font-semibold transition-all shadow-md hover:shadow-lg">
                Continue to Proposal Builder
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*           STEP 2: CHOICE                            */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "choice" && (
          <div className="space-y-6">
            <div className="text-center mb-2">
              <h2 className="text-2xl font-bold text-[var(--foreground)]">How would you like to submit your proposal?</h2>
              <p className="text-sm text-[var(--muted)] mt-2">Choose your preferred method.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {/* Build from Scratch */}
              <button onClick={() => {
                setChatMessages([]);
                setStep("chat_build");
              }} className="group bg-[#EFECE3] border-2 border-[var(--divider)] hover:border-[var(--accent)] rounded-2xl p-8 text-left transition-all hover:shadow-lg">
                <div className="w-14 h-14 bg-[var(--primary-light)] group-hover:bg-[var(--accent-light)] rounded-full flex items-center justify-center mb-5 transition-colors">
                  <svg className="w-7 h-7 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <h3 className="text-lg font-bold text-[var(--foreground)] mb-2">Build from Scratch</h3>
                <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">Our AI assistant will interview you step-by-step, asking targeted questions based on the RFP requirements to build a professional proposal.</p>
                <div className="flex flex-wrap gap-2">
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">AI-Guided</span>
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">Interactive Chat</span>
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">RFP-Tailored</span>
                </div>
              </button>

              {/* Edit Existing */}
              <button onClick={() => setStep("upload_edit")} className="group bg-[#EFECE3] border-2 border-[var(--divider)] hover:border-[var(--accent)] rounded-2xl p-8 text-left transition-all hover:shadow-lg">
                <div className="w-14 h-14 bg-[var(--primary-light)] group-hover:bg-[var(--accent-light)] rounded-full flex items-center justify-center mb-5 transition-colors">
                  <svg className="w-7 h-7 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </div>
                <h3 className="text-lg font-bold text-[var(--foreground)] mb-2">Edit Existing Proposal</h3>
                <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">Upload your existing proposal document. Our AI will parse it into sections so you can edit, enhance, and refine each part before submitting.</p>
                <div className="flex flex-wrap gap-2">
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">Upload &amp; Parse</span>
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">Section Editor</span>
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">AI Refinement</span>
                </div>
              </button>

              {/* Quick Upload PDF */}
              <div className="group bg-[#EFECE3] border-2 border-[var(--divider)] hover:border-[var(--accent)] rounded-2xl p-8 text-left transition-all hover:shadow-lg">
                <div className="w-14 h-14 bg-[var(--primary-light)] group-hover:bg-[var(--accent-light)] rounded-full flex items-center justify-center mb-5 transition-colors">
                  <svg className="w-7 h-7 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 12l2 2 4-4" /></svg>
                </div>
                <h3 className="text-lg font-bold text-[var(--foreground)] mb-2">Quick Upload PDF</h3>
                <p className="text-sm text-[var(--muted)] leading-relaxed mb-4">Upload your vendor proposal PDF directly. Your proposal will be extracted and sent to the company for analysis.</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">PDF Upload</span>
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">Fast Submit</span>
                  <span className="bg-[var(--primary-light)] text-[var(--primary)] px-2.5 py-1 rounded-lg text-xs font-medium">AI Ready</span>
                </div>
                <label className="block cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        if (f.size > 10_000_000) {
                          alert("PDF must be under 10 MB.");
                          return;
                        }
                        if (f.type !== "application/pdf") {
                          alert("Please select a PDF file.");
                          return;
                        }
                        setQuickPdfFile(f);
                      }
                    }}
                    className="hidden"
                  />
                  <div className="bg-white border-2 border-dashed border-[var(--divider)] hover:border-[var(--primary)] rounded-lg p-4 text-center transition-colors cursor-pointer">
                    {quickPdfFile ? (
                      <>
                        <svg className="w-5 h-5 text-[var(--primary)] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        <p className="text-xs font-semibold text-[var(--foreground)]">{quickPdfFile.name}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-[var(--foreground)]">Click to upload PDF</p>
                        <p className="text-[10px] text-[var(--muted)] mt-1">Up to 10 MB</p>
                      </>
                    )}
                  </div>
                </label>
                {quickPdfFile && (
                  <button
                    onClick={handleQuickUploadPdf}
                    disabled={quickPdfUploading}
                    className="w-full mt-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[#EFECE3] px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition-all"
                  >
                    {quickPdfUploading ? (
                          <><div className="w-3 h-3 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin inline-block mr-2" />Uploading...</>
                    ) : (
                          "Upload PDF"
                    )}
                  </button>
                )}
              </div>
            </div>

            <button onClick={() => setStep("rfp_analysis")} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors mx-auto">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back to RFP Analysis
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*           STEP 3a: AI CHAT BUILDER                  */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "chat_build" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--foreground)]">AI Proposal Builder</h2>
                <p className="text-xs text-[var(--muted)]">Answer all 15 sections. The AI will ask about each one in order.</p>
              </div>
              <div className="flex gap-2">
                {(proposalReady || chatMessages.length >= 6) && !showPdfOptions && (
                  <button onClick={handleGenerateFromChat} disabled={generatingProposal} className="flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-all shadow-sm">
                    {generatingProposal ? (
                      <><div className="w-3.5 h-3.5 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin" />Generating...</>
                    ) : (
                      <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Generate Proposal</>
                    )}
                  </button>
                )}
                {showPdfOptions && (
                  <button onClick={() => setStep("editor")} className="flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all shadow-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    Edit Sections
                  </button>
                )}
              </div>
            </div>

            {/* Section Progress Bar */}
            <div className="card !p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[var(--foreground)]">Interview Progress</p>
                <span className="text-xs font-bold text-[var(--primary)]">{Math.min(sectionIndex, 15)}/15 Sections</span>
              </div>
              <div className="w-full bg-[var(--surface)] rounded-full h-2.5">
                <div className="bg-gradient-to-r from-violet-500 to-emerald-500 h-2.5 rounded-full transition-all duration-700 ease-out" style={{ width: `${(Math.min(sectionIndex, 15) / 15) * 100}%` }} />
              </div>
            </div>

            {/* Main chat + sidebar layout */}
            <div className="flex gap-4">
              {/* Section Progress Sidebar */}
              <div className="hidden lg:block w-52 shrink-0">
                <div className="card !p-3 sticky top-24">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold px-2 mb-2">Section Checklist</p>
                  <div className="space-y-0.5 max-h-[26rem] overflow-y-auto">
                    {(Object.keys(SECTION_LABELS) as (keyof ProposalSections)[]).map((key, idx) => {
                      const isCovered = idx < sectionIndex;
                      const isAsking = idx === sectionIndex;
                      return (
                        <div
                          key={key}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${isCovered ? "bg-[var(--primary-light)] text-[var(--primary)]" : isAsking ? "bg-[var(--primary-light)] text-[var(--primary)] ring-1 ring-violet-300" : "text-[var(--muted)]"}`}
                        >
                          {isCovered ? (
                            <svg className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          ) : isAsking ? (
                            <div className="w-3.5 h-3.5 border-2 border-violet-500 rounded-full shrink-0 bg-[var(--accent-light)] animate-pulse" />
                          ) : (
                            <div className="w-3.5 h-3.5 border-2 border-[var(--divider)] rounded-full shrink-0" />
                          )}
                          <span className={`truncate ${isCovered ? "font-medium" : isAsking ? "font-semibold" : ""}`}>{SECTION_LABELS[key]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Chat Window */}
              <div className="flex-1 min-w-0">
                <div className="card !p-0 overflow-hidden">
                  <div className="h-[28rem] overflow-y-auto p-5 space-y-4">
                    {/* Welcome message */}
                    {chatMessages.length === 0 && !chatLoading && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 bg-[var(--primary-light)] rounded-full flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        </div>
                        <div className="bg-[var(--surface)] rounded-2xl rounded-tl-sm px-4 py-3 max-w-[80%]">
                          <p className="text-sm text-[var(--foreground)] leading-relaxed">
                            Hi! I&apos;m your AI proposal assistant. I&apos;ll guide you through <strong>all 15 sections</strong> to build a comprehensive proposal for <strong>{contract.title as string}</strong>.
                            {rfpAnalysis && <> I&apos;ve analyzed the RFP and will tailor my questions to the requirements.</>}
                            {" "}Let&apos;s start with <strong>Section 1: Vendor Basic Information</strong> — tell me your company name, primary contact, email, phone, address, and years of experience.
                          </p>
                        </div>
                      </div>
                    )}

                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-[var(--primary-light)]" : "bg-[var(--primary-light)]"}`}>
                          {msg.role === "user" ? (
                            <svg className="w-4 h-4 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                          ) : (
                            <svg className="w-4 h-4 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          )}
                        </div>
                        <div className={`rounded-2xl px-4 py-3 max-w-[80%] ${msg.role === "user" ? "bg-[var(--primary)] text-[#EFECE3] rounded-tr-sm" : "bg-[var(--surface)] text-[var(--foreground)] rounded-tl-sm"}`}>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    ))}

                    {chatLoading && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 bg-[var(--primary-light)] rounded-full flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        </div>
                        <div className="bg-[var(--surface)] rounded-2xl rounded-tl-sm px-4 py-3">
                          <div className="flex gap-1.5">
                            <div className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <div className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <div className="w-2 h-2 bg-[var(--muted)] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <div className="border-t border-[var(--divider)] p-4 bg-[var(--surface)]/50">
                    <form onSubmit={(e) => { e.preventDefault(); handleSendChat(); }} className="flex gap-3">
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Type your response..."
                        disabled={chatLoading}
                        className="input-field !rounded-xl disabled:opacity-50"
                      />
                      <button type="submit" disabled={chatLoading || !chatInput.trim()} className="bg-[var(--primary)] text-[#EFECE3] px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-all shadow-sm">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ PDF Options Panel (shown after proposal generation) ═══ */}
            {showPdfOptions && (
              <div className="bg-gradient-to-r from-emerald-50 to-blue-50 rounded-2xl border border-emerald-200/60 p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[var(--primary-light)] rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[var(--foreground)]">Proposal Generated Successfully!</h3>
                    <p className="text-xs text-[var(--muted)]">Choose a PDF template and download, or continue to the editor for refinements.</p>
                  </div>
                </div>

                {/* Template Picker */}
                <div>
                  <h4 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">PDF Template</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {TEMPLATE_OPTIONS.map((t) => (
                      <button key={t.key} onClick={() => setSelectedTemplate(t.key)} className={`p-3 rounded-xl border-2 text-left transition-all ${selectedTemplate === t.key ? "border-[var(--primary)] bg-[var(--primary-light)]" : "border-[var(--divider)] bg-[#EFECE3] hover:border-[var(--muted)]"}`}>
                        <p className="text-sm font-semibold text-[var(--foreground)]">{t.label}</p>
                        <p className="text-[10px] text-[var(--muted)] mt-0.5">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Section Summary */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {(Object.keys(SECTION_LABELS) as (keyof ProposalSections)[]).map((key) => (
                    <div key={key} className={`px-2 py-1.5 rounded-lg text-center ${sections[key] ? "bg-[var(--primary-light)]/80" : "bg-[var(--surface)]"}`}>
                      <p className="text-[9px] text-[var(--muted)] truncate">{SECTION_LABELS[key]}</p>
                      {sections[key] ? (
                        <svg className="w-3.5 h-3.5 text-[var(--primary)] mx-auto mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 text-[var(--muted)] mx-auto mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                      )}
                    </div>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 pt-2">
                  <button onClick={() => downloadProposalPDF({ title: proposalTitle || "Vendor Proposal", vendorName: profile?.company_name || "Vendor", contractTitle: (contract?.title as string) || "Contract", totalPrice, timeline: timelineSummary, sections, sectionLabels: SECTION_LABELS, template: selectedTemplate, chartData, executiveSummary })} className="flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all shadow-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Download PDF
                  </button>
                  <button onClick={() => setStep("editor")} className="btn-outline flex items-center gap-2 !px-5 !py-2.5 !text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    Edit &amp; Refine Sections
                  </button>
                  <button onClick={() => setStep("preview")} className="btn-outline flex items-center gap-2 !px-5 !py-2.5 !text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    Preview &amp; Submit
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setStep("choice")} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back
              </button>
              {chatMessages.length > 0 && (
                <p className="text-xs text-[var(--muted)]">{chatMessages.filter((m) => m.role === "user").length} responses &middot; {Math.min(sectionIndex, 15)}/15 sections covered</p>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*           STEP 3b: UPLOAD & EDIT                    */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "upload_edit" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-[var(--foreground)]">Upload Your Vendor Proposal</h2>
              <p className="text-xs text-[var(--muted)] mt-1">Upload a PDF only. It will be saved to Supabase and sent for analysis.</p>
            </div>

            <div className="card !p-8">
              {quickUploadSaved ? (
                <div className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-xl text-center px-6">
                  <svg className="w-10 h-10 text-emerald-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  <p className="text-sm font-semibold text-emerald-800">Vendor proposal uploaded</p>
                  <p className="text-xs text-emerald-700 mt-1">It has been saved to Supabase and is ready for vendor response analysis.</p>
                </div>
              ) : (
              <label className="group flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-[var(--divider)] hover:border-[var(--primary)] hover:bg-[var(--primary-light)]/30 rounded-xl cursor-pointer transition-all">
                <input type="file" accept=".pdf" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > 700_000) { alert("File must be under 700 KB."); return; }
                    if (f.type !== "application/pdf") { alert("Please select a PDF file."); return; }
                    setQuickPdfFile(f);
                    setQuickPdfFileName(f.name);
                    setQuickUploadSaved(false);
                  }
                }} className="hidden" />
                {quickPdfFileName ? (
                  <div className="text-center">
                    <div className="w-12 h-12 bg-[var(--primary-light)] rounded-xl flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{quickPdfFileName}</p>
                    <p className="text-xs text-[var(--muted)] mt-1">Click to replace</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <svg className="w-10 h-10 text-[var(--muted)] mx-auto mb-3 group-hover:text-[var(--primary)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    <p className="text-sm font-medium text-[var(--foreground)]">Click to upload vendor proposal PDF</p>
                    <p className="text-xs text-[var(--muted)] mt-1">PDF only &middot; Up to 700 KB</p>
                  </div>
                )}
              </label>
              )}

              {quickUploadSaved && quickPdfFileName && (
                <p className="mt-4 text-center text-xs text-[var(--muted)]">Saved file: {quickPdfFileName}</p>
              )}

              {!quickUploadSaved && quickPdfFile && (
                <button
                  onClick={handleQuickUploadPdf}
                  disabled={quickPdfUploading}
                  className="mt-5 w-full btn-primary flex items-center justify-center gap-2 !py-3.5"
                >
                  {quickPdfUploading ? (
                    <><div className="w-4 h-4 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin" />Uploading...</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Upload Proposal</>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*           STEP 4: PROPOSAL EDITOR                   */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "editor" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--foreground)]">Proposal Editor</h2>
                <p className="text-xs text-[var(--muted)]">Edit each section. Use AI to refine any section, or type directly.</p>
              </div>
              <button onClick={() => setStep("preview")} className="flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all shadow-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                Preview &amp; Submit
              </button>
            </div>

            {/* Proposal Title & Meta */}
            <div className="card">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">Proposal Title</label>
                  <input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} className="input-field" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">Total Price</label>
                  <input value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="e.g., $45,000" className="input-field" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">Timeline</label>
                  <input value={timelineSummary} onChange={(e) => setTimelineSummary(e.target.value)} placeholder="e.g., 3 months" className="input-field" />
                </div>
              </div>
            </div>

            {/* Section Navigation */}
            <div className="flex gap-6">
              {/* Sidebar */}
              <div className="hidden md:block w-56 shrink-0">
                <div className="card !p-3 sticky top-24">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold px-2 mb-2">Sections</p>
                  <div className="space-y-0.5">
                    {(Object.keys(SECTION_LABELS) as (keyof ProposalSections)[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => setActiveEditorSection(key)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${activeEditorSection === key ? "bg-[var(--primary-light)] text-[var(--primary)]" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"}`}
                      >
                        <svg className={`w-3.5 h-3.5 shrink-0 ${activeEditorSection === key ? "text-[var(--primary)]" : "text-[var(--muted)]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SECTION_ICONS[key]} /></svg>
                        <span className="truncate">{SECTION_LABELS[key]}</span>
                        {sections[key] && <div className="w-1.5 h-1.5 bg-[var(--primary)] rounded-full ml-auto shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Editor Area */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Mobile section selector */}
                <div className="md:hidden">
                  <select
                    value={activeEditorSection}
                    onChange={(e) => setActiveEditorSection(e.target.value as keyof ProposalSections)}
                    className="input-field !rounded-xl"
                  >
                    {(Object.keys(SECTION_LABELS) as (keyof ProposalSections)[]).map((key) => (
                      <option key={key} value={key}>{SECTION_LABELS[key]} {sections[key] ? "✓" : ""}</option>
                    ))}
                  </select>
                </div>

                {/* Active Section Editor */}
                <div className="card !p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 bg-[var(--primary-light)] rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={SECTION_ICONS[activeEditorSection]} /></svg>
                    </div>
                    <h3 className="text-base font-semibold text-[var(--foreground)]">{SECTION_LABELS[activeEditorSection]}</h3>
                  </div>

                  <textarea
                    value={sections[activeEditorSection]}
                    onChange={(e) => setSections((prev) => ({ ...prev, [activeEditorSection]: e.target.value }))}
                    rows={12}
                    placeholder={`Write your ${SECTION_LABELS[activeEditorSection].toLowerCase()} here...`}
                    className="input-field !rounded-xl !leading-relaxed resize-y"
                  />

                  {/* AI Edit Section */}
                  <div className="mt-4 pt-4 border-t border-[var(--divider)]">
                    {editingSection === activeEditorSection ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-[var(--primary-light)] rounded-md flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          </div>
                          <p className="text-xs font-semibold text-[var(--foreground)]">AI Edit Instructions</p>
                        </div>
                        <textarea
                          value={editInstructions}
                          onChange={(e) => setEditInstructions(e.target.value)}
                          rows={2}
                          placeholder="e.g., Make it more concise, add more technical detail, emphasize our experience with similar projects..."
                          className="w-full border border-violet-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all bg-[var(--primary-light)]/30"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => handleEditSection(activeEditorSection)} disabled={editLoading || !editInstructions.trim()} className="flex items-center gap-1.5 bg-[var(--primary)] text-[#EFECE3] px-4 py-2 rounded-lg text-xs font-semibold hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-all">
                            {editLoading ? (
                              <><div className="w-3 h-3 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin" />Editing...</>
                            ) : (
                              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Apply AI Edit</>
                            )}
                          </button>
                          <button onClick={() => { setEditingSection(null); setEditInstructions(""); }} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-3 py-2 transition-colors">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setEditingSection(activeEditorSection)} className="flex items-center gap-2 text-xs text-[var(--primary)] hover:text-[var(--primary)] font-medium transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        Refine with AI
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Section Navigation */}
                <div className="flex justify-between">
                  {(() => {
                    const keys = Object.keys(SECTION_LABELS) as (keyof ProposalSections)[];
                    const idx = keys.indexOf(activeEditorSection);
                    return (
                      <>
                        <button onClick={() => idx > 0 && setActiveEditorSection(keys[idx - 1])} disabled={idx === 0} className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                          Previous Section
                        </button>
                        <button onClick={() => idx < keys.length - 1 && setActiveEditorSection(keys[idx + 1])} disabled={idx === keys.length - 1} className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 transition-colors">
                          Next Section
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            <button onClick={() => setStep("choice")} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back to Method Selection
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*           STEP 5: PREVIEW & SUBMIT                  */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "preview" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--foreground)]">Preview Your Proposal</h2>
                <p className="text-xs text-[var(--muted)]">Review your complete proposal before submitting.</p>
              </div>
              <button onClick={() => setStep("editor")} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--primary)] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Edit
              </button>
            </div>

            {/* Quick Edit Bar */}
            <div className="card">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">Total Price</label>
                  <input value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="e.g., $45,000" className="input-field" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">Timeline</label>
                  <input value={timelineSummary} onChange={(e) => setTimelineSummary(e.target.value)} placeholder="e.g., 3 months" className="input-field" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5">Proposal Title</label>
                  <input value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} placeholder="Vendor Proposal" className="input-field" />
                </div>
              </div>
            </div>

            {/* Template Selector & AI Tools */}
            <div className="card space-y-4">
                {/* Template Picker */}
                <div>
                  <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">PDF Template</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {TEMPLATE_OPTIONS.map((t) => (
                      <button key={t.key} onClick={() => setSelectedTemplate(t.key)} className={`p-3 rounded-xl border-2 text-left transition-all ${selectedTemplate === t.key ? "border-[var(--primary)] bg-[var(--primary-light)]" : "border-[var(--divider)] hover:border-[var(--muted)]"}`}>
                        <p className="text-sm font-semibold text-[var(--foreground)]">{t.label}</p>
                        <p className="text-[10px] text-[var(--muted)] mt-0.5">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI Operations */}
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleCritique} disabled={critiquing} className="flex items-center gap-1.5 bg-[var(--primary-light)] text-[var(--primary)] px-4 py-2 rounded-lg text-xs font-semibold hover:bg-[var(--primary-light)] disabled:opacity-50 transition-all border border-violet-200">
                    {critiquing ? <><div className="w-3 h-3 border-2 border-violet-400/30 border-t-violet-600 rounded-full animate-spin" />Analyzing...</> : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>AI Critique</>}
                  </button>
                  {critique && (
                    <button onClick={handleRefineAll} disabled={refining} className="flex items-center gap-1.5 bg-[var(--primary-light)] text-[var(--primary)] px-4 py-2 rounded-lg text-xs font-semibold hover:bg-[var(--primary-light)] disabled:opacity-50 transition-all border border-emerald-200">
                      {refining ? <><div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-600 rounded-full animate-spin" />Refining...</> : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Auto-Refine All</>}
                    </button>
                  )}
                  <button onClick={handleExtractCharts} disabled={extractingCharts} className="flex items-center gap-1.5 bg-[var(--primary-light)] text-[var(--primary)] px-4 py-2 rounded-lg text-xs font-semibold hover:bg-[var(--primary-light)] disabled:opacity-50 transition-all border border-blue-200">
                    {extractingCharts ? <><div className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-600 rounded-full animate-spin" />Extracting...</> : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>Extract Charts</>}
                  </button>
                  <button onClick={handleExpandAll} disabled={expanding} className="flex items-center gap-1.5 bg-amber-50 text-amber-700 px-4 py-2 rounded-lg text-xs font-semibold hover:bg-amber-100 disabled:opacity-50 transition-all border border-amber-200">
                    {expanding ? <><div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-600 rounded-full animate-spin" />Expanding...</> : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>Expand to Full Proposal (20-40 Pages)</>}
                  </button>
                </div>

                {/* Expand Progress */}
                {expanding && expandProgress && (
                  <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-amber-800">Expanding Proposal</h4>
                      <span className="text-xs font-bold text-amber-600">{expandProgress.current}/{expandProgress.total}</span>
                    </div>
                    <div className="w-full bg-amber-200/40 rounded-full h-2 mb-2">
                      <div className="bg-amber-500 h-2 rounded-full transition-all duration-500" style={{ width: `${(expandProgress.current / expandProgress.total) * 100}%` }} />
                    </div>
                    <p className="text-xs text-amber-700">
                      {expandProgress.phase === "expanding" && `Expanding: ${expandProgress.sectionLabel}`}
                      {expandProgress.phase === "summary" && "Generating Executive Summary..."}
                      {expandProgress.phase === "done" && "Expansion complete!"}
                    </p>
                  </div>
                )}

                {/* Critique Results */}
                {critique && (
                  <div className="bg-[var(--primary-light)]/50 border border-violet-200/60 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-[var(--foreground)]">AI Critique</h4>
                      <span className={`text-lg font-bold ${critique.overall_score >= 80 ? "text-[var(--primary)]" : critique.overall_score >= 60 ? "text-amber-600" : "text-red-600"}`}>{critique.overall_score}/100</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      {Object.entries(critique.section_scores ?? {}).slice(0, 8).map(([key, s]) => (
                        <div key={key} className="bg-[#EFECE3] rounded-lg p-2 text-center">
                          <p className="text-[10px] text-[var(--muted)] truncate">{key.replace(/_/g, " ")}</p>
                          <p className={`text-sm font-bold ${s.score >= 80 ? "text-[var(--primary)]" : s.score >= 60 ? "text-amber-600" : "text-red-600"}`}>{s.score}</p>
                        </div>
                      ))}
                    </div>
                    {(critique.weaknesses?.length ?? 0) > 0 && (
                      <div className="text-xs text-[var(--primary)] space-y-1">
                        <p className="font-semibold">Areas to improve:</p>
                        <ul className="list-disc pl-4 space-y-0.5">{critique.weaknesses.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Chart Data Preview */}
                {chartData && (
                  <div className="bg-[var(--primary-light)]/50 border border-blue-200/60 rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-[var(--foreground)] mb-2">Chart Data Extracted</h4>
                    <div className="flex flex-wrap gap-3 text-xs text-[var(--primary)]">
                      {(chartData.cost_breakdown?.length ?? 0) > 0 && <span className="bg-[var(--primary-light)] px-2.5 py-1 rounded-lg">{chartData.cost_breakdown.length} cost items</span>}
                      {(chartData.timeline_phases?.length ?? 0) > 0 && <span className="bg-[var(--primary-light)] px-2.5 py-1 rounded-lg">{chartData.timeline_phases.length} timeline phases</span>}
                      {(chartData.team_structure?.length ?? 0) > 0 && <span className="bg-[var(--primary-light)] px-2.5 py-1 rounded-lg">{chartData.team_structure.length} team members</span>}
                      {(chartData.risk_matrix?.length ?? 0) > 0 && <span className="bg-[var(--primary-light)] px-2.5 py-1 rounded-lg">{chartData.risk_matrix.length} risks</span>}
                      {(chartData.deliverables_progress?.length ?? 0) > 0 && <span className="bg-[var(--primary-light)] px-2.5 py-1 rounded-lg">{chartData.deliverables_progress.length} deliverables</span>}
                    </div>
                    <p className="text-[10px] text-[var(--primary)] mt-2">Charts will be included in the generated PDF.</p>
                  </div>
                )}
            </div>

            {/* PDF Preview */}
            <div className="card !p-0 overflow-hidden">
              <div className="bg-[var(--surface)] border-b border-[var(--divider)] px-4 py-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                <span className="text-sm font-semibold text-[var(--foreground)]">PDF Preview</span>
                <span className="text-xs text-[var(--muted)] ml-auto">This is the exact PDF that will be submitted</span>
              </div>
              {pdfPreviewUrl ? (
                <iframe src={pdfPreviewUrl} className="w-full border-0" style={{ height: "80vh", minHeight: "600px" }} title="Proposal PDF Preview" />
              ) : (
                <div className="flex items-center justify-center py-20 text-[var(--muted)]">
                  <div className="w-6 h-6 border-2 border-[var(--muted)]/30 border-t-[var(--muted)] rounded-full animate-spin mr-3" />
                  Generating PDF preview...
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => setStep("editor")} className="flex-1 flex items-center justify-center gap-2 bg-[var(--surface)] text-[var(--foreground)] px-6 py-3.5 rounded-full text-sm font-semibold hover:bg-[var(--divider)] transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Go Back &amp; Edit
              </button>
              <button onClick={handleDownloadPDF} className="flex-1 btn-primary flex items-center justify-center gap-2 !py-3.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Download PDF
              </button>
              <button onClick={handleSubmit} disabled={submitting} className="flex-1 flex items-center justify-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-6 py-3.5 rounded-full text-sm font-bold hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-all shadow-md">
                {submitting ? (
                  <><div className="w-4 h-4 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin" />Submitting...</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Submit Proposal</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
