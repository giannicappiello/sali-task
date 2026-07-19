import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import { completeSyncRun, createSyncRun, failSyncRun } from "./lib/syncRuns.js";

function env(name, fallback = "") { return String(process.env[name] ?? fallback).trim(); }
function required(name) { const value = env(name); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; }
function text(value) { return String(value ?? "").trim(); }
const DOCUMENTED_SERIES_RESOURCE = "/dati-generali/serie-documenti";
const SENSITIVE_KEY = /authorization|token|secret|password|credential|cookie|session|api[ _-]?key/i;

function requestJson({ url, headers = {} }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({ protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port || 443, path: `${parsed.pathname}${parsed.search}`, method: "GET", headers, rejectUnauthorized: false, timeout: 60000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        resolve({ status: response.statusCode || 500, data, raw });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Timeout collegamento Mexal.")));
    req.on("error", reject);
    req.end();
  });
}

function supabaseAdmin() { return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }
async function verifyAdmin(req, supabase) {
  const authorization = req.headers.authorization || "";
  if (process.env.CRON_SECRET && authorization === `Bearer ${process.env.CRON_SECRET}`) return;
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(authorization.slice(7));
  if (error || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile } = await supabase.from("utenti").select("id,attivo,ruoli(nome,livello)").eq("auth_user_id", user.id).maybeSingle();
  const roleName = text(profile?.ruoli?.nome).toLowerCase();
  const allowed = profile?.attivo !== false && (Number(profile?.ruoli?.livello || 0) >= 80 || ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(roleName));
  if (!allowed) throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
}
function mexalClient() {
  const rawBaseUrl = required("MEXAL_BASE_URL").replace(/\/+$/, "");
  const dominio = env("MEXAL_DOMINIO");
  const credential = Buffer.from(`${required("MEXAL_USERNAME")}:${required("MEXAL_PASSWORD")}`, "utf8").toString("base64");
  const baseUrl = rawBaseUrl.endsWith("/webapi/risorse") ? rawBaseUrl : `${rawBaseUrl}/webapi/risorse`;
  const magazzino = env("MEXAL_MAGAZZINO");
  return { endpoint: `${baseUrl}${DOCUMENTED_SERIES_RESOURCE}`, headers: { Authorization: `Passepartout ${credential}${dominio ? ` Dominio=${dominio}` : ""}`, "Coordinate-Gestionale": `Azienda=${required("MEXAL_AZIENDA")} Anno=${required("MEXAL_ANNO")}${magazzino ? ` Magazzino=${magazzino}` : ""}`, Accept: "application/json" } };
}

const DIAGNOSTIC_ARRAY_LIMIT = 10;
const DIAGNOSTIC_SIGNATURE_LIMIT = 20;

