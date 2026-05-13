import { Suspense } from "react";
import InsightsPageClient from "./InsightsPageClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--muted)]">Loading insights...</div>}>
      <InsightsPageClient />
    </Suspense>
  );
}

