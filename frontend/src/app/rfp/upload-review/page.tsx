"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RfpChatbot, { type UploadAnalysisPayload } from "@/components/RfpChatbot";

export default function RfpUploadReviewPage() {
  const router = useRouter();
  const [uploadAnalysis, setUploadAnalysis] = useState<UploadAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("rfp-upload-analysis");
      if (!raw) {
        router.replace("/rfp/intake?mode=upload");
        return;
      }

      const parsed = JSON.parse(raw) as UploadAnalysisPayload;
      const isValid =
        typeof parsed?.overallScore === "number" &&
        Array.isArray(parsed?.suggestions) &&
        Array.isArray(parsed?.strengths) &&
        typeof parsed?.analysis?.extractedText === "string";

      if (!isValid) {
        router.replace("/rfp/intake?mode=upload");
        return;
      }

      setUploadAnalysis(parsed);
    } catch {
      router.replace("/rfp/intake?mode=upload");
    } finally {
      setLoading(false);
    }
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#EFECE3] px-4 py-12">
        <div className="text-center text-[var(--muted)]">Preparing upload review...</div>
      </div>
    );
  }

  if (!uploadAnalysis) {
    return null;
  }

  const handleSaved = () => {
    router.push("/postrfp");
  };

  return (
    <div className="min-h-screen bg-[#EFECE3] px-4 py-8">
      <RfpChatbot initialUploadAnalysis={uploadAnalysis} onSaved={handleSaved} />
    </div>
  );
}

