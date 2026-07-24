import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import { completeSyncRun, createSyncRun, failSyncRunUnlessClosed } from "../../api/mexal/lib/syncRuns.js";

const AGENT_PREFIX = "602";
const PAGE_SIZE = 500;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function first(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return null;
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["dati", "records", "items", "fornitori", "suppliers", "data", "results", "risultati"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function nextTokenOf(payload) {
  return first(payload, ["next", "next_token", "nextToken", "prossimo", "continuation_token"]);
}

function request(url, headers) {
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
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("Timeout collegamento Mexal.")));
    req.on("error", reject);
    req.end();
  });
}

function buildClient() {
  const base = required("MEXAL_BASE_URL").replace(/\/+$/, "");
  const credential = Buffer.from(`${required("MEXAL_USERNAME")}:${required("MEXAL_PASSWORD")}`, "utf8").toString("base64");
  const headers = {
    Authorization: `Passepartout ${credential}`,
    "Coordinate-Gestionale": `Azienda=${required("MEXAL_AZIENDA")} Anno=${required("MEXAL_ANNO")} Magazzino=${required("MEXAL_MAGAZZINO")}`,
    Accept: "application/json",
  };
  return {
    async get(path) {
      const response = await request(`${base}/webapi/risorse${path}`, headers);
      let payload;
      try { payload = JSON.parse(response.body || "{}"); } catch { throw new Error(`${path}: risposta JSON non valida.`); }
      if (response.status < 200 || response.status >= 300) {
        const detail = payload?.error?.["response-detail"] || payload?.error?.["response-message"] || `${path}: HTTP ${response.status}`;
        throw Object.assign(new Error(detail), { status: response.status });
      }
      return payload;
    },
  };
}

async function requireAuthorized(req, admin) {
  const authorization = req.headers.authorization || "";
  if (process.env.CRON_SECRET && authorization === `Bearer ${process.env.CRON_SECRET}`) return;
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const { data: authData, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !authData?.user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile, error } = await admin.from("utenti").select("attivo,ruoli(nome,livello)").eq("auth_user_id", authData.user.id).maybeSingle();
  const name = upper(profile?.ruoli?.nome);
  if (error || !profile || profile.attivo === false || !(Number(profile.ruoli?.livello || 0) >= 80 || ["ADMIN", "ADMINISTRATOR", "AMMINISTRATORE", "SUPER ADMIN", "DIREZIONE"].includes(name))) {
    throw Object.assign(new Error("Sincronizzazione agenti riservata agli amministratori."), { status: 403 });
  }
}

function splitName(row) {
  const directName = text(first(row, ["nome", "first_name"]));
  const directSurname = text(first(row, ["cognome", "last_name"]));
  if (directName || directSurname) return { nome: directName || null, cognome: directSurname || null };
  const full = text(first(row, ["descrizione", "denominazione", "nominativo", "ragione_sociale", "rag_soc"]));
  if (!full) return { nome: null, cognome: null };
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? { nome: parts.slice(0, -1).join(" "), cognome: parts.at(-1) } : { nome: full, cognome: null };
}

function isActiveMexal(row) {
  const disabledFlag = upper(first(row, [
    "annullato", "precancellato", "gest_annullato", "disattivato", "inattivo", "bloccato",
  ]));
  if (["S", "Y", "YES", "TRUE", "1"].includes(disabledFlag)) return false;

  const status = upper(first(row, ["stato", "status", "stato_anagrafica", "stato_fornitore"]));
  if (["I", "INATTIVO", "DISATTIVO", "DISATTIVATO", "DISABILITATO", "ANNULLATO", "BLOCCATO"].includes(status)) return false;
  return true;
}

function mapAgent(row, syncAt) {
  const code = upper(first(row, ["codice", "codice_fornitore", "cod_fornitore", "cod_conto", "codconto", "conto", "codiceConto", "id"]));
  const names = splitName(row);
  return {
    codice: code,
    nome: names.nome,
    cognome: names.cognome,
    email: text(first(row, ["email", "mail", "posta_elettronica"])) || null,
    telefono: text(first(row, ["telefono", "tel", "telefono1", "cellulare", "mobile"])) || null,
    attivo_mexal: isActiveMexal(row),
    dati_mexal: row,
    ultimo_sync_mexal: syncAt,
    aggiornato_il: syncAt,
  };
}

