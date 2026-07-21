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


export async function loadCreatedMexalDocuments(orderId) {
  const { data, error } = await supabase
    .from("ordini_documenti_mexal")
    .select("tipo_documento,serie,numero,stato")
    .eq("ordine_id", orderId)
    .eq("stato", "created")
    .not("numero", "is", null);
  if (error) throw error;
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
  return { order: { ...order, mexal_documents: documents || [] }, lines: lines || [] };
}

export { buildOrderPdfModel, createOrderPdf };

// Fetch immediately before generating: the order state held by React can predate
// the successful Mexal POST, which would otherwise incorrectly create a draft.
export async function downloadOrderPdf(order, lines, options) {
  const documents = await loadCreatedMexalDocuments(order.id);
  return createAndDownloadPdf({ ...order, mexal_documents: documents }, lines, options);
}