function documentRecords(payload) {
  if (Array.isArray(payload?.dati)) return payload.dati;
  if (Array.isArray(payload)) return payload;
  return [];
}
function safeScalar(key, value) {
  if (SENSITIVE_KEY.test(key) || value === null || typeof value === "object") return undefined;
  const rendered = text(value).slice(0, 100);
  return rendered || undefined;
}
function scalarPreview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key, safeScalar(key, item)]).filter(([, item]) => item !== undefined));
}
/** Public, bounded diagnostic summary: it never carries the original Mexal payload. */
export function inspectPayload(payload, endpoint = undefined, status = undefined) {
  const arrays = [];
  const seen = new WeakSet();
  function visit(value, path, depth) {
    if (depth > 4 || !value || typeof value !== "object" || seen.has(value) || arrays.length >= DIAGNOSTIC_ARRAY_LIMIT) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const first = value[0];
      arrays.push({ path, length: value.length, first_element_keys: first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first).filter((key) => !SENSITIVE_KEY.test(key)).slice(0, 20) : [], first_scalar_values: scalarPreview(first) });
      return;
    }
    Object.entries(value).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key, depth + 1));
  }
  visit(payload, "$", 0);
  const documents = documentRecords(payload);
  const signatures = documents.map((document) => text(document?.sigla_documento).toUpperCase()).filter(Boolean);
  return {
    ...(endpoint ? { endpoint } : {}),
    ...(status !== undefined ? { http_status: status } : {}),
    payload_type: Array.isArray(payload) ? "array" : payload === null ? "null" : typeof payload,
    root_keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload).filter((key) => !SENSITIVE_KEY.test(key)).slice(0, 30) : [],
    arrays_found: arrays,
    candidate_paths: Array.isArray(payload?.dati) ? ["$.dati"] : [],
    sample_shape: { root_scalar_values: scalarPreview(payload), arrays: arrays.slice(0, DIAGNOSTIC_ARRAY_LIMIT) },
    document_count: documents.length,
    generated_series_count: 0,
    detected_document_signatures: [...new Set(signatures)].slice(0, DIAGNOSTIC_SIGNATURE_LIMIT),
    skipped_documents: [],
  };
}
function serieMassima(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function descriptionMap(value) {
  const descriptions = new Map();
  if (!Array.isArray(value)) return descriptions;
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const number = serieMassima(item[0]);
    const description = text(item[1]);
    if (number !== null && number >= 1 && description) descriptions.set(number, description);
  }
  return descriptions;
}
function isDocumentRecord(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && "sigla_documento" in value && "serie_massima" in value); }
export function extractRows(payload) { return documentRecords(payload).filter(isDocumentRecord); }
export function normalizeRow(document, series, originalDescription = undefined) {
  const sigla_documento = text(document.sigla_documento).toUpperCase();
  const serie = String(series);
  const source_key = `${sigla_documento}:${serie}`;
  const descrizione = text(originalDescription) || `Documento ${sigla_documento} - Serie ${serie}`;
  return {
    source_key,
    codice_univoco: source_key,
    tipo_documento: sigla_documento,
    sigla_documento,
    serie,
    descrizione,
    attiva: true,
    dati_mexal: { record_documento: document, numero_serie: series, ...(text(originalDescription) ? { descrizione_originale: originalDescription } : {}) },
    sincronizzata_il: new Date().toISOString(),
  };
}
export function prepareDocumentSeries(payload) {
  const rowsByKey = new Map();
  const skipped = [];
  const documents = documentRecords(payload);
  for (const [index, document] of documents.entries()) {
    const sigla = text(document?.sigla_documento).toUpperCase();
    const maximum = serieMassima(document?.serie_massima);
    if (!document || typeof document !== "object" || Array.isArray(document) || !sigla || maximum === null) {
      skipped.push({ index, reason: !sigla ? "sigla_documento mancante" : "serie_massima non valida" });
      continue;
    }
    if (maximum === 0) { skipped.push({ index, sigla_documento: sigla, reason: "serie_massima zero" }); continue; }
    const descriptions = descriptionMap(document.descrizione);
    for (let series = 1; series <= maximum; series += 1) rowsByKey.set(`${sigla}:${series}`, normalizeRow(document, series, descriptions.get(series)));
  }
  return { rows: [...rowsByKey.values()], received_documents: documents.length, generated_series: rowsByKey.size, skipped_documents: skipped };
}
export function prepareRows(payload) { return prepareDocumentSeries(payload).rows; }
export async function saveRows(admin, rows) {
  if (!rows.length) return { inserted: 0, updated: 0 };
  const sourceKeys = rows.map((row) => row.source_key);
  const { data: existing, error: existingError } = await admin.from("ordini_serie_documenti").select("source_key").in("source_key", sourceKeys);
  if (existingError) throw new Error(`Errore Supabase durante la lettura delle serie esistenti: ${text(existingError.message).slice(0, 400)}`);
  const { error: upsertError } = await admin.from("ordini_serie_documenti").upsert(rows, { onConflict: "source_key" });
  if (upsertError) throw new Error(`Errore Supabase durante il salvataggio delle serie documenti: ${text(upsertError.message).slice(0, 400)}`);
  const previous = new Set((existing || []).map((row) => row.source_key));
  return { inserted: rows.filter((row) => !previous.has(row.source_key)).length, updated: rows.filter((row) => previous.has(row.source_key)).length };
}
async function persistDiagnostics(admin, runId, diagnostics) { await admin.from("mexal_sync_runs").update({ metadata: { endpoint: diagnostics.endpoint, diagnostics } }).eq("id", runId); }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const admin = supabaseAdmin(); let runId = null; let diagnostics;
  try {
    await verifyAdmin(req, admin);
    const run = await createSyncRun(admin, { syncType: "document_series", source: "manual", metadata: { endpoint: DOCUMENTED_SERIES_RESOURCE } });
    if (run.duplicate) throw Object.assign(new Error("È già presente una sincronizzazione serie documenti in corso."), { status: 409 });
    runId = run.id;
    const mexal = mexalClient(); const response = await requestJson({ url: mexal.endpoint, headers: mexal.headers });
    diagnostics = inspectPayload(response.data, mexal.endpoint, response.status);
    await persistDiagnostics(admin, runId, diagnostics);
    if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(`Mexal HTTP ${response.status}: ${text(response.data?.error?.["response-message"] || response.data?.error?.["response-detail"] || "errore lettura serie documenti").slice(0, 500)}`), { details: "Endpoint raggiunto ma risposta Mexal non valida." });
    const prepared = prepareDocumentSeries(response.data);
    diagnostics.generated_series_count = prepared.generated_series;
    diagnostics.skipped_documents = prepared.skipped_documents.slice(0, 20);
    await persistDiagnostics(admin, runId, diagnostics);
    if (!prepared.received_documents) throw Object.assign(new Error("Mexal non ha restituito documenti serie."), { details: "La risposta JSON è valida ma non contiene l'array dati previsto." });
    const counts = await saveRows(admin, prepared.rows);
    await completeSyncRun(admin, runId, { processed: prepared.generated_series, inserted: counts.inserted, updated: counts.updated, skipped: prepared.skipped_documents.length, failed: 0 });
    return res.status(200).json({ success: true, runId, received_documents: prepared.received_documents, generated_series: prepared.generated_series, ...counts, skipped: prepared.skipped_documents.length, errors: [] });
  } catch (error) {
    if (runId) { try { await failSyncRun(admin, runId, text(error?.message)); } catch (closeError) { console.error("Mexal serie documenti: chiusura run fallita", closeError); } }
    return res.status(error.status || 500).json({ success: false, error: error.message || "Errore sincronizzazione serie documenti.", details: error.details || "Controllare la diagnostica amministrativa.", ...(diagnostics ? { diagnostics } : {}) });
  }
}
