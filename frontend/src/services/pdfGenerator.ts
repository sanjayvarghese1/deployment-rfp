import jsPDF from "jspdf";
import type { ProposalSections } from "./aiService";
import type { ChartData } from "./aiService";

/* ═══════════════════════════════════════════════════════════ */
/*                  TEMPLATE THEME SYSTEM                      */
/* ═══════════════════════════════════════════════════════════ */

export type TemplateName = "executive" | "modern" | "classic" | "minimal";

type RGB = [number, number, number];

interface ThemeColors {
  primary: RGB; primaryDark: RGB; accent: RGB;
  text: RGB; textMuted: RGB; sectionBg: RGB;
  white: RGB; border: RGB;
  success: RGB; warning: RGB; danger: RGB;
}

const THEMES: Record<TemplateName, { colors: ThemeColors; headerStyle: "gradient" | "sidebar" | "border" | "clean" }> = {
  executive: {
    colors: {
      primary: [37,99,235], primaryDark: [30,64,175], accent: [124,58,237],
      text: [15,23,42], textMuted: [100,116,139], sectionBg: [241,245,249],
      white: [239,236,227], border: [203,213,225],
      success: [34,197,94], warning: [245,158,11], danger: [239,68,68],
    },
    headerStyle: "gradient",
  },
  modern: {
    colors: {
      primary: [6,182,212], primaryDark: [8,145,178], accent: [236,72,153],
      text: [15,23,42], textMuted: [71,85,105], sectionBg: [240,253,250],
      white: [239,236,227], border: [167,243,208],
      success: [16,185,129], warning: [251,191,36], danger: [244,63,94],
    },
    headerStyle: "sidebar",
  },
  classic: {
    colors: {
      primary: [120,53,15], primaryDark: [69,26,3], accent: [161,98,7],
      text: [28,25,23], textMuted: [120,113,108], sectionBg: [250,250,249],
      white: [239,236,227], border: [214,211,209],
      success: [22,163,74], warning: [202,138,4], danger: [185,28,28],
    },
    headerStyle: "border",
  },
  minimal: {
    colors: {
      primary: [39,39,42], primaryDark: [24,24,27], accent: [99,102,241],
      text: [24,24,27], textMuted: [113,113,122], sectionBg: [250,250,250],
      white: [239,236,227], border: [228,228,231],
      success: [34,197,94], warning: [234,179,8], danger: [239,68,68],
    },
    headerStyle: "clean",
  },
};

export const TEMPLATE_OPTIONS: { key: TemplateName; label: string; desc: string }[] = [
  { key: "executive", label: "Executive", desc: "Corporate blue & violet, gradient headers" },
  { key: "modern",    label: "Modern",    desc: "Teal & pink, sidebar-style layout" },
  { key: "classic",   label: "Classic",   desc: "Warm brown tones, bordered design" },
  { key: "minimal",   label: "Minimal",   desc: "Clean monochrome, subtle accents" },
];

/* ─── chart palette ─── */
const PALETTE = ["#3B82F6","#8B5CF6","#06B6D4","#10B981","#F59E0B","#EF4444","#EC4899","#6366F1","#14B8A6","#F97316"];
function hexRgb(h: string): RGB { const c = h.replace("#",""); return [parseInt(c.substring(0,2),16),parseInt(c.substring(2,4),16),parseInt(c.substring(4,6),16)]; }

export interface ProposalPDFInput {
  title: string;
  vendorName: string;
  contractTitle: string;
  totalPrice: string;
  timeline: string;
  sections: ProposalSections;
  sectionLabels: Record<keyof ProposalSections, string>;
  template?: TemplateName;
  chartData?: ChartData | null;
  executiveSummary?: string;
}

/* ═══════════════════════════════════════════════════════════ */
/*                CHART DRAWING HELPERS                        */
/* ═══════════════════════════════════════════════════════════ */

function drawBarChart(doc: jsPDF, items: { label: string; value: number; color?: string }[], x: number, y: number, w: number, h: number, title: string, C: ThemeColors) {
  if (!items.length) return y;
  doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text(title, x, y); y += 6;
  const barH = h - 20;
  const max = Math.max(...items.map(i => i.value), 1);
  const bw = Math.min((w - 10) / items.length - 4, 28);
  const gap = (w - bw * items.length) / (items.length + 1);
  doc.setDrawColor(...C.border); doc.setLineWidth(0.3);
  doc.line(x, y + barH, x + w, y + barH);
  for (let g = 0; g < 4; g++) {
    const gy = y + barH - (barH * (g + 1)) / 4;
    doc.setDrawColor(230,230,230); doc.setLineWidth(0.15); doc.line(x, gy, x + w, gy);
    doc.setFontSize(6); doc.setTextColor(...C.textMuted);
    doc.text(Math.round((max * (g + 1)) / 4).toLocaleString(), x - 2, gy + 1.5, { align: "right" });
  }
  items.forEach((it, i) => {
    const bH = (it.value / max) * barH;
    const bx = x + gap + i * (bw + gap);
    const by = y + barH - bH;
    const c = it.color ? hexRgb(it.color) : hexRgb(PALETTE[i % PALETTE.length]);
    doc.setFillColor(...c); doc.roundedRect(bx, by, bw, bH, 1, 1, "F");
    doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(...C.text);
    doc.text(`$${it.value.toLocaleString()}`, bx + bw / 2, by - 2, { align: "center" });
    doc.setFontSize(5.5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.textMuted);
    const lbl = it.label.length > 12 ? it.label.slice(0, 11) + "\u2026" : it.label;
    doc.text(lbl, bx + bw / 2, y + barH + 5, { align: "center" });
  });
  return y + h + 5;
}

