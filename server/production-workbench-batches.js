import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { HMAC_HEADERS, signProductionMessage } from "./progremes-production-hmac.js";

// Scope must come from the authorized OCT detail, never from the browser's OP list.
export function assertBatchOrderScope(detail, order) {
  const number = String(order?.orderNumber || "").trim().toUpperCase();
  const progressive = Number(detail?.request?.rdp_number);
  const prefix = Number.isSafeInteger(progressive) && progressive > 0 ? `RDP${progressive}` : null;
  const rdpMatch = prefix && (number === prefix || new RegExp(`^${prefix}-[0-9]+$`).test(number));
  const octMatch = (detail?.orders || []).some(o => String(o.label || "").trim().toUpperCase() === number);
  if (!number || (!rdpMatch && !octMatch))
    throw Object.assign(new Error("Lavorazione non appartenente all'OCT o RdP selezionata."), { status: 404 });
}

export async function readWorkbenchBatches({ detail, productionOrderId, actor, transport = fetch,
  base = process.env.PROGREMES_URL, secret = process.env.PROGREMES_INTEGRATION_SECRET }) {
  if (!Number.isSafeInteger(productionOrderId) || productionOrderId <= 0 || !actor)
    throw Object.assign(new Error("Ordine di produzione non valido."), { status: 400 });
  if (!base || !secret) throw new Error("Collegamento MES non configurato.");
  const path = "/api/workspace/ai/planning/batches";
  const body = Buffer.from(JSON.stringify({ orderId: productionOrderId, actor: `workspace:${actor}` }));
  const timestamp = Math.floor(Date.now() / 1000), eventId = randomUUID();
  const response = await transport(new URL(path, base), { method: "POST", body,
    signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json",
      [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
      [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body, secret }) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Dettaglio batch MES non disponibile.");
  if (result.orderId !== productionOrderId) throw new Error("Risposta MES non corrispondente all'ordine.");
  assertBatchOrderScope(detail, result);
  return result;
}
