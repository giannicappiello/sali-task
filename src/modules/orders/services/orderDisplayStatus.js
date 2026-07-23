export function hasMexalDocuments(order = {}) {
  if (order.numero_ocm || order.numero_ocx || order.numero_oci) return true;
  const documents = order.mexal_documents || order.documenti_mexal || [];
  return documents.some((document) => document?.numero);
}

export function getOrderDisplayStatus(order = {}) {
  const orderStatus = String(order.stato || "").trim().toLowerCase();
  const syncStatus = String(order.stato_sincronizzazione || "").trim().toLowerCase();
  const hasDocuments = hasMexalDocuments(order);

  if ((syncStatus === "completato" || orderStatus === "confermato") && hasDocuments) {
    return { label: "INVIATO A MEXAL", className: "inviato-mexal", closed: true };
  }

  if (syncStatus === "completato" || orderStatus === "confermato") {
    return { label: "SPEDITO", className: "spedito", closed: true };
  }

  if (syncStatus === "errore") {
    return { label: "ERRORE", className: "errore", closed: false };
  }

  if (syncStatus === "in_corso" || syncStatus === "arresto_richiesto") {
    return { label: "IN CORSO", className: "in_corso", closed: false };
  }

  return { label: "BOZZA", className: "bozza", closed: false };
}
