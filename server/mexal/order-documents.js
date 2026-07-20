export const ORDER_DOCUMENTS = Object.freeze({
  OCM: Object.freeze({ moduleCode: "M", quantityField: "quantita_ocm" }),
  OCX: Object.freeze({ moduleCode: "X", quantityField: "quantita_ocx" }),
  OCI: Object.freeze({ moduleCode: "I", quantityField: "quantita_oci" }),
});

export function normalizeArticleCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isImportArticle(line) {
  return normalizeArticleCode(line?.codice_articolo ?? line?.productCode).startsWith("IMP");
}

export function classifyOrderLines(lines) {
  return (lines || []).reduce((documents, line) => {
    // IMP is deliberately evaluated before any stored stock allocation.
    if (isImportArticle(line)) {
      documents.OCI.push({ ...line, quantita_documento: Number(line.quantita) || 0 });
      return documents;
    }
    for (const kind of ["OCM", "OCX"]) {
      const quantity = Number(line[ORDER_DOCUMENTS[kind].quantityField]) || 0;
      if (quantity > 0) documents[kind].push({ ...line, quantita_documento: quantity });
    }
    return documents;
  }, { OCM: [], OCX: [], OCI: [] });
}

function text(value) { return String(value ?? "").trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}

export function buildMexalOrderDocument(order, kind, lines) {
  const document = ORDER_DOCUMENTS[kind];
  if (!document || !lines?.length) return null;
  return compact({
    sigla: "OC",
    serie: 1,
    numero: 0,
    id_magazzino: 5,
    cod_modulo: document.moduleCode,
    conto: text(order.codice_cliente),
    data_documento: text(order.data_ordine),
    codice_pagamento: text(order.codice_pagamento),
    codice_agente: text(order.codice_agente_mexal),
    indirizzo_spedizione: text(order.indirizzo_spedizione),
    // The available Mexal write contract uses a scalar `nota`; GET's [[type,text]] is read-only representation.
    nota: text(order.note_mexal || `Workspace n. ${order.id}`),
    righe: lines.map((line) => compact({
      articolo: normalizeArticleCode(line.codice_articolo),
      descrizione: text(line.descrizione),
      quantita: number(line.quantita_documento),
      prezzo_netto: number(line.prezzo_netto),
      sconto: text(line.sconto_commerciale),
      sconto_pagamento: text(line.sconto_pagamento),
      unita_misura: text(line.unita_misura || "PZ"),
    })),
  });
}
