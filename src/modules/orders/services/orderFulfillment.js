import { supabase } from "../../../lib/supabaseClient.js";
import { buildOrderPdfModel, createOrderPdf, downloadOrderPdf as createAndDownloadPdf } from "./orderPdf.js";
export { buildAvailabilityPreview } from "./availability.js";

async function getAccessToken() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  }
  return session.access_token;
}

async function postJson(url, body) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { payload = { error: raw || "Risposta API non valida." }; }

  if (!response.ok) {
    throw new Error(payload.error || `Errore API (${response.status}).`);
  }
  return payload;
}

export function submitOrderToMexal(orderId) {
  return postJson("/api/mexal/submit-order", { orderId });
}

export function stopOrderSync(orderId) {
  return postJson("/api/mexal/orders/stop-sync", { orderId });
}
export function deleteOrder(orderId) { return postJson("/api/mexal/orders/delete", { orderId }); }
export function updateOrder(orderId, testata, righe) { return postJson("/api/mexal/orders/update", { orderId, testata, righe }); }
export function recoverOrderSync(orderId) { return postJson("/api/mexal/orders/recover-sync", { orderId }); }

export function checkOrderAvailability(lines) {
  return postJson("/api/mexal/orders/check-availability", {
    lines: lines.map((line) => ({
      productCode: String(line.codice_articolo || "").trim(),
      quantity: Number(line.quantita),
    })),
  });
}

function legacyMexalDocuments(order = {}) {
  const defaultSerie = String(order.serie_documento_mexal || order.serie_mexal || 1);
  return ["OCM", "OCX", "OCI"].flatMap((type) => {
    const numero = order[`numero_${type.toLowerCase()}`];
    return numero ? [{ tipo_documento: type, serie: defaultSerie, numero: String(numero), stato: "legacy" }] : [];
  });
}

function mergeMexalDocuments(documents = [], order = {}) {
  const merged = [...documents, ...legacyMexalDocuments(order)];
  const seen = new Set();
  return merged.filter((document) => {
    const type = String(document.tipo_documento || "").toUpperCase();
    const serie = String(document.serie ?? "").trim();
    const numero = String(document.numero ?? "").trim();
    if (!["OCM", "OCX", "OCI"].includes(type) || !serie || !numero) return false;
    const key = `${type}:${serie}:${numero}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadCreatedMexalDocuments(orderId) {
  const { data, error } = await supabase
    .from("ordini_documenti_mexal")
    .select("tipo_documento,serie,numero,stato")
    .eq("ordine_id", orderId)
    .not("numero", "is", null)
    .order("aggiornato_il", { ascending: false });
  if (error) throw error;

  // A document may have been created by Mexal and subsequently marked failed by
  // an older reconciliation step.  The authoritative signal for the PDF is the
  // persisted type/series/number, not the local status label.
  return data || [];
}

export async function loadOrderDetail(orderId) {
  const [{ data: order, error: orderError }, { data: lines, error: linesError }, { data: documents, error: documentsError }] = await Promise.all([
    supabase.from("ordini_testate").select("*").eq("id", orderId).single(),
    supabase.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id", { ascending: true }),
    loadCreatedMexalDocuments(orderId),
  ]);
  if (orderError) throw orderError;
  if (linesError) throw linesError;
  if (documentsError) throw documentsError;
  return { order: { ...order, mexal_documents: mergeMexalDocuments(documents, order) }, lines: lines || [] };
}

export { buildOrderPdfModel, createOrderPdf };

export async function downloadOrderPdf(order, lines, options) {
  if (!order?.id) throw new Error("Ordine non valido: identificativo mancante.");
  const documents = await loadCreatedMexalDocuments(order.id);
  const mexalDocuments = mergeMexalDocuments(documents, order);
  return createAndDownloadPdf({ ...order, mexal_documents: mexalDocuments }, lines, options);
}
