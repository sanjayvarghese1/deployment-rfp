"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RfpWorkflowPage() {
  const router = useRouter();
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const handleBuildFromScratch = () => {
    router.push("/rfp/intake?tab=generate");
  };

  const handleUploadExisting = () => {
    router.push("/rfp/intake?mode=upload");
  };

  return (
    <div className="max-w-[1128px] mx-auto px-4 py-6">
      <div className="">
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
    </div>
  );
}

