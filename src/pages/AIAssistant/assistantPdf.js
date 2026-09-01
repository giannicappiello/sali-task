import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawAssistantChartPdf } from "./assistantChart.js";

const PDF_REQUEST_PATTERN = /\bpdf\b/i;
const REPORT_REQUEST_PATTERN = /elabor|report|scaric|alleg|document|file|esport|crea|genera|prepara|produci|stampa|fammi|vorrei|voglio/i;

export function isPdfReportRequest(text) {
  const value = String(text || "");
  return PDF_REQUEST_PATTERN.test(value) && REPORT_REQUEST_PATTERN.test(value);
}

function cleanMarkdown(value) {
  return String(value || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function tableCells(line) {
  return String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cleanMarkdown);
}

function isTableSeparator(line) {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

export function assistantReportTitle(content) {
  const heading = String(content || "").split(/\r?\n/).find((line) => /^#{1,6}\s+\S/.test(line.trim()));
  return cleanMarkdown(heading || "Report Assistente AI").slice(0, 100);
}

export function assistantReportFilename(title, date = new Date()) {
  const slug = cleanMarkdown(title)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "report-assistente-ai";
  return `${slug}-${date.toISOString().slice(0, 10)}.pdf`;
}

function addWrappedText(doc, text, y, { bold = false, size = 10, logoDataUrl = null } = {}) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const lines = doc.splitTextToSize(cleanMarkdown(text), 178);
  const height = Math.max(1, lines.length) * (size * 0.48);
  if (y + height > pageHeight - 18) {
    doc.addPage();
    drawContentPageFrame(doc, logoDataUrl);
    y = 32;
  }
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(31, 45, 68);
  doc.text(lines, 16, y);
  return y + height + 2.5;
}

const BRAND = {
  navy: [17, 38, 64],
  green: [22, 145, 88],
  ink: [31, 45, 68],
  pale: [238, 247, 243],
};

function firstBodyLine(content, title) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => cleanMarkdown(line))
    .find((line) => line && line !== title && !/^[-*]\s+/.test(line)) || "Documento elaborato dall'Assistente AI";
}

function drawBrandMark(doc, logoDataUrl, x, y, width = 70, height = 25) {
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", x, y, width, height, undefined, "FAST");
      return;
    } catch {
      // Il marchio testuale mantiene il documento utilizzabile anche offline.
    }
  }
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.7);
  doc.rect(x, y, width, height);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text("PROGRE", x + width / 2, y + 11, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("H U M A N   C O S M E T I C S", x + width / 2, y + 18, { align: "center" });
}

function drawCover(doc, { title, subtitle, generatedAt, author, logoDataUrl }) {
  doc.setFillColor(...BRAND.navy);
  doc.rect(0, 0, 210, 297, "F");
  drawBrandMark(doc, logoDataUrl, 24, 23, 78, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(218, 229, 242);
  doc.text("WORKSPACE + PROGREMES / MES", 24, 62);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("REPORT AI", 24, 100);
  doc.setFontSize(25);
  const titleLines = doc.splitTextToSize(title, 156);
  doc.text(titleLines, 24, 114);
  const titleHeight = titleLines.length * 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(218, 229, 242);
  doc.text(doc.splitTextToSize(subtitle, 156), 24, 119 + titleHeight);
  doc.setFontSize(9.5);
  doc.text("Data di elaborazione", 24, 208);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(generatedAt.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }), 24, 218);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(218, 229, 242);
  doc.text("Preparato da", 24, 238);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(author, 24, 248);
  doc.setFillColor(...BRAND.green);
  doc.rect(24, 272, 38, 2, "F");
}

function drawContentPageFrame(doc, logoDataUrl = null) {
  doc.setFillColor(...BRAND.navy);
  doc.rect(0, 0, 210, 18, "F");
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, "PNG", 16, 3, 35, 12, undefined, "FAST"); } catch { /* fallback sotto */ }
  }
  if (!logoDataUrl) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text("PROGRE", 16, 11.5);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(218, 229, 242);
  doc.text("WORKSPACE + PROGREMES / MES", 194, 11.5, { align: "right" });
  doc.setFillColor(...BRAND.green);
  doc.rect(16, 23, 12, 1.5, "F");
}

export function buildAssistantPdf({ content, generatedAt = new Date(), author = "Progre AI", includeChart = false, logoDataUrl = null, managedLetterhead = false }) {
  const title = assistantReportTitle(content);
  const subtitle = firstBodyLine(content, title).slice(0, 180);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const lines = String(content || "").split(/\r?\n/);

  if (managedLetterhead) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...BRAND.navy); doc.text("REPORT AI", 24, 92);
    doc.setFontSize(25); doc.text(doc.splitTextToSize(title, 156), 24, 108);
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(doc.splitTextToSize(subtitle, 156), 24, 145);
    doc.setFontSize(9.5); doc.text(`Data di elaborazione: ${generatedAt.toLocaleDateString("it-IT")}`, 24, 220);
    doc.text(`Preparato da: ${author}`, 24, 232);
  } else drawCover(doc, { title, subtitle, generatedAt, author, logoDataUrl });
  doc.addPage();
  if (!managedLetterhead) drawContentPageFrame(doc, logoDataUrl);

  let y = 32;
  if (includeChart) y = (drawAssistantChartPdf(doc, content, 16, y, 178, 72) || y) + 7;
  for (let index = 0; index < lines.length;) {
    const raw = lines[index].trim();
    if (!raw || cleanMarkdown(raw) === title) {
      index += 1;
      continue;
    }
    if (raw.startsWith("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const head = [tableCells(raw)];
      const body = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        body.push(tableCells(lines[index]));
        index += 1;
      }
      autoTable(doc, {
        startY: y,
        head,
        body,
        margin: { left: 16, right: 16, top: 28, bottom: 18 },
        theme: "grid",
        styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2, textColor: [31, 45, 68], lineColor: [214, 225, 239] },
        headStyles: { fillColor: BRAND.navy, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: BRAND.pale },
        didDrawPage: () => { if (!managedLetterhead) drawContentPageFrame(doc, logoDataUrl); },
      });
      y = (doc.lastAutoTable?.finalY || y) + 6;
      continue;
    }
    const isHeading = /^#{1,6}\s+/.test(raw);
    y = addWrappedText(doc, raw.replace(/^[-*]\s+/, "- "), y, { bold: isHeading, size: isHeading ? 12 : 10, logoDataUrl });
    index += 1;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 2; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(220, 228, 239);
    doc.line(16, 283, 194, 283);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(108, 121, 144);
    doc.text("Documento generato da Progre AI - dati interni autorizzati", 16, 289);
    doc.text(`Pagina ${page - 1} di ${Math.max(1, pages - 1)}`, 194, 289, { align: "right" });
  }
  return doc;
}

export function downloadAssistantPdf({ content, generatedAt = new Date(), author }) {
  const title = assistantReportTitle(content);
  const doc = buildAssistantPdf({ content, generatedAt, author });
  doc.save(assistantReportFilename(title, generatedAt));
}
