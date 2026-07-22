// This deliberately probes only candidate GET resources. Mexal's bundled help in
// this repository does not document a commission-rules collection, so this is
// discovery tooling, not an assumed synchronizer.
const CANDIDATE_RESOURCES = [
  "/help.json",
  "/agenti/help.json",
  "/condizioni-agenti/help.json",
  "/provvigioni/help.json",
  "/condizioni-commerciali/help.json",
  "/tabelle-generali/help.json",
  "/tabelle-personalizzate/help.json",
];
const SENSITIVE = /(authorization|token|secret|password|credential|cookie|session|email|telefono|indirizzo|ragione|nome|cognome|iban|piva|fiscale|prezzo|importo|totale|sconto|nota|descrizione)/i;
const COMMISSION = /provvig|commission|cod_cat_pr|id_categoria_pr|cod_cond_age|id_cond_agente|perc_provv|formula_pr|calc_formula_pr|tipo_provv/i;
const MAX_RECORDS = 3;
const MAX_KEYS = 30;

function typeOf(value) { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function safeScalar(key, value) {
  if (SENSITIVE.test(key) || value === null || typeof value === "object") return undefined;
  return String(value).slice(0, 80);
}
function records(payload) {
  if (Array.isArray(payload?.dati)) return payload.dati;
  if (Array.isArray(payload?.righe)) return payload.righe;
  if (Array.isArray(payload)) return payload;
  return [];
}

/** Returns shape only: no full Mexal records, secrets or customer data. */
export function summarizeCommissionCandidate(payload) {
  const rows = records(payload).slice(0, MAX_RECORDS);
  const keys = new Set();
  const matchingPaths = [];
  const visit = (value, path = "$", depth = 0) => {
    if (depth > 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.slice(0, MAX_RECORDS).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1)); return; }
    Object.entries(value).slice(0, MAX_KEYS).forEach(([key, item]) => {
      keys.add(key);
      if (COMMISSION.test(key)) matchingPaths.push({ path: `${path}.${key}`, type: typeOf(item) });
      visit(item, `${path}.${key}`, depth + 1);
    });
  };
  visit(payload);
  return {
    payload_type: typeOf(payload), root_keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload).filter((key) => !SENSITIVE.test(key)).slice(0, MAX_KEYS) : [],
    record_count: records(payload).length,
    record_keys: [...new Set(rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row).filter((key) => !SENSITIVE.test(key)) : []))].slice(0, MAX_KEYS),
    candidate_fields: matchingPaths.slice(0, MAX_KEYS),
    scalar_preview: rows.map((row) => Object.fromEntries(Object.entries(row || {}).slice(0, MAX_KEYS).map(([key, value]) => [key, safeScalar(key, value)]).filter(([, value]) => value !== undefined))),
  };
}

export async function runCommissionRulesDiagnostics(client, paths = CANDIDATE_RESOURCES) {
  const endpoints = [];
  for (const endpoint of paths.slice(0, CANDIDATE_RESOURCES.length)) {
    try {
      const payload = await client.getJson(endpoint);
      endpoints.push({ endpoint, method: "GET", http_status: client.lastHttpStatus || 200, response: summarizeCommissionCandidate(payload) });
    } catch (error) {
      endpoints.push({ endpoint, method: "GET", http_status: error?.status || error?.httpStatus || null, error: String(error?.message || "Errore Mexal").slice(0, 300) });
    }
  }
  return {
    readOnly: true,
    endpointVerified: false,
    reason: "Nessun endpoint o schema di regole provvigionali è documentato nel repository; nessuna sincronizzazione è stata eseguita.",
    endpoints,
    limits: { endpoints: CANDIDATE_RESOURCES.length, records_per_response: MAX_RECORDS, scalar_length: 80 },
    nextStep: "Fornire l'help.json o una risposta GET Mexal che identifichi risorsa, chiave, percentuale e validità delle regole.",
  };
}

export { CANDIDATE_RESOURCES };
