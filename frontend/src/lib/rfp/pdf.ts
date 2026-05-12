/* ═══════════════════════════════════════════════════════════ */
/*         RFP PDF Generation with PDFShift                    */
/* ═══════════════════════════════════════════════════════════ */

import jsPDF from "jspdf";
import { RFP_SECTIONS, SECTION_LABELS, type SectionKey, type PdfTemplate } from "./config";

/* ─── Template color schemes ─── */
const TEMPLATE_COLORS: Record<PdfTemplate, { primary: string; secondary: string; headerBg: string; headerText: string }> = {
  software: { primary: "#2563eb", secondary: "#3b82f6", headerBg: "#1e40af", headerText: "#EFECE3" },
  manufacturing: { primary: "#d97706", secondary: "#f59e0b", headerBg: "#92400e", headerText: "#EFECE3" },
  consulting: { primary: "#0369a1", secondary: "#0284c7", headerBg: "#0c4a6e", headerText: "#EFECE3" },
  government: { primary: "#374151", secondary: "#4b5563", headerBg: "#111827", headerText: "#EFECE3" },
};

function getWordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/* ─── Inline markdown → HTML ─── */
function inline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/`(.+?)`/g, "<code>$1</code>");
  return s;
}

/* ─── Generate visual bar chart HTML ─── */
function generateBarChart(title: string, items: { label: string; value: number; max?: number }[]): string {
  if (items.length === 0) return "";
  const maxVal = items.reduce((m, i) => Math.max(m, i.max || i.value), 0) || 100;
  const barRows = items
    .map(
      (item) => `
    <div class="bar-row">
      <div class="bar-label">${escapeHtml(item.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, Math.round((item.value / maxVal) * 95))}%"></div></div>
      <div class="bar-value">${item.value}%</div>
    </div>`,
    )
    .join("");
  return `<div class="chart-container"><div class="chart-title">${escapeHtml(title)}</div><div class="bar-chart">${barRows}</div></div>`;
}

