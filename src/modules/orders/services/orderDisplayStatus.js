import { filterOrderModuleDocuments, orderModuleCodeFromOrder, orderModuleDocumentTypes } from "./orderModules.js";

const PH_INTERNAL_STATUSES = Object.freeze({
  bozza: Object.freeze({ label: "BOZZA", className: "bozza", closed: false }),
  aperto: Object.freeze({ label: "APERTO", className: "aperto", closed: false }),
  confermato: Object.freeze({ label: "CONFERMATO", className: "aperto", closed: true }),
  in_corso: Object.freeze({ label: "IN CORSO", className: "in_corso", closed: false }),
  spedito: Object.freeze({ label: "SPEDITO", className: "spedito", closed: true }),
  evaso: Object.freeze({ label: "EVASO", className: "evaso", closed: true }),
  annullato: Object.freeze({ label: "ANNULLATO", className: "annullato", closed: true }),
  errore: Object.freeze({ label: "ERRORE", className: "errore", closed: false }),
});

// Stato visuale condiviso tra dashboard, elenco e dettaglio ordine.
export function hasMexalDocuments(order = {}) {
  const moduleCode = orderModuleCodeFromOrder(order);
  if (orderModuleDocumentTypes(moduleCode).some((type) => order[`numero_${type.toLowerCase()}`])) return true;
  const documents = filterOrderModuleDocuments(moduleCode, order.mexal_documents || order.documenti_mexal || []);
  return documents.some((document) => document?.numero);
}

export function hasOnlyMissingMexalDocuments(order = {}) {
  const documents = filterOrderModuleDocuments(orderModuleCodeFromOrder(order), order.mexal_documents || order.documenti_mexal || [])
    .filter((document) => document?.numero && (document?.id || document?.stato_operativo || document?.presente_in_mexal !== undefined));
  return documents.length > 0 && documents.every((document) =>
    String(document.stato_operativo || "").toUpperCase() === "ANNULLATO" || document.presente_in_mexal === false
  );
}

export function getOrderDisplayStatus(order = {}) {
  const orderStatus = String(order.stato || "").trim().toLowerCase();
  const syncStatus = String(order.stato_sincronizzazione || "").trim().toLowerCase();
  const moduleCode = orderModuleCodeFromOrder(order);

  if (moduleCode === "ph") {
    return PH_INTERNAL_STATUSES[orderStatus] || PH_INTERNAL_STATUSES.bozza;
  }

  const hasDocuments = hasMexalDocuments(order);

  if (hasOnlyMissingMexalDocuments(order) || syncStatus === "annullato") {
    return { label: "NON PRESENTE IN MEXAL", className: "annullato", closed: false };
  }

  if (orderStatus === "evaso") {
    return { label: "EVASO", className: "evaso", closed: true };
  }

  if ((syncStatus === "completato" || orderStatus === "confermato") && hasDocuments) {
    return { label: "INVIATO A MEXAL", className: "inviato-mexal", closed: true };
  }

  if (syncStatus === "completato" || orderStatus === "confermato") {
    return { label: "NON RICONCILIATO", className: "errore", closed: false };
  }

  if (syncStatus === "errore") {
    return { label: "ERRORE", className: "errore", closed: false };
  }

  if (syncStatus === "in_corso" || syncStatus === "arresto_richiesto") {
    return { label: "IN CORSO", className: "in_corso", closed: false };
  }

  return { label: "BOZZA", className: "bozza", closed: false };
}
