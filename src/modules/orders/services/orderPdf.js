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

export function buildOrderPdfModel(order, lines) {
  const totals = calculateOrderEconomics(lines);
  return {
    lines: totals.righe,
    totals,
    totale_merce: totals.righe.reduce((sum, line) => sum + number(line.quantita) * number(line.prezzo_listino), 0),
    vat: [...vatSummary(totals.righe).entries()],
    documents: [order.numero_ocm, order.numero_ocx, order.numero_oci].filter(Boolean),
  };
}

async function getCompanyLogo() {
  try {
    const response = await fetch("/pwa-512x512.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function ruled(doc, x, y, width, height, fill = false) {
  if (fill) { doc.setFillColor(238, 238, 238); doc.rect(x, y, width, height, "F"); }
  doc.setDrawColor(...RULE); doc.setLineWidth(0.18); doc.rect(x, y, width, height);
}
function line(doc, x1, y1, x2, y2) { doc.setDrawColor(...RULE); doc.setLineWidth(0.18); doc.line(x1, y1, x2, y2); }
function small(doc, text, x, y, options = {}) { doc.setFont("helvetica", "bold"); doc.setFontSize(5.8); doc.text(String(text).toUpperCase(), x, y, options); }
function normal(doc, text, x, y, options = {}) { doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); doc.text(valueOrBlank(text), x, y, options); }
function cell(doc, x, y, w, h, label, content, options = {}) {
  ruled(doc, x, y, w, h, options.shaded);
  small(doc, label, x + 1.4, y + 2.8);
  normal(doc, content, x + 1.4, y + 7.1, { maxWidth: w - 2.8, ...options.text });
}

function drawCompanyHeader(doc, logo, continuation = false) {
  const y = PAGE.top;
  if (logo) {
    const props = doc.getImageProperties(logo);
    const maxW = continuation ? 24 : 33; const maxH = continuation ? 16 : 23;
    const ratio = props.width / props.height;
    const w = Math.min(maxW, maxH * ratio); const h = w / ratio;
    doc.addImage(logo, "PNG", PAGE.left, y + 1, w, h);
  } else {
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("PROGRÉ", PAGE.left, y + 12);
  }
  const x = continuation ? 108 : 91;
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text("PROGRE’ SRL", x, y + 4);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.9);
  [
    "Sede Legale: Via A. Omodeo, 91 - 80122 Napoli (NA)",
    "Sede Operativa: Via Campo di Fiume, 10 - 83030 Montefredane (AV)",
    "Tel. 0825 45 84 78 - Email: info@progre.it",
    "P.IVA 05359771218 - SDI: 5RUO82D",
    "Iban IT42 Q 02008 39811 0000 1060 3915",
    "Swift UNCRITM1620",
  ].forEach((text, index) => doc.text(text, x, y + 7.2 + index * 2.65));
  line(doc, PAGE.left, continuation ? 27 : 31, PAGE.right, continuation ? 27 : 31);
}

function drawPartyBlock(doc, order) {
  const y = 32; const left = 7; const mid = 119; const right = 203;
  // Left accounting grid.
  cell(doc, left, y, 42, 12, "Cliente - Zona", [order.codice_cliente, order.zona].filter(Boolean).join(" - "));
  cell(doc, 49, y, 35, 12, "Partita IVA", order.partita_iva || order.piva);
  cell(doc, 84, y, 35, 12, "Codice fiscale", order.codice_fiscale);
  cell(doc, left, y + 12, 61, 12, "Condizioni pagamento", order.descrizione_pagamento || order.codice_pagamento);
  cell(doc, 68, y + 12, 16, 12, "Valuta", order.valuta || "EUR");
  cell(doc, 84, y + 12, 35, 12, "Documento", order.tipo_documento || "ORDINE");
  cell(doc, left, y + 24, 56, 12, "Agente", order.codice_agente_mexal || order.agente);
  cell(doc, 63, y + 24, 56, 12, "Numero", order.numero_ordine || order.id);
  cell(doc, left, y + 36, 56, 12, "Appoggio bancario", order.appoggio_bancario);
  cell(doc, 63, y + 36, 34, 12, "Data", formatDate(order.data_ordine));
  cell(doc, 97, y + 36, 22, 12, "Pagina", "1");
  // Customer and delivery address follow the same boxed hierarchy.
  cell(doc, mid, y, right - mid, 24, "Spett.le cliente", order.ragione_sociale_cliente || order.ragione_sociale);
  normal(doc, order.indirizzo_fatturazione || order.indirizzo || "", mid + 1.4, y + 12, { maxWidth: right - mid - 3 });
  normal(doc, [order.cap, order.comune || order.localita, order.provincia].filter(Boolean).join(" "), mid + 1.4, y + 17, { maxWidth: right - mid - 3 });
  normal(doc, order.telefono || "", mid + 1.4, y + 22, { maxWidth: right - mid - 3 });
  cell(doc, mid, y + 24, right - mid, 24, "Destinazione", order.destinazione || order.indirizzo_spedizione);
  normal(doc, order.indirizzo_destinazione || "", mid + 1.4, y + 36, { maxWidth: right - mid - 3 });
  normal(doc, [order.cap_destinazione, order.comune_destinazione, order.provincia_destinazione].filter(Boolean).join(" "), mid + 1.4, y + 42, { maxWidth: right - mid - 3 });
}

