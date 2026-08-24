import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { verifyProductionMessage } from "./progremes-production-hmac.js";
import { createProductionPayload, createProgremesProductionClient } from "./progremes-production-client.js";
import { prepareProductionNetting, productionNettingContract } from "./production-netting.js";

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
  if (event?.schemaVersion !== 1 || !event?.eventId || !event?.externalId || !Number.isSafeInteger(event?.sequence))
    return res.status(400).json({ error: "Evento MES non valido.", code: "INVALID_REQUEST" });
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const { data, error } = await admin.rpc("process_workspace_production_event", {
    p_event_id: event.eventId, p_external_id: event.externalId, p_sequence: event.sequence,
    p_event_type: event.type, p_payload_hash: payloadHash, p_payload: event,
  });
  if (error) return res.status(409).json({ error: "Evento MES in conflitto.", code: "EVENT_CONFLICT" });
  return res.status(200).json({ status: data });
}

export async function sendProductionRequest(req, res, { admin = adminClient(), client = createProgremesProductionClient() } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  if (!client.requestEnabled()) return res.status(403).json({ error: "Invio RdP disabilitato.", code: "MODULE_DISABLED" });
  const lineId = String(req.body?.lineId || "").trim();
  let prepared;
  try {
    prepared = await prepareProductionNetting({ admin, lineId, mode: "send", expectedSnapshotId: req.body?.snapshotId ?? null });
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.message || "Nettificazione non riuscita.", code: error?.code || "NETTING_FAILED" });
  }
  if (req.body?.snapshotId && prepared.changedFromExpected)
    return res.status(409).json({ error: "La disponibilità è cambiata dalla preview. Ripetere la verifica prima dell'invio.", code: "AVAILABILITY_CHANGED", snapshot: prepared.snapshot, netting: productionNettingContract(prepared.netting) });
  if (prepared.netting.fullyCovered)
    return res.status(200).json({ status: "COPERTA_DA_SCORTA", workspaceStatus: "COPERTA_DA_SCORTA", sent: false, externalId: prepared.request.external_id, snapshot: prepared.snapshot, netting: productionNettingContract(prepared.netting), proposals: [] });
  const payload = createProductionPayload({ request: prepared.request, order: prepared.source.order, line: prepared.source.line, snapshot: prepared.snapshot, netting: prepared.netting });
  const { result, payloadHash } = await client.sendRequest(payload);
  const { error: requestUpdateError } = await admin.from("workspace_production_requests").update({ payload_hash: payloadHash, stato: result.status,
    workspace_status: result.workspaceStatus, attempt_count: prepared.request.attempt_count + 1,
    sent_availability_snapshot_id: prepared.snapshot.id, sent_quantita_da_produrre: prepared.netting.quantityToProduce,
    sent_unita_misura: prepared.netting.effectiveUnitOfMeasure, updated_at: new Date().toISOString() }).eq("id", prepared.request.id);
  if (requestUpdateError) throw requestUpdateError;
  if (Array.isArray(result.proposals) && result.proposals.length) {
    const rows = result.proposals.map((proposal) => ({
      production_request_id: prepared.request.id,
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
    const { error } = await admin.from("workspace_production_proposals").upsert(rows, { onConflict: "mes_proposal_id" });
    if (error) throw error;
  }
  return res.status(200).json({ ...result, sent: true, snapshot: prepared.snapshot, netting: productionNettingContract(prepared.netting) });
}

export async function previewProductionRequest(req, res, { admin = adminClient() } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  try {
    const prepared = await prepareProductionNetting({ admin, lineId: String(req.body?.lineId || "").trim(), mode: "preview" });
    return res.status(200).json({ readOnlyExternal: true, sent: false, externalId: prepared.request.external_id,
      snapshot: prepared.snapshot, netting: productionNettingContract(prepared.netting), status: prepared.netting.fullyCovered ? "COPERTA_DA_SCORTA" : "PRONTA" });
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.message || "Preview nettificazione non riuscita.", code: error?.code || "NETTING_FAILED" });
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
  if (requestError || !productionRequest?.sent_availability_snapshot_id)
    return res.status(409).json({ error: "La proposta non dispone di una nettificazione inviata e rivalidabile.", code: "NETTING_REQUIRED" });
  let revalidated;
  try {
    revalidated = await prepareProductionNetting({ admin, lineId: productionRequest.ordine_riga_id, mode: "confirm",
      expectedSnapshotId: productionRequest.sent_availability_snapshot_id });
  } catch (error) {
    return res.status(error?.status || 500).json({ error: error?.message || "Rivalidazione non riuscita.", code: error?.code || "NETTING_FAILED" });
  }
  if (revalidated.changedFromExpected || Number(revalidated.netting.quantityToProduce) !== Number(productionRequest.sent_quantita_da_produrre) ||
      revalidated.netting.effectiveUnitOfMeasure !== productionRequest.sent_unita_misura) {
    return res.status(409).json({ error: "Disponibilità o UDM cambiate dopo l'invio: rigenerare la proposta dalla riga OCT.",
      code: "AVAILABILITY_CHANGED", snapshot: revalidated.snapshot, netting: productionNettingContract(revalidated.netting) });
  }
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
