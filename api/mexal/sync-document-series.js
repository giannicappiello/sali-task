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

// Strict allow-list for the Mexal document-series record fields; generic object aliases are intentionally excluded.
const FIELD = Object.freeze({ type: ["tipo_documento", "tipo_doc", "codice_tipo_documento"], acronym: ["sigla_documento", "sigla_doc"], series: ["serie", "numero_serie", "nr_serie", "codice_serie", "cod_serie"], description: ["descrizione", "descrizione_serie", "des_serie"], code: ["codice_univoco", "id_serie"], active: ["attiva", "attivo"] });
const SERIES_CONTAINER = /^(data|dati|response|risultati|elenco|righe|documenti|serie|items|records|risorse|result|serie_documenti|serie-documenti)$/i;
const SERIES_RECORD_KEYS = new Set([...FIELD.type, ...FIELD.acronym, ...FIELD.series]);
function firstField(raw, names) { return names.map((name) => raw[name]).find((value) => value !== undefined && value !== null); }
function isSeriesRecord(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).some((key) => SERIES_RECORD_KEYS.has(key.toLowerCase())) && firstField(value, FIELD.series) !== undefined); }
function safeScalar(key, value) {
  if (SENSITIVE_KEY.test(key) || value === null || typeof value === "object") return undefined;
  const rendered = text(value).slice(0, 100);
  return rendered || undefined;
}
function scalarPreview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, safeScalar(key, item)]).filter(([, item]) => item !== undefined));
}
export function inspectPayload(payload, endpoint = undefined, status = undefined) {
  const arrays = []; const seen = new WeakSet();
  function visit(value, path, depth) {
    if (depth > 6 || !value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { arrays.push({ path, length: value.length, first_element_keys: value[0] && typeof value[0] === "object" && !Array.isArray(value[0]) ? Object.keys(value[0]).slice(0, 30) : [], first_scalar_values: scalarPreview(value[0]), value }); value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1)); return; }
    Object.entries(value).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key, depth + 1));
  }
  visit(payload, "$", 0);
  const safeArrays = arrays.map((entry) => ({ path: entry.path, length: entry.length, first_element_keys: entry.first_element_keys, first_scalar_values: entry.first_scalar_values }));
  const candidate_paths = arrays.filter(({ value }) => value.some(isSeriesRecord)).map(({ path }) => path);
  return { ...(endpoint ? { endpoint } : {}), ...(status !== undefined ? { http_status: status } : {}), payload_type: Array.isArray(payload) ? "array" : payload === null ? "null" : typeof payload, root_keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload).slice(0, 50) : [], arrays_found: safeArrays, candidate_paths, sample_shape: { root_scalar_values: scalarPreview(payload), arrays: safeArrays.slice(0, 10) }, candidates: arrays };
}
function keyValueRows(payload) {
  const rows = [];
  function visit(value, path, seriesContext, depth) {
    if (depth > 5 || !value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const hereIsSeries = seriesContext || /serie/i.test(key);
      if (hereIsSeries && child && typeof child === "object" && !Array.isArray(child) && !isSeriesRecord(child)) {
        for (const [series, description] of Object.entries(child)) if (typeof description !== "object" && text(series)) rows.push({ serie: series, descrizione_serie: description, tipo_documento: key });
      }
      visit(child, `${path}.${key}`, hereIsSeries, depth + 1);
    }
  }
  visit(payload, "$", false, 0); return rows;
}
export function extractRows(payload) {
  if (isSeriesRecord(payload)) return [payload];
  const candidates = inspectPayload(payload).candidates.map((entry) => ({ ...entry, rows: entry.value.filter(isSeriesRecord), preferred: SERIES_CONTAINER.test(entry.path.split(".").pop()?.replace(/\[.*$/, "") || "") })).filter((entry) => entry.rows.length);
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.rows.length - a.rows.length || a.path.length - b.path.length);
  return candidates[0]?.rows || keyValueRows(payload);
}
export function normalizeRow(raw) {
  const serie = text(firstField(raw, FIELD.series));
  const tipo_documento = text(firstField(raw, FIELD.type)).toUpperCase();
  const sigla_documento = text(firstField(raw, FIELD.acronym) ?? tipo_documento).toUpperCase();
  const codice_univoco = text(firstField(raw, FIELD.code) ?? `${tipo_documento}:${sigla_documento}:${serie}`);
  return { source_key: codice_univoco, codice_univoco, tipo_documento, sigla_documento, serie, descrizione: text(firstField(raw, FIELD.description) ?? `${sigla_documento || tipo_documento} serie ${serie}`), attiva: firstField(raw, FIELD.active) === false ? false : true, dati_mexal: raw, sincronizzata_il: new Date().toISOString() };
}
export function prepareRows(payload) {
  const byKey = new Map();
  for (const raw of extractRows(payload)) { const row = normalizeRow(raw); if (row.serie && row.source_key) byKey.set(row.source_key, row); }
  return [...byKey.values()];
}
export async function saveRows(admin, rows) {
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
    const rows = prepareRows(response.data);
    if (!rows.length) throw Object.assign(new Error("Mexal non ha restituito serie documenti riconoscibili."), { details: "La risposta JSON è valida ma non contiene record serie nei campi Mexal supportati." });
    const counts = await saveRows(admin, rows);
    await completeSyncRun(admin, runId, { processed: rows.length, inserted: counts.inserted, updated: counts.updated, skipped: 0, failed: 0 });
    return res.status(200).json({ success: true, runId, received: rows.length, ...counts, skipped: 0, errors: [] });
  } catch (error) {
    if (runId) { try { await failSyncRun(admin, runId, text(error?.message)); } catch (closeError) { console.error("Mexal serie documenti: chiusura run fallita", closeError); } }
    return res.status(error.status || 500).json({ success: false, error: error.message || "Errore sincronizzazione serie documenti.", details: error.details || "Controllare la diagnostica amministrativa.", ...(diagnostics ? { diagnostics } : {}) });
  }
}
