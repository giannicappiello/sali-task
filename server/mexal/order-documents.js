export const ORDER_DOCUMENTS = Object.freeze({
  OCM: Object.freeze({ moduleCode: "M", quantityField: "quantita_ocm" }),
  OCX: Object.freeze({ moduleCode: "X", quantityField: "quantita_ocx" }),
  OCI: Object.freeze({ moduleCode: "I", quantityField: "quantita_oci" }),
});

export const DEFAULT_MEXAL_ORDER_DATE_FORMAT = "yyyymmdd";

export function normalizeArticleCode(value) { return String(value ?? "").trim().toUpperCase(); }
export function isImportArticle(line) { return normalizeArticleCode(line?.codice_articolo ?? line?.productCode).startsWith("IMP"); }

export function reconciliationFailure(error, expectedModule, response) {
  const status = Number(error?.status || error?.httpStatus || 0);
  if (status === 401 || status === 403) return { stato: "auth_error", errore: error.message };
  if (status === 404) return { stato: "missing", errore: error.message };
  if (status >= 500 || /timeout|timed? out|econnreset|eai_again/i.test(String(error?.message || ""))) return { stato: "temporary_error", errore: error.message };
  const actualModule = text(response?.cod_modulo || response?.dati?.cod_modulo || response?.documento?.cod_modulo);
  if (response && actualModule !== expectedModule) return { stato: "mismatch", errore: `cod_modulo Mexal ${actualModule || "mancante"}.` };
  return null;
}

export function classifyOrderLines(lines) {
  return (lines || []).reduce((documents, line) => {
    if (isImportArticle(line)) { documents.OCI.push({ ...line, quantita_documento: Number(line.quantita) || 0 }); return documents; }
    for (const kind of ["OCM", "OCX"]) {
      const quantity = Number(line[ORDER_DOCUMENTS[kind].quantityField]) || 0;
      if (quantity > 0) documents[kind].push({ ...line, quantita_documento: quantity });
    }
    return documents;
  }, { OCM: [], OCX: [], OCI: [] });
}

const text = (value) => String(value ?? "").trim();
const number = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; };
const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));

export function formatMexalNota(value, format) {
  const note = text(value);
  if (!note) return undefined;
  if (format === "scalar") return note;
  if (format === "typed-array") return [[1, note]];
  throw new Error("MEXAL_ORDER_NOTA_FORMAT deve essere scalar o typed-array.");
}

export function formatMexalOrderDate(value, format = DEFAULT_MEXAL_ORDER_DATE_FORMAT) {
  const isoDate = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error("data_ordine deve essere una data valida nel formato YYYY-MM-DD.");
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) {
    throw new Error("data_ordine deve essere una data valida nel formato YYYY-MM-DD.");
  }
  const italianDate = `${day}/${month}/${year}`;
  if (format === "dd/mm/yyyy") return italianDate;
  if (format === "yyyymmdd") return `${year}${month}${day}`;
  if (format === "iso") return isoDate;
  if (format === "typed-array-dd/mm/yyyy") return [[1, italianDate]];
  throw new Error("MEXAL_ORDER_DATE_FORMAT deve essere dd/mm/yyyy, yyyymmdd, iso o typed-array-dd/mm/yyyy.");
}

export function normalizeMexalUnitType(value) {
  return text(value) || "1";
}

export function buildRootMatrixRows(lines, magazzino) {
  const fields = {
    id_riga: (_line, index) => index,
    tp_riga: () => "R",
    codice_articolo: (line) => normalizeArticleCode(line.codice_articolo),
    quantita: (line) => number(line.quantita_documento),
    prezzo: (line) => number(line.prezzo_listino ?? line.prezzo_unitario ?? line.prezzo),
    sconto: (line) => text(line.sconto_commerciale),
    id_mag_riga: (line) => number(line.id_mag_riga ?? magazzino),
    tp_um_articolo: (line) => normalizeMexalUnitType(line.tp_um_articolo),
    cod_iva: (line) => text(line.cod_iva ?? line.codice_iva_mexal),
  };
  return Object.fromEntries(Object.entries(fields).map(([field, value]) => [field,
    lines.map((line, index) => [index + 1, value(line, index + 1)]).filter(([, item]) => item !== undefined && item !== ""),
  ]).filter(([, values]) => values.length));
}

export function buildMexalOrderDocument(order, kind, lines, { serie = 1, magazzino = 5, notaFormat = "typed-array", dateFormat = DEFAULT_MEXAL_ORDER_DATE_FORMAT } = {}) {
  const document = ORDER_DOCUMENTS[kind];
  if (!document || !lines?.length) return null;
  return compact({
    sigla: "OC", serie: number(serie), numero: 0, cod_conto: text(order.codice_cliente), data_documento: formatMexalOrderDate(order.data_ordine, dateFormat),
    cod_modulo: document.moduleCode, id_magazzino: number(magazzino), codice_agente: text(order.codice_agente_mexal),
    nota: formatMexalNota(order.note_mexal || `Workspace n. ${order.id}`, notaFormat), id_ind_sped: number(order.id_ind_sped),
    cod_anag_sped: text(order.cod_anag_sped), id_pagamento: number(order.id_pagamento), ...buildRootMatrixRows(lines, magazzino),
  });
}
