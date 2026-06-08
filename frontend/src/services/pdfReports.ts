import { apiUrl } from "@/lib/api";

type PdfReportKind = "proposal-analysis" | "comparison-sheet";

type PdfReportRequest = {
  kind: PdfReportKind;
  data: unknown;
};

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadPdfReport(request: PdfReportRequest, filename: string): Promise<void> {
  const response = await fetch(apiUrl("/api/pdf/render"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "PDF export failed");
    throw new Error(errorText || "PDF export failed");
  }

  const blob = await response.blob();
  triggerDownload(blob, filename);
}
