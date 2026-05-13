import pdfParseModule from "pdf-parse/lib/pdf-parse.js";

const pdfParse = pdfParseModule.default || pdfParseModule;

const backendBase = process.env.BACKEND_BASE_URL || "http://127.0.0.1:8000";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const startedAt = Date.now();

  const payload = {
    organization_name: "Acme Smart Infrastructure Ltd",
    project_title: "Integrated Smart Operations Platform",
    category: "software",
    sections: {
      organization_background: "Acme operates nationwide infrastructure and logistics operations with strict SLA and compliance controls.",
      project_overview: "Deploy a unified platform for operations visibility, workflow orchestration, and vendor performance governance.",
      project_objectives: "Improve uptime, reduce operational variance, and improve procurement transparency through measurable KPIs.",
      scope_of_work: "Include architecture, implementation, migration, training, and support for a multi-region rollout.",
      detailed_project_description: "Deliver a cloud-native control plane with role-based access, API integration, observability, resilience engineering, and compliance evidence tracking.",
      technical_requirements: "High availability, secure API gateways, encrypted storage, audit trails, data lifecycle controls, and CI/CD governance.",
      deliverables: "Technical design, implementation plan, migration runbooks, test packs, operational handbooks, and training assets.",
      vendor_qualifications: "Enterprise implementation track record, certified security professionals, and proven SLA performance.",
      implementation_timeline: "Phased rollout over four quarters with pilot, scale, and optimization stages.",
      budget_framework: "Milestone-based payments with acceptance criteria and contingency reserve.",
      evaluation_criteria: "Weighted model covering technical merit, delivery risk, compliance readiness, and commercial value.",
      risk_management: "Identify technical, integration, security, timeline, and change-management risks with mitigation plans.",
      cybersecurity_compliance: "SOC2, ISO27001 controls, vulnerability management, and incident response expectations.",
      legal_and_contractual: "Data ownership, audit rights, service credits, breach response, and termination support.",
      submission_instructions: "Response format, milestone assumptions, staffing model, and compliance documentation.",
      contact_information: "Procurement Office, Technical Review Board, and Program Management Office details."
    },
    detailed_project_description: "This RFP covers architecture, implementation, governance, quality assurance, operations, change management, and long-term service quality management for a large enterprise rollout.",
    additional_details: "Vendors must include measurable KPIs, acceptance criteria, governance model, and compliance evidence matrix.",
    selected_template: "software",
    selectedSubsystems: ["full"],
    skipDecomposition: true,
    fastMode: true
  };

  const startRes = await fetch(`${backendBase}/api/rfp/generate/background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!startRes.ok) {
    const msg = await startRes.text();
    throw new Error(`Failed to start job: ${startRes.status} ${msg}`);
  }

  const { job_id } = await startRes.json();
  console.log(`Job started: ${job_id}`);

  while (true) {
    await sleep(4000);
    const pollRes = await fetch(`${backendBase}/api/rfp/generate/jobs/${job_id}`);
    if (!pollRes.ok) {
      const msg = await pollRes.text();
      throw new Error(`Polling failed: ${pollRes.status} ${msg}`);
    }

    const pollData = await pollRes.json();
    const job = pollData.job;
    if (!job) throw new Error("Missing job payload");

    const status = job.status;
    const progress = job.progress?.message || "";
    console.log(`status=${status}${progress ? ` | ${progress}` : ""}`);

    if (status === "failed") {
      throw new Error(`Generation failed: ${job.error || "unknown error"}`);
    }

    if (status === "completed") {
      const pdfBase64 = job.pdf_base64;
      if (!pdfBase64) throw new Error("Completed without pdf_base64");

      const pdfBuffer = Buffer.from(pdfBase64, "base64");
      const parsed = await pdfParse(pdfBuffer);
      const durationSec = Math.round((Date.now() - startedAt) / 1000);

      console.log(`PDF_BYTES=${pdfBuffer.length}`);
      console.log(`PDF_PAGES=${parsed.numpages}`);
      console.log(`DURATION_SEC=${durationSec}`);
      return;
    }
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
