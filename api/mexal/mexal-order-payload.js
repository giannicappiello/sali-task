/**
 * Contract for POST /webapi/risorse/documenti/ordini-clienti.
 *
 * The WebAPI resource exposes the document header at the root and its rows in
 * `righe`.  Keep this allow-list deliberately small: Workspace-only fields
 * (including its order reference) must never leak into the Mexal request.
 */
const HEADER_FIELDS = ["sigla", "serie", "conto", "data_documento", "codice_pagamento", "codice_agente"];
const ROW_FIELDS = ["articolo", "descrizione", "quantita", "prezzo", "sconto", "unita_misura"];

function text(value) { return String(value ?? "").trim(); }
function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== "" && value != null));
}

export const MEXAL_ORDER_HEADER_FIELDS = Object.freeze(HEADER_FIELDS);
export const MEXAL_ORDER_ROW_FIELDS = Object.freeze(ROW_FIELDS);

export function buildMexalOrderPayload(order, lines, kind, documentConfig) {
  const isOcm = kind === "OCM";
  const serie = text(isOcm ? documentConfig?.serie_ocm : documentConfig?.serie_ocx);
  if (!serie) throw new Error(`Serie ${kind} non configurata in Impostazioni > Ordini.`);

  const righe = (lines || [])
    .map((line) => ({ line, quantita: numeric(isOcm ? line.quantita_ocm : line.quantita_ocx) }))
    .filter(({ quantita }) => quantita > 0)
    .map(({ line, quantita }) => defined({
      articolo: text(line.codice_articolo),
      descrizione: text(line.descrizione),
      quantita,
      prezzo: numeric(line.prezzo_netto),
      sconto: text(line.sconto_commerciale),
      unita_misura: text(line.unita_misura || "PZ"),
    }));

  if (!righe.length) return null;
  return {
    ...defined({
      sigla: "OC",
      serie,
      conto: text(order.codice_cliente),
      data_documento: order.data_ordine,
      codice_pagamento: text(order.codice_pagamento),
      codice_agente: text(order.codice_agente_mexal),
    }),
    righe,
  };
}
