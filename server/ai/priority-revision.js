/* global Buffer, process */
import { randomUUID } from "node:crypto";
import { HMAC_HEADERS, signProductionMessage } from "../progremes-production-hmac.js";

export const priorityRequestSchema = {
  type: "object", additionalProperties: false, required: ["orderNumber", "startAt", "reason", "materials"],
  properties: {
    orderNumber: { type: "string", minLength: 1, maxLength: 50 }, startAt: { type: "string", description: "Data e ora MES locale desiderata, ISO senza suffisso UTC." },
    reason: { type: "string", minLength: 1, maxLength: 1000 },
    materials: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["articleCode", "transfers"], properties: {
      articleCode: { type: "string", minLength: 1 }, transfers: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false,
        required: ["sourceOrderId", "quantity"], properties: { sourceOrderId: { type: "integer", minimum: 1 }, quantity: { type: "number", exclusiveMinimum: 0, description: "Quantità da disimpegnare dall’origine, anche oltre il mancante della destinazione per risolvere overbooking. MES assegna solo il necessario e libera il residuo." } } } },
    } } },
  },
};
export const priorityConfirmSchema = { type: "object", additionalProperties: false, required: ["targetId", "expectedHash"], properties: {
  targetId: { type: "string", format: "uuid" }, expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
} };

export async function priorityCall(auth, operation, input = {}, transport = fetch) {
  if (!["lookup", "materials", "simulate", "get", "history"].includes(operation)) throw new Error("Operazione revisione non valida.");
  const { data, error } = await auth.scoped.rpc("company_mes_ai_can_write");
  if (error || data !== true) throw Object.assign(new Error("Permesso operativo MES richiesto."), { status: 403 });
  const secret = String(process.env.PROGREMES_INTEGRATION_SECRET || "").trim();
  const base = String(process.env.PROGREMES_URL || "").trim();
  if (!secret || !base) throw new Error("Collegamento MES non configurato.");
  const path = `/api/workspace/ai/priority/${operation}`;
  const body = Buffer.from(JSON.stringify({ ...input, actor: `workspace:${auth.profile.id}` }));
  const timestamp = Math.floor(Date.now() / 1000), eventId = randomUUID();
  const response = await transport(new URL(path, base), { method: "POST", body, signal: AbortSignal.timeout(55000),
    headers: { "Content-Type": "application/json", [HMAC_HEADERS.timestamp]: String(timestamp), [HMAC_HEADERS.eventId]: eventId,
      [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body, secret }) } });
  const result = await response.json().catch(() => ({}));
  if (response.status === 404) throw new Error("Aggiornare MES per attivare le revisioni di priorità.");
  if (!response.ok) throw new Error(result.error || `Verifica MES non riuscita (${response.status}).`);
  return result;
}

export function assertPriorityConfirmation(input, revision) {
  if (!revision?.snapshot || revision.id !== input.targetId || revision.expectedHash !== input.expectedHash || revision.status !== "PROPOSED")
    throw new Error("Revisione non confermabile: ricaricare la simulazione.");
  const created = Date.parse(revision.createdAt);
  if (!Number.isFinite(created) || Date.now() - created > 15 * 60 * 1000 || created > Date.now() + 60000) throw new Error("Simulazione scaduta o data non valida: ricalcolare.");
  return { targetId: revision.id, expectedHash: revision.expectedHash, evidence: revision };
}

export async function checkPriorityWorkspace(auth, revision) {
  const { error } = await auth.admin.rpc("check_workspace_priority_revision", { p_revision: revision });
  if (error) throw new Error(error.message);
  return revision;
}
export async function simulatePriority(auth, input) {
  const current = await priorityCall(auth, "materials", { orderNumber: input?.orderNumber });
  if (!(current.reservationReleaseVersion >= 2)) throw new Error("Aggiornare MES per attivare il disimpegno delle eccedenze su tutti gli articoli.");
  if (!(current.bulkRoutingVersion >= 1)) throw new Error("Aggiornare MES per distinguere semilavorati da produrre e bulk da magazzino nella revisione del planning.");
  if (current.planningBlock) throw new Error(current.planningBlock);
  const internal = new Set((current.productionDependencies || []).map(x => x.articleCode?.trim().toUpperCase()));
  if (input.materials?.some(x => internal.has(x.articleCode?.trim().toUpperCase())))
    throw new Error("Il semilavorato interno è una dipendenza produttiva: selezionare le sue materie prime, non trasferire il bulk da produrre.");
  const revision = await priorityCall(auth, "simulate", { input });
  try { await checkPriorityWorkspace(auth, revision); return { ...revision, confirmable: true }; }
  catch (error) { return { ...revision, confirmable: false, workspaceBlock: error.message }; }
}

// This never repeats a transfer. It only reads the MES audit and atomically refreshes Workspace mirrors.
export async function reconcilePriority(auth, id) {
  const result = await priorityCall(auth, "get", { id });
  if (result.applied !== true) return result;
  const { error } = await auth.admin.rpc("reconcile_workspace_priority_revision", { p_revision: result, p_actor: auth.profile.id });
  if (error) return { ...result, status: "RECONCILIATION_REQUIRED", message: `MES aggiornato; allineamento Workspace da completare: ${error.message}. Non ripetere i trasferimenti.` };
  return { ...result, status: "COMPLETED", message: "Revisione completata: materiali, fabbisogni e planning allineati. Rigenerare e stampare i fogli coinvolti; l’avvio resta manuale." };
}
