export const ORDER_DOCUMENTS = Object.freeze({
  OCM: Object.freeze({ moduleCode: "M", quantityField: "quantita_ocm" }),
  OCX: Object.freeze({ moduleCode: "X", quantityField: "quantita_ocx" }),
  OCI: Object.freeze({ moduleCode: "I", quantityField: "quantita_oci" }),
});

export function normalizeArticleCode(value) { return String(value ?? "").trim().toUpperCase(); }
export function isImportArticle(line) { return normalizeArticleCode(line?.codice_articolo ?? line?.productCode).startsWith("IMP"); }

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

// GET exposes `nota` in more than one shape. Production selects the proven write adapter
// explicitly instead of assuming that either a GET shape or a scalar is writable.
export function formatMexalNota(value, format) {
  const note = text(value);
  if (!note) return undefined;
  if (format === "scalar") return note;
  if (format === "typed-array") return [[1, note]];
  throw new Error("Configurare MEXAL_ORDER_NOTA_FORMAT con un formato POST verificato (scalar o typed-array).");
}

export function buildMexalOrderDocument(order, kind, lines, { serie = 1, magazzino = 5, notaFormat, linesField } = {}) {
  const document = ORDER_DOCUMENTS[kind];
  if (!document || !lines?.length) return null;
  if (!linesField) throw new Error("Configurare MEXAL_ORDER_LINES_FIELD con il contenitore righe verificato dalla documentazione Mexal.");
  const rows = lines.map((line) => compact({
    codice_articolo: normalizeArticleCode(line.codice_articolo), quantita: number(line.quantita_documento),
    prezzo: number(line.prezzo_netto), sconto: text(line.sconto_commerciale),
    id_mag_riga: number(line.id_mag_riga ?? magazzino), tp_um_articolo: text(line.tp_um_articolo ?? line.unita_misura), cod_iva: text(line.cod_iva),
  }));
  return compact({
    sigla: "OC", serie: number(serie), numero: 0, cod_conto: text(order.codice_cliente), data_documento: text(order.data_ordine),
    cod_modulo: document.moduleCode, id_causale: number(order.id_causale), id_magazzino: number(magazzino), codice_agente: text(order.codice_agente_mexal),
    nota: formatMexalNota(order.note_mexal || `Workspace n. ${order.id}`, notaFormat), id_ind_sped: number(order.id_ind_sped),
    cod_anag_sped: text(order.cod_anag_sped), id_pagamento: number(order.id_pagamento), [linesField]: rows,
  });
}
