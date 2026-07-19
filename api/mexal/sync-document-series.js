import https from "node:https";
import { createClient } from "@supabase/supabase-js";

function env(name, fallback = "") { return String(process.env[name] ?? fallback).trim(); }
function required(name) { const value = env(name); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; }
function text(value) { return String(value ?? "").trim(); }

function requestJson({ url, headers = {} }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers,
      rejectUnauthorized: false,
      timeout: 60000,
    }, (response) => {
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

function supabaseAdmin() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verifyAdmin(req, supabase) {
  const authorization = req.headers.authorization || "";
  if (process.env.CRON_SECRET && authorization === `Bearer ${process.env.CRON_SECRET}`) return null;
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const token = authorization.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile } = await supabase
    .from("utenti")
    .select("id,attivo,ruoli(nome,livello)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const roleName = text(profile?.ruoli?.nome).toLowerCase();
  const allowed = profile?.attivo !== false && (Number(profile?.ruoli?.livello || 0) >= 80 || ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(roleName));
  if (!allowed) throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  return profile;
}

function mexalClient() {
  const rawBaseUrl = required("MEXAL_BASE_URL").replace(/\/+$/, "");
  const dominio = env("MEXAL_DOMINIO");
  const credential = Buffer.from(`${required("MEXAL_USERNAME")}:${required("MEXAL_PASSWORD")}`, "utf8").toString("base64");
  const authorization = `Passepartout ${credential}` + (dominio ? ` Dominio=${dominio}` : "");
  const baseUrl = rawBaseUrl.endsWith("/webapi/risorse")
    ? rawBaseUrl
    : `${rawBaseUrl}/webapi/risorse`;
  const azienda = required("MEXAL_AZIENDA");
  const anno = required("MEXAL_ANNO");
  const magazzino = env("MEXAL_MAGAZZINO");

  return {
    endpoint: `${baseUrl}/dati-generali/serie-documenti`,
    headers: {
      Authorization: authorization,
      "Coordinate-Gestionale": `Azienda=${azienda} Anno=${anno}${magazzino ? ` Magazzino=${magazzino}` : ""}`,
      Accept: "application/json",
    },
    diagnostics: {
      has_domain: Boolean(dominio),
      has_magazzino: Boolean(magazzino),
      base_url_has_resources: rawBaseUrl.endsWith("/webapi/risorse"),
    },
  };
}

const SERIES_FIELDS = new Set(["serie", "numero_serie", "nr_serie", "codice_serie", "sigla", "sigla_documento", "tipo_documento", "documento", "descrizione", "descrizione_serie", "des_serie"]);
const PREFERRED_KEYS = new Set(["data", "dati", "response", "risultati", "elenco", "righe", "documenti", "serie", "items", "records", "risorse", "result", "serie_documenti", "serie-documenti"]);

function isSeriesRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).some((key) => SERIES_FIELDS.has(key.toLowerCase())));
}

export function inspectPayload(payload) {
  const arrays = [];
  const seen = new WeakSet();
  function visit(value, path, depth) {
    if (depth > 5 || !value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      arrays.push({ path, length: value.length, sample_keys: value[0] && typeof value[0] === "object" && !Array.isArray(value[0]) ? Object.keys(value[0]).slice(0, 30) : [] , value });
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    Object.entries(value).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key, depth + 1));
  }
  visit(payload, "$", 0);
  return { payload_type: Array.isArray(payload) ? "array" : payload === null ? "null" : typeof payload, root_keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload).slice(0, 50) : [], arrays_found: arrays.map(({ value, ...safe }) => safe), candidates: arrays };
}

export function extractRows(payload) {
  if (isSeriesRecord(payload)) return [payload];
  const inspection = inspectPayload(payload);
  const candidates = inspection.candidates
    .map((entry) => ({ ...entry, compatible: entry.value.filter(isSeriesRecord), preferred: PREFERRED_KEYS.has(entry.path.split(".").pop()?.replace(/\[.*$/, "").toLowerCase()) }))
    .filter((entry) => entry.compatible.length);
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.compatible.length - a.compatible.length || a.path.length - b.path.length);
  if (candidates[0]?.compatible?.length) return candidates[0].compatible;
  // Mexal può annidare una singola serie sotto uno dei contenitori supportati;
  // raccogliamo quindi i record ricorsivamente anche quando non esiste un array.
  const found = []; const seen = new WeakSet();
  const visit = (value) => { if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value); if (isSeriesRecord(value)) found.push(value); Object.values(value).forEach(visit); };
  visit(payload); return found;
}

