import { NextRequest, NextResponse } from "next/server";

interface PostRfpRequest {
  metadata: {
    organization_name: string;
    project_title: string;
    category: string;
    date: string;
  };
  sections: Record<string, string>;
  pdfBase64?: string;
  uploadedFileName?: string;
}

interface PostRfpResponse {
  success: boolean;
  rfpId: string;
  message: string;
}

/**
 * Direct post endpoint for saving RFPs without full generation
 * Used when user chooses to post an uploaded/existing RFP directly
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as PostRfpRequest;

    // Validate required fields
    if (!body.metadata?.organization_name || !body.metadata?.project_title) {
      return NextResponse.json(
        { error: "Missing required metadata fields" },
        { status: 400 }
      );
    }

    if (!body.sections || Object.keys(body.sections).length === 0) {
      return NextResponse.json(
        { error: "No sections provided" },
        { status: 400 }
      );
    }

    // Generate a unique RFP ID
    const rfpId = `rfp_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // In a real implementation, you would:
    // 1. Save to database
    // 2. Store the PDF if provided
    // 3. Create necessary records for the workflow

    // For now, return a success response with the RFP ID
    const response: PostRfpResponse = {
      success: true,
      rfpId,
      message: `RFP "${body.metadata.project_title}" has been posted successfully`,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Direct post failed:", error);
    return NextResponse.json(
      {
        error: "Failed to post RFP",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
