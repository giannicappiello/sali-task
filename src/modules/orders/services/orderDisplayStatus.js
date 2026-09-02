import { filterOrderModuleDocuments, orderModuleCodeFromOrder, orderModuleDocumentTypes } from "./orderModules.js";

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