function normalizeRow(row, index) {
  const raw = row && typeof row === "object" ? row : { valore: row };
  const serie = text(raw.serie ?? raw.numero_serie ?? raw.nr_serie ?? raw.codice_serie ?? raw.num_serie ?? raw.serie_doc ?? raw.cod_serie ?? raw.codice ?? raw.id ?? raw.valore);
  const sigla = text(raw.sigla ?? raw.sigla_documento ?? raw.sigla_doc ?? raw.tipo_documento ?? raw.tipo_doc ?? raw.tipo ?? raw.documento).toUpperCase();
  const descrizione = text(raw.descrizione ?? raw.descrizione_serie ?? raw.des_serie ?? raw.nome ?? raw.descr ?? raw.description ?? `${sigla || "Documento"} serie ${serie}`);
  return {
    source_key: text(raw.id ?? raw.codice_serie ?? raw.cod_serie ?? raw.codice ?? `${sigla}:${serie}:${index}`),
    sigla_documento: sigla,
    serie,
    descrizione,
    attiva: raw.attivo === false || raw.attiva === false ? false : true,
    dati_mexal: raw,
    sincronizzata_il: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const admin = supabaseAdmin();
  let runId = null;
  try {
    await verifyAdmin(req, admin);
    const { data: run, error: runError } = await admin.from("mexal_sync_runs").insert({ sync_type: "document_series", status: "running", metadata: { source: "vercel" } }).select("id").single();
    if (runError) throw runError;
    runId = run.id;
    const mexal = mexalClient();
    console.info("Mexal serie documenti: richiesta avviata", mexal.diagnostics);
    const response = await requestJson({ url: mexal.endpoint, headers: mexal.headers });
    if (response.status < 200 || response.status >= 300) {
      const detail = response.data?.error?.["response-message"] || response.data?.error?.["response-detail"] || response.raw;
      const error = new Error(`Mexal HTTP ${response.status}: ${text(detail).slice(0, 500) || "errore lettura serie documenti"}`);
      error.details = `Endpoint serie documenti raggiunto; HTTP ${response.status}. Verificare credenziali, Coordinate-Gestionale e abilitazione WebAPI.`;
      throw error;
    }
    const payloadInspection = inspectPayload(response.data);
    const rows = extractRows(response.data).map(normalizeRow).filter((row) => row.serie !== "");
    if (!rows.length) {
      const error = new Error("Mexal non ha restituito serie documenti riconoscibili.");
      error.details = "La risposta JSON è valida ma non contiene serie documenti nei campi supportati.";
      error.diagnostics = { http_status: response.status, payload_type: payloadInspection.payload_type, root_keys: payloadInspection.root_keys, arrays_found: payloadInspection.arrays_found };
      throw error;
    }

    const sourceKeys = rows.map((row) => row.source_key);
    const { data: existing, error: existingError } = await admin
      .from("ordini_serie_documenti")
      .select("source_key")
      .in("source_key", sourceKeys);
    if (existingError) {
      const error = new Error("Errore Supabase durante la lettura delle serie esistenti.");
      error.details = text(existingError.message).slice(0, 500);
      throw error;
    }
    const { error: upsertError } = await admin.from("ordini_serie_documenti").upsert(rows, { onConflict: "source_key" });
    if (upsertError) {
      const error = new Error("Errore Supabase durante il salvataggio delle serie documenti.");
      error.details = text(upsertError.message).slice(0, 500);
      throw error;
    }
    const existingKeys = new Set((existing || []).map((row) => row.source_key));
    const updated = rows.filter((row) => existingKeys.has(row.source_key)).length;
    const imported = rows.length - updated;
    console.info("Mexal serie documenti: completata", { received: rows.length, imported, updated });

    await admin.from("mexal_sync_runs").update({ status: "completed", completed_at: new Date().toISOString(), processed: rows.length, inserted: imported, updated, skipped: 0, failed: 0 }).eq("id", runId);
    return res.status(200).json({ success: true, received: rows.length, imported, updated, skipped: 0, errors: [] });
  } catch (error) {
    console.error("Mexal serie documenti: errore", { message: error?.message, status: error?.status || 500 });
    if (runId) await admin.from("mexal_sync_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: text(error?.message).slice(0, 500) }).eq("id", runId);
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || "Errore sincronizzazione serie documenti.",
      details: error.details || "Controllare i log Vercel per dettagli non sensibili.",
      ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}),
    });
  }
}
