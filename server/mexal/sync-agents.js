import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import { completeSyncRun, createSyncRun, failSyncRunUnlessClosed } from "../../api/mexal/lib/syncRuns.js";

const MODULE_CODE = "gestione_ordini";
const AGENT_PREFIX = "602.";

const text = (value) => String(value ?? "").trim();
const upper = (value) => text(value).toUpperCase();

function requireEnv(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function firstValue(row, names) {
  for (const name of names) {
    const value = row?.[name];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return null;
}

export function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["dati", "records", "items", "fornitori", "data", "results", "risultati"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

export function agentCode(row) {
  const value = firstValue(row, ["codice", "codice_fornitore", "cod_fornitore", "cod_conto", "conto", "codice_agente"]);
  return upper(Array.isArray(value) ? value[0] : value);
}

export function isActiveAgent(row) {
  const cancelled = upper(firstValue(row, ["gest_annullato", "annullato", "precancellato", "disattivo"]) || "N");
  return agentCode(row).startsWith(AGENT_PREFIX) && !["S", "SI", "Y", "YES", "TRUE", "1"].includes(cancelled);
}

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || 443, path: `${target.pathname}${target.search}`, method: "GET", headers, rejectUnauthorized: false, timeout: 60000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("Timeout collegamento Mexal.")));
    req.on("error", reject);
    req.end();
  });
}

function buildMexalClient() {
  const baseUrl = requireEnv("MEXAL_BASE_URL").replace(/\/+$/, "");
  const credentials = Buffer.from(`${requireEnv("MEXAL_USERNAME")}:${requireEnv("MEXAL_PASSWORD")}`, "utf8").toString("base64");
  const headers = {
    Authorization: `Passepartout ${credentials}`,
    "Coordinate-Gestionale": `Azienda=${requireEnv("MEXAL_AZIENDA")} Anno=${requireEnv("MEXAL_ANNO")} Magazzino=${requireEnv("MEXAL_MAGAZZINO")}`,
    Accept: "application/json",
  };
  return {
    async get(path) {
      const response = await request(`${baseUrl}/webapi/risorse${path}`, headers);
      let payload;
      try { payload = JSON.parse(response.body || "{}"); } catch { throw new Error(`${path}: risposta JSON non valida.`); }
      if (response.status < 200 || response.status >= 300) throw new Error(payload?.error?.["response-detail"] || payload?.error?.["response-message"] || `${path}: HTTP ${response.status}`);
      return payload;
    },
  };
}

async function requireAdmin(req, supabase) {
  const authorization = text(req.headers.authorization);
  if (process.env.CRON_SECRET && authorization === `Bearer ${process.env.CRON_SECRET}`) return;
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const { data: { user }, error } = await supabase.auth.getUser(authorization.slice(7));
  if (error || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile, error: profileError } = await supabase.from("utenti").select("id,attivo,ruoli(nome,livello)").eq("auth_user_id", user.id).maybeSingle();
  const role = upper(profile?.ruoli?.nome);
  if (profileError || !profile || profile.attivo === false || !(Number(profile.ruoli?.livello || 0) >= 80 || ["ADMIN", "ADMINISTRATOR", "AMMINISTRATORE", "SUPER ADMIN", "DIREZIONE"].includes(role))) throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
}

async function disableRemovedAgentAccess(supabase, codes) {
  if (!codes.length) return 0;
  const { data: accesses, error } = await supabase.from("integrazioni_utenti").select("id,utente_id,codice_agente_mexal,ruolo_ordini").eq("modulo", MODULE_CODE).in("codice_agente_mexal", codes);
  if (error) throw error;
  const agentAccesses = (accesses || []).filter((access) => access.ruolo_ordini === "agente");
  if (!agentAccesses.length) return 0;
  const userIds = [...new Set(agentAccesses.map((access) => access.utente_id).filter(Boolean))];
  const { data: users, error: usersError } = await supabase.from("utenti").select("id,auth_user_id").in("id", userIds);
  if (usersError) throw usersError;
  await supabase.from("integrazioni_utenti").update({ enabled: false }).in("id", agentAccesses.map((access) => access.id));
  if (userIds.length) {
    const { error: deactivateError } = await supabase.from("utenti").update({ attivo: false }).in("id", userIds);
    if (deactivateError) throw deactivateError;
  }
  await Promise.all((users || []).filter((user) => user.auth_user_id).map(async (user) => {
    const { error: authError } = await supabase.auth.admin.updateUserById(user.auth_user_id, { ban_duration: "876000h" });
    if (authError) throw authError;
  }));
  return userIds.length;
}

export async function syncAgents({ mexal, supabase, source = "manual" }) {
  const run = await createSyncRun(supabase, "agents", { source, endpoint: "/fornitori", prefix: AGENT_PREFIX });
  try {
    const payload = await mexal.get("/fornitori");
    const active = extractRows(payload).filter(isActiveAgent);
    const rows = active.map((row) => ({
      codice_agente_mexal: agentCode(row),
      nome: text(firstValue(row, ["nome", "nome_agente", "ragione_sociale", "descrizione"])) || agentCode(row),
      cognome: text(firstValue(row, ["cognome", "cognome_agente"])) || null,
      email: text(firstValue(row, ["email", "mail"])) || null,
      telefono: text(firstValue(row, ["telefono", "tel"])) || null,
      attivo: true,
      dati_mexal: row,
      ultimo_sync_mexal: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await supabase.from("mexal_agenti").upsert(rows, { onConflict: "codice_agente_mexal" });
      if (error) throw error;
    }
    const activeCodes = rows.map((row) => row.codice_agente_mexal);
    let removedCodes = [];
    const { data: known, error: knownError } = await supabase.from("mexal_agenti").select("codice_agente_mexal").eq("attivo", true);
    if (knownError) throw knownError;
    removedCodes = (known || []).map((row) => row.codice_agente_mexal).filter((code) => !activeCodes.includes(code));
    const disabledUsers = await disableRemovedAgentAccess(supabase, removedCodes);
    if (removedCodes.length) {
      const { error } = await supabase.from("mexal_agenti").delete().in("codice_agente_mexal", removedCodes);
      if (error) throw error;
    }
    await completeSyncRun(supabase, run.id, { processed: active.length, inserted: rows.length, updated: 0, skipped: 0, failed: 0, metadata: { source, endpoint: "/fornitori", activeAgents: rows.length, removedAgents: removedCodes.length, disabledUsers } });
    return { success: true, sync_run_id: run.id, elaborati: active.length, agenti_attivi: rows.length, agenti_rimossi: removedCodes.length, utenti_disattivati: disabledUsers };
  } catch (error) {
    await failSyncRunUnlessClosed(supabase, run.id, error);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non supportato." });
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    await requireAdmin(req, supabase);
    return res.status(200).json(await syncAgents({ mexal: buildMexalClient(), supabase, source: req.body?.origin || "manual" }));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Errore sincronizzazione agenti." });
  }
}
