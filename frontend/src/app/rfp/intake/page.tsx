"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import RfpTab from "@/app/insights/RfpTab";
import MyContractsTab from "@/app/insights/MyContractsTab";
import VendorResponsesTab from "@/app/insights/VendorResponsesTab";
import RfpUploadIntake from "@/components/RfpUploadIntake";
import SubNavBar from "@/components/SubNavBar";

function RfpIntakeRouteContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const tab = searchParams.get("tab");
  const [mainTab, setMainTab] = useState<"generate" | "blank" | "responses">(
    tab === "blank" || tab === "responses" ? tab : "generate"
  );

  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab === "blank" || urlTab === "responses" || urlTab === "generate") {
      setMainTab(urlTab);
    }
  }, [searchParams]);

  const handleTabChange = (tab: "generate" | "blank" | "responses") => {
    setMainTab(tab);
    router.push(`/rfp/intake?tab=${tab}`);
  };

  // Show upload intake if in upload mode
  if (mode === "upload") {
    return (
      <div className="min-h-screen bg-[#EFECE3]">
        <RfpUploadIntake />
      </div>
    );
  }

  // Show 3-tab interface for normal RFP generation
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
    <div className="min-h-screen bg-[#EFECE3]">
      <SubNavBar currentTab={mainTab === "generate" ? "generate" : mainTab === "blank" ? "contracts" : "responses"} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        {mainTab === "generate" && <RfpTab onSaved={() => handleTabChange("blank")} />}
        {mainTab === "blank" && <MyContractsTab />}
        {mainTab === "responses" && <VendorResponsesTab />}
      </div>
    </div>
  );
}

export default function RfpIntakePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#EFECE3]" />}>
      <RfpIntakeRouteContent />
    </Suspense>
  );
}

