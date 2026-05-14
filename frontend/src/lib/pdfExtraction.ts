type ExtractionOptions = {
  minTextChars?: number;
  maxOcrPages?: number;
};

export type PdfExtractionResult = {
  text: string;
  pageCount: number;
  method: "pdf-parse";
};

export async function extractPdfTextWithOcrFallback(
  pdfBuffer: Buffer,
  _options: ExtractionOptions = {}
): Promise<PdfExtractionResult> {
  let pdfParse: any = null;

  try {
    // Use the internal parser entrypoint to avoid pdf-parse's package-level
    // example code that tries to read ./test/data/05-versions-space.pdf.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pdfParse = require("pdf-parse/lib/pdf-parse.js");
  } catch {
    try {
      // Fallback for environments where the internal path is unavailable.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParseModule = require("pdf-parse");
      pdfParse = pdfParseModule?.default || pdfParseModule;
    } catch (error) {
      throw new Error(`PDF parser unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const parsed = await pdfParse(pdfBuffer);

  return {
    text: (parsed?.text || "").trim(),
    pageCount: Number(parsed?.numpages || 0),
    method: "pdf-parse",
  };
}
