import { createClient } from "@supabase/supabase-js";
import { buildMexalClient } from "./sync-products.js";
import { completeSyncRun, createSyncRun, failSyncRun } from "../../api/mexal/lib/syncRuns.js";
import { requireAdmin } from "../../api/mexal/lib/auth.js";

const AGENTS_ENDPOINT = "/dati-generali/agenti";
const ACTIVE_VALUES = new Set(["1", "s", "si", "y", "yes", "true", "attivo", "active"]);

const text = (value) => String(value ?? "").trim();

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

/** Extract the collection without relying on a particular Mexal response envelope. */
export function extractAgentRows(payload) {
  if (Array.isArray(payload)) return payload;
  return [payload?.dati, payload?.records, payload?.items, payload?.data, payload?.risultati, payload?.results]
    .find(Array.isArray) || [];
}

export function isMexalAgentActive(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ACTIVE_VALUES.has(text(value).toLowerCase());
}

function field(record, names) {
  return names.map((name) => record?.[name]).find((value) => text(value));
}

export function normalizeAgent(record, synchronizedAt = new Date().toISOString()) {
  const codice = text(field(record, ["codice", "codice_agente", "cod_agente", "id_agente", "id"]));
  if (!codice) throw new Error("Agente Mexal privo di codice.");
  return {
    codice,
    nome: text(field(record, ["nome", "descrizione", "ragione_sociale", "nominativo"])) || codice,
    email: text(field(record, ["email", "e_mail", "mail"])) || null,
    attivo: isMexalAgentActive(field(record, ["attivo", "attiva", "abilitato", "stato"])),
    dati_mexal: record,
    sincronizzato_il: synchronizedAt,
  };
}

async function setWorkspaceUserState(supabase, agentId, attivo) {
  // utenti has no `ruolo` column: the link to an imported Mexal agent is agent_id.
  const { data: users, error } = await supabase
    .from("utenti")
    .select("id,auth_user_id")
    .eq("agent_id", agentId);
  if (error) throw error;

  for (const user of users || []) {
    const { error: userError } = await supabase.from("utenti").update({ attivo }).eq("id", user.id);
    if (userError) throw userError;
    if (user.auth_user_id) {
      const { error: authError } = await supabase.auth.admin.updateUserById(user.auth_user_id, {
        // Supabase accepts "none" to lift a ban and a long duration to block sign-in.
        ban_duration: attivo ? "none" : "876000h",
      });
      if (authError) throw authError;
    }
  }
  return (users || []).length;
}

async function upsertActiveAgent(supabase, agent) {
  const { data: existing, error: readError } = await supabase
    .from("mexal_agenti")
    .select("id")
    .eq("codice", agent.codice)
    .maybeSingle();
  if (readError) throw readError;
  const { data, error } = await supabase
    .from("mexal_agenti")
    .upsert(agent, { onConflict: "codice" })
    .select("id")
    .single();
  if (error) throw error;
  const workspaceUsers = await setWorkspaceUserState(supabase, data.id, true);
  return { inserted: existing ? 0 : 1, updated: existing ? 1 : 0, workspaceUsers };
}

/**
 * Persist only active Mexal agents. Existing records missing from this active
 * snapshot are retired atomically from the application perspective: Workspace
 * is disabled, Auth is banned, then the stale Mexal mapping is removed.
 */
export async function synchronizeAgents({ mexal, supabase, now = () => new Date().toISOString() }) {
  const rows = extractAgentRows(await mexal.getJson(AGENTS_ENDPOINT));
  const activeAgents = [];
  const errors = [];
  for (const row of rows) {
    try {
      const agent = normalizeAgent(row, now());
      if (agent.attivo) activeAgents.push(agent);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }

  const summary = { letti_da_mexal: rows.length, attivi_mexal: activeAgents.length, inseriti: 0, aggiornati: 0, disattivati_workspace: 0, eliminati: 0, errori: errors };
  for (const agent of activeAgents) {
    try {
      const result = await upsertActiveAgent(supabase, agent);
      summary.inseriti += result.inserted;
      summary.aggiornati += result.updated;
    } catch (error) { summary.errori.push(`Agente ${agent.codice}: ${error.message || error}`); }
  }

  const activeCodes = activeAgents.map((agent) => agent.codice);
  let staleQuery = supabase.from("mexal_agenti").select("id,codice");
  if (activeCodes.length) staleQuery = staleQuery.not("codice", "in", `(${activeCodes.map((code) => JSON.stringify(code)).join(",")})`);
  const { data: staleAgents, error: staleError } = await staleQuery;
  if (staleError) throw staleError;
  for (const stale of staleAgents || []) {
    try {
      summary.disattivati_workspace += await setWorkspaceUserState(supabase, stale.id, false);
      const { error } = await supabase.from("mexal_agenti").delete().eq("id", stale.id);
      if (error) throw error;
      summary.eliminati += 1;
    } catch (error) { summary.errori.push(`Agente ${stale.codice}: ${error.message || error}`); }
  }
  return summary;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Metodo non consentito." });
  const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  let runId;
  try {
    await requireAdmin(req, supabase);
    const run = await createSyncRun(supabase, { syncType: "agents", source: req.body?.origin || "manual" });
    if (run.duplicate) return res.status(409).json({ success: false, error: "Sincronizzazione agenti già in esecuzione.", runId: run.id });
    runId = run.id;
    const summary = await synchronizeAgents({ mexal: buildMexalClient(), supabase });
    await completeSyncRun(supabase, runId, { processed: summary.letti_da_mexal, inserted: summary.inseriti, updated: summary.aggiornati, skipped: summary.letti_da_mexal - summary.attivi_mexal, failed: summary.errori.length });
    return res.status(200).json({ success: true, runId, ...summary });
  } catch (error) {
    if (runId) await failSyncRun(supabase, runId, error.message || "Errore sincronizzazione agenti.");
    return res.status(error.status || 500).json({ success: false, error: error.message || "Errore sincronizzazione agenti." });
  }
}

export { AGENTS_ENDPOINT };
