"use client";

import { useState } from "react";
import { supabase } from "@/services/supabase";
import type { Channel } from "./MessageBox";

interface ChannelSettingsModalProps {
  channel: Channel | null;          // null when no channel exists yet
  rfpCompanyId: string;
  vendorId: string;
  isRfpRfp?: boolean;
  onClose: () => void;
  onUpdated: (updated: Channel) => void;
}

const DURATION_OPTIONS = [
  { label: "7 days",  days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
];

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "No expiry set";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Upsert a channel record (creates one if it doesn't exist). */
async function upsertChannel(
  rfpCompanyId: string,
  vendorId: string,
  patch: { status?: string; expires_at?: string | null },
  isRfpRfp: boolean
): Promise<{ data: Channel | null; error: string | null }> {
  const table = isRfpRfp ? "rfp_rfp_channels" : "message_channels";
  const now30 = addDays(30);

  const payload = isRfpRfp
    ? {
        initiator_id: rfpCompanyId,
        target_id: vendorId,
        status: patch.status ?? "active",
        expires_at: "expires_at" in patch ? patch.expires_at : now30,
      }
    : {
        rfp_company_id: rfpCompanyId,
        vendor_id: vendorId,
        status: patch.status ?? "active",
        expires_at: "expires_at" in patch ? patch.expires_at : now30,
      };

  const { data, error } = await supabase
    .from(table)
    .upsert(payload as any, {
      onConflict: isRfpRfp ? "initiator_id,target_id" : "rfp_company_id,vendor_id",
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as Channel, error: null };
}

/** Update an existing channel record. */
async function updateChannel(
  channelId: string,
  patch: { status?: string; expires_at?: string | null },
  isRfpRfp: boolean
): Promise<{ data: Channel | null; error: string | null }> {
  const table = isRfpRfp ? "rfp_rfp_channels" : "message_channels";
  const { data, error } = await supabase
    .from(table)
    .update(patch)
    .eq("id", channelId)
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as Channel, error: null };
}

export default function ChannelSettingsModal({
  channel,
  rfpCompanyId,
  vendorId,
  isRfpRfp = false,
  onClose,
  onUpdated,
}: ChannelSettingsModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExpired = channel?.expires_at ? new Date(channel.expires_at) < new Date() : false;
  const isClosed  = channel?.status === "closed";
  const hasChannel = !!channel;

  // ── Actions ────────────────────────────────────────────────────────────────

  const apply = async (patch: { status?: string; expires_at?: string | null }) => {
    setSaving(true);
    setError(null);
    const result = channel
      ? await updateChannel(channel.id, patch, isRfpRfp)
      : await upsertChannel(rfpCompanyId, vendorId, patch, isRfpRfp);
    setSaving(false);
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      onUpdated(result.data);
      onClose();
    }
  };

  const setExpiry  = (days: number)   => apply({ expires_at: addDays(days), status: "active" });
  const clearExpiry = ()               => apply({ expires_at: null,          status: "active" });
  const stopChannel = ()               => apply({ status: "closed" });
  const reopenChannel = ()             => apply({ status: "active", expires_at: addDays(30) });

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--divider)] bg-[var(--card)] shadow-2xl overflow-hidden"
        style={{ animation: "fadeSlideUp 0.18s ease" }}
      >
        {/* ── Modal header ── */}
        <div className="px-5 py-4 border-b border-[var(--divider)] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[var(--foreground)]">Channel Settings</h3>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              {isRfpRfp ? "Manage your messaging channel with this RFP company" : "Manage your messaging channel with this vendor"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* ── Status row ── */}
          <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-[var(--surface)]">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                !hasChannel ? "bg-[var(--muted)]" :
                isClosed || isExpired ? "bg-red-500" : "bg-emerald-500"
              }`} />
              <span className="text-sm font-medium text-[var(--foreground)]">
                {!hasChannel ? "No channel yet" :
                 isClosed ? "Stopped" :
                 isExpired ? "Expired" : "Active"}
              </span>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              !hasChannel ? "bg-[var(--divider)] text-[var(--muted)]" :
              isClosed || isExpired ? "bg-red-500/15 text-red-500" : "bg-emerald-500/15 text-emerald-500"
            }`}>
              {!hasChannel ? "Inactive" :
               isClosed ? "Closed" :
               isExpired ? "Expired" : "Open"}
            </span>
          </div>

          {/* ── Expiry info ── */}
          {hasChannel && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">Expires</span>
              <span className={`font-medium ${isExpired ? "text-red-500" : "text-[var(--foreground)]"}`}>
                {formatExpiry(channel!.expires_at)}
              </span>
            </div>
          )}

          <div className="h-px bg-[var(--divider)]" />

          {/* ── Quick-stop button (when active) ── */}
          {(!isClosed && !isExpired) && hasChannel && (
            <button
              onClick={stopChannel}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-400/50 text-red-500 text-sm font-semibold hover:bg-red-500/10 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
              </svg>
              {saving ? "Stopping…" : "Stop Channel"}
            </button>
          )}

          {/* ── Reopen (when closed or expired) ── */}
          {(isClosed || isExpired) && (
            <button
              onClick={reopenChannel}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-sm font-semibold hover:bg-[var(--primary-hover)] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              {saving ? "Reopening…" : "Reopen Channel (30 days)"}
            </button>
          )}

          {/* ── Extend / Set duration ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2.5">
              {isClosed || isExpired ? "Reopen for" :
               !hasChannel ? "Open channel for" :
               channel?.expires_at ? "Extend to" : "Set expiry to"}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setExpiry(opt.days)}
                  disabled={saving}
                  className="rounded-xl border border-[var(--divider)] py-2.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--primary)]/10 hover:border-[var(--primary)] hover:text-[var(--primary)] active:scale-[0.97] transition-all disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Remove expiry (when active with expiry set) ── */}
          {hasChannel && channel?.expires_at && !isClosed && !isExpired && (
            <button
              onClick={clearExpiry}
              disabled={saving}
              className="w-full py-2 rounded-xl border border-[var(--divider)] text-sm text-[var(--muted)] font-medium hover:bg-[var(--surface)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Remove Expiry (keep open indefinitely)"}
            </button>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-400/30">
              <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <p className="text-xs text-red-500">{error}</p>
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
