import { NextRequest, NextResponse } from "next/server";
import { generateRfpPdf } from "@/lib/rfp/pdf";
import type { PdfTemplate } from "@/lib/rfp/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const metadata = body.metadata as { organization_name: string; project_title: string; category: string; date: string } | undefined;
    const sections = body.sections as Record<string, string> | undefined;
    const template = body.template as PdfTemplate | undefined;

    if (!metadata?.organization_name || !metadata?.project_title || !metadata?.category || !metadata?.date) {
      return NextResponse.json({ error: "metadata is required" }, { status: 400 });
    }

    if (!sections || typeof sections !== "object") {
      return NextResponse.json({ error: "sections are required" }, { status: 400 });
    }

    const pdf = await generateRfpPdf(metadata, sections, template || "software");
    const pdfBase64 = Buffer.from(pdf).toString("base64");

    return NextResponse.json({ pdfBase64 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Failed to render PDF" }, { status: 500 });
  }
}