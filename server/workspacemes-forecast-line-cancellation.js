import { randomUUID } from "node:crypto";
import { createProgremesProductionClient } from "./progremes-production-client.js";

const ensure = ({ data, error }) => { if (error) throw error; return data; };
const fail = (message, code = "FORECAST_LINE_CANCELLATION_BLOCKED") => Object.assign(new Error(message), { status: 409, code });
export const forecastLineKey = (requestId, lineId) => String(requestId) + ":" + String(lineId);
export async function cancelledForecastLineKeys(admin, requestIds) {
  if (!requestIds.length) return new Set();
  const rows = ensure(await admin.from("workspace_production_request_audit").select("production_request_id,details")
    .eq("action", "FORECAST_LINE_CANCELLED").in("production_request_id", requestIds));
  return new Set((rows || []).filter(row => row.details?.workspaceLineId)
    .map(row => forecastLineKey(row.production_request_id, row.details.workspaceLineId)));
}

async function context(admin, requestId, workspaceLineId) {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(workspaceLineId || ""))
    throw fail("Riga OCT obbligatoria.", "INVALID_FORECAST_LINE");
  const request = ensure(await admin.from("workspace_production_requests").select("*").eq("id", requestId).single());
  if (!request || Number(request.contract_version) !== 4) throw fail("Annullamento per riga disponibile solo per RdP V4.");
  const items = ensure(await admin.from("workspace_production_request_items").select("ordine_riga_id,ordine_id")
    .eq("production_request_id", requestId).eq("ordine_riga_id", workspaceLineId));
  if (items.length !== 1) throw fail("La riga OCT non appartiene univocamente alla RdP.");
  const events = ensure(await admin.from("workspace_production_request_audit").select("action,details,reason")
    .eq("production_request_id", requestId).in("action", ["FORECAST_LINE_CANCELLATION_PENDING", "FORECAST_LINE_CANCELLATION_REJECTED", "FORECAST_LINE_CANCELLED"]).order("id"));
  const own = events.filter(row => row.details?.workspaceLineId === workspaceLineId);
  const rejected = new Set(own.filter(row => row.action === "FORECAST_LINE_CANCELLATION_REJECTED").map(row => row.details.attemptId));
  return { request, pending: own.find(row => row.action === "FORECAST_LINE_CANCELLATION_PENDING" && !rejected.has(row.details.attemptId)),
    completed: own.find(row => row.action === "FORECAST_LINE_CANCELLED") };
}
function verifyScope(result, workspaceLineId) {
  if (result?.workspaceLineId !== workspaceLineId || !Array.isArray(result.cancelledForecasts) ||
      result.cancelledForecasts.length !== 1 || result.cancelledForecasts[0].workspaceLineId !== workspaceLineId ||
      !Array.isArray(result.cancelledOrders) || result.cancelledOrders.length ||
      !Array.isArray(result.preservedOrders))
    throw fail("MES non conferma l'annullamento della sola riga. Aggiornare MES prima di riprovare.", "FORECAST_LINE_SCOPE_UNSUPPORTED");
}
export async function previewForecastLineCancellation({ admin, requestId, workspaceLineId, requestedBy,
  client = createProgremesProductionClient() }) {
  const ctx = await context(admin, requestId, workspaceLineId);
  if (ctx.completed) return { allowed: false, previews: [], cancelledOrders: [], preservedOrders: [],
    cancelledForecasts: ctx.completed.details.result.cancelledForecasts, blocks: ["La previsione della riga è già annullata."], workspaceLineId };
  if (String(ctx.request.workspace_status || ctx.request.stato).toUpperCase() === "CANCELLED")
    throw fail("La RdP è già annullata.");
  let targets;
  if (ctx.pending) targets = [ctx.pending.details.confirmationExternalId];
  else {
    const previews = ensure(await admin.from("workspace_v4_previews").select("id").eq("production_request_id", requestId));
    const mirrors = previews.length ? ensure(await admin.from("workspace_v4_confirmation_mirrors").select("external_id,status")
      .in("preview_id", previews.map(row => row.id))) : [];
    targets = [...new Set(mirrors.filter(row => String(row.status).toUpperCase() !== "REPLACED").map(row => row.external_id))];
  }
  const matches = [];
  for (const confirmationExternalId of targets) {
    try {
      const { result } = await client.previewCancellationV4(ctx.request.external_id, {
        contractVersion: 4, confirmationExternalId, workspaceLineId, preserveCompleted: true,
        reason: "Verifica annullamento singola previsione", cancelledBy: "workspace:" + requestedBy,
      });
      // Older MES ignores unknown fields: never allow that to become a whole-RdP cancellation.
      verifyScope(result, workspaceLineId);
      if (result.confirmationExternalId !== confirmationExternalId || !/^[a-f0-9]{64}$/.test(result.stateHash || "") ||
          typeof result.allowed !== "boolean" || !Array.isArray(result.blocks)) throw fail("Anteprima MES non valida.");
      matches.push(result);
    } catch (error) { if (error.code !== "V4_FORECAST_LINE_NOT_FOUND") throw error; }
  }
  if (matches.length !== 1) throw fail("Conferma della riga non univoca o non disponibile: riconciliare prima di annullare.");
  const result = matches[0];
  return { allowed: result.allowed, previews: matches, cancelledOrders: [], preservedOrders: result.preservedOrders,
    cancelledForecasts: result.cancelledForecasts, blocks: result.blocks, workspaceLineId };
}

