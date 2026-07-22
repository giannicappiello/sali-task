const TERMS = /provvig|commission|categoria|agente|percentuale|perc/i;
const SENSITIVE = /(ragione|nome|cognome|indirizzo|localita|cap|provincia|telefono|email|piva|partita|fiscale|iban|banca|nota|descrizione|prezzo|importo|totale|sconto)/i;

function code(value, label, pattern) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!pattern.test(normalized)) throw Object.assign(new Error(`${label} non valido.`), { status: 400 });
  return normalized;
}

function reference(value, label) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^OC\+[^+/]+\+[^+/]+$/.test(normalized)) throw Object.assign(new Error(`${label} non valido. Usa OC+SERIE+NUMERO.`), { status: 400 });
  return normalized;
}

// This is deliberately a diagnostic redaction, not a schema projection: keys and
// scalar types remain available, while numerical values needed for the analysis
// (including values under unknown technical keys) are retained.
export function sanitizeCommissionJson(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizeCommissionJson(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeCommissionJson(item, name)]));
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "string" && !SENSITIVE.test(key)) return value;
  return { type: value === null ? "null" : typeof value, redacted: true };
}

function typeOf(value) { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }

export function findCommissionCandidates(value, path = "$", output = []) {
  if (path !== "$" && TERMS.test(path)) output.push({ path, valueType: typeOf(value), example: value, reliability: "candidato" });
  if (Array.isArray(value)) value.forEach((item, index) => findCommissionCandidates(item, `${path}[${index}]`, output));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => findCommissionCandidates(item, `${path}.${key}`, output));
  return output;
}

function classifyDocument(document) {
  const all = findCommissionCandidates(document);
  const groups = { header: [], articleRows: [], commissionRatePerRow: [], agentCode: [], parallelStructures: [], rowAssociationIndexes: [] };
  for (const item of all) {
    const path = item.path;
    if (/righe|riga|articoli/i.test(path)) groups.articleRows.push(item);
    else groups.header.push(item);
    if (/provvig|commission|percentuale|\bperc/i.test(path)) groups.commissionRatePerRow.push(item);
    if (/agente/i.test(path)) groups.agentCode.push(item);
    if (/matric|array|\[\d+\]/i.test(path)) groups.parallelStructures.push(item);
    if (/indice|index|id_riga|nr_riga|riga_id/i.test(path)) groups.rowAssociationIndexes.push(item);
  }
  return groups;
}

function flatten(value, path = "$", out = new Map()) {
  if (Array.isArray(value)) { value.forEach((item, i) => flatten(item, `${path}[${i}]`, out)); return out; }
  if (value && typeof value === "object") { Object.entries(value).forEach(([key, item]) => flatten(item, `${path}.${key}`, out)); return out; }
  out.set(path, value); return out;
}

function compare(left, right) {
  const a = flatten(left); const b = flatten(right); const paths = new Set([...a.keys(), ...b.keys()]);
  return [...paths].filter((path) => JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path))).sort().map((path) => ({ path, left: a.get(path) ?? null, right: b.get(path) ?? null }));
}

async function getProbe(client, label, path) {
  try {
    const payload = await client.getJson(path);
    return { label, endpoint: path, httpStatus: client.lastHttpStatus || 200, payload: sanitizeCommissionJson(payload) };
  } catch (error) {
    return { label, endpoint: path, httpStatus: error?.status || error?.httpStatus || null, error: error?.message || String(error) };
  }
}

async function cacheRow(supabase, table, column, value) {
  const { data, error } = await supabase.from(table).select("*").eq(column, value).maybeSingle();
  if (error) return { error: error.message, payload: null };
  return { error: null, payload: sanitizeCommissionJson(data) };
}

export async function runCommissionDiagnostics(client, supabase, values = {}) {
  const productCode = code(values.productCode, "Codice prodotto", /^(?:IT|MKT|IMP)[A-Z0-9._-]+$/);
  const clientCode = code(values.clientCode, "Codice cliente", /^501\.\d{5}$/);
  const manualReference = reference(values.manualReference, "OCM manuale");
  const workspaceReference = reference(values.workspaceReference, "OCM Workspace");
  const productPath = `/articoli/${encodeURIComponent(productCode)}`; // used by the product synchronizer
  const orderPath = (value) => `/documenti/ordini-clienti/${encodeURIComponent(value)}`;
  const clientPath = `/clienti/${encodeURIComponent(clientCode)}`;
  const [productHelp, clientHelp, orderHelp, product, customer, manual, workspace, productCache, clientCache] = await Promise.all([
    getProbe(client, "Help articoli", "/articoli/help.json"),
    getProbe(client, "Help clienti", "/clienti/help.json"),
    getProbe(client, "Help ordini clienti", "/documenti/ordini-clienti/help.json"),
    getProbe(client, "Prodotto Mexal", productPath),
    getProbe(client, "Cliente Mexal", clientPath),
    getProbe(client, "OCM manuale", orderPath(manualReference)),
    getProbe(client, "OCM Workspace", orderPath(workspaceReference)),
    cacheRow(supabase, "ordini_prodotti_cache", "codice_articolo", productCode),
    cacheRow(supabase, "ordini_clienti_cache", "codice_cliente", clientCode),
  ]);
  const endpoints = [productHelp, clientHelp, orderHelp, product, customer, manual, workspace].map(({ label, endpoint, httpStatus, error }) => ({ label, endpoint, httpStatus, error: error || null }));
  const productPayload = product.payload || null;
  const customerPayload = customer.payload || null;
  const manualPayload = manual.payload || null;
  const workspacePayload = workspace.payload || null;
  const candidateSources = [
    ["prodotto Mexal", productPayload], ["cliente Mexal", customerPayload], ["cliente cache Workspace", clientCache.payload], ["OCM manuale", manualPayload], ["OCM Workspace", workspacePayload],
  ];
  const candidates = candidateSources.flatMap(([source, payload]) => findCommissionCandidates(payload).map((candidate) => ({ source, ...candidate })));
  const report = candidates.length ? candidates : [{ source: "tutte le risposte", path: null, valueType: null, example: null, reliability: "non trovato" }];
  return {
    generatedAt: new Date().toISOString(), readOnly: true,
    references: { productCode, clientCode, manualReference, workspaceReference }, endpoints,
    json: { product: productPayload, customer: customerPayload, clientCache: clientCache.payload, manualOrder: manualPayload, workspaceOrder: workspacePayload, help: { product: productHelp.payload || null, client: clientHelp.payload || null, orders: orderHelp.payload || null } },
    report,
    manualOrderAnalysis: manualPayload ? classifyDocument(manualPayload) : null,
    comparisons: { productManualVsWorkspaceCache: compare(productPayload, productCache.payload), clientManualVsWorkspaceCache: compare(customerPayload, clientCache.payload), manualOcmVsWorkspace: compare(manualPayload, workspacePayload) },
    cacheErrors: { product: productCache.error, client: clientCache.error },
    privacy: "JSON sanitizzato: chiavi, struttura, tipi e valori numerici sono mantenuti; dati personali e commerciali identificativi sono redatti. Solo GET Mexal: nessun documento viene modificato o inviato.",
  };
}