function drawArticleGrid(doc, top, bottom) {
  ruled(doc, PAGE.left, top, PAGE.right - PAGE.left, bottom - top);
  COLS.slice(1, -1).forEach((x) => line(doc, x, top, x, bottom));
  line(doc, PAGE.left, top + ARTICLE.header, PAGE.right, top + ARTICLE.header);
  const labels = ["ARTICOLO", "DESCRIZIONE", "U.M.", "QTA", "PREZZO", "IMPORTO", "SCONTO", "ALI. IVA"];
  labels.forEach((label, index) => small(doc, label, COLS[index] + 1, top + 4));
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
  line(doc, PAGE.left, y + ARTICLE.row, PAGE.right, y + ARTICLE.row);
  normal(doc, lineItem.codice_articolo || lineItem.codice || "", COLS[0] + 1, y + 3.1, { maxWidth: 22 });
  normal(doc, lineItem.ean || "", COLS[0] + 1, y + 6.5, { maxWidth: 22 });
  normal(doc, lineItem.descrizione || lineItem.nome || "", COLS[1] + 1, y + 3.2, { maxWidth: 67 });
  normal(doc, lineItem.unita_misura || "", (COLS[2] + COLS[3]) / 2, y + 4.5, { align: "center" });
  normal(doc, quantity(lineItem.quantita), COLS[4] - 1, y + 4.5, { align: "right" });
  normal(doc, money(lineItem.prezzo_listino), COLS[5] - 1, y + 4.5, { align: "right" });
  normal(doc, money(number(lineItem.quantita) * number(lineItem.prezzo_listino)), COLS[6] - 1, y + 4.5, { align: "right" });
  discountRows(lineItem).slice(0, 2).forEach((discount, index) => normal(doc, discount, COLS[6] + 1, y + 3.2 + index * 3.2, { maxWidth: 15 }));
  normal(doc, valueOrBlank(lineItem.aliquota_iva), COLS[8] - 1, y + 4.5, { align: "right" });
}

function drawFooter(doc, order, model) {
  const y = 210;
  // Three compact bands model the original transport and totals matrix.
  cell(doc, 7, y, 55, 10, "Vettore", order.vettore);
  cell(doc, 62, y, 49, 10, "Data e ora trasporto", [formatDate(order.data_trasporto), order.ora_trasporto].filter(Boolean).join(" "));
  cell(doc, 111, y, 45, 10, "Spese di trasporto", order.spese_trasporto ? money(order.spese_trasporto) : "");
  cell(doc, 156, y, 47, 10, "Totale merce", money(model.totale_merce), { shaded: true, text: { align: "right" } });
  cell(doc, 7, y + 10, 55, 10, "Domicilio vettore", order.domicilio_vettore);
  cell(doc, 62, y + 10, 49, 10, "Sconto merce", order.sconto_merce);
  cell(doc, 111, y + 10, 45, 10, "Merce omaggio", order.merce_omaggio);
  cell(doc, 156, y + 10, 47, 10, "Totale imponibile", money(model.totals.totale_imponibile), { shaded: true, text: { align: "right" } });
  cell(doc, 7, y + 20, 55, 18, "Causale di trasporto", order.causale_trasporto);
  ruled(doc, 62, y + 20, 94, 18); small(doc, "Aliquota", 63, y + 22.8); small(doc, "Imposta", 80, y + 22.8); small(doc, "Imponibile", 99, y + 22.8); small(doc, "Scadenza", 120, y + 22.8); small(doc, "Importo", 141, y + 22.8);
  [78, 97, 118, 139].forEach((x) => line(doc, x, y + 20, x, y + 38));
  model.vat.slice(0, 3).forEach(([rate, totals], index) => {
    const rowY = y + 27 + index * 3.2;
    normal(doc, rate, 76, rowY, { align: "right" }); normal(doc, money(totals.iva), 96, rowY, { align: "right" }); normal(doc, money(totals.imponibile), 117, rowY, { align: "right" });
    normal(doc, formatDate(order.scadenza), 138, rowY, { align: "right" }); normal(doc, money(totals.imponibile + totals.iva), 155, rowY, { align: "right" });
  });
  cell(doc, 156, y + 20, 47, 18, "Totale IVA", money(model.totals.totale_iva), { shaded: true, text: { align: "right" } });
  cell(doc, 7, y + 38, 55, 9, "Trasporto a cura del", order.trasporto_a_cura_del);
  cell(doc, 62, y + 38, 49, 9, "Aspetto esteriore dei beni", order.aspetto_esteriore_beni);
  cell(doc, 111, y + 38, 45, 9, "Abbuono", order.abbuono ? money(order.abbuono) : "");
  cell(doc, 156, y + 38, 47, 9, "Totale fattura", money(model.totals.totale_documento), { shaded: true, text: { align: "right" } });
  cell(doc, 7, y + 47, 104, 11, "Note", order.commenti || order.note_mexal);
  cell(doc, 111, y + 47, 15, 11, "Colli", order.colli);
  cell(doc, 126, y + 47, 15, 11, "Peso", order.peso);
  cell(doc, 141, y + 47, 15, 11, "Volume", order.volume);
  cell(doc, 156, y + 47, 15, 11, "Porto", order.porto);
  cell(doc, 171, y + 47, 16, 11, "Acconto", order.acconto ? money(order.acconto) : "");
  const due = model.totals.totale_documento - number(order.acconto) - number(order.abbuono);
  cell(doc, 187, y + 47, 16, 11, "Totale da pagare", money(due), { shaded: true, text: { align: "right" } });
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
    if (!continuation) drawPartyBlock(doc, order);
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
  doc.save(`ordine-${order.numero_ordine || order.id}.pdf`);
}
