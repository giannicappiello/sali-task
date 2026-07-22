export const LIST_PRICE_COMMISSIONS_ENDPOINT = "/dati-generali/provvigioni-listini";

const WRAPPER_KEYS = ["dati", "data", "records", "items", "risultati", "results", "provvigioni", "listini"];
const PAGINATION_KEYS = ["next", "next_token", "nextToken", "continuation_token", "pagina", "page", "totale", "total", "has_more"];
const LOCAL_FIELDS = ["cod_cat_pr", "id_categoria_pr", "perc_provv", "formula_pr", "calc_formula_pr", "tipo_provv", "cod_agente"];
const FIELD_GROUPS = {
  cliente: /client|cliente|conto|customer/i,
  categoria_cliente: /(?:cat(?:egoria)?[_-]?(?:client|cliente)|cod_cat_pr)/i,
  articolo: /articol|prodot|item|product/i,
  categoria_articolo: /(?:cat(?:egoria)?[_-]?(?:articol|prodot)|id_categoria_pr)/i,
  agente: /agent|agente|cod_agente/i,
  listino: /listin|price.?list/i,
  percentuale: /perc|percent|provv/i,
  formula: /formula|calc_formula/i,
  tipo_provvigione: /tipo.*provv|provv.*tipo/i,
  validita_temporale: /valid|data_(?:da|al)|(?:dal|al)_data|inizio|fine/i,
  quantita: /quantit|qta|quantity/i,
  sconto: /sconto|discount/i,
  scaglione: /scaglion|tier|bracket/i,
  importo: /importo|amount|valore/i,
  valuta: /valuta|currency/i,
};

const MAX_DEPTH = 6;
const MAX_ELEMENTS = 300;

function payloadType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function safeMetadataValue(key, value) {
  if (/token/i.test(key)) return "present";
  return value === null || ["string", "number", "boolean"].includes(typeof value) ? value : payloadType(value);
}

export function extractListPriceCommissionRecords(payload) {
  if (Array.isArray(payload)) return { records: payload, wrapper: null };
  if (!payload || typeof payload !== "object") return { records: [], wrapper: null };
  for (const key of WRAPPER_KEYS) {
    if (Array.isArray(payload[key])) return { records: payload[key], wrapper: key };
  }
  return { records: [payload], wrapper: null };
}

export function summarizeListPriceCommissionsPayload(payload, { maxDepth = MAX_DEPTH, maxElements = MAX_ELEMENTS } = {}) {
  const { records, wrapper } = extractListPriceCommissionRecords(payload);
  const fields = new Set();
  const pagination = {};
  const visited = new WeakSet();
  let inspected = 0;
  let depthLimitReached = false;
  let elementLimitReached = false;

  function inspect(value, depth = 0) {
    if (value === null || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    if (depth >= maxDepth) { depthLimitReached = true; return; }
    for (const [key, child] of Object.entries(value)) {
      if (inspected >= maxElements) { elementLimitReached = true; return; }
      inspected += 1;
      fields.add(key);
      if (PAGINATION_KEYS.includes(key)) pagination[key] = safeMetadataValue(key, child);
      inspect(child, depth + 1);
    }
  }

  inspect(payload);
  const fieldNames = [...fields].sort();
  const potentialFields = Object.fromEntries(Object.entries(FIELD_GROUPS).map(([group, matcher]) => [group, fieldNames.filter((name) => matcher.test(name))]));
  const localMatchers = {
    cod_cat_pr: FIELD_GROUPS.categoria_cliente,
    id_categoria_pr: FIELD_GROUPS.categoria_articolo,
    perc_provv: FIELD_GROUPS.percentuale,
    formula_pr: FIELD_GROUPS.formula,
    calc_formula_pr: FIELD_GROUPS.formula,
    tipo_provv: FIELD_GROUPS.tipo_provvigione,
    cod_agente: FIELD_GROUPS.agente,
  };
  const localFields = Object.fromEntries(LOCAL_FIELDS.map((localField) => [localField, {
    possibleMatches: fieldNames.filter((name) => localMatchers[localField].test(name)),
  }]));
  const paginationDetected = Object.keys(pagination).length > 0;
  const hasMore = pagination.has_more === true || String(pagination.has_more).toLowerCase() === "true";

  return {
    endpoint: LIST_PRICE_COMMISSIONS_ENDPOINT,
    success: true,
    payloadType: payloadType(payload),
    recordCount: records.length,
    wrapper,
    fields: { present: fieldNames, potentiallyRelevant: potentialFields, notFound: Object.keys(potentialFields).filter((group) => potentialFields[group].length === 0) },
    pagination: {
      detected: paginationDetected,
      metadata: pagination,
      fetchedPages: 1,
      maximumPages: 1,
      complete: !hasMore && pagination.has_more === false,
      note: hasMore ? "Sono presenti altre pagine, ma non vengono inventati parametri di paginazione." : "La risposta non dimostra un meccanismo di paginazione completo; è stata letta solo la prima pagina GET.",
    },
    completenessGuaranteed: !hasMore && pagination.has_more === false,
    localFields,
    analysisLimits: { maxDepth, maxElements, inspectedElements: inspected, depthLimitReached, elementLimitReached },
  };
}

/** Performs exactly one read-only GET and keeps the raw payload out of logs. */
export async function runListPriceCommissionsDiagnostics(mexal, options) {
  const payload = await mexal.getJson(LIST_PRICE_COMMISSIONS_ENDPOINT);
  return { summary: summarizeListPriceCommissionsPayload(payload, options), payload };
}
