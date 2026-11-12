import { createProgremesProductionClient } from "./progremes-production-client.js";

const ensure = ({ data, error }) => { if (error) throw error; return data; };

// This preview never prepares an intent or changes business data.
export async function previewCoordinatedProductionCancellation({ admin, requestId, requestedBy,
  client = createProgremesProductionClient() }) {
  const request = ensure(await admin.from("workspace_production_requests")
    .select("id,external_id,contract_version,workspace_status,stato").eq("id", requestId).single());
  if (!request) throw Object.assign(new Error("RdP non trovata."), { status: 404 });
  const previews = [];
  if (Number(request.contract_version) === 4) {
    const rows = ensure(await admin.from("workspace_v4_previews").select("id,status").eq("production_request_id", requestId));
    const mirrors = rows.length ? ensure(await admin.from("workspace_v4_confirmation_mirrors")
      .select("external_id,status").in("preview_id", rows.map(row => row.id)).order("id")) : [];
    const targets = mirrors.filter(row => String(row.status).toUpperCase() !== "REPLACED");
    if (!targets.length && (["CONFIRMED", "PLANNED", "FORECAST"].includes(String(request.workspace_status || request.stato).toUpperCase()) || rows.some(row => row.status === "CONFIRMED")))
      throw Object.assign(new Error("Conferma MES da riconciliare prima dell’annullamento."), { status: 409, code: "MES_CONFIRMATION_MISSING" });
    for (const target of targets) {
      const { result } = await client.previewCancellationV4(request.external_id, {
        contractVersion: 4, confirmationExternalId: target.external_id, preserveCompleted: true,
        reason: "Verifica annullamento del residuo", cancelledBy: `workspace:${requestedBy || "service"}`,
      });
      if (result?.confirmationExternalId !== target.external_id || !/^[a-f0-9]{64}$/.test(result.stateHash || "") || typeof result.allowed !== "boolean" ||
        !Array.isArray(result.cancelledOrders) || !Array.isArray(result.preservedOrders) || !Array.isArray(result.blocks))
        throw Object.assign(new Error("Anteprima MES non valida; annullamento non disponibile."), { status: 502 });
      previews.push(result);
    }
  }
  return { allowed: previews.every(row => row.allowed), previews,
    cancelledOrders: previews.flatMap(row => row.cancelledOrders), preservedOrders: previews.flatMap(row => row.preservedOrders),
    blocks: previews.flatMap(row => row.blocks) };
}

// Durable intent first; MES first; local retirement only after a verified response.
// Retrying an uncertain response uses the same persisted targets and reason.
export async function cancelCoordinatedProductionRequest({ admin, requestId, reason, requestedBy, previews,
  client = createProgremesProductionClient() }) {
  if (previews !== undefined && (!Array.isArray(previews) || previews.some(row => !row?.confirmationExternalId || !/^[a-f0-9]{64}$/.test(row.stateHash || "")) ||
    new Set(previews.map(row => row.confirmationExternalId)).size !== previews.length))
    throw Object.assign(new Error("Ripetere l’anteprima di annullamento."), { status: 409, code: "V4_CANCELLATION_STALE" });
  const operation = ensure(await admin.rpc("prepare_workspace_rdp_cancellation", {
    p_request_id: requestId, p_reason: reason, p_cancelled_by: requestedBy,
  }));
  if (operation.status === "COMPLETED") return { ...operation, cancelled_at: operation.cancelled_at || operation.completed_at };
  if (previews && (previews.length !== operation.confirmations.length || operation.confirmations.some(id => !previews.some(row => row.confirmationExternalId === id)))) {
    throw Object.assign(new Error("Le conferme sono cambiate: ripetere l’anteprima."), { status: 409, code: "V4_CANCELLATION_STALE" });
  }
  const cancelledOrders = [], preservedOrders = [];
  let completedHere = 0;
  for (const confirmationExternalId of operation.confirmations) {
    let result;
    try { ({ result } = await client.cancelV4(operation.external_id, {
      contractVersion: 4, confirmationExternalId,
      ...(previews ? { preserveCompleted: true, expectedStateHash: previews.find(row => row.confirmationExternalId === confirmationExternalId).stateHash } : {}),
      reason: operation.reason, cancelledBy: `workspace:${operation.actor_id || "service"}`,
    })); } catch (error) {
      // These domain refusals guarantee a rollback in MES. Transport failures
      // remain PREPARED: never unlock an uncertain or partially completed saga.
      if (completedHere === 0 && [400, 409].includes(Number(error.status)) &&
        ["V4_CANCELLATION_STALE", "V4_ORDER_IRREVERSIBLE", "V4_CANCELLATION_BLOCKED", "V4_CONFIRMATION_NOT_FOUND"].includes(error.code)) {
        ensure(await admin.rpc("reject_workspace_rdp_cancellation", { p_request_id: requestId, p_error: error.message }));
      }
      throw error;
    }
    if (result?.status !== "CANCELLED")
      throw Object.assign(new Error("MES non ha confermato l’annullamento. Nessuna RdP è stata marcata annullata in Workspace; riprovare per riconciliare l’esito."), { code: "INVALID_MES_CANCELLATION", status: 502 });
    cancelledOrders.push(...(result.cancelledOrders || []));
    preservedOrders.push(...(result.preservedOrders || []));
    completedHere++;
  }
  return { ...ensure(await admin.rpc("complete_workspace_rdp_cancellation", { p_request_id: requestId })), cancelledOrders, preservedOrders };
}