function drawGantt(doc: jsPDF, phases: { label: string; start_week: number; duration_weeks: number; color?: string }[], x: number, y: number, w: number, title: string, C: ThemeColors) {
  if (!phases.length) return y;
  doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text(title, x, y); y += 7;
  const total = Math.max(...phases.map(p => p.start_week + p.duration_weeks), 1);
  const lw = 40; const chartW = w - lw - 5; const rh = 9;
  doc.setFontSize(5.5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.textMuted);
  const step = Math.max(1, Math.ceil(total / 8));
  for (let wk = 0; wk <= total; wk += step) {
    const wx = x + lw + (wk / total) * chartW; doc.text(`W${wk}`, wx, y);
    doc.setDrawColor(235,235,235); doc.setLineWidth(0.15);
    doc.line(wx, y + 2, wx, y + 2 + phases.length * rh);
  }
  y += 4;
  phases.forEach((p, i) => {
    const ry = y + i * rh;
    doc.setFontSize(7); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
    doc.text(p.label.length > 18 ? p.label.slice(0, 17) + "\u2026" : p.label, x, ry + 5);
    doc.setFillColor(...C.sectionBg); doc.roundedRect(x + lw, ry + 1, chartW, rh - 2, 1.5, 1.5, "F");
    const bx = x + lw + (p.start_week / total) * chartW;
    const bW = Math.max((p.duration_weeks / total) * chartW, 3);
    const c = p.color ? hexRgb(p.color) : hexRgb(PALETTE[i % PALETTE.length]);
    doc.setFillColor(...c); doc.roundedRect(bx, ry + 1.5, bW, rh - 3, 1.5, 1.5, "F");
    if (bW > 12) { doc.setFontSize(5); doc.setFont("helvetica","bold"); doc.setTextColor(239,236,227); doc.text(`${p.duration_weeks}w`, bx + bW / 2, ry + 5.5, { align: "center" }); }
  });
  return y + phases.length * rh + 8;
}