async function loadSupplierRows(mexal) {
  const rawRows = [];
  let next = null;
  let page = 0;
  do {
    const params = new URLSearchParams();
    params.set("max", String(PAGE_SIZE));
    if (next) params.set("next", String(next));
    const payload = await mexal.get(`/fornitori?${params.toString()}`);
    rawRows.push(...rowsOf(payload));
    next = nextTokenOf(payload);
    page += 1;
    if (page > 200) throw new Error("Paginazione fornitori Mexal interrotta: troppe pagine.");
  } while (next);
  return rawRows;
}

async function loadAgents(mexal) {
  const rawRows = await loadSupplierRows(mexal);
  const syncAt = new Date().toISOString();
  const allAgents = rawRows
    .map((row) => mapAgent(row, syncAt))
    .filter((row) => row.codice.startsWith(AGENT_PREFIX));

  if (!allAgents.length) {
    throw new Error(`Mexal ha restituito ${rawRows.length} fornitori, ma nessuno con codice iniziale ${AGENT_PREFIX}.`);
  }

  const unique = [...new Map(allAgents.map((row) => [row.codice, row])).values()];
  return unique.filter((row) => row.attivo_mexal);
}

async function removeInactiveAgents(admin, activeCodes) {
  const { data: existingAgents, error } = await admin
    .from("mexal_agenti")
    .select("id,codice,workspace_utente_id");
  if (error) throw error;

  const inactive = (existingAgents || []).filter((agent) => !activeCodes.has(agent.codice));
  if (!inactive.length) return 0;

  const inactiveAgentIds = inactive.map((agent) => agent.id);
  const workspaceIds = inactive.map((agent) => agent.workspace_utente_id).filter(Boolean);

  if (workspaceIds.length) {
    const { data: users, error: usersError } = await admin
      .from("utenti")
      .select("id,auth_user_id")
      .in("id", workspaceIds);
    if (usersError) throw usersError;

    const { error: disableUsersError } = await admin
      .from("utenti")
      .update({ attivo: false, agent_id: null })
      .in("id", workspaceIds);
    if (disableUsersError) throw disableUsersError;

    for (const user of users || []) {
      if (!user.auth_user_id) continue;
      const { error: banError } = await admin.auth.admin.updateUserById(user.auth_user_id, { ban_duration: "876000h" });
      if (banError) throw banError;
    }
  }

  const { error: deleteError } = await admin
    .from("mexal_agenti")
    .delete()
    .in("id", inactiveAgentIds);
  if (deleteError) throw deleteError;

  return inactive.length;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  let runId = null;
  try {
    await requireAuthorized(req, admin);
    const run = await createSyncRun(admin, { syncType: "agents", source: req.body?.origin || "manual" });
    if (run.duplicate) throw Object.assign(new Error("È già presente una sincronizzazione agenti in corso."), { status: 409 });
    runId = run.id;

    const activeAgents = await loadAgents(buildClient());
    const activeCodes = new Set(activeAgents.map((item) => item.codice));

    let existing = [];
    if (activeAgents.length) {
      const result = await admin
        .from("mexal_agenti")
        .select("codice")
        .in("codice", activeAgents.map((item) => item.codice));
      if (result.error) throw result.error;
      existing = result.data || [];

      const { error: upsertError } = await admin.from("mexal_agenti").upsert(activeAgents, { onConflict: "codice" });
      if (upsertError) throw upsertError;
    }

    const existingCodes = new Set(existing.map((item) => item.codice));
    const removed = await removeInactiveAgents(admin, activeCodes);
    const inserted = activeAgents.filter((item) => !existingCodes.has(item.codice)).length;
    const updated = activeAgents.length - inserted;

    await completeSyncRun(admin, runId, {
      processed: activeAgents.length,
      inserted,
      updated,
      skipped: 0,
      failed: 0,
      metadata: { endpoint: "/fornitori", codice_prefix: AGENT_PREFIX, eliminati_disattivati: removed },
    });

    return res.status(200).json({
      success: true,
      sync_run_id: runId,
      letti_mexal: activeAgents.length,
      inseriti: inserted,
      aggiornati: updated,
      eliminati_disattivati: removed,
      risorsa_mexal: "/fornitori",
      errori: [],
    });
  } catch (error) {
    if (runId) await failSyncRunUnlessClosed(admin, runId, error);
    return res.status(Number(error.status || 500)).json({ success: false, error: error.message || "Errore sincronizzazione agenti.", details: error.details || null });
  }
}
