import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import { HMAC_HEADERS, signProductionMessage } from "./progremes-production-hmac.js";

const REQUEST_PATH = "/api/workspace/v2/production-requests";
const CONFIRM_PATH = (id) => `/api/workspace/v1/production-proposals/${id}/confirmations`;
const DECISION_PATH = (externalId) => `/api/workspace/v2/production-requests/${externalId}/decisions`;
const V3_PREVIEW_PATH = "/api/workspace/v3/production-previews";
const V3_CONFIRM_PATH = (externalId) => `/api/workspace/v3/production-requests/${externalId}/confirmations`;
const V4_PREVIEW_PATH = "/api/workspace/v4/production-previews";
const V4_CONFIRM_PATH = (externalId) => `/api/workspace/v4/production-requests/${externalId}/confirmations`;
const V4_CANCEL_PATH = (externalId) => `/api/workspace/v4/production-requests/${externalId}/cancellations`;

function required(name, env) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Configurazione server mancante: ${name}`);
  return value;
}
function enabled(name, env) { return String(env[name] || "").trim().toLowerCase() === "true"; }
function hash(body) { return createHash("sha256").update(body).digest("hex"); }
function mesErrorMessage(result) {
  const message = [result?.error, result?.message, result?.detail, result?.title]
    .map((value) => text(value).replace(/[\r\n\t]+/g, " ").slice(0, 500))
    .find(Boolean);
  const code = text(result?.code).slice(0, 120);
  return message || (code ? `ProgreMES ha rifiutato la richiesta (${code}).` : "ProgreMES ha rifiutato la richiesta.");
}
export function createLineIdempotencyKey(requestKey, lineId, commercialRevision) {
  return `rdp-line:v2:${hash(JSON.stringify({ requestKey, lineId, commercialRevision }))}`;
}
function text(value) { return String(value ?? "").trim(); }
function positive(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function nonNegative(value) { return Number.isFinite(Number(value)) && Number(value) >= 0; }
export function aggregateWorkspaceHashes(hashes = []) {
  return hash(JSON.stringify([...hashes].map(text).filter(Boolean).sort()));
}

export function createProductionPayload({ request, snapshot, demand }) {
  if (!request?.external_id || !request?.idempotency_key || !snapshot?.id || !snapshot?.capturedAt ||
      !Array.isArray(demand?.orders) || !demand.orders.length || !Array.isArray(demand?.items) || !demand.items.length)
    throw new Error("Domanda RdP multi-OCT incompleta.");
  const itemsByOrder = new Map();
  for (const item of demand.items) {
    if (!item?.orderId || !item.lineId || !item.commercialArticleCode || !positive(item.requestedQuantity) ||
        !item.requestedUnitOfMeasure || !item.productionUnitOfMeasure ||
        ((item.mexalLinePosition === null || item.mexalLinePosition === undefined) && !item.itemIndex))
      throw new Error("Riga OCT incompleta nel payload RdP v2.");
    const values = itemsByOrder.get(item.orderId) || [];
    values.push(item);
    itemsByOrder.set(item.orderId, values);
  }
  const orderIds = new Set();
  const lineIds = new Set();
  for (const order of demand.orders || []) {
    if (!order?.orderId || !order.mexalKey || !order.sigla || order.serie === null || order.serie === undefined ||
        order.numero === null || order.numero === undefined || !order.customerTechnicalReference || !order.orderDate ||
        !order.sourceTimestamp || !Number.isSafeInteger(order.commercialRevision) || order.commercialRevision <= 0 ||
        !/^[0-9a-f]{64}$/.test(String(order.versionHash || "")) || !(itemsByOrder.get(order.orderId)?.length))
      throw new Error("Identità o revisione OCT incompleta nel payload RdP v2.");
    if (orderIds.has(order.orderId)) throw new Error("OCT duplicato nel payload RdP v2.");
    orderIds.add(order.orderId);
    for (const item of itemsByOrder.get(order.orderId)) {
      if (lineIds.has(item.lineId)) throw new Error("Riga OCT duplicata nel payload RdP v2.");
      lineIds.add(item.lineId);
    }
  }
  if (orderIds.size !== itemsByOrder.size)
    throw new Error("Una o più righe OCT non appartengono agli OCT dichiarati.");
  return {
    contractVersion: 2,
    workspaceExternalId: request.external_id,
    idempotencyKey: request.idempotency_key,
    timestamp: snapshot.capturedAt,
    requestedBy: snapshot.requestedBy || "workspace",
    octs: demand.orders.map((order) => ({
      workspaceOctId: order.orderId,
      mexalExternalId: order.mexalKey,
      sigla: order.sigla,
      serie: String(order.serie),
      numero: String(order.numero),
      customerReference: order.customerTechnicalReference,
      orderDate: order.orderDate,
      requestedDeliveryDate: order.requestedDeliveryDate,
      commercialRevision: order.commercialRevision,
      versionHash: order.versionHash,
      sourceTimestamp: order.sourceTimestamp || snapshot.capturedAt,
      lines: (itemsByOrder.get(order.orderId) || []).map((item) => ({
        workspaceLineId: item.lineId,
        mexalPosition: String(item.mexalLinePosition ?? item.itemIndex),
        isDescriptive: false,
        commercialArticleCode: item.commercialArticleCode,
        quantity: item.requestedQuantity,
        octUom: item.requestedUnitOfMeasure,
        articleUom: item.productionUnitOfMeasure,
        authoritativeConversionFactor: item.conversion?.factor ?? null,
        conversionSource: item.conversion?.source ?? null,
        requestedDate: item.requestedDeliveryDate,
        priority: null,
        idempotencyKey: createLineIdempotencyKey(request.idempotency_key, item.lineId, order.commercialRevision),
      })),
    })),
  };
}

export function validateProductionResponse(result, payload) {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      text(result.workspaceExternalId) !== text(payload.workspaceExternalId) || !text(result.status) ||
      result.productionMutationsEnabled !== false || !Array.isArray(result.octs) || !Array.isArray(result.analyses))
    throw Object.assign(new Error("Risposta RdP v2 di ProgreMES non valida."), { code: "INVALID_MES_RESPONSE" });
  const expectedOcts = new Map(payload.octs.map((oct) => [text(oct.workspaceOctId), oct]));
  if (result.octs.length !== expectedOcts.size)
    throw Object.assign(new Error("Risposta RdP v2 incompleta per gli OCT inviati."), { code: "INVALID_MES_RESPONSE" });
  for (const oct of result.octs) {
    const expected = expectedOcts.get(text(oct.workspaceOctId));
    if (!expected || Number(oct.revision) !== expected.commercialRevision || text(oct.versionHash) !== expected.versionHash)
      throw Object.assign(new Error("Risposta RdP v2 non riconciliabile con la revisione OCT."), { code: "INVALID_MES_RESPONSE" });
    expectedOcts.delete(text(oct.workspaceOctId));
  }
  const expectedLines = new Set(payload.octs.flatMap((oct) => oct.lines.map((line) => text(line.workspaceLineId))));
  if (result.analyses.length !== expectedLines.size)
    throw Object.assign(new Error("Risposta RdP v2 incompleta per le righe OCT inviate."), { code: "INVALID_MES_RESPONSE" });
  for (const analysis of result.analyses) {
    const lineId = text(analysis?.workspaceLineId);
    if (!expectedLines.delete(lineId) || !text(analysis?.snapshotHash) || typeof analysis?.blockCode !== "string" ||
        !positive(analysis?.requested) || typeof analysis?.materialCovered !== "boolean" ||
        !["physical", "committed", "free", "incoming", "missing", "producible", "plannable"]
          .every((field) => nonNegative(analysis?.[field])))
      throw Object.assign(new Error("Analisi RdP v2 non riconciliabile con le righe OCT."), { code: "INVALID_MES_RESPONSE" });
  }
  return result;
}

export function validateDecisionResponse(result, payload) {
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      text(result.externalId) !== text(payload.externalId) || !text(result.status) ||
      typeof result.productionCreated !== "boolean" || !text(result.message))
    throw Object.assign(new Error("Risposta decisione RdP v2 di ProgreMES non valida."), { code: "INVALID_MES_RESPONSE" });
  if (result.productionCreated === true && (!Array.isArray(result.productionOrders) || !result.productionOrders.length ||
      result.productionOrders.some((order) => !Number.isSafeInteger(Number(order?.id)) || Number(order.id) <= 0 || !text(order?.number))))
    throw Object.assign(new Error("ProgreMES ha dichiarato la creazione senza restituire OP persistiti."), { code: "INVALID_MES_RESPONSE" });
  return result;
}

export function validateV3PreviewResponse(result, payload) {
  if (!result || text(result.externalId) !== text(payload.externalId) || !text(result.snapshotHash) ||
      !["Ready", "Blocked"].includes(text(result.status)) || result.mutatesProduction !== false || !Array.isArray(result.formulas))
    throw Object.assign(new Error("Risposta preview WorkspaceMES V3 non valida."), { code: "INVALID_MES_V3_RESPONSE" });
  for (const formula of result.formulas) {
    if (!text(formula.workspaceLineId) || !text(formula.fpCode) || !positive(formula.quantity) ||
      (!text(formula.unitOfMeasure) && !text(formula.blocker)) || !Array.isArray(formula.materials) || formula.materials.some((material) =>
      !text(material.articleCode) || (!text(material.unitOfMeasure) && !text(material.blockCode)) || !nonNegative(material.required) ||
      !nonNegative(material.physical) || !nonNegative(material.committed) || !nonNegative(material.incoming) ||
      !nonNegative(material.uncovered) || !/^[a-f0-9]{64}$/.test(text(material.certifiedHash))))
      throw Object.assign(new Error("Snapshot MP V3 non certificabile."), { code: "INVALID_MES_V3_RESPONSE" });
  }
  return result;
}

export function validateV3ConfirmResponse(result, payload) {
  if (!result || text(result.externalId) !== text(payload.externalId) || !text(result.status) ||
      typeof result.productionCreated !== "boolean" || !Array.isArray(result.productionOrders) ||
      !Number.isSafeInteger(Number(result.materialCommitments)) || Number(result.materialCommitments) < 0)
    throw Object.assign(new Error("Risposta conferma WorkspaceMES V3 non valida."), { code: "INVALID_MES_V3_RESPONSE" });
  return result;
}

export function validateV4PreviewResponse(result, payload) {
  if (!result || text(result.externalId) !== text(payload.externalId) || !text(result.snapshotHash) ||
      !text(result.rowVersion) || !["Ready", "Blocked"].includes(text(result.status)) ||
      result.mutatesProduction !== false || !Array.isArray(result.demands))
    throw Object.assign(new Error("Risposta preview WorkspaceMES V4 non valida."), { code: "INVALID_MES_V4_RESPONSE" });
  const expected = new Set(payload.demands.map((demand) => text(demand.workspaceLineId)));
  for (const demand of result.demands) {
    if (!expected.delete(text(demand.workspaceLineId)) || !text(demand.finishedArticleCode) ||
        !positive(demand.quantity) || !text(demand.unitOfMeasure) || !Array.isArray(demand.materials))
      throw Object.assign(new Error("Domanda V4 non riconciliabile."), { code: "INVALID_MES_V4_RESPONSE" });
    for (const material of demand.materials) {
      if (!text(material.source) || !text(material.articleCode) || !text(material.unitOfMeasure) ||
          !["grossRequirement", "physicalStock", "committedQuantity", "netStock", "futureSupplyQuantity", "projectedAvailability", "shortageQuantity"].every((field) => nonNegative(material[field])) ||
          !/^[a-f0-9]{64}$/i.test(text(material.certifiedHash)))
        throw Object.assign(new Error("Materiale V4 non certificabile."), { code: "INVALID_MES_V4_RESPONSE" });
    }
  }
  if (expected.size) throw Object.assign(new Error("Preview V4 incompleta."), { code: "INVALID_MES_V4_RESPONSE" });
  return result;
}

export function validateV4ConfirmResponse(result, payload) {
  if (!result || text(result.externalId) !== text(payload.externalId) || !text(result.status) ||
      typeof result.productionCreated !== "boolean" || !Array.isArray(result.productionOrders) ||
      !Number.isSafeInteger(Number(result.commitmentsCreated)) || !Number.isSafeInteger(Number(result.shortagesCreated)))
    throw Object.assign(new Error("Risposta conferma WorkspaceMES V4 non valida."), { code: "INVALID_MES_V4_RESPONSE" });
  return result;
}

export function createProgremesProductionClient({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const call = async (path, payload) => {
    const origin = new URL(required("PROGREMES_URL", env));
    if (origin.protocol !== "https:") throw new Error("PROGREMES_URL deve usare HTTPS.");
    const secret = required("PROGREMES_INTEGRATION_SECRET", env);
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(now() / 1000);
    const eventId = payload.workspaceExternalId || payload.externalId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(1_000, Number(env.PROGREMES_API_TIMEOUT_MS) || 10_000)));
    try {
      const response = await fetchImpl(new URL(path, origin), {
        method: "POST", redirect: "error", signal: controller.signal, body,
        headers: {
          "content-type": "application/json",
          [HMAC_HEADERS.timestamp]: String(timestamp),
          [HMAC_HEADERS.eventId]: eventId,
          [HMAC_HEADERS.signature]: signProductionMessage({ method: "POST", path, timestamp, eventId, body, secret }),
        },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstreamCode = text(result.code) || `PROGREMES_HTTP_${response.status}`;
        console.error("ProgreMES production request rejected", {
          path, upstreamStatus: response.status, upstreamCode,
        });
        throw Object.assign(new Error(mesErrorMessage(result)), {
          status: response.status,
          code: upstreamCode,
          details: { upstreamStatus: response.status, upstreamCode },
        });
      }
      return { result, payloadHash: hash(body) };
    } finally { clearTimeout(timer); }
  };
  return {
    requestEnabled: () => enabled("PROGREMES_PRODUCTION_REQUESTS_ENABLED", env),
    confirmationEnabled: () => enabled("PROGREMES_PRODUCTION_CONFIRMATIONS_ENABLED", env),
    v3PreviewEnabled: () => enabled("WORKSPACEMES_V3_PREVIEW_ENABLED", env),
    v3ConfirmationEnabled: () => enabled("WORKSPACEMES_V3_CONFIRM_ENABLED", env),
    v4PreviewEnabled: () => enabled("WORKSPACEMES_V4_PREVIEW_ENABLED", env),
    v4ConfirmationEnabled: () => enabled("WORKSPACEMES_V4_CONFIRM_ENABLED", env),
    sendRequest: async (payload) => {
      const sent = await call(REQUEST_PATH, payload);
      return { ...sent, result: validateProductionResponse(sent.result, payload) };
    },
    decideRequest: async (workspaceExternalId, payload) => {
      const sent = await call(DECISION_PATH(workspaceExternalId), payload);
      return { ...sent, result: validateDecisionResponse(sent.result, payload) };
    },
    previewV3: async (payload) => {
      const sent = await call(V3_PREVIEW_PATH, payload);
      return { ...sent, result: validateV3PreviewResponse(sent.result, payload) };
    },
    confirmV3: async (workspaceExternalId, payload) => {
      const sent = await call(V3_CONFIRM_PATH(workspaceExternalId), payload);
      return { ...sent, result: validateV3ConfirmResponse(sent.result, payload) };
    },
    previewV4: async (payload) => {
      const sent = await call(V4_PREVIEW_PATH, payload);
      return { ...sent, result: validateV4PreviewResponse(sent.result, payload) };
    },
    confirmV4: async (workspaceExternalId, payload) => {
      const sent = await call(V4_CONFIRM_PATH(workspaceExternalId), payload);
      return { ...sent, result: validateV4ConfirmResponse(sent.result, payload) };
    },
    cancelV4: async (workspaceExternalId, payload) => call(V4_CANCEL_PATH(workspaceExternalId), payload),
    confirmProposal: (proposalId, externalId = randomUUID()) => call(CONFIRM_PATH(proposalId), { schemaVersion: 1, externalId, proposalId }),
  };
}

export { REQUEST_PATH, CONFIRM_PATH, DECISION_PATH, V3_PREVIEW_PATH, V3_CONFIRM_PATH, V4_PREVIEW_PATH, V4_CONFIRM_PATH, V4_CANCEL_PATH };
