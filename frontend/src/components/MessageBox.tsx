"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { format, isToday, isYesterday } from "date-fns";
import { supabase } from "@/services/supabase";

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
}

export default function MessageBox({
  otherUserId,
  otherUserName,
  onBack,
}: {
  otherUserId: string;
  otherUserName: string;
  onBack?: () => void;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    if (!user || !text.trim() || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        id: crypto.randomUUID(),
        sender_id: user.id,
        receiver_id: otherUserId,
        text: text.trim(),
        timestamp: new Date().toISOString(),
      });
      if (error) throw error;
      setText("");
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  // Build simple date groups
  const groups: { label: string; msgs: Message[] }[] = [];
  messages.forEach((m) => {
    const d = toDate(m.timestamp);
    const label = d ? formatDateLabel(d) : "";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.msgs.push(m);
    else groups.push({ label, msgs: [m] });
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
        <p className="text-sm font-semibold text-[var(--foreground)] truncate">{otherUserName}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[var(--muted)]">No messages yet — say hello!</p>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.label}>
            {g.label && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-[var(--divider)]" />
                <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">{g.label}</span>
                <div className="flex-1 h-px bg-[var(--divider)]" />
              </div>
            )}
            <div className="space-y-1">
              {g.msgs.map((m, i) => {
                const isMine = m.sender_id === user?.id;
                const d = toDate(m.timestamp);
                const prev = g.msgs[i - 1];
                const sameSender = prev?.sender_id === m.sender_id;

                return (
                  <div key={m.message_id} className={`flex ${isMine ? "justify-end" : "justify-start"} ${!sameSender ? "pt-2" : ""}`}>
                    <div className="group max-w-[75%]">
                      <div
                        className={`px-3.5 py-2 text-sm leading-relaxed rounded-2xl ${
                          isMine
                            ? "bg-[var(--primary)] text-[#EFECE3]"
                            : "bg-[var(--surface)] text-[var(--foreground)]"
                        }`}
                      >
                        {m.text}
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

      {/* Input */}
      <div className="px-4 py-3 border-t border-[var(--divider)] shrink-0">
        <div className="flex items-center gap-2 bg-[var(--surface)] rounded-full px-4 py-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage())}
            placeholder="Type a message..."
            className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none"
          />
          <button
            onClick={sendMessage}
            disabled={!text.trim() || sending}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
              text.trim() && !sending
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
      </div>
    </div>
  );
}
