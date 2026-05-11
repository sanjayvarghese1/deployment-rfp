"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
 
// Keep the legacy route as a redirect to the old intake path so the UI entry stays consistent.

export default function RfpUploadIntakePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/rfp/intake?mode=upload");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#EFECE3] px-4 py-12">
      <div className="text-center text-[var(--muted)]">Redirecting to the intake path...</div>
    </div>
  );
}