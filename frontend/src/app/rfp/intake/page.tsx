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
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams?.get("mode");
  const tab = searchParams?.get("tab");
  const [mainTab, setMainTab] = useState<"generate" | "blank" | "responses">(
    tab === "blank" || tab === "responses" ? tab : "generate"
  );

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    const urlTab = searchParams?.get("tab");
    if (urlTab === "blank" || urlTab === "responses" || urlTab === "generate") {
      setMainTab(urlTab);
    }
  }, [searchParams]);

  const handleTabChange = (tab: "generate" | "blank" | "responses") => {
    setMainTab(tab);
    router.push(`/rfp/intake?tab=${tab}`);
  };

  const handleBackToOptions = () => {
    router.push("/postrfp");
  };

  const handleBackToIntakeTabs = () => {
    router.push("/postrfp");
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center px-4">
        <div className="card w-full max-w-md p-6 text-center">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
          <div className="text-lg font-semibold text-[var(--foreground)]">Loading intake...</div>
          <p className="mt-2 text-sm text-[var(--muted)]">Checking your session and restoring the RFP workspace.</p>
        </div>
      </div>
    );
  }

  // Show upload intake if in upload mode
  if (mode === "upload") {
    return (
      <div className="relative min-h-screen bg-[#EFECE3]">
        <button
          type="button"
          onClick={handleBackToIntakeTabs}
          className="absolute left-4 top-2 z-40 inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-sm transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          <span aria-hidden="true">←</span>
          Back
        </button>
        <RfpUploadIntake />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#EFECE3]">
      <button
        type="button"
        onClick={handleBackToOptions}
        className="absolute left-4 top-2 z-40 inline-flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-sm transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
      >
        <span aria-hidden="true">←</span>
        Back
      </button>
      {mainTab !== "generate" && <SubNavBar currentTab={mainTab === "blank" ? "contracts" : "responses"} />}
      <div className="max-w-7xl mx-auto px-4 py-8">
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

