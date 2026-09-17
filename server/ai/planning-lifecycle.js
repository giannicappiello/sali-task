/* global Buffer, process */
import { randomUUID } from "node:crypto";
import { HMAC_HEADERS, signProductionMessage } from "../progremes-production-hmac.js";

export const planningConfirmSchema = { type: "object", additionalProperties: false, required: ["targetId", "expectedHash"], properties: {
  targetId: { type: "string", format: "uuid" }, expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  backupVerified: { type: "boolean", description: "Solo dopo verifica esplicita dell'utente del backup del database e dei documenti, mai dedurre o impostare autonomamente." },
} };
export const planningRequestSchema = { type: "object", additionalProperties: false, required: ["kind", "startAt", "reason"], properties: {
  kind: { type: "string", enum: ["MIGRATE", "RECALCULATE", "CONFIRM_PLAN", "RELEASE_ODL", "ROLLBACK"] },
  startAt: { type: "string", description: "Data/ora locale italiana ISO senza Z." }, reason: { type: "string", minLength: 1, maxLength: 1000 },
  orderIds: { type: "array", maxItems: 1000, items: { type: "integer" } },
  allowMaterialShortage: { type: "boolean", description: "Solo per RELEASE_ODL e su scelta esplicita: genera fabbisogni specifici per le carenze, senza inventare giacenza o consentire l'avvio della fase scoperta." },
  confirmationDays: { type: "integer", minimum: 7, maximum: 365 }, reviewDays: { type: "integer", minimum: 7, maximum: 180 }, releaseDays: { type: "integer", minimum: 1, maximum: 14 },
  manualChoices: { type: "array", items: { type: "object", additionalProperties: false, required: ["orderId", "notBefore"], properties: {
    orderId: { type: "integer" }, notBefore: { type: "string" }, resourceId: { type: ["integer", "null"], minimum: 1 },
  } } },
} };

export async function planningCall(auth, operation, input = {}, transport = fetch) {
  if (!["state", "get", "simulate"].includes(operation)) throw new Error("Operazione di pianificazione non disponibile.");
  const { data, error } = await auth.scoped.rpc("company_mes_ai_can_write");
  if (error || data !== true) throw Object.assign(new Error("Permesso operativo MES richiesto."), { status: 403 });
  const secret = String(process.env.PROGREMES_INTEGRATION_SECRET || "").trim();
  const base = String(process.env.PROGREMES_URL || "").trim();
  if (!secret || !base) throw new Error("Collegamento MES non configurato.");
  const path = `/api/workspace/ai/planning/${operation}`;
  const body = Buffer.from(JSON.stringify({ ...input, actor: `workspace:${auth.profile.id}` }));
  const timestamp = Math.floor(Date.now() / 1000), eventId = randomUUID();
  const startedAt = performance.now();
  try {
  const response = await transport(new URL(path, base), { method: "POST", body, signal: AbortSignal.timeout(55000),
    headers: { "Content-Type": "application/json", [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
      [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body, secret }) } });
  const result = await response.json().catch(() => ({}));
  if (response.status === 404) throw new Error("Aggiornare MES per utilizzare previsione, versioni del piano e ODL. Il piano attuale non è stato modificato.");
  if ([400, 405].includes(response.status) && !result.error) throw new Error(`Servizio di nuova pianificazione MES non disponibile (${response.status}). Verificare di avere eseguito fetch, pull e AggiornaMES del nuovo rilascio, quindi aggiornare lo stato. Nessuna modifica al piano eseguita da questa richiesta.`);
  if (!response.ok) throw new Error(result.error || `Pianificazione MES non disponibile (${response.status}).`);
  return result;
  } finally {
    console.info("[planning-performance]", JSON.stringify({ operation, elapsedMs: Math.round(performance.now() - startedAt) }));
  }
}

export function assertPlanningConfirmation(input, version, verifyOnly = false) {
  if (!version?.snapshot || version.id !== input.targetId || version.expectedHash !== input.expectedHash)
    throw new Error("Versione non corrispondente: ricaricare l'anteprima.");
  if (verifyOnly) {
    const pendingCoverage = version.status === "APPLIED" && version.snapshot.shortages?.length && !version.snapshot.shortagesCoveredAtUtc;
    if (!["RELEASE_ODL", "GRAPHICAL_RELEASE"].includes(version.kind) || (!pendingCoverage && !["PREPARING", "RECONCILIATION_REQUIRED"].includes(version.status))) throw new Error("Nessun rilascio ODL da riconciliare.");
  } else {
    if (version.status !== "PROPOSED" || version.snapshot.blocks?.length) throw new Error("Anteprima non confermabile: verificare i blocchi.");
    const time = Date.parse(version.createdAt);
    if (!Number.isFinite(time) || Date.now() - time > 30 * 60 * 1000 || time > Date.now() + 60000) throw new Error("Anteprima scaduta: ricalcolare.");
    if (version.kind === "MIGRATE" && input.backupVerified !== true) throw new Error("L'utente deve verificare il backup prima dell'attivazione.");
  }
  return { targetId: version.id, expectedHash: version.expectedHash, backupVerified: input.backupVerified === true, evidence: version };
}

// Reconcile from the currently authoritative MES state, never replay a planning mutation after a timeout.
export async function reconcilePlanning(auth) {
  const state = await planningCall(auth, "state");
  if (!state.configuration?.activeVersionId) return { status: "UNCHANGED", message: "Nuovo sistema non ancora attivo." };
  const { error } = await auth.admin.rpc("reconcile_workspace_planning", { p_state: state, p_actor: auth.profile.id });
  if (error) throw new Error(`MES aggiornato; allineamento Workspace da completare: ${error.message}. Non ripetere conferme o creazioni di lotti.`);
  return { status: "COMPLETED", message: "Stato Workspace allineato al piano MES." };
}
