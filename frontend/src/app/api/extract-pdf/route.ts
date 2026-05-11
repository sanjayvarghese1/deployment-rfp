import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export const runtime = "nodejs";

/**
 * Extract text from a PDF file by URL.
 * Uses pdf-parse (v1) for reliable Node runtime extraction.
 */
export async function POST(request: NextRequest) {
  try {
    console.log("[API] /api/extract-pdf called");
    
    let body: { pdfUrl?: string };
    try {
      body = await request.json();
    } catch (parseErr) {
      console.error("[API] Failed to parse request body:", parseErr);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { pdfUrl } = body;

    if (!pdfUrl || typeof pdfUrl !== "string") {
      console.error("[API] Missing or invalid pdfUrl:", pdfUrl);
      return NextResponse.json(
        { error: "Missing or invalid pdfUrl" },
        { status: 400 }
      );
    }

    console.log(`[API] Processing PDF: ${pdfUrl}`);

    // Fetch the PDF from the URL
    let response: Response;
    try {
      response = await fetch(pdfUrl);
      console.log(`[API] Fetch response status: ${response.status}`);
    } catch (fetchErr) {
      console.error("[API] Failed to fetch PDF URL:", fetchErr);
      return NextResponse.json(
        { error: `Failed to fetch PDF: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}` },
        { status: 400 }
      );
    }

    if (!response.ok) {
      console.error(`[API] PDF fetch failed with status ${response.status}: ${response.statusText}`);
      return NextResponse.json(
        { error: `Failed to fetch PDF: ${response.statusText}` },
        { status: 400 }
      );
    }

    // Get the PDF buffer
    let buffer: Buffer;
    try {
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      console.log(`[API] PDF buffer size: ${buffer.byteLength} bytes`);
    } catch (bufferErr) {
      console.error("[API] Failed to create buffer:", bufferErr);
      return NextResponse.json(
        { error: "Failed to process PDF data" },
        { status: 500 }
      );
    }

    // Import pdf-parse for server-side extraction
    let pdfParse: any;
    try {
      // pdf-parse v1 is CommonJS, so load it via require.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pdfParse = require("pdf-parse");
      console.log("[API] pdf-parse loaded successfully");
    } catch (importErr) {
      console.error("[API] Failed to import pdf-parse:", importErr);
      return NextResponse.json(
        { error: "PDF parser not available" },
        { status: 500 }
      );
    }

    // Parse PDF and extract text
    let extractedText = "";
    let pageCount = 0;
    try {
      const parsed = await pdfParse(buffer);
      extractedText = (parsed?.text || "").trim();
      pageCount = Number(parsed?.numpages || 0);

      console.log(`[API] PDF parsed successfully: ${pageCount} pages, ${extractedText.length} chars`);
    } catch (parseErr) {
      console.error("[API] PDF parsing error:", parseErr);
      return NextResponse.json(
        { error: `PDF parsing failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}` },
        { status: 500 }
      );
    }

    // Extract clean text from all pages
    const fileName = pdfUrl.split("/").pop() || "proposal.pdf";

    // If text is too short, log warning
    if (!extractedText || extractedText.length < 50) {
      console.warn(`[API] Warning: Extracted text very short (${extractedText.length} chars)`);
    }

    // Ensure we have some extracted text
    if (!extractedText || extractedText.length === 0) {
      console.warn("[API] PDF extraction resulted in empty text");
      return NextResponse.json(
        { error: "PDF contains no extractable text (possible image-only or encrypted PDF)" },
        { status: 400 }
      );
    }

    console.log(`[API] Extraction successful: ${extractedText.length} chars extracted`);

    return NextResponse.json(
      {
        success: true,
        extracted_text: extractedText,
        file_size: buffer.byteLength,
        page_count: pageCount,
        file_name: fileName,
        text_length: extractedText.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[API] Unexpected error in /api/extract-pdf:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `PDF extraction failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
