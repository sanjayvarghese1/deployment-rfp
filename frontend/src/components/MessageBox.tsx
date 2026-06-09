"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/AuthContext";
import { format, isToday, isYesterday, formatDistanceToNowStrict } from "date-fns";
import { supabase } from "@/services/supabase";
import ChannelSettingsModal from "./ChannelSettingsModal";

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d, yyyy");
}

interface Message {
  message_id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  timestamp: string;
  channel_id?: string;
}

export interface Channel {
  id: string;
  status: string;        // 'active' | 'closed'
  expires_at: string | null;
  rfp_company_id?: string;
  vendor_id?: string;
  initiator_id?: string;
  target_id?: string;
}

export default function MessageBox({
  otherUserId,
  otherUserName,
  channel: initialChannel,
  isRfpRfp = false,
  onBack,
  onChannelUpdated,
  onRequestSent,
  onMessageSent,
}: {
  otherUserId: string;
  otherUserName: string;
  channel?: Channel | null;
  isRfpRfp?: boolean;
  onBack?: () => void;
  onChannelUpdated?: (c: Channel) => void;
  onRequestSent?: () => void;
  onMessageSent?: () => void;
}) {
  const { user, profile } = useAuth();
  const isRfpCompany = profile?.user_type === "rfp_company";

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [channel, setChannel] = useState<Channel | null | undefined>(initialChannel);
  const [showSettings, setShowSettings] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoHealedRef = useRef<Record<string, boolean>>({});

  // Connection request flow for RFP-to-RFP
  const [rfpRequest, setRfpRequest] = useState<any | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [composerNote, setComposerNote] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);

  useEffect(() => {
    if (!user || !isRfpRfp) return;
    void (async () => {
      setLoadingRequest(true);
      const { data } = await supabase
        .from("rfp_rfp_requests")
        .select("*")
        .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`);

      const filtered = (data || []).find(
        (r: any) =>
          (r.requester_id === user.id && r.target_id === otherUserId) ||
          (r.requester_id === otherUserId && r.target_id === user.id)
      );
      setRfpRequest(filtered || null);

      // Auto-heal: if request is approved but channel row is missing, try to create it.
      if (filtered && filtered.status === "approved" && !channel && !autoHealedRef.current[otherUserId]) {
        autoHealedRef.current[otherUserId] = true;
        try {
          const { data: newCh, error: chErr } = await supabase
            .from("rfp_rfp_channels")
            .upsert(
              {
                initiator_id: filtered.requester_id,
                target_id: filtered.target_id,
                status: "active",
                expires_at: null,
              },
              { onConflict: "initiator_id,target_id", ignoreDuplicates: false }
            )
            .select()
            .single();

          if (!chErr && newCh) {
            setChannel(newCh as Channel);
            onChannelUpdated?.(newCh as Channel);
          } else if (chErr) {
            console.warn("Auto-heal channel row query failed:", chErr);
          }
        } catch (e) {
          console.error("Auto-heal channel row exception:", e);
        }
      }

      setLoadingRequest(false);
    })();
  }, [user, isRfpRfp, otherUserId, channel, onChannelUpdated]);

  const handleSendRequest = async () => {
    if (!user || sendingRequest) return;
    setSendingRequest(true);
    const { data, error } = await supabase
      .from("rfp_rfp_requests")
      .upsert(
        {
          requester_id: user.id,
          target_id: otherUserId,
          status: "pending",
          note: composerNote.trim() || null,
        },
        { onConflict: "requester_id,target_id", ignoreDuplicates: false }
      )
      .select()
      .single();
    setSendingRequest(false);
    if (!error && data) {
      setRfpRequest(data);
      setComposerNote("");
      onRequestSent?.();
    }
  };

  const handleAcceptRequest = async () => {
    if (!user || !rfpRequest) return;
    setSendingRequest(true);
    // 1. Create/activate an RFP→RFP channel (permanent)
    const { data: channelData, error: chErr } = await supabase
      .from("rfp_rfp_channels")
      .upsert(
        {
          initiator_id: rfpRequest.requester_id,
          target_id: user.id,
          status: "active",
          expires_at: null,
        },
        { onConflict: "initiator_id,target_id", ignoreDuplicates: false }
      )
      .select()
      .single();

    if (!chErr && channelData) {
      // 2. Update request status
      const { error: reqErr } = await supabase
        .from("rfp_rfp_requests")
        .update({ status: "approved" })
        .eq("id", rfpRequest.id);

      if (!reqErr) {
        setRfpRequest({ ...rfpRequest, status: "approved" });
        setChannel(channelData as Channel);
        onChannelUpdated?.(channelData as Channel);
      }
    }
    setSendingRequest(false);
  };

  const handleDeclineRequest = async () => {
    if (!user || !rfpRequest) return;
    setSendingRequest(true);
    const { error } = await supabase
      .from("rfp_rfp_requests")
      .update({ status: "rejected" })
      .eq("id", rfpRequest.id);
    if (!error) {
      setRfpRequest({ ...rfpRequest, status: "rejected" });
    }
    setSendingRequest(false);
  };

  const handleBlock = async () => {
    if (!user || !channel) return;
    setSending(true);
    const { data, error } = await supabase
      .from("rfp_rfp_channels")
      .update({ status: `blocked_by_${user.id}` })
      .eq("id", channel.id)
      .select()
      .single();
    setSending(false);
    if (!error && data) {
      setChannel(data as Channel);
      onChannelUpdated?.(data as Channel);
    }
  };

  const handleUnblock = async () => {
    if (!user || !channel) return;
    setSending(true);
    const { data, error } = await supabase
      .from("rfp_rfp_channels")
      .update({ status: "active" })
      .eq("id", channel.id)
      .select()
      .single();
    setSending(false);
    if (!error && data) {
      setChannel(data as Channel);
      onChannelUpdated?.(data as Channel);
    }
  };

  // Keep channel in sync when parent changes it
  useEffect(() => {
    setChannel(initialChannel);
  }, [initialChannel]);

  // Derived channel state
  const isExpired = channel?.expires_at ? new Date(channel.expires_at) < new Date() : false;
  const isClosed = channel?.status === "closed";
  const isBlocked = !!channel?.status?.startsWith("blocked_by_");
  const isLocked = isClosed || isExpired || isBlocked;

  const blockedBy = channel?.status?.startsWith("blocked_by_")
    ? channel.status.substring(11)
    : isClosed
    ? (channel?.rfp_company_id || channel?.initiator_id)
    : null;

  const isBlockedByMe = blockedBy === user?.id;
  const isBlockedByOther = !!blockedBy && blockedBy !== user?.id;

  // For RFP-to-RFP, it requires an active channel (both sides are locked if closed/expired/blocked).
  // If the request is approved but the channel row is missing, allow sending as a fallback.
  // RFP-to-vendor is free-messaging for RFP company (canSend = true).
  // Vendor-to-RFP is restricted by lock (canSend = !isLocked).
  const canSend = isRfpRfp
    ? ((!!channel || rfpRequest?.status === "approved") && !isLocked)
    : (isRfpCompany ? true : !isLocked);

  // Expiry < 24 h
  const expiresDate = channel?.expires_at ? new Date(channel.expires_at) : null;
  const hoursLeft = expiresDate
    ? (expiresDate.getTime() - Date.now()) / 36e5
    : null;
  const showExpiryWarning = !isLocked && hoursLeft !== null && hoursLeft < 24 && hoursLeft > 0;
  const expiresLabel = expiresDate
    ? formatDistanceToNowStrict(expiresDate, { addSuffix: true })
    : null;

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

      if (error) {
        console.warn("Message load failed:", error);
        setMessages([]);
        return;
      }

      const msgs = (data || [])
        .filter((m: any) =>
          (m.sender_id === user.id && m.receiver_id === otherUserId) ||
          (m.sender_id === otherUserId && m.receiver_id === user.id)
        )
        .sort((a: any, b: any) => (toDate(a.timestamp)?.getTime() ?? 0) - (toDate(b.timestamp)?.getTime() ?? 0));

      setMessages(msgs);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    })();
  }, [user, otherUserId]);

  const sendMessage = async () => {
    if (!user || !text.trim() || sending || !canSend) return;
    setSending(true);

    // For RFP companies: create, or reopen a closed/expired channel before sending (vendor channels only).
    // If the message_channels table doesn't exist yet (migration not run), skip silently.
    let resolvedChannelId = channel?.id;
    const needsChannelUpsert = isRfpCompany && !isRfpRfp && (!resolvedChannelId || isClosed || isExpired);
    if (needsChannelUpsert) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7-day default for vendor channels
      const { data: upsertedChannel, error: chErr } = await supabase
        .from("message_channels")
        .upsert(
          {
            rfp_company_id: user.id,
            vendor_id: otherUserId,
            status: "active",
            expires_at: expiresAt.toISOString(),
          },
          { onConflict: "rfp_company_id,vendor_id", ignoreDuplicates: false }
        )
        .select()
        .single();
      if (!chErr && upsertedChannel) {
        resolvedChannelId = upsertedChannel.id;
        setChannel(upsertedChannel as Channel);
        onChannelUpdated?.(upsertedChannel as Channel);
      }
      // chErr here just means migration not run yet — non-fatal, message still sends
    }


    const msgPayload: Record<string, unknown> = {
      id: uuidv4(),
      sender_id: user.id,
      receiver_id: otherUserId,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };
    if (resolvedChannelId && !isRfpRfp) msgPayload.channel_id = resolvedChannelId;

    try {
      let { error } = await supabase.from("messages").insert(msgPayload);

      // If the insert failed because channel_id column doesn't exist yet
      // (migration not applied), retry without it so messaging still works.
      if (error && (error.code === "42703" || error.message?.includes("channel_id"))) {
        console.warn("channel_id column not found — retrying without it. Run the SQL migration to enable full functionality.");
        const { error: retryErr } = await supabase.from("messages").insert({
          id: msgPayload.id,
          sender_id: user.id,
          receiver_id: otherUserId,
          text: text.trim(),
          timestamp: new Date().toISOString(),
        });
        error = retryErr;
      }

      if (error) {
        console.error(
          "Failed to send message:",
          error.message ?? error,
          "| code:", error.code,
          "| details:", error.details,
          "| hint:", error.hint
        );
        throw error;
      }

      const sentText = text.trim();
      setText("");

      // Optimistically add the message
      setMessages((prev) => [
        ...prev,
        {
          message_id: msgPayload.id as string,
          sender_id: user.id,
          receiver_id: otherUserId,
          text: sentText,
          timestamp: new Date().toISOString(),
          channel_id: resolvedChannelId ?? undefined,
        },
      ]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
      onMessageSent?.();
    } catch (err: any) {
      console.error(
        "Send message exception:",
        err?.message ?? err,
        "| code:", err?.code,
        "| details:", err?.details
      );
    } finally {
      setSending(false);
    }
  };

  const handleChannelUpdated = (updated: Channel) => {
    setChannel(updated);
    onChannelUpdated?.(updated);
    setShowSettings(false);
  };

  // Merge messages and system events
  interface TimelineItem {
    type: "message" | "system";
    id: string;
    timestamp: string;
    text: string;
    sender_id?: string;
    note?: string | null;
  }

  const messageItems: TimelineItem[] = messages.map((m) => ({
    type: "message",
    id: m.message_id || (m as any).id,
    timestamp: m.timestamp,
    text: m.text,
    sender_id: m.sender_id,
  }));

  const systemItems: TimelineItem[] = [];

  if (isRfpRfp && rfpRequest) {
    const requesterName = rfpRequest.requester_id === user?.id ? "You" : otherUserName;
    systemItems.push({
      type: "system",
      id: `request-created-${rfpRequest.id}`,
      timestamp: rfpRequest.created_at,
      text: `${requesterName} sent a connection request.`,
      note: rfpRequest.note,
    });

    if (rfpRequest.status === "approved") {
      const approverName = rfpRequest.target_id === user?.id ? "You" : otherUserName;
      const approvedTime = (channel as any)?.created_at || new Date(new Date(rfpRequest.created_at).getTime() + 1000).toISOString();
      systemItems.push({
        type: "system",
        id: `request-approved-${rfpRequest.id}`,
        timestamp: approvedTime,
        text: `${approverName} accepted the connection request.`,
      });
    } else if (rfpRequest.status === "rejected") {
      const declinerName = rfpRequest.target_id === user?.id ? "You" : otherUserName;
      systemItems.push({
        type: "system",
        id: `request-rejected-${rfpRequest.id}`,
        timestamp: new Date(new Date(rfpRequest.created_at).getTime() + 1000).toISOString(),
        text: `${declinerName} declined the connection request.`,
      });
    }
  }

  if (isRfpRfp && isBlocked && channel) {
    const blockerName = blockedBy === user?.id ? "You" : otherUserName;
    systemItems.push({
      type: "system",
      id: `channel-blocked-${channel.id}`,
      timestamp: (channel as any).updated_at || new Date().toISOString(),
      text: `${blockerName} blocked the conversation.`,
    });
  }

  const allTimelineItems = [...messageItems, ...systemItems].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Build date groups
  const groups: { label: string; items: TimelineItem[] }[] = [];
  allTimelineItems.forEach((item) => {
    const d = toDate(item.timestamp);
    const label = d ? formatDateLabel(d) : "";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--divider)] flex items-center gap-3 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="md:hidden w-8 h-8 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--surface)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}
        <div className="w-9 h-9 rounded-full bg-[var(--surface-hover)] flex items-center justify-center text-sm font-bold text-[var(--foreground)]">
          {otherUserName?.charAt(0)?.toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--foreground)] truncate">{otherUserName}</p>
          {(channel || (isRfpRfp && rfpRequest?.status === "approved")) && (
            <p className={`text-[10px] ${isLocked ? "text-red-400" : "text-emerald-500"}`}>
              {isRfpRfp
                ? (isBlocked ? "Blocked" : "Connected")
                : (isClosed ? "Channel closed" : isExpired ? "Channel expired" : expiresLabel ? `Active · expires ${expiresLabel}` : "Active · no expiry")}
            </p>
          )}
        </div>

        {/* RFP Company: always-visible channel control pill / Block options */}
        {isRfpCompany && (
          isRfpRfp ? (
            channel && (
              isBlockedByMe ? (
                <button
                  onClick={handleUnblock}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border bg-amber-500/10 border-amber-400/40 text-amber-500 hover:bg-amber-500/20 transition-all shrink-0 animate-fade"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Unblock
                </button>
              ) : isBlockedByOther ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border bg-red-500/10 border-red-400/40 text-red-500 shrink-0 select-none opacity-60">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  Blocked
                </div>
              ) : (
                <button
                  onClick={handleBlock}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border bg-[var(--surface)] border-[var(--divider)] text-[var(--muted)] hover:bg-red-500/10 hover:border-red-400/40 hover:text-red-500 transition-all shrink-0"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Block
                </button>
              )
            )
          ) : (
            <button
              onClick={() => setShowSettings(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all shrink-0 ${
                isClosed || isExpired
                  ? "bg-red-500/10 border-red-400/40 text-red-500 hover:bg-red-500/20"
                  : channel
                  ? "bg-emerald-500/10 border-emerald-400/40 text-emerald-600 hover:bg-emerald-500/20"
                  : "bg-[var(--surface)] border-[var(--divider)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
              }`}
              title="Manage channel"
            >
              {/* status dot */}
              <span className={`w-1.5 h-1.5 rounded-full ${
                isClosed || isExpired ? "bg-red-500" : channel ? "bg-emerald-500" : "bg-[var(--muted)]"
              }`} />
              {isClosed ? "Closed" : isExpired ? "Expired" : channel ? "Active" : "No channel"}
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          )
        )}
      </div>

      {/* Expiry warning banner */}
      {showExpiryWarning && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 shrink-0">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This channel expires <strong>{expiresLabel}</strong>.
            {isRfpCompany && " You can extend it in channel settings."}
          </p>
        </div>
      )}

      {/* Closed/Expired banner */}
      {isLocked && !isRfpRfp && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 shrink-0">
          <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <p className="text-xs text-red-500">
            {isClosed ? "This channel has been closed." : "This channel has expired."}
            {isRfpCompany && " Open channel settings to reopen it."}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {allTimelineItems.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[var(--muted)]">No messages yet — say hello!</p>
          </div>
        )}

        {groups.map((g, gi) => (
          <div key={g.label ? g.label : `group-${gi}`}>
            {g.label && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-[var(--divider)]" />
                <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">{g.label}</span>
                <div className="flex-1 h-px bg-[var(--divider)]" />
              </div>
            )}
            <div className="space-y-1">
              {g.items.map((item, i) => {
                if (item.type === "system") {
                  return (
                    <div key={item.id} className="flex flex-col items-center justify-center my-4 text-center">
                      <div className="max-w-md px-4 py-2.5 rounded-xl bg-[var(--surface-hover)] border border-[var(--divider)] shadow-sm">
                        <p className="text-xs font-semibold text-[var(--foreground)]">{item.text}</p>
                        {item.note && (
                          <p className="text-[11px] text-[var(--muted)] italic mt-1 pl-2 border-l-2 border-[var(--primary)]">
                            &ldquo;{item.note}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                const isMine = item.sender_id === user?.id;
                const d = toDate(item.timestamp);
                const prev = g.items[i - 1];
                const sameSender = prev?.sender_id === item.sender_id && prev?.type === "message";

                return (
                  <div key={item.id} className={`flex ${isMine ? "justify-end" : "justify-start"} ${!sameSender ? "pt-2" : ""}`}>
                    <div className="group max-w-[75%]">
                      <div
                        className={`px-3.5 py-2 text-sm leading-relaxed rounded-2xl ${
                          isMine
                            ? "bg-[var(--primary)] text-[#EFECE3]"
                            : "bg-[var(--surface)] text-[var(--foreground)]"
                        }`}
                      >
                        {item.text}
                      </div>
                      {d && (
                        <p className={`text-[10px] mt-0.5 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity ${isMine ? "text-right" : "text-left"}`}>
                          {format(d, "h:mm a")}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input / Connection Request */}
      {isRfpRfp && (isLocked || (!channel && rfpRequest?.status !== "approved")) ? (
        loadingRequest ? (
          <div className="px-4 py-6 border-t border-[var(--divider)] shrink-0 flex justify-center">
            <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isBlocked ? (
          isBlockedByMe ? (
            <div className="p-5 bg-[var(--surface)] border-t border-[var(--divider)] flex flex-col items-center gap-2 shrink-0">
              <p className="text-sm font-semibold text-amber-500">Conversation Blocked</p>
              <p className="text-xs text-[var(--muted)] text-center">You have blocked this conversation. Unblock it to send messages.</p>
              <button
                onClick={handleUnblock}
                className="mt-1.5 px-4 py-1.5 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors"
              >
                Unblock Conversation
              </button>
            </div>
          ) : (
            <div className="p-5 bg-[var(--surface)] border-t border-[var(--divider)] text-center shrink-0">
              <p className="text-sm font-semibold text-red-500">Blocked</p>
              <p className="text-xs text-[var(--muted)] mt-1">This conversation has been blocked by the other company.</p>
            </div>
          )
        ) : rfpRequest?.status === "pending" ? (
          rfpRequest.requester_id === user?.id ? (
            <div className="p-5 bg-[var(--surface)] border-t border-[var(--divider)] text-center shrink-0">
              <p className="text-sm font-semibold text-amber-500">Connection Request Pending Approval</p>
              <p className="text-xs text-[var(--muted)] mt-1">You can chat once the other company accepts your request.</p>
            </div>
          ) : (
            <div className="p-5 bg-[var(--surface)] border-t border-[var(--divider)] flex flex-col items-center gap-3 shrink-0">
              <div className="text-center">
                <p className="text-sm font-semibold text-[var(--foreground)]">Pending Connection Request</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">They requested to connect with you to chat.</p>
                {rfpRequest.note && (
                  <p className="text-xs text-[var(--muted)] italic bg-[var(--card)] px-3 py-1.5 rounded-lg border border-[var(--divider)] mt-2 mx-auto max-w-sm">
                    &ldquo;{rfpRequest.note}&rdquo;
                  </p>
                )}
              </div>
              <div className="flex gap-3 w-full max-w-xs">
                <button
                  onClick={handleAcceptRequest}
                  disabled={sendingRequest}
                  className="flex-1 py-2 rounded-xl bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  Accept Request
                </button>
                <button
                  onClick={handleDeclineRequest}
                  disabled={sendingRequest}
                  className="flex-1 py-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 text-xs font-semibold hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="p-4 bg-[var(--surface)] border-t border-[var(--divider)] flex flex-col gap-3 shrink-0">
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--muted)]">
                This channel is {isClosed ? "closed" : isExpired ? "expired" : "inactive"}. Send a connection request to chat.
              </p>
            </div>
            <div className="flex flex-col gap-2 max-w-md mx-auto w-full">
              <textarea
                value={composerNote}
                onChange={(e) => setComposerNote(e.target.value)}
                placeholder="Optional: add a note with your request…"
                rows={2}
                className="w-full rounded-xl border border-[var(--divider)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] placeholder-[var(--muted)] outline-none resize-none focus:border-[var(--primary)] transition-colors"
              />
              <button
                onClick={handleSendRequest}
                disabled={sendingRequest}
                className="w-full py-2 rounded-xl bg-[var(--primary)] text-[#EFECE3] text-xs font-semibold hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
              >
                {sendingRequest ? "Sending Request…" : "Send Connection Request"}
              </button>
            </div>
          </div>
        )
      ) : (
        /* Original input layout */
        <div className="px-4 py-3 border-t border-[var(--divider)] shrink-0">
          {isLocked && !isRfpCompany ? (
            <div className="flex items-center justify-center py-1">
              <p className="text-xs text-[var(--muted)]">
                {isClosed ? "This channel is closed." : "This channel has expired."} You can no longer send messages.
              </p>
            </div>
          ) : (
            <div className={`flex items-center gap-2 bg-[var(--surface)] rounded-full px-4 py-2 ${isLocked ? "opacity-60" : ""}`}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder={isLocked ? "Channel is closed…" : "Type a message..."}
                disabled={isLocked && !isRfpCompany}
                className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none disabled:cursor-not-allowed"
              />
              <button
                onClick={sendMessage}
                disabled={!text.trim() || sending || (isLocked && !isRfpCompany)}
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  text.trim() && !sending && canSend
                    ? "bg-[var(--primary)] text-[#EFECE3] hover:bg-[var(--primary-hover)]"
                    : "text-[var(--muted)]"
                }`}
              >
                {sending ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Channel Settings Modal */}
      {showSettings && isRfpCompany && (
        <ChannelSettingsModal
          channel={channel ?? null}
          rfpCompanyId={user?.id ?? ""}
          vendorId={otherUserId}
          isRfpRfp={isRfpRfp}
          onClose={() => setShowSettings(false)}
          onUpdated={handleChannelUpdated}
        />
      )}
    </div>
  );
}
