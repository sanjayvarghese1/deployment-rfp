"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";

function normalizeDoc(data: any): any {
  return data;
}

function shortValue(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const s = raw.trim();
  if (s.length <= 60) return s;
  const dot = s.indexOf(".");
  if (dot > 0 && dot <= 80) return s.slice(0, dot + 1);
  return s.slice(0, 57) + "...";
}

function isPendingApproval(status: string | undefined): boolean {
  return status === "draft" || status === "pending_approval";
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

export default function ContractsPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const isRfpCompany = profile?.user_type === "rfp_company";
  // RFP Companies land on their own contracts by default
  const [tab, setTab] = useState<"marketplace" | "my">(isRfpCompany ? "my" : "marketplace");
  const [contracts, setContracts] = useState<any[]>([]);
  const [myContracts, setMyContracts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Contracts load failed:", error);
        setContracts([]);
        return;
      }

      setContracts((data || []).map((row) => ({ contract_id: row.id, ...normalizeDoc(row) })));
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("posted_by", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("My contracts load failed:", error);
        setMyContracts([]);
        return;
      }

      setMyContracts((data || []).map((row) => ({ contract_id: row.id, ...normalizeDoc(row) })));
    })();
  }, [user]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  // Sync tab when profile loads asynchronously (RFP Companies → "my" tab)
  useEffect(() => {
    if (profile?.user_type === "rfp_company") {
      setTab("my");
    }
  }, [profile]);


  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const filtered = contracts.filter((c) => {
    if (isPendingApproval(c.status)) return false;
    const matchSearch =
      c.title?.toLowerCase().includes(search.toLowerCase()) ||
      c.description?.toLowerCase().includes(search.toLowerCase()) ||
      c.industry?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filter === "all" || c.status === filter;
    return matchSearch && matchStatus;
  });

  const openCount = contracts.filter((c) => c.status === "open").length;
  const closedCount = contracts.filter((c) => c.status === "closed").length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">
            {isRfpCompany ? "My Contracts" : "Contracts"}
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            {isRfpCompany ? "Your posted RFPs and contracts" : "Browse opportunities and apply for contracts"}
          </p>
        </div>
        {isRfpCompany && user && (
          <Link
            href="/rfp"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Post Contract
          </Link>
        )}
      </div>

      {/* Tabs — Vendors see Marketplace; RFP Companies see only My Contracts */}
      {!isRfpCompany && (
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface)] w-fit mb-6">
          <button
            onClick={() => setTab("marketplace")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "marketplace"
                ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            Marketplace
          </button>
        </div>
      )}

      {/* ═══ Marketplace Tab ═══ */}
      {tab === "marketplace" && (
        <>
          {/* Search + Filter bar */}
          <div className="card !p-0 overflow-hidden mb-6">
            <div className={`flex items-center gap-3 px-5 py-3.5 border-b transition-colors ${searchFocused ? "border-[var(--primary)]" : "border-[var(--divider)]"}`}>
              <svg className={`w-4.5 h-4.5 shrink-0 transition-colors ${searchFocused ? "text-[var(--primary)]" : "text-[var(--muted)]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search contracts by title, description, or industry..."
                className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none"
              />
              {search && (
                <button onClick={() => setSearch("")} className="p-1 rounded-full hover:bg-[var(--surface)] text-[var(--muted)] transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 px-5 py-2.5">
              <span className="text-xs text-[var(--muted)] font-medium mr-1">Status:</span>
              {([
                { key: "all" as const, label: "All", count: contracts.filter(c => !isPendingApproval(c.status)).length },
                { key: "open" as const, label: "Open", count: openCount },
                { key: "closed" as const, label: "Closed", count: closedCount },
              ]).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                    filter === f.key
                      ? "bg-[var(--primary-light)] text-[var(--primary)]"
                      : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]"
                  }`}
                >
                  {f.label}
                  <span className={`text-[10px] ${filter === f.key ? "opacity-70" : "opacity-50"}`}>{f.count}</span>
                </button>
              ))}
              <div className="flex-1" />
              <span className="text-xs text-[var(--muted)]">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Contract cards */}
          <div className="space-y-3">
            {filtered.map((c) => (
              <div key={c.contract_id} className="card !p-0 overflow-hidden hover:border-[var(--primary)]/20 transition-all group">
                <div className="flex items-stretch">
                  {/* Status accent bar */}
                  <div className={`w-1 shrink-0 ${c.status === "open" ? "bg-[var(--primary)]" : "bg-gray-400"}`} />

                  <div className="flex-1 px-5 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <Link href={`/contracts/${c.contract_id}?from=contracts`} className="font-semibold text-[var(--foreground)] text-[15px] group-hover:text-[var(--primary)] transition-colors truncate">
                            {c.title}
                          </Link>
                          <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded shrink-0 ${
                            c.status === "open"
                              ? "bg-[var(--primary-light)] text-[var(--primary)]"
                              : "bg-gray-500/10 text-gray-400"
                          }`}>
                            {c.status}
                          </span>
                        </div>

                        <p className="text-sm text-[var(--muted)] line-clamp-2 leading-relaxed mb-3">{c.description}</p>

                        {/* Meta row */}
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--muted)]">
                          <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                            <span className="font-semibold text-[var(--foreground)]">{shortValue(c.budget, "TBD")}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                            </svg>
                            {shortValue(c.deadline, "TBD")}
                          </span>
                          {c.industry && (
                            <span className="px-2 py-0.5 rounded-md bg-[var(--primary-light)] text-[var(--primary)] font-medium">
                              {c.industry}
                            </span>
                          )}
                          {c.posted_by_name && (
                            <span className="flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                              </svg>
                              {c.posted_by_name}
                              {c.poster_verified && (
                                <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0 sm:ml-4">
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
                        <Link
                          href={`/contracts/${c.contract_id}?from=contracts`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[var(--primary)] text-[#EFECE3] hover:opacity-90 transition-opacity"
                        >
                          View Details
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-20">
              <div className="w-16 h-16 bg-[var(--surface)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
              <p className="font-semibold text-[var(--foreground)]">No contracts found</p>
              <p className="text-sm text-[var(--muted)] mt-1">Try adjusting your search or filters</p>
            </div>
          )}
        </>
      )}

      {/* ═══ My Contracts Tab ═══ */}
      {tab === "my" && user && (
        <>
          {myContracts.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 bg-[var(--surface)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
              <p className="font-semibold text-[var(--foreground)]">No contracts yet</p>
              <p className="text-sm text-[var(--muted)] mt-1 mb-4">Create your first contract to start receiving proposals</p>
              <Link href="/rfp" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-sm font-semibold hover:opacity-90 transition-opacity">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Post Contract
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {myContracts.map((c) => (
                <div key={c.contract_id} className="card !p-0 overflow-hidden group">
                  <div className="flex items-stretch">
                    <div className={`w-1 shrink-0 ${c.status === "open" ? "bg-[var(--primary)]" : isPendingApproval(c.status) ? "bg-amber-500" : "bg-gray-400"}`} />

                    <div className="flex-1 px-5 py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <Link href={`/contracts/${c.contract_id}?from=contracts`} className="min-w-0 flex-1">
                          <div className="flex items-center gap-2.5 mb-1">
                            <p className="font-semibold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors truncate text-[15px]">
                              {c.title}
                            </p>
                            <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded shrink-0 ${
                              c.status === "open" ? "bg-[var(--primary-light)] text-[var(--primary)]"
                                : isPendingApproval(c.status) ? "bg-amber-500/10 text-amber-500"
                                : "bg-gray-500/10 text-gray-400"
                            }`}>
                              {isPendingApproval(c.status) ? "pending approval" : c.status}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                            {c.industry && <span className="font-medium">{c.industry}</span>}
                            <span>Budget: {shortValue(c.budget, "TBD")}</span>
                            <span>{c.created_at}</span>
                          </div>
                        </Link>

                        <div className="flex items-center gap-2 shrink-0">
                          {c.rfp_pdf_base64 && (
                            <button
                              onClick={() => downloadPdfFromBase64(c.rfp_pdf_base64, `${c.title || "RFP"}.pdf`)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--divider)] text-[var(--muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition-all"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                              PDF
                            </button>
                          )}
                          {isPendingApproval(c.status) && (
                            <button
                              onClick={async () => {
                                const { error } = await supabase.from("contracts").update({ status: "open" }).eq("id", c.contract_id);
                                if (error) {
                                  console.error("Approve failed:", error);
                                  return;
                                }
                                setContracts((prev) => prev.map((item) => item.contract_id === c.contract_id ? { ...item, status: "open" } : item));
                                setMyContracts((prev) => prev.map((item) => item.contract_id === c.contract_id ? { ...item, status: "open" } : item));
                              }}
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--primary-light)] text-[var(--primary)] hover:bg-[var(--primary)]/20 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Approve
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              if (deletingId === c.contract_id) return;
                              const confirmed = window.confirm(`Delete "${c.title}"? This cannot be undone.`);
                              if (!confirmed) return;
                              setDeletingId(c.contract_id);
                              try {
                                const { error } = await supabase.from("contracts").delete().eq("id", c.contract_id);
                                if (error) {
                                  throw error;
                                }
                                setContracts((prev) => prev.filter((item) => item.contract_id !== c.contract_id));
                                setMyContracts((prev) => prev.filter((item) => item.contract_id !== c.contract_id));
                              } catch (err) {
                                console.error("Delete failed:", err);
                              }
                              setDeletingId(null);
                            }}
                            disabled={deletingId === c.contract_id}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
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
        </>
      )}
    </div>
  );
}

