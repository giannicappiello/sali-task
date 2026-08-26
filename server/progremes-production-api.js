import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { verifyProductionMessage } from "./progremes-production-hmac.js";
import { createProductionPayload, createProgremesProductionClient } from "./progremes-production-client.js";
import { prepareProductionDemand, productionDemandContract } from "./production-netting.js";

const EVENT_PATH = "/api/progremes-production/events";
function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Configurazione server mancante: ${name}`); return value; }
function adminClient() { return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }
function rawBody(req) { return Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {})); }

export async function handleProductionEvent(req, res, { admin = adminClient() } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  if (String(process.env.PROGREMES_PRODUCTION_CALLBACKS_ENABLED || "").toLowerCase() !== "true")
    return res.status(403).json({ error: "Callback MES disabilitato.", code: "MODULE_DISABLED" });
  const body = rawBody(req);
  if (!verifyProductionMessage({ method: "POST", path: EVENT_PATH, headers: req.headers, body,
    secret: required("PROGREMES_INTEGRATION_SECRET") }))
    return res.status(401).json({ error: "Autenticazione non valida.", code: "INVALID_SIGNATURE" });
  const event = req.body;
  if (![1, 2].includes(event?.schemaVersion) || !event?.eventId || !event?.externalId || !Number.isSafeInteger(event?.sequence))
    return res.status(400).json({ error: "Evento MES non valido.", code: "INVALID_REQUEST" });
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const { data, error } = await admin.rpc("process_workspace_production_event", {
    p_event_id: event.eventId, p_external_id: event.externalId, p_sequence: event.sequence,
    p_event_type: event.type, p_payload_hash: payloadHash, p_payload: event,
  });
  if (error) return res.status(409).json({ error: "Evento MES in conflitto.", code: "EVENT_CONFLICT" });
  return res.status(200).json({ status: data });
}

function selection(body) {
  return {
    orderIds: Array.isArray(body?.orderIds) ? body.orderIds : [],
    lineIds: Array.isArray(body?.lineIds) ? body.lineIds : (body?.lineId ? [body.lineId] : []),
  };
}

async function loadPersistedProductionRequest(admin, requestId) {
  const id = String(requestId || "").trim();
  if (!id) throw Object.assign(new Error("RdP obbligatoria."), { code: "INVALID_REQUEST", status: 400 });
  const { data: request, error: requestError } = await admin.from("workspace_production_requests")
    .select("*").eq("id", id).maybeSingle();
  if (requestError) throw requestError;
  if (!request) throw Object.assign(new Error("RdP non trovata."), { code: "NOT_FOUND", status: 404 });
  if (request.sent_demand_snapshot_id || request.last_response)
    throw Object.assign(new Error("La RdP risulta già inviata a ProgreMES."), { code: "ALREADY_SENT", status: 409 });
  if (!request.demand_snapshot_id || Number(request.contract_version || 2) !== 2)
    throw Object.assign(new Error("La RdP non dispone di uno snapshot v2 retryable."), { code: "DEMAND_REQUIRED", status: 409 });
  const { data: snapshotRow, error: snapshotError } = await admin.from("workspace_production_demand_snapshots")
    .select("id,snapshot_hash,demand_hash,captured_at,snapshot")
    .eq("id", request.demand_snapshot_id).maybeSingle();
  if (snapshotError) throw snapshotError;
  const snapshot = snapshotRow?.snapshot;
  if (!snapshotRow || snapshot?.version !== 2 || snapshot?.kind !== "MULTI_OCT_PRODUCTION_DEMAND" ||
      !Array.isArray(snapshot.orders) || !snapshot.orders.length || !Array.isArray(snapshot.items) || !snapshot.items.length)
    throw Object.assign(new Error("Snapshot persistito della RdP non valido."), { code: "INVALID_DEMAND_SNAPSHOT", status: 409 });
  return {
    request: {
      id: request.id,
      external_id: request.external_id,
      idempotency_key: request.idempotency_key,
      attempt_count: Number(request.attempt_count || 0),
    },
    snapshot: {
      ...snapshot,
      id: Number(snapshotRow.id),
      hash: snapshotRow.snapshot_hash,
      capturedAt: snapshotRow.captured_at || snapshot.capturedAt,
      reused: true,
    },
    demand: {
      contractVersion: snapshot.contractVersion,
      orders: snapshot.orders,
      items: snapshot.items,
    },
    changedFromExpected: false,
  };
}

export async function sendProductionRequest(req, res, {
  admin = adminClient(),
  client = createProgremesProductionClient(),
  requestedBy = null,
} = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  if (!client.requestEnabled()) return res.status(403).json({ error: "Invio RdP disabilitato.", code: "MODULE_DISABLED" });
  let prepared;
  try {
    if (req.body?.requestId) {
      if (req.body?.snapshotId || selection(req.body).orderIds.length || selection(req.body).lineIds.length)
        return res.status(400).json({ error: "Il retry accetta esclusivamente il requestId persistito.", code: "INVALID_RETRY_PAYLOAD" });
      prepared = await loadPersistedProductionRequest(admin, req.body.requestId);
    } else {
      prepared = await prepareProductionDemand({
        admin,
        ...selection(req.body),
        mode: "send",
        expectedSnapshotId: req.body?.snapshotId ?? null,
        requestedBy,
      });
    }
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.message || "Preparazione RdP non riuscita.", code: error?.code || "DEMAND_PREPARATION_FAILED" });
  }
  if (req.body?.snapshotId && prepared.changedFromExpected)
    return res.status(409).json({ error: "La domanda OCT è cambiata dalla preview. Ripetere la verifica prima dell'invio.", code: "DEMAND_CHANGED", snapshot: prepared.snapshot, demand: productionDemandContract(prepared.demand) });
  const payload = createProductionPayload({ request: prepared.request, snapshot: prepared.snapshot, demand: prepared.demand });
  let sent;
  try {
    sent = await client.sendRequest(payload);
  } catch (error) {
    await admin.from("workspace_production_requests").update({
      last_error_code: error?.code || "PROGREMES_REQUEST_FAILED",
      attempt_count: prepared.request.attempt_count + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", prepared.request.id);
    throw error;
  }
  const { result, payloadHash } = sent;
  const { error: responseError } = await admin.rpc("record_workspace_production_v2_response", {
    p_request_id: prepared.request.id,
    p_payload_hash: payloadHash,
    p_snapshot_id: prepared.snapshot.id,
    p_response: result,
  });
  if (responseError)
    throw Object.assign(new Error("Risposta ProgreMES non registrata atomicamente."), { code: "MES_RESPONSE_PERSIST_FAILED", cause: responseError });
  if (Array.isArray(result.proposals) && result.proposals.length) {
    const { data: requestItems, error: requestItemsError } = await admin.from("workspace_production_request_items")
      .select("id,item_external_key").eq("production_request_id", prepared.request.id);
    if (requestItemsError) throw requestItemsError;
    const requestItemByKey = new Map((requestItems || []).map((item) => [item.item_external_key, item.id]));
    const rows = result.proposals.map((proposal) => ({
      production_request_id: prepared.request.id,
      production_request_item_id: requestItemByKey.get(proposal.itemExternalKey) || null,
      item_external_key: proposal.itemExternalKey || null,
      mes_proposal_id: proposal.id,
      production_index: proposal.productionIndex,
      quantita: proposal.quantity,
      stato: proposal.status,
      material_status: proposal.materialStatus,
      expected_material_availability: proposal.expectedMaterialAvailability,
      mes_production_order_id: proposal.productionOrderId,
      mes_production_order_number: proposal.productionOrderNumber,
      updated_at: new Date().toISOString(),
    }));
    if (rows.some((row) => !row.production_request_item_id))
      throw Object.assign(new Error("ProgreMES ha restituito una proposta non riconciliabile con le righe OCT."), { code: "INVALID_MES_RESPONSE" });
    const { error } = await admin.from("workspace_production_proposals").upsert(rows, { onConflict: "mes_proposal_id" });
    if (error) throw error;
  }
  return res.status(200).json({ ...result, sent: true, snapshot: prepared.snapshot, demand: productionDemandContract(prepared.demand) });
}

export async function previewProductionRequest(req, res, { admin = adminClient(), requestedBy = null } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try {
    const prepared = await prepareProductionDemand({ admin, ...selection(req.body), mode: "preview", requestedBy });
    return res.status(200).json({ readOnlyExternal: true, sent: false, externalId: prepared.request?.external_id || null,
      snapshot: prepared.snapshot, demand: productionDemandContract(prepared.demand), status: "PRONTA" });
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.message || "Preview RdP non riuscita.", code: error?.code || "DEMAND_PREPARATION_FAILED" });
  }
}

export async function confirmProductionProposal(req, res, { admin = adminClient(), client = createProgremesProductionClient() } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  if (!client.confirmationEnabled()) return res.status(403).json({ error: "Conferma OP disabilitata.", code: "MODULE_DISABLED" });
  const proposalId = Number(req.body?.proposalId);
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0)
    return res.status(400).json({ error: "OP non valida.", code: "INVALID_PROPOSAL" });
  const { data: proposal, error: proposalError } = await admin.from("workspace_production_proposals")
    .select("id,production_request_id").eq("id", proposalId).single();
  if (proposalError || !proposal) return res.status(404).json({ error: "OP non trovata.", code: "NOT_FOUND" });
  const { data: productionRequest, error: requestError } = await admin.from("workspace_production_requests")
    .select("*").eq("id", proposal.production_request_id).single();
  if (requestError || !productionRequest?.sent_demand_snapshot_id)
    return res.status(409).json({ error: "La proposta non dispone di una domanda RdP inviata e auditabile.", code: "DEMAND_REQUIRED" });
  const { data, error } = await admin.rpc("reserve_workspace_production_confirmation", {
    p_proposal_id: proposalId, p_external_id: randomUUID(),
  });
  if (error || !data?.[0]) return res.status(404).json({ error: "OP non trovata.", code: "NOT_FOUND" });
  const reservation = data[0];
  const response = await client.confirmProposal(reservation.mes_proposal_id, reservation.confirmation_external_id);
  await admin.from("workspace_production_proposals").update({ confirmation_payload_hash: response.payloadHash,
    updated_at: new Date().toISOString() }).eq("id", proposalId);
  return res.status(200).json(response.result);
}

export { EVENT_PATH };
