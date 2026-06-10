"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/services/supabase";
import { randomUUID } from "@/lib/uuid";

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

interface Notification {
  notification_id: string;
  user_id: string;
  type: string;
  message: string;
  read: boolean;
  timestamp: string;
}

type FilterTab = "all" | "unread" | "mentions" | "contracts" | "messages";

const ICON_MAP: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  new_proposal: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
    color: "",
    bg: "",
  },
  message_received: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.2 48.2 0 0 0 5.887-.27c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
      </svg>
    ),
    color: "",
    bg: "",
  },
  proposal_accepted: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    ),
    color: "",
    bg: "",
  },
  proposal_rejected: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    ),
    color: "",
    bg: "",
  },
  deadline_reminder: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    color: "",
    bg: "",
  },
  new_review: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
      </svg>
    ),
    color: "",
    bg: "",
  },
  pending_verification: {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    color: "",
    bg: "",
  },
};

const ICON_STYLE: Record<string, { iconColor: string; bgColor: string }> = {
  new_proposal: { iconColor: "#000000", bgColor: "#E5E2D8" },
  message_received: { iconColor: "#34d399", bgColor: "#0a2e24" },
  proposal_accepted: { iconColor: "#4ade80", bgColor: "#0a2e1a" },
  proposal_rejected: { iconColor: "#fb7185", bgColor: "#FDE8E8" },
  deadline_reminder: { iconColor: "#fbbf24", bgColor: "#2e2408" },
  new_review: { iconColor: "#a78bfa", bgColor: "#1e1640" },
  pending_verification: { iconColor: "#fbbf24", bgColor: "#2e2408" },
};
const DEFAULT_ICON_STYLE = { iconColor: "#333333", bgColor: "#E5E2D8" };

const DEFAULT_ICON = {
  icon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  ),
  color: "",
  bg: "",
};

function getNotifCategory(type: string): string {
  if (type === "message_received") return "messages";
  if (["new_proposal", "proposal_accepted", "proposal_rejected", "deadline_reminder"].includes(type)) return "contracts";
  return "other";
}

