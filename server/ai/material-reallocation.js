/* global Buffer, process */
import { randomUUID } from "node:crypto";
import { HMAC_HEADERS, signProductionMessage } from "../progremes-production-hmac.js";

export const materialLookupSchema = {
  type: "object", additionalProperties: false, required: ["orderNumber", "articleCode"],
  properties: { orderNumber: { type: "string", minLength: 1, maxLength: 50 }, articleCode: { type: "string", minLength: 1, maxLength: 100 } },
};
export const materialReallocationSchema = {
  type: "object", additionalProperties: false,
  required: ["orderNumber", "articleCode", "targetId", "expectedHash", "transfers", "reason"],
  properties: {
    ...materialLookupSchema.properties, targetId: { type: "string", minLength: 1, maxLength: 20 },
    expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    reason: { type: "string", minLength: 1, maxLength: 1000 },
    transfers: { type: "array", minItems: 1, maxItems: 30, items: {
      type: "object", additionalProperties: false, required: ["sourceOrderId", "quantity"],
      properties: { sourceOrderId: { type: "integer", minimum: 1 }, quantity: { type: "number", exclusiveMinimum: 0, multipleOf: 0.000001 } },
    } },
  },
};

export async function previewMaterialReallocation(auth, input, transport = fetch) {
  const { data, error } = await auth.scoped.rpc("company_mes_ai_can_write");
  if (error || data !== true) throw Object.assign(new Error("Permesso operativo MES richiesto."), { status: 403 });
  const orderNumber = String(input?.orderNumber || "").trim();
  const articleCode = String(input?.articleCode || "").trim();
  if (!orderNumber || orderNumber.length > 50 || !articleCode || articleCode.length > 100)
    throw new Error("Indicare numero RdP completo e codice materia prima.");
  const path = "/api/workspace/ai/materials/preview";
  const secret = String(process.env.PROGREMES_INTEGRATION_SECRET || "").trim();
  const base = String(process.env.PROGREMES_URL || "").trim();
  if (!secret || !base) throw new Error("Collegamento MES non configurato.");
  const body = Buffer.from(JSON.stringify({ orderNumber, articleCode }));
  const timestamp = Math.floor(Date.now() / 1000); const eventId = randomUUID();
  const response = await transport(new URL(path, base), {
    method: "POST", body, signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
      [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body, secret }) },
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 404) throw new Error("Aggiornare MES per attivare la riallocazione delle materie prime.");
  if (!response.ok) throw new Error(result.error || "Impossibile verificare gli impegni MES.");
  if (!result.hash || !Array.isArray(result.donors) || !Number.isInteger(result.orderId))
    throw new Error("Risposta MES incompleta: nessuna riallocazione autorizzata.");
  return result;
}

// Returns server-produced evidence, not descriptions supplied by the model/browser.
export function assertMaterialReallocation(input, current) {
  if (!current.eligible) throw new Error(current.blockReason || "Ordine non riallocabile.");
  if (input.targetId !== String(current.orderId) || input.orderNumber !== current.orderNumber ||
      input.articleCode !== current.articleCode || input.expectedHash !== current.hash)
    throw new Error("Impegni cambiati: ricaricare l’anteprima e confermare nuovamente.");
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000 ||
      !Array.isArray(input.transfers) || !input.transfers.length || input.transfers.length > 30)
    throw new Error("Selezionare origini, quantità e motivazione.");
  const seen = new Set(); let total = 0;
  const transfers = input.transfers.map(row => {
    const donor = current.donors.find(d => d.orderId === row.sourceOrderId);
    if (!Number.isInteger(row.sourceOrderId) || seen.has(row.sourceOrderId) || !donor?.eligible ||
        !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > donor.reserved ||
        Math.abs(row.quantity * 1e6 - Math.round(row.quantity * 1e6)) > 0.00001)
      throw new Error("Origine non utilizzabile, duplicata o quantità non valida (massimo 6 decimali).");
    seen.add(row.sourceOrderId); total += row.quantity;
    return { sourceOrderId: row.sourceOrderId, orderNumber: donor.orderNumber, product: donor.product,
      quantity: row.quantity, reservedAfter: donor.reserved - row.quantity,
      physicalShortageAfter: Math.max(0, donor.required - donor.reserved + row.quantity) };
  });
  if (total > current.missing + 1e-9) throw new Error("Il trasferimento supera lo scoperto fisico della destinazione.");
  return { orderNumber: current.orderNumber, articleCode: current.articleCode, unit: current.unit,
    quantity: total, missingAfter: Math.max(0, current.missing - total), transfers,
    warning: "Le origini perdono la disponibilità trasferita. Rigenerare e stampare i fogli coinvolti. Nessun avvio automatico, nessun movimento Mexal; restano tutti i controlli MES." };
}
