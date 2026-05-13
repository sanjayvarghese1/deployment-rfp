import { NextRequest, NextResponse } from "next/server";
import { extractPdfTextWithOcrFallback } from "@/lib/pdfExtraction";

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

    let extraction;
    try {
      extraction = await extractPdfTextWithOcrFallback(buffer, { minTextChars: 60, maxOcrPages: 20 });
      console.log(`[API] PDF extracted using ${extraction.method} with ${extraction.text.length} chars across ${extraction.pageCount} pages`);
    } catch (parseErr) {
      console.error("[API] PDF extraction error:", parseErr);
      return NextResponse.json(
        { error: `PDF extraction failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}` },
        { status: 500 }
      );
    }

    const extractedText = extraction.text;
    const pageCount = extraction.pageCount;

    // Extract clean text from all pages
    const fileName = pdfUrl.split("/").pop() || "proposal.pdf";

    // If text is too short, log warning
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
        extraction_method: extraction.method,
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
