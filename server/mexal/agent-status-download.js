import { findTechnicalCredentialPath } from "./full-help-download.js";

const PAGE_SIZE = 500;
const MAX_PAGES = 200;
const ROW_KEYS = ["dati", "records", "items", "fornitori", "suppliers", "data", "results", "risultati"];
const CODE_KEYS = ["codice", "codice_fornitore", "cod_fornitore", "cod_conto", "codconto", "conto", "codiceConto", "id"];
const NEXT_KEYS = ["next", "next_token", "nextToken", "prossimo", "continuation_token"];

function text(value) {
  return String(value ?? "").trim();
}

function normalizeCode(value) {
  return text(value).toUpperCase();
}

function first(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return null;
}

export function supplierRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ROW_KEYS) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

export function supplierCode(row) {
  return normalizeCode(first(row, CODE_KEYS));
}

function nextToken(payload) {
  return first(payload, NEXT_KEYS);
}

function validateRequestedCodes(activeAgentCode, inactiveAgentCode) {
  const active = normalizeCode(activeAgentCode);
  const inactive = normalizeCode(inactiveAgentCode);

  if (!active || !inactive) {
    throw Object.assign(new Error("Inserisci il codice di un agente attivo e di uno disattivato."), { status: 400 });
  }
  if (!active.startsWith("602") || !inactive.startsWith("602")) {
    throw Object.assign(new Error("I codici agente devono iniziare con 602."), { status: 400 });
  }
  if (active === inactive) {
    throw Object.assign(new Error("I due codici agente devono essere diversi."), { status: 400 });
  }

  return { active, inactive };
}

export async function downloadAgentStatusSamples(client, {
  activeAgentCode,
  inactiveAgentCode,
  now = () => new Date().toISOString(),
} = {}) {
  const requested = validateRequestedCodes(activeAgentCode, inactiveAgentCode);
  const records = { active: null, inactive: null };
  let recordsRead = 0;
  let pagesRead = 0;
  let next = null;

  do {
    const params = new URLSearchParams({ max: String(PAGE_SIZE) });
    if (next) params.set("next", String(next));

    const payload = await client.getJson(`/fornitori?${params.toString()}`);
    const rows = supplierRows(payload);
    pagesRead += 1;
    recordsRead += rows.length;

    for (const row of rows) {
      const code = supplierCode(row);
      if (code === requested.active) records.active = row;
      if (code === requested.inactive) records.inactive = row;
    }

    if (records.active && records.inactive) break;
    next = nextToken(payload);
  } while (next && pagesRead < MAX_PAGES);

  const missing = [];
  if (!records.active) missing.push(requested.active);
  if (!records.inactive) missing.push(requested.inactive);
  if (missing.length) {
    throw Object.assign(new Error(`Codici agente non trovati in /fornitori: ${missing.join(", ")}.`), {
      status: 404,
      details: { pagesRead, recordsRead, missing },
    });
  }

  const credentialPath = findTechnicalCredentialPath(records);
  if (credentialPath) {
    throw Object.assign(new Error("I record contengono un campo che sembra una credenziale tecnica; download bloccato per sicurezza."), {
      status: 422,
      credentialPath,
    });
  }

  return {
    downloadedAt: now(),
    source: "/webapi/risorse/fornitori",
    requested,
    pagesRead,
    recordsRead,
    records,
  };
}
