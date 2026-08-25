export const DIGITAL_CONNECTIONS = Object.freeze([
  { type: "ecommerce", label: "Ecommerce", moduleCode: "crm_online_ecommerce", route: "/crm/online/ecommerce", sourceNeeded: "API e webhook della piattaforma ecommerce reale" },
  { type: "mailing", label: "Mailing", moduleCode: "crm_online_mailing", route: "/crm/online/mailing", sourceNeeded: "API del provider newsletter reale" },
  { type: "amazon_seller", label: "Amazon Seller", moduleCode: "crm_online_amazon", route: "/crm/online/amazon", sourceNeeded: "Amazon Selling Partner API (SP-API)" },
  { type: "amazon_ads", label: "Amazon Ads", moduleCode: "crm_online_amazon", route: "/crm/online/amazon", sourceNeeded: "Amazon Ads API" },
  { type: "meta_ads", label: "Meta Ads", moduleCode: "crm_online_adv", route: "/crm/online/adv", sourceNeeded: "Meta Marketing API" },
  { type: "google_ads", label: "Google Ads", moduleCode: "crm_online_adv", route: "/crm/online/adv", sourceNeeded: "Google Ads API" },
]);

export const DATA_STATUS = Object.freeze({
  available: { label: "Dato disponibile", className: "available" },
  partial: { label: "Dato parziale", className: "partial" },
  not_synced: { label: "Dato non sincronizzato", className: "pending" },
  not_available: { label: "Dato non disponibile", className: "unavailable" },
  error: { label: "Errore integrazione", className: "error" },
});

export function connectionDataStatus(connection) {
  if (!connection) return "not_available";
  if (connection.stato === "errore") return "error";
  if (!connection.abilitata || connection.stato === "non_configurato") return "not_available";
  if (!connection.ultimo_sync_il) return "not_synced";
  if (connection.stato === "configurazione_parziale") return "partial";
  return "available";
}

export function metricValue(value, formatter = (item) => item) {
  return value === null || value === undefined ? "Dato non disponibile" : formatter(value);
}

export function safeConnectionPayload(form) {
  return {
    provider: form.provider.trim() || null,
    nome: form.nome.trim(),
    endpoint_url: form.endpoint_url.trim() || null,
    site_url: form.site_url.trim() || null,
    external_account_id: form.external_account_id.trim() || null,
    marketplace_ids: form.marketplace_ids.split(",").map((item) => item.trim()).filter(Boolean),
    secret_references: Object.fromEntries(form.secret_references.split(",").map((item) => item.trim()).filter(Boolean).map((name) => [name, name])),
    sync_mode: form.sync_mode,
    intervallo_minuti: form.intervallo_minuti ? Number(form.intervallo_minuti) : null,
    abilitata: Boolean(form.abilitata),
    credenziali_stato: form.credenziali_stato,
    stato: form.stato,
  };
}
