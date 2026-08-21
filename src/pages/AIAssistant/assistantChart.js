function clean(value) {
  return String(value || "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
}

function cells(line) {
  return String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(clean);
}

function numberValue(value) {
  const normalized = clean(value).replace(/[^\d,.-]/g, "");
  if (!normalized) return Number.NaN;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  const decimal = comma > dot ? "," : ".";
  const compact = decimal === "," ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  return Number(compact);
}

export function extractAssistantChart(content) {
  const lines = String(content || "").split(/\r?\n/);
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index].trim().startsWith("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) continue;
    const headers = cells(lines[index]);
    const rows = [];
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      rows.push(cells(lines[index]));
      index += 1;
    }
    if (headers.length < 2 || rows.length < 1) continue;
    const numericColumn = headers.findIndex((_, column) => column > 0 && rows.filter((row) => Number.isFinite(numberValue(row[column]))).length >= Math.min(2, rows.length));
    if (numericColumn < 1) continue;
    const points = rows.map((row) => ({ label: row[0] || "Voce", value: numberValue(row[numericColumn]) })).filter((point) => Number.isFinite(point.value)).slice(0, 16);
    if (points.length) {
      const heading = lines.slice(0, Math.max(0, index - rows.length - 2)).reverse().find((line) => /^#{1,6}\s+/.test(line.trim()));
      return { title: clean(heading?.replace(/^#{1,6}\s+/, "") || headers[numericColumn] || "Grafico analisi"), valueLabel: headers[numericColumn], points };
    }
  }
  return null;
}

function escapeXml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function compactLabel(value, length = 22) {
  const text = clean(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function buildAssistantChartSvg(content, { logoHref = "/progre-logo-white.png" } = {}) {
  const chart = extractAssistantChart(content);
  const width = 960;
  const height = 640;
  const brandHeader = `<rect width="${width}" height="120" fill="#112640"/><image href="${escapeXml(logoHref)}" x="42" y="18" width="270" height="90" preserveAspectRatio="xMidYMid meet"/><text x="910" y="52" text-anchor="end" font-family="Arial" font-size="22" font-weight="700" fill="#fff">PROGRE AI</text><text x="910" y="82" text-anchor="end" font-family="Arial" font-size="16" fill="#d9e5f3">WORKSPACE + PROGREMES / MES</text>`;
  if (!chart) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${brandHeader}<text x="480" y="330" text-anchor="middle" font-family="Arial" font-size="25" fill="#344054">Dati numerici non disponibili</text><text x="480" y="370" text-anchor="middle" font-family="Arial" font-size="16" fill="#667085">Riformula la richiesta indicando valori e categorie da confrontare.</text></svg>`;
  }
  const margin = { top: 205, right: 45, bottom: 115, left: 85 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const max = Math.max(...chart.points.map((point) => point.value), 1);
  const slot = plotWidth / chart.points.length;
  const barWidth = Math.max(12, slot * 0.62);
  const bars = chart.points.map((point, index) => {
    const barHeight = Math.max(2, (point.value / max) * plotHeight);
    const x = margin.left + index * slot + (slot - barWidth) / 2;
    const y = margin.top + plotHeight - barHeight;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="5" fill="#126bff"/><text x="${(x + barWidth / 2).toFixed(1)}" y="${Math.max(margin.top - 8, y - 8).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="13" fill="#344054">${escapeXml(new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(point.value))}</text><text transform="translate(${(x + barWidth / 2).toFixed(1)} ${margin.top + plotHeight + 18}) rotate(40)" text-anchor="start" font-family="Arial" font-size="13" fill="#475467">${escapeXml(compactLabel(point.label))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${brandHeader}<text x="${margin.left}" y="165" font-family="Arial" font-size="28" font-weight="700" fill="#112640">${escapeXml(chart.title)}</text><text x="${margin.left}" y="190" font-family="Arial" font-size="15" fill="#667085">${escapeXml(chart.valueLabel)}</text><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="#d0d5dd"/>${bars}<rect x="0" y="615" width="960" height="25" fill="#eef4fa"/><text x="${margin.left}" y="632" font-family="Arial" font-size="12" fill="#667085">Dati interni autorizzati del Workspace</text><text x="${width - margin.right}" y="632" text-anchor="end" font-family="Arial" font-size="12" fill="#667085">Generato da Progre AI</text></svg>`;
}

export function drawAssistantChartPdf(doc, content, x = 16, y = 40, width = 178, height = 72) {
  const chart = extractAssistantChart(content);
  if (!chart) return null;
  const max = Math.max(...chart.points.map((point) => point.value), 1);
  const points = chart.points.slice(0, 10);
  const slot = width / points.length;
  const baseline = y + height - 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(31, 45, 68);
  doc.text(chart.title, x, y);
  points.forEach((point, index) => {
    const barHeight = Math.max(1, (point.value / max) * (height - 30));
    const barWidth = Math.max(3, slot * 0.58);
    const barX = x + index * slot + (slot - barWidth) / 2;
    doc.setFillColor(18, 107, 255);
    doc.roundedRect(barX, baseline - barHeight, barWidth, barHeight, 1, 1, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(71, 84, 103);
    doc.text(compactLabel(point.label, 12), barX + barWidth / 2, baseline + 4, { align: "center", angle: 35 });
  });
  doc.setDrawColor(208, 213, 221);
  doc.line(x, baseline, x + width, baseline);
  return y + height;
}
