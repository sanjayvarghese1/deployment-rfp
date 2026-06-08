import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type PdfReportKind = "proposal-analysis" | "comparison-sheet";
type PdfReportRequest = { kind?: PdfReportKind; data?: any };

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((i) => String(i || "").trim()).filter(Boolean);
}

function scoreColor(score: number, max: number): string {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.75) return "#2e7d5e";
  if (pct >= 0.45) return "#8a6020";
  return "#b03a2e";
}

function scoreBadgeClass(score: number): string {
  if (score >= 75) return "badge-good";
  if (score >= 50) return "badge-warn";
  return "badge-bad";
}

function scoreLabel(score: number): string {
  if (score >= 75) return "Strong";
  if (score >= 50) return "Moderate";
  return "Weak";
}

function confidenceIcon(confidence: string): string {
  if (confidence === "explicit") return "✦";
  if (confidence === "partial") return "◈";
  return "◇";
}

function supportLevelColor(level: string): string {
  if (level === "explicit") return "#2e7d5e";
  if (level === "partial") return "#8a6020";
  return "#b03a2e";
}

function renderScoreBar(score: number, max: number): string {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const col = scoreColor(score, max);
  return `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${col}"></div></div>`;
}

// Vertical bullet list — full width, one per line, no pills
function renderVerticalList(items: unknown[], icon: string, color: string): string {
  const vals = safeList(items);
  if (!vals.length) return '<div class="vlist-empty">None noted</div>';
  return vals.map((v) =>
    `<div class="vlist-item"><span class="vlist-icon" style="color:${color}">${icon}</span><span>${escapeHtml(v)}</span></div>`
  ).join("");
}

// Pill list for metadata only
function renderPills(items: unknown[], tone: "green" | "amber" | "red" | "blue" = "blue"): string {
  const values = safeList(items);
  if (!values.length) return '<span class="muted">None</span>';
  return values.slice(0, 8).map((v) => `<span class="pill pill-${tone}">${escapeHtml(v)}</span>`).join("");
}

