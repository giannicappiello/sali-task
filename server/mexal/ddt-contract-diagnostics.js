import { findTechnicalCredentialPath } from "./full-help-download.js";
import { createHash } from "node:crypto";

// Reads modules and renders an existing movement through the print-only service.
// The ricerca POST searches existing records; it cannot issue a DDT.
function entries(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (typeof value.regexp === "string" && value.method === "GET") result.push(value);
  Object.values(value).forEach((child) => entries(child, result));
  return result;
}

export async function runDdtContractDiagnostics(client) {
  const catalog = entries(await client.getJson("/help"));
  const relevant = catalog.filter((item) => /moduli-stampa|movimenti-magazzino|pdf|stampa/i.test(item.regexp));
  const path = "/documenti/moduli-stampa/BC";
  const advertised = catalog.some((item) => {
    try { return new RegExp(item.regexp).test(path); } catch { return false; }
  });
  let modules = { ok: false, error: "Lettura moduli BC non pubblicata nel catalogo Mexal." };
  if (advertised) {
    const payload = await client.getJson(path);
    if (findTechnicalCredentialPath(payload)) throw new Error("Risposta Mexal con campi riservati: visualizzazione bloccata.");
    modules = { ok: true, endpoint: path, payload };
  }
  let services;
  if (client.printMovementPdf) {
    try {
      const collection = await client.postJson('/documenti/movimenti-magazzino/ricerca?max=1&fields=sigla,serie,numero,cod_conto,cod_modulo', {filtri:[{campo:'sigla',condizione:'=',valore:'BC'}]});
      const first = (Array.isArray(collection) ? collection : collection.dati || collection.risultati || [])[0];
      if (!first || first.sigla !== 'BC') throw new Error('Nessun documento BC disponibile nel campione.');
      const document = {...first,sigla:'BC',serie:Number(first.serie),numero:Number(first.numero),cod_modulo:'F'};
      const pdf = await client.printMovementPdf(document);
      services = { ok:true, endpoint:'/webapi/servizi', command:'stampa_movimento_magazzino', module:'F', reference:`BC+${document.serie}+${document.numero}`, bytes:pdf.body.length, sha256:createHash('sha256').update(pdf.body).digest('hex') };
    } catch (error) { services = { ok: false, error: error.message }; }
  }
  return {
    readOnly: true,
    checkedAt: new Date().toISOString(),
    catalog: relevant.map(({ regexp, descrizione, method }) => ({ regexp, descrizione, method })),
    modules,
    services,
    pdfEndpointAdvertised: relevant.some((item) => /pdf/i.test(item.regexp)),
    contractVerified: false,
    explanation: "La presenza del modulo non dimostra il contratto del PDF. Nessun documento emesso e nessuna configurazione modificata.",
  };
}
