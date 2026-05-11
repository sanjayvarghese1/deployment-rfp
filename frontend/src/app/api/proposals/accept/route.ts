import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

// Configure email transporter
function getMailTransporter() {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { vendorEmail, vendorName, contractTitle, acceptedByName, price, timeline } = await req.json();

    if (!vendorEmail || !contractTitle) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Send email to accepted vendor (if email config is available)
    let emailSent = false;
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        const transporter = getMailTransporter();
        await transporter.sendMail({
          from: `"${acceptedByName || "HackUs Platform"}" <${process.env.EMAIL_USER}>`,
          to: vendorEmail,
          subject: `Proposal Accepted - ${contractTitle}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #059669, #10b981); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 24px;">Proposal Accepted!</h1>
              </div>
              <div style="background: #f0fdf4; padding: 24px; border: 1px solid #bbf7d0; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="color: #166534; font-size: 16px; margin-top: 0;">
                  Congratulations, <strong>${vendorName || "Vendor"}</strong>!
                </p>
                <p style="color: #15803d;">
                  Your proposal for <strong>"${contractTitle}"</strong> has been accepted by <strong>${acceptedByName}</strong>.
                </p>
                <div style="background: white; padding: 16px; border-radius: 8px; margin: 16px 0; border: 1px solid #dcfce7;">
                  <p style="margin: 0 0 8px 0; color: #374151;"><strong>Contract:</strong> ${contractTitle}</p>
                  ${price ? `<p style="margin: 0 0 8px 0; color: #374151;"><strong>Your Price:</strong> $${price}</p>` : ""}
                  ${timeline ? `<p style="margin: 0; color: #374151;"><strong>Timeline:</strong> ${timeline}</p>` : ""}
                </div>
                <p style="color: #15803d;">
                  Please log in to the platform to discuss next steps with the contract owner.
                </p>
                <div style="text-align: center; margin-top: 24px;">
                  <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/messages" 
                     style="background: #059669; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
                    View Messages
                  </a>
                </div>
              </div>
            </div>
          `,
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("Email sending failed:", emailErr);
      }
    }

    return NextResponse.json({ success: true, emailSent });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Accept proposal email error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
