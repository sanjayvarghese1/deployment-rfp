"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { firstNonEmptyText, extractCurrencyLikeText, extractTimelineLikeText } from "@/lib/formatters/number";
import { supabase } from "@/services/supabase";

function shortValue(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const s = raw.trim();
  if (s.length <= 22) return s;
  const dot = s.indexOf(".");
  if (dot > 0 && dot <= 30) return s.slice(0, dot + 1);
  return s.slice(0, 20) + "…";
}

function extractPdfBase64(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!value.startsWith("data:")) return value;
  const commaIndex = value.indexOf(",");
  return commaIndex >= 0 ? value.slice(commaIndex + 1) : null;
}

function downloadPdfFromBase64(base64: string, filename: string) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function ContractPreviewPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const contractId: string = String(params?.id || "");
  const { user, loading: authLoading } = useAuth();
  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savingContract, setSavingContract] = useState(false);
  const [referrer, setReferrer] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("from") || "";
    }
    return "";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      setReferrer(urlParams.get("from") || "");
    }
  }, []);

  useEffect(() => {
    const fetchContract = async () => {
      if (!contractId) return;
      try {
        const { data, error } = await supabase.from("contracts").select("*").eq("id", contractId).single();
        if (error) throw error;
        if (data) {
          setContract(data);
        }
      } catch (err) {
        console.error("Failed to fetch contract:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchContract();
  }, [contractId]);

  // Handle access guards once user and contract are loaded
  useEffect(() => {
    if (!authLoading && !loading) {
      if (!user) {
        router.push("/login");
        return;
      }
      if (contract) {
        // Only owner can view the preview/draft
        if (user.id !== contract.posted_by) {
          router.push("/contracts");
          return;
        }
        // If contract is already published, redirect to the normal details page
        if (contract.status !== "draft") {
          router.push(`/contracts/${contractId}?from=${referrer}`);
          return;
        }
      }
    }
  }, [user, authLoading, contract, loading, contractId, router, referrer]);

  const saveContract = async () => {
    setSavingContract(true);
    try {
      const { error } = await supabase
        .from("contracts")
        .update({ status: "open" })
        .eq("id", contractId);

      if (error) throw error;

      alert("RFP published successfully!");
      router.push("/my-contracts");
    } catch (err) {
      console.error("Failed to publish contract:", err);
      alert("Failed to publish contract. Please try again.");
    } finally {
      setSavingContract(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center text-[var(--muted)]">
        Contract not found.
      </div>
    );
  }

  const contractTextSource = [
    contract.description,
    contract.rfp_sections?.budget_framework,
    contract.rfp_sections?.implementation_timeline,
    contract.rfp_metadata?.budgetIndicator,
    contract.rfp_metadata?.timelineIndicator,
  ].filter(Boolean).join("\n");

  const displayBudget = firstNonEmptyText(
    contract.budget,
    contract.budget_range,
    contract.budget_framework,
    contract.budgetIndicator,
    contract.rfp_metadata?.budgetIndicator,
    extractCurrencyLikeText(contractTextSource)
  ) || "TBD";

  const displayDeadline = firstNonEmptyText(
    contract.deadline,
    contract.timelineIndicator,
    contract.implementation_timeline,
    contract.rfp_metadata?.timelineIndicator,
    extractTimelineLikeText(contractTextSource)
  ) || "TBD";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back link */}
      <button
        onClick={() => {
          if (referrer === "my-contracts") {
            router.push("/my-contracts");
          } else {
            router.push("/my-contracts");
          }
        }}
        className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--primary)] mb-5 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
        </svg>
        Back to My Contracts
      </button>

      {/* Draft banner for owner */}
      <div className="card mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" style={{ background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.3)" }}>
        <div className="flex-1">
          <h4 className="font-semibold text-[var(--foreground)] text-sm">Draft RFP Preview</h4>
          <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
            This RFP is currently in draft mode. Review the generated sections below. Once you are ready, click "Save to My Contracts" to publish it.
          </p>
        </div>
        <button
          onClick={saveContract}
          disabled={savingContract}
          className="btn-primary shrink-0 self-start sm:self-center"
          style={{ background: "var(--primary)" }}
        >
          {savingContract ? "Saving..." : "Save to My Contracts"}
        </button>
      </div>

      {/* Contract Header */}
      <div className="card mb-4">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">{contract.title}</h1>
            <p className="text-sm text-[var(--muted)] mt-1 flex items-center gap-1.5">
              Posted by {contract.posted_by_name}
              {contract.poster_verified && (
                <svg className="w-4 h-4 text-[var(--accent)]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
              )}
              <span className="mx-1">·</span>
              {contract.created_at}
            </p>
          </div>
          <span className="shrink-0 ml-3 badge-closed">
            draft
          </span>
        </div>

        <p className="text-[var(--muted)] mb-5 leading-relaxed">{contract.description}</p>

        {/* Key details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "Budget", value: shortValue(displayBudget, "TBD"), title: displayBudget },
            { label: "Deadline", value: shortValue(displayDeadline, "TBD"), title: displayDeadline },
            { label: "Industry", value: contract.industry || "N/A" },
            { label: "Proposals", value: "0 (Draft)" },
          ].map((item) => (
            <div key={item.label} className="bg-[var(--surface)] border border-[var(--divider)] rounded-xl p-4 min-h-[80px] flex flex-col">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--muted)] mb-2">{item.label}</p>
              <p className="text-sm font-semibold text-[var(--foreground)] leading-snug break-words" title={item.title || item.value}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Full budget & deadline text (expandable if truncated) */}
        {(displayBudget.length > 60 || displayDeadline.length > 60) && (
          <details className="mb-4 group">
            <summary className="text-xs text-[var(--primary)] cursor-pointer font-medium">View full budget &amp; timeline details</summary>
            <div className="mt-2 space-y-2 text-sm text-[var(--muted)] bg-[var(--surface)] rounded-lg p-4 border border-[var(--divider)]">
              {displayBudget.length > 60 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--foreground)] mb-0.5">Budget</p>
                  <p className="leading-relaxed">{displayBudget}</p>
                </div>
              )}
              {displayDeadline.length > 60 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--foreground)] mb-0.5">Timeline</p>
                  <p className="leading-relaxed">{displayDeadline}</p>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Download RFP PDF */}
        {extractPdfBase64(contract.rfp_pdf_base64) && (
          <button
            onClick={() => downloadPdfFromBase64(extractPdfBase64(contract.rfp_pdf_base64) as string, `${contract.rfp_file_name || contract.title || "RFP"}.pdf`)}
            className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all shadow-sm mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Download RFP PDF
          </button>
        )}

        {contract.required_certifications && (
          <p className="text-xs text-[var(--muted)] mb-4">
            Required Certifications: <span className="font-medium text-[var(--foreground)]">{contract.required_certifications}</span>
          </p>
        )}
        {contract.mission_objective && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-1">Mission Objective</h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">{contract.mission_objective}</p>
          </div>
        )}
      </div>

      {/* RFP Document Section */}
      {contract.rfp_document && (
        <div className="card mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[var(--primary-light)] rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">{contract.rfp_file_name ? `RFP: ${contract.rfp_file_name}` : "RFP Document"}</h2>
              <p className="text-xs text-[var(--muted)]">Uploaded by {contract.posted_by_name}</p>
            </div>
          </div>
          <div className="bg-[var(--surface)] rounded-xl p-5 text-sm text-[var(--muted)] whitespace-pre-wrap font-mono max-h-[500px] overflow-y-auto border border-[var(--divider)] leading-relaxed">
            {contract.rfp_document.startsWith("data:") ? (
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-[var(--muted)] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <p className="text-[var(--muted)] font-medium mb-2">Binary document attached</p>
                <a href={contract.rfp_document} download={contract.rfp_file_name || "rfp-document"} className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                  </svg>
                  Download Document
                </a>
              </div>
            ) : (
              contract.rfp_document
            )}
          </div>
        </div>
      )}

      {/* RFP Sections (generated via pipeline) */}
      {contract.rfp_sections && Object.keys(contract.rfp_sections).length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[var(--primary-light)] rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">RFP Sections</h2>
              <p className="text-xs text-[var(--muted)]">{Object.keys(contract.rfp_sections).length} sections generated</p>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(contract.rfp_sections).map(([key, content]: [string, any]) => {
              const label = contract.rfp_section_labels?.[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              return (
                <details key={key} className="group border border-[var(--divider)] rounded-lg overflow-hidden">
                  <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface)] transition-colors flex items-center justify-between">
                    {label}
                    <svg className="w-4 h-4 text-[var(--muted)] group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                    </svg>
                  </summary>
                  <div className="px-4 pb-4 text-sm text-[var(--muted)] leading-relaxed whitespace-pre-wrap">{String(content)}</div>
                </details>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
