import { findTechnicalCredentialPath } from "./full-help-download.js";

// Only catalogue-advertised GETs are permitted. This diagnostic cannot issue a DDT.
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
  if (client.getServiceHelp) {
    try {
      const payload = await client.getServiceHelp();
      if (findTechnicalCredentialPath(payload)) throw new Error("Catalogo con campi riservati.");
      services = { ok: true, endpoint: "/webapi/servizi/help", payload };
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