/* ─── Generate comparison table HTML ─── */
function generateComparisonTable(
  title: string,
  headers: string[],
  rows: (string | number)[][],
): string {
  if (rows.length === 0) return "";
  let html = `<div class="chart-container"><div class="chart-title">${escapeHtml(title)}</div>`;
  html += '<table class="data-table"><thead><tr>';
  headers.forEach((h) => (html += `<th>${escapeHtml(h.toString())}</th>`));
  html += "</tr></thead><tbody>";
  rows.forEach((row) => {
    html += "<tr>";
    row.forEach((cell) => (html += `<td>${escapeHtml(cell.toString())}</td>`));
    html += "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

/* ─── Parse markdown table rows ─── */
function parseTableLines(lines: string[]): string {
  if (lines.length < 2) return "";
  const parseRow = (row: string) =>
    row
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

  const headers = parseRow(lines[0]);
  const hasSep = lines.length > 1 && /^[\s|:\-]+$/.test(lines[1]);
  const dataStart = hasSep ? 2 : 1;
  const rows = lines.slice(dataStart).filter((l) => l.includes("|")).map(parseRow);

  let html = '<table class="data-table"><thead><tr>';
  headers.forEach((h) => (html += `<th>${inline(h)}</th>`));
  html += "</tr></thead><tbody>";
  rows.forEach((row) => {
    html += "<tr>";
    row.forEach((cell) => (html += `<td>${inline(cell)}</td>`));
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

function parseMarkdownTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
  if (!lines || lines.length === 0) return null;
  const parseRow = (row: string) => row.split("|").slice(1, -1).map((c) => c.trim());
  const headers = parseRow(lines[0]);
  const hasSep = lines.length > 1 && /^[\s|:\-]+$/.test(lines[1]);
  const dataStart = hasSep ? 2 : 1;
  const rows = lines.slice(dataStart).filter((l) => l.includes("|")).map(parseRow);
  return { headers, rows };
}

/* ─── bodyToHtml: convert section markdown to HTML ─── */
function bodyToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  let html = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Visual marker (insert a visual block title)
    const visualMatch = line.match(/^\[Visual:\s*(.+?)\]\s*$/);
    if (visualMatch) {
      const title = visualMatch[1].trim();
      html += `<div class="chart-container"><div class="chart-title">${escapeHtml(title)}</div>`;
      // If the next lines contain a markdown table, let the table parser handle it by advancing
      i++;
      // collect following table or list lines until a blank line
      const visualLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== "") {
        visualLines.push(lines[i]);
        i++;
      }
      // Render structured visuals if pipe-delimited
      if (visualLines.some((l) => l.includes("|"))) {
        const tableLines = visualLines.filter((l) => l.includes("|"));
        const parsed = parseMarkdownTable(tableLines);
        if (parsed) {
          const titleLower = title.toLowerCase();
          // KPI / Metrics -> bar chart
          if (/(metric|kpi|success)/i.test(titleLower) && parsed.headers.length >= 2) {
            // try to extract numeric value from second or third column
            const items = parsed.rows.map((r) => {
              const label = r[0] || "";
              // find numeric in row
              let value = 0;
              for (let k = 1; k < r.length; k++) {
                const m = r[k].match(/(\d{1,3})\s*%/);
                if (m) { value = Number(m[1]); break; }
                const num = Number(r[k].replace(/[^0-9\.]/g, ""));
                if (!Number.isNaN(num) && num > 0) { value = Math.round(num); break; }
              }
              return { label, value, max: 100 };
            }).filter((it) => it.label && it.value >= 0);
            if (items.length > 0) html += generateBarChart(title, items);
            else html += parseTableLines(tableLines);
          }
          // Timeline -> comparison table or timeline list
          else if (/(timeline|phases|roadmap)/i.test(titleLower)) {
            // render as comparison table if headers present
            html += generateComparisonTable(title, parsed.headers, parsed.rows);
          }
          // Resource allocation -> render simple allocation bars
          else if (/(resource|allocation)/i.test(titleLower)) {
            // try to map label->percent from second column
            const items = parsed.rows.map((r) => {
              const label = r[0] || "";
              const num = Number(r[1]?.replace(/[^0-9\.]/g, "")) || 0;
              return { label, value: Math.round(num), max: 100 };
            }).filter(Boolean);
            if (items.length > 0) html += generateBarChart(title, items);
            else html += parseTableLines(tableLines);
          } else {
            html += parseTableLines(tableLines);
          }
        } else {
          html += parseTableLines(tableLines);
        }
      } else {
        // render as list or paragraphs
        html += `<div style="padding:8px 0;">${escapeHtml(visualLines.join(" "))}</div>`;
      }
      html += `</div>`;
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      html += `<h5>${inline(line.slice(5))}</h5>\n`;
      i++;
    } else if (line.startsWith("### ")) {
      html += `<h4>${inline(line.slice(4))}</h4>\n`;
      i++;
    } else if (line.startsWith("## ")) {
      html += `<h3>${inline(line.slice(3))}</h3>\n`;
      i++;
    }
    // Table block
    else if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      html += parseTableLines(tableLines);
    }
    // Blockquote
    else if (line.startsWith("> ")) {
      html += `<div class="info-box">${inline(line.slice(2))}</div>\n`;
      i++;
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line)) {
      html += "<ol>\n";
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        html += `<li>${inline(lines[i].replace(/^\d+\.\s/, ""))}</li>\n`;
        i++;
      }
      html += "</ol>\n";
    }
    // Bulleted list
    else if (/^[\-•*]\s/.test(line.trim())) {
      html += "<ul>\n";
      while (i < lines.length && /^[\-•*]\s/.test(lines[i].trim())) {
        html += `<li>${inline(lines[i].trim().replace(/^[\-•*]\s/, ""))}</li>\n`;
        i++;
      }
      html += "</ul>\n";
    }
    // Empty line
    else if (line.trim() === "") {
      i++;
    }
    // Paragraph: collect plain text lines (stop at special lines)
    else {
      const pLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].startsWith("#") &&
        !lines[i].startsWith("> ") &&
        !(lines[i].includes("|") && lines[i].trim().startsWith("|")) &&
        !/^\d+\.\s/.test(lines[i]) &&
        !/^[\-•*]\s/.test(lines[i].trim())
      ) {
        pLines.push(lines[i]);
        i++;
      }
      if (pLines.length > 0) {
        html += `<p>${inline(pLines.join(" "))}</p>\n`;
      }
    }
  }
  return html;
}



