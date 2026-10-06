const normalize = (value) => String(value ?? "").trim().toLowerCase();

// Confirmation is the lock boundary, even for modules without Mexal or email.
export function canEditOrderDraft(order, { hasMexalDocument = false } = {}) {
  return normalize(order?.stato) === "bozza"
    && !order.confermato_at
    && Number(order.versione_conferma || 0) === 0
    && normalize(order.origine) !== "mexal_oct"
    && !hasMexalDocument
    && !["numero_ocm", "numero_ocx", "numero_oci", "numero_oct"].some((key) => String(order[key] ?? "").trim())
    && ["non_avviato", "non_inviato", "errore", "annullato", "arrestato"].includes(normalize(order.stato_sincronizzazione) || "non_inviato");
}
