"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import MessageBox, { Channel } from "@/components/MessageBox";
import RequestConnectPanel from "@/components/RequestConnectPanel";
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
  userType?: string;
  lastMessage: string;
  lastTime: Date | null;
  unread: boolean;
  channel?: Channel | null;
  /** true when this is an rfp-rfp channel */
  isRfpRfp?: boolean;
}

interface PendingRequest {
  id: string;
  /** vendor_id for vendor→rfp requests; requester_id for rfp→rfp requests */
  requesterId: string;
  requesterName?: string;
  status: string;
  note: string | null;
  created_at: string;
  /** distinguishes the two request types */
  kind: "vendor" | "rfp";
}

interface RfpRfpChannel {
  id: string;
  initiator_id: string;
  target_id: string;
  status: string;
  expires_at: string | null;
}

export default function MessagesPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const isRfpCompany = profile?.user_type === "rfp_company";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    name: string;
    channel?: Channel | null;
    isRfpRfp?: boolean;
    rfpRfpChannel?: RfpRfpChannel | null;
  } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState<"chats" | "requests">("chats");
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [showRequestPanel, setShowRequestPanel] = useState(false);
  const [processingReqId, setProcessingReqId] = useState<string | null>(null);

  // ── RFP→RFP: request compose and refresh state ─────────────────────────

  // ── Load conversations ──────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    if (!user) return;

    // 1. Vendor→RFP channels
    const channelQuery = supabase.from("message_channels").select("*");
    const { data: channelData } = isRfpCompany
      ? await channelQuery.eq("rfp_company_id", user.id)
      : await channelQuery.eq("vendor_id", user.id);
    const channels: Channel[] = channelData || [];

    // 2. RFP→RFP channels (only for RFP companies)
    let rfpRfpChannels: RfpRfpChannel[] = [];
    let rfpRequests: any[] = [];
    if (isRfpCompany) {
      const { data: rrData } = await supabase
        .from("rfp_rfp_channels")
        .select("*")
        .or(`initiator_id.eq.${user.id},target_id.eq.${user.id}`);
      rfpRfpChannels = rrData || [];

      const { data: reqsData } = await supabase
        .from("rfp_rfp_requests")
        .select("*")
        .or(`requester_id.eq.${user.id},target_id.eq.${user.id}`);
      rfpRequests = reqsData || [];
    }

    // 3. Messages
    const { data: msgData } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
    const msgs = msgData || [];

    const userIds = new Set<string>();

    if (isRfpCompany) {
      msgs.forEach((m: any) => {
        if (m.sender_id !== user.id) userIds.add(m.sender_id);
        if (m.receiver_id !== user.id) userIds.add(m.receiver_id);
      });
      channels.forEach((c) => {
        if (c.vendor_id) userIds.add(c.vendor_id);
      });
      rfpRfpChannels.forEach((c) => {
        userIds.add(c.initiator_id === user.id ? c.target_id : c.initiator_id);
      });
      rfpRequests.forEach((r) => {
        userIds.add(r.requester_id === user.id ? r.target_id : r.requester_id);
      });
    } else {
      channels.forEach((c) => {
        if (c.rfp_company_id) userIds.add(c.rfp_company_id);
      });
      msgs.forEach((m: any) => {
        if (m.sender_id !== user.id) userIds.add(m.sender_id);
      });
    }

    const convos: Conversation[] = [];
    for (const uid of userIds) {
      const userMsgs = msgs
        .filter(
          (m: any) =>
            (m.sender_id === uid && m.receiver_id === user.id) ||
            (m.sender_id === user.id && m.receiver_id === uid)
        )
        .sort(
          (a: any, b: any) =>
            new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
        );
      const lastMsg = userMsgs[0];

      const vendorChannel = isRfpCompany
        ? channels.find((c) => c.vendor_id === uid) ?? null
        : channels.find((c) => c.rfp_company_id === uid) ?? null;

      const rfpRfpChannel = rfpRfpChannels.find(
        (c) => c.initiator_id === uid || c.target_id === uid
      ) ?? null;

      const { data: userData } = await supabase
        .from("users")
        .select("company_name, user_type")
        .eq("id", uid)
        .maybeSingle();

      // Vendors must not see other vendors
      if (!isRfpCompany && userData?.user_type === "vendor") continue;

      const isRfpRfp = isRfpCompany && userData?.user_type === "rfp_company";
      const channel = isRfpRfp ? (rfpRfpChannel as any) : vendorChannel;

      const rfpReq = isRfpRfp
        ? rfpRequests.find((r: any) => r.requester_id === uid || r.target_id === uid)
        : null;

      const channelCreatedAt = (channel as any)?.created_at;
      const fallbackTime = channelCreatedAt
        ? new Date(channelCreatedAt)
        : rfpReq
        ? new Date(rfpReq.created_at)
        : null;
      const lastTime = toDate(lastMsg?.timestamp) || fallbackTime;

      convos.push({
        userId: uid,
        userName: userData?.company_name || "Unknown",
        userType: userData?.user_type,
        lastMessage: lastMsg?.text || "",
        lastTime,
        unread: lastMsg?.sender_id === uid && !lastMsg?.read,
        channel,
        isRfpRfp,
      });
    }

    convos.sort((a, b) => (b.lastTime?.getTime() || 0) - (a.lastTime?.getTime() || 0));
    setConversations(convos);
  }, [user, isRfpCompany]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Load all users for RFP Company search
  useEffect(() => {
    if (!isRfpCompany) return;
    void (async () => {
      const { data } = await supabase.from("users").select("*");
      setAllUsers(data || []);
    })();
  }, [isRfpCompany]);

  // Load pending requests for RFP Company (both vendor→rfp AND rfp→rfp)
  const loadPendingRequests = useCallback(async () => {
    if (!user || !isRfpCompany) return;

    const requests: PendingRequest[] = [];

    // Vendor→RFP requests
    const { data: vendorReqs } = await supabase
      .from("message_requests")
      .select("*")
      .eq("rfp_company_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (vendorReqs) {
      const enriched = await Promise.all(
        vendorReqs.map(async (r: any) => {
          const { data: ud } = await supabase
            .from("users")
            .select("company_name")
            .eq("id", r.vendor_id)
            .maybeSingle();
          return {
            id: r.id,
            requesterId: r.vendor_id,
            requesterName: ud?.company_name || "Unknown",
            status: r.status,
            note: r.note,
            created_at: r.created_at,
            kind: "vendor" as const,
          };
        })
      );
      requests.push(...enriched);
    }

    // RFP→RFP requests (target = this company)
    const { data: rfpReqs } = await supabase
      .from("rfp_rfp_requests")
      .select("*")
      .eq("target_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (rfpReqs) {
      const enriched = await Promise.all(
        rfpReqs.map(async (r: any) => {
          const { data: ud } = await supabase
            .from("users")
            .select("company_name")
            .eq("id", r.requester_id)
            .maybeSingle();
          return {
            id: r.id,
            requesterId: r.requester_id,
            requesterName: ud?.company_name || "Unknown",
            status: r.status,
            note: r.note,
            created_at: r.created_at,
            kind: "rfp" as const,
          };
        })
      );
      requests.push(...enriched);
    }

    // Sort by date
    requests.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setPendingRequests(requests);
  }, [user, isRfpCompany]);

  useEffect(() => {
    void loadPendingRequests();
  }, [loadPendingRequests]);

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
  const matchedConversations = conversations.filter((c) =>
    c.userName.toLowerCase().includes(lowerSearch)
  );
  const conversationUserIds = new Set(conversations.map((c) => c.userId));

  // For search: vendors are shown to RFP company (can message directly)
  // Other RFP companies shown but clicking triggers request flow
  const matchedNewUsers = isRfpCompany && searchText.trim()
    ? allUsers.filter(
        (u) =>
          u.id !== user.id &&
          !conversationUserIds.has(u.id) &&
          u.company_name?.toLowerCase().includes(lowerSearch)
      )
    : [];

  const selectConversation = (id: string, name: string, channel?: Channel | null, isRfpRfp?: boolean) => {
    setSelectedUser({ id, name, channel, isRfpRfp });
    setSearchText("");
    if (window.innerWidth < 768) setShowSidebar(false);
  };

  // Clicking on an RFP Company in search → select conversation and compose in main area
  const handleNewUserClick = (u: any) => {
    if (u.user_type === "rfp_company") {
      selectConversation(u.id, u.company_name, null, true);
    } else {
      // Vendor — can message directly
      selectConversation(u.id, u.company_name, null);
    }
  };

  const handleChannelUpdated = (updatedChannel: Channel) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.userId === selectedUser?.id ? { ...c, channel: updatedChannel } : c
      )
    );
    setSelectedUser((prev) => prev ? { ...prev, channel: updatedChannel } : prev);
  };

  // Approve a request (vendor→rfp or rfp→rfp)
  const approveRequest = async (req: PendingRequest) => {
    setProcessingReqId(req.id);

    let channelData: any = null;

    if (req.kind === "vendor") {
      // Create/activate a vendor channel (7 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const { data } = await supabase
        .from("message_channels")
        .upsert(
          {
            rfp_company_id: user.id,
            vendor_id: req.requesterId,
            status: "active",
            expires_at: expiresAt.toISOString(),
          },
          { onConflict: "rfp_company_id,vendor_id", ignoreDuplicates: false }
        )
        .select()
        .single();
      channelData = data;
      await supabase.from("message_requests").update({ status: "approved" }).eq("id", req.id);
    } else {
      // Create an RFP→RFP channel (permanent)
      const { data } = await supabase
        .from("rfp_rfp_channels")
        .upsert(
          {
            initiator_id: req.requesterId,
            target_id: user.id,
            status: "active",
            expires_at: null,
          },
          { onConflict: "initiator_id,target_id", ignoreDuplicates: false }
        )
        .select()
        .single();
      channelData = data;
      await supabase.from("rfp_rfp_requests").update({ status: "approved" }).eq("id", req.id);
    }

    if (channelData && selectedUser?.id === req.requesterId) {
      setSelectedUser((prev) => prev ? { ...prev, channel: channelData } : null);
    }

    setPendingRequests((prev) => prev.filter((r) => r.id !== req.id));
    setProcessingReqId(null);
    void loadConversations();
  };

  const rejectRequest = async (req: PendingRequest) => {
    setProcessingReqId(req.id);
    const table = req.kind === "vendor" ? "message_requests" : "rfp_rfp_requests";
    await supabase.from(table).update({ status: "rejected" }).eq("id", req.id);
    setPendingRequests((prev) => prev.filter((r) => r.id !== req.id));
    setProcessingReqId(null);
  };

  const channelIsLocked = (c?: Channel | null) => {
    if (!c) return false;
    const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
    return c.status === "closed" || expired;
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
            {/* Sidebar Header */}
            <div className="px-4 py-3 border-b border-[var(--divider)] shrink-0 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--foreground)]">Messages</h2>

              {/* Vendor: Request to Connect button */}
              {!isRfpCompany && (
                <button
                  onClick={() => setShowRequestPanel(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-semibold hover:bg-[var(--primary)]/20 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Request
                </button>
              )}

              {/* RFP Company: badge when there are pending requests */}
              {isRfpCompany && pendingRequests.length > 0 && activeTab === "chats" && (
                <button
                  onClick={() => setActiveTab("requests")}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-500 text-xs font-semibold"
                >
                  <span className="w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px] leading-none">
                    {pendingRequests.length}
                  </span>
                  Requests
                </button>
              )}
            </div>

            {/* RFP Company tabs */}
            {isRfpCompany && (
              <div className="flex border-b border-[var(--divider)] shrink-0">
                {(["chats", "requests"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setActiveTab(t);
                      setSelectedUser(null);
                    }}
                    className={`flex-1 py-2 text-xs font-medium transition-colors ${
                      activeTab === t
                        ? "border-b-2 border-[var(--primary)] text-[var(--primary)]"
                        : "text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {t === "chats" ? "Chats" : `Requests${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ""}`}
                  </button>
                ))}
              </div>
            )}

            {/* ── Chats tab ── */}
            {activeTab === "chats" && (
              <>
                <div className="px-3 py-2 shrink-0">
                  <div className="flex items-center gap-2 bg-[var(--surface)] rounded-lg px-3 py-2">
                    <svg className="w-4 h-4 text-[var(--muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder={isRfpCompany ? "Search or start a new chat" : "Search conversations"}
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

                <div className="flex-1 overflow-y-auto">
                  {/* New users from search (RFP Company only) */}
                  {matchedNewUsers.length > 0 && (
                    <>
                      <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                        Start a conversation
                      </p>
                      {matchedNewUsers.slice(0, 6).map((u) => {
                        const isOtherRfp = u.user_type === "rfp_company";
                        return (
                          <button
                            key={u.id}
                            onClick={() => handleNewUserClick(u)}
                            className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-[var(--surface)] transition-colors"
                          >
                            <div className="w-10 h-10 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] text-sm font-bold shrink-0">
                              {u.company_name?.charAt(0)?.toUpperCase() || "?"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium text-[var(--foreground)] truncate">{u.company_name}</p>
                                {isOtherRfp && (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">RFP Co.</span>
                                )}
                              </div>
                              <p className="text-xs text-[var(--muted)]">
                                {isOtherRfp ? "Request required" : "Click to message"}
                              </p>
                            </div>
                            {isOtherRfp && (
                              <svg className="w-4 h-4 text-[var(--muted)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                      {matchedConversations.length > 0 && (
                        <div className="mx-4 my-1 h-px bg-[var(--divider)]" />
                      )}
                    </>
                  )}

                  {/* Existing conversations */}
                  {matchedConversations.map((c) => {
                    const locked = channelIsLocked(c.channel);
                    return (
                      <button
                        key={c.userId}
                        onClick={() => selectConversation(c.userId, c.userName, c.channel, c.isRfpRfp)}
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
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className={`text-sm truncate ${c.unread ? "font-bold" : "font-medium"} text-[var(--foreground)]`}>
                                {c.userName}
                              </p>
                              {c.isRfpRfp && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">RFP Co.</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {locked && (
                                <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                                </svg>
                              )}
                              {c.lastTime && (
                                <span className="text-[10px] text-[var(--muted)]">
                                  {formatDistanceToNow(c.lastTime, { addSuffix: false })}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className={`text-xs truncate mt-0.5 ${c.unread ? "text-[var(--foreground-secondary)]" : "text-[var(--muted)]"}`}>
                            {c.lastMessage || "No messages yet"}
                          </p>
                        </div>
                      </button>
                    );
                  })}

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
                          <p className="text-xs text-[var(--muted)] mt-1">
                            {isRfpCompany
                              ? "Search for vendors to message freely, or request to connect with other RFP Companies"
                              : "An RFP Company will initiate a conversation, or use the Request button above"}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Requests tab (RFP Company only) ── */}
            {activeTab === "requests" && isRfpCompany && (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {pendingRequests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                    <svg className="w-10 h-10 text-[var(--muted)]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    <p className="text-sm text-[var(--muted)]">No pending requests</p>
                  </div>
                ) : (
                  pendingRequests.map((req) => (
                    <div
                      key={req.id}
                      onClick={() => selectConversation(req.requesterId, req.requesterName || "Unknown", null, req.kind === "rfp")}
                      className="cursor-pointer rounded-xl border border-[var(--divider)] p-3 space-y-2 hover:bg-[var(--surface)] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] text-xs font-bold shrink-0">
                          {req.requesterName?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-[var(--foreground)] truncate">{req.requesterName}</p>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                              req.kind === "rfp"
                                ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                                : "bg-emerald-500/10 text-emerald-600"
                            }`}>
                              {req.kind === "rfp" ? "RFP Co." : "Vendor"}
                            </span>
                          </div>
                          <p className="text-[10px] text-[var(--muted)]">
                            {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      {req.note && (
                        <p className="text-xs text-[var(--muted)] italic border-l-2 border-[var(--divider)] pl-2">{req.note}</p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            approveRequest(req);
                          }}
                          disabled={processingReqId === req.id}
                          className="flex-1 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-500 text-xs font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            rejectRequest(req);
                          }}
                          disabled={processingReqId === req.id}
                          className="flex-1 py-1.5 rounded-lg bg-red-500/15 text-red-500 text-xs font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── Chat Area ── */}
          <div className={`${showSidebar ? "hidden md:flex" : "flex"} flex-1 flex-col min-w-0`}>
            {selectedUser ? (
              <MessageBox
                otherUserId={selectedUser.id}
                otherUserName={selectedUser.name}
                channel={selectedUser.channel}
                isRfpRfp={selectedUser.isRfpRfp}
                onBack={() => setShowSidebar(true)}
                onChannelUpdated={handleChannelUpdated}
                onRequestSent={loadConversations}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center px-6">
                <svg className="w-16 h-16 text-[var(--muted)]/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={0.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Select a chat</h3>
                <p className="text-sm text-[var(--muted)] text-center mt-1 max-w-xs">
                  {isRfpCompany
                    ? "Message vendors freely. To chat with other RFP Companies, send a connection request first."
                    : "Your active conversations will appear here."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Vendor: Request to Connect panel */}
      {showRequestPanel && (
        <RequestConnectPanel onClose={() => setShowRequestPanel(false)} />
      )}
    </div>
  );
}