/* ─── Build full HTML document ─── */
function buildFullHtml(
  meta: { organization_name: string; project_title: string; category: string; date: string },
  sections: Record<string, string>,
  template: PdfTemplate,
): string {
  const colors = TEMPLATE_COLORS[template];

  // Font family per template
  const fontFamily =
    template === "consulting" || template === "government"
      ? "'Georgia', 'Times New Roman', serif"
      : "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

  const css = `
    @page { size: A4; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fontFamily}; font-size: 11pt; line-height: 1.6; color: #1a1a1a; }

    .cover-page {
      height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;
      background: linear-gradient(135deg, ${colors.primary}, ${colors.headerBg});
      color: white; page-break-after: always; padding: 60px;
    }
    .cover-page h1 { font-size: 32pt; font-weight: 700; margin-bottom: 12px; line-height: 1.2; }
    .cover-page .org-name { font-size: 16pt; opacity: 0.9; margin-bottom: 20px; }
    .cover-page .date { font-size: 13pt; opacity: 0.8; margin-bottom: 12px; }
    .cover-page .badge { padding: 6px 24px; border: 2px solid rgba(239,236,227,0.5); border-radius: 20px; font-size: 11pt; text-transform: uppercase; letter-spacing: 1px; }
    .cover-page .rfp-label { font-size: 14pt; margin-top: 40px; opacity: 0.7; text-transform: uppercase; letter-spacing: 3px; }

    .toc-page { page-break-after: always; padding: 60px 50px; }
    .toc-page h2 { font-size: 20pt; color: ${colors.primary}; border-bottom: 3px solid ${colors.primary}; padding-bottom: 8px; margin-bottom: 20px; }
    .toc-item { display: flex; align-items: baseline; padding: 6px 0; border-bottom: 1px dotted #ccc; font-size: 12pt; }
    .toc-num { font-weight: 700; color: ${colors.primary}; min-width: 28px; }
    .toc-label { flex: 1; }

    .section { page-break-before: always; padding: 48px 40px 48px 40px; }
    .section h2 { font-size: 19pt; color: ${colors.primary}; border-bottom: 2px solid ${colors.primary}; padding-bottom: 6px; margin-bottom: 12px; }
    h3 { font-size: 13pt; color: ${colors.headerBg}; margin: 16px 0 8px; font-weight: 600; }
    h4 { font-size: 12pt; color: ${colors.secondary}; margin: 12px 0 6px; font-weight: 600; }
    h5 { font-size: 11pt; color: ${colors.primary}; margin: 10px 0 6px; font-weight: 600; }
    p { margin: 10px 0; text-align: justify; }
    ul, ol { margin: 10px 0; padding-left: 28px; }
    li { margin: 4px 0; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 11.5pt; }

    .data-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 10.5pt; }
    .data-table th { background: ${colors.headerBg}; color: ${colors.headerText}; padding: 8px 12px; text-align: left; font-weight: 600; }
    .data-table td { padding: 6px 12px; border-bottom: 1px solid #e5e7eb; }
    .data-table tr:nth-child(even) { background: #f9fafb; }

    .info-box { background: #eff6ff; border-left: 4px solid ${colors.primary}; padding: 12px 16px; margin: 12px 0; border-radius: 0 4px 4px 0; font-style: italic; font-size: 12pt; }

    /* Professional visual elements for charts and graphs */
    .chart-container { margin: 20px 0; padding: 16px; background: #f9fafb; border-radius: 8px; border-left: 4px solid ${colors.primary}; }
    .chart-title { font-size: 13pt; font-weight: 700; color: ${colors.headerBg}; margin-bottom: 12px; margin-top: 0; }
    .bar-chart { display: grid; gap: 12px; margin: 14px 0; }
    .bar-row { display: flex; align-items: center; gap: 10px; }
    .bar-label { min-width: 140px; font-size: 10pt; font-weight: 600; color: #1f2937; }
    .bar-track { flex: 1; height: 18px; background: #e5e7eb; border-radius: 8px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, ${colors.primary}, ${colors.secondary}); border-radius: 8px; min-width: 15px; }
    .bar-value { min-width: 50px; text-align: right; font-size: 10pt; color: #4b5563; font-weight: 600; }

    .footer { position: fixed; bottom: 20px; left: 50px; right: 50px; text-align: center; font-size: 8pt; color: #999; }
  `;

  // Cover page
  const coverHtml = `
    <div class="cover-page">
      <div class="rfp-label">Request for Proposal</div>
      <h1>${escapeHtml(meta.project_title)}</h1>
      <div class="org-name">${escapeHtml(meta.organization_name)}</div>
      <div class="date">${escapeHtml(meta.date)}</div>
      <div class="badge">${escapeHtml(meta.category)}</div>
    </div>`;

  // Table of contents — only include sections that have content
  const populatedSections = RFP_SECTIONS.filter((key) => sections[key] && sections[key].trim().length > 0);

  const tocItems = populatedSections.map((key, idx) => {
    const label = SECTION_LABELS[key];
    return `<div class="toc-item"><span class="toc-num">${idx + 1}.</span><span class="toc-label">${escapeHtml(label)}</span></div>`;
  }).join("\n");

  const tocHtml = `
    <div class="toc-page">
      <h2>Table of Contents</h2>
      ${tocItems}
    </div>`;

  // Sections — only render sections that have content
  const sectionPages = populatedSections.map((key, idx) => {
    const label = SECTION_LABELS[key];
    const content = sections[key];
    return `
      <div class="section">
        <h2>${idx + 1}. ${escapeHtml(label)}</h2>
        ${bodyToHtml(content)}
      </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(meta.project_title)} — Request for Proposal</title>
  <style>${css}</style>
</head>
<body>
  ${coverHtml}
  ${tocHtml}
  ${sectionPages}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapLines(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth) as string[];
}

function generateFallbackPdf(
  metadata: { organization_name: string; project_title: string; category: string; date: string },
  sections: Record<string, string>,
  template: PdfTemplate,
): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const colors = TEMPLATE_COLORS[template];
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const marginTop = 56;
  const contentWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = marginTop;
    }
  };

  const writeLines = (lines: string[], lineHeight: number) => {
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, marginX, y);
      y += lineHeight;
    }
  };

  doc.setFillColor(...hexToRgb(colors.headerBg));
  doc.rect(0, 0, pageWidth, 96, "F");

  doc.setTextColor(239, 236, 227);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  writeLines(wrapLines(doc, metadata.project_title, contentWidth), 26);

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  writeLines([metadata.organization_name, metadata.category, metadata.date], 16);

  doc.setTextColor(26, 26, 26);

  y += 18;
  doc.setDrawColor(...hexToRgb(colors.primary));
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 18;

  const populatedSections = RFP_SECTIONS.filter((key) => sections[key] && sections[key].trim().length > 0);

  populatedSections.forEach((key, index) => {
    const label = SECTION_LABELS[key] || key;
    const body = sections[key];

    ensureSpace(42);
    doc.setTextColor(...hexToRgb(colors.primary));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    writeLines([`${index + 1}. ${label}`], 18);

    doc.setTextColor(26, 26, 26);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      const cleanedParagraph = paragraph
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-•*]\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .replace(/\s+/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

      const lines = wrapLines(doc, cleanedParagraph, contentWidth);
      writeLines(lines, 14);
      y += 4;
    }

    y += 12;
  });

  return new Uint8Array(doc.output("arraybuffer"));
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const intValue = Number.parseInt(expanded, 16);
  return [
    (intValue >> 16) & 255,
    (intValue >> 8) & 255,
    intValue & 255,
  ];
}

/* ─── Generate PDF via Puppeteer ─── */
export async function generateRfpPdf(
  metadata: { organization_name: string; project_title: string; category: string; date: string },
  sections: Record<string, string>,
  template: PdfTemplate,
): Promise<Uint8Array> {
  const html = buildFullHtml(metadata, sections, template);

  try {
    const apiKey = process.env.PDFSHIFT_API_KEY;
    if (!apiKey) {
      console.warn("PDFSHIFT_API_KEY is missing, falling back to local jsPDF rendering.");
      return generateFallbackPdf(metadata, sections, template || "software");
    }

    const sandboxEnv = (process.env.PDFSHIFT_SANDBOX || "").trim().toLowerCase();
    const sandbox = sandboxEnv === "true"
      ? true
      : sandboxEnv === "false"
        ? false
        : process.env.NODE_ENV !== "production";
    console.log("[PDFShift] Rendering request", {
      sandbox,
      template,
      project_title: metadata.project_title,
      hasApiKey: true,
    });

    const response = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Processor-Version": "142",
      },
      body: JSON.stringify({
        source: html,
        format: "A4",
        sandbox,
        remove_blank: true,
        wait_for_network: false,
        disable_javascript: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "PDFShift conversion failed");
      throw new Error(errorText || `PDFShift conversion failed with status ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.warn("PDFShift PDF generation failed, falling back to jsPDF:", error);
    return generateFallbackPdf(metadata, sections, template || "software");
  }
}
