"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/services/supabase";
import { formatDistanceToNow } from "date-fns";

interface RfpCompany {
  id: string;
  company_name: string;
  industry?: string;
}

interface Request {
  id: string;
  rfp_company_id: string;
  status: string;
  note: string | null;
  created_at: string;
  company_name?: string;
}

export default function RequestConnectPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"new" | "sent">("new");
  const [search, setSearch] = useState("");
  const [rfpCompanies, setRfpCompanies] = useState<RfpCompany[]>([]);
  const [sentRequests, setSentRequests] = useState<Request[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [selected, setSelected] = useState<RfpCompany | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("users")
        .select("id, company_name, industry")
        .eq("user_type", "rfp_company");
      setRfpCompanies(data || []);
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data: reqData, error: fetchErr } = await supabase
        .from("message_requests")
        .select("*")
        .eq("vendor_id", user.id)
        .order("created_at", { ascending: false });

      // Table doesn't exist yet — migration not run
      if (fetchErr) {
        if (fetchErr.message?.includes("message_requests") || fetchErr.code === "42P01" || fetchErr.code === "PGRST106") {
          setMigrationNeeded(true);
        }
        return;
      }

      // Fetch message channels to check if any are closed/expired
      const { data: chData } = await supabase
        .from("message_channels")
        .select("*")
        .eq("vendor_id", user.id);
      setChannels(chData || []);

      if (!reqData) return;
      // Attach company names
      const enriched = await Promise.all(
        reqData.map(async (r: any) => {
          const { data: ud } = await supabase
            .from("users")
            .select("company_name")
            .eq("id", r.rfp_company_id)
            .maybeSingle();
          return { ...r, company_name: ud?.company_name || "Unknown" };
        })
      );
      setSentRequests(enriched);
    })();
  }, [user, successId]);

  const filtered = rfpCompanies.filter((c) =>
    c.company_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Only PENDING requests block re-requesting.
  // Approved or rejected requests allow sending a new request.
  const pendingRequestIds = new Set(
    sentRequests.filter((r) => r.status === "pending").map((r) => r.rfp_company_id)
  );
  // Track previous (non-pending) request statuses for display hints
  const previousRequestStatus = new Map(
    sentRequests
      .filter((r) => r.status !== "pending")
      .map((r) => [r.rfp_company_id, r.status])
  );

  // Helper to determine if an RFP company has an active channel with us
  const getChannelStatus = (rfpCompanyId: string) => {
    const ch = channels.find((c) => c.rfp_company_id === rfpCompanyId);
    if (!ch) return { exists: false, isClosed: false };
    const expired = ch.expires_at ? new Date(ch.expires_at) < new Date() : false;
    const closed = ch.status === "closed" || expired;
    return { exists: true, isClosed: closed };
  };

  const sendRequest = async () => {
    if (!user || !selected || sending) return;
    setSending(true);
    setError(null);
    const { error: err } = await supabase.from("message_requests").upsert(
      {
        vendor_id: user.id,
        rfp_company_id: selected.id,
        status: "pending",
        note: note.trim() || null,
      },
      { onConflict: "vendor_id,rfp_company_id", ignoreDuplicates: false }
    );
    setSending(false);
    if (err) {
      // Detect missing table (migration not run)
      if (err.message?.includes("message_requests") || err.code === "42P01" || err.code === "PGRST106") {
        setMigrationNeeded(true);
        setError(null);
      } else {
        setError(err.message);
      }
    } else {
      setSuccessId(selected.id);
      setSelected(null);
      setNote("");
      setTab("sent");
    }
  };

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-500/15 text-amber-500",
      approved: "bg-emerald-500/15 text-emerald-500",
      rejected: "bg-red-500/15 text-red-500",
    };
    return map[status] ?? "bg-[var(--surface)] text-[var(--muted)]";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--divider)] bg-[var(--card)] shadow-2xl overflow-hidden"
        style={{ animation: "fadeSlideUp 0.18s ease", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--divider)] flex items-center justify-between shrink-0">
          <h3 className="text-base font-semibold text-[var(--foreground)]">Request to Connect</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--divider)] shrink-0">
          {(["new", "sent"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tab === t
                  ? "border-b-2 border-[var(--primary)] text-[var(--primary)]"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t === "new" ? "New Request" : `Sent (${sentRequests.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Migration needed banner */}
          {migrationNeeded && (
            <div className="mx-4 mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-400/40">
              <div className="flex items-start gap-2.5">
                <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Database setup required</p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-1 leading-relaxed">
                    The messaging tables haven&apos;t been created yet. Ask your admin to run
                    {" "}<code className="font-mono bg-amber-500/20 px-1 rounded">scripts/messaging_channels_migration.sql</code>{" "}
                    in the Supabase SQL Editor.
                  </p>
                </div>
              </div>
            </div>
          )}

          {tab === "new" && (
            <div className="p-4 space-y-4">
              {!selected ? (
                <>
                  <p className="text-xs text-[var(--muted)]">
                    Search for an RFP Company and request permission to message them.
                  </p>
                  {/* Search */}
                  <div className="flex items-center gap-2 bg-[var(--surface)] rounded-lg px-3 py-2">
                    <svg className="w-4 h-4 text-[var(--muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search RFP Companies…"
                      className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none"
                    />
                  </div>
                  {/* Results */}
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {filtered.slice(0, 10).map((c) => {
                      const isPending = pendingRequestIds.has(c.id);
                      const prevStatus = previousRequestStatus.get(c.id);
                      const chStatus = getChannelStatus(c.id);
                      
                      // Lock re-requesting if request is approved and the channel is active/not closed.
                      const isAcceptedAndActive = prevStatus === "approved" && (!chStatus.exists || !chStatus.isClosed);
                      const isBlocked = isPending || isAcceptedAndActive;

                      return (
                        <button
                          key={c.id}
                          onClick={() => !isBlocked && setSelected(c)}
                          disabled={isBlocked}
                          className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${
                            isBlocked
                              ? "opacity-50 cursor-not-allowed"
                              : "hover:bg-[var(--surface)]"
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] text-xs font-bold shrink-0">
                            {c.company_name?.charAt(0)?.toUpperCase() || "?"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--foreground)] truncate">{c.company_name}</p>
                            <p className="text-xs text-[var(--muted)]">{c.industry || "Company"}</p>
                          </div>
                          {isPending && (
                            <span className="text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full shrink-0">Pending</span>
                          )}
                          {!isPending && isAcceptedAndActive && (
                            <span className="text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full shrink-0">Accepted</span>
                          )}
                          {!isPending && prevStatus === "approved" && chStatus.isClosed && (
                            <span className="text-[10px] font-semibold text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-0.5 rounded-full shrink-0">Re-request</span>
                          )}
                          {!isPending && prevStatus === "rejected" && (
                            <span className="text-[10px] font-semibold text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded-full shrink-0">Try again</span>
                          )}
                        </button>
                      );
                    })}
                    {filtered.length === 0 && (
                      <p className="text-sm text-center text-[var(--muted)] py-6">No companies found</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Compose */}
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface)]">
                    <div className="w-9 h-9 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] text-sm font-bold shrink-0">
                      {selected.company_name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">{selected.company_name}</p>
                      <p className="text-xs text-[var(--muted)]">{selected.industry || "RFP Company"}</p>
                    </div>
                    <button
                      onClick={() => setSelected(null)}
                      className="ml-auto text-[var(--muted)] hover:text-[var(--foreground)]"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional: introduce yourself or explain why you'd like to connect…"
                    rows={3}
                    className="w-full rounded-lg border border-[var(--divider)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none resize-none focus:border-[var(--primary)] transition-colors"
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button
                    onClick={sendRequest}
                    disabled={sending}
                    className="w-full py-2.5 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-sm font-semibold hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
                  >
                    {sending ? "Sending…" : "Send Request"}
                  </button>
                </>
              )}
            </div>
          )}

          {tab === "sent" && (
            <div className="p-4 space-y-2">
              {sentRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                  <svg className="w-10 h-10 text-[var(--muted)]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                  <p className="text-sm text-[var(--muted)]">No requests sent yet</p>
                </div>
              ) : (
                sentRequests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--divider)]">
                    <div className="w-8 h-8 rounded-full bg-[var(--surface-hover)] flex items-center justify-center text-xs font-bold text-[var(--foreground)] shrink-0">
                      {r.company_name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--foreground)] truncate">{r.company_name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full capitalize shrink-0 ${statusPill(r.status)}`}>
                      {r.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
