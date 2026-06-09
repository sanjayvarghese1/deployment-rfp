"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import MyContractsTab from "@/app/insights/MyContractsTab";
import VendorResponsesTab from "@/app/insights/VendorResponsesTab";

export default function PostRfpPage() {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<"rfp" | "contracts" | "responses">("rfp");
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  // Vendors are not allowed to access Post RFP — sign them out and redirect to login
  useEffect(() => {
    if (!loading && user && profile && profile.user_type === "vendor") {
      void signOut().then(() => router.push("/login"));
    }
  }, [loading, user, profile, signOut, router]);

  useEffect(() => {
    if (pathname === "/rfp") {
      setActiveTab("rfp");
    }
  }, [pathname]);

  useEffect(() => {
    const resetToRfp = () => setActiveTab("rfp");

    window.addEventListener("pageshow", resetToRfp);
    return () => window.removeEventListener("pageshow", resetToRfp);
  }, []);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleTabClick = (tab: "rfp" | "contracts" | "responses") => {
    setActiveTab(tab);
  };

  const handleBuildFromScratch = () => {
    router.push("/rfp/intake?tab=generate");
  };

  const handleUploadExisting = () => {
    router.push("/rfp/intake?mode=upload");
  };

  const navItems = [
    {
      id: "rfp",
      label: "RFP",
    },
    {
      id: "contracts",
      label: "My Contracts",
    },
    {
      id: "responses",
      label: "Vendor Response",
    },
  ];

  return (
    <div className="min-h-screen bg-[#EFECE3]">
      {/* Sub Navigation Bar */}
      <div
        className="sticky top-[54px] z-30"
        style={{
          background: "rgba(239, 236, 227, 0.96)",
          backdropFilter: "blur(18px) saturate(1.3)",
          WebkitBackdropFilter: "blur(18px) saturate(1.3)",
          borderBottom: "1px solid #D4D1C8",
        }}
      >
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center gap-1 overflow-x-auto py-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id as "rfp" | "contracts" | "responses")}
                className={`relative px-3.5 py-2 whitespace-nowrap text-[13px] font-medium transition-colors duration-200 cursor-pointer ${
                  activeTab === item.id
                    ? "text-[var(--foreground)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                <span>{item.label}</span>
                {activeTab === item.id ? (
                  <span
                    className="absolute inset-x-3 bottom-0 h-px"
                    style={{ background: "var(--primary)" }}
                  />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* RFP Tab Content */}
        {activeTab === "rfp" && (
          <div className="max-w-[1128px] mx-auto">
            {/* Header */}
            <div className="text-center mb-16">
              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
                Request for Proposal
              </h1>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Create a new RFP from scratch or upload and optimize an existing one
              </p>
            </div>

            {/* Cards Container */}
            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {/* Build from Scratch Card */}
              <div onMouseEnter={() => setHoveredCard("scratch")} onMouseLeave={() => setHoveredCard(null)} onClick={handleBuildFromScratch} className="group cursor-pointer">
                <div className={`card p-6 transition-all duration-200 hover:shadow-lg hover:border-[var(--primary)]/20 ${hoveredCard === "scratch" ? "scale-105" : ""}`}>
                  <div className="flex flex-col h-full justify-between">
                    <div>
                      <div className="flex items-start gap-4 mb-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${hoveredCard === "scratch" ? "bg-[var(--primary)] text-[#EFECE3]" : "bg-[var(--surface)] text-[var(--foreground)]"}`}>
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m0 0h6M6 12a6 6 0 1112 0 6 6 0 01-12 0z" />
                          </svg>
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-[var(--foreground)]">Build from Scratch</h2>
                          <p className="text-sm text-[var(--muted)] mt-1">Create a new RFP from the ground up. Answer guided questions about your project, and we'll generate a tailored RFP document.</p>
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm text-[var(--muted)] mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>Guided intake process</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>AI-powered generation</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>Full customization available</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2">
                      <button onClick={handleBuildFromScratch} className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all shadow-sm w-full justify-center">
                        Start New RFP
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Upload Existing RFP Card */}
              <div onMouseEnter={() => setHoveredCard("upload")} onMouseLeave={() => setHoveredCard(null)} onClick={handleUploadExisting} className="group cursor-pointer">
                <div className={`card p-6 transition-all duration-200 hover:shadow-lg hover:border-[var(--primary)]/20 ${hoveredCard === "upload" ? "scale-105" : ""}`}>
                  <div className="flex flex-col h-full justify-between">
                    <div>
                      <div className="flex items-start gap-4 mb-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${hoveredCard === "upload" ? "bg-[var(--primary)] text-[#EFECE3]" : "bg-[var(--surface)] text-[var(--foreground)]"}`}>
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-[var(--foreground)]">Upload Existing RFP</h2>
                          <p className="text-sm text-[var(--muted)] mt-1">Upload a PDF of an existing RFP for analysis, scoring, and improvement suggestions.</p>
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm text-[var(--muted)] mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>PDF analysis & scoring</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>Intelligent suggestions</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>Post as-is or improved</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2">
                      <button onClick={handleUploadExisting} className="inline-flex items-center gap-2 bg-[var(--primary)] text-[#EFECE3] px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--primary-hover)] transition-all shadow-sm w-full justify-center">
                        Upload RFP
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* My Contracts Tab Content */}
        {activeTab === "contracts" && <MyContractsTab />}

        {/* Vendor Response Tab Content */}
        {activeTab === "responses" && <VendorResponsesTab />}
      </div>
    </div>
  );
}
