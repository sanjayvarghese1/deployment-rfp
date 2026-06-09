"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/services/supabase";

export default function Navbar() {
  const { user, profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const pathname = usePathname();

  const isVendor = profile?.user_type === "vendor";
  const isRfpCompany = profile?.user_type === "rfp_company";

  const navItems = [
    { label: "Vendors", href: "/companies" },
    // RFP Companies go to dedicated My Contracts page; Vendors browse the marketplace
    isRfpCompany
      ? { label: "My Contracts", href: "/my-contracts" }
      : { label: "Contracts", href: "/contracts" },
    // Only RFP Companies see "RFP"
    ...(!isVendor ? [{ label: "RFP", href: "/rfp" }] : []),
    { label: "Messages", href: "/messages" },
    { label: "Notifications", href: "/notifications", badge: unreadNotifications },
  ];



  useEffect(() => {
    if (!user) {
      setUnreadNotifications(0);
      return;
    }

    const fetchNotifications = async () => {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .eq("read", false);
        
        if (!error && data) {
          setUnreadNotifications(data.length);
        }
      } catch (err) {
        console.error("Failed to fetch notifications", err);
      }
    };

    void fetchNotifications();
  }, [user]);

  return (
    <nav className="sticky top-0 z-50 w-full">
      {/* Main bar */}
      <div
        className="w-full"
        style={{
          background: "rgba(239, 236, 227, 0.95)",
          backdropFilter: "blur(24px) saturate(1.6)",
          WebkitBackdropFilter: "blur(24px) saturate(1.6)",
          borderBottom: "1px solid #D4D1C8",
        }}
      >
        <div className="w-full px-5 lg:px-8">
          <div className="flex items-center justify-between h-[54px]">

            {/* Left: Logo */}
            <Link href="/" className="shrink-0 group">
              <span className="text-[21px] uppercase" style={{ color: "#1a1a1a", fontFamily: "'Helvetica Neue', 'Arial', sans-serif", fontWeight: 300, letterSpacing: "3px" }}>
                PROCURE<span style={{ color: "#4A70A9", fontWeight: 600 }}>LINK</span>
              </span>
            </Link>

            {/* Center: Nav links (desktop) */}
            <div className="hidden lg:flex items-center gap-0.5 px-1.5 py-1 rounded-full" style={{ background: "rgba(74, 112, 169, 0.06)", border: "1px solid #D4D1C8" }}>
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="relative px-3.5 py-1.5 text-[13px] font-medium rounded-full transition-all duration-200"
                    style={{
                      color: active ? "#000000" : "#333333",
                      background: active ? "rgba(74, 112, 169, 0.10)" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = "#000000"; e.currentTarget.style.background = "#E5E2D8"; } }}
                    onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = "#333333"; e.currentTarget.style.background = "transparent"; } }}
                  >
                    {active && <div className="absolute inset-0 rounded-full" style={{ background: "rgba(74, 112, 169, 0.08)", boxShadow: "0 0 12px rgba(74, 112, 169, 0.06)" }} />}
                    <span className="relative inline-flex items-center gap-2">
                      {item.label}
                      {item.badge ? (
                        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold" style={{ background: "#4A70A9", color: "#EFECE3" }}>
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Right: Search + Profile / Auth */}
            <div className="hidden lg:flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "#333333" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search..."
                  className="w-[180px] h-8 pl-8 pr-3 rounded-lg text-[13px] outline-none transition-all"
                  style={{ background: "#E5E2D8", border: "1px solid #D4D1C8", color: "#000000" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "#000000"; e.currentTarget.style.background = "#E5E2D8"; e.currentTarget.style.width = "240px"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#D4D1C8"; e.currentTarget.style.background = "#E5E2D8"; e.currentTarget.style.width = "180px"; }}
                />
              </div>

              {/* Profile / Auth */}
              {user ? (
                <div className="flex items-center gap-2">
                  <Link
                    href="/profile"
                    className="flex items-center h-8 w-8 rounded-full overflow-hidden transition-all"
                    style={{
                      border: "2px solid #D4D1C8",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#4A70A9"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#D4D1C8"; }}
                    title="View Profile"
                  >
                    <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center text-[#EFECE3] text-[11px] font-bold" style={{ background: "linear-gradient(135deg, #4A70A9, #6B8DC4)" }}>
                      {profile?.profile_image ? (
                        <img src={profile.profile_image} alt={profile.company_name || ""} className="w-full h-full object-cover" />
                      ) : (
                        profile?.company_name?.charAt(0)?.toUpperCase() || "?"
                      )}
                    </div>
                  </Link>
                  <button
                    onClick={() => { signOut(); }}
                    className="h-8 w-8 rounded-full flex items-center justify-center transition-all"
                    style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#B8B5AC"; e.currentTarget.style.background = "#DDD9CF"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#D4D1C8"; e.currentTarget.style.background = "#E5E2D8"; }}
                    title="Sign out"
                  >
                    <svg className="w-4 h-4" style={{ color: "#f87171" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="text-[13px] font-semibold px-4 py-1.5 rounded-lg transition-all"
                  style={{ background: "var(--primary)", color: "#EFECE3" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--primary-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "var(--primary)"; }}
                >
                  Sign in
                </Link>
              )}
            </div>

            {/* Mobile hamburger */}
            <button
              className="lg:hidden ml-auto p-2 rounded-lg"
              style={{ color: "var(--muted)" }}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"} />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="lg:hidden"
          style={{
            background: "#EFECE3",
            borderBottom: "1px solid #D4D1C8",
          }}
        >
          <div className="px-4 py-3 space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    color: active ? "#000000" : "#333333",
                    background: active ? "rgba(74, 112, 169, 0.10)" : "transparent",
                  }}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="px-4 pb-4 pt-2" style={{ borderTop: "1px solid #D4D1C8" }}>
            {user ? (
              <div className="space-y-1">
                <Link href="/profile" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm" style={{ color: "#444444" }} onClick={() => setMobileOpen(false)}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[#EFECE3] text-[10px] font-bold" style={{ background: "linear-gradient(135deg, var(--primary), #4A70A9)" }}>
                    {profile?.company_name?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  {profile?.company_name || "Profile"}
                </Link>
                <button
                  onClick={() => { signOut(); setMobileOpen(false); }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm"
                  style={{ color: "var(--danger)" }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="block text-center text-sm font-semibold py-2.5 rounded-lg"
                style={{ background: "var(--primary)", color: "#EFECE3" }}
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

