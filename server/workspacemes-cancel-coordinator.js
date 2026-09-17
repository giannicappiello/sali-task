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
  for (const confirmationExternalId of operation.confirmations) {
    const { result } = await client.cancelV4(operation.external_id, {
      contractVersion: 4, confirmationExternalId,
      reason: operation.reason, cancelledBy: `workspace:${operation.actor_id || "service"}`,
    });
    if (result?.status !== "CANCELLED")
      throw Object.assign(new Error("MES non ha confermato l’annullamento. Nessuna RdP è stata marcata annullata in Workspace; riprovare per riconciliare l’esito."), { code: "INVALID_MES_CANCELLATION", status: 502 });
  }
  return ensure(await admin.rpc("complete_workspace_rdp_cancellation", { p_request_id: requestId }));
}
