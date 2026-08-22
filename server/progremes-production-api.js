import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { verifyProductionMessage } from "./progremes-production-hmac.js";
import { createProductionPayload, createProgremesProductionClient } from "./progremes-production-client.js";

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
  const { data: line, error: lineError } = await admin.from("ordini_righe").select("*").eq("id", lineId).single();
  if (lineError || !line || line.riga_descrittiva || !line.codice_articolo || Number(line.quantita) <= 0)
    return res.status(400).json({ error: "Riga OCT non produttiva.", code: "INVALID_OCT_LINE" });
  const { data: order, error: orderError } = await admin.from("ordini_testate").select("*").eq("id", line.ordine_id).single();
  if (orderError || order?.origine !== "mexal_oct") return res.status(400).json({ error: "La riga non appartiene a un OCT.", code: "INVALID_OCT" });
  let { data: productionRequest } = await admin.from("workspace_production_requests").select("*").eq("ordine_riga_id", line.id).maybeSingle();
  if (!productionRequest) {
    const { data, error } = await admin.from("workspace_production_requests")
      .insert({ ordine_id: order.id, ordine_riga_id: line.id }).select("*").single();
    if (error) throw error; productionRequest = data;
  }
  const payload = createProductionPayload({ request: productionRequest, order, line });
  const { result, payloadHash } = await client.sendRequest(payload);
  await admin.from("workspace_production_requests").update({ payload_hash: payloadHash, stato: result.status,
    workspace_status: result.workspaceStatus, attempt_count: Number(productionRequest.attempt_count || 0) + 1,
    updated_at: new Date().toISOString() }).eq("id", productionRequest.id);
  if (Array.isArray(result.proposals) && result.proposals.length) {
    const rows = result.proposals.map((proposal) => ({
      production_request_id: productionRequest.id,
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
  return res.status(200).json(result);
}

export async function confirmProductionProposal(req, res, { admin = adminClient(), client = createProgremesProductionClient() } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  if (!client.confirmationEnabled()) return res.status(403).json({ error: "Conferma OP disabilitata.", code: "MODULE_DISABLED" });
  const proposalId = Number(req.body?.proposalId);
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0)
    return res.status(400).json({ error: "OP non valida.", code: "INVALID_PROPOSAL" });
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
