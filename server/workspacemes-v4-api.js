import { randomUUID } from "node:crypto";
import { aggregateWorkspaceHashes, createProgremesProductionClient } from "./progremes-production-client.js";
import { deterministicUuid, payloadHash } from "./workspacemes-v3.js";

const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const fail = (message, code, status = 409) => Object.assign(new Error(message), { code, status });
const ensure = (result) => { if (result.error) throw result.error; return result.data || []; };

async function ensureRequestNotCancelling(admin, requestId) {
  const request = ensure(await admin.from("workspace_production_requests").select("workspace_status,stato").eq("id", requestId).limit(1))[0];
  if (!request || upper(request.workspace_status || request.stato) === "CANCELLED")
    throw fail("RdP annullata o non trovata.", "RDP_CANCELLED");
  const pending = ensure(await admin.from("workspace_rdp_cancellations").select("request_id").eq("request_id", requestId).neq("status", "REJECTED").limit(1));
  if (pending.length) throw fail("RdP in annullamento o già annullata: completare la riconciliazione, senza riconfermarla.", "RDP_CANCELLATION_PENDING");
}

export function automaticWorkspaceV4Decision(preview, materials = []) {
  const hasBlockingMaterial = materials.some((material) => clean(material?.block_code));
  if (upper(preview?.status) === "BLOCKED" || hasBlockingMaterial)
    throw fail("La preview contiene blocchi tecnici: correggerli e ricalcolare la RdP prima della conferma.", "V4_PREVIEW_BLOCKED", 409);
  const hasShortages = materials.some((material) => Number(material?.shortage_quantity) > 0);
  return hasShortages ? "WITH_SHORTAGES" : "COMPLETE";
}

export function validateWorkspaceV4ProductionResult(preview, result) {
  const expectedDemands = Array.isArray(preview?.snapshot?.demands) ? preview.snapshot.demands : [];
  const productionOrders = Array.isArray(result?.productionOrders) ? result.productionOrders : [];
  if (result?.status === "FORECAST" && result.productionCreated === false && productionOrders.length === 0) {
    const actual = Array.isArray(result.forecastLines) ? result.forecastLines : [];
    const expected = expectedDemands.map(x => x.workspaceLineId);
    if (!expected.length || expected.some(x => !x) || actual.length !== expected.length || new Set(actual).size !== actual.length || expected.some(id => !actual.includes(id)))
      throw fail("MES non ha confermato tutte le righe previsionali della RdP.", "V5_FORECAST_INCOMPLETE");
    return [];
  }
  const validOrders = productionOrders.filter((order) =>
    Number.isSafeInteger(Number(order?.id)) && Number(order.id) > 0 && clean(order?.number));
  if (result?.productionCreated !== true || !expectedDemands.length ||
      validOrders.length !== expectedDemands.length || validOrders.length !== productionOrders.length) {
    throw fail(
      `MES ha restituito ${validOrders.length} OP validi su ${expectedDemands.length} righe produttive: la RdP non viene confermata.`,
      "V4_PRODUCTION_INCOMPLETE",
    );
  }
  return productionOrders;
}

async function loadDemand(admin, requestId) {
  const requests = ensure(await admin.from("workspace_production_requests")
    .select("id,external_id,rdp_number,contract_version,demand_snapshot_id,workspace_status,stato")
    .eq("id", requestId).limit(1));
  const request = requests[0];
  if (!request?.demand_snapshot_id || Number(request.contract_version) !== 4)
    throw fail("La RdP V4 è necessaria per il flusso produttivo.", "V4_RDP_REQUIRED");
  const snapshots = ensure(await admin.from("workspace_production_demand_snapshots")
    .select("snapshot,captured_at").eq("id", request.demand_snapshot_id).limit(1));
  const demand = snapshots[0]?.snapshot;
  if (!Array.isArray(demand?.items) || !demand.items.length || !Array.isArray(demand?.orders) || !demand.orders.length)
    throw fail("Snapshot domanda V4 incompleto.", "V4_DEMAND_REQUIRED");
  return { request, demand, capturedAt: snapshots[0].captured_at };
}

export async function workspaceV4FinishedArticleCodes(admin, requestId) {
  const { demand } = await loadDemand(admin, requestId);
  return [...new Set(demand.items.map((item) => upper(item.commercialArticleCode)).filter(Boolean))];
}

function buildPreviewIdentity({ requestId, octHash, demands }) {
  const attempt = randomUUID();
  const digest = payloadHash({ contractVersion: 4, requestId, octHash, demands, attempt });
  const idempotencyKey = `workspacemes:v4:preview:${digest}`;
  return { idempotencyKey, externalId: deterministicUuid({ purpose: "v4-preview", idempotencyKey }),
    correlationId: deterministicUuid({ purpose: "v4-correlation", idempotencyKey }) };
}

