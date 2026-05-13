"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSearchParams, useRouter } from "next/navigation";
import RfpTab from "./RfpTab";
import MyContractsTab from "./MyContractsTab";
import VendorResponsesTab from "./VendorResponsesTab";

export default function InsightsPageClient() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mainTab, setMainTab] = useState<"generate" | "blank" | "responses">("generate");

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "blank" || tab === "generate" || tab === "responses") {
      setMainTab(tab);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [searchParams]);

  const handleTabChange = (tab: "generate" | "blank" | "responses") => {
    setMainTab(tab);
    router.push(`?tab=${tab}`, { scroll: false } as any);
  };

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-[var(--surface)] rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          </div>
          <p className="text-[var(--muted)] font-medium">Please sign in to post a contract</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="sticky top-[54px] z-40 flex border-b border-[var(--divider)] mb-6 bg-[var(--background)]">
        <button onClick={() => handleTabChange("generate")} className={`tab-btn ${mainTab === "generate" ? "active" : ""}`}>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            RFP File
          </span>
        </button>
        <button onClick={() => handleTabChange("blank")} className={`tab-btn ${mainTab === "blank" ? "active" : ""}`}>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
            My Contracts
          </span>
        </button>
        <button onClick={() => handleTabChange("responses")} className={`tab-btn ${mainTab === "responses" ? "active" : ""}`}>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            Vendor Responses
          </span>
        </button>
      </div>

      {mainTab === "generate" && <RfpTab onSaved={() => handleTabChange("blank")} />}
      {mainTab === "blank" && <MyContractsTab />}
      {mainTab === "responses" && <VendorResponsesTab />}
    </div>
  );
}

