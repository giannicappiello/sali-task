import { supabase } from "../../../lib/supabaseClient.js";
import { agentDisplayName, loadAgentNameMap } from "./agentNames.js";
import { buildOrderPdfModel, createOrderPdf, downloadOrderPdf as createAndDownloadPdf } from "./orderPdf.js";
export { buildAvailabilityPreview } from "./availability.js";

async function getAccessToken() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Sessione scaduta. Effettua nuovamente l'accesso.");
  return session.access_token;
}

async function postJson(url, body) {
  const token = await getAccessToken();
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw || "Risposta API non valida." }; }
  if (!response.ok) throw new Error(payload.error || `Errore API (${response.status}).`);
  return payload;
}

export function submitOrderToMexal(orderId) { return postJson("/api/mexal/submit-order", { orderId }); }
export function stopOrderSync(orderId) { return postJson("/api/mexal/orders/stop-sync", { orderId }); }
export function deleteOrder(orderId) { return postJson("/api/mexal/orders/delete", { orderId }); }
export function updateOrder(orderId, testata, righe) { return postJson("/api/mexal/orders/update", { orderId, testata, righe }); }
export function recoverOrderSync(orderId) { return postJson("/api/mexal/orders/recover-sync", { orderId }); }
export function checkOrderAvailability(lines) { return postJson("/api/mexal/orders/check-availability", { lines: lines.map((line) => ({ productCode: String(line.codice_articolo || "").trim(), quantity: Number(line.quantita) })) }); }

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

async function enrichAgent(order) {
  try {
    const names = await loadAgentNameMap([order?.codice_agente_mexal]);
    return { ...order, agente_nome: agentDisplayName(order, names) };
  } catch (error) {
    console.warn("Errore caricamento nome agente ordine:", error);
    return { ...order, agente_nome: agentDisplayName(order) };
  }
}

export async function loadCreatedMexalDocuments(orderId) {
  const { data, error } = await supabase.from("ordini_documenti_mexal").select("tipo_documento,serie,numero,stato").eq("ordine_id", orderId).not("numero", "is", null).order("aggiornato_il", { ascending: false });
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
  const enriched = await enrichAgent(order);
  return { order: { ...enriched, mexal_documents: mergeMexalDocuments(documents, enriched) }, lines: lines || [] };
}

export { buildOrderPdfModel, createOrderPdf };

export async function downloadOrderPdf(order, lines, options) {
  if (!order?.id) throw new Error("Ordine non valido: identificativo mancante.");
  const documents = await loadCreatedMexalDocuments(order.id);
  const enriched = await enrichAgent(order);
  const mexalDocuments = mergeMexalDocuments(documents, enriched);
  return createAndDownloadPdf({ ...enriched, mexal_documents: mexalDocuments }, lines, options);
}
