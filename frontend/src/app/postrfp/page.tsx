"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PostRfpPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/rfp");
  }, [router]);

  return null;
}
