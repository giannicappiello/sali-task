const SENSITIVE_KEY = /(cliente|conto|ragione|nome|cognome|indirizzo|localita|cap|provincia|telefono|email|piva|partita|fiscale|prezzo|importo|totale|sconto|iban|banca|nota|descrizione|articolo)/i;
const TECHNICAL_KEY = /(stato|sospes|evad|modulo|causale|tipo|tp_|riga|flag|magazzino|pagamento|porto|trasporto|vettore|colli|peso|volume|aspetto|provvig|scaden|decorrenza|incoterm|spes)/i;

function safeValue(key, value, matrixIndex = false) {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (typeof value === "boolean") return value;
  if (matrixIndex && Number.isInteger(value)) return value;
  if (typeof value === "string" && TECHNICAL_KEY.test(key)) {
    const normalized = value.trim();
    if (/^[A-Z0-9_.+\-/ ]{1,32}$/i.test(normalized)) return normalized;
  }
  if (typeof value === "number" && TECHNICAL_KEY.test(key) && Number.isFinite(value)) return value;
  return undefined;
}

export function sanitizeContract(value, key = "", matrixIndex = false) {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeContract(item, key, index === 0));
  if (value === null) return { type: "null" };
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, sanitizeContract(item, childKey)]));
  const safe = safeValue(key, value, matrixIndex);
  return safe === undefined ? { type: typeof value } : { type: typeof value, value: safe };
}

function flatten(value, prefix = "", output = {}) {
  if (Array.isArray(value)) { output[prefix] = JSON.stringify(value); return output; }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, output);
    return output;
  }
  output[prefix] = value;
  return output;
}

function differences(left, right) {
  const a = flatten(left); const b = flatten(right);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) => ({ field: key, left: a[key] ?? null, right: b[key] ?? null }));
}

function normalizeReference(value) {
  const reference = String(value || "").trim().toUpperCase();
  if (!/^OC\+[^+\/]+\+[^+\/]+$/.test(reference)) throw Object.assign(new Error("Riferimento non valido. Usa il formato OC+SERIE+NUMERO."), { status: 400 });
  return reference;
}

async function readDocument(client, reference) {
  return sanitizeContract(await client.getJson(`/documenti/ordini-clienti/${encodeURIComponent(reference)}`));
}

async function readOptional(client, path) {
  try { return { ok: true, contract: sanitizeContract(await client.getJson(path)) }; }
  catch (error) { return { ok: false, error: error?.message || String(error) }; }
}

export async function runOrderContractDiagnostics(client, leftValue, rightValue) {
  const leftReference = normalizeReference(leftValue);
  const rightReference = normalizeReference(rightValue);
  const [left, right, ordersHelp, rowsHelp] = await Promise.all([
    readDocument(client, leftReference),
    readDocument(client, rightReference),
    readOptional(client, "/documenti/ordini-clienti/help.json"),
    readOptional(client, "/documenti/ordini-clienti/righe/help.json"),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    references: { left: leftReference, right: rightReference },
    left,
    right,
    differences: differences(left, right),
    help: { orders: ordersHelp, rows: rowsHelp },
    privacy: "Risposta sanitizzata: dati personali, anagrafiche, prezzi, importi, sconti e note non sono restituiti.",
  };
}
