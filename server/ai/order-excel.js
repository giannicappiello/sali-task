import * as XLSX from "xlsx";
import { normalizeOrderText } from "../../shared/orderDocumentMatching.js";

const TECHNICAL_SHEET = /^(ISTRUZIONI?|INSTRUCTIONS?|NOTE(?: TECNICHE?)?|LOOKUP|TABELLE? DI APPOGGIO|CONFIG|PARAMETRI|LEGENDA)$/i;
const SUMMARY_ROW = /^(SUB\s*TOTAL|SUBTOTALE|TOTALE|TOTAL|GRAND TOTAL|NOTE?|RIEPILOGO)\b/i;
const HEADER_ALIASES = {
  productCode: ["CODICE ARTICOLO", "CODICE", "ITEM CODE", "ITEM", "SKU ARTICOLO"],
  sku: ["SKU"],
  ean: ["EAN", "BARCODE", "CODICE EAN"],
  description: ["DESCRIZIONE ARTICOLO", "DESCRIZIONE", "PRODOTTO", "ARTICOLO", "PRODUCT", "ITEM DESCRIPTION"],
  quantity: ["QUANTITA", "QTA", "QTY", "QUANTITY", "QT"],
  customerName: ["CLIENTE", "RAGIONE SOCIALE", "CUSTOMER"],
  customerCode: ["CODICE CLIENTE", "COD CLIENTE", "CUSTOMER CODE"],
  vatNumber: ["PARTITA IVA", "P IVA", "PIVA", "VAT", "VAT NUMBER"],
  taxCode: ["CODICE FISCALE", "COD FISCALE", "CF", "TAX CODE"],
  email: ["EMAIL", "E MAIL", "PEC"],
  address: ["INDIRIZZO", "ADDRESS"],
  city: ["LOCALITA", "CITTA", "CITY"],
  orderNumber: ["NUMERO ORDINE", "N ORDINE", "NR ORDINE", "ORDER NUMBER", "ORDER NO"],
  orderDate: ["DATA ORDINE", "ORDER DATE", "DATA"],
};
const PRODUCT_COLUMNS = new Set(["productCode", "sku", "ean", "description", "quantity"]);
const META_COLUMNS = new Set(["customerName", "customerCode", "vatNumber", "taxCode", "email", "address", "city", "orderNumber", "orderDate"]);

function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normalizeHeader(value) { return normalizeOrderText(value).replace(/\bN\b/g, "NUMERO"); }
function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value); const match = raw.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (!match) return raw;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}
function aliasFor(value) {
  const key = normalizeHeader(value);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(key)) return field;
  return "";
}
function rowIsEmpty(row) { return !row.some((cell) => text(cell)); }
function rowValues(row) { return row.map((cell) => text(cell)).filter(Boolean); }
function looksCode(value) { return /^[A-Z0-9][A-Z0-9._/-]{2,}$/i.test(text(value)) && /\d/.test(text(value)); }

function expandedRows(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true });
  for (const merge of sheet["!merges"] || []) {
    const source = rows[merge.s.r]?.[merge.s.c] ?? "";
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      if (!rows[row]) rows[row] = [];
      for (let column = merge.s.c; column <= merge.e.c; column += 1) if (!text(rows[row][column])) rows[row][column] = source;
    }
  }
  return rows;
}

function headerCandidate(row) {
  const mapped = row.map(aliasFor); const unique = new Set(mapped.filter(Boolean));
  const productScore = [...unique].filter((field) => PRODUCT_COLUMNS.has(field)).length;
  const hasDescriptionOrCode = unique.has("description") || unique.has("productCode") || unique.has("sku") || unique.has("ean");
  return { mapped, score: productScore * 3 + [...unique].filter((field) => META_COLUMNS.has(field)).length, valid: hasDescriptionOrCode && unique.has("quantity") };
}

function findHeader(rows) {
  let best = null;
  rows.slice(0, 40).forEach((row, index) => {
    const candidate = headerCandidate(row);
    if (candidate.valid && (!best || candidate.score > best.score)) best = { ...candidate, index };
  });
  if (!best) return null;
  const articleIndex = best.mapped.findIndex((field, index) => field === "description" && normalizeHeader(rows[best.index][index]) === "ARTICOLO");
  if (articleIndex >= 0) {
    const samples = rows.slice(best.index + 1, best.index + 8).map((row) => row[articleIndex]).filter((value) => text(value) && !aliasFor(value));
    if (samples.length && samples.filter(looksCode).length / samples.length >= 0.7 && !best.mapped.includes("productCode")) best.mapped[articleIndex] = "productCode";
  }
  return best;
}

function metadataBeforeHeader(rows, headerIndex) {
  const result = {};
  for (const row of rows.slice(0, headerIndex)) {
    for (let column = 0; column < row.length - 1; column += 1) {
      const field = aliasFor(row[column]);
      if (field && META_COLUMNS.has(field) && text(row[column + 1])) result[field] ||= text(row[column + 1]);
    }
  }
  return result;
}

