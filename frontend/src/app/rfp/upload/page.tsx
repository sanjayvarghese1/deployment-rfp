"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RfpUploadPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/rfp/intake?mode=upload");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#EFECE3] px-4 py-12">
      <div className="text-center text-[var(--muted)]">Redirecting to upload intake...</div>
    </div>
  );
}