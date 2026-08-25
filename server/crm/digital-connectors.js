export const SUPPORTED_DIGITAL_CONNECTORS = Object.freeze(["ecommerce", "mailing", "amazon_seller", "amazon_ads", "meta_ads", "google_ads"]);
export const ACTIVE_SYNC_STATUSES = Object.freeze(["queued", "running", "retrying"]);

export function digitalConnectorModule(type) {
  if (type === "ecommerce") return "crm_online_ecommerce";
  if (type === "mailing") return "crm_online_mailing";
  if (type === "amazon_seller" || type === "amazon_ads") return "crm_online_amazon";
  if (type === "meta_ads" || type === "google_ads") return "crm_online_adv";
  return null;
}

export function validateDigitalConnection(input = {}) {
  if (!SUPPORTED_DIGITAL_CONNECTORS.includes(input.tipo)) throw new Error("Tipo connettore Digital non supportato.");
  if (!String(input.nome || "").trim()) throw new Error("Nome connessione obbligatorio.");
  for (const field of ["endpoint_url", "site_url"]) {
    if (!input[field]) continue;
    const url = new URL(input[field]);
    if (url.protocol !== "https:") throw new Error(`${field} deve usare HTTPS.`);
  }
  const serialized = JSON.stringify(input);
  if (/access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password/i.test(serialized)) {
    throw new Error("I segreti non possono essere salvati nella configurazione CRM.");
  }
  return true;
}

export function nextRetryDelay(attempt, retryAfterSeconds = null) {
  if (Number.isFinite(Number(retryAfterSeconds)) && Number(retryAfterSeconds) > 0) return Number(retryAfterSeconds) * 1000;
  return Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, Number(attempt || 1) - 1)));
}

export function makeSyncIdempotencyKey({ connectionId, syncType, cursor = "full", windowStart = "" }) {
  return [connectionId, syncType, cursor || "full", windowStart || ""].map((item) => String(item).trim()).join(":");
}
