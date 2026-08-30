import { randomUUID } from "node:crypto";
import { aggregateWorkspaceHashes, createProgremesProductionClient } from "./progremes-production-client.js";
import { deterministicUuid, payloadHash } from "./workspacemes-v3.js";

const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const fail = (message, code, status = 409) => Object.assign(new Error(message), { code, status });
const ensure = (result) => { if (result.error) throw result.error; return result.data || []; };

export function automaticWorkspaceV4Decision(preview, materials = []) {
  const hasShortages = materials.some((material) => Number(material?.shortage_quantity) > 0);
  if (upper(preview?.status) === "BLOCKED" && !hasShortages)
    throw fail("La preview contiene blocchi non riconducibili a fabbisogni di acquisto.", "V4_NON_SHORTAGE_BLOCK", 409);
  return hasShortages ? "WITH_SHORTAGES" : "COMPLETE";
}

async function loadDemand(admin, requestId) {
  const requests = ensure(await admin.from("workspace_production_requests")
    .select("id,external_id,contract_version,demand_snapshot_id,workspace_status,stato")
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
  const orders = new Map(input.demand.orders.map((order) => [clean(order.orderId), order]));
  const demands = input.demand.items.map((item) => {
    const order = orders.get(clean(item.orderId));
    const quantity = Number(item.productionQuantity ?? item.requestedQuantity);
    const unitOfMeasure = upper(item.productionUnitOfMeasure || item.requestedUnitOfMeasure);
    if (!item.lineId || !upper(item.commercialArticleCode) || !positive(quantity) || !unitOfMeasure)
      throw fail("Riga prodotto finito V4 incompleta.", "INVALID_V4_DEMAND", 400);
    return { workspaceLineId: item.lineId, finishedArticleCode: upper(item.commercialArticleCode), quantity,
      unitOfMeasure, requiredAt: item.requestedDeliveryDate || order?.requestedDeliveryDate || input.capturedAt };
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
  if (!preview || !["READY", "BLOCKED"].includes(preview.status)) throw fail("Preview V4 non confermabile.", "V4_PREVIEW_NOT_CONFIRMABLE");
  const materials = ensure(await admin.from("workspace_v4_preview_materials")
    .select("shortage_quantity,block_code").eq("preview_id", preview.id));
  const normalizedDecision = automaticWorkspaceV4Decision(preview, materials);
  const request = ensure(await admin.from("workspace_production_requests").select("id,external_id")
    .eq("id", preview.production_request_id).limit(1))[0];
  const idempotencyKey = `workspacemes:v4:confirm:${payloadHash({ previewHash: preview.preview_hash, decision: normalizedDecision })}`;
  const externalId = deterministicUuid({ purpose: "v4-confirmation", idempotencyKey });
  const command = { contractVersion: 4, externalId, previewExternalId: preview.external_id,
    idempotencyKey, expectedPreviewHash: preview.preview_hash, decision: normalizedDecision,
    reason: clean(reason), decidedBy: `workspace:${requestedBy || "service"}`,
    correlationId: preview.correlation_id, causationId: preview.external_id };
  const sent = await client.confirmV4(request.external_id, command);
  if (!sent.result.productionCreated || !sent.result.productionOrders.length)
    throw fail("MES non ha creato alcun OdP V4.", "V4_PRODUCTION_NOT_CREATED");
  const result = ensure(await admin.rpc("confirm_workspace_v4_after_mes", {
    p_preview_id: preview.id, p_external_id: externalId, p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash(command), p_expected_row_version: preview.local_row_version,
    p_decision: normalizedDecision, p_mes_response: sent.result,
    p_actor: requestedBy || "workspace:service", p_reason: clean(reason),
    p_correlation_id: preview.correlation_id, p_causation_id: preview.external_id,
  }))[0];
  return { confirmation: result, mes: sent.result };
}