export async function cancelForecastLine({ admin, requestId, workspaceLineId, requestedBy, reason, previews,
  client = createProgremesProductionClient() }) {
  const ctx = await context(admin, requestId, workspaceLineId);
  if (ctx.completed) return ctx.completed.details.result;
  if (!Array.isArray(previews) || previews.length !== 1) throw fail("Ripetere l'anteprima.", "V4_CANCELLATION_STALE");
  const expected = previews[0];
  verifyScope(expected, workspaceLineId);
  const fresh = await previewForecastLineCancellation({ admin, requestId, workspaceLineId, requestedBy, client });
  if (!fresh.allowed || fresh.previews[0].confirmationExternalId !== expected.confirmationExternalId ||
      fresh.previews[0].stateHash !== expected.stateHash)
    throw fail("Previsione o piano cambiati: ripetere l'anteprima.", "V4_CANCELLATION_STALE");
  const actor = ctx.pending?.details.requestedBy || requestedBy;
  const savedReason = ctx.pending?.reason || reason;
  const attemptId = ctx.pending?.details.attemptId || randomUUID();
  if (!ctx.pending) ensure(await admin.from("workspace_production_request_audit").insert({
    production_request_id: requestId, action: "FORECAST_LINE_CANCELLATION_PENDING",
    previous_status: ctx.request.workspace_status, new_status: ctx.request.workspace_status,
    reason, actor_id: requestedBy, details: { workspaceLineId, confirmationExternalId: expected.confirmationExternalId, requestedBy, attemptId },
  }));
  let result;
  try { ({ result } = await client.cancelV4(ctx.request.external_id, {
    contractVersion: 4, confirmationExternalId: expected.confirmationExternalId, workspaceLineId,
    preserveCompleted: true, expectedStateHash: expected.stateHash, reason: savedReason, cancelledBy: "workspace:" + actor,
  })); } catch (error) {
    // Only explicit domain refusals prove the MES transaction rolled back.
    if ([400, 409].includes(Number(error.status)) && ["V4_CANCELLATION_STALE", "V4_FORECAST_LINE_BLOCKED",
      "V4_FORECAST_LINE_NOT_FOUND", "V4_FORECAST_LINE_AMBIGUOUS"].includes(error.code))
      ensure(await admin.from("workspace_production_request_audit").insert({
        production_request_id: requestId, action: "FORECAST_LINE_CANCELLATION_REJECTED", reason: error.message,
        actor_id: actor, details: { workspaceLineId, attemptId },
      }));
    throw error;
  }
  verifyScope(result, workspaceLineId);
  if (result.status !== "CANCELLED") throw fail("MES non ha confermato l'annullamento della previsione.");
  ensure(await admin.from("workspace_production_request_audit").insert({
    production_request_id: requestId, action: "FORECAST_LINE_CANCELLED", previous_status: ctx.request.workspace_status,
    new_status: ctx.request.workspace_status, reason: savedReason, actor_id: actor, details: { workspaceLineId, result },
  }));
  return result;
}
