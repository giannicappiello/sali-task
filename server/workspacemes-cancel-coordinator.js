import { createProgremesProductionClient } from "./progremes-production-client.js";

const ensure = ({ data, error }) => { if (error) throw error; return data; };

// Durable intent first; MES first; local retirement only after a verified response.
// Retrying an uncertain response uses the same persisted targets and reason.
export async function cancelCoordinatedProductionRequest({ admin, requestId, reason, requestedBy,
  client = createProgremesProductionClient() }) {
  const operation = ensure(await admin.rpc("prepare_workspace_rdp_cancellation", {
    p_request_id: requestId, p_reason: reason, p_cancelled_by: requestedBy,
  }));
  if (operation.status === "COMPLETED") return { ...operation, cancelled_at: operation.cancelled_at || operation.completed_at };
  let completedHere = 0;
  for (const confirmationExternalId of operation.confirmations) {
    let result;
    try { ({ result } = await client.cancelV4(operation.external_id, {
      contractVersion: 4, confirmationExternalId,
      reason: operation.reason, cancelledBy: `workspace:${operation.actor_id || "service"}`,
    })); } catch (error) {
      // These domain refusals guarantee a rollback in MES. Transport failures
      // remain PREPARED: never unlock an uncertain or partially completed saga.
      if (completedHere === 0 && [400, 409].includes(Number(error.status)) &&
        ["V4_ORDER_IRREVERSIBLE", "V4_CANCELLATION_BLOCKED", "V4_CONFIRMATION_NOT_FOUND"].includes(error.code)) {
        ensure(await admin.rpc("reject_workspace_rdp_cancellation", { p_request_id: requestId, p_error: error.message }));
      }
      throw error;
    }
    if (result?.status !== "CANCELLED")
      throw Object.assign(new Error("MES non ha confermato l’annullamento. Nessuna RdP è stata marcata annullata in Workspace; riprovare per riconciliare l’esito."), { code: "INVALID_MES_CANCELLATION", status: 502 });
    completedHere++;
  }
  return ensure(await admin.rpc("complete_workspace_rdp_cancellation", { p_request_id: requestId }));
}
