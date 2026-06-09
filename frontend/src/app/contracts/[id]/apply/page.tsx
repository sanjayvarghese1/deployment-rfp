"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";
import { apiUrl } from "@/lib/api";
import { randomUUID } from '@/lib/uuid';

/* ─── helpers ─────────────────────────────────────────────── */
function normalizeDoc(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/** Extract a short budget figure from verbose text, e.g. "$50,000" or the first line. */
function shortBudget(raw: unknown): string {
  const s = String(raw ?? "");
  // Try to find a dollar amount
  const match = s.match(/\$[\d,]+(?:\.\d{2})?(?:\s*(?:–|-)\s*\$[\d,]+(?:\.\d{2})?)?/);
  if (match) return match[0];
  // Fallback: first sentence or 22 chars
  const firstSentence = s.split(/[.\n]/)[0];
  return String(firstSentence || "").slice(0, 22);
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
  return String(firstLine || "").slice(0, 22);
}

type Step = "quick_upload" | "success";

/* ═══════════════════════════════════════════════════════════ */
export default function ApplyPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const contractId = params?.id;
  const { user, profile, loading: authLoading } = useAuth();

  /* ─── core state ─── */
  const [contract, setContract] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("quick_upload");
  const [submitting, setSubmitting] = useState(false);

  /* ─── Quick Upload PDF ─── */
  const [quickPdfFile, setQuickPdfFile] = useState<File | null>(null);
  const [quickPdfUploading, setQuickPdfUploading] = useState(false);
  const [quickPdfFileName, setQuickPdfFileName] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");

  /* ─── Fetch contract ─── */
  useEffect(() => {
    if (!contractId) return;
    const fetchContract = async () => {
      const { data, error } = await supabase.from("contracts").select("*").eq("id", contractId).single();
      if (!error && data) setContract({ contract_id: data.id, ...normalizeDoc(data as Record<string, unknown>) });
      setLoading(false);
    };
    fetchContract();
  }, [contractId]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!contractId) return null;

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

      // Show success message and redirect
      setQuickPdfFileName(data.fileName || quickPdfFile.name);
      setSubmitMessage("Proposal submitted successfully!");
      setStep("success");
      
      // Redirect to contract page after 2 seconds
      setTimeout(() => {
        router.push(`/contracts/${contractId}`);
      }, 2000);
    } catch (err) {
      console.error("PDF upload failed:", err);
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      alert(`Upload failed: ${errMsg}`);
    } finally {
      setQuickPdfUploading(false);
    }
  };

  /* ─── Loading / auth guards ─── */
  if (loading) return <div className="flex justify-center items-center min-h-screen text-[var(--muted)]">Loading...</div>;
  if (!contract) return <div className="flex justify-center items-center min-h-screen text-[var(--muted)]">Contract not found.</div>;

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
        {/*           QUICK UPLOAD FORM                          */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "quick_upload" && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-[var(--foreground)]">Submit Your Proposal</h2>
              <p className="text-sm text-[var(--muted)] mt-2">Upload your PDF proposal directly. It will be submitted to the company for analysis.</p>
            </div>

            <div className="card !p-8">
              <label className="group flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-[var(--divider)] hover:border-[var(--primary)] hover:bg-[var(--primary-light)]/30 rounded-xl cursor-pointer transition-all">
                <input type="file" accept=".pdf" onChange={(e) => {
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
                }} className="hidden" />
                {quickPdfFile ? (
                  <div className="text-center">
                    <div className="w-12 h-12 bg-[var(--primary-light)] rounded-xl flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{quickPdfFile.name}</p>
                    <p className="text-xs text-[var(--muted)] mt-1">Click to replace</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <svg className="w-10 h-10 text-[var(--muted)] mx-auto mb-3 group-hover:text-[var(--primary)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    <p className="text-sm font-medium text-[var(--foreground)]">Click to upload PDF proposal</p>
                    <p className="text-xs text-[var(--muted)] mt-1">PDF only &middot; Up to 10 MB</p>
                  </div>
                )}
              </label>

              {quickPdfFile && (
                <button
                  onClick={handleQuickUploadPdf}
                  disabled={quickPdfUploading}
                  className="mt-5 w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-[#EFECE3] px-6 py-3.5 rounded-full text-sm font-semibold disabled:opacity-50 transition-all"
                >
                  {quickPdfUploading ? (
                    <><div className="w-4 h-4 border-2 border-[#EFECE3]/30 border-t-[#EFECE3] rounded-full animate-spin inline-block mr-2" />Uploading & Submitting...</>
                  ) : (
                    "Upload & Submit Proposal"
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/*           SUCCESS SCREEN                             */}
        {/* ═══════════════════════════════════════════════════ */}
        {step === "success" && (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center min-h-[400px]">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h2 className="text-2xl font-bold text-[var(--foreground)] text-center mb-2">{submitMessage}</h2>
              <p className="text-sm text-[var(--muted)] text-center max-w-md mb-4">
                Your proposal has been submitted for <strong>{contract.title as string}</strong>. The contract owner has been notified.
              </p>
              {quickPdfFileName && (
                <p className="text-xs text-[var(--muted)] bg-[var(--surface)] px-4 py-2 rounded-lg mb-8">
                  File: {quickPdfFileName}
                </p>
              )}
              <p className="text-xs text-[var(--muted)] text-center">Redirecting to contract page...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}