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
        let data = null;
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
  };
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "items", "records", "risorse", "result", "serie_documenti", "serie-documenti"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeRow(row, index) {
  const raw = row && typeof row === "object" ? row : { valore: row };
  const serie = text(raw.serie ?? raw.numero_serie ?? raw.nr_serie ?? raw.codice ?? raw.id ?? raw.valore);
  const sigla = text(raw.sigla ?? raw.sigla_documento ?? raw.tipo_documento ?? raw.tipo ?? raw.documento).toUpperCase();
  const descrizione = text(raw.descrizione ?? raw.nome ?? raw.descr ?? raw.description ?? `${sigla || "Documento"} serie ${serie}`);
  return {
    source_key: text(raw.id ?? raw.codice ?? `${sigla}:${serie}:${index}`),
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
  try {
    await verifyAdmin(req, admin);
    const mexal = mexalClient();
    const response = await requestJson({ url: mexal.endpoint, headers: mexal.headers });
    if (response.status < 200 || response.status >= 300) {
      const detail = response.data?.error?.["response-message"] || response.data?.error?.["response-detail"] || response.raw;
      throw new Error(`Mexal HTTP ${response.status}: ${detail || "errore lettura serie documenti"}`);
    }
    const rows = extractRows(response.data).map(normalizeRow).filter((row) => row.serie !== "");
    if (!rows.length) throw new Error("Mexal non ha restituito serie documenti riconoscibili.");

    const { error: deactivateError } = await admin.from("ordini_serie_documenti").update({ attiva: false }).neq("id", 0);
    if (deactivateError) throw deactivateError;
    const { error: upsertError } = await admin.from("ordini_serie_documenti").upsert(rows, { onConflict: "source_key" });
    if (upsertError) throw upsertError;

    return res.status(200).json({ ok: true, endpoint: mexal.endpoint, count: rows.length, series: rows });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Errore sincronizzazione serie documenti." });
  }
}
