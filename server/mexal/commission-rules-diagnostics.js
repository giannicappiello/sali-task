// Discovery only.  Mexal publishes its resource catalogue at /help; paths found
// below are never guessed and the diagnostic never writes to Mexal or Supabase.
const CANDIDATE_RESOURCES = ["/help"];
const TERMS = ["provvig", "provvigione", "provvigioni", "commission", "agente", "agenti", "condizione agente", "condizioni agenti", "categoria provvigionale", "cod_cat_pr", "id_categoria_pr", "cod_cond_age", "id_cond_agente", "perc_provv", "formula_pr", "calc_formula_pr", "tipo_provv"];
const SENSITIVE = /(authorization|token|secret|password|credential|cookie|session|email|telefono|indirizzo|ragione|nome|cognome|iban|piva|fiscale|prezzo|importo|totale|sconto|nota|descrizione)/i;
const MAX_RECORDS = 3;
const MAX_KEYS = 30;
const MAX_DEPTH = 4;
const MAX_TEXT = 80;
const termPattern = new RegExp(TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

function typeOf(value) { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function text(value) { return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""; }
function matchingTerms(value) { return TERMS.filter((term) => String(value).toLowerCase().includes(term)); }
function records(payload) { return Array.isArray(payload?.dati) ? payload.dati : Array.isArray(payload?.righe) ? payload.righe : Array.isArray(payload) ? payload : []; }
function safeScalar(key, value) { return SENSITIVE.test(key) || value === null || typeof value === "object" ? undefined : String(value).slice(0, MAX_TEXT); }
function normalizedEndpoint(value) {
  const candidate = String(value || "").trim();
  return /^\/[A-Za-z0-9_./{}:-]+(?:\?[A-Za-z0-9_=&{}:-]+)?$/.test(candidate) ? candidate : null;
}
function methodsFrom(node) {
  const values = [];
  for (const [key, value] of Object.entries(node || {})) {
    if (!/^(method|http_method|methods|verbi|verb)$/i.test(key)) continue;
    values.push(...(Array.isArray(value) ? value : [value]));
  }
  return [...new Set(values.map((value) => String(value).toUpperCase()).filter((value) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value)))];
}
function parameterList(node, required) {
  const result = [];
  const visit = (value, key = "", parentKey = "", depth = 0) => {
    if (depth > 5 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key, parentKey, depth + 1));
    const name = value.name || value.nome || value.parameter || value.parametro || (typeof key === "string" ? key : "");
    const isRequired = value.required === true || value.obbligatorio === true || value.mandatory === true;
    if (name && (/param|query|path|required|obblig/i.test(key) || /param|query|path/i.test(parentKey)) && isRequired === required) result.push(String(name));
    Object.entries(value).forEach(([childKey, child]) => visit(child, childKey, key, depth + 1));
  };
  visit(node);
  return [...new Set(result)].slice(0, MAX_KEYS);
}
function fieldsFrom(node) {
  const fields = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 6 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((item) => visit(item, depth + 1));
    Object.entries(value).forEach(([key, item]) => { if (/^(properties|schema|fields|campi)$/i.test(key) && item && typeof item === "object") Object.keys(item).forEach((field) => fields.add(field)); visit(item, depth + 1); });
  };
  visit(node); return [...fields].slice(0, MAX_KEYS);
}

/** Scan every object, key and textual value in the real /help catalogue. */
export function extractCommissionCatalog(help) {
  const candidates = new Map();
  const visit = (value, jsonPath = "$", inheritedTerms = [], inheritedEndpoints = [], inheritedMethods = []) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, `${jsonPath}[${index}]`, inheritedTerms, inheritedEndpoints, inheritedMethods));
    const localText = Object.entries(value).flatMap(([key, item]) => [key, text(item)]).join(" ");
    const matched = [...new Set([...inheritedTerms, ...matchingTerms(localText)])];
    const endpoints = [...new Set([...inheritedEndpoints, ...Object.entries(value).flatMap(([key, item]) => /^(resource|risorsa|endpoint|url|path|percorso)$/i.test(key) ? [normalizedEndpoint(item)] : []).filter(Boolean)])];
    const methods = [...new Set([...inheritedMethods, ...methodsFrom(value)])];
    for (const endpoint of endpoints) {
      if (!matched.length) continue;
      for (const method of methods.length ? methods : ["GET"]) {
        const key = `${endpoint} ${method}`;
        const item = { resource: value.resource || value.risorsa || endpoint, endpoint, method, description: text(value.description || value.descrizione || value.summary || value.nome), matched_terms: matched, required_parameters: parameterList(value, true), optional_parameters: parameterList(value, false), schema_fields: fieldsFrom(value), json_path: jsonPath, confidence: methods.length && matched.length ? "high" : "medium" };
        const previous = candidates.get(key);
        candidates.set(key, previous ? { ...previous, matched_terms: [...new Set([...previous.matched_terms, ...matched])], required_parameters: [...new Set([...previous.required_parameters, ...item.required_parameters])], optional_parameters: [...new Set([...previous.optional_parameters, ...item.optional_parameters])], schema_fields: [...new Set([...previous.schema_fields, ...item.schema_fields])] } : item);
      }
    }
    Object.entries(value).forEach(([key, item]) => visit(item, `${jsonPath}.${key}`, [...matched, ...matchingTerms(key)], normalizedEndpoint(key) ? [normalizedEndpoint(key)] : endpoints, /^(GET|POST|PUT|PATCH|DELETE)$/i.test(key) ? [key.toUpperCase()] : methods));
  };
  visit(help);
  return [...candidates.values()];
}