function isRepeatedHeader(row, mapping) {
  const mapped = row.map(aliasFor);
  return mapped.filter(Boolean).length >= 2 && mapped.some((field, index) => field && field === mapping[index]);
}

function sourceCells(row, mapping) {
  const cells = {};
  mapping.forEach((field, index) => { if (field && text(row[index])) cells[field] = row[index]; });
  return cells;
}

function extractSheet(sheet, sheetName, hidden) {
  const rows = expandedRows(sheet); const usedRows = rows.filter((row) => !rowIsEmpty(row)).length;
  if (!usedRows) return { excluded: true, sheetName, hidden, usedRows: 0, reason: "Foglio completamente vuoto." };
  const header = findHeader(rows);
  if (!header) {
    const reason = TECHNICAL_SHEET.test(sheetName) ? "Foglio tecnico/note senza tabella prodotti." : "Nessuna intestazione prodotto/quantità riconoscibile.";
    return { excluded: true, sheetName, hidden, usedRows, reason };
  }
  const metadata = metadataBeforeHeader(rows, header.index); const lines = [];
  rows.slice(header.index + 1).forEach((row, offset) => {
    if (rowIsEmpty(row) || isRepeatedHeader(row, header.mapped)) return;
    const cells = sourceCells(row, header.mapped); const description = text(cells.description);
    if (SUMMARY_ROW.test(normalizeOrderText(description || rowValues(row)[0]))) return;
    const quantity = number(cells.quantity);
    const productCode = text(cells.productCode); const sku = text(cells.sku); const ean = text(cells.ean);
    if (!(description || productCode || sku || ean) || quantity <= 0) return;
    lines.push({
      sourceText: rowValues(row).join(" | "), productCode, ean, sku, description,
      format: "", package: "", quantity, unit: "", confidence: 1,
      sheetName, rowNumber: header.index + offset + 2, sourceCells: cells,
      customer: {
        code: text(cells.customerCode || metadata.customerCode), name: text(cells.customerName || metadata.customerName), alias: "",
        vatNumber: text(cells.vatNumber || metadata.vatNumber), taxCode: text(cells.taxCode || metadata.taxCode), email: text(cells.email || metadata.email),
        address: text(cells.address || metadata.address), city: text(cells.city || metadata.city), confidence: 1,
      },
      documentNumber: text(cells.orderNumber || metadata.orderNumber), documentDate: isoDate(cells.orderDate || metadata.orderDate),
    });
  });
  if (!lines.length) return { excluded: true, sheetName, hidden, usedRows, reason: "Tabella rilevata ma nessuna riga prodotto valida; totali, note e righe vuote sono stati esclusi." };
  return {
    excluded: false, sheetName, hidden, usedRows, headerRow: header.index + 1,
    headers: header.mapped.map((field, index) => field ? { field, original: text(rows[header.index][index]) } : null).filter(Boolean),
    lines,
  };
}

function groupKey(line) {
  const customer = normalizeOrderText(line.customer.code || line.customer.vatNumber || line.customer.taxCode || line.customer.name);
  const order = normalizeOrderText(line.documentNumber); const date = normalizeOrderText(line.documentDate);
  return customer || order ? [customer, order, date].join("|") : `SHEET|${normalizeOrderText(line.sheetName)}`;
}

export function parseOrderWorkbook(data, { fileName = "workbook.xlsx" } = {}) {
  const workbook = XLSX.read(data, { type: "buffer", cellDates: true, cellFormula: false, cellNF: false });
  const hiddenByName = new Map((workbook.Workbook?.Sheets || []).map((item) => [item.name, Number(item.Hidden || 0)]));
  const analyzed = workbook.SheetNames.map((sheetName) => extractSheet(workbook.Sheets[sheetName], sheetName, hiddenByName.get(sheetName) || 0));
  const includedSheets = analyzed.filter((sheet) => !sheet.excluded).map(({ lines, ...sheet }) => ({ ...sheet, lineCount: lines.length }));
  const excludedSheets = analyzed.filter((sheet) => sheet.excluded).map((sheet) => {
    const report = { ...sheet }; delete report.excluded; return report;
  });
  const groups = new Map();
  for (const sheet of analyzed.filter((item) => !item.excluded)) for (const line of sheet.lines) {
    const key = groupKey(line);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  const orders = [...groups.values()].map((lines, index) => {
    const first = lines[0];
    return {
      previewId: `order-${index + 1}`, documentType: "NON_DETERMINATO", documentDate: first.documentDate || "", documentNumber: first.documentNumber || "",
      pageCount: 1, customer: first.customer, lines: lines.map((source) => {
        const line = { ...source }; delete line.customer; delete line.documentNumber; delete line.documentDate; return line;
      }),
      notes: `Import Excel da ${fileName}.`, warnings: [],
    };
  });
  return {
    kind: "excel", fileName, orders, includedSheets, excludedSheets,
    warnings: orders.length > 1 ? ["Il workbook contiene più ordini distinti: controlla e conferma ogni preview separatamente."] : [],
  };
}
