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

async function fallbackToHtmlPrint(request: PdfReportRequest): Promise<void> {
  const response = await fetch(apiUrl("/api/pdf/render"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, format: "html" }),
  });

  if (!response.ok) {
    throw new Error("Failed to retrieve HTML for fallback printing.");
  }

  const htmlText = await response.text();
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Popup blocked. Please allow popups to download/print this report.");
  }

  printWindow.document.write(htmlText);
  printWindow.document.close();

  // Add auto-print script to the new window
  const printScript = printWindow.document.createElement("script");
  printScript.innerHTML = `
    window.addEventListener('load', () => {
      // Add a small delay for styling/fonts
      setTimeout(() => {
        window.print();
      }, 500);
    });
  `;
  printWindow.document.body.appendChild(printScript);
}

export async function downloadPdfReport(request: PdfReportRequest, filename: string): Promise<void> {
  try {
    const response = await fetch(apiUrl("/api/pdf/render"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      if (response.status === 412) {
        alert("The PDF conversion service is not configured on the server. Falling back to browser print (select 'Save as PDF' as the destination).");
        await fallbackToHtmlPrint(request);
        return;
      }
      const errorText = await response.text().catch(() => "PDF export failed");
      throw new Error(errorText || "PDF export failed");
    }

    const blob = await response.blob();
    triggerDownload(blob, filename);
  } catch (error) {
    console.warn("PDF generation failed, trying HTML fallback:", error);
    try {
      alert("PDF conversion service is unavailable. Opening print-friendly view in a new tab...");
      await fallbackToHtmlPrint(request);
    } catch (fallbackError) {
      throw new Error("PDF export and fallback print failed: " + (error instanceof Error ? error.message : String(error)));
    }
  }
}
