"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";

function isPendingApproval(status: string | undefined): boolean {
  return status === "draft" || status === "pending_approval";
}

function shortValue(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const s = raw.trim();
  if (s.length <= 60) return s;
  const dot = s.indexOf(".");
  if (dot > 0 && dot <= 80) return s.slice(0, dot + 1);
  return s.slice(0, 57) + "...";
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

type Contract = {
  contract_id: string;
  title: string;
  description: string;
  status: string;
  budget: string;
  deadline: string;
  industry: string;
  created_at: string;
  rfp_pdf_base64?: string;
  rfp_file_name?: string;
  posted_by: string;
  [key: string]: any;
};

// ── Email Modal ──────────────────────────────────────────────────────────────
function EmailModal({
  contract,
  onClose,
}: {
  contract: Contract;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(`RFP: ${contract.title}`);
  const [body, setBody] = useState(
    `Dear Vendor,\n\nWe are pleased to share our Request for Proposal for "${contract.title}".\n\nBudget: ${contract.budget || "TBD"}\nDeadline: ${contract.deadline || "TBD"}\nIndustry: ${contract.industry || "N/A"}\n\n${contract.description || ""}\n\nPlease submit your proposal at your earliest convenience.\n\nBest regards`
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!to.trim()) { setError("Please enter a recipient email."); return; }
    setSending(true);
    setError("");
    try {
      // Use mailto as a fallback — replace with your email API if available
      const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(mailto, "_blank");
      setSent(true);
    } catch {
      setError("Failed to open email client.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}>
      <div className="card w-full max-w-lg !p-0 overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--divider)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--primary-light)] flex items-center justify-center">
              <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-[var(--foreground)] text-sm">Send RFP via Email</h2>
              <p className="text-xs text-[var(--muted)] truncate max-w-[220px]">{contract.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface)] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--success-light)] flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-semibold text-[var(--foreground)]">Email client opened!</p>
            <p className="text-sm text-[var(--muted)] mt-1">Your default email app should have opened with the draft ready to send.</p>
            <button onClick={onClose} className="mt-5 btn-primary px-6 py-2">Done</button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {error && <div className="bg-[var(--danger-light)] text-[var(--danger)] text-sm p-3 rounded-lg">{error}</div>}

            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">To *</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="vendor@example.com"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Message</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={7}
                className="input-field w-full resize-none"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--divider)] text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-all">
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex-1 btn-primary justify-center py-2.5 text-sm"
              >
                {sending ? "Opening..." : "Send Email"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Approve Modal ─────────────────────────────────────────────────────────────
function ApproveModal({
  contract,
  onConfirm,
  onClose,
}: {
  contract: Contract;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}>
      <div className="card w-full max-w-sm !p-0 overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[var(--primary-light)] flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="font-bold text-[var(--foreground)] text-lg">Approve Contract?</h2>
          <p className="text-sm text-[var(--muted)] mt-2 leading-relaxed">
            This will publish <span className="font-semibold text-[var(--foreground)]">"{contract.title}"</span> as <span className="text-[var(--primary)] font-semibold">Open</span>, making it visible to all vendors.
          </p>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--divider)] text-sm font-medium text-[var(--muted)] hover:bg-[var(--surface)] transition-all">
            Cancel
          </button>
          <button
            onClick={async () => {
              setConfirming(true);
              await onConfirm();
              setConfirming(false);
            }}
            disabled={confirming}
            className="flex-1 btn-primary justify-center py-2.5 text-sm"
          >
            {confirming ? "Approving..." : "Yes, Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MyContractsPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "closed" | "pending">("all");
  const [emailContract, setEmailContract] = useState<Contract | null>(null);
  const [approveContract, setApproveContract] = useState<Contract | null>(null);
  const [search, setSearch] = useState("");

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
    if (!authLoading && profile && profile.user_type !== "rfp_company") router.push("/contracts");
  }, [authLoading, user, profile, router]);

  // Load my contracts
  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoadingContracts(true);
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("posted_by", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("My contracts load failed:", error);
        setContracts([]);
      } else {
        setContracts((data || []).map((row: any) => ({ contract_id: row.id, ...row })));
      }
      setLoadingContracts(false);
    })();
  }, [user]);

  const handleApprove = async (contract: Contract) => {
    const { error } = await supabase.from("contracts").update({ status: "open" }).eq("id", contract.contract_id);
    if (error) { console.error("Approve failed:", error); return; }
    setContracts((prev) => prev.map((c) => c.contract_id === contract.contract_id ? { ...c, status: "open" } : c));
    setApproveContract(null);
  };

  const handleDelete = async (contract: Contract) => {
    if (deletingId === contract.contract_id) return;
    const confirmed = window.confirm(`Delete "${contract.title}"? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingId(contract.contract_id);
    try {
      const { error } = await supabase.from("contracts").delete().eq("id", contract.contract_id);
      if (error) throw error;
      setContracts((prev) => prev.filter((c) => c.contract_id !== contract.contract_id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
    setDeletingId(null);
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const filtered = contracts.filter((c) => {
    const matchSearch =
      !search ||
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      c.description?.toLowerCase().includes(search.toLowerCase()) ||
      c.industry?.toLowerCase().includes(search.toLowerCase());

    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "pending" && isPendingApproval(c.status)) ||
      (filterStatus === "open" && c.status === "open") ||
      (filterStatus === "closed" && c.status === "closed");

    return matchSearch && matchStatus;
  });

  const counts = {
    all: contracts.length,
    open: contracts.filter((c) => c.status === "open").length,
    pending: contracts.filter((c) => isPendingApproval(c.status)).length,
    closed: contracts.filter((c) => c.status === "closed").length,
  };

  return (
    <>
      {emailContract && <EmailModal contract={emailContract} onClose={() => setEmailContract(null)} />}
      {approveContract && (
        <ApproveModal
          contract={approveContract}
          onConfirm={() => handleApprove(approveContract)}
          onClose={() => setApproveContract(null)}
        />
      )}

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">My Contracts</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">Manage your posted RFPs and contracts</p>
          </div>
          <Link
            href="/rfp"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Post New Contract
          </Link>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {([
            { key: "all", label: "Total", color: "text-[var(--foreground)]", bg: "bg-[var(--surface)]" },
            { key: "open", label: "Open", color: "text-[var(--primary)]", bg: "bg-[var(--primary-light)]" },
            { key: "pending", label: "Pending", color: "text-amber-600", bg: "bg-amber-50" },
            { key: "closed", label: "Closed", color: "text-gray-500", bg: "bg-gray-100" },
          ] as const).map((s) => (
            <button
              key={s.key}
              onClick={() => setFilterStatus(s.key)}
              className={`rounded-xl p-4 text-left transition-all border-2 ${
                filterStatus === s.key ? "border-[var(--primary)] shadow-sm" : "border-transparent"
              } ${s.bg}`}
            >
              <p className={`text-2xl font-bold ${s.color}`}>{counts[s.key]}</p>
              <p className="text-xs text-[var(--muted)] font-medium mt-0.5">{s.label}</p>
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div className="card !p-0 overflow-hidden mb-4">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--divider)]">
            <svg className="w-4 h-4 text-[var(--muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your contracts..."
              className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} className="p-1 rounded-full hover:bg-[var(--surface)] text-[var(--muted)] transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Contract list */}
        {loadingContracts ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-[var(--surface)] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <p className="font-semibold text-[var(--foreground)]">
              {contracts.length === 0 ? "No contracts yet" : "No contracts match your filter"}
            </p>
            <p className="text-sm text-[var(--muted)] mt-1 mb-5">
              {contracts.length === 0
                ? "Create your first contract to start receiving proposals"
                : "Try changing the status filter or search"}
            </p>
            {contracts.length === 0 && (
              <Link href="/rfp" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-sm font-semibold hover:opacity-90 transition-opacity">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Post Contract
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => (
              <div key={c.contract_id} className="card !p-0 overflow-hidden group hover:shadow-md transition-all">
                <div className="flex items-stretch">
                  {/* Status bar */}
                  <div className={`w-1 shrink-0 ${
                    c.status === "open" ? "bg-[var(--primary)]"
                    : isPendingApproval(c.status) ? "bg-amber-400"
                    : "bg-gray-300"
                  }`} />

                  <div className="flex-1 px-5 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                          <Link
                            href={c.status === "draft" ? `/contracts/${c.contract_id}/preview?from=my-contracts` : `/contracts/${c.contract_id}?from=my-contracts`}
                            className="font-semibold text-[var(--foreground)] text-[15px] group-hover:text-[var(--primary)] transition-colors"
                          >
                            {c.title}
                          </Link>
                          <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded shrink-0 ${
                            c.status === "open" ? "bg-[var(--primary-light)] text-[var(--primary)]"
                            : isPendingApproval(c.status) ? "bg-amber-500/10 text-amber-600"
                            : "bg-gray-500/10 text-gray-400"
                          }`}>
                            {isPendingApproval(c.status) ? "Pending Approval" : c.status}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--muted)] line-clamp-2 leading-relaxed mb-3">{c.description}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--muted)]">
                          {c.industry && (
                            <span className="px-2 py-0.5 rounded-md bg-[var(--primary-light)] text-[var(--primary)] font-medium">{c.industry}</span>
                          )}
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                            <span className="font-semibold text-[var(--foreground)]">{shortValue(c.budget, "TBD")}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                            </svg>
                            {shortValue(c.deadline, "TBD")}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {/* Send Email */}
                        <button
                          onClick={() => setEmailContract(c)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-[var(--divider)] text-[var(--muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition-all"
                          title="Send RFP via Email"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                          </svg>
                          Send Email
                        </button>

                        {/* Download PDF */}
                        {extractPdfBase64(c.rfp_pdf_base64) && (
                          <button
                            onClick={() => downloadPdfFromBase64(extractPdfBase64(c.rfp_pdf_base64) as string, `${c.rfp_file_name || c.title || "RFP"}.pdf`)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-[var(--divider)] text-[var(--muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition-all"
                            title="Download RFP PDF"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            PDF
                          </button>
                        )}

                        {/* Approve */}
                        {isPendingApproval(c.status) && (
                          <button
                            onClick={() => setApproveContract(c)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--primary-light)] text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Approve
                          </button>
                        )}

                        {/* View Details */}
                        <Link
                          href={c.status === "draft" ? `/contracts/${c.contract_id}/preview?from=my-contracts` : `/contracts/${c.contract_id}?from=my-contracts`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--primary)] text-[#EFECE3] hover:opacity-90 transition-opacity"
                        >
                          View
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                          </svg>
                        </Link>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(c)}
                          disabled={deletingId === c.contract_id}
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          title="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                          {deletingId === c.contract_id ? "..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
