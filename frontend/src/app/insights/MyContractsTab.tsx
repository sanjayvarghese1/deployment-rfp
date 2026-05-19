"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { supabase } from "@/services/supabase";
import formatCurrency, { firstNonEmptyText, parseNumber } from "@/lib/formatters/number";

function normalizeDoc(data: any): any {
  return data;
}

interface Contract {
  contract_id: string;
  title: string;
  description?: string;
  status?: string;
  industry?: string;
  budget?: string;
  budget_range?: string;
  budget_framework?: string;
  budgetIndicator?: string;
  created_at?: string;
  rfp_metadata?: any;
  [key: string]: any;
}

export default function MyContractsTab() {
  const { user, profile } = useAuth();
  const [myContracts, setMyContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isPendingApproval = (status: string | undefined) => status === "draft" || status === "pending_approval";

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error } = await supabase.from("contracts").select("*").eq("posted_by", user.id);
      if (error) {
        console.warn("Insights contracts load failed:", error);
        setMyContracts([]);
        setLoading(false);
        return;
      }
      setMyContracts((data || []).map((row) => ({ contract_id: row.id, ...normalizeDoc(row) })));
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">My Contracts</h2>
        {loading ? (
          <p className="text-sm text-[var(--muted)] text-center py-10">Loading...</p>
        ) : myContracts.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 bg-[var(--surface)] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            </div>
            <p className="text-sm text-[var(--muted)] mb-1">You haven&apos;t posted any contracts yet.</p>
            <p className="text-xs text-[var(--muted)]">Go to the &quot;RFP File&quot; tab to create your first contract.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myContracts.map((c) => (
              <div key={c.contract_id} className="flex items-center justify-between p-4 border border-[var(--divider)] rounded-xl hover:bg-[var(--surface)] transition-all group">
                <Link href={`/contracts/${c.contract_id}?from=insights`} className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors truncate">{c.title}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {c.industry || "General"} · Budget: {(() => {
                      const budgetText = firstNonEmptyText(c.budget, c.budget_range, c.budget_framework, c.budgetIndicator, c.rfp_metadata?.budgetIndicator);
                      const budgetValue = parseNumber(budgetText);
                      return budgetValue > 0 ? formatCurrency(budgetValue) : budgetText || "TBD";
                    })()} · {c.created_at}
                  </p>
                </Link>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    c.status === "open" ? "badge-open" : isPendingApproval(c.status) ? "bg-[var(--warning-light)] text-[var(--warning)]" : "badge-closed"
                  }`}>
                    {isPendingApproval(c.status) ? "pending approval" : c.status}
                  </span>
                  {isPendingApproval(c.status) && (
                    <button
                      onClick={async () => {
                        // Optimistic UI: update status locally first
                        const prev = myContracts;
                        setMyContracts((current) => current.map((m) => (m.contract_id === c.contract_id ? { ...m, status: "open" } : m)));
                        try {
                          const { error } = await supabase.from("contracts").update({ status: "open" }).eq("id", c.contract_id);
                          if (error) throw error;
                        } catch (err) {
                          console.error("Approve failed:", err);
                          // Revert on error
                          setMyContracts(prev);
                          window.alert("Failed to approve contract. Please try again.");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-[var(--success-light)] text-[var(--success)] hover:opacity-80 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                      Approve
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (deletingId === c.contract_id) return;
                      const confirmed = window.confirm(`Delete "${c.title}"? This cannot be undone.`);
                      if (!confirmed) return;
                      setDeletingId(c.contract_id);
                      // Optimistic remove
                      const prev = myContracts;
                      setMyContracts((current) => current.filter((m) => m.contract_id !== c.contract_id));
                      try {
                        const { error } = await supabase.from("contracts").delete().eq("id", c.contract_id);
                        if (error) throw error;
                      } catch (err) {
                        console.error("Delete failed:", err);
                        // Revert on error
                        setMyContracts(prev);
                        window.alert("Failed to delete contract. Please try again.");
                      }
                      setDeletingId(null);
                    }}
                    disabled={deletingId === c.contract_id}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-[var(--danger-light)] text-[var(--danger)] hover:opacity-80 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    {deletingId === c.contract_id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