export async function createWorkspaceV4Preview({ admin, requestId, requestedBy, client = createProgremesProductionClient() }) {
  if (!client.v4PreviewEnabled()) throw fail("Preview WorkspaceMES V4 disabilitata.", "V4_PREVIEW_DISABLED", 403);
  const input = await loadDemand(admin, requestId);
  await ensureRequestNotCancelling(admin, requestId);
  const latest = ensure(await admin.from("workspace_v4_previews").select("status,snapshot")
    .eq("production_request_id", requestId).order("captured_at", { ascending: false }).limit(1))[0];
  if (latest?.status === "READY" && latest.snapshot?.confirmationRecovery && !latest.snapshot.confirmationRecovery.rejected)
    throw fail("Recuperare la conferma in corso prima di ricalcolare la RdP.", "V4_CONFIRM_PENDING");
  const orders = new Map(input.demand.orders.map((order) => [clean(order.orderId), order]));
  const demands = input.demand.items.map((item) => {
    const order = orders.get(clean(item.orderId));
    const quantity = Number(item.productionQuantity ?? item.requestedQuantity);
    const unitOfMeasure = upper(item.productionUnitOfMeasure || item.requestedUnitOfMeasure);
    if (!item.lineId || !upper(item.commercialArticleCode) || !positive(quantity) || !unitOfMeasure)
      throw fail("Riga prodotto finito V4 incompleta.", "INVALID_V4_DEMAND", 400);
    const octReference = [order?.sigla, order?.serie, order?.numero].map(clean).filter(Boolean).join("/");
    return { workspaceLineId: item.lineId, finishedArticleCode: upper(item.commercialArticleCode), quantity,
      unitOfMeasure, requiredAt: item.requestedDeliveryDate || order?.requestedDeliveryDate || input.capturedAt,
      octReference, customerTechnicalReference: clean(order?.customerTechnicalReference) };
  });
  const octHash = aggregateWorkspaceHashes(input.demand.orders.map((order) => order.versionHash));
  if (!octHash) throw fail("Hash OCT V4 mancante.", "V4_OCT_HASH_MISSING");
  const identity = buildPreviewIdentity({ requestId, octHash, demands });
  const command = { contractVersion: 4, externalId: identity.externalId,
    workspaceRdpExternalId: input.request.external_id, idempotencyKey: identity.idempotencyKey,
    expectedOctHash: octHash, correlationId: identity.correlationId, causationId: input.request.external_id, demands };
  const sent = await client.previewV4(command);
  const materials = sent.result.demands.flatMap((demand) => demand.materials.map((material) => ({
    workspace_line_id: demand.workspaceLineId, finished_article_code: demand.finishedArticleCode,
    source: material.source, article_code: material.articleCode, description: material.description,
    unit_of_measure: material.unitOfMeasure, gross_requirement: material.grossRequirement,
    physical_stock: material.physicalStock, committed_quantity: material.committedQuantity,
    net_stock: material.netStock, future_supply_quantity: material.futureSupplyQuantity,
    projected_availability: material.projectedAvailability, shortage_quantity: material.shortageQuantity,
    available_at: material.availableAt, required_at: material.requiredAt,
    formula_version_id: material.formulaVersionId, bom_revision: material.bomRevision,
    block_code: material.blockCode || null, certified_hash: material.certifiedHash,
  })));
  const status = sent.result.status.toUpperCase();
  const persisted = ensure(await admin.rpc("persist_workspace_v4_preview", {
    p_external_id: identity.externalId, p_production_request_id: requestId,
    p_preview_hash: sent.result.snapshotHash, p_idempotency_key: identity.idempotencyKey,
    p_payload_hash: payloadHash(command), p_status: status, p_oct_hash: octHash,
    p_row_version: sent.result.rowVersion, p_snapshot: sent.result,
    p_correlation_id: identity.correlationId, p_causation_id: input.request.external_id,
    p_requested_by: requestedBy, p_materials: materials,
  }))[0];
  return { ...persisted, externalId: identity.externalId, previewHash: sent.result.snapshotHash,
    status, demands: sent.result.demands, materials, mutatesProduction: false };
}

