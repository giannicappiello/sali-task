import { jsPDF } from "jspdf";
import { calculateOrderEconomics } from "./orderEconomics.js";

// All measurements in this file are millimetres: the document deliberately
// follows the compact, ruled layout used by Mexal printouts rather than the
// application's UI language.
const PAGE = { width: 210, height: 297, left: 7, right: 203, top: 7, bottom: 290 };
const ARTICLE = { top: 82, bottom: 210, header: 6, row: 8 };
const COLS = [7, 31, 101, 111, 123, 143, 164, 181, 203];
const RULE = [54, 54, 54];

function number(value) { return Number(value || 0); }
function money(value) { return number(value).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function quantity(value) { return number(value).toLocaleString("it-IT", { maximumFractionDigits: 3 }); }
function valueOrBlank(value) { return value === null || value === undefined || value === "" ? "" : String(value); }
function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("it-IT").format(date);
}

function vatSummary(lines) {
  return lines.reduce((summary, line) => {
    const rate = number(line.aliquota_iva);
    const current = summary.get(rate) || { imponibile: 0, iva: 0 };
    current.imponibile += number(line.imponibile_riga);
    current.iva += number(line.iva_riga);
    summary.set(rate, current);
    return summary;
  }, new Map());
}

export function getMexalDocumentNumbers(order = {}) {
  const documents = [
    ["OCM", order.numero_ocm],
    ["OCX", order.numero_ocx],
    ["OCI", order.numero_oci],
    ...(order.documenti_mexal || []).map((document) => [
      String(document.tipo_documento || document.tipo || "").toUpperCase(),
      document.numero,
    ]),
  ];

  const seen = new Set();
  return documents
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([type, value]) => {
      const normalizedType = ["OCM", "OCX", "OCI"].includes(type) ? type : "";
      const normalizedValue = String(value).trim();
      const key = `${normalizedType}:${normalizedValue}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return normalizedType ? `${normalizedType} ${normalizedValue}` : normalizedValue;
    })
    .filter(Boolean);
}

export function buildOrderPdfModel(order, lines) {
  const totals = calculateOrderEconomics(lines);
  return {
    lines: totals.righe,
    totals,
    totale_merce: totals.righe.reduce((sum, line) => sum + number(line.quantita) * number(line.prezzo_listino), 0),
    vat: [...vatSummary(totals.righe).entries()],
    documents: getMexalDocumentNumbers(order),
  };
}

const COMPANY_LOGO_DATA_URL = "data:image/png;base64,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đ==";

async function getCompanyLogo() {
  return COMPANY_LOGO_DATA_URL;
}

function ruled(doc, x, y, width, height, fill = false) {
  if (fill) { doc.setFillColor(238, 238, 238); doc.rect(x, y, width, height, "F"); }
  doc.setDrawColor(...RULE); doc.setLineWidth(0.18); doc.rect(x, y, width, height);
}
function line(doc, x1, y1, x2, y2) { doc.setDrawColor(...RULE); doc.setLineWidth(0.18); doc.line(x1, y1, x2, y2); }
function small(doc, text, x, y, options = {}) { doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.text(String(text).toUpperCase(), x, y, options); }
function normal(doc, text, x, y, options = {}) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); doc.text(valueOrBlank(text), x, y, options); }

// Fits arbitrary values into the usable area of a ruled cell. It starts at the
// preferred size, progressively reduces it, wraps at most maxLines lines, and
// trims only if no readable size can contain the value.
export function fitTextInCell(doc, text, x, y, width, height, {
  align = "left", fontSize = 7.4, minFontSize = 5, maxLines = 2, lineHeight = 1.15,
} = {}) {
  const value = valueOrBlank(text);
  if (!value || width <= 0 || height <= 0) return { lines: [], fontSize };
  let size = fontSize;
  let lines = [];
  const canFit = (candidate) => candidate.length <= maxLines && candidate.length * size * lineHeight * 0.3528 <= height;
  while (size >= minFontSize) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(size);
    lines = doc.splitTextToSize(value, width);
    if (canFit(lines)) break;
    size = Math.round((size - 0.2) * 10) / 10;
  }
  if (!canFit(lines)) {
    doc.setFontSize(size);
    const ellipsis = "…";
    const truncate = (source) => {
      let candidate = source;
      while (candidate && doc.getTextWidth(`${candidate}${ellipsis}`) > width) candidate = candidate.slice(0, -1);
      return `${candidate}${ellipsis}`;
    };
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = truncate(lines[maxLines - 1] || value);
  }
  const step = size * lineHeight * 0.3528;
  const startY = y + size * 0.3528;
  doc.setFont("helvetica", "normal"); doc.setFontSize(size);
  lines.forEach((entry, index) => doc.text(entry, x, startY + index * step, { align, maxWidth: width }));
  return { lines, fontSize: size };
}

function cell(doc, x, y, w, h, label, content, options = {}) {
  const paddingLeft = options.paddingLeft ?? 1.4;
  const paddingRight = options.paddingRight ?? 1.4;
  const labelY = options.labelY ?? y + 2.8;
  const valueY = options.valueY ?? y + 4.3;
  const valueHeight = options.valueHeight ?? h - (valueY - y) - 1.2;
  const align = options.align ?? options.text?.align ?? "left";
  const fontSize = options.fontSize ?? 7.0;
  const maxLines = options.maxLines ?? 1;
  ruled(doc, x, y, w, h, options.shaded);
  small(doc, label, x + paddingLeft, labelY);
  const valueX = align === "right" ? x + w - paddingRight : align === "center" ? x + w / 2 : x + paddingLeft;
  return fitTextInCell(doc, content, valueX, valueY, w - paddingLeft - paddingRight, valueHeight, {
    align, fontSize, maxLines, minFontSize: options.minFontSize ?? 5,
  });
}

function drawCompanyHeader(doc, logo, continuation = false) {
  const y = PAGE.top;
  const maxWidth = continuation ? 44 : 72;
  const maxHeight = continuation ? 14 : 22;
  if (logo) {
    const props = doc.getImageProperties(logo);
    const ratio = props.width / props.height;
    let width = maxWidth;
    let height = width / ratio;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }
    doc.addImage(logo, "PNG", PAGE.left, y + (24 - height) / 2, width, height);
  } else {
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("PROGRÉ", PAGE.left + 1, y + 12);
  }
  const x = continuation ? 78 : 114;
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text("PROGRE’ SRL", x, y + 4);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.9);
  [
    "Sede Legale: Via A. Omodeo, 91 - 80128 Napoli (NA)",
    "Sede Operativa: Via Campo di Fiume, 10 - 83030 Montefredane (AV)",
    "Tel. 0825 45 84 78 - Email: info@progre.it",
    "P.IVA 05359771218 - SDI: 5RUO82D",
    "Iban IT42 Q 02008 39811 0000 1060 3915",
    "Swift UNCRITM1620",
  ].forEach((text, index) => doc.text(text, x, y + 7.2 + index * 2.65));
  line(doc, PAGE.left, continuation ? 27 : 31, PAGE.right, continuation ? 27 : 31);
}

function drawPartyBlock(doc, order, model) {
  const y = 32; const left = 7; const mid = 119; const right = 203;
  cell(doc, left, y, 42, 12, "Cliente - Zona", [order.codice_cliente, order.zona].filter(Boolean).join(" - "));
  cell(doc, 49, y, 35, 12, "Partita IVA", order.partita_iva || order.piva);
  cell(doc, 84, y, 35, 12, "Codice fiscale", order.codice_fiscale);
  cell(doc, left, y + 12, 61, 12, "Condizioni pagamento", order.descrizione_pagamento || order.codice_pagamento);
  cell(doc, 68, y + 12, 16, 12, "Valuta", order.valuta || "EUR");
  cell(doc, 84, y + 12, 35, 12, "Documento", order.tipo_documento || "ORDINE");
  cell(doc, left, y + 24, 56, 12, "Agente", order.codice_agente_mexal || order.agente);
  cell(doc, 63, y + 24, 56, 12, "Numero", model.documents.join(" / "), { maxLines: 2, fontSize: 7, minFontSize: 5 });
  cell(doc, left, y + 36, 56, 12, "Appoggio bancario", order.appoggio_bancario);
  cell(doc, 63, y + 36, 34, 12, "Data", formatDate(order.data_ordine));
  cell(doc, 97, y + 36, 22, 12, "Pagina", "1", { align: "center" });
  cell(doc, mid, y, right - mid, 24, "Spett.le cliente", [order.ragione_sociale_cliente || order.ragione_sociale, order.indirizzo_fatturazione || order.indirizzo, [order.cap, order.comune || order.localita, order.provincia].filter(Boolean).join(" "), order.telefono].filter(Boolean).join("\n"), { maxLines: 4, fontSize: 6.6, valueHeight: 18 });
  cell(doc, mid, y + 24, right - mid, 24, "Destinazione", [order.destinazione || order.indirizzo_spedizione, order.indirizzo_destinazione, [order.cap_destinazione, order.comune_destinazione, order.provincia_destinazione].filter(Boolean).join(" ")].filter(Boolean).join("\n"), { maxLines: 3, fontSize: 6.6, valueHeight: 18 });
}

function drawArticleGrid(doc, top, bottom) {
  ruled(doc, PAGE.left, top, PAGE.right - PAGE.left, bottom - top);
  COLS.slice(1, -1).forEach((x) => line(doc, x, top, x, bottom));
  line(doc, PAGE.left, top + ARTICLE.header, PAGE.right, top + ARTICLE.header);
  const labels = ["ARTICOLO", "DESCRIZIONE", "U.M.", "QTA", "PREZZO", "IMPORTO"];
  labels.forEach((label, index) => small(doc, label, COLS[index] + 1, top + 4));
  small(doc, "SCONTO", (COLS[6] + COLS[7]) / 2, top + 4, { align: "center" });
  small(doc, "ALI. IVA", COLS[8] - 2.2, top + 4, { align: "right" });
}

function discountRows(lineItem) {
  const parts = valueOrBlank(lineItem.sconto_commerciale).split("+").filter(Boolean);
  const commercial = parts.reduce((rows, part, index) => {
    if (index % 2 === 0) rows.push(index ? `+${part}` : part); else rows[rows.length - 1] += `+${part}`;
    return rows;
  }, []);
  const payment = lineItem.sconto_pagamento || lineItem.sconto_pagamento_percentuale;
  return payment ? [...commercial, valueOrBlank(payment)] : commercial;
}

function drawArticleRow(doc, lineItem, y) {
  normal(doc, lineItem.codice_articolo || lineItem.codice || "", COLS[0] + 1, y + 3.1, { maxWidth: 22 });
  normal(doc, lineItem.ean || "", COLS[0] + 1, y + 6.5, { maxWidth: 22 });
  normal(doc, lineItem.descrizione || lineItem.nome || "", COLS[1] + 1, y + 3.2, { maxWidth: 67 });
  normal(doc, lineItem.unita_misura || "", (COLS[2] + COLS[3]) / 2, y + 4.5, { align: "center" });
  normal(doc, quantity(lineItem.quantita), COLS[4] - 1, y + 4.5, { align: "right" });
  normal(doc, money(lineItem.prezzo_listino), COLS[5] - 1, y + 4.5, { align: "right" });
  normal(doc, money(number(lineItem.quantita) * number(lineItem.prezzo_listino)), COLS[6] - 1, y + 4.5, { align: "right" });

  const discounts = discountRows(lineItem).slice(0, 2);
  discounts.forEach((discount, index) => fitTextInCell(
    doc,
    discount,
    (COLS[6] + COLS[7]) / 2,
    y + 1.5 + index * 3.2,
    COLS[7] - COLS[6] - 3,
    3.1,
    { align: "center", fontSize: 7.1, minFontSize: 5.8, maxLines: 1 },
  ));

  fitTextInCell(
    doc,
    valueOrBlank(lineItem.aliquota_iva),
    COLS[8] - 2.2,
    y + 2.2,
    COLS[8] - COLS[7] - 4.2,
    3.5,
    { align: "right", fontSize: 7.1, minFontSize: 6, maxLines: 1 },
  );
}

function drawFooter(doc, order, model) {
  const y = 210; const totalsX = 156; const totalsW = 47;
  const totalCell = (top, height, label, amount, options = {}) => cell(doc, totalsX, top, totalsW, height, label, amount, {
    shaded: true, align: "right", paddingRight: 2.2, fontSize: 8, ...options,
  });
  cell(doc, 7, y, 55, 10, "Vettore", order.vettore);
  cell(doc, 62, y, 49, 10, "Data e ora trasporto", [formatDate(order.data_trasporto), order.ora_trasporto].filter(Boolean).join(" "));
  cell(doc, 111, y, 45, 10, "Spese di trasporto", order.spese_trasporto ? money(order.spese_trasporto) : "", { align: "right" });
  totalCell(y, 10, "Totale merce", money(model.totale_merce));
  cell(doc, 7, y + 10, 55, 10, "Domicilio vettore", order.domicilio_vettore);
  cell(doc, 62, y + 10, 49, 10, "Sconto merce", order.sconto_merce);
  cell(doc, 111, y + 10, 45, 10, "Merce omaggio", order.merce_omaggio);
  totalCell(y + 10, 10, "Totale imponibile", money(model.totals.totale_imponibile));
  cell(doc, 7, y + 20, 45, 18, "Causale di trasporto", order.causale_trasporto, { maxLines: 2 });
  const vatX = 52; const vatY = y + 20; const vatW = 104; const vatH = 18;
  const vatColumns = [
    { label: "Aliquota", x: vatX, width: 16, align: "center" },
    { label: "Imposta", x: vatX + 16, width: 20, align: "right" },
    { label: "Imponibile", x: vatX + 36, width: 24, align: "right" },
    { label: "Scadenza", x: vatX + 60, width: 22, align: "center" },
    { label: "Importo", x: vatX + 82, width: 22, align: "right" },
  ];
  ruled(doc, vatX, vatY, vatW, vatH);
  vatColumns.slice(1).forEach(({ x }) => line(doc, x, vatY, x, vatY + vatH));
  vatColumns.forEach(({ label, x }) => small(doc, label, x + 1.2, vatY + 2.8));
  model.vat.slice(0, 3).forEach(([rate, vatTotals], index) => {
    const rowY = vatY + 4.2 + index * 3.7;
    const values = [rate, money(vatTotals.iva), money(vatTotals.imponibile), formatDate(order.scadenza), money(vatTotals.imponibile + vatTotals.iva)];
    vatColumns.forEach(({ x, width, align }, valueIndex) => fitTextInCell(doc, values[valueIndex], align === "right" ? x + width - 1.2 : x + width / 2, rowY, width - 2.4, 3, { align, fontSize: 6.2, minFontSize: 5, maxLines: 1 }));
  });
  totalCell(y + 20, 18, "Totale IVA", money(model.totals.totale_iva));
  cell(doc, 7, y + 38, 55, 9, "Trasporto a cura del", order.trasporto_a_cura_del);
  cell(doc, 62, y + 38, 49, 9, "Aspetto esteriore dei beni", order.aspetto_esteriore_beni);
  cell(doc, 111, y + 38, 45, 9, "Abbuono", order.abbuono === null || order.abbuono === undefined || order.abbuono === "" ? "" : money(order.abbuono), { align: "right" });
  totalCell(y + 38, 9, "Totale fattura", money(model.totals.totale_documento));
  cell(doc, 7, y + 47, 78, 11, "Note", order.commenti || order.note_mexal, { maxLines: 2, fontSize: 6.5 });
  cell(doc, 85, y + 47, 14, 11, "Colli", order.colli, { align: "right" });
  cell(doc, 99, y + 47, 14, 11, "Peso", order.peso, { align: "right" });
  cell(doc, 113, y + 47, 14, 11, "Volume", order.volume, { align: "right" });
  cell(doc, 127, y + 47, 14, 11, "Porto", order.porto, { align: "center" });
  cell(doc, 141, y + 47, 15, 11, "Acconto", order.acconto === null || order.acconto === undefined || order.acconto === "" ? "" : money(order.acconto), { align: "right" });
  const due = model.totals.totale_documento - number(order.acconto) - number(order.abbuono);
  totalCell(y + 47, 11, "Totale da pagare", money(due), { fontSize: 7.6 });
  const signY = 268;
  [[7, "Firma vettore"], [72.33, "Firma conducente"], [137.66, "Firma destinatario"]].forEach(([x, label]) => { ruled(doc, x, signY, 65.34, 16); small(doc, label, x + 1.5, signY + 3); });
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.4); doc.text("Informativa privacy disponibile presso la sede aziendale - documento generato da Workspace", 105, 288, { align: "center" });
  line(doc, 7, 290, 203, 290);
}

export async function createOrderPdf(order, lines, { logo = null } = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const model = buildOrderPdfModel(order, lines);
  const companyLogo = logo === null ? await getCompanyLogo() : logo;
  const firstCapacity = Math.floor((ARTICLE.bottom - ARTICLE.top - ARTICLE.header) / ARTICLE.row);
  const continuationCapacity = Math.floor((260 - 29 - ARTICLE.header) / ARTICLE.row);
  const pageRows = [];
  let offset = 0;
  do {
    const capacity = pageRows.length ? continuationCapacity : firstCapacity;
    pageRows.push(model.lines.slice(offset, offset + capacity));
    offset += capacity;
  } while (offset < model.lines.length);
  const pages = pageRows.length;
  for (let page = 0; page < pages; page += 1) {
    if (page) doc.addPage();
    const continuation = page > 0;
    drawCompanyHeader(doc, companyLogo, continuation);
    if (!continuation) drawPartyBlock(doc, order, model);
    const articleTop = continuation ? 29 : ARTICLE.top;
    const articleBottom = continuation ? 260 : ARTICLE.bottom;
    drawArticleGrid(doc, articleTop, articleBottom);
    const capacity = Math.floor((articleBottom - articleTop - ARTICLE.header) / ARTICLE.row);
    pageRows[page].slice(0, capacity).forEach((lineItem, index) => drawArticleRow(doc, lineItem, articleTop + ARTICLE.header + index * ARTICLE.row));
    normal(doc, `${page + 1}/${pages}`, 201, continuation ? 25 : 78, { align: "right" });
    if (page === pages - 1) drawFooter(doc, order, model);
  }
  return doc;
}

export async function downloadOrderPdf(order, lines) {
  const doc = await createOrderPdf(order, lines);
  const mexalNumber = getMexalDocumentNumbers(order)[0]?.replace(/\s+/g, "-");
  doc.save(`ordine-${mexalNumber || "bozza"}.pdf`);
}