function commonStyles(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    :root {
      --bg: #f5f4f1;
      --card: #ffffff;
      --ink: #1a1916;
      --muted: #6e6b65;
      --border: rgba(26,25,22,0.10);
      --primary: #1a5fad;
      --primary-soft: #e8f0fb;
      --success: #2a6e50;
      --success-soft: #e6f2ec;
      --warning: #7a5518;
      --warning-soft: #fdf0e0;
      --danger: #a33428;
      --danger-soft: #fce8e6;
      --rank1: #c9920a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', Arial, sans-serif;
      color: var(--ink);
      background: var(--bg);
      font-size: 11.5px;
      line-height: 1.6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { padding: 20px 24px 28px; }

    /* ── Hero ──────────────────────── */
    .hero {
      background: linear-gradient(130deg, #0d2850 0%, #1a5fad 52%, #2870d4 100%);
      color: white; border-radius: 14px; padding: 24px 26px 20px;
      position: relative; overflow: hidden;
    }
    .hero::after {
      content: ''; position: absolute; right: -50px; top: -50px;
      width: 220px; height: 220px; border-radius: 50%;
      background: rgba(255,255,255,0.04);
    }
    .hero-eyebrow { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.72; font-weight: 700; margin-bottom: 5px; }
    .hero h1 { font-size: 24px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.18; }
    .hero-sub { margin-top: 5px; opacity: 0.80; font-size: 11px; }
    .hero-meta { display: flex; gap: 22px; margin-top: 14px; flex-wrap: wrap; }
    .hero-meta-item { display: flex; flex-direction: column; gap: 2px; }
    .hero-meta-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.14em; opacity: 0.65; font-weight: 600; }
    .hero-meta-value { font-size: 13px; font-weight: 700; }

    /* ── KPI ───────────────────────── */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-top: 12px; }
    .kpi { background: white; border-radius: 11px; padding: 12px 14px; border: 1px solid var(--border); }
    .kpi-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.13em; color: var(--muted); font-weight: 700; }
    .kpi-value { font-size: 20px; font-weight: 900; color: var(--ink); margin-top: 4px; line-height: 1.1; }
    .kpi-sub { font-size: 9.5px; color: var(--muted); margin-top: 4px; }

    /* ── Sections ──────────────────── */
    .section { background: var(--card); border: 1px solid var(--border); border-radius: 13px; padding: 15px 17px; margin-top: 10px; break-inside: avoid; }
    .section-title { font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.09em; color: var(--primary); padding-bottom: 9px; border-bottom: 1px solid var(--border); margin-bottom: 11px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }

    /* ── Vertical bullet list (full-width) ──── */
    .vlist-item { display: flex; gap: 9px; align-items: flex-start; padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 11px; line-height: 1.55; }
    .vlist-item:last-child { border-bottom: none; }
    .vlist-icon { font-size: 13px; font-weight: 900; flex-shrink: 0; margin-top: 1px; }
    .vlist-empty { font-size: 10.5px; color: var(--muted); font-style: italic; }

    /* ── Criterion rows ────────────── */
    .criterion-row { padding: 9px 0; border-bottom: 1px solid var(--border); }
    .criterion-row:last-child { border-bottom: none; }
    .criterion-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .criterion-name { font-weight: 700; font-size: 11px; }
    .criterion-score { font-weight: 900; font-size: 12px; }
    .bar-track { height: 5px; background: #e8e8e4; border-radius: 99px; overflow: hidden; margin: 3px 0; }
    .bar-fill { height: 100%; border-radius: 99px; }
    .criterion-meta { display: flex; gap: 12px; margin-top: 4px; font-size: 9.5px; color: var(--muted); }
    .criterion-reason { font-size: 10.5px; color: #333; margin-top: 4px; font-style: italic; line-height: 1.5; }
    .criterion-evidence { font-size: 10px; color: var(--muted); margin-top: 3px; background: #f5f5f2; padding: 5px 9px; border-radius: 6px; border-left: 2px solid #ccc; line-height: 1.5; }

    /* ── Badges & Pills ────────────── */
    .badge { display: inline-block; padding: 3px 8px; border-radius: 99px; font-weight: 800; font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; }
    .badge-good { background: var(--success-soft); color: var(--success); }
    .badge-warn { background: var(--warning-soft); color: var(--warning); }
    .badge-bad { background: var(--danger-soft); color: var(--danger); }
    .badge-blue { background: var(--primary-soft); color: var(--primary); }
    .pill { display: inline-block; padding: 4px 9px; border-radius: 99px; font-size: 9.5px; font-weight: 600; margin: 2px 4px 2px 0; border: 1px solid transparent; }
    .pill-green { background: var(--success-soft); color: var(--success); border-color: rgba(42,110,80,0.18); }
    .pill-amber { background: var(--warning-soft); color: var(--warning); border-color: rgba(122,85,24,0.18); }
    .pill-red { background: var(--danger-soft); color: var(--danger); border-color: rgba(163,52,40,0.18); }
    .pill-blue { background: var(--primary-soft); color: var(--primary); border-color: rgba(26,95,173,0.18); }

    /* ── Highlight boxes ───────────── */
    .highlight-box { background: linear-gradient(135deg, #e8f0fb 0%, #f0f6ff 100%); border: 1px solid rgba(26,95,173,0.15); border-radius: 11px; padding: 13px 15px; margin-top: 9px; }
    .highlight-box h3 { font-size: 11.5px; font-weight: 800; color: var(--primary); margin-bottom: 7px; }
    .why-item { display: flex; gap: 8px; padding: 4px 0; font-size: 11px; line-height: 1.5; }
    .why-icon { color: var(--success); font-weight: 900; flex-shrink: 0; }
    .tradeoff-item { display: flex; gap: 8px; padding: 4px 0; font-size: 11px; line-height: 1.5; }
    .tradeoff-icon { color: var(--warning); font-weight: 900; flex-shrink: 0; }

    /* ── Comparison-sheet vendor card ── */
    .vendor-card { background: white; border: 1px solid var(--border); border-radius: 13px; padding: 16px 18px; margin-top: 12px; page-break-inside: avoid; }
    .vendor-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
    .vendor-card-name { font-size: 15px; font-weight: 900; letter-spacing: -0.01em; }
    .vendor-card-score { text-align: right; }
    .vendor-card-score-val { font-size: 26px; font-weight: 900; line-height: 1; }
    .vendor-card-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
    .vendor-meta-item .label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-weight: 700; margin-bottom: 2px; }
    .vendor-meta-item .val { font-size: 11.5px; font-weight: 600; }
    .vendor-lists { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .vendor-list-block .list-title { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 2px solid; }
    .vendor-list-block.str .list-title { color: var(--success); border-color: var(--success); }
    .vendor-list-block.wk .list-title { color: var(--warning); border-color: var(--warning); }
    .vendor-list-block.rk .list-title { color: var(--danger); border-color: var(--danger); }
    .vendor-list-item { font-size: 10px; padding: 3px 0; border-bottom: 1px solid rgba(0,0,0,0.05); line-height: 1.45; color: var(--ink); display: flex; gap: 5px; }
    .vendor-list-item:last-child { border-bottom: none; }
    .vendor-list-icon { flex-shrink: 0; font-weight: 900; }

    /* ── Table ─────────────────────── */
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { text-align: left; padding: 8px 10px; background: var(--bg); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.10em; color: var(--muted); font-weight: 700; border-bottom: 2px solid var(--border); }
    td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .rank-1 { border-left: 3px solid var(--rank1); }
    .rank-2 { border-left: 3px solid #aaa; }
    .rank-3 { border-left: 3px solid #b07040; }

    /* ── Summary block ─────────────── */
    .summary-block { font-size: 12px; line-height: 1.72; color: var(--ink); }
    .summary-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    .detail-item { background: var(--bg); border-radius: 9px; padding: 10px 12px; }
    .detail-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-weight: 700; margin-bottom: 4px; }
    .detail-val { font-size: 11px; line-height: 1.55; }

    /* ── Pairwise ──────────────────── */
    .pairwise-row { padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; align-items: flex-start; gap: 12px; font-size: 10.5px; }
    .pairwise-row:last-child { border-bottom: none; }
    .pairwise-winner { font-weight: 800; color: var(--success); }

    /* ── Misc ──────────────────────── */
    .muted { color: var(--muted); }
    .label-sm { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); font-weight: 700; }
    .value-sm { font-size: 11px; font-weight: 600; margin-top: 2px; }
    .winner-banner { background: linear-gradient(130deg, #0d2850 0%, #1a5fad 55%, #2870d4 100%); color: white; border-radius: 13px; padding: 15px 20px; margin-top: 11px; display: flex; justify-content: space-between; align-items: center; }
    .winner-name { font-size: 18px; font-weight: 900; }
    .winner-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em; opacity: 0.72; margin-bottom: 3px; }
    .winner-score { font-size: 30px; font-weight: 900; }
    .footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: var(--muted); }
    .footer-logo { font-weight: 800; font-size: 10px; color: var(--primary); }
    @page { size: A4; margin: 7mm 10mm; }
    @media print { body { background: white; } }
  `;
}

function renderProposalAnalysisHtml(data: any): string {
  const analysis = data?.analysis || {};
  const proposal = data?.proposal || {};
  const contract = data?.contract || {};
  const judgeResult = data?.judge_result || null;

  const vendorName = String(analysis.vendor_name || proposal.vendor_name || "Vendor");
  const contractTitle = String(contract.title || data?.contract_title || "Contract");
  const overallScore = Number(analysis.overall_score ?? 0);
  const recommendation = String(analysis.independent_recommendation || "Not provided");
  const price = String(analysis.price || proposal.price || "Not provided");
  const timeline = String(analysis.timeline || proposal.timeline || "Not provided");
  const priceConf = String(analysis.price_confidence || "");
  const timelineConf = String(analysis.timeline_confidence || "");
  const timelineEvidence = String(analysis.timeline_evidence || "");
  const priceEvidence = String(analysis.price_evidence || "");
  const summary = String(analysis.analysis_summary || "No summary available.");
  const strengths = safeList(analysis.strengths);
  const weaknesses = safeList(analysis.weaknesses);
  const risks = safeList(analysis.risk_flags);
  const generatedAt = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });

  // Scoring criteria
  const criteriaEntries: Array<{ id: string; label: string; score: number; max_score: number; reason: string; evidence: string; support_level: string; confidence?: number }> = [];
  const criterionScores = analysis.criterion_scores || {};
  const scoringCriteria = Array.isArray(analysis.scoring_criteria) ? analysis.scoring_criteria : [];
  if (scoringCriteria.length > 0) {
    for (const sc of scoringCriteria) {
      const id = sc.id || sc.label || "";
      const cs = criterionScores[id] || sc;
      criteriaEntries.push({ id, label: sc.label || id, score: Number(cs.score ?? sc.score ?? 0), max_score: Number(sc.max_score ?? cs.max_score ?? 0), reason: String(cs.reason || sc.reason || ""), evidence: String(cs.evidence || ""), support_level: String(cs.support_level || ""), confidence: cs.confidence });
    }
  } else {
    for (const [id, cs] of Object.entries(criterionScores)) {
      const c = cs as any;
      criteriaEntries.push({ id, label: c.label || id, score: Number(c.score ?? 0), max_score: Number(c.max_score ?? 0), reason: String(c.reason || ""), evidence: String(c.evidence || ""), support_level: String(c.support_level || ""), confidence: c.confidence });
    }
  }

  // Judge data
  const judgeView = judgeResult?.final_recommendation_view || null;
  const judgeComp = judgeResult?.comparative_analysis || null;
  const bestVendor = String(judgeView?.recommended_vendor || judgeComp?.best_vendor || "N/A");
  const whyWon = safeList(judgeView?.why_this_vendor_won);
  const tradeoffs = safeList(judgeView?.key_tradeoffs);
  const judgeHeadline = String(judgeView?.headline || "");
  const judgeSummary = String(judgeView?.summary || judgeComp?.selection_summary || "");
  const ranking = Array.isArray(judgeComp?.ranking) ? judgeComp.ranking : [];
  const topDrivers = safeList(judgeComp?.comparative_reasoning?.top_drivers);
  const isThisVendorBest = vendorName.toLowerCase() === bestVendor.toLowerCase();
  const otherVendors = Array.isArray(judgeView?.other_vendors_snapshot) ? judgeView.other_vendors_snapshot : [];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(vendorName)} – Vendor Analysis</title>
  <style>${commonStyles()}</style>
</head>
<body>
<div class="page">

  <!-- HERO -->
  <div class="hero">
    <div class="hero-eyebrow">Vendor Proposal Analysis Report</div>
    <h1>${escapeHtml(vendorName)}</h1>
    <div class="hero-sub">${escapeHtml(contractTitle)}</div>
    <div class="hero-meta">
      <div class="hero-meta-item"><span class="hero-meta-label">AI Score</span><span class="hero-meta-value">${overallScore}/100</span></div>
      <div class="hero-meta-item"><span class="hero-meta-label">Rating</span><span class="hero-meta-value">${scoreLabel(overallScore)}</span></div>
      <div class="hero-meta-item"><span class="hero-meta-label">Budget</span><span class="hero-meta-value" style="font-size:11px">${escapeHtml(contract.budget || "N/A")}</span></div>
      <div class="hero-meta-item"><span class="hero-meta-label">Generated</span><span class="hero-meta-value" style="font-size:10px">${escapeHtml(generatedAt)}</span></div>
    </div>
  </div>

  <!-- KPI ROW -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Overall Score</div>
      <div class="kpi-value" style="color:${scoreColor(overallScore, 100)}">${overallScore}</div>
      <div class="kpi-sub"><span class="badge ${scoreBadgeClass(overallScore)}">${scoreLabel(overallScore)}</span></div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Quoted Price</div>
      <div class="kpi-value" style="font-size:14px;padding-top:2px">${escapeHtml(price)}</div>
      <div class="kpi-sub">${priceConf ? `${confidenceIcon(priceConf)} ${escapeHtml(priceConf)} confidence` : "Confidence unknown"}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Proposed Timeline</div>
      <div class="kpi-value" style="font-size:13px;padding-top:2px">${escapeHtml(timeline)}</div>
      <div class="kpi-sub">${timelineConf ? `${confidenceIcon(timelineConf)} ${escapeHtml(timelineConf)} confidence` : ""}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Risk Flags</div>
      <div class="kpi-value" style="color:${risks.length === 0 ? "var(--success)" : risks.length <= 2 ? "var(--warning)" : "var(--danger)"}">${risks.length}</div>
      <div class="kpi-sub">${risks.length === 0 ? "No risks detected" : risks.length <= 2 ? "Minor concerns" : "Requires attention"}</div>
    </div>
  </div>

  <!-- EXECUTIVE SUMMARY — full width, detailed -->
  <div class="section">
    <div class="section-title">Executive Summary</div>
    <p class="summary-block">${escapeHtml(summary)}</p>
    <div class="summary-detail-grid">
      <div class="detail-item">
        <div class="detail-label">AI Recommendation</div>
        <div class="detail-val" style="font-weight:600">${escapeHtml(recommendation)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Proposal Type</div>
        <div class="detail-val">${escapeHtml(proposal.proposal_type || "Submitted proposal")}</div>
      </div>
      ${priceEvidence ? `<div class="detail-item">
        <div class="detail-label">Price Evidence (quoted)</div>
        <div class="detail-val" style="font-style:italic">"${escapeHtml(priceEvidence)}"</div>
      </div>` : ""}
      ${timelineEvidence ? `<div class="detail-item">
        <div class="detail-label">Timeline Evidence (quoted)</div>
        <div class="detail-val" style="font-style:italic">"${escapeHtml(timelineEvidence)}"</div>
      </div>` : ""}
      <div class="detail-item">
        <div class="detail-label">Contract Budget</div>
        <div class="detail-val">${escapeHtml(contract.budget || contract.budget_range || "Not provided")}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Contract Deadline</div>
        <div class="detail-val">${escapeHtml(contract.deadline || "Not provided")}</div>
      </div>
      ${contract.required_certifications || contract.certifications ? `<div class="detail-item" style="grid-column:1/-1">
        <div class="detail-label">Required Certifications</div>
        <div class="detail-val">${escapeHtml(contract.required_certifications || contract.certifications)}</div>
      </div>` : ""}
    </div>
  </div>

  <!-- STRENGTHS — full width vertical list -->
  <div class="section">
    <div class="section-title" style="color:var(--success)">✦ Strengths</div>
    ${renderVerticalList(strengths, "✓", "var(--success)")}
  </div>

  <!-- WEAKNESSES — full width vertical list -->
  <div class="section">
    <div class="section-title" style="color:var(--warning)">◈ Weaknesses</div>
    ${renderVerticalList(weaknesses, "−", "var(--warning)")}
  </div>

  <!-- RISK FLAGS — full width vertical list -->
  <div class="section">
    <div class="section-title" style="color:var(--danger)">⚠ Risk Flags</div>
    ${risks.length > 0
      ? renderVerticalList(risks, "!", "var(--danger)")
      : '<div class="vlist-empty">No risk flags identified — this is a positive signal.</div>'
    }
  </div>

  <!-- MANDATORY CRITERIA SCORING -->
  ${criteriaEntries.length > 0 ? `
  <div class="section">
    <div class="section-title">Mandatory Criteria Scoring</div>
    ${criteriaEntries.map((c) => `
      <div class="criterion-row">
        <div class="criterion-header">
          <span class="criterion-name">${escapeHtml(c.label)}</span>
          <span class="criterion-score" style="color:${scoreColor(c.score, c.max_score)}">${c.score} / ${c.max_score}</span>
        </div>
        ${renderScoreBar(c.score, c.max_score)}
        <div class="criterion-meta">
          ${c.support_level ? `<span style="color:${supportLevelColor(c.support_level)};font-weight:700">${confidenceIcon(c.support_level)} ${escapeHtml(c.support_level)}</span>` : ""}
          ${c.confidence != null ? `<span>Confidence: ${Math.round(Number(c.confidence) * 100)}%</span>` : ""}
        </div>
        ${c.reason ? `<div class="criterion-reason">"${escapeHtml(c.reason)}"</div>` : ""}
        ${c.evidence ? `<div class="criterion-evidence">Evidence: ${escapeHtml(c.evidence)}</div>` : ""}
      </div>
    `).join("")}
  </div>` : ""}

  <!-- JUDGE / COMPARATIVE VIEW -->
  ${judgeResult ? `
  <div class="section">
    <div class="section-title">Comparative Analysis — AI Judge</div>
    ${judgeHeadline ? `<div style="font-size:13px;font-weight:800;margin-bottom:8px">${escapeHtml(judgeHeadline)}</div>` : ""}
    <div style="font-size:11.5px;line-height:1.68;margin-bottom:12px">${escapeHtml(judgeSummary)}</div>

    ${isThisVendorBest ? `
    <div class="highlight-box">
      <h3>⭐ Recommended Vendor</h3>
      <div style="font-size:10.5px;margin-bottom:8px">This vendor was selected as the top recommendation.</div>
      ${whyWon.length ? `<div class="label-sm" style="margin-bottom:6px">Why This Vendor Won</div>${whyWon.map((w) => `<div class="why-item"><span class="why-icon">✓</span><span>${escapeHtml(w)}</span></div>`).join("")}` : ""}
    </div>` : ""}

    ${tradeoffs.length ? `
    <div style="margin-top:12px">
      <div class="label-sm" style="margin-bottom:6px">Key Tradeoffs</div>
      ${tradeoffs.map((t) => `<div class="tradeoff-item"><span class="tradeoff-icon">⚡</span><span>${escapeHtml(t)}</span></div>`).join("")}
    </div>` : ""}

    ${topDrivers.length ? `
    <div style="margin-top:12px">
      <div class="label-sm" style="margin-bottom:6px">Decision Drivers</div>
      ${renderPills(topDrivers, "blue")}
    </div>` : ""}

    ${ranking.length > 1 ? `
    <div style="margin-top:14px">
      <div class="label-sm" style="margin-bottom:8px">Full Vendor Ranking</div>
      <table>
        <thead><tr><th>#</th><th>Vendor</th><th>Score</th><th>Recommendation</th><th>Notes</th></tr></thead>
        <tbody>
          ${ranking.map((r: any, i: number) => `
          <tr class="${i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : ""}">
            <td><strong>${i + 1}</strong></td>
            <td><strong>${escapeHtml(r.vendor_name || "")}</strong>${r.vendor_name?.toLowerCase() === vendorName.toLowerCase() ? ' <span class="badge badge-blue">This vendor</span>' : ""}</td>
            <td><span style="color:${scoreColor(r.final_score ?? 0, 100)};font-weight:800">${r.final_score ?? "–"}</span></td>
            <td>${escapeHtml(r.comparative_recommendation || "")}</td>
            <td style="color:var(--muted)">${escapeHtml(r.why || "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    ${otherVendors.length > 0 ? `
    <div style="margin-top:12px">
      <div class="label-sm" style="margin-bottom:6px">Other Vendor Snapshots</div>
      ${otherVendors.map((v: any) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-weight:700">${escapeHtml(v.vendor_name)}</span>
        <span class="badge badge-blue" style="margin-left:6px">${escapeHtml(v.label)}</span>
        <span style="margin-left:6px;font-weight:700">${v.score ?? "–"}/100</span>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${escapeHtml(v.note)}</div>
      </div>`).join("")}
    </div>` : ""}
  </div>` : ""}

  <!-- FOOTER -->
  <div class="footer">
    <span class="footer-logo">AI-Powered Procurement Analysis</span>
    <span>${escapeHtml(vendorName)} · ${escapeHtml(contractTitle)} · ${escapeHtml(generatedAt)}</span>
  </div>

</div>
</body>
</html>`;
}

function renderComparisonSheetHtml(data: any): string {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const contractTitle = String(data?.contractTitle || "Consolidated Vendor Comparison");
  const contractBudget = String(data?.contractBudget || "Not provided");
  const contractDeadline = String(data?.contractDeadline || "Not provided");
  const bestVendor = String(data?.bestVendor || "N/A");
  const summary = String(data?.summary || "");
  const decisionNotes = String(data?.decisionNotes || "");
  const judgeResult = data?.judgeResult || null;

  const ranking: any[] = Array.isArray(judgeResult?.comparative_analysis?.ranking) ? judgeResult.comparative_analysis.ranking : [];
  const whyWon = safeList(judgeResult?.final_recommendation_view?.why_this_vendor_won);
  const keyTradeoffs = safeList(judgeResult?.final_recommendation_view?.key_tradeoffs);
  const topDrivers = safeList(judgeResult?.comparative_analysis?.comparative_reasoning?.top_drivers);
  const tradeoffsList = safeList(judgeResult?.comparative_analysis?.comparative_reasoning?.tradeoffs);
  const pairwise: any[] = Array.isArray(judgeResult?.comparative_analysis?.comparative_reasoning?.pairwise_comparisons)
    ? judgeResult.comparative_analysis.comparative_reasoning.pairwise_comparisons : [];
  const headline = String(judgeResult?.final_recommendation_view?.headline || "");
  const generatedAt = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });

  const sortedRows = [...rows].sort((a, b) => Number(b.final_score ?? 0) - Number(a.final_score ?? 0));

  // Build ranking map for medal order
  const rankMap = new Map<string, number>();
  sortedRows.forEach((r, i) => rankMap.set(String(r.vendor_name || "").toLowerCase(), i));

  function medalBorderStyle(vendorNameStr: string): string {
    const i = rankMap.get(vendorNameStr.toLowerCase()) ?? 99;
    if (i === 0) return "border-left:4px solid var(--rank1);";
    if (i === 1) return "border-left:4px solid #999;";
    if (i === 2) return "border-left:4px solid #b07040;";
    return "";
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Vendor Comparison – ${escapeHtml(contractTitle)}</title>
  <style>${commonStyles()}</style>
</head>
<body>
<div class="page">

  <!-- HERO -->
  <div class="hero">
    <div class="hero-eyebrow">Consolidated Vendor Comparison Sheet</div>
    <h1>${escapeHtml(contractTitle)}</h1>
    <div class="hero-sub">AI-powered multi-vendor evaluation · ${sortedRows.length} proposals analyzed</div>
    <div class="hero-meta">
      <div class="hero-meta-item"><span class="hero-meta-label">Budget</span><span class="hero-meta-value">${escapeHtml(contractBudget)}</span></div>
      <div class="hero-meta-item"><span class="hero-meta-label">Deadline</span><span class="hero-meta-value">${escapeHtml(contractDeadline)}</span></div>
      <div class="hero-meta-item"><span class="hero-meta-label">Vendors Evaluated</span><span class="hero-meta-value">${sortedRows.length}</span></div>
      <div class="hero-meta-item"><span class="hero-meta-label">Generated</span><span class="hero-meta-value" style="font-size:10px">${escapeHtml(generatedAt)}</span></div>
    </div>
  </div>

  <!-- WINNER BANNER -->
  ${bestVendor !== "N/A" ? `
  <div class="winner-banner">
    <div>
      <div class="winner-label">🏆 Recommended Vendor</div>
      <div class="winner-name">${escapeHtml(bestVendor)}</div>
      ${headline ? `<div style="font-size:10.5px;margin-top:4px;opacity:0.85">${escapeHtml(headline)}</div>` : ""}
    </div>
    ${(() => { const w = sortedRows.find((r: any) => r.vendor_name?.toLowerCase() === bestVendor.toLowerCase()); return w ? `<div style="text-align:right"><div class="winner-label">AI Score</div><div class="winner-score">${w.final_score ?? "–"}</div><div style="font-size:9.5px;opacity:0.75">out of 100</div></div>` : ""; })()}
  </div>` : ""}

  <!-- SELECTION SUMMARY — big and readable -->
  ${summary ? `
  <div class="section">
    <div class="section-title">Selection Summary</div>
    <p style="font-size:12.5px;line-height:1.78;color:var(--ink)">${escapeHtml(summary)}</p>
    ${topDrivers.length ? `<div style="margin-top:12px"><div class="label-sm" style="margin-bottom:6px">Key Decision Drivers</div><div style="display:flex;flex-wrap:wrap;gap:6px">${renderPills(topDrivers, "blue")}</div></div>` : ""}
  </div>` : ""}

  <!-- WHY WON + TRADEOFFS — side by side -->
  ${(whyWon.length > 0 || keyTradeoffs.length > 0) ? `
  <div class="two-col">
    ${whyWon.length ? `
    <div class="section" style="margin-top:0">
      <div class="section-title" style="color:var(--success)">✦ Why ${escapeHtml(bestVendor)} Was Selected</div>
      ${whyWon.map((w) => `<div class="why-item"><span class="why-icon">✓</span><span>${escapeHtml(w)}</span></div>`).join("")}
    </div>` : ""}
    ${keyTradeoffs.length ? `
    <div class="section" style="margin-top:0">
      <div class="section-title" style="color:var(--warning)">⚡ Key Tradeoffs</div>
      ${keyTradeoffs.map((t) => `<div class="tradeoff-item"><span class="tradeoff-icon">⚡</span><span>${escapeHtml(t)}</span></div>`).join("")}
    </div>` : ""}
  </div>` : ""}

  <!-- SCORE RANKING OVERVIEW TABLE (compact) -->
  <div class="section">
    <div class="section-title">Ranking Overview</div>
    <table>
      <thead>
        <tr>
          <th style="width:24px">#</th>
          <th>Vendor</th>
          <th style="width:60px">Score</th>
          <th>AI Recommendation</th>
          <th>Price</th>
          <th>Timeline</th>
        </tr>
      </thead>
      <tbody>
        ${sortedRows.map((row: any, i: number) => {
          const isBest = row.vendor_name?.toLowerCase() === bestVendor.toLowerCase();
          const score = row.final_score ?? row.score ?? 0;
          return `
          <tr class="${i === 0 ? "rank-1" : i === 1 ? "rank-2" : i === 2 ? "rank-3" : ""}">
            <td><strong>${i + 1}</strong></td>
            <td><strong>${escapeHtml(row.vendor_name || "Vendor")}</strong>${isBest ? ' <span class="badge badge-good">Recommended</span>' : ""}</td>
            <td><span style="font-size:15px;font-weight:900;color:${scoreColor(score, 100)}">${score}</span></td>
            <td style="font-size:10px">${escapeHtml(row.comparative_recommendation || row.independent_recommendation || "–")}</td>
            <td style="font-weight:600">${escapeHtml(row.price || "–")}</td>
            <td style="color:var(--muted)">${escapeHtml(row.timeline || "–")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>

  <!-- INDIVIDUAL VENDOR CARDS — one per vendor, with full vertical lists -->
  ${sortedRows.map((row: any, i: number) => {
    const isBest = row.vendor_name?.toLowerCase() === bestVendor.toLowerCase();
    const score = row.final_score ?? row.score ?? 0;
    const strengths = safeList(row.strengths);
    const weaknesses = safeList(row.weaknesses);
    const risks = safeList(row.risk_flags);
    const rankRec = ranking.find((r: any) => r.vendor_name?.toLowerCase() === (row.vendor_name || "").toLowerCase());
    const why = String(rankRec?.why || "");

    return `
    <div class="vendor-card" style="${medalBorderStyle(row.vendor_name || "")}">
      <div class="vendor-card-header">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:3px">Vendor ${i + 1}</div>
          <div class="vendor-card-name">${escapeHtml(row.vendor_name || "Vendor")}</div>
          ${isBest ? '<div style="margin-top:5px"><span class="badge badge-good">🏆 Recommended</span></div>' : ""}
        </div>
        <div class="vendor-card-score">
          <div class="winner-label" style="color:var(--muted)">AI Score</div>
          <div class="vendor-card-score-val" style="color:${scoreColor(score, 100)}">${score}</div>
          <div><span class="badge ${scoreBadgeClass(score)}">${scoreLabel(score)}</span></div>
        </div>
      </div>

      <!-- Metadata row -->
      <div class="vendor-card-meta">
        <div class="vendor-meta-item"><div class="label">Price</div><div class="val">${escapeHtml(row.price || "Not provided")}</div></div>
        <div class="vendor-meta-item"><div class="label">Timeline</div><div class="val">${escapeHtml(row.timeline || "Not provided")}</div></div>
        <div class="vendor-meta-item"><div class="label">Recommendation</div><div class="val" style="font-size:10.5px">${escapeHtml(row.comparative_recommendation || row.independent_recommendation || "–")}</div></div>
      </div>

      ${why ? `<div style="font-size:10.5px;color:var(--muted);margin-bottom:12px;font-style:italic;padding:8px 10px;background:var(--bg);border-radius:8px">${escapeHtml(why)}</div>` : ""}

      <!-- Strengths — full vertical list -->
      <div style="margin-bottom:12px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:var(--success);margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid var(--success)">✦ Strengths</div>
        ${strengths.length > 0
          ? strengths.map((s) => `<div class="vlist-item"><span class="vlist-icon" style="color:var(--success)">✓</span><span>${escapeHtml(s)}</span></div>`).join("")
          : '<div class="vlist-empty">None noted</div>'
        }
      </div>

      <!-- Weaknesses — full vertical list -->
      <div style="margin-bottom:12px">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:var(--warning);margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid var(--warning)">◈ Weaknesses</div>
        ${weaknesses.length > 0
          ? weaknesses.map((w) => `<div class="vlist-item"><span class="vlist-icon" style="color:var(--warning)">−</span><span>${escapeHtml(w)}</span></div>`).join("")
          : '<div class="vlist-empty">None noted</div>'
        }
      </div>

      <!-- Risk Flags — full vertical list -->
      <div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:var(--danger);margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid var(--danger)">⚠ Risk Flags</div>
        ${risks.length > 0
          ? risks.map((r) => `<div class="vlist-item"><span class="vlist-icon" style="color:var(--danger)">!</span><span>${escapeHtml(r)}</span></div>`).join("")
          : '<div class="vlist-empty" style="color:var(--success)">✓ No risk flags identified</div>'
        }
      </div>
    </div>`;
  }).join("")}

  <!-- PAIRWISE COMPARISONS -->
  ${pairwise.length > 0 ? `
  <div class="section">
    <div class="section-title">Head-to-Head Comparisons</div>
    ${pairwise.map((p: any) => `
      <div class="pairwise-row">
        <div style="flex-shrink:0;min-width:180px;font-weight:600">
          ${escapeHtml(p.a)} <span style="color:var(--muted);font-weight:400;margin:0 5px">vs</span> ${escapeHtml(p.b)}
        </div>
        <div style="flex-shrink:0;min-width:100px">
          Winner: <span class="pairwise-winner">${escapeHtml(p.winner === "tie" ? "Tie" : p.winner || "–")}</span>
        </div>
        <div style="color:var(--muted);font-size:10px">
          ${safeList(p.reasons).map((r) => `· ${escapeHtml(r)}`).join("  ")}
        </div>
      </div>
    `).join("")}
  </div>` : ""}

  <!-- DECISION NOTES -->
  ${(decisionNotes || tradeoffsList.length > 0) ? `
  <div class="section">
    <div class="section-title">Decision Notes</div>
    ${decisionNotes ? `<p style="font-size:12px;line-height:1.72;margin-bottom:${tradeoffsList.length ? "12px" : "0"}">${escapeHtml(decisionNotes)}</p>` : ""}
    ${tradeoffsList.length ? `<div class="label-sm" style="margin-bottom:6px">Comparative Tradeoffs</div>${tradeoffsList.map((t) => `<div class="tradeoff-item"><span class="tradeoff-icon">⚡</span><span>${escapeHtml(t)}</span></div>`).join("")}` : ""}
  </div>` : ""}

  <!-- FOOTER -->
  <div class="footer">
    <span class="footer-logo">AI-Powered Procurement Analysis</span>
    <span>${escapeHtml(contractTitle)} · ${sortedRows.length} vendors · ${escapeHtml(generatedAt)}</span>
  </div>

</div>
</body>
</html>`;
}

async function convertHtmlToPdf(html: string): Promise<Buffer> {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) throw new Error("PDFSHIFT_API_KEY is missing");
  const sandboxEnv = (process.env.PDFSHIFT_SANDBOX || "").trim().toLowerCase();
  const sandbox = sandboxEnv === "true" ? true : sandboxEnv === "false" ? false : process.env.NODE_ENV !== "production";

  const response = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey, "X-Processor-Version": "142" },
    body: JSON.stringify({
      source: html, format: "A4", sandbox, remove_blank: true,
      wait_for_network: false, disable_javascript: false,
      margin: { top: "7mm", right: "10mm", bottom: "7mm", left: "10mm" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "PDFShift conversion failed");
    throw new Error(errorText || `PDFShift conversion failed with status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PdfReportRequest;
    const kind = body.kind;
    const data = body.data || {};
    const format = (body as any).format || "pdf";

    const html = kind === "comparison-sheet" ? renderComparisonSheetHtml(data) : renderProposalAnalysisHtml(data);

    if (format === "html") {
      return new NextResponse(html, {
        status: 200,
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
      });
    }

    const apiKey = process.env.PDFSHIFT_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "PDFSHIFT_API_KEY_MISSING", message: "PDFShift API key is not configured on the server." },
        { status: 412 }
      );
    }

    const pdf = await convertHtmlToPdf(html);
    const filename = kind === "comparison-sheet" ? "comparison-sheet.pdf" : "vendor-analysis-report.pdf";
    return new NextResponse(pdf, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to render PDF";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