function drawDonut(doc: jsPDF, items: { label: string; value: number; color?: string }[], cx: number, cy: number, r: number, title: string, C: ThemeColors) {
  if (!items.length) return cy + r + 15;
  doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text(title, cx - r - 5, cy - r - 5);
  const tot = items.reduce((s, i) => s + i.value, 0) || 1;
  let sa = -Math.PI / 2;
  items.forEach((it, i) => {
    const sl = (it.value / tot) * 2 * Math.PI;
    const c = it.color ? hexRgb(it.color) : hexRgb(PALETTE[i % PALETTE.length]);
    doc.setFillColor(...c);
    const steps = Math.max(Math.ceil(sl / 0.05), 3);
    const pts: number[][] = [[cx, cy]];
    for (let s = 0; s <= steps; s++) { const a = sa + (sl * s) / steps; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    for (let p = 1; p < pts.length - 1; p++) doc.triangle(pts[0][0], pts[0][1], pts[p][0], pts[p][1], pts[p + 1][0], pts[p + 1][1], "F");
    sa += sl;
  });
  doc.setFillColor(...C.white); doc.circle(cx, cy, r * 0.55, "F");
  doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(...C.text);
  doc.text(`$${tot.toLocaleString()}`, cx, cy + 1, { align: "center" });
  doc.setFontSize(5); doc.setTextColor(...C.textMuted); doc.text("TOTAL", cx, cy + 5, { align: "center" });
  const legX = cx + r + 8; let legY = cy - r + 5;
  items.forEach((it, i) => {
    const c = it.color ? hexRgb(it.color) : hexRgb(PALETTE[i % PALETTE.length]);
    doc.setFillColor(...c); doc.roundedRect(legX, legY - 2.5, 4, 4, 0.5, 0.5, "F");
    doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
    doc.text(`${it.label.length > 16 ? it.label.slice(0, 15) + "\u2026" : it.label} (${Math.round((it.value / tot) * 100)}%)`, legX + 6, legY);
    legY += 6;
  });
  return cy + r + 15;
}

function drawRiskTable(doc: jsPDF, risks: { risk: string; probability: string; impact: string }[], x: number, y: number, w: number, title: string, C: ThemeColors) {
  if (!risks.length) return y;
  doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text(title, x, y); y += 7;
  const cols = [w * 0.5, w * 0.25, w * 0.25];
  doc.setFillColor(...C.primaryDark); doc.roundedRect(x, y, w, 7, 1, 1, "F");
  doc.setFontSize(6.5); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
  doc.text("Risk", x + 3, y + 4.5); doc.text("Probability", x + cols[0] + 3, y + 4.5); doc.text("Impact", x + cols[0] + cols[1] + 3, y + 4.5);
  y += 8;
  risks.forEach((r, i) => {
    doc.setFillColor(...(i % 2 === 0 ? C.sectionBg : C.white)); doc.rect(x, y, w, 7, "F");
    doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
    doc.text(r.risk.length > 35 ? r.risk.slice(0, 34) + "\u2026" : r.risk, x + 3, y + 4.5);
    const pc: RGB = r.probability === "High" ? C.danger : r.probability === "Medium" ? C.warning : C.success;
    doc.setFillColor(...pc); doc.roundedRect(x + cols[0] + 3, y + 1.2, 16, 4.5, 1, 1, "F");
    doc.setFontSize(5.5); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
    doc.text(r.probability, x + cols[0] + 11, y + 4.2, { align: "center" });
    const ic: RGB = r.impact === "High" ? C.danger : r.impact === "Medium" ? C.warning : C.success;
    doc.setFillColor(...ic); doc.roundedRect(x + cols[0] + cols[1] + 3, y + 1.2, 16, 4.5, 1, 1, "F");
    doc.setTextColor(...C.white); doc.text(r.impact, x + cols[0] + cols[1] + 11, y + 4.2, { align: "center" });
    y += 7;
  });
  return y + 5;
}

function drawTeamCards(doc: jsPDF, team: { name: string; role: string; experience_years: number }[], x: number, y: number, w: number, title: string, C: ThemeColors) {
  if (!team.length) return y;
  doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text(title, x, y); y += 7;
  const cardW = Math.min((w - (team.length - 1) * 4) / Math.min(team.length, 4), 42);
  const perRow = Math.min(team.length, Math.floor(w / (cardW + 4)));
  team.forEach((mbr, i) => {
    const row = Math.floor(i / perRow); const col = i % perRow;
    const cx2 = x + col * (cardW + 4); const cy2 = y + row * 30;
    doc.setFillColor(...C.sectionBg); doc.roundedRect(cx2, cy2, cardW, 26, 2, 2, "F");
    const ac = hexRgb(PALETTE[i % PALETTE.length]);
    doc.setFillColor(...ac); doc.circle(cx2 + cardW / 2, cy2 + 7, 4.5, "F");
    doc.setFontSize(7); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
    doc.text(mbr.name.split(" ").map(w2 => w2[0]).join("").slice(0, 2), cx2 + cardW / 2, cy2 + 8.5, { align: "center" });
    doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(...C.text);
    doc.text(mbr.name.length > 14 ? mbr.name.slice(0, 13) + "\u2026" : mbr.name, cx2 + cardW / 2, cy2 + 16, { align: "center" });
    doc.setFontSize(5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.textMuted);
    doc.text(mbr.role.length > 16 ? mbr.role.slice(0, 15) + "\u2026" : mbr.role, cx2 + cardW / 2, cy2 + 20, { align: "center" });
    doc.text(`${mbr.experience_years}yr exp`, cx2 + cardW / 2, cy2 + 24, { align: "center" });
  });
  return y + Math.ceil(team.length / perRow) * 30 + 5;
}

/* ═══════════════════════════════════════════════════════════ */
/*              MAIN PDF GENERATION                            */
/* ═══════════════════════════════════════════════════════════ */

export function generateProposalPDF(input: ProposalPDFInput): jsPDF {
  const { title, vendorName, contractTitle, totalPrice, timeline, sections, sectionLabels, template = "executive", chartData, executiveSummary } = input;
  const theme = THEMES[template];
  const C = theme.colors;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mg = 20;
  const cWidth = pw - mg * 2;
  let y = 0;

  /* ─── Helpers ─── */
  const pageBreak = (n: number) => { if (y + n > ph - 18) { addFooter(); doc.addPage(); addHeader(); y = 28; } };
  const addFooter = () => {
    doc.setFontSize(7); doc.setTextColor(...C.textMuted);
    doc.text(`${vendorName} \u2014 ${title}`, mg, ph - 8);
    doc.text(`Page ${doc.getNumberOfPages()}`, pw - mg, ph - 8, { align: "right" });
    doc.setDrawColor(...C.primary); doc.setLineWidth(0.5); doc.line(mg, ph - 12, pw - mg, ph - 12);
  };
  const addHeader = () => {
    sidebarDeco();
    if (doc.getNumberOfPages() > 1) {
      doc.setFontSize(6); doc.setTextColor(...C.textMuted); doc.setFont("helvetica","normal");
      const hx = theme.headerStyle === "sidebar" ? 16 : mg;
      doc.text(title || "Vendor Proposal", hx, 10);
      doc.text(vendorName, pw - mg, 10, { align: "right" });
      doc.setDrawColor(...C.border); doc.setLineWidth(0.15); doc.line(hx, 12, pw - mg, 12);
    }
  };
  const sidebarDeco = () => {
    if (theme.headerStyle === "sidebar") {
      doc.setFillColor(...C.primary); doc.rect(0, 0, 8, ph, "F");
      doc.setFillColor(...C.accent); doc.rect(8, 0, 2, ph, "F");
    }
  };

  /** Render rich text with sub-headings, bullets, tables, bold/italic, and key-value pairs */
  const renderRichText = (text: string, sx: number, sw: number) => {
    const lines = text.split("\n");
    let i = 0;

    /** Render a line with inline **bold** and *italic* formatting */
    const renderFormattedLine = (lineText: string, lx: number, lw: number, baseFontSize: number) => {
      // Split by **bold** and *italic* markers
      const parts = lineText.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
      let cx = lx;
      for (const part of parts) {
        if (!part) continue;
        if (part.startsWith("**") && part.endsWith("**")) {
          doc.setFont("helvetica", "bold"); doc.setFontSize(baseFontSize);
          const cleaned = part.slice(2, -2);
          const wrapped = doc.splitTextToSize(cleaned, lw - (cx - lx));
          for (let wi = 0; wi < wrapped.length; wi++) {
            if (wi > 0) { cx = lx; y += 4.2; pageBreak(4.5); }
            doc.text(wrapped[wi], cx, y);
            cx += doc.getTextWidth(wrapped[wi]) + 1;
          }
        } else if (part.startsWith("*") && part.endsWith("*")) {
          doc.setFont("helvetica", "italic"); doc.setFontSize(baseFontSize);
          const cleaned = part.slice(1, -1);
          const wrapped = doc.splitTextToSize(cleaned, lw - (cx - lx));
          for (let wi = 0; wi < wrapped.length; wi++) {
            if (wi > 0) { cx = lx; y += 4.2; pageBreak(4.5); }
            doc.text(wrapped[wi], cx, y);
            cx += doc.getTextWidth(wrapped[wi]) + 1;
          }
        } else {
          doc.setFont("helvetica", "normal"); doc.setFontSize(baseFontSize);
          doc.setTextColor(...C.text);
          const wrapped = doc.splitTextToSize(part, lw - (cx - lx));
          for (let wi = 0; wi < wrapped.length; wi++) {
            if (wi > 0) { cx = lx; y += 4.2; pageBreak(4.5); }
            doc.text(wrapped[wi], cx, y);
            cx += doc.getTextWidth(wrapped[wi]) + 1;
          }
        }
      }
    };

    while (i < lines.length) {
      const line = lines[i];

      // Empty line = paragraph break (tighter spacing)
      if (!line.trim()) { y += 2; i++; continue; }

      // Sub-heading: ## Heading
      if (/^##\s+/.test(line)) {
        y += 3;
        pageBreak(10);
        doc.setFontSize(10.5); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
        const headingText = line.replace(/^##\s+/, "").trim();
        doc.text(headingText, sx, y); y += 2.5;
        doc.setDrawColor(...C.primary); doc.setLineWidth(0.4); doc.line(sx, y, sx + Math.min(doc.getTextWidth(headingText) + 5, sw * 0.5), y);
        y += 4;
        i++; continue;
      }

      // ALL CAPS heading (e.g., "KEY CAPABILITIES" — minimum 3 words, all uppercase)
      if (/^[A-Z][A-Z\s&/,()-]{8,}$/.test(line.trim())) {
        y += 2;
        pageBreak(10);
        doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
        doc.text(line.trim(), sx, y); y += 2;
        doc.setDrawColor(...C.accent); doc.setLineWidth(0.3); doc.line(sx, y, sx + 30, y);
        y += 4;
        i++; continue;
      }

      // Table: detect | Header | lines
      if (/^\|.*\|/.test(line.trim())) {
        y += 1;
        const tableRows: string[][] = [];
        while (i < lines.length && /^\|.*\|/.test(lines[i].trim())) {
          const row = lines[i].trim();
          // Skip separator rows like |---|---|
          if (/^\|[\s-:|]+\|$/.test(row)) { i++; continue; }
          const cells = row.split("|").filter(c => c.trim() !== "").map(c => c.trim());
          if (cells.length > 0) tableRows.push(cells);
          i++;
        }
        if (tableRows.length > 0) {
          const cols = tableRows[0].length;
          const colW = sw / cols;
          // Header row
          pageBreak(6);
          doc.setFillColor(...C.primaryDark); doc.roundedRect(sx, y - 1, sw, 5.5, 1, 1, "F");
          doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
          tableRows[0].forEach((cell, ci) => {
            doc.text(cell.slice(0, 28), sx + ci * colW + 2, y + 2.5);
          });
          y += 6;
          // Data rows
          for (let ri = 1; ri < tableRows.length; ri++) {
            pageBreak(5.5);
            doc.setFillColor(...(ri % 2 === 0 ? C.sectionBg : C.white)); doc.rect(sx, y - 1, sw, 5, "F");
            doc.setFontSize(6); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
            tableRows[ri].forEach((cell, ci) => {
              doc.text(cell.slice(0, 30), sx + ci * colW + 2, y + 2.5);
            });
            y += 5;
          }
          y += 2;
        }
        continue;
      }

      // Bullet point
      const isBullet = /^\s*[-\u2022*]\s/.test(line) || /^\s*\d+[.)]\s/.test(line);
      if (isBullet) {
        const bulletText = line.replace(/^\s*[-\u2022*\d.)]+\s*/, "").trim();
        const xO = sx + 5; const wO = sw - 5;
        pageBreak(5);
        doc.setFillColor(...C.primary); doc.circle(sx + 2, y - 1, 0.7, "F");
        doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...C.text);
        for (const wl of doc.splitTextToSize(bulletText, wO)) {
          pageBreak(4.5); doc.text(wl, xO, y); y += 4.2;
        }
        y += 0.8;
        i++; continue;
      }

      // Key-value line (e.g., "Primary Contact: John Doe" or "Total Cost: $500,000")
      const kvMatch = line.match(/^([A-Z][A-Za-z\s&/,()-]{2,30}):\s+(.+)$/);
      if (kvMatch && !line.startsWith("http")) {
        pageBreak(5);
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...C.primaryDark);
        const keyText = kvMatch[1] + ": ";
        doc.text(keyText, sx, y);
        const keyWidth = doc.getTextWidth(keyText);
        doc.setFont("helvetica", "normal"); doc.setTextColor(...C.text);
        const valueLines = doc.splitTextToSize(kvMatch[2], sw - keyWidth);
        doc.text(valueLines[0], sx + keyWidth, y);
        y += 4.2;
        for (let vi = 1; vi < valueLines.length; vi++) {
          pageBreak(4.5); doc.text(valueLines[vi], sx + 4, y); y += 4.2;
        }
        y += 0.5;
        i++; continue;
      }

      // Regular paragraph text
      doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...C.text);
      if (line.includes("**") || line.includes("*")) {
        // Use formatted renderer for bold/italic
        pageBreak(4.5);
        renderFormattedLine(line, sx, sw, 8.5);
        y += 4.2;
      } else {
        for (const wl of doc.splitTextToSize(line, sw)) {
          pageBreak(4.5); doc.text(wl, sx, y); y += 4.2;
        }
      }
      y += 1;
      i++;
    }
  };

  /** Draw a section divider page (half page) with section number and title */
  const drawSectionDivider = (idx: number, label: string) => {
    doc.addPage(); addHeader(); y = 28;
    const centerY = 80;
    // Decorative background block
    if (theme.headerStyle === "gradient") {
      doc.setFillColor(...C.primary); doc.roundedRect(mg - 5, centerY - 25, cWidth + 10, 50, 4, 4, "F");
      doc.setFillColor(...C.accent); doc.roundedRect(mg - 5, centerY + 22, cWidth + 10, 3, 0, 0, "F");
    } else if (theme.headerStyle === "sidebar") {
      doc.setFillColor(...C.primary); doc.roundedRect(15, centerY - 25, cWidth, 50, 3, 3, "F");
    } else if (theme.headerStyle === "border") {
      doc.setDrawColor(...C.primary); doc.setLineWidth(2);
      doc.line(mg, centerY - 25, mg, centerY + 25);
      doc.setLineWidth(0.5);
    } else {
      doc.setDrawColor(...C.border); doc.setLineWidth(0.5);
      doc.line(mg, centerY - 8, pw - mg, centerY - 8);
      doc.line(mg, centerY + 18, pw - mg, centerY + 18);
    }

    const isFilledBg = theme.headerStyle === "gradient" || theme.headerStyle === "sidebar";
    const divX = theme.headerStyle === "sidebar" ? 20 : mg + 5;

    // Section number
    doc.setFontSize(36); doc.setFont("helvetica","bold");
    doc.setTextColor(...(isFilledBg ? C.white : C.primary));
    doc.text(String(idx + 1).padStart(2, "0"), divX, centerY - 2);

    // Section title
    doc.setFontSize(20); doc.setFont("helvetica","bold");
    doc.setTextColor(...(isFilledBg ? [220, 230, 255] as RGB : C.primaryDark));
    const titleLines = doc.splitTextToSize(label, cWidth - 30);
    let ty2 = centerY + 10;
    for (const l of titleLines) { doc.text(l, divX, ty2); ty2 += 9; }

    // Sub-label
    doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.setTextColor(...(isFilledBg ? [180, 200, 240] as RGB : C.textMuted));
    doc.text(`SECTION ${String(idx + 1).padStart(2, "0")} OF ${filled.length}`, divX, centerY - 12);

    y = centerY + 45;
  };

  /* ═══ COVER PAGE ═══ */
  if (theme.headerStyle === "gradient") {
    doc.setFillColor(...C.primary); doc.rect(0, 0, pw, 95, "F");
    doc.setFillColor(...C.accent); doc.rect(0, 95, pw, 3, "F");
  } else if (theme.headerStyle === "sidebar") {
    sidebarDeco();
    doc.setFillColor(...C.primary); doc.rect(0, 0, pw, 70, "F");
  } else if (theme.headerStyle === "border") {
    doc.setDrawColor(...C.primary); doc.setLineWidth(2); doc.rect(10, 10, pw - 20, ph - 20);
    doc.setFillColor(...C.primary); doc.rect(10, 10, pw - 20, 65, "F"); doc.setLineWidth(0.5);
  } else {
    doc.setFillColor(...C.sectionBg); doc.rect(0, 0, pw, 80, "F");
    doc.setDrawColor(...C.primary); doc.setLineWidth(1); doc.line(mg, 80, pw - mg, 80);
  }

  const tx = theme.headerStyle === "sidebar" ? 16 : mg;
  doc.setTextColor(...(theme.headerStyle === "clean" ? C.text : C.white));
  doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.text("VENDOR PROPOSAL", tx, 32);
  doc.setFontSize(24); doc.setFont("helvetica","bold");
  const tLines = doc.splitTextToSize(title || "Untitled Proposal", cWidth - (theme.headerStyle === "sidebar" ? 10 : 0));
  let ty = 45; for (const l of tLines) { doc.text(l, tx, ty); ty += 11; }
  doc.setFontSize(10); doc.setFont("helvetica","normal");
  if (theme.headerStyle === "gradient" || theme.headerStyle === "sidebar") doc.setTextColor(200,220,255);
  else if (theme.headerStyle === "border") doc.setTextColor(220,220,220);
  else doc.setTextColor(...C.textMuted);
  doc.text(`Prepared for: ${contractTitle}`, tx, 73);
  doc.text(`Prepared by: ${vendorName}`, tx, 81);

  y = theme.headerStyle === "border" ? 90 : 110;
  doc.setFillColor(...C.sectionBg); doc.roundedRect(mg, y, cWidth, 32, 2, 2, "F");
  const colW = cWidth / 4;
  [
    { label: "DATE", value: new Date().toLocaleDateString() },
    { label: "VENDOR", value: vendorName },
    { label: "TOTAL PRICE", value: totalPrice || "TBD" },
    { label: "TIMELINE", value: timeline || "TBD" },
  ].forEach((f, i) => {
    const cx = mg + colW * i + 6;
    doc.setFontSize(6.5); doc.setTextColor(...C.textMuted); doc.setFont("helvetica","normal"); doc.text(f.label, cx, y + 10);
    doc.setFontSize(9); doc.setTextColor(...C.text); doc.setFont("helvetica","bold");
    doc.text((f.value || "N/A").slice(0, 18), cx, y + 17);
  });

  // Confidentiality notice on cover
  y += 42;
  doc.setFillColor(...C.sectionBg); doc.roundedRect(mg, y, cWidth, 16, 2, 2, "F");
  doc.setFontSize(7); doc.setFont("helvetica","bold"); doc.setTextColor(...C.textMuted);
  doc.text("CONFIDENTIALITY NOTICE", mg + 5, y + 5);
  doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
  doc.text("This document contains proprietary and confidential information. It is intended solely for the use of the", mg + 5, y + 9.5);
  doc.text("individual or entity to whom it is addressed. Unauthorized disclosure, copying, or distribution is prohibited.", mg + 5, y + 13);

  addFooter();

  /* ═══ TABLE OF CONTENTS ═══ */
  const sKeys = Object.keys(sectionLabels) as (keyof ProposalSections)[];
  const filled = sKeys.filter(k => sections[k]);

  doc.addPage(); addHeader(); y = 28;
  doc.setFontSize(18); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text("Table of Contents", mg, y); y += 4;
  doc.setDrawColor(...C.primary); doc.setLineWidth(0.8); doc.line(mg, y, mg + 50, y); y += 10;

  // Executive summary in TOC
  if (executiveSummary) {
    doc.setFillColor(...C.accent); doc.roundedRect(mg, y - 3, 6, 6, 1, 1, "F");
    doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
    doc.text("\u2605", mg + 3, y + 0.5, { align: "center" });
    doc.setFontSize(9.5); doc.setFont("helvetica","bold"); doc.setTextColor(...C.accent);
    doc.text("Executive Summary", mg + 10, y);
    y += 8;
  }

  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  filled.forEach((key, idx) => {
    pageBreak(8);
    doc.setFillColor(...C.primary); doc.roundedRect(mg, y - 3, 6, 6, 1, 1, "F");
    doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
    doc.text(String(idx + 1), mg + 3, y + 0.5, { align: "center" });
    doc.setFontSize(9.5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
    doc.text(sectionLabels[key], mg + 10, y);
    const lw2 = doc.getTextWidth(sectionLabels[key]); const ds = mg + 10 + lw2 + 2; const de = pw - mg - 10;
    if (de > ds) { doc.setTextColor(...C.border); doc.text(".".repeat(Math.floor((de - ds) / 1.4)), ds, y); }
    doc.setTextColor(...C.textMuted); doc.setFontSize(8);
    y += 8;
  });

  const hasCharts = chartData && ((chartData.cost_breakdown?.length ?? 0) > 0 || (chartData.timeline_phases?.length ?? 0) > 0 || (chartData.team_structure?.length ?? 0) > 0 || (chartData.risk_matrix?.length ?? 0) > 0);
  if (hasCharts) {
    pageBreak(8);
    doc.setFillColor(...C.accent); doc.roundedRect(mg, y - 3, 6, 6, 1, 1, "F");
    doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
    doc.text("\u2605", mg + 3, y + 0.5, { align: "center" });
    doc.setFontSize(9.5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.accent);
    doc.text("Data Visualizations & Analytics", mg + 10, y); y += 8;
  }

  // Appendix in TOC
  pageBreak(8);
  doc.setFillColor(...C.textMuted); doc.roundedRect(mg, y - 3, 6, 6, 1, 1, "F");
  doc.setFontSize(6); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
  doc.text("A", mg + 3, y + 0.5, { align: "center" });
  doc.setFontSize(9.5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.textMuted);
  doc.text("Appendix \u2014 Authorization & Signature", mg + 10, y);
  y += 8;

  addFooter();

  /* ═══ EXECUTIVE SUMMARY ═══ */
  if (executiveSummary) {
    doc.addPage(); addHeader(); y = 28;
    const sx = theme.headerStyle === "sidebar" ? 16 : mg;
    const sw = theme.headerStyle === "sidebar" ? cWidth - 6 : cWidth;

    // Highlight banner
    doc.setFillColor(...C.accent); doc.roundedRect(sx, y - 6, sw, 14, 2, 2, "F");
    doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
    doc.text("Executive Summary", sx + 6, y + 3);
    y += 16;

    // Key metrics bar
    doc.setFillColor(...C.sectionBg); doc.roundedRect(sx, y, sw, 18, 2, 2, "F");
    const mColW = sw / 3;
    [
      { label: "TOTAL INVESTMENT", value: totalPrice || "TBD" },
      { label: "PROJECT TIMELINE", value: timeline || "TBD" },
      { label: "SUBMISSION DATE", value: new Date().toLocaleDateString() },
    ].forEach((m, mi) => {
      const mx = sx + mColW * mi + 6;
      doc.setFontSize(6); doc.setTextColor(...C.textMuted); doc.setFont("helvetica","normal"); doc.text(m.label, mx, y + 6);
      doc.setFontSize(10); doc.setTextColor(...C.primaryDark); doc.setFont("helvetica","bold"); doc.text(m.value.slice(0, 22), mx, y + 13);
    });
    y += 24;

    // Render executive summary content with rich formatting
    renderRichText(executiveSummary, sx, sw);
    addFooter();
  }

  /* ═══ SECTION PAGES ═══ */
  filled.forEach((key, idx) => {
    // Section divider page (half-page intro)
    drawSectionDivider(idx, sectionLabels[key]);

    doc.addPage(); addHeader(); y = 28;
    const sx = theme.headerStyle === "sidebar" ? 16 : mg;
    const sw = theme.headerStyle === "sidebar" ? cWidth - 6 : cWidth;

    // Section header
    if (theme.headerStyle === "gradient" || theme.headerStyle === "sidebar") {
      doc.setFillColor(...C.primary); doc.roundedRect(sx, y - 6, 10, 10, 2, 2, "F");
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
      doc.text(String(idx + 1), sx + 5, y + 1, { align: "center" });
      doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
      doc.text(sectionLabels[key], sx + 14, y + 1); y += 5;
      doc.setDrawColor(...C.primary); doc.setLineWidth(0.6); doc.line(sx, y, sx + 50, y);
    } else if (theme.headerStyle === "border") {
      doc.setDrawColor(...C.primary); doc.setLineWidth(1.5); doc.line(mg, y - 2, mg, y + 8);
      doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
      doc.text(`${idx + 1}. ${sectionLabels[key]}`, mg + 5, y + 5); y += 10;
    } else {
      doc.setFontSize(10); doc.setTextColor(...C.textMuted); doc.setFont("helvetica","normal");
      doc.text(`SECTION ${String(idx + 1).padStart(2, "0")}`, sx, y); y += 5;
      doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(...C.text);
      doc.text(sectionLabels[key], sx, y); y += 3;
      doc.setDrawColor(...C.border); doc.setLineWidth(0.3); doc.line(sx, y, sx + sw, y);
    }
    y += 6;

    // Render section content with rich text formatting
    renderRichText(sections[key], sx, sw);
    addFooter();
  });

  /* ═══ DATA VISUALIZATION PAGES ═══ */
  if (hasCharts && chartData) {
    // Charts title page
    doc.addPage(); addHeader(); y = 28;
    doc.setFillColor(...C.accent); doc.roundedRect(mg, y - 6, cWidth, 14, 2, 2, "F");
    doc.setFontSize(13); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
    doc.text("Data Visualizations & Analytics", mg + 6, y + 3); y += 22;
    doc.setFontSize(9.5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
    doc.text("The following pages present key project data in visual formats for quick reference and analysis.", mg, y);
    y += 12;

    if ((chartData.cost_breakdown?.length ?? 0) > 0) {
      // Budget distribution page
      doc.addPage(); addHeader(); y = 28;
      doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
      doc.text("Budget Distribution Analysis", mg, y); y += 4;
      doc.setDrawColor(...C.primary); doc.setLineWidth(0.5); doc.line(mg, y, mg + 60, y); y += 10;
      drawDonut(doc, chartData.cost_breakdown, mg + 35, y + 30, 22, "Budget Distribution", C);
      y += 70; pageBreak(70);
      y = drawBarChart(doc, chartData.cost_breakdown, mg, y, cWidth, 55, "Cost Breakdown by Phase", C);
      addFooter();
    }
    if ((chartData.timeline_phases?.length ?? 0) > 0 || (chartData.team_structure?.length ?? 0) > 0) {
      doc.addPage(); addHeader(); y = 28;
      doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
      doc.text("Project Timeline & Team", mg, y); y += 4;
      doc.setDrawColor(...C.primary); doc.setLineWidth(0.5); doc.line(mg, y, mg + 60, y); y += 10;
      if ((chartData.timeline_phases?.length ?? 0) > 0) { y = drawGantt(doc, chartData.timeline_phases, mg, y, cWidth, "Project Timeline \u2014 Gantt Chart", C); y += 8; }
      if ((chartData.team_structure?.length ?? 0) > 0) { pageBreak(50); y = drawTeamCards(doc, chartData.team_structure, mg, y, cWidth, "Team Structure", C); }
      addFooter();
    }
    if ((chartData.risk_matrix?.length ?? 0) > 0) {
      doc.addPage(); addHeader(); y = 28;
      doc.setFontSize(14); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
      doc.text("Risk & Deliverables Analysis", mg, y); y += 4;
      doc.setDrawColor(...C.primary); doc.setLineWidth(0.5); doc.line(mg, y, mg + 60, y); y += 10;
      y = drawRiskTable(doc, chartData.risk_matrix, mg, y, cWidth, "Risk Assessment Matrix", C);
      if ((chartData.deliverables_progress?.length ?? 0) > 0) {
        y += 10; pageBreak(60);
        doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
        doc.text("Deliverables Weight Distribution", mg, y); y += 7;
        chartData.deliverables_progress.forEach(d => {
          pageBreak(10);
          doc.setFontSize(7); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
          doc.text(d.name.length > 30 ? d.name.slice(0, 29) + "\u2026" : d.name, mg, y);
          doc.text(`${d.weight}%`, pw - mg, y, { align: "right" }); y += 3;
          doc.setFillColor(...C.sectionBg); doc.roundedRect(mg, y, cWidth, 4, 1, 1, "F");
          doc.setFillColor(...C.primary); doc.roundedRect(mg, y, Math.max((d.weight / 100) * cWidth, 2), 4, 1, 1, "F"); y += 7;
        });
      }
      addFooter();
    }
  }

  /* ═══ APPENDIX — SIGNATURE PAGE ═══ */
  doc.addPage(); addHeader(); y = 28;
  // Appendix header
  doc.setFontSize(11); doc.setTextColor(...C.textMuted); doc.setFont("helvetica","normal");
  doc.text("APPENDIX", mg, y); y += 6;
  doc.setFontSize(16); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text("Authorization & Signature", mg, y); y += 4;
  doc.setDrawColor(...C.primary); doc.setLineWidth(0.5); doc.line(mg, y, mg + 55, y);
  y += 12;

  doc.setFillColor(...C.sectionBg); doc.roundedRect(mg, y - 4, cWidth, 80, 3, 3, "F");
  doc.setFontSize(9.5); doc.setFont("helvetica","normal"); doc.setTextColor(...C.text);
  doc.text("I hereby confirm that all information provided in this proposal is accurate, complete,", mg + 10, y + 4);
  doc.text("and represents our genuine commitment to deliver the proposed solution as described.", mg + 10, y + 10);
  doc.text("This proposal shall remain valid for a period of ninety (90) days from the date of submission.", mg + 10, y + 16);
  y += 30;

  doc.setDrawColor(...C.border); doc.setLineWidth(0.3);
  // Signature line
  doc.line(mg + 10, y, mg + 80, y);
  doc.setFontSize(7); doc.setTextColor(...C.textMuted); doc.text("Authorized Signature", mg + 10, y + 4);
  // Date line
  doc.line(mg + 90, y, pw - mg - 10, y); doc.text("Date", mg + 90, y + 4);
  y += 14;

  // Printed name and date
  doc.setTextColor(...C.text); doc.setFontSize(9.5); doc.setFont("helvetica","bold");
  doc.text(`Name: ${vendorName}`, mg + 10, y);
  doc.setFont("helvetica","normal"); doc.text(`Date: ${new Date().toLocaleDateString()}`, mg + 90, y);
  y += 8;
  doc.text(`Title: Authorized Representative`, mg + 10, y);
  doc.text(`Company: ${vendorName}`, mg + 90, y);

  y += 20;
  // Confidentiality footer
  doc.setFillColor(...C.primary); doc.roundedRect(mg, y, cWidth, 10, 1.5, 1.5, "F");
  doc.setFontSize(7); doc.setFont("helvetica","bold"); doc.setTextColor(...C.white);
  doc.text("CONFIDENTIAL \u2014 This document contains proprietary information intended solely for the recipient.", mg + cWidth / 2, y + 6, { align: "center" });

  /* ═══ NOTES PAGE ═══ */
  doc.addPage(); addHeader(); y = 28;
  doc.setFontSize(16); doc.setFont("helvetica","bold"); doc.setTextColor(...C.primaryDark);
  doc.text("Notes", mg, y); y += 4;
  doc.setDrawColor(...C.primary); doc.setLineWidth(0.5); doc.line(mg, y, mg + 25, y); y += 12;
  // Draw ruled lines
  for (let nl = 0; nl < 28; nl++) {
    doc.setDrawColor(...C.border); doc.setLineWidth(0.1);
    doc.line(mg, y, pw - mg, y); y += 8;
  }

  addFooter();

  return doc;
}

export function generateProposalPDFBlob(input: ProposalPDFInput): Blob {
  return generateProposalPDF(input).output("blob");
}

export function downloadProposalPDF(input: ProposalPDFInput, fileName?: string): void {
  const doc = generateProposalPDF(input);
  doc.save(fileName || `${(input.title || "proposal").replace(/[^a-zA-Z0-9]/g, "_")}.pdf`);
}