export default function NotificationsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Verification request moderation states
  const [verificationRequester, setVerificationRequester] = useState<any | null>(null);
  const [verificationNotifId, setVerificationNotifId] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [actioning, setActioning] = useState(false);

  const isAdmin = profile?.company_name === "ylogx" || profile?.email === "admin@example.com";

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("timestamp", { ascending: false });

      if (error) {
        console.warn("Notifications load failed:", error);
        setNotifications([]);
        return;
      }

      setNotifications((data || []).map((row) => ({ notification_id: row.id, ...row })));
    })();
  }, [user]);

  const markAsRead = async (id: string) => {
    // Optimistic UI update for responsiveness
    setNotifications((prev) => prev.map((n) => (n.notification_id === id ? { ...n, read: true } : n)));
    try {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
      if (error) {
        // Revert local change on error
        setNotifications((prev) => prev.map((n) => (n.notification_id === id ? { ...n, read: false } : n)));
        throw error;
      }
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unread = notifications.filter((n) => !n.read);
      if (unread.length === 0) return;
      // Per UX request: clear notifications immediately after marking read
      setNotifications([]);
      await Promise.all(unread.map((n) => supabase.from("notifications").update({ read: true }).eq("id", n.notification_id)));
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to delete notification:", err);
    }
    setOpenMenuId(null);
  };

  const handleVerify = async (approved: boolean) => {
    if (!verificationRequester || !user) return;
    setActioning(true);
    try {
      const targetUserId = verificationRequester.id;
      const targetLicenses = verificationRequester.licenses || [];
      const updatedLicenses = targetLicenses.map((lic: any) => {
        if (lic.status === "pending") {
          return { ...lic, status: approved ? "approved" : "rejected" };
        }
        return lic;
      });

      // Get user's JWT access token from session
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Make post request to verify-vendor admin endpoint
      const res = await fetch("/api/admin/verify-vendor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token || ""}`
        },
        body: JSON.stringify({
          targetUserId,
          approved,
          updatedLicenses,
          notificationId: verificationNotifId,
          requesterCompanyName: verificationRequester.company_name
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to process verification via server API");
      }

      setVerificationRequester(null);
      setVerificationNotifId(null);
      
      // Reload admin's notifications list
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("timestamp", { ascending: false });

      if (!error && data) {
        setNotifications(data.map((row) => ({ notification_id: row.id, ...row })));
      }
    } catch (err: any) {
      console.error("Failed to action verification request:", err);
      alert(err.message || "An error occurred while processing the verification. Please try again.");
    } finally {
      setActioning(false);
    }
  };

  const openDataUrlInNewTab = (dataUrl: string, fileName: string) => {
    if (!dataUrl) return;
    if (!dataUrl.startsWith("data:")) {
      window.open(dataUrl, "_blank");
      return;
    }
    try {
      const arr = dataUrl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : '';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
    } catch (err) {
      console.error("Failed to open document:", err);
      const newWindow = window.open();
      if (newWindow) {
        newWindow.document.write(`<iframe src="${dataUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
      }
    }
  };

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (!user)
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filtered = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    if (filter === "messages") return getNotifCategory(n.type) === "messages";
    if (filter === "contracts") return getNotifCategory(n.type) === "contracts";
    return true;
  });

  // Group notifications by time periods
  const now = new Date();
  const today: Notification[] = [];
  const thisWeek: Notification[] = [];
  const earlier: Notification[] = [];

  filtered.forEach((n) => {
    const d = toDate(n.timestamp);
    if (!d) {
      earlier.push(n);
      return;
    }
    const diffMs = now.getTime() - d.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 1) today.push(n);
    else if (diffDays < 7) thisWeek.push(n);
    else earlier.push(n);
  });

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread", count: unreadCount },
    { key: "contracts", label: "Contracts" },
    { key: "messages", label: "Messages" },
  ];

  const renderNotification = (n: Notification) => {
    const iconData = ICON_MAP[n.type] || DEFAULT_ICON;
    const iconStyle = ICON_STYLE[n.type] || DEFAULT_ICON_STYLE;
    const timeStr = toDate(n.timestamp) ? formatDistanceToNow(toDate(n.timestamp)!, { addSuffix: true }) : "";
    return (
      <div
        key={n.notification_id}
        onClick={async () => {
          if (!n.read) {
            await markAsRead(n.notification_id);
          }
          if (n.type === "pending_verification" && isAdmin) {
            const match = n.message.match(/Request details:\s*([a-f0-9-]+)/);
            const requesterId = match ? match[1] : null;
            if (requesterId) {
              setModalLoading(true);
              setVerificationNotifId(n.notification_id);
              try {
                const { data, error } = await supabase.from("users").select("*").eq("id", requesterId).single();
                if (!error && data) {
                  setVerificationRequester(data);
                } else {
                  alert("Failed to load company details. The user might have deleted their profile.");
                }
              } catch (err) {
                console.error("Error fetching requester profile:", err);
              } finally {
                setModalLoading(false);
              }
            }
          }
        }}
        className="group relative cursor-pointer transition-all duration-200"
        style={{
          background: !n.read ? "#E5E2D8" : "#EFECE3",
          borderBottom: "1px solid #E5E2D8",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#E5E2D8"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = !n.read ? "#E5E2D8" : "#EFECE3"; }}
      >
        <div className="flex items-start gap-5 px-6 py-5">
          {/* Icon */}
          <div
            className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: iconStyle.bgColor, color: iconStyle.iconColor }}
          >
            {iconData.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p style={{ color: !n.read ? "#000000" : "#444444", fontWeight: !n.read ? 500 : 400, fontSize: "15px", lineHeight: "1.6" }}>
              {n.message}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#000000" }}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                {timeStr}
              </span>
              <span style={{ color: "#D4D1C8" }}>|</span>
              <span className="text-[13px] capitalize" style={{ color: iconStyle.iconColor }}>
                {n.type.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Unread dot + Actions */}
          <div className="flex items-center gap-1 shrink-0 pt-1.5">
            {!n.read && <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#000000" }} />}
            {!n.read && (
              <button
                onClick={(e) => { e.stopPropagation(); markAsRead(n.notification_id); }}
                className="p-2 rounded-lg transition-all hover:bg-[#E5E2D8]"
                style={{ color: "#000000" }}
                title="Mark as read"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderGroup = (label: string, items: Notification[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className="px-6 py-3 flex items-center gap-3" style={{ background: "#EFECE3" }}>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#333333" }}>{label}</span>
          <div className="flex-1 h-px" style={{ background: "#E5E2D8" }} />
          <span className="text-xs font-semibold px-2.5 py-1 rounded-md" style={{ color: "#444444", background: "#E5E2D8" }}>{items.length}</span>
        </div>
        <div>
          {items.map(renderNotification)}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ background: "#EFECE3" }} onClick={() => openMenuId && setOpenMenuId(null)}>
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#000000" }}>Notifications</h1>
              <p className="text-sm mt-1" style={{ color: "#333333" }}>
                {notifications.length === 0 ? "No notifications" : `${notifications.length} total \u00b7 ${unreadCount} unread`}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm font-medium px-5 py-2.5 rounded-lg transition-all"
                style={{ color: "#000000", background: "#E5E2D8", border: "1px solid #B8B5AC" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#B8B5AC"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#E5E2D8"; }}
              >
                Mark all as read
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className="px-5 py-2.5 text-sm font-medium rounded-lg transition-all"
              style={{
                color: filter === tab.key ? "#000000" : "#333333",
                background: filter === tab.key ? "#E5E2D8" : "transparent",
                border: filter === tab.key ? "1px solid #D4D1C8" : "1px solid transparent",
              }}
              onMouseEnter={(e) => { if (filter !== tab.key) { e.currentTarget.style.background = "#E5E2D8"; e.currentTarget.style.color = "#000000"; } }}
              onMouseLeave={(e) => { if (filter !== tab.key) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#333333"; } }}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{
                  background: filter === tab.key ? "#000000" : "#E5E2D8",
                  color: filter === tab.key ? "#EFECE3" : "#333333",
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Notification list */}
        <div className="rounded-xl overflow-hidden" style={{ background: "#EFECE3", border: "1px solid #E5E2D8" }}>
          {filtered.length === 0 ? (
            <div className="text-center py-24 px-8">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: "#E5E2D8" }}>
                <svg className="w-7 h-7" style={{ color: "#000000" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
              </div>
              <p className="font-semibold text-lg" style={{ color: "#f1f5f9" }}>
                {filter === "unread" ? "All caught up!" : "No notifications yet"}
              </p>
              <p className="text-sm mt-2 max-w-sm mx-auto" style={{ color: "#333333" }}>
                {filter === "unread"
                  ? "You have no unread notifications."
                  : "When someone interacts with your posts or contracts, you\u2019ll see it here."}
              </p>
            </div>
          ) : (
            <div>
              {renderGroup("Today", today)}
              {renderGroup("This week", thisWeek)}
              {renderGroup("Earlier", earlier)}
            </div>
          )}
        </div>
      </div>

      {/* Verification Dialog Modal */}
      {verificationRequester && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-[#EFECE3] border border-[#D4D1C8] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-[#D4D1C8] bg-[#E5E2D8] flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-[#000000]">Verification Request</h3>
                <p className="text-xs text-[#333333] mt-0.5">Review company details and uploaded documentation</p>
              </div>
              <button
                onClick={() => { setVerificationRequester(null); setVerificationNotifId(null); }}
                className="p-1.5 rounded-lg hover:bg-[#D4D1C8] transition-colors"
              >
                <svg className="w-5 h-5 text-[#333333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-6 max-h-[70vh] overflow-y-auto space-y-6">
              {/* Company Info Header */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold bg-[#D4D1C8] text-[#333333] overflow-hidden shrink-0">
                  {verificationRequester.profile_image ? (
                    <img src={verificationRequester.profile_image} alt={verificationRequester.company_name} className="w-full h-full object-cover" />
                  ) : (
                    verificationRequester.company_name?.charAt(0) || "?"
                  )}
                </div>
                <div>
                  <h4 className="text-xl font-bold text-[#000000]">{verificationRequester.company_name}</h4>
                  <p className="text-sm font-medium text-[#4A70A9]">{verificationRequester.industry || "No Industry Specified"}</p>
                </div>
              </div>

              {/* Description */}
              <div className="bg-[#E5E2D8] rounded-xl p-4 border border-[#D4D1C8]">
                <h5 className="text-xs font-bold text-[#333333] uppercase tracking-wider mb-2">Company Overview</h5>
                <p className="text-sm text-[#000000] leading-relaxed whitespace-pre-wrap">
                  {verificationRequester.description || "No description provided."}
                </p>
              </div>

              {/* Metadata Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: "Location", value: verificationRequester.location },
                  { label: "Website", value: verificationRequester.website, isLink: true },
                  { label: "Founded Year", value: verificationRequester.founded_year },
                  { label: "Company Size", value: verificationRequester.company_size ? `${verificationRequester.company_size} employees` : "" },
                  { label: "Phone", value: verificationRequester.phone },
                  { label: "Registration No.", value: verificationRequester.registration_number },
                  { label: "Email", value: verificationRequester.email },
                ].filter(item => item.value).map((item, i) => (
                  <div key={i} className="flex justify-between py-2 border-b border-[#D4D1C8]">
                    <span className="text-xs font-semibold text-[#888]">{item.label}</span>
                    {item.isLink ? (
                      <a href={item.value!.startsWith("http") ? item.value! : `https://${item.value}`} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-[#4A70A9] hover:underline truncate max-w-[200px]">{item.value}</a>
                    ) : (
                      <span className="text-xs font-bold text-[#000000]">{item.value}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Uploaded Documents */}
              <div className="space-y-3">
                <h5 className="text-xs font-bold text-[#333333] uppercase tracking-wider">Submitted Document</h5>
                {verificationRequester.licenses && verificationRequester.licenses.length > 0 ? (
                  <div className="space-y-2">
                    {verificationRequester.licenses.map((lic: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-3.5 bg-[#E5E2D8] border border-[#D4D1C8] rounded-xl">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-[#D4D1C8] flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5 text-[#333333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-[#000000] block truncate">{lic.name}</span>
                            <span className="text-xs text-[#333333]">Uploaded on {new Date(lic.uploaded_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); openDataUrlInNewTab(lic.url, lic.name); }}
                          className="px-4 py-2 rounded-lg text-xs font-bold bg-[#D4D1C8] text-[#000000] hover:opacity-80 transition-opacity whitespace-nowrap"
                        >
                          View Document
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#333333] italic">No document submitted.</p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[#D4D1C8] bg-[#E5E2D8] flex items-center justify-between">
              <button
                onClick={() => { setVerificationRequester(null); setVerificationNotifId(null); }}
                disabled={actioning}
                className="px-5 py-2.5 rounded-lg text-xs font-bold bg-[#D4D1C8] text-[#000000] hover:opacity-80 transition-opacity"
              >
                Close
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleVerify(false)}
                  disabled={actioning}
                  className="px-5 py-2.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-[#EFECE3] disabled:opacity-50 transition-colors shadow-sm"
                >
                  {actioning ? "Processing..." : "Reject Verification"}
                </button>
                <button
                  onClick={() => handleVerify(true)}
                  disabled={actioning}
                  className="px-5 py-2.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-[#EFECE3] disabled:opacity-50 transition-colors shadow-sm"
                >
                  {actioning ? "Processing..." : "Verify & Approve"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay for fetching company details */}
      {modalLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="p-6 bg-[#EFECE3] border border-[#D4D1C8] rounded-xl flex items-center gap-3 shadow-xl">
            <div className="w-5 h-5 border-2 border-t-transparent border-[#000000] rounded-full animate-spin" />
            <span className="text-sm font-semibold text-[#000000]">Fetching company details...</span>
          </div>
        </div>
      )}
    </div>
  );
}

