import { supabase } from "../../../lib/supabaseClient.js";
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


export async function loadOrderDetail(orderId) {
  const [{ data: order, error: orderError }, { data: lines, error: linesError }, { data: documents, error: documentsError }] = await Promise.all([
    supabase.from("ordini_testate").select("*").eq("id", orderId).single(),
    supabase.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id", { ascending: true }),
    supabase.from("ordini_documenti_mexal").select("tipo_documento,sigla,serie,numero,cod_modulo").eq("ordine_id", orderId).not("numero", "is", null),
  ]);
  if (orderError) throw orderError;
  if (linesError) throw linesError;
  if (documentsError) throw documentsError;
  return { order: { ...order, mexal_documents: documents || [] }, lines: lines || [] };
}

export { buildOrderPdfModel, createOrderPdf, downloadOrderPdf } from "./orderPdf.js";