/** Returns shape only: no full Mexal records, secrets or customer data. */
export function summarizeCommissionCandidate(payload) {
  const rows = records(payload).slice(0, MAX_RECORDS); const keys = new Set(); const matchingPaths = [];
  const visit = (value, path = "$", depth = 0) => {
    if (depth > MAX_DEPTH || !value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.slice(0, MAX_RECORDS).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    Object.entries(value).slice(0, MAX_KEYS).forEach(([key, item]) => { keys.add(key); if (termPattern.test(key)) matchingPaths.push({ path: `${path}.${key}`, type: typeOf(item) }); visit(item, `${path}.${key}`, depth + 1); });
  };
  visit(payload);
  return { payload_type: typeOf(payload), root_keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload).filter((key) => !SENSITIVE.test(key)).slice(0, MAX_KEYS) : [], record_count: records(payload).length, record_keys: [...new Set(rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row).filter((key) => !SENSITIVE.test(key)) : []))].slice(0, MAX_KEYS), candidate_fields: matchingPaths.slice(0, MAX_KEYS), scalar_preview: rows.map((row) => Object.fromEntries(Object.entries(row || {}).slice(0, MAX_KEYS).map(([key, value]) => [key, safeScalar(key, value)]).filter(([, value]) => value !== undefined)))};
}
function hasCompleteRelationship(payload) {
  let complete = false;
  const visit = (value, depth = 0) => {
    if (complete || depth > MAX_DEPTH || !value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.slice(0, MAX_RECORDS).forEach((item) => visit(item, depth + 1));
    const keys = Object.keys(value).join(" ").toLowerCase();
    if (/(cliente|client).*(categor|cat)|(?:categor|cat).*(cliente|client)/.test(keys) && /(prodotto|articol).*(categor|cat)|(?:categor|cat).*(prodotto|articol)/.test(keys) && /(perc.*provv|provv.*perc|commission.*percent)/.test(keys)) complete = true;
    Object.values(value).forEach((item) => visit(item, depth + 1));
  }; visit(payload); return complete;
}

export async function runCommissionRulesDiagnostics(client) {
  const help = await client.getJson("/help");
  const catalog = extractCommissionCatalog(help);
  const endpointTests = [];
  for (const item of catalog) {
    const unsafe = item.method !== "GET";
    const required = item.required_parameters.length > 0;
    if (unsafe || required) { endpointTests.push({ endpoint: item.endpoint, method: item.method, http_status: null, status: "documentato ma non interrogato", fields_found: [], skip_reason: unsafe ? "Sono consentiti solo endpoint GET." : `Parametri obbligatori non disponibili: ${item.required_parameters.join(", ")}.`, next_step: unsafe ? "Usare soltanto una risorsa GET documentata." : "Fornire parametri di sola lettura verificati." }); continue; }
    try { const payload = await client.getJson(item.endpoint); endpointTests.push({ endpoint: item.endpoint, method: "GET", http_status: client.lastHttpStatus || 200, status: "interrogato", fields_found: summarizeCommissionCandidate(payload).candidate_fields.map((field) => field.path), response: summarizeCommissionCandidate(payload), complete_relationship: hasCompleteRelationship(payload), next_step: hasCompleteRelationship(payload) ? "Verificare la semantica e la validità della relazione documentata." : "Servono categoria cliente, categoria prodotto e percentuale nella stessa relazione documentata." }); }
    catch (error) { endpointTests.push({ endpoint: item.endpoint, method: "GET", http_status: error?.status || error?.httpStatus || null, status: "errore", fields_found: [], skip_reason: String(error?.message || "Errore Mexal").slice(0, 300), next_step: "Verificare disponibilità e autorizzazioni della risorsa documentata." }); }
  }
  const verified = endpointTests.some((item) => item.complete_relationship);
  return { readOnly: true, endpointVerified: verified, reason: verified ? "È stata trovata una relazione candidata completa; verificare la semantica documentata prima di sincronizzare." : "Il catalogo è stato analizzato, ma non è stata dimostrata una relazione documentata tra categoria cliente, categoria prodotto e percentuale.", catalog, endpointTests, resources_found: catalog.map((item) => item.endpoint), fields_found: [...new Set(catalog.flatMap((item) => item.schema_fields))], missing_information: verified ? [] : ["relazione categoria cliente", "relazione categoria prodotto", "percentuale provvigione"], limits: { records_per_response: MAX_RECORDS, depth: MAX_DEPTH, scalar_length: MAX_TEXT, response: "sono restituiti solo struttura e campi; payload completi esclusi" }, nextStep: verified ? "Confermare con documentazione Mexal la sequenza e la validità delle regole." : "Individuare una risorsa GET documentata che esponga le tre informazioni nella stessa regola." };
}

export { CANDIDATE_RESOURCES };
