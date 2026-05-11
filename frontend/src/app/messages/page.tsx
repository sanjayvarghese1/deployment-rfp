"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import MessageBox from "@/components/MessageBox";
import { supabase } from "@/services/supabase";

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

interface Conversation {
  userId: string;
  userName: string;
  lastMessage: string;
  lastTime: Date | null;
  unread: boolean;
}

export default function MessagesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showSidebar, setShowSidebar] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

      if (error) {
        console.warn("Messages load failed:", error);
        setConversations([]);
        return;
      }

      const msgs = data || [];
      const userIds = new Set<string>();
      msgs.forEach((m: any) => {
        if (m.sender_id !== user.id) userIds.add(m.sender_id);
        if (m.receiver_id !== user.id) userIds.add(m.receiver_id);
      });

      const convos: Conversation[] = [];
      for (const uid of userIds) {
        const userMsgs = msgs
          .filter((m: any) => m.sender_id === uid || m.receiver_id === uid)
          .sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        const lastMsg = userMsgs[0];
        const { data: userData } = await supabase.from("users").select("company_name").eq("id", uid).maybeSingle();
        const userName = userData?.company_name || "Unknown";
        convos.push({
          userId: uid,
          userName,
          lastMessage: lastMsg?.text || "",
          lastTime: toDate(lastMsg?.timestamp),
          unread: lastMsg?.sender_id === uid && !lastMsg?.read,
        });
      }
      convos.sort((a, b) => (b.lastTime?.getTime() || 0) - (a.lastTime?.getTime() || 0));
      setConversations(convos);
    })();
  }, [user]);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from("users").select("*");
      if (error) {
        console.warn("Users load failed:", error);
        setAllUsers([]);
        return;
      }
      setAllUsers(data || []);
    })();
  }, []);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (!user)
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  const lowerSearch = searchText.toLowerCase();

  // Search shows both existing conversations AND new users to message
  const matchedConversations = conversations.filter((c) =>
    c.userName.toLowerCase().includes(lowerSearch)
  );
  const conversationUserIds = new Set(conversations.map((c) => c.userId));
  const matchedNewUsers = searchText.trim()
    ? allUsers.filter(
        (u) =>
            u.id !== user.id &&
          !conversationUserIds.has(u.id) &&
          u.company_name?.toLowerCase().includes(lowerSearch)
      )
    : [];

  const selectConversation = (id: string, name: string) => {
    setSelectedUser({ id, name });
    setSearchText("");
    // On small screens, hide sidebar when a chat is selected
    if (window.innerWidth < 768) setShowSidebar(false);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div
        className="rounded-2xl border border-[var(--divider)] bg-[var(--card)] overflow-hidden"
        style={{ height: "calc(100vh - 120px)", minHeight: "480px" }}
      >
        <div className="flex h-full">
          {/* ── Sidebar ── */}
          <div
            className={`${
              showSidebar ? "flex" : "hidden md:flex"
            } w-full md:w-80 shrink-0 flex-col border-r border-[var(--divider)] h-full`}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-[var(--divider)] shrink-0">
              <h2 className="text-lg font-bold text-[var(--foreground)]">Messages</h2>
            </div>

            {/* Unified search — finds conversations + new people */}
            <div className="px-3 py-2 shrink-0">
              <div className="flex items-center gap-2 bg-[var(--surface)] rounded-lg px-3 py-2">
                <svg className="w-4 h-4 text-[var(--muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search or start a new chat"
                  className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none"
                />
                {searchText && (
                  <button onClick={() => setSearchText("")} className="text-[var(--muted)] hover:text-[var(--foreground)]">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {/* New users matching search */}
              {matchedNewUsers.length > 0 && (
                <>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    Start a conversation
                  </p>
                  {matchedNewUsers.slice(0, 5).map((u) => (
                    <button
                      key={u.id}
                      onClick={() => selectConversation(u.id, u.company_name)}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-[var(--surface)] transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] text-sm font-bold shrink-0">
                        {u.company_name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)] truncate">{u.company_name}</p>
                        <p className="text-xs text-[var(--muted)]">{u.industry || "Company"}</p>
                      </div>
                    </button>
                  ))}
                  {matchedConversations.length > 0 && (
                    <div className="mx-4 my-1 h-px bg-[var(--divider)]" />
                  )}
                </>
              )}

              {/* Existing conversations */}
              {matchedConversations.map((c) => (
                <button
                  key={c.userId}
                  onClick={() => selectConversation(c.userId, c.userName)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    selectedUser?.id === c.userId
                      ? "bg-[var(--surface)]"
                      : "hover:bg-[var(--surface)]/60"
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-[var(--surface-hover)] flex items-center justify-center text-[var(--foreground)] text-sm font-bold">
                      {c.userName?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    {c.unread && (
                      <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--primary)] rounded-full border-2 border-[var(--card)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${c.unread ? "font-bold" : "font-medium"} text-[var(--foreground)]`}>
                        {c.userName}
                      </p>
                      {c.lastTime && (
                        <span className="text-[10px] text-[var(--muted)] shrink-0">
                          {formatDistanceToNow(c.lastTime, { addSuffix: false })}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${c.unread ? "text-[var(--foreground-secondary)]" : "text-[var(--muted)]"}`}>
                      {c.lastMessage || "No messages yet"}
                    </p>
                  </div>
                </button>
              ))}

              {/* Empty state */}
              {matchedConversations.length === 0 && matchedNewUsers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <svg className="w-12 h-12 text-[var(--muted)]/40 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                  </svg>
                  {searchText ? (
                    <p className="text-sm text-[var(--muted)]">No results for &quot;{searchText}&quot;</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-[var(--foreground)]">No conversations yet</p>
                      <p className="text-xs text-[var(--muted)] mt-1">Search for a company to start chatting</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Chat Area ── */}
          <div className={`${showSidebar ? "hidden md:flex" : "flex"} flex-1 flex-col min-w-0`}>
            {selectedUser ? (
              <MessageBox
                otherUserId={selectedUser.id}
                otherUserName={selectedUser.name}
                onBack={() => setShowSidebar(true)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center px-6">
                <svg className="w-16 h-16 text-[var(--muted)]/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={0.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Select a chat</h3>
                <p className="text-sm text-[var(--muted)] text-center mt-1">
                  Pick a conversation or search for someone to message.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