export async function confirmWorkspaceV4({ admin, previewId, reason, requestedBy,
  client = createProgremesProductionClient() }) {
  if (!client.v4ConfirmationEnabled()) throw fail("Conferma WorkspaceMES V4 disabilitata.", "V4_CONFIRM_DISABLED", 403);
  if (clean(reason).length < 5) throw fail("Motivazione obbligatoria.", "INVALID_REASON", 400);
  const previews = ensure(await admin.from("workspace_v4_previews").select("*").eq("id", previewId).limit(1));
  const preview = previews[0];
  if (!preview) throw fail("Preview V4 non confermabile.", "V4_PREVIEW_NOT_CONFIRMABLE");
  await ensureRequestNotCancelling(admin, preview.production_request_id);
  const existing = ensure(await admin.from("workspace_v4_confirmation_mirrors").select("*").eq("preview_id", preview.id).limit(1))[0];
  if (existing && existing.status !== "CANCELLED") return { confirmation: existing, mes: existing.mes_response };
  if (!["READY", "BLOCKED"].includes(preview.status)) throw fail("Preview V4 non confermabile.", "V4_PREVIEW_NOT_CONFIRMABLE");
  const materials = ensure(await admin.from("workspace_v4_preview_materials")
    .select("shortage_quantity,block_code").eq("preview_id", preview.id));
  const normalizedDecision = automaticWorkspaceV4Decision(preview, materials);
  const request = ensure(await admin.from("workspace_production_requests").select("id,external_id,rdp_number")
    .eq("id", preview.production_request_id).limit(1))[0];
  if (!Number.isSafeInteger(Number(request?.rdp_number)) || Number(request.rdp_number) <= 0)
    throw fail("Progressivo RdP Workspace non valido.", "V4_RDP_NUMBER_REQUIRED", 409);
  const idempotencyKey = `workspacemes:v4:confirm:${payloadHash({ previewHash: preview.preview_hash, decision: normalizedDecision })}`;
  const externalId = deterministicUuid({ purpose: "v4-confirmation", idempotencyKey });
  let command = { contractVersion: 4, externalId, previewExternalId: preview.external_id,
    idempotencyKey, expectedPreviewHash: preview.preview_hash, workspaceRdpNumber: Number(request.rdp_number),
    decision: normalizedDecision,
    reason: clean(reason), decidedBy: `workspace:${requestedBy || "service"}`,
    correlationId: preview.correlation_id, causationId: preview.external_id };
  // Claim once before sending. Concurrent callers and later sessions reuse the
  // exact original payload, including actor/reason, required by MES idempotency.
  ensure(await admin.from("workspace_v4_previews").update({ snapshot: {
    ...preview.snapshot, confirmationRecovery: { command, actor: requestedBy || "workspace:service" },
  } }).eq("id", preview.id).eq("status", "READY").is("snapshot->confirmationRecovery", null));
  const saved = ensure(await admin.from("workspace_v4_previews").select("*").eq("id", preview.id).limit(1))[0];
  const recovery = saved?.snapshot?.confirmationRecovery;
  if (!recovery?.command) throw fail("La preview è cambiata prima dell'invio.", "V4_PREVIEW_NOT_CONFIRMABLE");
  command = recovery.command;
  let sent;
  try {
    sent = recovery.response ? { result: recovery.response } : await client.confirmV4(request.external_id, command);
  } catch (error) {
    const uncertain = error.name === "AbortError" || error.name === "TypeError" || /TIMEOUT|HTTP_50[234]/.test(error.code || "");
    if (uncertain) throw fail("Conferma in verifica: recupero dell'esito MES della stessa richiesta.", "V4_CONFIRM_PENDING", 202);
    ensure(await admin.from("workspace_v4_previews").update({ snapshot: {
      ...saved.snapshot, confirmationRecovery: { ...recovery, rejected: true },
    } }).eq("id", preview.id));
    throw error;
  }
  validateWorkspaceV4ProductionResult(preview, sent.result);
  try {
    ensure(await admin.from("workspace_v4_previews").update({ snapshot: {
      ...saved.snapshot, confirmationRecovery: { ...recovery, response: sent.result },
    } }).eq("id", preview.id));
    const result = ensure(await admin.rpc(sent.result.status === "FORECAST" ? "confirm_workspace_forecast_after_mes" : "confirm_workspace_v4_after_mes", {
      p_preview_id: preview.id, p_external_id: externalId, p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash(command), p_expected_row_version: preview.local_row_version,
      p_decision: normalizedDecision, p_mes_response: sent.result,
      p_actor: recovery.actor, p_reason: command.reason,
      p_correlation_id: preview.correlation_id, p_causation_id: preview.external_id,
    }))[0];
    return { confirmation: result, mes: sent.result };
  } catch (error) {
    console.error("Conferma MES completata; mirror Workspace da recuperare", { previewId: preview.id, code: error.code });
    throw fail("MES ha risposto: completamento della registrazione Workspace in verifica.", "V4_CONFIRM_PENDING", 202);
  }
}
