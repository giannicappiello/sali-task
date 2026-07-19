import https from "node:https";
import { createClient } from "@supabase/supabase-js";

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}
function required(name) {
  const value = env(name);
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}
function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function text(value) { return String(value ?? "").trim(); }

function requestJson({ url, method = "POST", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: {
        ...headers,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
      },
      rejectUnauthorized: false,
      timeout: 60000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; }
        catch { data = { raw }; }
        resolve({ status: response.statusCode || 500, data, raw });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Timeout collegamento Mexal.")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function supabaseAdmin() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verifyUser(req, supabase) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const token = authorization.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });

  const { data: profile } = await supabase
    .from("utenti")
    .select("id,attivo,accesso_ordini,ruoli(nome,livello)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!profile || profile.attivo === false || profile.accesso_ordini === false) {
    throw Object.assign(new Error("Utente non autorizzato alla gestione ordini."), { status: 403 });
  }
  return profile;
}

function mexalClient() {
  const baseUrl = required("MEXAL_BASE_URL").replace(/\/+$/, "");
  const credential = Buffer.from(`${required("MEXAL_USERNAME")}:${required("MEXAL_PASSWORD")}`, "utf8").toString("base64");
  const endpoint = env("MEXAL_ORDER_ENDPOINT", "/documenti/ordini-clienti");
  const headers = {
    Authorization: `Passepartout ${credential}`,
    "Coordinate-Gestionale": `Azienda=${required("MEXAL_AZIENDA")} Anno=${required("MEXAL_ANNO")} Magazzino=${required("MEXAL_MAGAZZINO")}`,
    Accept: "application/json",
  };
  return {
    async create(payload) {
      const response = await requestJson({ url: `${baseUrl}/webapi/risorse${endpoint}`, headers, body: payload });
      if (response.status < 200 || response.status >= 300) {
        const detail = response.data?.error?.["response-detail"] || response.data?.error?.["response-message"] || response.data?.message || response.raw;
        throw new Error(`Mexal HTTP ${response.status}: ${detail || "errore creazione documento"}`);
      }
      return response.data;
    },
  };
}

function buildDocument(order, lines, kind) {
  const isOcm = kind === "OCM";
  const series = env(isOcm ? "MEXAL_OCM_SERIE" : "MEXAL_OCX_SERIE", isOcm ? "M" : "X");
  const rows = lines
    .map((line) => ({ ...line, quantita_documento: number(isOcm ? line.quantita_ocm : line.quantita_ocx) }))
    .filter((line) => line.quantita_documento > 0);
  if (!rows.length) return null;

  return {
    sigla: "OC",
    serie: series,
    conto: text(order.codice_cliente),
    codice_cliente: text(order.codice_cliente),
    data_documento: order.data_ordine,
    codice_pagamento: text(order.codice_pagamento),
    codice_agente: text(order.codice_agente_mexal),
    note: text(order.note_mexal || `Workspace n. ${order.id}`),
    righe: rows.map((line) => ({
      articolo: text(line.codice_articolo),
      codice_articolo: text(line.codice_articolo),
      descrizione: text(line.descrizione),
      quantita: line.quantita_documento,
      prezzo: number(line.prezzo_netto),
      prezzo_netto: number(line.prezzo_netto),
      sconto: text(line.sconto_commerciale),
      sconto_pagamento: text(line.sconto_pagamento),
      unita_misura: text(line.unita_misura || "PZ"),
    })),
  };
}

function extractNumber(result) {
  return text(result?.numero || result?.numero_documento || result?.documento?.numero || result?.id || result?.risorsa);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const admin = supabaseAdmin();
  let orderId = null;
  try {
    await verifyUser(req, admin);
    orderId = text(req.body?.orderId);
    if (!orderId) return res.status(400).json({ error: "orderId obbligatorio." });

    const [{ data: order, error: orderError }, { data: lines, error: linesError }] = await Promise.all([
      admin.from("ordini_testate").select("*").eq("id", orderId).single(),
      admin.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id"),
    ]);
    if (orderError) throw orderError;
    if (linesError) throw linesError;
    if (!lines?.length) throw new Error("Ordine senza righe.");

    if (!req.body?.force && order.stato_sincronizzazione === "completato") {
      return res.status(200).json({ skipped: true, message: "Ordine già sincronizzato.", numero_ocm: order.numero_ocm, numero_ocx: order.numero_ocx });
    }

    await admin.from("ordini_testate").update({ stato_sincronizzazione: "in_corso", errore_sincronizzazione: null, ultimo_tentativo_sync: new Date().toISOString() }).eq("id", orderId);

    const client = mexalClient();
    const documents = [];
    for (const kind of ["OCM", "OCX"]) {
      const payload = buildDocument(order, lines, kind);
      if (!payload) continue;
      const startedAt = new Date().toISOString();
      try {
        const result = await client.create(payload);
        const numero = extractNumber(result);
        documents.push({ kind, numero, result });
        await admin.from("ordini_sync_mexal_log").insert({ ordine_id: orderId, tipo_documento: kind, stato: "successo", payload, risposta: result, iniziato_il: startedAt, completato_il: new Date().toISOString() });
      } catch (error) {
        await admin.from("ordini_sync_mexal_log").insert({ ordine_id: orderId, tipo_documento: kind, stato: "errore", payload, errore: error.message, iniziato_il: startedAt, completato_il: new Date().toISOString() });
        throw error;
      }
    }

    const ocm = documents.find((item) => item.kind === "OCM");
    const ocx = documents.find((item) => item.kind === "OCX");
    await admin.from("ordini_testate").update({
      stato: "confermato",
      stato_sincronizzazione: "completato",
      sincronizzato_mexal_il: new Date().toISOString(),
      errore_sincronizzazione: null,
      numero_ocm: ocm?.numero || order.numero_ocm || null,
      numero_ocx: ocx?.numero || order.numero_ocx || null,
    }).eq("id", orderId);

    return res.status(200).json({ success: true, numero_ocm: ocm?.numero || null, numero_ocx: ocx?.numero || null, documents });
  } catch (error) {
    if (orderId) {
      await admin.from("ordini_testate").update({ stato_sincronizzazione: "errore", errore_sincronizzazione: error.message, ultimo_tentativo_sync: new Date().toISOString() }).eq("id", orderId);
    }
    return res.status(error.status || 500).json({ error: error.message || "Errore sincronizzazione ordine." });
  }
}
