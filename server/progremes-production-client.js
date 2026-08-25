import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import { HMAC_HEADERS, signProductionMessage } from "./progremes-production-hmac.js";

const REQUEST_PATH = "/api/workspace/v1/production-order-requests";
const CONFIRM_PATH = (id) => `/api/workspace/v1/production-proposals/${id}/confirmations`;

function required(name, env) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Configurazione server mancante: ${name}`);
  return value;
}
function enabled(name, env) { return String(env[name] || "").trim().toLowerCase() === "true"; }
function hash(body) { return createHash("sha256").update(body).digest("hex"); }

export function createProductionPayload({ request, snapshot, demand }) {
  if (!request?.external_id || !snapshot?.id || !Array.isArray(demand?.items) || !demand.items.length)
    throw new Error("Domanda RdP multi-OCT incompleta.");
  return {
    schemaVersion: 2,
    externalId: request.external_id,
    requestType: "MULTI_OCT_PRODUCTION_DEMAND",
    idempotencyKey: request.idempotency_key,
    demandSnapshot: { id: snapshot.id, hash: snapshot.hash, capturedAt: snapshot.capturedAt },
    availabilityOwner: "PROGREMES",
    orders: demand.orders,
    items: demand.items.map((item) => ({
      itemIndex: item.itemIndex,
      itemExternalKey: item.itemExternalKey,
      oct: {
        externalId: item.orderId,
        lineExternalId: item.lineId,
        mexalKey: item.mexalOrderKey,
        position: item.mexalLinePosition,
      },
      commercialArticleCode: item.commercialArticleCode,
      productionArticleCode: item.productionArticleCode,
      mappingStatus: item.mappingStatus,
      requested: { value: item.requestedQuantity, unitOfMeasure: item.requestedUnitOfMeasure },
      requestedInProductionUnit: { value: item.productionQuantity, unitOfMeasure: item.productionUnitOfMeasure },
      conversion: item.conversion,
      requestedDeliveryDate: item.requestedDeliveryDate,
    })),
  };
}

export function createProgremesProductionClient({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const call = async (path, payload) => {
    const origin = new URL(required("PROGREMES_URL", env));
    if (origin.protocol !== "https:") throw new Error("PROGREMES_URL deve usare HTTPS.");
    const secret = required("PROGREMES_INTEGRATION_SECRET", env);
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(now() / 1000);
    const eventId = payload.externalId;
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
      if (!response.ok) throw Object.assign(new Error("ProgreMES ha rifiutato la richiesta."), { status: response.status, code: result.code });
      return { result, payloadHash: hash(body) };
    } finally { clearTimeout(timer); }
  };
  return {
    requestEnabled: () => enabled("PROGREMES_PRODUCTION_REQUESTS_ENABLED", env),
    confirmationEnabled: () => enabled("PROGREMES_PRODUCTION_CONFIRMATIONS_ENABLED", env),
    sendRequest: (payload) => call(REQUEST_PATH, payload),
    confirmProposal: (proposalId, externalId = randomUUID()) => call(CONFIRM_PATH(proposalId), { schemaVersion: 1, externalId, proposalId }),
  };
}

export { REQUEST_PATH, CONFIRM_PATH };
